// The arena as a hand-made diorama, all procedural:
// Human half = a lush meadow with a stone castle (waving banners, flickering torches, a windmill, a stream),
// AI half = a neon tech plaza with a glowing server citadel (holo screens, cable trenches, a radar dish).
// The middle is where the two blend: broken floor tiles with grass pushing through.
// Static scenery is baked into a handful of vertex-coloured meshes to keep draw calls low.
import * as THREE from 'three';
import { toon, glowMat, additive, GEO, Baker, M4, TIME, GLOW } from './gfx.js';
import { ARENA } from './config.js';
import { mulberry32 } from './sim.js';
import { PAL } from './models.js';

const W = ARENA.halfW, Lh = ARENA.halfL, BZ = ARENA.baseZ;
const RIVER_X = 24.5;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z) { // cheap smooth-ish noise from layered sines
  return (Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) + Math.sin(z * 0.17 + Math.cos(x * 0.11) * 2) + Math.sin((x + z) * 0.37) * 0.5) / 2.5;
}

// ---------------- arena floor (painted canvas) ----------------
function floorTexture(maxAniso) {
  const FW = 36, FL = 72, k = 30;
  const c = document.createElement('canvas'); c.width = FW * k; c.height = FL * k;
  const g = c.getContext('2d');
  const X = (x) => (x + FW / 2) * k, Z = (z) => (z + FL / 2) * k;
  const R = mulberry32(7);
  // Human lawn
  g.fillStyle = '#86BB57'; g.fillRect(0, Z(-1), c.width, c.height);
  for (let z = 0; z < FL / 2; z += 4.25) { // mowing stripes
    g.fillStyle = (Math.round(z / 4.25) % 2) ? 'rgba(255,255,210,0.07)' : 'rgba(30,70,20,0.06)';
    g.fillRect(0, Z(z), c.width, 4.25 * k);
  }
  for (let i = 0; i < 1600; i++) { // clumps
    const x = R() * c.width, y = Z(-1) + R() * (c.height - Z(-1));
    g.fillStyle = R() < 0.5 ? 'rgba(60,110,40,0.16)' : 'rgba(190,225,120,0.14)';
    g.beginPath(); g.ellipse(x, y, 6 + R() * 26, 4 + R() * 14, R() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 26; i++) { // worn earth patches where the fighting happens
    const x = X((R() - 0.5) * 26), y = Z(3 + R() * 26);
    const rg = g.createRadialGradient(x, y, 0, x, y, 30 + R() * 50);
    rg.addColorStop(0, 'rgba(176,140,86,0.55)'); rg.addColorStop(1, 'rgba(176,140,86,0)');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, 90, 60, R() * 3, 0, 7); g.fill();
  }
  // a dirt road from the castle gate to the middle
  g.strokeStyle = 'rgba(196,160,104,0.85)'; g.lineCap = 'round'; g.lineWidth = 3.4 * k;
  g.beginPath(); g.moveTo(X(0), Z(BZ - 4)); g.bezierCurveTo(X(-3), Z(20), X(3), Z(10), X(0), Z(2)); g.stroke();
  g.strokeStyle = 'rgba(150,118,72,0.35)'; g.lineWidth = 0.25 * k; g.setLineDash([10, 16]);
  g.beginPath(); g.moveTo(X(-0.9), Z(BZ - 4)); g.bezierCurveTo(X(-3.9), Z(20), X(2.1), Z(10), X(-0.9), Z(2)); g.stroke();
  g.beginPath(); g.moveTo(X(0.9), Z(BZ - 4)); g.bezierCurveTo(X(-2.1), Z(20), X(3.9), Z(10), X(0.9), Z(2)); g.stroke();
  g.setLineDash([]);
  for (let i = 0; i < 260; i++) { // tiny flowers and pebbles
    const x = R() * c.width, y = Z(1) + R() * (c.height - Z(1));
    g.fillStyle = ['#FFFFFF', '#FFE36B', '#FF9EC1', '#B9A7FF', '#9B8F7E'][(R() * 5) | 0];
    g.beginPath(); g.arc(x, y, 1.5 + R() * 2.5, 0, 7); g.fill();
  }
  // AI plaza tiles
  const T = 4.25;
  g.fillStyle = '#2E3B49'; g.fillRect(0, 0, c.width, Z(1.5));
  { const lg = g.createLinearGradient(0, Z(-7), 0, Z(1.5)); lg.addColorStop(0, '#2E3B49'); lg.addColorStop(0.55, '#4F6A45'); lg.addColorStop(1, '#86BB57');
    g.fillStyle = lg; g.fillRect(0, Z(-7), c.width, Z(1.5) - Z(-7)); }
  for (let x = -FW / 2; x < FW / 2; x += T) {
    for (let z = -FL / 2; z < 1.5; z += T) {
      const blend = smooth(-7, 1.5, z); // tiles break up near the middle
      if (R() < blend * 0.85) continue;
      const lit = 0.9 + R() * 0.2;
      const px = X(x) + 3, py = Z(z) + 3, s = T * k - 6;
      g.fillStyle = `rgb(${(70 * lit) | 0},${(86 * lit) | 0},${(102 * lit) | 0})`; g.fillRect(px, py, s, s);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(px, py, s, 4); g.fillRect(px, py, 4, s);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(px, py + s - 4, s, 4); g.fillRect(px + s - 4, py, 4, s);
      if (R() < 0.3) { g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(px + s * 0.2, py + s * 0.2, s * 0.6, s * 0.6); }
      if (R() < 0.12) { g.fillStyle = 'rgba(123,255,238,0.5)'; g.fillRect(px + s * 0.1, py + s * 0.45, s * 0.8, 3); }
    }
  }
  // grass creeping over the broken tiles in the middle: lots of little tufts, thicker toward the lawn
  for (let i = 0; i < 5200; i++) {
    const z = -7 + R() * 9;
    if (R() > Math.pow(smooth(-7, 1.5, z), 1.6)) continue;
    const x = R() * c.width, y = Z(z);
    g.fillStyle = ['#7FB552', '#8CC05C', '#6FA348', '#97C866'][(R() * 4) | 0];
    g.beginPath(); g.ellipse(x, y, 2 + R() * 5, 1.5 + R() * 3.5, R() * 3, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(30,40,30,0.25)'; // little gaps between tiles where the earth shows
  for (let i = 0; i < 120; i++) { const x = R() * c.width, y = Z(-6 + R() * 6); g.fillRect(x, y, 2 + R() * 16, 2 + R() * 3); }
  // circuit traces
  g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    let x = -W + 1 + R() * (2 * W - 2), z = -Lh + 1 + R() * (Lh - 6);
    g.strokeStyle = 'rgba(80,250,230,0.55)';
    g.beginPath(); g.moveTo(X(x), Z(z));
    for (let s = 0; s < 4; s++) { if (R() < 0.5) x += (R() - 0.5) * 8; else z += (R() - 0.5) * 8; x = Math.max(-W + 0.5, Math.min(W - 0.5, x)); z = Math.max(-Lh + 0.5, Math.min(-3, z)); g.lineTo(X(x), Z(z)); }
    g.stroke();
    g.fillStyle = 'rgba(160,255,245,0.9)'; g.beginPath(); g.arc(X(x), Z(z), 5, 0, 7); g.fill();
  }
  // contested zone: a soft golden ring where the two worlds meet
  g.strokeStyle = 'rgba(255,236,190,0.55)'; g.lineWidth = 6;
  g.beginPath(); g.arc(X(0), Z(0), 5 * k, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(255,236,190,0.25)'; g.lineWidth = 3; g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(X(-W), Z(0)); g.lineTo(X(W), Z(0)); g.stroke(); g.setLineDash([]);
  // base zones
  for (const [z, col] of [[BZ, '255,170,100'], [-BZ, '90,240,225']]) {
    const rg = g.createRadialGradient(X(0), Z(z), 4 * k, X(0), Z(z), 10 * k);
    rg.addColorStop(0, `rgba(${col},0.0)`); rg.addColorStop(0.8, `rgba(${col},0.22)`); rg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = rg; g.fillRect(X(-12), Z(z - 11), 24 * k, 22 * k);
  }
  // soft contact shadow along the walls
  for (const sx of [-1, 1]) {
    const lg = g.createLinearGradient(X(sx * W), 0, X(sx * (W - 1.6)), 0);
    lg.addColorStop(0, 'rgba(20,24,20,0.35)'); lg.addColorStop(1, 'rgba(20,24,20,0)');
    g.fillStyle = lg; g.fillRect(Math.min(X(sx * W), X(sx * (W - 1.6))), 0, 1.6 * k, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
  return tex;
}

// ---------------- terrain around the arena ----------------
function terrainHeight(x, z) {
  const ax = Math.abs(x);
  if (ax < W + 2.2 && Math.abs(z) < Lh + 2.2) return 0;
  // AI half is a flat plaza; the human half rolls into soft hills
  const human = smooth(-6, 4, z);
  let h = (vnoise(x * 0.8, z * 0.8) * 0.9 + 0.5) * smooth(W + 2, W + 14, Math.max(ax, Math.abs(z) - Lh + W)) * 2.2 * human;
  // stream bed on both long sides
  const dr = Math.abs(ax - RIVER_X);
  h = h * smooth(2.4, 6, dr) - (1 - smooth(1.6, 3.2, dr)) * 1.0;
  return h;
}
function buildTerrain(scene) {
  const geo = new THREE.PlaneGeometry(260, 260, 120, 120).rotateX(-Math.PI / 2);
  const p = geo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = terrainHeight(x, z);
    const inRect = Math.abs(x) < W + 2.3 && Math.abs(z) < Lh + 2.3;
    p.setY(i, h - 0.04 - (inRect ? 0 : (1 - smooth(-9, 2, z)) * 0.45)); // plaza ground sits under the floor tiles
    const n = vnoise(x * 1.7, z * 1.7);
    const human = smooth(-7, 2, z);
    c.setRGB(0.47 + n * 0.06, 0.70 + n * 0.07, 0.31 + n * 0.04, THREE.SRGBColorSpace); // meadow
    if (h > 0.6) c.lerp(c2.setRGB(0.62, 0.76, 0.36, THREE.SRGBColorSpace), Math.min(1, (h - 0.6) * 0.5));
    const dr = Math.abs(Math.abs(x) - RIVER_X);
    if (dr < 3.4) c.lerp(c2.setRGB(0.83, 0.74, 0.55, THREE.SRGBColorSpace), 1 - smooth(2.2, 3.4, dr)); // sandy banks
    c2.setRGB(0.15 + n * 0.02, 0.19 + n * 0.02, 0.24 + n * 0.03, THREE.SRGBColorSpace); // plaza underlay
    c.lerp(c2, 1 - human);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, toon(0xffffff, 0, { vertexColors: true }));
  m.receiveShadow = true;
  scene.add(m);
}

// ---------------- water ----------------
function buildWater(scene) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: TIME },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float side = sign(vW.x); float d = abs(abs(vW.x) - ${RIVER_X.toFixed(1)});
        float tech = 1.0 - smoothstep(-8.0, 2.0, vW.z);
        vec2 q = vec2(vW.x * 1.3, vW.z * 0.45 + uTime * 1.4 * side);
        float f = n(q * 1.7) * 0.6 + n(q * 4.1 + 3.0) * 0.4;
        vec3 deep = mix(vec3(0.10, 0.42, 0.55), vec3(0.03, 0.14, 0.22), tech);
        vec3 shallow = mix(vec3(0.36, 0.78, 0.80), vec3(0.04, 0.24, 0.30), tech);
        vec3 col = mix(deep, shallow, smoothstep(0.4, 2.4, d));
        float streak = smoothstep(0.72, 0.9, f);
        col += vec3(0.9, 0.97, 1.0) * streak * 0.55 * (1.0 - tech);
        col += vec3(0.3, 1.6, 1.5) * streak * 1.1 * tech; // the coolant canal glows
        float edge = smoothstep(1.5, 2.3, d);
        col = mix(col, vec3(0.95, 0.98, 1.0), edge * 0.5 * (1.0 - tech));
        col = mix(col, vec3(0.2, 0.9, 0.85), edge * 0.35 * tech);
        gl_FragColor = vec4(col, 0.86 - edge * 0.4);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 240, 1, 1).rotateX(-Math.PI / 2), mat);
    m.position.set(sx * RIVER_X, -0.42, 0);
    m.renderOrder = 1;
    scene.add(m);
  }
}

