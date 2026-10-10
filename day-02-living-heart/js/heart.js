// Loads the heart (manifest glTF or the baked procedural heart), sizes it, and computes the beat weights.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeartMaterial } from './heart-material.js';
import { normalizeLandmarks, threadRoots } from './landmarks.js';

export async function loadHeart({ lowTier, onLandmarks }) {
  const manifest = await fetch('assets/manifest.json').then((r) => r.json()).catch(() => ({}));
  if (manifest.model) {
    try {
      const source = normalize(await loadGltf('assets/' + manifest.model, manifest.landmarks, lowTier));
      onLandmarks({ roots: threadRoots(source.landmarks), width: source.width });
      return { ...buildHeart(source), credit: manifest.credit || null };
    } catch (err) {
      console.warn('The heart model did not load, so the procedural heart is shown instead.', err);
    }
  }
  // The procedural heart is baked already normalised; its landmarks come first in a tiny file.
  const lm = await fetchOk('assets/heart-procedural.json', 'json');
  onLandmarks({ roots: threadRoots(lm.landmarks), width: lm.width });
  const source = await loadBaked('assets/heart-procedural.bin');
  source.landmarks = lm.landmarks;
  return { ...buildHeart(source), credit: null };
}

// One retry: a dropped connection on a phone should not cost the visitor the heart.
async function fetchOk(url, as) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return await r[as]();
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}

async function loadBaked(url) {
  const buf = await fetchOk(url, 'arrayBuffer');
  const dv = new DataView(buf);
  const headerLen = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
  const base = 8 + headerLen;
  const arr = {};
  for (const s of head.sections) arr[s.name] = new globalThis[s.type](buf, base + s.offset, s.length);
  const n = head.count;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3), fat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = head.min[k] + (arr.position[i * 3 + k] / 65535) * (head.max[k] - head.min[k]);
      normals[i * 3 + k] = arr.normal[i * 3 + k] / 127;
      colors[i * 3 + k] = (arr.color[i * 4 + k] / 255) ** 2;
    }
    fat[i] = arr.color[i * 4 + 3] / 255;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aFat', new THREE.BufferAttribute(fat, 1));
  g.setIndex(new THREE.BufferAttribute(arr.index, 1));
  return { geometry: g, maps: null, landmarks: null, procedural: true };
}

async function loadGltf(url, landmarks, lowTier) {
  const gltf = await new GLTFLoader().loadAsync(url);
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
  if (!mesh) throw new Error('no mesh in ' + url);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.attributes.normal) g.computeVertexNormals();
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const maps = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, normalScale: m.normalScale };
  if (lowTier) for (const k of ['map', 'normalMap', 'roughnessMap']) if (maps[k]) maps[k] = downsample(maps[k], 1024);
  g.setAttribute('aFat', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return { geometry: g, maps, landmarks: landmarks || estimateLandmarks(g), procedural: false };
}

function downsample(tex, size) {
  const img = tex.image;
  if (!img || Math.max(img.width, img.height) <= size) return tex;
  const k = size / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace; t.flipY = tex.flipY; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  return t;
}

// Without hand-placed landmarks: the lowest point is the apex, the vessels leave from the top.
function estimateLandmarks(g) {
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position, size = b.getSize(new THREE.Vector3());
  let apex = null, top = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (!apex || y < apex[1]) apex = [p.getX(i), y, p.getZ(i)];
    if (y > b.max.y - size.y * 0.12) top.push([p.getX(i), y, p.getZ(i)]);
  }
  const c = top.reduce((a, v) => [a[0] + v[0] / top.length, a[1] + v[1] / top.length, a[2] + v[2] / top.length], [0, 0, 0]);
  const centre = b.getCenter(new THREE.Vector3());
  const axis = new THREE.Vector3(centre.x - apex[0], centre.y - apex[1], centre.z - apex[2]).normalize().toArray();
  const av = [apex[0] + axis[0] * size.y * 0.62, apex[1] + axis[1] * size.y * 0.62, apex[2] + axis[2] * size.y * 0.62];
  const r = size.x * 0.06;
  const v = (dx, dy, dz, dir) => ({ point: [c[0] + dx * size.x, c[1] + dy * size.y, c[2] + dz * size.z], dir, radius: r });
  return {
    apex, avPlane: { point: av, normal: axis },
    aorta: v(-0.05, 0, 0, [0, 1, 0]), pulmonaryTrunk: v(0.12, -0.05, 0.1, [0.3, 1, 0]),
    svc: v(-0.25, -0.05, 0, [0, 1, 0]), ivc: { point: [c[0] - 0.25 * size.x, b.min.y + size.y * 0.35, c[2]], dir: [0, -1, 0], radius: r },
    pulmonaryVeins: [v(-0.25, -0.25, -0.3, [-1, 0, -0.5]), v(-0.25, -0.3, -0.3, [-1, -0.2, -0.5]), v(0.25, -0.25, -0.3, [1, 0, -0.5]), v(0.25, -0.3, -0.3, [1, -0.2, -0.5])],
    septumDir: [0.8, 0, -0.6],
  };
}

