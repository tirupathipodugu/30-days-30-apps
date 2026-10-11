// Bakes the segmented study heart from BodyParts3D into assets/heart-anatomy.glb (one named mesh per part)
// and assets/heart-anatomy.json (landmarks for the beat, the threads and the camera). Run with node:
//
//   node tools/bake-anatomy.mjs <folder with the BodyParts3D partof_BP3D_4.0_obj_99 OBJ files>
//
// BodyParts3D ships the heart's chambers as blood-pool casts, its atrial walls, valves, papillary muscles,
// coronary vessels and great vessels as separate meshes, but no ventricular muscle. The ventricular walls and
// the septum are grown here from the casts: 8 mm around the left ventricle and 3 mm around the right, which is
// where the dataset's own coronary arteries sit (median 9 mm and 3 mm off the casts), thinning to nothing at
// the valve openings. The SA and AV nodes are not in the dataset and are added as small marked regions.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readObj, merge, clipPlane, weld, bounds, vertexNormals, TriGrid, InsideGrid } from './mesh-kit.mjs';
import { meshSdf } from '../js/sdf-mesher.js';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/bake-anatomy.mjs <BodyParts3D OBJ folder>'); process.exit(1); }
const t0 = performance.now();
const log = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'FJ' + (a + i));
const load = (f) => weld(readObj(`${SRC}/${f}.obj`), 1e-3);
const loadAll = (files) => weld(merge(files.map(load)), 1e-3);
// Clip helpers in BodyParts3D millimetres (x to the body's left, y to the back, z up).
const keepAbove = (m, z) => clipPlane(m, [0, 0, -1], -z);
const keepBelow = (m, z) => clipPlane(m, [0, 0, 1], z);

// ---- Source meshes ----
const casts = { lv: load('FJ2422'), rv: load('FJ2423'), ra: load('FJ2424'), la: load('FJ2425') };
const src = {
  'right-atrium': load('FJ2439'),
  'left-atrium': load('FJ2438'),
  'tricuspid-valve': loadAll(['FJ2421', 'FJ2433', 'FJ2436']),
  'mitral-valve': loadAll(['FJ2420', 'FJ2432']),
  'aortic-valve': loadAll(['FJ2426', 'FJ2431', 'FJ2435']),
  'pulmonary-valve': loadAll(['FJ2417', 'FJ2427', 'FJ2434']),
  'papillary-muscles': loadAll(['FJ2418', 'FJ2419', 'FJ2429', 'FJ2430', 'FJ2437']),
  aorta: weld(merge([
    load('FJ3413'), load('FJ3411'), keepAbove(load('FJ3427'), 1250), load('FJ3417'),
    keepBelow(load('FJ3483'), 1338), clipPlane(keepBelow(load('FJ3479'), 1342), [1, 0, 0], 44),
  ]), 1e-3),
  'pulmonary-trunk': loadAll(['FJ2966', 'FJ3019', 'FJ2924']),
  'superior-vena-cava': load('FJ3645'),
  'inferior-vena-cava': keepAbove(load('FJ3441'), 1163),
  'pulmonary-veins': loadAll(['FJ3020', 'FJ3040', 'FJ2925', 'FJ2944']),
  'right-coronary': loadAll(['FJ2723', 'FJ2667', 'FJ2668', ...range(2670, 2677), ...range(2692, 2700), ...range(2714, 2722)]),
  'left-coronary': loadAll(['FJ2737', ...range(2631, 2654)]),
  'cardiac-veins': loadAll(['FJ2655', 'FJ2656', 'FJ2724', 'FJ2727', 'FJ2728', 'FJ2729', 'FJ2731']),
};
log('loaded sources');

// ---- Ventricular walls from the casts ----
// Everything runs on one voxel grid: signed distances to each cast by exact Euclidean distance transforms,
// read back with trilinear interpolation.
const T_LV = 8.0, T_RV = 3.0, K = 2.5, VOX = 0.6, PAD = 16;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const vbox = bounds(merge([casts.lv, casts.rv]).positions);
const G = { lo: vbox.lo.map((v) => v - PAD), n: [0, 1, 2].map((k) => Math.ceil((vbox.hi[k] - vbox.lo[k] + 2 * PAD) / VOX) + 1) };
const NV = G.n[0] * G.n[1] * G.n[2];
const vid = (i, j, k) => i + G.n[0] * (j + G.n[1] * k);
const centreOf = (i, j, k) => [G.lo[0] + i * VOX, G.lo[1] + j * VOX, G.lo[2] + k * VOX];

