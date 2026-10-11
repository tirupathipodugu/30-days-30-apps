// Small mesh toolkit for the anatomy bake: OBJ reading, plane clipping, welding, nearest-triangle queries and inside tests.

import { readFileSync } from 'node:fs';

/** Reads the v and f records of an OBJ file. BodyParts3D files are triangles in millimetres. */
export function readObj(path) {
  const pos = [], idx = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
      for (let k = 1; k < p.length - 1; k++) idx.push(p[0], p[k], p[k + 1]);
    }
  }
  return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}

export function merge(meshes) {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length; ni += m.index.length; }
  const positions = new Float64Array(nv), index = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    for (let i = 0; i < m.index.length; i++) index[oi + i] = m.index[i] + ov / 3;
    ov += m.positions.length; oi += m.index.length;
  }
  return { positions, index };
}

/** Keeps the part of a mesh where dot(n, p) <= d, splitting the triangles the plane crosses. */
export function clipPlane(mesh, n, d) {
  const P = mesh.positions, out = [], idx = [];
  const map = new Map();
  const vert = (i) => {
    if (!map.has(i)) { map.set(i, out.length / 3); out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
    return map.get(i);
  };
  const edgeMap = new Map();
  const cut = (a, b, da, db) => {
    const key = a < b ? a + ',' + b : b + ',' + a;
    if (edgeMap.has(key)) return edgeMap.get(key);
    const t = da / (da - db);
    const v = out.length / 3;
    out.push(P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t);
    edgeMap.set(key, v);
    return v;
  };
  const dist = (i) => n[0] * P[i * 3] + n[1] * P[i * 3 + 1] + n[2] * P[i * 3 + 2] - d;
  for (let t = 0; t < mesh.index.length; t += 3) {
    const v = [mesh.index[t], mesh.index[t + 1], mesh.index[t + 2]];
    const s = v.map(dist);
    const inside = s.map((x) => x <= 0);
    const count = inside.filter(Boolean).length;
    if (count === 3) { idx.push(vert(v[0]), vert(v[1]), vert(v[2])); continue; }
    if (count === 0) continue;
    // Rotate so the odd vertex comes first, keeping the winding.
    let r = 0;
    for (let k = 0; k < 3; k++) if (inside[k] === (count === 1)) r = k;
    const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3];
    const sa = s[r], sb = s[(r + 1) % 3], sc = s[(r + 2) % 3];
    const ab = cut(a, b, sa, sb), ac = cut(a, c, sa, sc);
    if (count === 1) idx.push(vert(a), ab, ac);
    else idx.push(ab, vert(b), vert(c), ab, vert(c), ac);
  }
  return { positions: Float64Array.from(out), index: Uint32Array.from(idx) };
}

/** Merges vertices closer than eps (BodyParts3D meshes come with duplicated seams). */
export function weld(mesh, eps = 1e-4) {
  const P = mesh.positions, map = new Map(), remap = new Uint32Array(P.length / 3), out = [];
  for (let i = 0; i < P.length / 3; i++) {
    const key = Math.round(P[i * 3] / eps) + ',' + Math.round(P[i * 3 + 1] / eps) + ',' + Math.round(P[i * 3 + 2] / eps);
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
    remap[i] = j;
  }
  const idx = [];
  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = remap[mesh.index[t]], b = remap[mesh.index[t + 1]], c = remap[mesh.index[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: Float64Array.from(out), index: Uint32Array.from(idx) };
}

export function bounds(P) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return { lo, hi, centre: [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) };
}