// Scale to one unit tall around the centre of the bounding box (a no-op for the baked heart).
function normalize(source) {
  const g = source.geometry;
  g.computeBoundingBox();
  const centre = g.boundingBox.getCenter(new THREE.Vector3());
  const s = 1 / (g.boundingBox.max.y - g.boundingBox.min.y);
  const width = (g.boundingBox.max.x - g.boundingBox.min.x) * s;
  g.translate(-centre.x, -centre.y, -centre.z);
  g.scale(s, s, s);
  return { ...source, landmarks: normalizeLandmarks(source.landmarks, centre.toArray(), s), width };
}

function buildHeart({ geometry: g, maps, landmarks: L, procedural }) {
  const V = (a) => new THREE.Vector3(...a);
  const apex = V(L.apex);
  const axis = V(L.avPlane.normal).normalize();
  const len = V(L.avPlane.point).sub(apex).dot(axis);
  const vessel = (v, swell) => {
    const end = V(v.point), dir = V(v.dir).normalize(), r = v.radius;
    const pts = v.path ? v.path.map(V) : [v.root ? V(v.root) : end.clone().addScaledVector(dir, -r * 3), end];
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push(new THREE.Line3(pts[i], pts[i + 1]));
    return { end, r, swell, segs };
  };
  const vessels = [vessel(L.aorta, 1), vessel(L.pulmonaryTrunk, 1), vessel(L.svc, 0), vessel(L.ivc, 0), ...L.pulmonaryVeins.map((v) => vessel(v, 0)), ...(L.arch || []).map((v) => vessel(v, 1))];
  const atria = (L.atria || [[-0.15, 0.12, 0], [0.05, 0.15, -0.15]]).map((p) => V(p));

  const pos = g.attributes.position, n = pos.count;
  const heartW = new Float32Array(n * 4), pivot = new Float32Array(n * 3);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3();
  const band = 0.06 / len;   // ±6% of the heart height, in units of h
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const h = q.copy(p).sub(apex).dot(axis) / len;
    const wV = 1 - smooth(1 - band, 1 + band, h);
    let wA = 1 - wV, wS = 0, best = Infinity;
    const piv = [0, 0, 0];
    for (const v of vessels) {
      let d = Infinity;
      for (const sg of v.segs) {
        sg.closestPointToPoint(p, true, c);
        const dc = c.distanceTo(p);
        if (dc < d) { d = dc; q.copy(c); }
      }
      wA *= smooth(v.r * 1.2, v.r * 2.0, d);
      if (v.swell && d < best) {
        best = d;
        const w = 1 - smooth(v.r * 1.0, v.r * 1.6, d);
        if (w > wS) { wS = w; q.toArray(piv); }
      }
    }
    if (wS === 0) {
      const a = atria.reduce((m, c) => (c.distanceTo(p) < m.distanceTo(p) ? c : m));
      a.toArray(piv);
    }
    heartW.set([h, wV, wA, wS], i * 4);
    pivot.set(piv, i * 3);
  }
  g.setAttribute('aHeart', new THREE.BufferAttribute(heartW, 4));
  g.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));

  const material = createHeartMaterial({ maps, procedural, apex, axis, len });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  const vesselRoots = {
    aorta: vessels[0], pulmonaryTrunk: vessels[1], svc: vessels[2], ivc: vessels[3],
    pulmonaryVeins: vessels.slice(4, 8),
  };
  return { mesh, material, apex, axis, len, vessels: vesselRoots };
}