// Felzenszwalb and Huttenlocher's 1D squared distance transform, applied along each axis in turn.
function edt(mask) {
  const INF = 1e20, f = new Float64Array(NV);
  for (let i = 0; i < NV; i++) f[i] = mask[i] ? 0 : INF;
  const maxN = Math.max(...G.n), line = new Float64Array(maxN), out = new Float64Array(maxN), v = new Int32Array(maxN), z = new Float64Array(maxN + 1);
  const pass = (n, idx) => {
    for (let q = 0; q < n; q++) line[q] = f[idx(q)];
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) { s = ((line[q] + q * q) - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) k--; else break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + line[v[k]]; }
    for (let q = 0; q < n; q++) f[idx(q)] = out[q];
  };
  const [nx, ny, nz] = G.n;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) pass(nx, (q) => vid(q, j, k));
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(ny, (q) => vid(i, q, k));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(nz, (q) => vid(i, j, q));
  const d = new Float32Array(NV);
  for (let i = 0; i < NV; i++) d[i] = Math.sqrt(f[i]) * VOX;
  return d;
}
function signedField(mesh) {
  const ins = new InsideGrid(mesh, VOX * 0.5);
  const inside = new Uint8Array(NV), outside = new Uint8Array(NV);
  for (let k = 0; k < G.n[2]; k++) for (let j = 0; j < G.n[1]; j++) for (let i = 0; i < G.n[0]; i++) {
    const p = centreOf(i, j, k), v = vid(i, j, k);
    if (ins.inside(p[0], p[1], p[2])) inside[v] = 1; else outside[v] = 1;
  }
  const dOut = edt(inside), dIn = edt(outside);
  const s = new Float32Array(NV);
  for (let i = 0; i < NV; i++) s[i] = inside[i] ? -(dIn[i] - VOX * 0.5) : dOut[i] - VOX * 0.5;
  return s;
}
// Unsigned distance to open surfaces: mark the voxels the triangles pass through.
function surfaceField(mesh) {
  const mask = new Uint8Array(NV), P = mesh.positions, I = mesh.index;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const l = Math.max(Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]), Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]));
    const n = Math.max(1, Math.ceil(l / (VOX * 0.5)));
    for (let u = 0; u <= n; u++) for (let w = 0; w <= n - u; w++) {
      const x = P[a] + (P[b] - P[a]) * u / n + (P[c] - P[a]) * w / n;
      const y = P[a + 1] + (P[b + 1] - P[a + 1]) * u / n + (P[c + 1] - P[a + 1]) * w / n;
      const z = P[a + 2] + (P[b + 2] - P[a + 2]) * u / n + (P[c + 2] - P[a + 2]) * w / n;
      const i = Math.round((x - G.lo[0]) / VOX), j = Math.round((y - G.lo[1]) / VOX), k = Math.round((z - G.lo[2]) / VOX);
      if (i >= 0 && j >= 0 && k >= 0 && i < G.n[0] && j < G.n[1] && k < G.n[2]) mask[vid(i, j, k)] = 1;
    }
  }
  return edt(mask);
}
function sample(f, x, y, z) {
  const fx = Math.min(G.n[0] - 1.001, Math.max(0, (x - G.lo[0]) / VOX)), fy = Math.min(G.n[1] - 1.001, Math.max(0, (y - G.lo[1]) / VOX)), fz = Math.min(G.n[2] - 1.001, Math.max(0, (z - G.lo[2]) / VOX));
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k;
  const at = (a, b, c) => f[vid(i + a, j + b, k + c)];
  return (at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u) * (1 - v) * (1 - w) + (at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u) * v * (1 - w)
    + (at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u) * (1 - v) * w + (at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u) * v * w;
}
// A light blur takes the voxel terracing out of the distance fields.
function blur(f, passes = 2) {
  const tmp = new Float32Array(NV), [nx, ny, nz] = G.n, strides = [1, nx, nx * ny], dims = [nx, ny, nz];
  for (let p = 0; p < passes; p++) for (let a = 0; a < 3; a++) {
    const st = strides[a];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = vid(i, j, k), c = [i, j, k][a];
      const lo = c > 0 ? f[v - st] : f[v], hi = c < dims[a] - 1 ? f[v + st] : f[v];
      tmp[v] = (lo + 2 * f[v] + hi) * 0.25;
    }
    f.set(tmp);
  }
  return f;
}
const fLV = blur(signedField(casts.lv)), fRV = blur(signedField(casts.rv));
// Wall thickness falls to zero where a cast opens into an atrium or a great artery.
const fOpen = surfaceField(merge([casts.la, casts.ra, load('FJ3413'), load('FJ2966'), src['aortic-valve'], src['pulmonary-valve']]));
log('distance fields', G.n.join('×'));
const castField = (f, T, x, y, z) => ({ s: sample(f, x, y, z), t: T * smooth(3, 13, sample(fOpen, x, y, z)) });
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function wallSdf(x, y, z) {
  const L = castField(fLV, T_LV, x, y, z), R = castField(fRV, T_RV, x, y, z);
  const shell = smin(L.s - L.t, R.s - R.t, K);
  return Math.max(shell, -L.s, -R.s);
}
const vb = bounds(merge([casts.lv, casts.rv]).positions);
const pad = 12;
const shell = meshSdf(wallSdf, vb.lo.map((v) => v - pad), vb.hi.map((v) => v + pad), 1.0);
// Taubin smoothing (shrink, then inflate) irons out the last of the grid pattern without losing volume.
{
  const P = shell.positions, I = shell.index, n = P.length / 3;
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  const lists = nb.map((s) => [...s]);
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < 24; it++) {
    const f = it % 2 ? -0.53 : 0.5;
    for (let v = 0; v < n; v++) {
      const l = lists[v];
      if (!l.length) { tmp[v * 3] = P[v * 3]; tmp[v * 3 + 1] = P[v * 3 + 1]; tmp[v * 3 + 2] = P[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (const u of l) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
      x /= l.length; y /= l.length; z /= l.length;
      tmp[v * 3] = P[v * 3] + f * (x - P[v * 3]); tmp[v * 3 + 1] = P[v * 3 + 1] + f * (y - P[v * 3 + 1]); tmp[v * 3 + 2] = P[v * 3 + 2] + f * (z - P[v * 3 + 2]);
    }
    P.set(tmp);
  }
  shell.normals = Float32Array.from(vertexNormals(P, I));
}
log('ventricular walls', shell.positions.length / 3, 'vertices');

// Split the walls: the septum lies between the two cavities; the rest goes to whichever cavity it wraps.
const wallParts = { 'left-ventricle': [], 'right-ventricle': [], septum: [] };
{
  const P = shell.positions, I = shell.index;
  for (let t = 0; t < I.length; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += P[I[t + k] * 3] / 3; cy += P[I[t + k] * 3 + 1] / 3; cz += P[I[t + k] * 3 + 2] / 3; }
    const dl = Math.abs(castField(fLV, T_LV, cx, cy, cz).s), dr = Math.abs(castField(fRV, T_RV, cx, cy, cz).s);
    let part;
    if ((dl < 2.5 || dr < 2.5) && dl + dr < 15) part = 'septum';
    else if (dl < 2.5) part = 'left-ventricle';
    else if (dr < 2.5) part = 'right-ventricle';
    else part = dl - T_LV < dr - T_RV ? 'left-ventricle' : 'right-ventricle';
    wallParts[part].push(I[t], I[t + 1], I[t + 2]);
  }
}
const subMesh = (positions, normals, tris) => {
  const map = new Map(), pos = [], nrm = [], idx = [];
  for (const v of tris) {
    let j = map.get(v);
    if (j === undefined) { j = pos.length / 3; map.set(v, j); pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]); }
    idx.push(j);
  }
  return { positions: Float64Array.from(pos), normals: Float64Array.from(nrm), index: Uint32Array.from(idx) };
};
const parts = {};
for (const [id, tris] of Object.entries(wallParts)) parts[id] = subMesh(shell.positions, shell.normals, tris);
for (const [id, m] of Object.entries(src)) parts[id] = { ...m, normals: vertexNormals(m.positions, m.index) };

