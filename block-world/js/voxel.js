// From a picture's depth, labels and colours to a real block world:
//  1. Every sample point is placed in 3D the way a camera sees it (pinhole maths), so the floor is flat
//     and walls stand upright, instead of the photo being pushed back like a sheet.
//  2. Points snap to a coarse block grid (about 48 blocks across the middle of the room).
//  3. Each block takes the material of what it is (wall, floor, sofa, plant…) and one colour per object
//     from a 16-colour dye palette, so a blue sofa is uniform blue wool, like a real block game.

import { TYPES, typeFor } from './blocks.js';

// Our own 16-colour dye palette.
export const PALETTE = [
  [0.95, 0.95, 0.94], [0.62, 0.62, 0.6], [0.36, 0.37, 0.39], [0.1, 0.1, 0.12],
  [0.45, 0.29, 0.17], [0.69, 0.18, 0.16], [0.9, 0.48, 0.12], [0.95, 0.8, 0.22],
  [0.45, 0.72, 0.18], [0.29, 0.46, 0.15], [0.16, 0.55, 0.6], [0.37, 0.67, 0.86],
  [0.2, 0.27, 0.62], [0.47, 0.25, 0.65], [0.72, 0.3, 0.68], [0.92, 0.6, 0.7],
  [0.85, 0.72, 0.58], [0.72, 0.55, 0.42],   // two skin-ish tones so people read well
];
export function nearestDye([r, g, b], { people = false, lift = 1 } = {}) {
  // Indoor photos are a little dark, so colours are lifted before matching (a white wall stays white).
  r = Math.min(1, r * lift); g = Math.min(1, g * lift); b = Math.min(1, b * lift);
  let best = PALETTE[0], bd = 1e9;
  for (const p of people ? PALETTE : PALETTE.slice(0, 16)) {
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

const HFOV = 65 * Math.PI / 180;
const GROUND = new Set(['floor', 'rug', 'road', 'sidewalk', 'grass', 'earth', 'field', 'sand', 'path', 'land', 'dirt track', 'runway']);

/**
 * colors: Uint8Array(gw*gh*3), depth: Float32Array 0..1 (near = 1, relative), labels: Int16Array, names: string[].
 * Returns { voxels: [{x,y,z,type,color,group}], groups: [{name}], size }.
 */
export function voxelize({ colors, depth, labels, names, gw, gh, across = 48, solid = true, groupOf = null }) {
  let lo = 1, hi = 0;
  for (const d of depth) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  const f = (gw / 2) / Math.tan(HFOV / 2);
  const dn = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) dn[i] = (depth[i] - lo) / ((hi - lo) || 1);

  // Calibrate depth with the ground. The AI's depth is only relative ("nearer than"), but the floor is
  // flat: in a level photo a floor point's distance below the horizon tells how far away it is
  // (1/distance grows with it). Fit 1/distance = A * depth + B on floor pixels, then use it everywhere.
  let A = 0.9, B = 0.1, fitted = false;
  {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let r = 0; r < gh; r++) {
      const below = r + 0.5 - gh / 2;
      if (below < gh * 0.06) continue;
      for (let c = 0; c < gw; c++) {
        const i = r * gw + c;
        if (labels[i] < 0 || !GROUND.has(names[labels[i]])) continue;
        const x = dn[i], y = below / (gh / 2);
        n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
    }
    if (n > gw * gh * 0.03) {
      const den = n * sxx - sx * sx;
      const a = den ? (n * sxy - sx * sy) / den : 0, b = (sy - a * sx) / n;
      if (a > 0.05) { A = a; B = b; fitted = true; }
    }
  }
  const Zs = new Float32Array(gw * gh);
  const zs = [];
  const minInv = (A + B) * 0.06;                       // the farthest things stop at about 16x the nearest
  for (let i = 0; i < gw * gh; i++) {
    const inv = Math.max(minInv, A * dn[i] + B);
    Zs[i] = 1 / inv;
    zs.push(Zs[i]);
  }
  zs.sort((a, b) => a - b);
  const zMid = zs[Math.floor(zs.length * 0.6)];
  const v = (2 * zMid * Math.tan(HFOV / 2)) / across;   // block size in world units

  // Type per cell, and one dye colour per object (label) from the average of its pixels.
  const cellType = new Array(gw * gh);
  const sums = new Map();
  for (let i = 0; i < gw * gh; i++) {
    const t = labels[i] < 0 ? 'plain' : typeFor(names[labels[i]]);
    cellType[i] = t;
    if (!t) continue;
    const key = labels[i];
    const s = sums.get(key) || [0, 0, 0, 0];
    s[0] += colors[i * 3]; s[1] += colors[i * 3 + 1]; s[2] += colors[i * 3 + 2]; s[3]++;
    sums.set(key, s);
  }
  const objectDye = new Map();
  for (const [key, s] of sums) objectDye.set(key, nearestDye([s[0] / s[3] / 255, s[1] / s[3] / 255, s[2] / s[3] / 255], { lift: 1.25 }));

  // Place samples into blocks. Each block keeps a vote of what it is.
  const cells = new Map();
  const put = (ix, iy, iz, i, type) => {
    const key = `${ix},${iy},${iz}`;
    let cell = cells.get(key);
    if (!cell) { cell = { x: ix, y: iy, z: iz, votes: new Map(), rgb: [0, 0, 0], n: 0, group: 0, lab: labels[i] }; cells.set(key, cell); }
    cell.votes.set(type, (cell.votes.get(type) || 0) + 1);
    cell.rgb[0] += colors[i * 3]; cell.rgb[1] += colors[i * 3 + 1]; cell.rgb[2] += colors[i * 3 + 2]; cell.n++;
    if (groupOf) cell.group = groupOf[i];
    cell.lab = labels[i];
  };
  const P = new Float32Array(gw * gh * 3);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const i = r * gw + c, type = cellType[i];
    if (!type) continue;
    const Z = Zs[i];
    P[i * 3] = (c + 0.5 - gw / 2) * Z / f / v;
    P[i * 3 + 1] = (gh / 2 - r - 0.5) * Z / f / v;
    P[i * 3 + 2] = -Z / v;
    put(Math.round(P[i * 3]), Math.round(P[i * 3 + 1]), Math.round(P[i * 3 + 2]), i, type);
  }
  // Far away one photo pixel covers several blocks, so neighbouring pixels of the same surface land with
  // gaps between them. Fill the gap along the line between them (up to 10 blocks), so walls are solid.
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const i = r * gw + c, type = cellType[i];
    if (!type) continue;
    for (const j of [c + 1 < gw ? i + 1 : -1, r + 1 < gh ? i + gw : -1]) {
      if (j < 0 || labels[j] !== labels[i] || cellType[j] !== type) continue;
      const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
      if (steps < 2 || steps > 10) continue;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        put(Math.round(P[i * 3] + dx * t), Math.round(P[i * 3 + 1] + dy * t), Math.round(P[i * 3 + 2] + dz * t), i, type);
      }
    }
  }

  // Flatten the floor (and ceiling): their blocks snap to the most common height.
  const flatten = (type, pick) => {
    const ys = new Map();
    for (const c of cells.values()) if (top(c) === type) ys.set(c.y, (ys.get(c.y) || 0) + 1);
    if (!ys.size) return;
    const yAll = [...ys.entries()].sort((a, b) => b[1] - a[1]);
    const yFlat = pick(yAll.slice(0, 3).map((e) => e[0]));
    for (const [k, c] of [...cells]) {
      if (top(c) !== type || c.y === yFlat || Math.abs(c.y - yFlat) > 4) continue;
      cells.delete(k);
      const nk = `${c.x},${yFlat},${c.z}`;
      if (!cells.has(nk)) { c.y = yFlat; cells.set(nk, c); }
    }
  };
  function top(c) { let best = null, bn = -1; for (const [t, n] of c.votes) if (n > bn) { bn = n; best = t; } return best; }
  flatten('floor', (ys) => Math.min(...ys));
  flatten('grass', (ys) => Math.min(...ys));

  // Build voxels; give objects some body by filling a little way back from the visible face.
  const voxels = [];
  const seen = new Set();
  const add = (x, y, z, type, color, group) => {
    const k = `${x},${y},${z}`;
    if (seen.has(k)) return;
    seen.add(k);
    voxels.push({ x, y, z, type, color, group });
  };
  for (const c of cells.values()) {
    const type = top(c);
    const avg = [c.rgb[0] / c.n / 255, c.rgb[1] / c.n / 255, c.rgb[2] / c.n / 255];
    const spec = TYPES[type];
    let color;
    if (type === 'plain') color = nearestDye(avg, { people: true, lift: 1.1 });   // people and unknown things: per block
    else if (spec.dye) color = objectDye.get(c.lab) || nearestDye(avg, { lift: 1.25 }); // walls, fabric: one colour per object
    else color = spec.tint;                                              // wood, stone, leaves…: the material's own colour
    add(c.x, c.y, c.z, type, color, c.group);
    if (!solid) continue;
    const depthFill = spec.fixed ? (type === 'floor' || type === 'grass' ? 0 : 1) : 2;
    for (let d = 1; d <= depthFill; d++) add(c.x, c.y, c.z - d, type, color.map((x) => x * 0.92), c.group);
    if (type === 'floor' || type === 'grass') add(c.x, c.y - 1, c.z, type === 'grass' ? 'dirt' : type, (type === 'grass' ? TYPES.dirt.tint : color).map((x) => x * 0.85), c.group);
  }

  // Centre the world around the origin.
  let mx = 0, my = 0, mz = 0;
  for (const p of voxels) { mx += p.x; my += p.y; mz += p.z; }
  mx = Math.round(mx / voxels.length); my = Math.round(my / voxels.length); mz = Math.round(mz / voxels.length);
  for (const p of voxels) { p.x -= mx; p.y -= my; p.z -= mz; }
  return { voxels, size: across };
}
