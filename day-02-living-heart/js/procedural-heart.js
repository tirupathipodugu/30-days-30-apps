// The fallback heart: an anatomical heart sculpted from distance fields, painted, with raised coronary vessels.

import { meshSdf } from './sdf-mesher.js';
import { roundCone, ellipsoid, smin, sub, add, scale, dot, cross, norm, lerp3 } from './sdf.js';
import { fbm3, noise3 } from './noise.js';

// Anatomical frame, viewed from the front: x = the viewer's right (the patient's left), y = up, z = toward the viewer.
const APEX = [0.62, -1.08, 0.30];
const U = norm(sub([-0.12, 0.15, -0.05], [0.62, -1.05, 0.30]));   // long axis, apex to base
const ANT = norm(sub([0, 0, 1], scale(U, U[2])));                   // anterior, square to the axis
const RIGHT = scale(cross(U, ANT), -1);                              // toward the patient's right
const P = (h, r, a) => add(add(add(APEX, scale(U, h)), scale(RIGHT, r)), scale(ANT, a));
const BASE_H = 1.42;
const IV_ANGLE = 115;                                               // the anterior interventricular groove, degrees round from the right
const SEPTUM = norm(add(scale(RIGHT, Math.sin(IV_ANGLE * Math.PI / 180)), scale(ANT, -Math.cos(IV_ANGLE * Math.PI / 180))));   // septal plane normal, toward the RV
const SEPTUM_SHIFT = 0.1;

// A vessel is a chain of round cones; a cut end is sliced flat and hollowed into a lumen.
function vessel(points, radii, cut) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) parts.push(roundCone(points[i], points[i + 1], radii[i], radii[i + 1]));
  const n = points.length - 1;
  const end = points[n], dir = norm(sub(points[n], points[n - 1])), r = radii[n];
  // A bounding sphere lets far-away samples skip the exact distance.
  let c = [0, 0, 0];
  for (const p of points) c = add(c, scale(p, 1 / points.length));
  let R = 0;
  points.forEach((p, i) => { R = Math.max(R, Math.hypot(...sub(p, c)) + radii[i]); });
  const MARGIN = 0.15;
  return {
    points, radii, end, dir, r, cut,
    sdf(x, y, z) {
      const bound = Math.hypot(x - c[0], y - c[1], z - c[2]) - R;
      if (bound > MARGIN) return bound;
      let d = 1e9;
      for (let i = 0; i < parts.length - 1; i++) d = smin(d, parts[i](x, y, z), 0.06);
      let last = parts[parts.length - 1](x, y, z);
      if (cut) last = Math.max(last, (x - end[0]) * dir[0] + (y - end[1]) * dir[1] + (z - end[2]) * dir[2]);
      return smin(d, last, 0.06);
    },
    lumen(x, y, z) {
      if (!cut) return 1e9;
      const px = x - end[0], py = y - end[1], pz = z - end[2];
      if (px * px + py * py + pz * pz > 4 * r * r) return 1e9;
      const t = px * dir[0] + py * dir[1] + pz * dir[2];
      const rx = px - dir[0] * t, ry = py - dir[1] * t, rz = pz - dir[2] * t;
      return Math.max(Math.hypot(rx, ry, rz) - r * 0.74, -t - r * 0.9);
    },
  };
}