// ---------------- instanced grass + flowers ----------------
function grassGeometry() {
  const P = [], C = [], A = [];
  const GB = new THREE.Color(0x3F7A2C).toArray(), GT = new THREE.Color(0xA6D46A).toArray();
  const R = mulberry32(3);
  for (let b = 0; b < 5; b++) {
    const a = R() * Math.PI * 2, r = R() * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 0.05 + R() * 0.04, h = 0.18 + R() * 0.24, lean = (R() - 0.5) * 0.35, ry = R() * Math.PI;
    const cx = Math.cos(ry) * w, cz = Math.sin(ry) * w;
    P.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + lean, h, z + lean * 0.5);
    C.push(...GB, ...GB, ...GT);
    A.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aw', new THREE.Float32BufferAttribute(A, 1));
  g.computeVertexNormals();
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); // lit like the ground
  return g;
}
function grassSpot(R, human) {
  for (let tries = 0; tries < 12; tries++) {
    const x = (R() - 0.5) * 84, z = human ? -6 + R() * 54 : -6 + R() * 8;
    const ax = Math.abs(x);
    if (ax < W + 0.9 && Math.abs(z) < Lh + 0.9) {
      // inside the arena: only a fringe along the walls and in the cracked middle
      if (!(ax > W - 1.4 && z > -3) && !(Math.abs(z) < 4 && R() < 0.4)) continue;
    }
    if (Math.abs(ax - RIVER_X) < 2.6) continue;
    if (Math.hypot(x, z - BZ) < 7.5) continue;
    if (z < -2 && R() > smooth(-6, 2, z)) continue;
    return { x, z };
  }
  return null;
}
function buildGrass(scene, detail) {
  const R = mulberry32(21);
  const N = Math.round(10000 * detail);
  const geo = grassGeometry();
  const mat = toon(0xffffff, 0, { vertexColors: true, side: THREE.DoubleSide, sway: [0.16, 2.2] });
  const im = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  let n = 0;
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  for (let i = 0; i < N; i++) {
    const s = grassSpot(R, true); if (!s) continue;
    const sc = 0.8 + R() * 0.8;
    M4(s.x, terrainHeight(s.x, s.z) - 0.02, s.z, [sc, sc * (0.8 + R() * 0.6), sc], [0, R() * 6, 0], m);
    im.setMatrixAt(n, m);
    const v = 0.85 + vnoise(s.x * 2, s.z * 2) * 0.15 + R() * 0.1;
    im.setColorAt(n, col.setRGB(v, v * (0.98 + R() * 0.06), v * 0.9, THREE.SRGBColorSpace));
    n++;
  }
  im.count = n; im.receiveShadow = true; im.castShadow = false;
  scene.add(im);
  // flowers: little blossoms on stems that sway with the grass
  const F = Math.round(1100 * detail);
  const fb = new Baker();
  fb.add(new THREE.ConeGeometry(0.5, 1, 3, 1, true), 0x4E8A34, M4(0, 0.15, 0, [0.04, 0.3, 0.04], [Math.PI, 0, 0]), { aw: 0.4 });
  fb.add(GEO.ico, 0xffffff, M4(0, 0.32, 0, [0.22, 0.1, 0.22]), { aw: 1 });
  fb.add(GEO.octa, 0xFFE070, M4(0, 0.36, 0, [0.08, 0.06, 0.08]), { aw: 1 });
  const fim = new THREE.InstancedMesh(fb.geometry(), toon(0xffffff, 0.15, { vertexColors: true, sway: [0.14, 2.2] }), F);
  fim.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(F * 3), 3);
  const FC = [0xFFFFFF, 0xFF8FB8, 0xFFD34D, 0xB79CFF, 0xFF6F61, 0x8FD3FF];
  let fn = 0;
  for (let i = 0; i < F; i++) {
    const s = grassSpot(R, true); if (!s) continue;
    if (Math.abs(s.x) < W + 0.9 && Math.abs(s.z) < Lh + 0.9 && R() < 0.7) continue;
    const sc = 0.8 + R() * 0.7;
    fim.setMatrixAt(fn, M4(s.x, terrainHeight(s.x, s.z), s.z, sc, [0, R() * 6, 0], m));
    fim.setColorAt(fn, col.setHex(FC[(R() * FC.length) | 0]));
    fn++;
  }
  fim.count = fn; fim.receiveShadow = true;
  scene.add(fim);
}

