// Measurement worker. Receives one face crop (RGBA, already scaled so the face is a fixed width)
// plus region polygons, and returns raw per-frame values in CIELAB units. The main thread
// averages many frames (robust median) and turns them into scores.
//
// Colour: sRGB (D65) → linear → XYZ → CIELAB. Camera white balance and exposure are unknown, so
// every measure is relative to the person's own baseline regions in the same frame:
//   redness      Δa* of cheeks/nose/chin vs the forehead
//   shine        specular pixels (bright and desaturated vs their own region's median)
//   tone / spots L* deviations from a local mean, after removing the lighting gradient
//   dark circles ΔL* of the under-eye vs the upper cheek on the same side
//   fine lines   oriented high-pass gradient energy across the expected line direction
//   texture      high-frequency L* roughness on the cheeks

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

let buf = null;   // reused arrays sized to the crop

function ensure(n) {
  if (buf && buf.n >= n) return buf;
  buf = {
    n,
    L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n),
    region: new Int8Array(n), skin: new Uint8Array(n), spec: new Uint8Array(n), clip: new Uint8Array(n),
    hp: new Float32Array(n), smooth: new Float32Array(n), spot: new Uint8Array(n), seen: new Uint8Array(n),
  };
  return buf;
}

/** Scanline fill of a polygon: returns the pixel indices inside it. */
function fill(poly, w, h) {
  const out = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) { minY = Math.min(minY, poly[i + 1]); maxY = Math.max(maxY, poly[i + 1]); }
  minY = Math.max(0, Math.ceil(minY)); maxY = Math.min(h - 1, Math.floor(maxY));
  const n = poly.length / 2;
  const xs = [];
  for (let y = minY; y <= maxY; y++) {
    xs.length = 0;
    const yc = y + 0.5;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
      if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) out.push(y * w + x);
    }
  }
  return out;
}

function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = Float32Array.from(arr).sort();
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const median = (a) => quantile(a, 0.5);
function mad(a, m) {
  const dev = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) dev[i] = Math.abs(a[i] - m);
  return median(dev) * 1.4826;
}

/** Box mean over the skin mask using integral images (so hair and eyes don't leak in). */
function maskedBox(src, mask, w, h, r, out) {
  const W = w + 1;
  const S = new Float64Array(W * (h + 1)), C = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) { rs += src[i]; rc++; }
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs;
      C[(y + 1) * W + x + 1] = C[y * W + x + 1] + rc;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) { out[i] = NaN; continue; }
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      const c = C[y1 * W + x1] - C[y0 * W + x1] - C[y1 * W + x0] + C[y0 * W + x0];
      out[i] = c ? s / c : src[i];
    }
  }
  return out;
}

/** Least-squares quadratic surface z = f(x, y) over the given pixels; returns an evaluator. */
function quadFit(list, z, w) {
  if (list.length < 20) return () => 0;
  let cx = 0, cy = 0;
  for (const i of list) { cx += i % w; cy += Math.floor(i / w); }
  cx /= list.length; cy /= list.length;
  let sc = 1;
  for (const i of list) sc = Math.max(sc, Math.abs(i % w - cx), Math.abs(Math.floor(i / w) - cy));
  const feat = (i) => { const x = (i % w - cx) / sc, y = (Math.floor(i / w) - cy) / sc; return [1, x, y, x * x, x * y, y * y]; };
  const A = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const i of list) {
    const f = feat(i), v = z[i];
    for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r][c] += f[r] * f[c]; A[r][6] += f[r] * v; }
  }
  for (let r = 0; r < 6; r++) A[r][r] += 1e-6;
  // Gaussian elimination
  for (let c = 0; c < 6; c++) {
    let piv = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < 6; r++) {
      if (r === c) continue;
      const k = A[r][c] / d;
      for (let k2 = c; k2 < 7; k2++) A[r][k2] -= k * A[c][k2];
    }
  }
  const coef = A.map((row, r) => row[6] / (row[r] || 1e-12));
  return (i) => { const f = feat(i); let v = 0; for (let k = 0; k < 6; k++) v += coef[k] * f[k]; return v; };
}