const ARCH_TOP = [0.02, 1.13, -0.06];
const VESSELS = {
  aorta: vessel([[-0.12, 0.24, 0.10], [-0.19, 0.56, 0.14], [-0.15, 0.9, 0.1], ARCH_TOP, [0.25, 1.1, -0.27], [0.37, 0.88, -0.42], [0.39, 0.7, -0.45]],
    [0.15, 0.155, 0.148, 0.14, 0.135, 0.13, 0.13], true),
  brachio: vessel([[-0.09, 1.08, 0.0], [-0.14, 1.26, 0.02], [-0.17, 1.36, 0.03]], [0.072, 0.064, 0.062], true),
  carotid: vessel([[0.05, 1.16, -0.09], [0.07, 1.32, -0.1], [0.08, 1.4, -0.1]], [0.05, 0.045, 0.044], true),
  subclav: vessel([[0.17, 1.14, -0.19], [0.23, 1.29, -0.23], [0.26, 1.37, -0.25]], [0.055, 0.05, 0.048], true),
  pulmonary: vessel([[0.06, 0.18, 0.38], [0.15, 0.56, 0.33], [0.28, 0.8, 0.12], [0.47, 0.87, -0.08], [0.59, 0.88, -0.2]],
    [0.148, 0.145, 0.138, 0.105, 0.1], true),
  rpa: vessel([[0.24, 0.8, 0.05], [0.0, 0.84, -0.18], [-0.26, 0.83, -0.3]], [0.105, 0.1, 0.095], true),
  svc: vessel([[-0.55, 0.45, -0.06], [-0.54, 0.8, -0.08], [-0.52, 1.12, -0.09]], [0.125, 0.12, 0.12], true),
  ivc: vessel([[-0.48, 0.05, -0.18], [-0.5, -0.14, -0.22], [-0.51, -0.28, -0.24]], [0.135, 0.13, 0.13], true),
  pvRS: vessel([[-0.22, 0.48, -0.5], [-0.38, 0.52, -0.58], [-0.47, 0.54, -0.62]], [0.075, 0.072, 0.07], true),
  pvRI: vessel([[-0.22, 0.3, -0.5], [-0.38, 0.27, -0.58], [-0.47, 0.25, -0.62]], [0.072, 0.07, 0.068], true),
  pvLS: vessel([[0.32, 0.5, -0.48], [0.48, 0.55, -0.56], [0.58, 0.57, -0.6]], [0.075, 0.072, 0.07], true),
  pvLI: vessel([[0.32, 0.32, -0.5], [0.48, 0.28, -0.57], [0.58, 0.27, -0.6]], [0.072, 0.07, 0.068], true),
};
const ARTERIES = ['aorta', 'brachio', 'carotid', 'subclav', 'pulmonary', 'rpa'].map((n) => VESSELS[n]);
const VEINS = ['svc', 'ivc', 'pvRS', 'pvRI', 'pvLS', 'pvLI'].map((n) => VESSELS[n]);
const ALL = [...ARTERIES, ...VEINS];

const lv = roundCone(P(0.21, -0.05, -0.05), P(1.18, -0.12, -0.12), 0.2, 0.58);
const rv = roundCone(P(0.52, 0.2, 0.22), P(1.2, 0.32, 0.2), 0.14, 0.5);
const conus = roundCone(P(1.1, 0.16, 0.3), [0.06, 0.18, 0.38], 0.26, 0.15);
const ra = ellipsoid([-0.5, 0.3, -0.02], [0.3, 0.32, 0.31]);
const raAuricle = roundCone([-0.45, 0.4, 0.2], [-0.22, 0.5, 0.33], 0.13, 0.07);
const la = ellipsoid([0.06, 0.4, -0.38], [0.42, 0.24, 0.24]);
const laAuricle = roundCone([0.3, 0.46, 0.0], [0.47, 0.42, 0.2], 0.1, 0.06);

function ventricles(x, y, z) {
  let d = smin(lv(x, y, z), rv(x, y, z), 0.2);
  d = smin(d, conus(x, y, z), 0.14);
  const h = (x - APEX[0]) * U[0] + (y - APEX[1]) * U[1] + (z - APEX[2]) * U[2];
  return -smin(-d, BASE_H + 0.12 - h, 0.2);
}
function atria(x, y, z) {
  let d = smin(ra(x, y, z), la(x, y, z), 0.16);
  return smin(d, Math.min(raAuricle(x, y, z), laAuricle(x, y, z)), 0.06);
}
function vessels(list, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < list.length; i++) d = Math.min(d, list[i].sdf(x, y, z));
  return d;
}
function lumen(x, y, z) {
  let d = 1e9;
  for (let i = 0; i < ALL.length; i++) d = Math.min(d, ALL[i].lumen(x, y, z));
  return d;
}

// Grooves: the AV groove rings the base, the interventricular grooves run down the septal plane.
function grooves(x, y, z) {
  const px = x - APEX[0], py = y - APEX[1], pz = z - APEX[2];
  const h = px * U[0] + py * U[1] + pz * U[2];
  const s = px * SEPTUM[0] + py * SEPTUM[1] + pz * SEPTUM[2] - SEPTUM_SHIFT;
  const av = Math.exp(-(((h - BASE_H) / 0.075) ** 2));
  const iv = Math.exp(-((s / 0.05) ** 2)) * smooth(0.12, 0.45, h) * (1 - smooth(BASE_H - 0.1, BASE_H + 0.05, h));
  return { h, s, av, iv };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function heartSdf(x, y, z) {
  const v = ventricles(x, y, z);
  const a = atria(x, y, z);
  let d = smin(v, a, 0.12);
  d = smin(d, vessels(ARTERIES, x, y, z), 0.07);
  d = smin(d, vessels(VEINS, x, y, z), 0.07);
  const g = grooves(x, y, z);
  d += 0.03 * g.av + 0.026 * g.iv;
  // Crinkled auricle edges and the gentle unevenness of real muscle.
  const aur = Math.min(raAuricle(x, y, z), laAuricle(x, y, z));
  if (aur < 0.08) d += 0.011 * noise3(x * 14, y * 14, z * 14) * (1 - aur / 0.08);
  d += 0.013 * noise3(x * 3.2 + 3, y * 3.2, z * 3.2) + 0.004 * noise3(x * 9, y * 9 + 5, z * 9);
  return Math.max(d, -lumen(x, y, z));
}

// Coronary paths, written as (height along the axis, angle around it) and found on the surface by
// marching out from the long axis. Angle 0 is the patient's right, 90° anterior, 180° the patient's left.
function surfaceAt(h, angle, shift = 0) {
  const dir = add(scale(RIGHT, Math.cos(angle)), scale(ANT, Math.sin(angle)));
  const o = add(add(APEX, scale(U, h)), scale(SEPTUM, shift));
  let lo = 0, hi = 0.05;
  while (heartSdf(...add(o, scale(dir, hi))) < 0 && hi < 2) { lo = hi; hi += 0.05; }
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (heartSdf(...add(o, scale(dir, m))) < 0) lo = m; else hi = m;
  }
  return add(o, scale(dir, (lo + hi) / 2));
}