// ---------------- AI plaza tiles outside the arena ----------------
function buildPlaza(scene, B, G, S) {
  const R = mulberry32(31);
  const T = 4.25;
  const tiles = [];
  for (let x = -70; x < 70; x += T) {
    for (let z = -90; z < 4; z += T) {
      const cx = x + T / 2, cz = z + T / 2;
      if (Math.abs(cx) < W + 2.5 && Math.abs(cz) < Lh + 2.5) continue;
      if (Math.abs(Math.abs(cx) - RIVER_X) < 3.4) continue;
      const blend = smooth(-9, 2, cz);
      if (R() < blend) continue;
      const tilt = blend > 0.2 ? (R() - 0.5) * 0.18 : 0;
      tiles.push({ x: cx, z: cz, y: -0.12 + (blend > 0.2 ? R() * 0.1 : 0), tilt, v: 0.85 + R() * 0.25 });
    }
  }
  // a walkway strip between the arena wall and the canal
  for (const sx of [-1, 1]) for (let z = -Lh - 2; z < 2; z += T) {
    const blend = smooth(-9, 2, z + T / 2);
    if (R() < blend) continue;
    tiles.push({ x: sx * (W + 2.45), z: z + T / 2, y: -0.12, tilt: 0, v: 0.8 + R() * 0.2, w: 3.3 });
  }
  const im = new THREE.InstancedMesh(GEO.rboxS, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.15 }), tiles.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  tiles.forEach((t, i) => {
    im.setMatrixAt(i, M4(t.x, t.y, t.z, [t.w || T - 0.18, 0.3, T - 0.18], [t.tilt, 0, t.tilt * 0.6], m));
    im.setColorAt(i, c.setRGB(0.24 * t.v, 0.29 * t.v, 0.35 * t.v, THREE.SRGBColorSpace));
  });
  im.receiveShadow = true;
  scene.add(im);
  // glowing grid seams beneath the tiles
  const gmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2BD9C6).multiplyScalar(0.55) });
  const gx = [-70, -RIVER_X - 3.7, -W - 0.2, W + 0.2, RIVER_X + 3.7, 70]; // only under tiled ground, not the canals
  for (let i = 0; i < gx.length; i += 2) {
    const w = gx[i + 1] - gx[i];
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, 94).rotateX(-Math.PI / 2), gmat);
    glow.position.set((gx[i] + gx[i + 1]) / 2, -0.2, -43);
    scene.add(glow);
  }
  // cable trenches with travelling light pulses, running from the plaza edge toward the citadel
  const trench = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float p = fract(vUv.y * 6.0 - uTime * 0.9); float pulse = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.08, 0.35, p));
        float core = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5));
        vec3 c = vec3(0.04, 0.07, 0.09) + vec3(0.2, 2.6, 2.3) * pulse * core + vec3(0.05, 0.3, 0.28) * core;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const [x, z0, z1] of [[-W - 4.5, -8, -70], [W + 4.5, -8, -70], [-W - 9, -12, -64], [W + 9, -12, -64]]) {
    const L = Math.abs(z1 - z0);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.9, L).rotateX(-Math.PI / 2), trench);
    t.position.set(x, 0.205, (z0 + z1) / 2);
    scene.add(t);
    B.add(GEO.box, 0x1B242C, M4(x - 0.55, 0.12, (z0 + z1) / 2, [0.2, 0.2, L]));
    B.add(GEO.box, 0x1B242C, M4(x + 0.55, 0.12, (z0 + z1) / 2, [0.2, 0.2, L]));
  }
  void G; void S;
}