// ---- SA and AV nodes: small marked regions at their textbook positions ----
const vertsWhere = (m, f) => { const out = []; for (let i = 0; i < m.positions.length; i += 3) if (f(m.positions[i], m.positions[i + 1], m.positions[i + 2])) out.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); return out; };
const mean = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
const nearestVertex = (m, p) => { let best = Infinity, bi = 0; for (let i = 0; i < m.positions.length; i += 3) { const d = (m.positions[i] - p[0]) ** 2 + (m.positions[i + 1] - p[1]) ** 2 + (m.positions[i + 2] - p[2]) ** 2; if (d < best) { best = d; bi = i / 3; } } return bi; };
function ellipsoid(c, r, n = 10) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= 2 * n; j++) {
    const th = Math.PI * i / n, ph = Math.PI * j / n;
    pos.push(c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.sin(th) * Math.sin(ph), c[2] + r[2] * Math.cos(th));
  }
  const w = 2 * n + 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a = i * w + j, b = a + w;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return weld({ positions: Float64Array.from(pos), index: Uint32Array.from(idx) }, 1e-6);
}
const raWall = src['right-atrium'];
const svcLow = (() => { const b = bounds(src['superior-vena-cava'].positions); return mean(vertsWhere(src['superior-vena-cava'], (x, y, z) => z < b.lo[2] + 4)); })();
const saAt = (() => { const v = nearestVertex(raWall, [svcLow[0] - 9, svcLow[1] - 7, svcLow[2] - 6]); return [raWall.positions[v * 3], raWall.positions[v * 3 + 1], raWall.positions[v * 3 + 2]]; })();
const csMouth = (() => { const m = src['cardiac-veins'], cs = load('FJ2655'); const b = bounds(cs.positions); return mean(vertsWhere(cs, (x) => x < b.lo[0] + 5)); })();
const avAt = (() => {
  const sl = load('FJ2436');
  const v = nearestVertex(sl, csMouth);
  const lp = [sl.positions[v * 3], sl.positions[v * 3 + 1], sl.positions[v * 3 + 2]];
  const mid = [0, 1, 2].map((k) => csMouth[k] + (lp[k] - csMouth[k]) * 0.6 + (k === 2 ? 4 : 0));
  const w = nearestVertex(raWall, mid);
  return [raWall.positions[w * 3], raWall.positions[w * 3 + 1], raWall.positions[w * 3 + 2]];
})();
for (const [id, m] of [['sa-node', ellipsoid(saAt, [2.0, 2.0, 5.5])], ['av-node', ellipsoid(avAt, [2.6, 1.8, 1.5])]]) parts[id] = { ...m, normals: vertexNormals(m.positions, m.index) };
log('nodes at', saAt.map((v) => v.toFixed(1)).join(','), '/', avAt.map((v) => v.toFixed(1)).join(','));