function coronaryPaths() {
  const deg = Math.PI / 180;
  const paths = [];
  const line = (from, to, steps, opts, wobble = 3) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const h = from[0] + (to[0] - from[0]) * t;
      const a = (from[1] + (to[1] - from[1]) * t + wobble * noise3(t * 3 + from[1], h * 2, 7.7)) * deg;
      pts.push(surfaceAt(h, a, opts.shift || 0));
    }
    paths.push({ pts, ...opts });
  };
  // The anterior interventricular groove lies in the septal plane, which faces 55° round from the right.
  const IV = IV_ANGLE;
  line([BASE_H - 0.06, IV], [0.1, IV + 6], 30, { r0: 0.024, r1: 0.009, kind: 'artery', shift: SEPTUM_SHIFT }, 2);   // LAD
  line([BASE_H - 0.1, IV + 7], [0.5, IV + 9], 22, { r0: 0.026, r1: 0.013, kind: 'vein', shift: SEPTUM_SHIFT + 0.035 }, 2);  // great cardiac vein
  line([1.12, IV - 9], [0.55, IV + 40], 14, { r0: 0.016, r1: 0.007, kind: 'artery' });                       // diagonals
  line([0.86, IV - 9], [0.32, IV + 30], 13, { r0: 0.014, r1: 0.006, kind: 'artery' });
  line([1.25, IV - 8], [0.95, IV + 22], 8, { r0: 0.012, r1: 0.006, kind: 'artery' });
  line([BASE_H - 0.03, 62], [BASE_H - 0.05, -70], 26, { r0: 0.026, r1: 0.018, kind: 'artery' }, 2);        // RCA
  line([BASE_H - 0.06, 8], [0.42, 16], 16, { r0: 0.016, r1: 0.007, kind: 'artery' });                         // acute marginal
  line([BASE_H - 0.12, 30], [0.75, 44], 10, { r0: 0.012, r1: 0.006, kind: 'artery' });                        // conal branch
  line([BASE_H - 0.03, 150], [BASE_H - 0.04, 255], 16, { r0: 0.022, r1: 0.016, kind: 'artery' }, 2);        // circumflex
  line([BASE_H - 0.06, 178], [0.55, 168], 14, { r0: 0.016, r1: 0.007, kind: 'artery' });                      // obtuse marginal
  line([BASE_H - 0.1, 14], [0.6, 22], 12, { r0: 0.018, r1: 0.01, kind: 'vein' });                             // small cardiac vein
  return paths;
}