// ---------------- scenery: trees, rocks, props ----------------
function tree(F, B, x, z, s, R) {
  const y = terrainHeight(x, z);
  B.add(GEO.taper, 0x7A5131, M4(x, y + 1.0 * s, z, [0.42 * s, 2.1 * s, 0.42 * s]), { jitter: 0.15 });
  const greens = [0x5FA548, 0x6DB552, 0x4F9440, 0x7BC25C];
  const g0 = greens[(R() * 4) | 0];
  const blobs = [[0, 2.8, 0, 2.6], [0.8, 2.4, 0.3, 1.8], [-0.7, 2.5, -0.2, 1.9], [0.1, 3.6, -0.1, 1.9], [-0.3, 2.3, 0.8, 1.6]];
  for (const [bx, by, bz, bs] of blobs) {
    F.add(GEO.blob, g0, M4(x + bx * s, y + by * s, z + bz * s, bs * s * (0.9 + R() * 0.2), [R() * 3, R() * 3, 0]),
      { aw: 'y', awScale: 0.6 + by * 0.12, jitter: 0.22, shade: 0.35, shadeY0: y + (by - bs / 2) * s, shadeH: bs * s });
  }
}
function pine(F, B, x, z, s) {
  const y = terrainHeight(x, z);
  B.add(GEO.cylLo, 0x6A4428, M4(x, y + 0.6 * s, z, [0.3 * s, 1.2 * s, 0.3 * s]));
  for (let i = 0; i < 3; i++) F.add(GEO.cone, i === 2 ? 0x5B9E58 : 0x3F8A4E, M4(x, y + (1.6 + i * 1.05) * s, z, [(2.4 - i * 0.55) * s, 1.8 * s, (2.4 - i * 0.55) * s]), { aw: 'y', awScale: 0.3 + i * 0.25, jitter: 0.15 });
}
function rock(B, x, z, s, R, moss = true) {
  const y = terrainHeight(x, z);
  B.add(GEO.blob, 0xB2A895, M4(x, y + 0.25 * s, z, [1.4 * s, 0.9 * s, 1.2 * s], [R() * 0.3, R() * 6, R() * 0.3]), { flat: true, jitter: 0.25 });
  if (moss) B.add(GEO.blob, 0x7FAE4F, M4(x, y + 0.62 * s, z, [1.0 * s, 0.25 * s, 0.85 * s], [0, R() * 6, 0]), { flat: true, jitter: 0.2 });
}
function buildScenery(scene, B, F, G, S, detail) {
  const R = mulberry32(11);
  const nearOK = (x, z) => Math.abs(Math.abs(x) - RIVER_X) > 3.6 && !(Math.abs(x) < W + 3 && Math.abs(z) < Lh + 3);
  // Human meadow: trees farther out, bushes and rocks closer in
  for (let i = 0; i < Math.round(95 * (0.5 + detail * 0.5)); i++) {
    const side = R() < 0.5 ? -1 : 1;
    let x = side * (W + 4 + R() * 45), z = 2 + R() * 66;
    if (R() < 0.3) { x = (R() - 0.5) * 60; z = Lh + 6 + R() * 26; }
    if (!nearOK(x, z)) continue;
    const far = Math.abs(x) > 30 || z > Lh + 6;
    const s = 0.75 + R() * 0.65;
    if (far && R() < 0.75) { if (R() < 0.7) tree(F, B, x, z, s, R); else pine(F, B, x, z, s * 1.1); }
    else if (R() < 0.55) {
      const y = terrainHeight(x, z);
      for (let k = 0; k < 3; k++) F.add(GEO.blob, k ? 0x6FB357 : 0x5E9F4A, M4(x + (R() - 0.5) * 1.6 * s, y + 0.45 * s, z + (R() - 0.5) * 1.2 * s, (1 + R() * 0.6) * s), { aw: 'y', awScale: 0.25, jitter: 0.2 });
      if (R() < 0.5) for (let k = 0; k < 4; k++) F.add(GEO.sphereLo, [0xFFE6F0, 0xFFE870, 0xFF9AA8][k % 3], M4(x + (R() - 0.5) * 1.6 * s, y + 0.95 * s, z + (R() - 0.5) * 1.4 * s, 0.2), { aw: 0.25 });
    } else rock(B, x, z, s, R);
  }
  // reeds and stepping stones along the stream (human half)
  for (let i = 0; i < 70; i++) {
    const side = R() < 0.5 ? -1 : 1, z = 1 + R() * 60, x = side * (RIVER_X + (R() < 0.5 ? -1 : 1) * (2.2 + R() * 0.8));
    const y = terrainHeight(x, z);
    for (let k = 0; k < 3; k++) F.add(GEO.cylLo, 0x6E9F45, M4(x + (R() - 0.5) * 0.5, y + 0.5, z + (R() - 0.5) * 0.5, [0.06, 1 + R() * 0.6, 0.06], [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3]), { aw: 'y', awScale: 0.5 });
    if (R() < 0.3) F.add(GEO.capLimb, 0x6B4A2A, M4(x, y + 1.4, z, [0.1, 0.25, 0.1]), { aw: 0.4 });
  }
  // a wooden bridge over each stream
  for (const sx of [-1, 1]) {
    const x0 = sx * RIVER_X, z = 14;
    for (let k = -4; k <= 4; k++) B.add(GEO.box, k % 2 ? 0xA06C3C : 0x8C5C30, M4(x0 + k * 0.62, 0.32 - Math.abs(k) * 0.03 + 0.25, z, [0.58, 0.14, 2.6]), { jitter: 0.12 });
    for (const dz of [-1.25, 1.25]) {
      B.add(GEO.box, 0x6E4A26, M4(x0, 1.05, z + dz, [5.8, 0.12, 0.12]));
      for (let k = -2; k <= 2; k++) B.add(GEO.cylLo, 0x6E4A26, M4(x0 + k * 1.3, 0.75, z + dz, [0.14, 0.9, 0.14]));
    }
  }
  // hay bales, barrels and a cart near the castle
  for (const [x, z] of [[-9, 39], [10, 41], [13.5, 36.5], [-14, 43], [-24, 6], [22, 4.5]]) {
    const y = terrainHeight(x, z);
    B.add(GEO.cyl, 0xE8C76A, M4(x, y + 0.7, z, [1.4, 1.5, 1.4], [0, 0, Math.PI / 2]), { jitter: 0.12 });
    B.add(GEO.cyl, 0xC9A24F, M4(x, y + 0.7, z, [1.42, 0.08, 1.42], [0, 0, Math.PI / 2]));
  }
  for (const [x, z] of [[7.5, 38], [8.3, 38.7], [-7.6, 37.8], [21.5, 10], [-21.6, 18]]) {
    const y = terrainHeight(x, z);
    B.add(GEO.cyl, 0x9A6233, M4(x, y + 0.5, z, [0.8, 1, 0.8]), { jitter: 0.1 });
    B.add(GEO.cyl, 0x4A4A4A, M4(x, y + 0.85, z, [0.84, 0.07, 0.84]));
    B.add(GEO.cyl, 0x4A4A4A, M4(x, y + 0.15, z, [0.84, 0.07, 0.84]));
  }

  // AI plaza: server racks, pylons with lights and holo kiosks
  for (let i = 0; i < Math.round(70 * (0.5 + detail * 0.5)); i++) {
    const side = R() < 0.5 ? -1 : 1;
    let x = side * (W + 5 + R() * 45), z = -6 - R() * 64;
    if (R() < 0.3) { x = (R() - 0.5) * 60; z = -Lh - 6 - R() * 26; }
    if (!nearOK(x, z)) continue;
    const far = Math.abs(x) > 30 || z < -Lh - 6;
    if (far) {
      const h = 3 + R() * 9;
      S.add(GEO.rbox, R() < 0.5 ? 0x26323D : 0x2F3D49, M4(x, h / 2, z, [2.2, h, 2.2]));
      for (let k = 0; k < Math.floor(h / 1.2); k++) {
        const y = 0.8 + k * 1.15;
        G.add(GEO.box, R() < 0.8 ? 0x6FFFEA : 0xFFB070, M4(x + 1.11 * Math.sign(-x || 1), y, z, [0.04, 0.12, 1.4]), { boost: GLOW * 0.8 });
        G.add(GEO.box, R() < 0.85 ? 0x6FFFEA : 0x8FA8FF, M4(x, y, z + 1.11, [1.4, 0.12, 0.04]), { boost: GLOW * 0.8 });
      }
      G.add(GEO.sphereLo, 0xFF5A5A, M4(x, h + 0.2, z, 0.22), { boost: GLOW });
    } else if (R() < 0.6) {
      // a short rack of servers
      const n = 2 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const zz = z + k * 1.3;
        S.add(GEO.rboxS, 0x2A3641, M4(x, 1.0, zz, [1.1, 2.0, 1.2]));
        for (let l = 0; l < 5; l++) G.add(GEO.box, [0x6FFFEA, 0x6FFFEA, 0x9FFF8A, 0xFFB070][(R() * 4) | 0], M4(x + 0.56 * Math.sign(-x), 0.4 + l * 0.32, zz + (R() - 0.5) * 0.6, [0.03, 0.05, 0.12]), { boost: GLOW });
      }
    } else {
      // light pylon
      S.add(GEO.cyl, 0x2F3B46, M4(x, 1.5, z, [0.35, 3, 0.35]));
      G.add(GEO.sphere, 0x7BFFEE, M4(x, 3.2, z, 0.45), { boost: GLOW * 0.9 });
      S.add(GEO.cyl, 0x2F3B46, M4(x, 0.1, z, [1.0, 0.2, 1.0]));
    }
  }
  // the canal on the AI half gets straight concrete walls with glowing edges
  for (const sx of [-1, 1]) for (const dx of [-2.75, 2.75]) {
    S.add(GEO.box, 0x3A4855, M4(sx * RIVER_X + dx, -0.15, -40, [0.5, 0.9, 80]));
    G.add(GEO.box, 0x6FFFEA, M4(sx * RIVER_X + dx, 0.31, -40, [0.1, 0.04, 80]), { boost: GLOW * 0.5 });
  }

  // arena walls: wooden palisade on the human half, metal barrier on the AI half
  for (const sx of [-1, 1]) {
    for (let z = 0.8; z <= Lh + 0.3; z += 0.75) {
      const h = 1.1 + Math.sin(z * 7.1) * 0.12;
      B.add(GEO.cylLo, 0x9B6A3A, M4(sx * (W + 0.45), h / 2, z, [0.36, h, 0.36]), { jitter: 0.15 });
      B.add(GEO.cone, 0xB98A55, M4(sx * (W + 0.45), h + 0.15, z, [0.36, 0.32, 0.36]));
    }
    B.add(GEO.box, 0x7A5131, M4(sx * (W + 0.2), 0.75, Lh / 2, [0.14, 0.16, Lh]));
    B.add(GEO.box, 0x7A5131, M4(sx * (W + 0.2), 0.4, Lh / 2, [0.14, 0.16, Lh]));
    S.add(GEO.rbox, 0x3B4955, M4(sx * (W + 0.45), 0.5, -Lh / 2 - 0.2, [0.55, 1.0, Lh + 0.4]));
    G.add(GEO.box, 0x6FFFEA, M4(sx * (W + 0.45) - sx * 0.29, 0.72, -Lh / 2, [0.04, 0.09, Lh]), { boost: GLOW });
    G.add(GEO.box, 0x6FFFEA, M4(sx * (W + 0.45), 1.02, -Lh / 2, [0.08, 0.03, Lh]), { boost: GLOW * 0.45 });
  }
  for (let x = -W; x <= W; x += 0.75) {
    const h = 1.1 + Math.sin(x * 5.3) * 0.12;
    B.add(GEO.cylLo, 0x9B6A3A, M4(x, h / 2, Lh + 0.45, [0.36, h, 0.36]), { jitter: 0.15 });
    B.add(GEO.cone, 0xB98A55, M4(x, h + 0.15, Lh + 0.45, [0.36, 0.32, 0.36]));
  }
  S.add(GEO.rbox, 0x3B4955, M4(0, 0.5, -Lh - 0.45, [2 * W + 1.4, 1, 0.55]));
  G.add(GEO.box, 0x6FFFEA, M4(0, 0.72, -Lh - 0.16, [2 * W, 0.09, 0.04]), { boost: GLOW });
  void scene;
}