// ---- Tissue attributes: R = epicardial fat near the coronary vessels, G = inner lining (endocardium) ----
const coronaryGrid = new TriGrid(merge([src['right-coronary'], src['left-coronary'], src['cardiac-veins']]), 3);
const atrialCasts = { 'right-atrium': new TriGrid(casts.ra, 2), 'left-atrium': new TriGrid(casts.la, 2) };
const WALLS = new Set(['left-ventricle', 'right-ventricle', 'septum', 'right-atrium', 'left-atrium']);
for (const [id, m] of Object.entries(parts)) {
  const n = m.positions.length / 3, col = new Uint8Array(n * 4);
  if (WALLS.has(id)) {
    for (let i = 0; i < n; i++) {
      const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
      const dc = coronaryGrid.nearest(x, y, z, 10);
      const fat = 1 - smooth(1.2, 5, dc === Infinity ? 10 : dc);
      let inner = 0;
      if (id === 'left-ventricle' || id === 'right-ventricle' || id === 'septum') {
        const dl = Math.abs(castField(fLV, T_LV, x, y, z).s), dr = Math.abs(castField(fRV, T_RV, x, y, z).s);
        inner = Math.min(dl, dr) < 1.5 ? 1 : 0;
      } else {
        inner = atrialCasts[id].nearest(x, y, z, 2) < 1.0 ? 1 : 0;
      }
      col[i * 4] = Math.round(fat * (1 - inner) * 255); col[i * 4 + 1] = inner * 255; col[i * 4 + 3] = 255;
    }
  } else for (let i = 0; i < n; i++) col[i * 4 + 3] = 255;
  m.color = col;
}
log('tissue attributes');