// Ribbons of tube around each projected path, half-buried in the surface.
function tubeMesh(path, sdfGrad, out) {
  const seg = 8;
  const pts = resample(path.pts, 0.016);
  const base = out.positions.length / 3;
  let prevN = null;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const r = path.r0 + (path.r1 - path.r0) * t;
    const tan = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const g = sdfGrad(pts[i]);
    const c = add(pts[i], scale(g, r * 0.15));   // mostly proud of the surface, a little buried
    let n = norm(sub(g, scale(tan, dot(g, tan))));
    if (prevN && dot(n, prevN) < 0) n = scale(n, -1);
    prevN = n;
    const b = cross(tan, n);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const dir = add(scale(n, Math.cos(a)), scale(b, Math.sin(a)));
      const p = add(c, scale(dir, r));
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(dir[0], dir[1], dir[2]);
      out.kind.push(path.kind === 'artery' ? 1 : 2);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = base + i * seg + k, b2 = base + i * seg + ((k + 1) % seg);
    const c = a + seg, d = b2 + seg;
    out.index.push(a, b2, c, b2, d, c);
  }
}

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let t = step - carry;
    while (t <= len) { out.push(lerp3(a, b, t / len)); t += step; }
    carry = len - (t - step);
  }
  if (out.length < 2) out.push(pts[pts.length - 1]);
  return out;
}

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map((c) => c ** 2.2);
const COL = {
  myo: hex(0x5e0d12), myoDark: hex(0x4c0a10), atrium: hex(0x4f0c16), artery: hex(0x8e6f66), arteryRoot: hex(0x74463f),
  vein: hex(0x46121f), lumen: hex(0x1a0305), corA: hex(0x6a1016), corV: hex(0x2e0c1e),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Albedo (without fat) and a smooth fat field for a point on the surface; the shader breaks the fat
// field into lobulated patches with crisp, irregular borders.
function paint(x, y, z, kind) {
  const g = grooves(x, y, z);
  const dV = ventricles(x, y, z), dA = atria(x, y, z);
  const dArt = vessels(ARTERIES, x, y, z), dVein = vessels(VEINS, x, y, z);
  const lum = lumen(x, y, z);
  const mottling = fbm3(x * 6, y * 6, z * 6, 3);
  let c = mix(COL.myo, COL.myoDark, 0.5 * smooth(-0.3, 0.4, mottling));
  if (dA < dV - 0.02) c = mix(c, COL.atrium, 0.8);
  const dVes = Math.min(dArt, dVein);
  const onVessel = smooth(0.03, -0.02, dVes - Math.min(dV, dA));
  if (onVessel > 0) c = mix(c, dArt < dVein ? mix(COL.arteryRoot, COL.artery, smooth(0.1, 0.5, y - 0.2)) : COL.vein, onVessel);
  // Fat: heavy in the AV and interventricular grooves and around the roots of the great arteries.
  const rootFat = Math.exp(-((Math.max(0, dArt) / 0.07) ** 2)) * smooth(0.55, 0.12, y) * (dV < 0.15 ? 1 : 0.3);
  let fat = Math.max(g.av * 0.95, g.iv * 0.85, rootFat * 0.75) + 0.16 * smooth(0.6, 1.4, g.h) * (dV < dA ? 1 : 0);
  fat *= (lum < 0.02 ? 0 : 1) * (1 - onVessel * 0.6);
  if (kind === 1) c = COL.corA;
  if (kind === 2) c = COL.corV;
  if (kind) fat *= 0.3;
  if (lum < 0.006) { c = COL.lumen; fat = 0; }
  return { c, fat: Math.min(1, fat) };
}

export function buildProceduralHeart(lowTier) {
  const cell = lowTier ? 0.03 : 0.02;
  const mesh = meshSdf(heartSdf, [-0.95, -1.0, -0.82], [0.9, 1.7, 0.75], cell);
  const e = 0.004;
  const grad = (p) => norm([
    heartSdf(p[0] + e, p[1], p[2]) - heartSdf(p[0] - e, p[1], p[2]),
    heartSdf(p[0], p[1] + e, p[2]) - heartSdf(p[0], p[1] - e, p[2]),
    heartSdf(p[0], p[1], p[2] + e) - heartSdf(p[0], p[1], p[2] - e)]);
  const out = { positions: Array.from(mesh.positions), normals: Array.from(mesh.normals), index: Array.from(mesh.index), kind: new Array(mesh.positions.length / 3).fill(0) };
  for (const path of coronaryPaths()) tubeMesh(path, grad, out);

  const count = out.positions.length / 3;
  const colors = new Float32Array(count * 3), fat = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const { c, fat: f } = paint(out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2], out.kind[i]);
    colors.set(c, i * 3); fat[i] = f;
  }
  const v = VESSELS;
  const end = (n) => ({ point: v[n].end, dir: v[n].dir, radius: v[n].r, path: v[n].points });
  return {
    positions: new Float32Array(out.positions), normals: new Float32Array(out.normals),
    index: new Uint32Array(out.index), colors, fat,
    landmarks: {
      apex: APEX,
      avPlane: { point: add(APEX, scale(U, BASE_H)), normal: U },
      aorta: end('aorta'),
      pulmonaryTrunk: end('pulmonary'),
      svc: end('svc'), ivc: end('ivc'),
      pulmonaryVeins: ['pvRS', 'pvRI', 'pvLS', 'pvLI'].map(end),
      arch: [end('brachio'), end('carotid'), end('subclav'), end('rpa')],
      septumDir: SEPTUM,
      atria: [[-0.5, 0.3, -0.02], [0.06, 0.4, -0.38]],
    },
  };
}