function buildCover(B, F, G, S, cover) {
  const R = mulberry32(5);
  for (const c of cover) {
    const human = c.z > 0;
    if (c.k === 'rock') {
      if (human) {
        B.add(GEO.blob, 0xB8AE9B, M4(c.x, c.r * 0.5, c.z, [c.r * 2.1, c.r * 1.5, c.r * 1.9], [R() * 0.3, R() * 6, 0]), { flat: true, jitter: 0.25 });
        B.add(GEO.blob, 0xA89E8A, M4(c.x - c.r * 0.5, c.r * 0.9, c.z + c.r * 0.3, [c.r * 1.2, c.r * 1.1, c.r * 1.1], [R(), R() * 6, 0]), { flat: true, jitter: 0.25 });
        B.add(GEO.blob, 0x7FAE4F, M4(c.x + c.r * 0.2, c.r * 1.15, c.z - c.r * 0.1, [c.r * 0.7, c.r * 0.22, c.r * 0.6], [0, R() * 6, 0.2]), { flat: true, jitter: 0.2 });
        B.add(GEO.blob, 0xA2977F, M4(c.x + c.r * 0.9, 0.3, c.z - c.r * 0.6, [0.9, 0.65, 0.8], [0, R() * 6, 0]), { flat: true, jitter: 0.2 });
        for (let k = 0; k < 4; k++) F.add(GEO.blob, 0x6FB357, M4(c.x + (R() - 0.5) * c.r * 2.4, 0.25, c.z + (R() - 0.5) * c.r * 2.4, 0.5 + R() * 0.3), { aw: 'y', awScale: 0.2 });
      } else {
        S.add(GEO.cyl, 0x2B3640, M4(c.x, 0.15, c.z, [c.r * 2.2, 0.3, c.r * 2.2]));
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + R();
          const m = M4(c.x + Math.cos(a) * c.r * 0.42, c.r * 0.85, c.z + Math.sin(a) * c.r * 0.42, [c.r * 0.85, c.r * (1.7 + R()), c.r * 0.85], [Math.cos(a) * 0.3, R() * 3, Math.sin(a) * 0.3]);
          G.add(GEO.octa, i === 0 ? 0x5FF5E2 : 0x2BC4B5, m, { boost: 1.05, flat: true });
        }
      }
    } else {
      const s = c.r * 1.55;
      if (human) {
        const rot = [0, 0.3, 0];
        B.add(GEO.box, 0xC08A4A, M4(c.x, s / 2, c.z, s, rot), { jitter: 0.12 });
        for (const dy of [-0.38, 0, 0.38]) B.add(GEO.box, 0x8C5E2E, M4(c.x, s / 2 + dy * s, c.z, [s * 1.02, s * 0.08, s * 1.02], rot));
        B.add(GEO.box, 0x6E4A26, M4(c.x, s / 2, c.z, [s * 1.03, s * 1.03, s * 0.12], [0, 0.3, 0.78]));
        B.add(GEO.box, 0x6E4A26, M4(c.x, s / 2, c.z, [s * 0.12, s * 1.03, s * 1.03], [0.78, 0.3, 0]));
      } else {
        const rot = [0, -0.3, 0];
        S.add(GEO.rbox, 0x34424F, M4(c.x, s / 2, c.z, s, rot));
        S.add(GEO.rboxS, 0x17A398, M4(c.x, s * 1.0, c.z, [s * 0.7, s * 0.08, s * 0.7], rot));
        G.add(GEO.box, 0x6FFFEA, M4(c.x, s * 0.72, c.z, [s * 1.02, 0.08, s * 1.02], rot), { boost: GLOW });
        G.add(GEO.box, 0xFFB070, M4(c.x, s * 0.35, c.z, [s * 1.02, 0.05, s * 0.3], rot), { boost: GLOW * 0.8 });
      }
    }
  }
}

