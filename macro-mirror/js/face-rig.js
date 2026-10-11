// The face rig: turns 478 tracked landmarks plus one future (weight effect and age) into what the
// renderer needs: displacement anchors, a height field for re-lighting, and ribbons for creases,
// folds and lines. Everything is built in a 3D frame taken from the landmarks themselves, so the
// change follows head turns and tilts: tissue moves out from the face's own centre and down along
// its own vertical, then is projected back onto the picture.

// Face oval from the cheek near the ear down to the chin, on each side of the face.
const SIDE_A = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148];
const SIDE_B = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377];
const CHIN = 152;

// Weight gain at +15 kg, in face widths: [out, down] for each oval point above. Most of the new
// volume goes on the lower cheeks, the jaw corners and under the jaw; the upper face barely moves.
const GAIN = [[0.0152, 0.0], [0.0418, 0.0054], [0.076, 0.0144], [0.1026, 0.0288], [0.114, 0.054], [0.0988, 0.0792], [0.076, 0.1008], [0.0475, 0.1116], [0.0228, 0.1152], [0.0076, 0.1152]];
// Weight loss at -8 kg: the lower cheeks and jaw corners come in a little; the bones stay.
const LEAN = [[0, 0], [-0.005, 0], [-0.016, 0], [-0.021, -0.003], [-0.016, -0.005], [-0.012, -0.005],
  [-0.008, -0.003], [-0.005, -0.002], [-0.002, 0], [0, 0]];

// Features that hold still (eyes, brows, nose, mouth, forehead, temples).
const RIGID = [
  [33, 0.05], [133, 0.05], [263, 0.05], [362, 0.05], [168, 0.07], [6, 0.06], [1, 0.06], [4, 0.05], [2, 0.05],
  [98, 0.05], [327, 0.05], [0, 0.05], [13, 0.04], [14, 0.04], [17, 0.05], [61, 0.045], [291, 0.045],
  [70, 0.07], [105, 0.07], [107, 0.06], [300, 0.07], [334, 0.07], [336, 0.06],
  [10, 0.1], [151, 0.1], [109, 0.09], [338, 0.09], [54, 0.08], [284, 0.08], [21, 0.08], [251, 0.08],
  [162, 0.08], [389, 0.08], [127, 0.08], [356, 0.08], [116, 0.07], [345, 0.07],
];

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v3(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

/** Map tracked points (video-normalised) into canvas pixels. */
export function landmarksToCanvas(points, view) {
  const [ox, oy, w, h] = view.map;
  const out = new Array(points.length / 3);
  for (let i = 0; i < out.length; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    out[i] = v3(ox + (view.mirror ? 1 - x : x) * w, oy + y * h, z * w);
  }
  return out;
}

/** The face's own frame: width, centre, axes. */
export function faceFrame(P) {
  const a = P[234], b = P[454];
  const s = len(sub(b, a));
  const X = norm(sub(b, a));
  let up = sub(P[10], P[CHIN]);
  up = norm(sub(up, mul(X, dot(up, X))));
  let Z = norm(cross(X, up));
  if (Z.z < 0) Z = mul(Z, -1);                       // into the head, away from the camera
  const centre = add(mul(add(a, b), 0.5), mul(Z, 0.32 * s));
  return { s, X, up, Z, centre };
}

/** Points along a Catmull-Rom curve through `pts`, `n` samples. */
function spline(pts, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(t));
    const f = t - k;
    const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
    const f2 = f * f, f3 = f2 * f;
    const c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f2 + (-a + 3 * b - 3 * c2 + d) * f3);
    out.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}

/**
 * Build the rig for one future.
 * fp: { gain, lean, age, grey, flush } (0..1 each), amount: 0..1 master fade.
 */