function analyse(msg) {
  const { width: w, height: h, data, regions, eyes, ed, grad } = msg;
  const n = w * h;
  const b = ensure(n);
  const { L, A, B } = b;
  const px = new Uint8ClampedArray(data);

  // Region pixel lists (first region wins where they overlap; order matters).
  b.region.fill(-1, 0, n);
  const names = Object.keys(regions);
  const idx = {};
  names.forEach((name, k) => {
    idx[name] = fill(regions[name], w, h).filter((i) => {
      if (b.region[i] !== -1) return false;
      b.region[i] = k;
      return true;
    });
  });

  // CIELAB for the pixels we use.
  const lab = (i) => {
    const r = LIN[px[i * 4]], g = LIN[px[i * 4 + 1]], bl = LIN[px[i * 4 + 2]];
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
    b.clip[i] = px[i * 4] >= 250 || px[i * 4 + 1] >= 250 || px[i * 4 + 2] >= 250 ? 1 : 0;
  };
  for (const name of names) for (const i of idx[name]) lab(i);

  // Per-region robust stats and the skin mask: drop hair, brows, lashes and deep shadow (far
  // darker than the region) and flag specular highlights (far brighter and less colourful).
  b.skin.fill(0, 0, n); b.spec.fill(0, 0, n);
  const stats = {};
  for (const name of names) {
    const list = idx[name];
    if (list.length < 30) { stats[name] = null; continue; }
    const Ls = list.map((i) => L[i]);
    const Cs = list.map((i) => Math.hypot(A[i], B[i]));
    const Lm = median(Ls), Ld = Math.max(1.5, mad(Ls, Lm));
    const Cm = median(Cs);
    const darkCut = Lm - Math.max(10, 3 * Ld);
    const specCut = Lm + Math.max(9, 2.2 * Ld);
    let specN = 0, specSum = 0, clipN = 0;
    const skinL = [], skinA = [], skinB = [];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (b.clip[i]) clipN++;
      if (L[i] < darkCut) continue;
      if (L[i] > specCut && Cs[k] < Cm * 0.85) { b.spec[i] = 1; specN++; specSum += L[i] - Lm; continue; }
      if (b.clip[i]) continue;
      b.skin[i] = 1;
      skinL.push(L[i]); skinA.push(A[i]); skinB.push(B[i]);
    }
    stats[name] = {
      n: list.length, skinN: skinL.length,
      L: median(skinL), a: median(skinA), b: median(skinB),
      p10: quantile(skinL, 0.1), p90: quantile(skinL, 0.9),
      spec: specN / list.length, specInt: specN ? specSum / specN : 0,
      clip: clipN / list.length,
    };
  }
  const ok = (r) => stats[r] && stats[r].skinN > 40;

  // ---- Light check values ----
  let eyeL = [];
  for (const side of ['A', 'B']) {
    for (const i of fill(eyes[side], w, h)) {
      if (b.region[i] === -1) lab(i);   // eye pixels aren't in any region
      eyeL.push(L[i]);
    }
  }
  const faceRegions = ['forehead', 'cheekA', 'cheekB', 'nose', 'chin'].filter(ok);
  const faceLs = [];
  let clipAll = 0, nAll = 0;
  for (const r of faceRegions) {
    for (const i of idx[r]) { if (b.skin[i]) faceLs.push(L[i]); clipAll += b.clip[i]; nAll++; }
  }
  // Evenness compares the inner halves of the cheeks (next to the nose). The outer cheek turns
  // away from the camera and is darker for any light, so it would exaggerate small side light.
  const innerL = (r, innerIsRight) => {
    if (!ok(r)) return NaN;
    const list = idx[r].filter((i) => b.skin[i]);
    const xs = list.map((i) => i % w);
    const xm = median(xs);
    return median(list.filter((i, k) => (innerIsRight ? xs[k] >= xm : xs[k] <= xm)).map((i) => L[i]));
  };
  const light = {
    faceL: median(faceLs),
    eyeRef: quantile(eyeL, 0.9),
    cheekA: innerL('cheekA', true),
    cheekB: innerL('cheekB', false),
    spreadA: ok('cheekA') ? stats.cheekA.p90 - stats.cheekA.p10 : NaN,
    spreadB: ok('cheekB') ? stats.cheekB.p90 - stats.cheekB.p10 : NaN,
    clip: nAll ? clipAll / nAll : 0,
  };

  // ---- Redness: a* vs the forehead, on the forehead's own hue line ----
  // The forehead's (a*, b*) sets this person's skin hue. A patch that is simply more saturated
  // (brighter light, shade, a tan) moves along that line; redness rotates it toward +a*. So we
  // measure the part of a patch's colour that sits off the line, toward red (in a* units):
  //   red = (a·b_ref − b·a_ref) / C_ref
  // This cancels camera white balance and light intensity, which scale the whole face together.
  const redness = { regions: {} };
  if (ok('forehead')) {
    const aRef = stats.forehead.a, bRef = stats.forehead.b;
    const cRef = Math.hypot(aRef, bRef) || 1;
    const off = (a, bb) => (a * bRef - bb * aRef) / cRef;
    let sum = 0, wsum = 0, hot = 0, tot = 0;
    for (const r of ['cheekA', 'cheekB', 'nose', 'chin']) {
      if (!ok(r)) continue;
      const da = off(stats[r].a, stats[r].b);
      redness.regions[r] = da;
      sum += da * stats[r].skinN; wsum += stats[r].skinN;
      for (const i of idx[r]) if (b.skin[i]) { tot++; if (off(A[i], B[i]) > 3.5) hot++; }
    }
    redness.da = wsum ? sum / wsum : NaN;
    redness.area = tot ? hot / tot : NaN;
    redness.aRef = aRef;
  }

  // ---- Shine ----
  const specOf = (rs) => {
    let s = 0, nn = 0, it = 0, cnt = 0;
    for (const r of rs) if (stats[r]) { s += stats[r].spec * stats[r].n; nn += stats[r].n; if (stats[r].spec > 0) { it += stats[r].specInt; cnt++; } }
    return { frac: nn ? s / nn : NaN, int: cnt ? it / cnt : 0 };
  };
  const shine = { tzone: specOf(['forehead', 'nose']), cheeks: specOf(['cheekA', 'cheekB']), regions: {} };
  for (const r of ['forehead', 'nose', 'cheekA', 'cheekB', 'chin']) if (stats[r]) shine.regions[r] = stats[r].spec;

  // ---- Tone evenness and spots (cheeks + forehead) ----
  const r1 = Math.max(3, Math.round(0.13 * ed));   // local scale (a spot is smaller than this)
  const toneRegions = ['forehead', 'cheekA', 'cheekB'].filter(ok);
  const toneMask = new Uint8Array(n);
  for (const r of toneRegions) for (const i of idx[r]) if (b.skin[i]) toneMask[i] = 1;
  const m1 = maskedBox(L, toneMask, w, h, r1, new Float32Array(n));
  const tone = { regions: {} };
  {
    const mids = [];
    const resid = [];
    for (const r of toneRegions) {
      // Remove the smooth fall of light across the region (a quadratic surface fitted to the
      // local means), so face curvature and side light don't count as uneven tone.
      const list = idx[r].filter((i) => toneMask[i]);
      const fit = quadFit(list, m1, w);
      const rm = [];
      for (const i of list) { rm.push(m1[i] - fit(i)); resid.push(L[i] - m1[i]); }
      mids.push(...rm);
      tone.regions[r] = mad(rm, median(rm));
    }
    tone.blotch = mids.length ? mad(mids, median(mids)) : NaN;
    // Spots: connected clusters clearly darker than their local mean.
    const sd = resid.length ? mad(resid, median(resid)) : 1;
    const cut = -Math.max(3.5, 2.6 * sd);
    b.spot.fill(0, 0, n);
    for (const r of toneRegions) for (const i of idx[r]) if (toneMask[i] && L[i] - m1[i] < cut) b.spot[i] = 1;
    const minA = Math.max(5, Math.round(0.00025 * ed * ed)), maxA = Math.round(0.03 * ed * ed);
    b.seen.fill(0, 0, n);
    let count = 0, area = 0;
    const stack = [];
    const perRegion = {};
    for (let i = 0; i < n; i++) {
      if (!b.spot[i] || b.seen[i]) continue;
      let size = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, depth = 0, chroma = 0;
      stack.push(i); b.seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = j % w, y = (j - x) / w;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        depth += m1[j] - L[j]; chroma += Math.hypot(A[j], B[j]);
        for (const k of [j - 1, j + 1, j - w, j + w]) {
          if (k >= 0 && k < n && b.spot[k] && !b.seen[k] && Math.abs((k % w) - x) <= 1) { b.seen[k] = 1; stack.push(k); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const elong = Math.max(bw, bh) / Math.min(bw, bh);
      const fillRatio = size / (bw * bh);
      // Hairs and lash shadows are long and thin; real spots are compact.
      if (size >= minA && size <= maxA && elong < 3 && fillRatio > 0.3) {
        count++; area += size;
        const reg = names[b.region[i]];
        perRegion[reg] = (perRegion[reg] || 0) + 1;
      }
    }
    let toneN = 0;
    for (const r of toneRegions) toneN += stats[r].skinN;
    tone.spots = count;
    tone.spotArea = toneN ? area / toneN : 0;
    tone.spotRegions = perRegion;
  }

  // ---- Spots & bumps: small, compact patches redder OR darker than the skin right around them ----
  // A breakout can show red on lighter skin and darker or brown on deeper skin, so both count.
  const blem = { count: NaN, regions: {} };
  {
    // Not the nose: its natural pinkness and the shadows at the nostrils read as spots.
    const regs = ['forehead', 'cheekA', 'cheekB', 'chin'].filter(ok);
    if (regs.length) {
      const mask = new Uint8Array(n);
      for (const r of regs) for (const i of idx[r]) if (b.skin[i] && !b.spec[i]) mask[i] = 1;
      const mA = maskedBox(A, mask, w, h, r1, new Float32Array(n));
      const mL = maskedBox(L, mask, w, h, r1, new Float32Array(n));
      const mB = maskedBox(B, mask, w, h, r1, new Float32Array(n));
      const dA = [], dL = [];
      for (const r of regs) for (const i of idx[r]) if (mask[i]) { dA.push(A[i] - mA[i]); dL.push(L[i] - mL[i]); }
      const sdA = Math.max(0.6, mad(dA, median(dA))), sdL = Math.max(0.8, mad(dL, median(dL)));
      const cutA = Math.max(2.2, 2.4 * sdA), cutL = -Math.max(3, 2.4 * sdL);
      b.spot.fill(0, 0, n);
      for (const r of regs) for (const i of idx[r]) if (mask[i] && (A[i] - mA[i] > cutA || L[i] - mL[i] < cutL)) b.spot[i] = 1;
      const minA = Math.max(4, Math.round(0.0002 * ed * ed)), maxA = Math.round(0.03 * ed * ed);
      const bigA = Math.max(minA * 3, Math.round(0.0009 * ed * ed));
      b.seen.fill(0, 0, n);
      let count = 0;
      const stack = [];
      for (let i = 0; i < n; i++) {
        if (!b.spot[i] || b.seen[i]) continue;
        let size = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, red = 0, yel = 0;
        stack.push(i); b.seen[i] = 1;
        while (stack.length) {
          const j = stack.pop();
          size++;
          red += A[j] - mA[j]; yel += B[j] - mB[j];
          const x = j % w, y = (j - x) / w;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          for (const k of [j - 1, j + 1, j - w, j + w]) {
            if (k >= 0 && k < n && b.spot[k] && !b.seen[k] && Math.abs((k % w) - x) <= 1) { b.seen[k] = 1; stack.push(k); }
          }
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        // Freckles are flat, brown and tiny; a breakout is redder than the skin around it, or a larger
        // dark mark. So a spot counts if it's clearly red, or dark and bigger than a freckle.
        // Red, not brown: the shift toward red must beat the shift toward yellow (brown = both).
        const reddish = red / size > 1.5 && red > 1.3 * Math.max(0, yel);
        const bigDark = size >= bigA;
        // Hairs, stubble and pore lines are long and thin; spots are round-ish.
        if ((reddish || bigDark) && size >= minA && size <= maxA && Math.max(bw, bh) / Math.min(bw, bh) < 2.6 && size / (bw * bh) > 0.35) {
          count++;
          const reg = names[b.region[i]];
          blem.regions[reg] = (blem.regions[reg] || 0) + 1;
        }
      }
      blem.count = count;
    }
  }

  // ---- Dark circles: under-eye vs upper cheek, per side ----
  const dark = { regions: {} };
  {
    const vals = [];
    for (const [u, c] of [['underA', 'cheekA'], ['underB', 'cheekB']]) {
      if (!ok(u) || !ok(c)) continue;
      // The upper half of the cheek is the closest comparison (same light, just below).
      const list = idx[c].filter((i) => b.skin[i]);
      const ys = list.map((i) => Math.floor(i / w));
      const yMid = median(ys);
      const upper = list.filter((i, k) => ys[k] <= yMid).map((i) => L[i]);
      const dL = median(upper) - stats[u].L;
      dark.regions[u] = dL;
      vals.push({ dL, wgt: stats[u].skinN });
    }
    const wsum = vals.reduce((s, v) => s + v.wgt, 0);
    dark.dL = wsum ? vals.reduce((s, v) => s + v.dL * v.wgt, 0) / wsum : NaN;
  }

  // ---- Fine lines and texture: high-pass L*, then oriented gradient energy ----
  // smooth = 3×3 box of L (sensor noise), hp = smooth − 5-px-radius local mean (removes lighting).
  const lineRegions = ['forehead', 'crowA', 'crowB', 'nlA', 'nlB', 'cheekA', 'cheekB'].filter((r) => stats[r]);
  const lineMask = new Uint8Array(n);
  for (const r of lineRegions) for (const i of idx[r]) if (L[i] > (stats[r].L - Math.max(14, 4 * 2))) lineMask[i] = 1;
  // pixels around the regions too, so the kernels have support at the edges
  const sm = maskedBox(L, lineMask, w, h, 1, b.smooth);
  const rHP = Math.max(3, Math.round(0.05 * ed));
  const lo = maskedBox(sm, lineMask, w, h, rHP, new Float32Array(n));
  for (let i = 0; i < n; i++) b.hp[i] = lineMask[i] ? sm[i] - lo[i] : NaN;
  const hp = b.hp;
  const lines = { regions: {} };
  const energy = (r, g) => {
    let eo = 0, ep = 0, cnt = 0;
    for (const i of idx[r]) {
      const x = i % w;
      if (x < 1 || x >= w - 1 || i < w || i >= n - w) continue;
      const v = [i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1].map((k) => hp[k]);
      if (v.some(Number.isNaN)) continue;
      const gx = (v[2] + 2 * v[4] + v[7] - v[0] - 2 * v[3] - v[5]) / 8;
      const gy = (v[5] + 2 * v[6] + v[7] - v[0] - 2 * v[1] - v[2]) / 8;
      if (g) {
        const o = gx * g[0] + gy * g[1], p = -gx * g[1] + gy * g[0];
        eo += o * o; ep += p * p;
      } else { eo += gx * gx + gy * gy; }
      cnt++;
    }
    return cnt > 30 ? { eo: eo / cnt, ep: ep / cnt } : null;
  };
  for (const r of ['forehead', 'crowA', 'crowB', 'nlA', 'nlB']) {
    if (!stats[r]) continue;
    const en = energy(r, grad[r]);
    if (en) lines.regions[r] = Math.sqrt(Math.max(0, en.eo - en.ep));   // L* per pixel, oriented excess
  }
  const lr = lines.regions;
  const pair = (a, c) => [lr[a], lr[c]].filter((x) => x !== undefined);
  const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  lines.forehead = lr.forehead ?? NaN;
  lines.crow = meanOf(pair('crowA', 'crowB'));
  lines.nl = meanOf(pair('nlA', 'nlB'));

  // Texture: RMS of the high-pass on cheek skin (not spots or highlights).
  const texture = { regions: {} };
  {
    const vals = [];
    for (const r of ['cheekA', 'cheekB']) {
      if (!ok(r)) continue;
      const rv = [];
      for (const i of idx[r]) if (b.skin[i] && !b.spot[i] && !Number.isNaN(hp[i])) rv.push(hp[i]);
      const s = mad(rv, median(rv));
      texture.regions[r] = s;
      vals.push(s);
    }
    texture.rms = meanOf(vals);
  }

  const counts = {};
  for (const name of names) counts[name] = stats[name] ? stats[name].skinN : 0;
  const colour = {};
  for (const name of names) if (stats[name]) colour[name] = [stats[name].L, stats[name].a, stats[name].b].map((v) => Math.round(v * 10) / 10);
  return { light, redness, shine, tone, blem, dark, lines, texture, counts, colour };
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type !== 'frame') return;
  let result = null, error = null;
  try {
    result = analyse(msg);
  } catch (err) {
    error = String(err && err.stack || err);
  }
  self.postMessage({ type: 'result', id: msg.id, result, error });
};