// ---- Normalise: the chambers one unit tall, centred, in three.js axes (x left of body → screen right, y up, z forward) ----
const body = bounds(merge([parts['left-ventricle'], parts['right-ventricle'], parts['septum'], parts['right-atrium'], parts['left-atrium']]).positions);
const C = body.centre, S = 1 / (body.hi[2] - body.lo[2]);
const toThree = (p) => [(p[0] - C[0]) * S, (p[2] - C[2]) * S, -(p[1] - C[1]) * S];
const dirThree = (d) => [d[0], d[2], -d[1]];

// ---- Landmarks, measured in millimetres and stored in three.js space ----
const T3 = (p) => toThree(p).map((v) => +v.toFixed(5));
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const pts = (m) => { const o = []; for (let i = 0; i < m.positions.length; i += 3) o.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); return o; };
const centroid = (m) => mean(pts(m));

const valveCentre = (m) => centroid(m);
const mitral = valveCentre(parts['mitral-valve']), tricuspid = valveCentre(parts['tricuspid-valve']);
const lvWall = pts(parts['left-ventricle']);
let apex = lvWall[0];
for (const p of lvWall) if (Math.hypot(...sub(p, mitral)) > Math.hypot(...sub(apex, mitral))) apex = p;
const axis = norm(sub(mitral, apex));
// The AV plane sits at the top of the atrioventricular valve leaflets.
const leafH = [...pts(parts['mitral-valve']), ...pts(parts['tricuspid-valve'])].map((p) => dot(sub(p, apex), axis)).sort((a, b) => a - b);
const avH = leafH[Math.floor(leafH.length * 0.9)];
const avPoint = [0, 1, 2].map((k) => apex[k] + axis[k] * avH);

// A vessel's centreline: slice its vertices along its main direction and take each slice's centre.
function centreline(m, dir, slices = 6) {
  const P = pts(m);
  const hs = P.map((p) => dot(p, dir));
  const lo = Math.min(...hs), hi = Math.max(...hs);
  const out = [];
  for (let s = 0; s < slices; s++) {
    const a = lo + (hi - lo) * s / slices, b = lo + (hi - lo) * (s + 1) / slices;
    const sel = P.filter((p, i) => hs[i] >= a && hs[i] <= b);
    if (!sel.length) continue;
    const c = mean(sel);
    const r = sel.reduce((acc, p) => acc + Math.hypot(...sub(p, c)), 0) / sel.length;
    out.push({ c, r });
  }
  return out;
}
const vesselFrom = (m, dir, outward, slices) => {
  const cl = centreline(m, dir, slices);
  if (outward < 0) cl.reverse();
  const end = cl[cl.length - 1], prev = cl[Math.max(0, cl.length - 2)];
  const r = cl.reduce((a, s) => a + s.r, 0) / cl.length;
  return {
    point: T3(end.c), dir: dirThree(norm(sub(end.c, prev.c))).map((v) => +v.toFixed(4)), radius: +(r * S).toFixed(5),
    path: cl.map((s) => T3(s.c)),
  };
};
const svc = vesselFrom(src['superior-vena-cava'], [0, 0, 1], 1, 4);
const ivc = vesselFrom(src['inferior-vena-cava'], [0, 0, 1], -1, 4);
const asc = vesselFrom(load('FJ3413'), [0, 0, 1], 1, 4);
const arch = vesselFrom(load('FJ3411'), [0, 1, 0], 1, 6);
const pt = vesselFrom(load('FJ2966'), [0.3, 0.6, 1], 1, 4);
const lpa = vesselFrom(load('FJ2924'), [1, 0.2, 0], 1, 6);
const rpa = vesselFrom(load('FJ3019'), [-1, 0, 0], 1, 6);
const pv = [
  vesselFrom(load('FJ3020'), [-1, 0, 0], 1, 4), vesselFrom(load('FJ3040'), [-1, 0, 0], 1, 4),
  vesselFrom(load('FJ2925'), [1, 0, 0], 1, 4), vesselFrom(load('FJ2944'), [1, 0, 0], 1, 4),
];
const lcca = vesselFrom(keepBelow(load('FJ3483'), 1338), [0, 0, 1], 1, 4);
const desc = vesselFrom(keepAbove(load('FJ3427'), 1250), [0, 0, 1], -1, 3);
const aortaPath = [T3(valveCentre(parts['aortic-valve'])), ...asc.path, ...arch.path];
const ptPath = [T3(valveCentre(parts['pulmonary-valve'])), ...pt.path];