export function buildRig(P, view, fp, amount, canvasW, canvasH) {
  const F = faceFrame(P);
  const { s, X, up, centre } = F;
  const down = mul(up, -1);
  const g = fp.gain, l = fp.lean, A = fp.age;
  const anchors = [];
  const to2 = (p) => ({ x: p.x, y: p.y });
  const outward = (p) => {
    let v = sub(p, centre);
    v = sub(v, mul(up, dot(v, up)));
    return norm(v);
  };
  const anchor = (p, sig, d3, h = 0, sigH = 0) => {
    anchors.push({ x: p.x, y: p.y, sig: sig * s, dx: d3.x, dy: d3.y, h: h * s, sigH: (sigH || sig) * s });
  };
  const disp = (p, out, dn) => add(mul(outward(p), out * s), mul(down, dn * s));

  // Rigid features first.
  for (const [i, sig] of RIGID) anchor(P[i], sig, v3());

  // Eyes: fuller lids make them look a touch smaller.
  for (const [upper, lower] of [[159, 145], [386, 374]]) {
    const open = len(sub(P[upper], P[lower]));
    anchor(P[upper], 0.03, mul(down, Math.min(0.006 * s, open * 0.12) * g));
    anchor(P[lower], 0.03, mul(up, Math.min(0.004 * s, open * 0.08) * g));
  }

  const sides = [[SIDE_A, 61, 129, 50], [SIDE_B, 291, 358, 280]];
  for (const [side, mouth, ala, cheek] of sides) {
    for (let k = 0; k < side.length; k++) {
      const p = P[side[k]];
      const out = GAIN[k][0] * g + LEAN[k][0] * l;
      let dn = GAIN[k][1] * g + LEAN[k][1] * l;
      if (k >= 5 && k <= 7) dn += 0.012 * A;          // jowls sag a little with time
      anchor(p, 0.085, disp(p, out, dn));
    }
    const pm = P[mouth], p58 = P[side[3]], p132 = P[side[2]], p150 = P[side[6]], p172 = P[side[4]];
    // Lower cheek (buccal fat): moves out and down, and gains volume for the light to fall across.
    const m1 = lerp(pm, p58, 0.55);
    anchor(m1, 0.13, disp(m1, 0.045 * g - 0.008 * l, 0.02 * g), 0.035 * g - 0.012 * l, 0.11);
    // Under the cheekbone: fills out with weight, hollows with leanness.
    const m2 = lerp(P[ala], p132, 0.5);
    anchor(m2, 0.11, disp(m2, 0.028 * g - 0.006 * l, 0.006 * g), 0.025 * g - 0.02 * l, 0.09);
    // Apple of the cheek: a little puffiness.
    anchor(P[cheek], 0.06, disp(P[cheek], 0.012 * g, 0.006 * g + 0.004 * A), 0.032 * g + 0.006 * A, 0.07);
    // Jowl: hangs beside the chin.
    const m3 = lerp(pm, p150, 0.55);
    anchor(m3, 0.1, disp(m3, 0.03 * g, 0.05 * g + 0.012 * A), 0.03 * g + 0.008 * A, 0.1);
    // Neck: thickens below the jaw corner.
    const n1 = add(lerp(p172, P[CHIN], 0.3), mul(down, 0.22 * s));
    anchor(n1, 0.12, disp(n1, 0.085 * g, 0.03 * g));
    const n2 = add(p172, mul(down, 0.62 * s));
    anchor(n2, 0.15, v3());
  }

  // Chin and under it: the chin's underside rolls down into a soft second chin.
  const chin = P[CHIN];
  anchor(chin, 0.075, mul(down, (0.1 * g - 0.004 * l + 0.008 * A) * s), 0.045 * g, 0.085);
  const c1 = lerp(P[17], chin, 0.5);
  anchor(c1, 0.05, mul(down, 0.01 * g * s));
  const sub1 = add(chin, mul(down, 0.12 * s));
  anchor(sub1, 0.11, mul(down, 0.09 * g * s), 0.04 * g, 0.1);
  anchor(add(chin, mul(down, 0.55 * s)), 0.16, v3());

  // Ribbons: creases, folds and lines, in source pixels (they get displaced in the shader).
  const ribbons = [];
  const lightRef = to2(up);
  const addRibbon = (pts, halfW, kind, intensity, seed, ref = lightRef, samples = 20) => {
    if (intensity < 0.004) return;
    const c = spline(pts, samples);
    let arc = 0;
    const L = [];
    for (let i = 0; i < c.length; i++) {
      if (i) arc += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y);
      L.push(arc);
    }
    const total = arc || 1;
    const verts = [];
    for (let i = 0; i < c.length; i++) {
      const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      let nx = -ty, ny = tx;
      if (nx * ref.x + ny * ref.y > 0) { nx = -nx; ny = -ny; }      // -n points toward the light
      const w = halfW * s;
      verts.push([c[i].x - nx * w, c[i].y - ny * w, -1, L[i] / total, L[i] / s], [c[i].x + nx * w, c[i].y + ny * w, 1, L[i] / total, L[i] / s]);
    }
    for (let i = 0; i < c.length - 1; i++) {
      const [a0, a1] = [verts[i * 2], verts[i * 2 + 1]];
      const [b0, b1] = [verts[i * 2 + 2], verts[i * 2 + 3]];
      for (const v of [a0, a1, b0, a1, b1, b0]) ribbons.push(v[0], v[1], v[2], v[3], v[4], seed, kind, intensity);
    }
  };

  // Second chin: a soft crease where the chin's underside used to end, curving up toward the jaw.
  const lat = (sgn) => mul(X, sgn);                      // sideways in the face's own frame
  if (g > 0.02) {
    const cL = add(lerp(P[SIDE_A[6]], P[SIDE_A[7]], 0.5), mul(up, 0.05 * s));
    const cM = add(chin, mul(up, 0.03 * s));
    const cR = add(lerp(P[SIDE_B[6]], P[SIDE_B[7]], 0.5), mul(up, 0.05 * s));
    const cl = add(lerp(cL, cM, 0.5), mul(down, 0.012 * s));
    const cr = add(lerp(cR, cM, 0.5), mul(down, 0.012 * s));
    addRibbon([cL, cl, cM, cr, cR].map(to2), 0.034, 1, 0.24 * g, 3.1, lightRef, 24);
    // Ambient occlusion where the new fullness meets the neck.
    const under = [SIDE_A[5], SIDE_A[7], CHIN, SIDE_B[7], SIDE_B[5]].map((i) => to2(add(P[i], mul(down, 0.035 * s))));
    addRibbon(under, 0.07, 2, 0.3 * g, 5.7, lightRef, 24);
  }
  // A crisper jaw shadow when leaner.
  if (l > 0.02) {
    const jaw = [SIDE_A[4], SIDE_A[6], CHIN, SIDE_B[6], SIDE_B[4]].map((i) => to2(add(P[i], mul(down, 0.03 * s))));
    addRibbon(jaw, 0.045, 2, 0.14 * l, 8.2, lightRef, 24);
  }

  for (const [side, mouth, ala, outer, sgn, lower, upper] of [
    [SIDE_A, 61, 129, 33, -1, [33, 7, 163, 144, 145, 153, 154, 155, 133], 159],
    [SIDE_B, 291, 358, 263, 1, [263, 249, 390, 373, 374, 380, 381, 382, 362], 386],
  ]) {
    const pm = P[mouth];
    const L = lat(sgn);
    const sideRef = to2(L);                                     // the full cheek side catches light
    // Nasolabial fold: from beside the nostril, curving out and down past the mouth corner.
    const n0 = add(add(P[ala], mul(L, 0.02 * s)), mul(up, 0.01 * s));
    const n2 = add(add(pm, mul(L, 0.05 * s)), mul(down, 0.035 * s));
    const n1 = add(lerp(n0, n2, 0.45), mul(L, 0.035 * s));
    addRibbon([n0, n1, n2].map(to2), 0.08, 1, 0.12 * A + 0.1 * g + 0.02 * fp.flush, 11 + sgn, sideRef, 18);
    // Marionette line: short, from just below the mouth corner toward the jowl.
    const j0 = add(add(pm, mul(L, 0.035 * s)), mul(down, 0.03 * s));
    const j2 = add(add(lerp(pm, P[side[7]], 0.7), mul(L, 0.01 * s)), mul(up, 0.02 * s));
    const j1 = add(lerp(j0, j2, 0.5), mul(L, 0.008 * s));
    addRibbon([j0, j1, j2].map(to2), 0.065, 1, 0.08 * A + 0.1 * g, 21 + sgn, sideRef, 14);
    // Crow's feet: a small fan from the outer eye corner, very fine.
    const eo = P[outer];
    for (let k = 0; k < 3; k++) {
      const ang = (k - 1) * 0.45 + 0.08;
      const dir = add(mul(L, Math.cos(ang)), mul(down, Math.sin(ang)));
      const a0 = add(eo, mul(L, 0.035 * s));
      const a2 = add(a0, mul(dir, (0.06 - 0.01 * Math.abs(k - 1)) * s));
      const a1 = add(lerp(a0, a2, 0.5), mul(up, 0.004 * s * (1 - k)));
      addRibbon([a0, a1, a2].map(to2), 0.013, 0, (0.08 - 0.015 * Math.abs(k - 1)) * A, 31 + k * 3 + sgn, lightRef, 12);
    }
    // Under the eye: a soft bag that catches the light, and a soft groove beneath it.
    const lid = lower.map((i) => P[i]);
    const eyeH = len(sub(P[lower[4]], P[upper]));
    const bag = [lid[2], lid[4], lid[6], lid[7]].map((p) => to2(add(p, mul(down, 0.024 * s + eyeH * 0.2))));
    addRibbon(bag, 0.024, 3, 0.08 * A + 0.07 * g + 0.04 * fp.flush, 41 + sgn, lightRef, 14);
    const trough = [lid[1], lid[3], lid[5], lid[7]].map((p, k) => to2(add(p, mul(down, (0.05 + 0.01 * Math.sin(k / 3 * Math.PI)) * s + eyeH * 0.25))));
    addRibbon(trough, 0.026, 1, 0.11 * A + 0.04 * g, 51 + sgn, lightRef, 14);
  }

  // Forehead lines: three shallow grooves across the forehead, between the brows and the hairline.
  if (A > 0.02) {
    const brow = [70, 63, 105, 66, -1, 296, 334, 293, 300];
    const top = [54, 103, 67, 109, 10, 338, 297, 332, 284];
    const rows = [[0.3, 0.6, 0.11], [0.47, 0.85, 0.13], [0.63, 0.5, 0.09]];
    rows.forEach(([k, span, strength], r) => {
      const pts = [];
      const m = brow.length;
      for (let j = 0; j < m; j++) {
        const f = (j - (m - 1) / 2) / ((m - 1) / 2);
        if (Math.abs(f) > span + 0.01) continue;
        const b = brow[j] < 0 ? lerp(P[107], P[336], 0.5) : P[brow[j]];
        const t = P[top[j]];
        const wav = Math.sin(j * 1.7 + r * 2.3) * 0.003 * s;
        pts.push(to2(add(lerp(b, t, k), mul(up, wav))));
      }
      addRibbon(pts, 0.026, 0, 0.6 * strength * A, 61 + r * 5, lightRef, 30);
    });
  }

  // Greying at the temples (and a touch along the hairline).
  const grey = new Float32Array(16);
  if (fp.grey > 0.01) {
    let i = 0;
    for (const [t1, t2, sg] of [[21, 162, -1], [251, 389, 1]]) {
      const base = lerp(P[t1], P[t2], 0.45);
      const p = add(add(base, mul(X, sg * 0.03 * s)), mul(up, 0.04 * s));
      grey.set([p.x, p.y, 1 / Math.pow(0.14 * s, 2), 0.8 * fp.grey], i * 4);
      i++;
    }
    const top = add(P[10], mul(up, 0.1 * s));
    grey.set([top.x, top.y, 1 / Math.pow(0.22 * s, 2), 0.25 * fp.grey], 8);
  }
  const red = new Float32Array(12);
  if (fp.flush > 0.01) {
    red.set([P[50].x, P[50].y, 1 / Math.pow(0.12 * s, 2), fp.flush], 0);
    red.set([P[280].x, P[280].y, 1 / Math.pow(0.12 * s, 2), fp.flush], 4);
    red.set([P[4].x, P[4].y, 1 / Math.pow(0.07 * s, 2), fp.flush * 0.8], 8);
  }

  // The patch: everything that can move, plus room for the neck.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of [...SIDE_A, ...SIDE_B, CHIN, 10, 54, 284, 21, 251]) {
    minX = Math.min(minX, P[i].x); maxX = Math.max(maxX, P[i].x);
    minY = Math.min(minY, P[i].y); maxY = Math.max(maxY, P[i].y);
  }
  // Kept inside both the canvas and the picture itself (a letterboxed clip has edges).
  const [mx, my, mw, mh] = view.map;
  const x0 = Math.max(0, mx, minX - 0.45 * s), x1 = Math.min(canvasW, mx + mw, maxX + 0.45 * s);
  const y0 = Math.max(0, my, minY - 0.4 * s), y1 = Math.min(canvasH, my + mh, maxY + 0.85 * s);

  const up2 = norm(v3(up.x, up.y, 0));
  const across2 = norm(v3(X.x, X.y, 0));
  const faceC = lerp(P[6], P[CHIN], 0.35);
  const uv = (p) => {
    const [ox, oy, w, h] = view.map;
    let u = (p.x - ox) / w;
    if (view.mirror) u = 1 - u;
    return [u, (p.y - oy) / h];
  };
  return {
    s,
    amount,
    anchors,
    ribbons: new Float32Array(ribbons),
    rect: [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)],
    up: [up2.x, up2.y],
    across: [across2.x, across2.y],
    uvCheekA: uv(lerp(P[50], P[205], 0.4)),
    uvCheekB: uv(lerp(P[280], P[425], 0.4)),
    uvBrow: uv(P[151]),
    shade: 0.5,
    face: [faceC.x, faceC.y, 0.62 * s, 0.85 * s],
    soft: 0.15 * g + 0.1 * fp.flush,
    ageTex: Math.min(1, A),
    grey,
    red,
    nose: to2(P[6]),
  };
}
