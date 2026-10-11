// Loads the segmented study heart (assets/heart-anatomy.glb + .json), gives every part its tissue material,
// and computes the beat weights so all the parts move as one continuous heart.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSharedUniforms, createTissueMaterial } from './heart-material.js';

export const CREDIT = {
  text: 'Heart: BodyParts3D © DBCLS, CC BY-SA 2.1 JP (adapted)',
  href: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/',
};

// Which tissue each part is made of.
const KIND = {
  'left-ventricle': 'ventricle', 'right-ventricle': 'ventricle', septum: 'ventricle',
  'right-atrium': 'atrium', 'left-atrium': 'atrium',
  'tricuspid-valve': 'valve', 'mitral-valve': 'valve', 'aortic-valve': 'valve', 'pulmonary-valve': 'valve',
  'papillary-muscles': 'papillary',
  aorta: 'artery', 'pulmonary-trunk': 'arteryBlue',
  'superior-vena-cava': 'vein', 'inferior-vena-cava': 'vein', 'pulmonary-veins': 'veinRed',
  'right-coronary': 'coronary', 'left-coronary': 'coronary', 'cardiac-veins': 'cardiacVein',
  'sa-node': 'node', 'av-node': 'node',
};
/** Parts whose cut face is heart muscle: a click on the cut shows the myocardium. */
export const WALL_PARTS = new Set(['left-ventricle', 'right-ventricle', 'septum', 'right-atrium', 'left-atrium']);

export async function loadHeart({ lowTier, clippingPlanes, onProgress, onInfo }) {
  const info = await fetchOk('assets/heart-anatomy.json', 'json');
  onInfo?.({ threadRoots: threadRoots(info.landmarks.threadRoots), parts: info.parts });
  const gltf = await loadWithRetry('assets/heart-anatomy.glb', onProgress);
  const L = info.landmarks;
  const V = (a) => new THREE.Vector3(...a);
  const apex = V(L.apex), axis = V(L.avPlane.normal).normalize();
  const len = V(L.avPlane.point).sub(apex).dot(axis);
  const shared = createSharedUniforms({ apex, axis, len });
  const weights = beatWeights(L, apex, axis, len);

  const group = new THREE.Group();
  const parts = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !KIND[o.name]) return;
    const g = dequantize(o.geometry, o.matrixWorld);
    weights(g);
    const kind = KIND[o.name];
    const material = createTissueMaterial(kind, shared, { lowTier, clippingPlanes });
    const mesh = new THREE.Mesh(g, material);
    mesh.name = o.name;
    mesh.frustumCulled = false;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    parts.set(o.name, { id: o.name, mesh, material, kind });
    group.add(mesh);
  });
  return { group, parts, shared, landmarks: L, chambers: info.chambers, partInfo: info.parts, mmPerUnit: info.mmPerUnit, threadRoots: threadRoots(L.threadRoots), credit: CREDIT };
}

// Quantised glTF attributes carry their scale in the node; bake it into plain float positions.
function dequantize(src, matrix) {
  const g = new THREE.BufferGeometry();
  const p = src.attributes.position, n = src.attributes.normal, c = src.attributes.color;
  const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix).toArray(pos, i * 3);
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize().toArray(nrm, i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (c) g.setAttribute('color', c);
  else g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(p.count * 4), 4, true));
  g.setIndex(src.index);
  return g;
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
async function loadWithRetry(url, onProgress) {
  const loader = new GLTFLoader();
  for (let attempt = 0; ; attempt++) {
    try {
      return await loader.loadAsync(url, (e) => onProgress?.(e.lengthComputable ? e.loaded / e.total : -1));
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((res) => setTimeout(res, 600));
    }
  }
}

/**
 * The beat moves every part with one continuous field of rest position, so separate meshes never open seams:
 * below the AV plane the ventricles squeeze, above it the atria, and the great arteries swell.
 */
function beatWeights(L, apex, axis, len) {
  const V = (a) => new THREE.Vector3(...a);
  const vessel = (v, swell) => {
    const pts = v.path.map(V);
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push(new THREE.Line3(pts[i], pts[i + 1]));
    return { r: v.radius, swell, segs };
  };
  const vessels = [vessel(L.aorta, 1), vessel(L.pulmonaryTrunk, 1), vessel(L.svc, 0), vessel(L.ivc, 0), ...L.pulmonaryVeins.map((v) => vessel(v, 0)), ...L.arch.map((v) => vessel(v, 1))];
  const atria = L.atria.map(V);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const band = 0.06;
  return (g) => {
    const pos = g.attributes.position, n = pos.count;
    const heartW = new Float32Array(n * 4), pivot = new Float32Array(n * 3);
    const p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      const h = q.copy(p).sub(apex).dot(axis) / len;
      const wV = 1 - smooth(1 - band, 1 + band, h);
      let wA = 1 - wV, wS = 0;
      const piv = [0, 0, 0];
      for (const v of vessels) {
        let d = Infinity;
        for (const sg of v.segs) {
          sg.closestPointToPoint(p, true, c);
          const dc = c.distanceTo(p);
          if (dc < d) { d = dc; q.copy(c); }
        }
        wA *= smooth(v.r * 1.2, v.r * 2.0, d);
        if (v.swell) {
          const w = 1 - smooth(v.r * 1.0, v.r * 1.6, d);
          if (w > wS) { wS = w; q.toArray(piv); }
        }
      }
      // Atrial motion fades out away from the atria (the arch branches stay still).
      const a = atria.reduce((m, at) => (at.distanceTo(p) < m.distanceTo(p) ? at : m));
      wA *= 1 - smooth(0.32, 0.5, a.distanceTo(p));
      if (wS === 0) a.toArray(piv);
      heartW.set([h, wV, wA, wS], i * 4);
      pivot.set(piv, i * 3);
    }
    g.setAttribute('aHeart', new THREE.BufferAttribute(heartW, 4));
    g.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
  };
}

/** Six thread roots at the cut ends of the great vessels, nudged just outside the cut. */
function threadRoots(list) {
  return list.map((v) => {
    const l = Math.hypot(...v.dir) || 1;
    const dir = v.dir.map((c) => c / l);
    return { pos: v.point.map((c, k) => c + dir[k] * 0.004), dir };
  });
}