// ---------------- the castle ----------------
function buildCastle(B, F, G, C, S) {
  const z0 = BZ + 0.6;
  const stone = 0xD8CCB4, stoneD = 0xB5A68B, roof = PAL.hTeam, wood = 0x7A5131, dark = 0x2A2018;
  const st = { jitter: 0.16, cell: 0.55 };
  B.add(GEO.cyl, stoneD, M4(0, 0.3, z0, [12, 0.6, 10.5]), st);
  // keep
  B.add(GEO.box, stone, M4(0, 3.6, z0 + 1.2, [5.4, 6.0, 4.4]), st);
  for (let i = -2; i <= 2; i++) for (const dz of [-1.0, 3.4]) B.add(GEO.box, stone, M4(i * 1.15, 6.9, z0 + dz, [0.62, 0.7, 0.5]), st);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) B.add(GEO.box, stone, M4(sx * 2.45, 6.9, z0 + 0.1 + i * 1.15, [0.5, 0.7, 0.62]), st);
  B.add(GEO.wedge, roof, M4(0, 8.4, z0 + 1.2, [5.0, 2.6, 4.0]), { jitter: 0.08, cell: 0.4 });
  for (const sx of [-1, 1]) B.add(GEO.box, dark, M4(sx * 1.3, 4.8, z0 - 1.02, [0.42, 0.9, 0.08]));
  B.add(GEO.cyl, dark, M4(0, 5.0, z0 - 1.02, [0.9, 0.08, 0.9], [Math.PI / 2, 0, 0]));
  // towers
  const towers = [[-4.1, z0 - 1.6, 7.2], [4.1, z0 - 1.6, 7.2], [-3.6, z0 + 3.4, 6.2], [3.6, z0 + 3.4, 6.2]];
  for (const [x, z, h] of towers) {
    B.add(GEO.cyl, stone, M4(x, h / 2, z, [2.6, h, 2.6]), st);
    B.add(GEO.cyl, stoneD, M4(x, h + 0.25, z, [3.05, 0.5, 3.05]), st);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; B.add(GEO.box, stoneD, M4(x + Math.cos(a) * 1.35, h + 0.75, z + Math.sin(a) * 1.35, [0.42, 0.55, 0.42], [0, -a, 0]), st); }
    B.add(GEO.cone, roof, M4(x, h + 2.3, z, [3.1, 3.2, 3.1]), { jitter: 0.08, cell: 0.35 });
    G.add(GEO.sphereLo, 0xFFD27A, M4(x, h + 4.05, z, 0.32), { boost: 1.3 });
    B.add(GEO.box, dark, M4(x, h * 0.62, z - 1.28, [0.36, 0.8, 0.1]));
    G.add(GEO.box, 0xFFC27A, M4(x, h * 0.62, z - 1.31, [0.24, 0.62, 0.04]), { boost: GLOW * 0.5 });
  }
  // curtain wall + gate
  B.add(GEO.box, stone, M4(0, 1.9, z0 - 1.6, [6.4, 3.8, 1.2]), st);
  for (let i = -2; i <= 2; i++) B.add(GEO.box, stone, M4(i * 1.2, 4.1, z0 - 2.05, [0.62, 0.6, 0.38]), st);
  B.add(GEO.box, dark, M4(0, 1.35, z0 - 2.18, [2.1, 2.7, 0.1]));
  B.add(GEO.cyl, dark, M4(0, 2.7, z0 - 2.18, [2.1, 0.1, 2.1], [Math.PI / 2, 0, 0]));
  B.add(GEO.box, wood, M4(0, 1.3, z0 - 2.24, [1.8, 2.5, 0.08]), { jitter: 0.12, cell: 0.3 });
  for (let i = -2; i <= 2; i++) B.add(GEO.box, 0x3B2A1E, M4(i * 0.38, 1.3, z0 - 2.3, [0.06, 2.5, 0.05]));
  // ivy on the walls
  for (let k = 0; k < 14; k++) {
    const x = (k % 2 ? -1 : 1) * (2.2 + (k * 0.37) % 2.4), y = 0.6 + (k * 0.71) % 2.6;
    F.add(GEO.blob, k % 3 ? 0x5C9E45 : 0x6FB352, M4(x, y, z0 - 2.25 - (k % 2) * 0.05, [0.9, 1.1, 0.3]), { aw: 0.08, jitter: 0.2 });
  }
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; F.add(GEO.blob, 0x5E9F4A, M4(Math.cos(a) * 5.9, 0.6, z0 + Math.sin(a) * 5.1, 0.9 + (k % 3) * 0.25), { aw: 'y', awScale: 0.2, jitter: 0.2 }); }
  // hanging banners (cloth): on the keep and the front towers
  const banner = (x, y, z, w, h, col) => {
    C.add(GEO.cloth, col, M4(x, y, z, [w, h, 0.05]), { awFn: (px, py) => Math.max(0, (y - py) / h) * 0.8 });
    C.add(GEO.box, PAL.cream, M4(x, y - h * 0.45, z - 0.04, [w * 0.38, w * 0.38, 0.03], [0, 0, Math.PI / 4]), { awFn: () => 0.36 });
    C.add(GEO.cylLo, 0x5A3820, M4(x, y + 0.04, z, [0.08, w * 1.2, 0.08], [0, 0, Math.PI / 2]));
  };
  banner(-1.25, 3.7, z0 - 2.32, 0.95, 2.2, roof); banner(1.25, 3.7, z0 - 2.32, 0.95, 2.2, roof);
  banner(-4.1, 5.4, z0 - 2.95, 0.9, 1.9, roof); banner(4.1, 5.4, z0 - 2.95, 0.9, 1.9, roof);
  // flags on the front tower tops
  for (const sx of [-1, 1]) {
    const x = sx * 4.1, y = 7.2 + 4.0, z = z0 - 1.6;
    B.add(GEO.cylLo, 0x5A3820, M4(x, y + 0.6, z, [0.1, 2.0, 0.1]));
    C.add(GEO.box, roof, M4(x + 0.85, y + 1.2, z, [1.6, 0.95, 0.05]), { awFn: (px) => Math.max(0, (px - x)) * 0.5 });
  }
  // torches either side of the gate
  const torches = [];
  for (const sx of [-1, 1]) {
    const x = sx * 1.75, z = z0 - 2.4;
    B.add(GEO.cylLo, 0x4A3122, M4(x, 1.85, z - 0.12, [0.1, 0.7, 0.1], [0.4, 0, 0]));
    B.add(GEO.cyl, 0x3A3A3A, M4(x, 2.25, z - 0.25, [0.3, 0.18, 0.3]));
    torches.push([x, 2.55, z - 0.25]);
  }
  // ballista turret over the gate
  const turret = new THREE.Group(); turret.position.set(0, 4.45, z0 - 1.6);
  const tb = new Baker();
  tb.add(GEO.box, wood, M4(0, 0.25, 0, [0.5, 0.5, 1.6]), { jitter: 0.1 });
  tb.add(GEO.box, wood, M4(0, 0.45, 0.6, [2.2, 0.15, 0.15]));
  tb.add(GEO.box, PAL.steel, M4(0, 0.5, 0.95, [0.12, 0.12, 0.5]));
  tb.add(GEO.cyl, 0x5A3820, M4(0, -0.05, 0, [0.7, 0.2, 0.7]));
  const tm = new THREE.Mesh(tb.geometry(), toon(0xffffff, 0.2, { vertexColors: true })); tm.castShadow = true;
  turret.add(tm);
  // damage cracks (shown as the castle loses HP)
  const cracks = [];
  for (let stage = 0; stage < 3; stage++) {
    const cb = new Baker(); const R = mulberry32(40 + stage);
    for (let k = 0; k < 5; k++) {
      let x = (R() - 0.5) * 5, y = 1 + R() * 5, z = stage === 1 ? z0 - 2.26 : z0 - 1.03;
      if (stage === 1) y = 0.6 + R() * 3;
      for (let s = 0; s < 4; s++) {
        const a = -Math.PI / 2 + (R() - 0.5) * 1.6, l = 0.35 + R() * 0.5;
        cb.add(GEO.box, 0x2A2420, M4(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2, z, [l, 0.07, 0.04], [0, 0, a]));
        x += Math.cos(a) * l; y += Math.sin(a) * l;
      }
    }
    const cm = new THREE.Mesh(cb.geometry(), toon(0xffffff, 0, { vertexColors: true }));
    cm.visible = false; cracks.push(cm);
  }
  void S;
  return { turret, torches, cracks };
}