const castCentre = (m) => T3(centroid(m));
for (const m of new Set(Object.values(parts).map((p) => p.positions))) {
  for (let i = 0; i < m.length; i += 3) { const p = toThree([m[i], m[i + 1], m[i + 2]]); m[i] = p[0]; m[i + 1] = p[1]; m[i + 2] = p[2]; }
}
for (const N of new Set(Object.values(parts).map((p) => p.normals))) {
  for (let i = 0; i < N.length; i += 3) { const d = dirThree([N[i], N[i + 1], N[i + 2]]); N[i] = d[0]; N[i + 1] = d[1]; N[i + 2] = d[2]; }
}
const partInfo = {};
for (const [id, m] of Object.entries(parts)) {
  const b = bounds(m.positions);
  partInfo[id] = { centre: b.centre.map((v) => +v.toFixed(4)), radius: +(Math.hypot(...sub(b.hi, b.lo)) / 2).toFixed(4) };
}
const landmarks = {
  apex: T3(apex), avPlane: { point: T3(avPoint), normal: dirThree(axis).map((v) => +v.toFixed(4)) },
  aorta: { ...desc, path: [...aortaPath, ...desc.path] }, pulmonaryTrunk: { ...pt, path: ptPath },
  arch: [lpa, rpa], svc, ivc, pulmonaryVeins: pv,
  atria: [castCentre(casts.ra), castCentre(casts.la)],
  septumDir: dirThree(norm(sub(centroid(casts.lv), centroid(casts.rv)))).map((v) => +v.toFixed(4)),
  threadRoots: [lcca, lpa, svc, ivc, pv[0], pv[3]].map((v) => ({ point: v.point, dir: v.dir })),
};
const chambers = { lv: castCentre(casts.lv), rv: castCentre(casts.rv), ra: castCentre(casts.ra), la: castCentre(casts.la) };
const mmPerUnit = +(1 / S).toFixed(2);

// ---- GLB ----
const order = Object.keys(parts);
const bufs = [], views = [], accessors = [], meshes = [], nodes = [];
let off = 0;
const pushView = (arr, target) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
  bufs.push(bytes);
  const padN = (4 - (bytes.length % 4)) % 4;
  if (padN) bufs.push(new Uint8Array(padN));
  off += bytes.length + padN;
  return views.length - 1;
};
let triangles = 0, vertices = 0;
for (const id of order) {
  const m = parts[id];
  const n = m.positions.length / 3;
  const pos = Float32Array.from(m.positions), nrm = Float32Array.from(m.normals);
  const b = bounds(pos);
  const ia = accessors.length;
  accessors.push({ bufferView: pushView(pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: b.lo, max: b.hi });
  accessors.push({ bufferView: pushView(nrm, 34962), componentType: 5126, count: n, type: 'VEC3' });
  accessors.push({ bufferView: pushView(m.color, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
  const index = n < 65536 ? Uint16Array.from(m.index) : Uint32Array.from(m.index);
  accessors.push({ bufferView: pushView(index, 34963), componentType: n < 65536 ? 5123 : 5125, count: index.length, type: 'SCALAR' });
  meshes.push({ name: id, primitives: [{ attributes: { POSITION: ia, NORMAL: ia + 1, COLOR_0: ia + 2 }, indices: ia + 3, mode: 4 }] });
  nodes.push({ name: id, mesh: meshes.length - 1 });
  triangles += index.length / 3; vertices += n;
}
const json = {
  asset: { version: '2.0', generator: 'Living Heart bake-anatomy.mjs', copyright: 'BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 JP. Ventricular walls and conduction nodes derived for Living Heart.' },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews: views,
  buffers: [{ byteLength: off }],
};
const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + off;
const glb = new Uint8Array(total);
const dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
glb.set(jsonBytes, 20); glb.fill(32, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
let o = 20 + jsonBytes.length + jsonPad;
dv.setUint32(o, off, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
for (const b of bufs) { glb.set(b, o); o += b.length; }

const outGlb = process.argv[3] || fileURLToPath(new URL('../assets/heart-anatomy.raw.glb', import.meta.url));
writeFileSync(outGlb, glb);
writeFileSync(fileURLToPath(new URL('../assets/heart-anatomy.json', import.meta.url)), JSON.stringify({ mmPerUnit, landmarks, chambers, parts: partInfo }));
log(`${order.length} parts, ${vertices} vertices, ${triangles} triangles, ${(total / 1048576).toFixed(2)} MB raw → ${outGlb}`);