export function vertexNormals(positions, index) {
  const n = new Float64Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += cx; n[o + 1] += cy; n[o + 2] += cz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

export function signedVolume(mesh) {
  const P = mesh.positions, I = mesh.index;
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Nearest-triangle queries over a uniform grid of triangle buckets. */
export class TriGrid {
  constructor(mesh, cell = 3) {
    this.P = mesh.positions; this.I = mesh.index; this.cell = cell;
    this.map = new Map();
    const P = this.P, I = this.I;
    for (let t = 0; t < I.length / 3; t++) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const x = P[I[t * 3 + k] * 3 + a]; lo[a] = Math.min(lo[a], x); hi[a] = Math.max(hi[a], x); }
      for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
        for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
          for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
            const key = this.key(x, y, z);
            let b = this.map.get(key); if (!b) this.map.set(key, b = []); b.push(t);
          }
    }
    this.out = [0, 0, 0];
    this.q = [0, 0, 0];
    this.stamp = new Uint32Array(I.length / 3);
    this.gen = 0;
  }
  key(x, y, z) { return ((x + 2000) * 4096 + (y + 2000)) * 4096 + (z + 2000); }
  /** Distance to the nearest triangle within maxR (Infinity if none); this.tri and this.q hold the hit. */
  nearest(px, py, pz, maxR) {
    const c = this.cell, gx = Math.floor(px / c), gy = Math.floor(py / c), gz = Math.floor(pz / c);
    let best = Infinity, bestT = -1;
    const rings = Math.ceil(maxR / c);
    const gen = ++this.gen;
    for (let r = 0; r <= rings; r++) {
      if (best < (r - 1) * c) break;
      for (let x = gx - r; x <= gx + r; x++) for (let y = gy - r; y <= gy + r; y++) for (let z = gz - r; z <= gz + r; z++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy), Math.abs(z - gz)) !== r) continue;
        const b = this.map.get(this.key(x, y, z));
        if (!b) continue;
        for (const t of b) {
          if (this.stamp[t] === gen) continue;
          this.stamp[t] = gen;
          const d = this.triDist(t, px, py, pz);
          if (d < best) { best = d; bestT = t; this.q[0] = this.out[0]; this.q[1] = this.out[1]; this.q[2] = this.out[2]; }
        }
      }
    }
    this.tri = bestT;
    return best <= maxR ? best : Infinity;
  }
  triDist(t, px, py, pz) {
    const P = this.P, I = this.I;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    closestOnTri(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], this.out);
    return Math.hypot(px - this.out[0], py - this.out[1], pz - this.out[2]);
  }
}

// Ericson, Real-Time Collision Detection, 5.1.5.
function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

/** Inside/outside of a closed mesh on a voxel grid, by counting crossings along z. */
export class InsideGrid {
  constructor(mesh, cell = 0.5, pad = 2) {
    const { lo, hi } = bounds(mesh.positions);
    this.lo = lo.map((v) => v - pad); this.cell = cell;
    this.n = [0, 1, 2].map((k) => Math.ceil((hi[k] + pad - this.lo[k]) / cell) + 1);
    const [nx, ny, nz] = this.n;
    this.bits = new Uint8Array(nx * ny * nz);
    const cols = new Map();
    const P = mesh.positions, I = mesh.index;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const xs = [P[a], P[b], P[c]], ys = [P[a + 1], P[b + 1], P[c + 1]];
      const i0 = Math.ceil((Math.min(...xs) - this.lo[0]) / cell - 0.5), i1 = Math.floor((Math.max(...xs) - this.lo[0]) / cell - 0.5);
      const j0 = Math.ceil((Math.min(...ys) - this.lo[1]) / cell - 0.5), j1 = Math.floor((Math.max(...ys) - this.lo[1]) / cell - 0.5);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        // Tiny offsets keep the column from passing exactly through a vertex or an edge.
        const x = this.lo[0] + (i + 0.5) * cell + 1e-7, y = this.lo[1] + (j + 0.5) * cell + 1.3e-7;
        const w0 = (xs[1] - x) * (ys[2] - y) - (xs[2] - x) * (ys[1] - y);
        const w1 = (xs[2] - x) * (ys[0] - y) - (xs[0] - x) * (ys[2] - y);
        const w2 = (xs[0] - x) * (ys[1] - y) - (xs[1] - x) * (ys[0] - y);
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        const s = w0 + w1 + w2;
        if (Math.abs(s) < 1e-12) continue;
        const z = (w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2]) / s;
        const key = i * ny + j;
        let l = cols.get(key); if (!l) cols.set(key, l = []); l.push(z);
      }
    }
    for (const [key, zs] of cols) {
      zs.sort((p, q) => p - q);
      const i = Math.floor(key / ny), j = key % ny;
      for (let m = 0; m + 1 < zs.length; m += 2) {
        const k0 = Math.max(0, Math.ceil((zs[m] - this.lo[2]) / cell - 0.5)), k1 = Math.min(nz - 1, Math.floor((zs[m + 1] - this.lo[2]) / cell - 0.5));
        for (let k = k0; k <= k1; k++) this.bits[i + nx * (j + ny * k)] = 1;
      }
    }
  }
  inside(x, y, z) {
    const i = Math.floor((x - this.lo[0]) / this.cell), j = Math.floor((y - this.lo[1]) / this.cell), k = Math.floor((z - this.lo[2]) / this.cell);
    const [nx, ny, nz] = this.n;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
    return this.bits[i + nx * (j + ny * k)] === 1;
  }
}