// ---------------- the server citadel ----------------
function buildCitadel(B, G, S) {
  const z0 = -BZ - 0.4;
  S.add(GEO.cyl, 0x25303A, M4(0, 0.3, z0, [12, 0.6, 10.5]));
  G.add(GEO.ring, 0x6FFFEA, M4(0, 0.62, z0, [11.6, 4, 10.1]), { boost: GLOW });
  // stacked blocks
  const blocks = [[0, 1.9, 0, 6.2, 2.6, 5.2], [0, 4.5, -0.2, 4.8, 2.7, 4.0], [0, 7.0, -0.3, 3.6, 2.4, 3.0]];
  for (const [x, y, z, w, h, d] of blocks) {
    S.add(GEO.rbox, 0x22303B, M4(x, y, z0 + z, [w, h, d]));
    for (const sz of [-1, 1]) G.add(GEO.box, 0x6FFFEA, M4(x, y + h / 2 - 0.14, z0 + z + sz * (d / 2 + 0.01), [w * 0.86, 0.06, 0.03]), { boost: GLOW });
    for (const sx of [-1, 1]) G.add(GEO.box, 0x6FFFEA, M4(x + sx * (w / 2 + 0.01), y + h / 2 - 0.14, z0 + z, [0.03, 0.06, d * 0.86]), { boost: GLOW });
    for (let k = 0; k < Math.floor(h / 0.5); k++) {
      const yy = y - h / 2 + 0.4 + k * 0.45;
      G.add(GEO.box, k % 3 === 1 ? 0xFFB070 : 0x6FFFEA, M4(x - w * 0.25, yy, z0 + z + d / 2 + 0.02, [w * 0.35, 0.06, 0.03]), { boost: GLOW * 0.8 });
      G.add(GEO.box, 0x6FFFEA, M4(x + w * 0.22, yy, z0 + z + d / 2 + 0.02, [w * 0.2, 0.06, 0.03]), { boost: GLOW * (k % 2 ? 0.4 : 0.9) });
    }
  }
  S.add(GEO.rboxS, PAL.aTeam, M4(0, 3.3, z0 + 2.62, [3.0, 0.9, 0.12]));
  G.add(GEO.box, 0xFFFFFF, M4(0, 3.3, z0 + 2.7, [2.2, 0.12, 0.03]), { boost: GLOW });
  // side racks
  for (const sx of [-1, 1]) {
    S.add(GEO.rbox, 0x2C3945, M4(sx * 3.9, 2.6, z0 + 0.4, [1.9, 4.6, 2.8]));
    S.add(GEO.rboxS, PAL.aTeam, M4(sx * 3.9, 5.0, z0 + 0.4, [2.0, 0.3, 2.9]));
    for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) {
      G.add(GEO.box, (r + c) % 4 === 0 ? 0xFFB070 : 0x6FFFEA, M4(sx * 3.9 - 0.5 + c * 0.5, 0.8 + r * 0.55, z0 + 1.82, [0.3, 0.05, 0.03]), { boost: GLOW * (0.5 + ((r * 3 + c) % 5) * 0.15) });
    }
    // fat cables into the floor
    for (let k = 0; k < 3; k++) S.add(GEO.torus, 0x141B21, M4(sx * (5.0 + k * 0.25), 0.6, z0 + 1.6 - k * 0.6, [1.4, 1.4, 4.0], [0, Math.PI / 2, Math.PI / 2]));
  }
  // spire
  S.add(GEO.cyl, 0x2F3B46, M4(0, 10.2, z0 - 0.3, [0.55, 4.0, 0.55]));
  const rings = [];
  const ringA = new THREE.Mesh(GEO.torus, toon(PAL.aTeam, 0.4)); ringA.position.set(0, 10.2, z0 - 0.3); ringA.scale.setScalar(2.6); ringA.castShadow = true;
  const ringB = new THREE.Mesh(GEO.torus, glowMat(0x6FFFEA)); ringB.position.set(0, 11.2, z0 - 0.3); ringB.scale.setScalar(1.7);
  rings.push(ringA, ringB);
  const core = new THREE.Mesh(GEO.sphere, glowMat(0x9FFFF4)); core.position.set(0, 12.6, z0 - 0.3);
  const coreHalo = new THREE.Mesh(GEO.sphere, additive(0x2BD9C6, 0.25, 1.5)); coreHalo.scale.setScalar(2.2); core.add(coreHalo);
  // holo screens in front of the citadel
  const holoMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      float h(float x){ return fract(sin(x * 91.7) * 4375.5); }
      void main(){
        vec2 uv = vUv;
        float frame = step(uv.x, 0.03) + step(0.97, uv.x) + step(uv.y, 0.05) + step(0.95, uv.y);
        float col = floor(uv.x * 9.0);
        float bar = step(uv.y, 0.12 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.7 + col * 1.3 + h(col) * 6.0))) * step(0.15, fract(uv.x * 9.0)) * step(uv.y, 0.8) * step(0.1, uv.y);
        float line = smoothstep(0.02, 0.0, abs(uv.y - (0.82 + 0.06 * sin(uv.x * 14.0 + uTime * 2.0))));
        float scan = 0.65 + 0.35 * sin(uv.y * 120.0 - uTime * 6.0);
        vec3 c = vec3(0.25, 1.0, 0.92) * (bar * 0.55 + frame * 0.9 + line * 1.2 + 0.08) * scan;
        gl_FragColor = vec4(c * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const holos = [];
  for (const [x, y, z, ry, w, h] of [[-3.6, 6.6, z0 + 3.4, 0.35, 2.6, 1.6], [3.6, 6.6, z0 + 3.4, -0.35, 2.6, 1.6], [0, 9.6, z0 + 1.7, 0, 2.2, 1.2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holoMat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 3;
    holos.push(m);
    G.add(GEO.cyl, 0x6FFFEA, M4(x, y - h / 2 - 0.1, z, [0.08, 0.08, 0.08]), { boost: GLOW });
  }
  // turret on the front block
  const turret = new THREE.Group(); turret.position.set(0, 6.05, z0 + 1.5);
  const tb = new Baker(), tg = new Baker();
  tb.add(GEO.hemi, 0x2F3B46, M4(0, 0, 0, [1.4, 1.2, 1.4]));
  tb.add(GEO.barrel, PAL.gun, M4(0, 0.3, 0.2, [0.22, 0.22, 1.2]));
  tg.add(GEO.sphereLo, 0x7BFFEE, M4(0, 0.3, 1.4, 0.25), { boost: GLOW });
  const tm = new THREE.Mesh(tb.geometry(), toon(0xffffff, 0.3, { vertexColors: true })); tm.castShadow = true;
  turret.add(tm, new THREE.Mesh(tg.geometry(), glowMat(0xffffff, { vertexColors: true })));
  // damage cracks
  const cracks = [];
  for (let stage = 0; stage < 3; stage++) {
    const cb = new Baker(); const R = mulberry32(60 + stage);
    for (let k = 0; k < 5; k++) {
      let x = (R() - 0.5) * 5, y = 1 + R() * (stage === 2 ? 7 : 3);
      const z = stage === 2 ? z0 + 1.71 : z0 + 2.62;
      if (stage === 2) x *= 0.6;
      for (let s = 0; s < 4; s++) {
        const a = -Math.PI / 2 + (R() - 0.5) * 1.6, l = 0.35 + R() * 0.5;
        cb.add(GEO.box, 0xFF7A3D, M4(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2, z, [l, 0.06, 0.04], [0, 0, a]), { boost: GLOW * 0.8 });
        x += Math.cos(a) * l; y += Math.sin(a) * l;
      }
    }
    const cm = new THREE.Mesh(cb.geometry(), glowMat(0xffffff, { vertexColors: true }));
    cm.visible = false; cracks.push(cm);
  }
  return { turret, rings, core, holos, cracks };
}

// ---------------- moving set pieces: windmill + radar dish ----------------
function buildWindmill(B, x, z) {
  const y = terrainHeight(x, z);
  B.add(GEO.taper, 0xEFE3CC, M4(x, y + 3.2, z, [3.2, 6.4, 3.2]), { jitter: 0.14, cell: 0.5 });
  B.add(GEO.cone, PAL.hTeam, M4(x, y + 7.3, z, [3.6, 2.2, 3.6]), { jitter: 0.08, cell: 0.35 });
  B.add(GEO.box, 0x5A3820, M4(x, y + 1.0, z + 1.5, [0.9, 1.6, 0.1]));
  const hub = new THREE.Group(); hub.position.set(x, y + 5.8, z + 1.75);
  const bb = new Baker();
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    bb.add(GEO.box, 0x6E4A26, M4(Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0, [4.2, 0.16, 0.12], [0, 0, a]));
    bb.add(GEO.box, 0xFFF1D6, M4(Math.cos(a) * 2.4 - Math.sin(a) * 0.38, Math.sin(a) * 2.4 + Math.cos(a) * 0.38, 0.02, [3.2, 0.66, 0.05], [0, 0, a]));
  }
  bb.add(GEO.sphereLo, 0x5A3820, M4(0, 0, 0.1, 0.5));
  const m = new THREE.Mesh(bb.geometry(), toon(0xffffff, 0.2, { vertexColors: true })); m.castShadow = true;
  hub.add(m);
  return hub;
}
function buildRadar(S, G, x, z) {
  S.add(GEO.cyl, 0x2C3945, M4(x, 1.6, z, [1.0, 3.2, 1.0]));
  S.add(GEO.rbox, 0x2C3945, M4(x, 0.4, z, [3, 0.8, 3]));
  const head = new THREE.Group(); head.position.set(x, 3.4, z);
  const db = new Baker(), dg = new Baker();
  const dish = new THREE.SphereGeometry(1.8, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3.2).rotateX(-Math.PI / 2 - 0.5);
  db.add(dish, 0xD9E2E8, M4(0, 0.6, 0, 1), { raw: false });
  db.add(GEO.cylLo, 0x2C3945, M4(0, 0.6, 0.6, [0.12, 1.6, 0.12], [1.1, 0, 0]));
  dg.add(GEO.sphereLo, 0xFF5A5A, M4(0, 1.2, 1.3, 0.22), { boost: GLOW });
  const dm = new THREE.Mesh(db.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
  dm.castShadow = true;
  head.add(dm, new THREE.Mesh(dg.geometry(), glowMat(0xffffff, { vertexColors: true })));
  void G;
  return head;
}

// ---------------- floating particles: pollen and data motes ----------------
function motes(scene, count, box, color, size, human) {
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(count * 3), S = new Float32Array(count);
  const R = mulberry32(human ? 91 : 92);
  for (let i = 0; i < count; i++) { P[i * 3] = R(); P[i * 3 + 1] = R(); P[i * 3 + 2] = R(); S[i] = 0.5 + R(); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uMin: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uSize: { value: new THREE.Vector3(box[3], box[4], box[5]) },
      uColor: { value: new THREE.Color(color) }, uPx: { value: size }, uScale: { value: 1 } },
    vertexShader: `uniform float uTime, uPx; uniform vec3 uMin, uSize; attribute float aS; varying float vA;
      void main(){
        vec3 p = position;
        p.x = fract(p.x + uTime * 0.012 * aS + sin(uTime * 0.5 + p.z * 30.0) * 0.004);
        p.y = fract(p.y + uTime * ${human ? '0.008' : '0.03'} * aS);
        p.z = fract(p.z + uTime * 0.006 * aS + cos(uTime * 0.4 + p.x * 20.0) * 0.004);
        vec3 w = uMin + p * uSize;
        vA = smoothstep(0.0, 0.15, p.y) * (1.0 - smoothstep(0.75, 1.0, p.y)) * (0.6 + 0.4 * sin(uTime * 3.0 + aS * 20.0));
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_PointSize = uPx * aS * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * a * vA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 6;
  scene.add(pts);
  return mat;
}

// ---------------- base shield dome ----------------
function domeMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: TIME, uColor: { value: new THREE.Color(color) }, uHit: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uHit; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        vec2 hx = vec2(atan(vP.z, vP.x) * 6.0, vP.y * 2.2);
        float hex = smoothstep(0.42, 0.5, abs(fract(hx.x + floor(hx.y) * 0.5) - 0.5)) + smoothstep(0.42, 0.5, abs(fract(hx.y) - 0.5));
        float band = smoothstep(0.0, 0.3, 1.0 - abs(fract(vP.y * 0.12 - uTime * 0.35) - 0.5) * 4.0);
        float a = f * 0.9 + hex * 0.14 + band * 0.12 + uHit * 0.5;
        gl_FragColor = vec4(uColor * a * 1.8, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function buildWorld(scene, renderer, cover, detail = 1) {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  buildTerrain(scene);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 72).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: floorTexture(maxAniso) }));
  floor.receiveShadow = true; floor.position.y = 0.0;
  scene.add(floor);
  buildWater(scene);
  buildGrass(scene, detail);

  // static bakers: B = toon stone/wood, F = swaying foliage, G = glowing bits, S = glossy tech, C = cloth
  const B = new Baker(), F = new Baker(), G = new Baker(), S = new Baker(), C = new Baker();
  buildPlaza(scene, B, G, S);
  buildScenery(scene, B, F, G, S, detail);
  buildCover(B, F, G, S, cover);
  const castle = buildCastle(B, F, G, C, S);
  const citadel = buildCitadel(B, G, S);
  const windmill = buildWindmill(B, -34, 24);
  const radar = buildRadar(S, G, -34, -24);
  const windmill2 = buildWindmill(B, 34, 52);
  const radar2 = buildRadar(S, G, 36, -50);
  const add = (baker, mat, shadow = true) => {
    if (baker.empty) return null;
    const m = new THREE.Mesh(baker.geometry(), mat);
    m.castShadow = shadow; m.receiveShadow = true;
    scene.add(m); return m;
  };
  add(B, toon(0xffffff, 0.16, { vertexColors: true }));
  add(F, toon(0xffffff, 0.2, { vertexColors: true, sway: [0.09, 1.3] }));
  add(C, toon(0xffffff, 0.18, { vertexColors: true, side: THREE.DoubleSide, sway: [0.28, 3.0] }));
  add(S, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3 }));
  add(G, glowMat(0xffffff, { vertexColors: true }), false);
  scene.add(windmill, radar, windmill2, radar2, ...citadel.rings, citadel.core, ...citadel.holos);
  for (const c of castle.cracks) scene.add(c);
  for (const c of citadel.cracks) scene.add(c);

  // torch flames + their flickering light
  const flameMat = additive(0xFF9A3D, 0.9, 2.6), flameCore = additive(0xFFE6A0, 0.9, 2.6);
  const flames = castle.torches.map(([x, y, z]) => {
    const f = new THREE.Mesh(GEO.cone, flameMat); f.position.set(x, y + 0.25, z); f.scale.set(0.34, 0.7, 0.34);
    const c = new THREE.Mesh(GEO.sphereLo, flameCore); c.position.set(0, -0.3, 0); c.scale.set(0.7, 0.4, 0.7); f.add(c);
    scene.add(f); return f;
  });
  const torchLight = new THREE.PointLight(0xFF9A4D, detail > 0.6 ? 14 : 0, 11, 1.6); torchLight.position.set(0, 2.9, BZ - 2.4);
  const coreLight = new THREE.PointLight(0x4DFFE8, detail > 0.6 ? 26 : 0, 16, 1.6); coreLight.position.set(0, 7, -BZ + 3.2);
  scene.add(torchLight, coreLight);

  const pollen = motes(scene, Math.round(260 * detail), [-60, 0.3, -4, 120, 7, 70], 0xFFF2B0, 7, true);
  const data = motes(scene, Math.round(240 * detail), [-60, 0.2, -90, 120, 9, 88], 0x6FFFEA, 6, false);
  void pollen; void data;

  // bases (the turret and dome are what the simulation drives)
  const human = { group: new THREE.Group(), turret: castle.turret, cracks: castle.cracks };
  const ai = { group: new THREE.Group(), turret: citadel.turret, cracks: citadel.cracks };
  human.group.add(castle.turret); ai.group.add(citadel.turret);
  scene.add(human.group, ai.group);
  const bases = { human, ai };
  for (const k of ['human', 'ai']) {
    const b = bases[k];
    b.home = new THREE.Vector3(0, 0, k === 'human' ? BZ : -BZ);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7.4, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial(k === 'human' ? 0xFFB070 : 0x6FFFEA));
    dome.position.copy(b.home); dome.visible = false; dome.renderOrder = 4;
    scene.add(dome);
    b.dome = dome;
  }

  let t = 0;
  return {
    bases,
    update(dt, game, turretAims) {
      t += dt; TIME.value = t;
      windmill.rotation.z = t * 0.9; windmill2.rotation.z = t * 0.7 + 1;
      radar.rotation.y = t * 0.6; radar2.rotation.y = -t * 0.5;
      citadel.rings[0].rotation.x = Math.sin(t * 0.8) * 0.4; citadel.rings[0].rotation.z = t * 0.9;
      citadel.rings[1].rotation.x = t * 1.3; citadel.rings[1].rotation.z = Math.cos(t) * 0.4;
      citadel.core.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i], k = 0.85 + Math.sin(t * 17 + i * 3) * 0.08 + Math.sin(t * 29 + i) * 0.07;
        f.scale.set(0.34 * (2 - k) * 0.9, 0.7 * k, 0.34 * (2 - k) * 0.9);
        f.rotation.z = Math.sin(t * 7 + i) * 0.12;
      }
      if (torchLight.intensity > 0) torchLight.intensity = 12 + Math.sin(t * 17) * 2.5 + Math.sin(t * 31) * 1.5;
      if (coreLight.intensity > 0) coreLight.intensity = 22 + Math.sin(t * 4) * 5;
      if (!game) return;
      for (const k of ['human', 'ai']) {
        const b = bases[k], sb = game.bases[k];
        // hits make the building shudder in place (the camera stays still)
        const shake = sb.hitT > 0 ? sb.hitT * 0.5 : 0;
        b.group.position.set((Math.random() - 0.5) * shake, 0, (Math.random() - 0.5) * shake);
        const dmg = 1 - sb.hp / sb.max;
        b.cracks[0].visible = dmg > 0.3; b.cracks[1].visible = dmg > 0.55; b.cracks[2].visible = dmg > 0.78;
        b.dome.visible = sb.shield;
        if (sb.shield) b.dome.material.uniforms.uHit.value = sb.hitT > 0 ? sb.hitT * 3 : 0;
        const aim = turretAims[k];
        if (aim) {
          const wp = b.turret.getWorldPosition(_tp);
          const yaw = Math.atan2(aim.x - wp.x, aim.z - wp.z);
          let d = yaw - b.turret.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          b.turret.rotation.y += d * Math.min(1, dt * 10);
        }
      }
    },
  };
}
const _tp = new THREE.Vector3();
