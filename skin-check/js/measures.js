// From many per-frame raw values to stable scores, levels and kind, plain sentences.
// Each raw value is the robust median across all accepted frames of the scan, so one blink,
// a head turn or a compression glitch can't move the result. Scores are 0–100 on fixed,
// documented scales (no curve fitted to a population, and no single "skin score").

export const MEASURES = ['spots', 'redness', 'shine', 'tone', 'darkCircles', 'lines', 'texture'];

export const NAMES = {
  spots: 'Spots & bumps',
  redness: 'Redness',
  shine: 'Shine / oil',
  tone: 'Even tone & dark spots',
  darkCircles: 'Dark circles',
  lines: 'Fine lines',
  texture: 'Texture',
};

export const HOW = {
  spots: 'We look for small, round-ish patches on your forehead, cheeks and chin that are clearly redder (a*) than the skin right around them, or darker (L*) and bigger than a freckle. Flat brown freckles don’t count, and the nose is left out because its natural pinkness reads as spots. Hairs and stubble are long and thin, so they are left out. Each frame is counted separately and we keep the middle value, so a single shadow can’t add spots.',
  redness: 'We convert each pixel to CIELAB colour and compare a* (the red–green axis) on your cheeks, nose and chin with your own forehead in the same frame. Your forehead sets your skin’s own hue; we count only the shift toward red beyond it, so the camera’s colour and the brightness of the light cancel out. Redness is harder for any camera to see on deeper skin tones, so a low score there is less certain.',
  shine: 'We look for specular highlights: pixels that are much brighter and less colourful than the skin around them, in the T-zone (forehead and nose) and on the cheeks. The score combines how much area shines and how strongly.',
  tone: 'We compare each small patch of skin on your forehead and cheeks with its surroundings in L* (lightness), after removing the slow change in light across your face. Blotchiness is the spread of those differences; spots are compact patches clearly darker than their surroundings.',
  darkCircles: 'We compare L* (lightness) just under each eye with the upper cheek on the same side, as a ΔL*. Overhead light and deep-set eyes add shadow, so face the light for a true reading.',
  lines: 'We filter the skin for fine detail and measure edges running the way lines run: across the forehead, out from the eye corners and along the smile lines. Only the energy in that direction counts, so even camera noise mostly cancels. Normalised to your face size.',
  texture: 'We measure fine, high-frequency variation in L* on your cheeks. Phone cameras smooth and sharpen images, so this one is a rough estimate.',
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const lin = (v, a, b) => clamp(((v - a) / (b - a)) * 100);

// ---- Scales (raw units → 0–100) ----
export const SCALE = {
  rednessDa: [0, 5],         // a* off the forehead's hue line, toward red
  rednessArea: [0.05, 0.6],  // fraction of skin more than 3.5 a* units toward red
  shineFrac: [0.004, 0.09],  // fraction of region that is specular
  blotch: [0.5, 2.2],        // robust SD of mid-scale L* deviations
  spots: [1, 16],            // count of compact darker spots
  blemishes: [1, 12],        // count of compact spots redder or darker than the skin around them
  darkDL: [1, 9],            // ΔL* cheek − under-eye (a 5-unit gap is plainly visible)
  lines: [0.2, 1.1],         // oriented excess gradient, L* per pixel
  texture: [0.4, 1.6],       // robust SD of high-pass L* on cheeks (phone cameras smooth a lot)
};

export function shineScore(s) {
  if (!s || Number.isNaN(s.frac)) return NaN;
  const area = lin(s.frac, ...SCALE.shineFrac);
  const strength = s.frac > 0.003 ? lin(s.int, 9, 30) : 0;
  return clamp(area * 0.8 + strength * 0.2);
}

/** Per-frame scores (used for the spread / steadiness). */
export function frameScores(r) {
  const s = {};
  s.spots = r.blem && Number.isFinite(r.blem.count) ? lin(r.blem.count, ...SCALE.blemishes) : NaN;
  s.redness = Number.isNaN(r.redness.da) ? NaN : clamp(lin(r.redness.da, ...SCALE.rednessDa) * 0.65 + lin(r.redness.area, ...SCALE.rednessArea) * 0.35);
  const sT = shineScore(r.shine.tzone), sC = shineScore(r.shine.cheeks);
  s.shine = Number.isNaN(sT) ? NaN : sT * 0.65 + (Number.isNaN(sC) ? sT : sC) * 0.35;
  // Unevenness in one area (a blotchy forehead) shouldn't be averaged away by smooth cheeks.
  const toneRegs = Object.values(r.tone.regions || {}).filter(Number.isFinite);
  const blotch = Math.max(r.tone.blotch, toneRegs.length ? toneRegs.reduce((a, v) => a + v, 0) / toneRegs.length : 0);
  s.tone = Number.isNaN(r.tone.blotch) ? NaN : clamp(lin(blotch, ...SCALE.blotch) * 0.7 + lin(r.tone.spots, ...SCALE.spots) * 0.3);
  s.darkCircles = Number.isNaN(r.dark.dL) ? NaN : lin(r.dark.dL, ...SCALE.darkDL);
  const l = r.lines;
  const parts = [[l.forehead, 0.4], [l.crow, 0.3], [l.nl, 0.3]].filter(([v]) => !Number.isNaN(v));
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  s.lines = wsum ? parts.reduce((a, [v, w]) => a + lin(v, ...SCALE.lines) * w, 0) / wsum : NaN;
  const texRegs = Object.values(r.texture.regions || {}).filter(Number.isFinite);
  const tex = texRegs.length ? Math.max(r.texture.rms, texRegs.reduce((a, v) => a + v, 0) / texRegs.length) : r.texture.rms;
  s.texture = Number.isNaN(r.texture.rms) ? NaN : lin(tex, ...SCALE.texture);
  return s;
}

function med(a) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
}
function q(a, p) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Median of a path across frames, e.g. pick(frames, r => r.redness.da). */
const pick = (frames, f) => med(frames.map((fr) => { try { return f(fr); } catch { return NaN; } }));

/**
 * Aggregate frames into the result.
 * frames: worker results; each may carry `.weights` = { cheekA, cheekB } visibility (0/1).
 */
export function aggregate(frames) {
  const raw = {
    redness: { da: pick(frames, (r) => r.redness.da), area: pick(frames, (r) => r.redness.area), regions: {} },
    shine: {
      tzone: { frac: pick(frames, (r) => r.shine.tzone.frac), int: pick(frames, (r) => r.shine.tzone.int) },
      cheeks: { frac: pick(frames, (r) => r.shine.cheeks.frac), int: pick(frames, (r) => r.shine.cheeks.int) },
      regions: {},
    },
    blem: { count: pick(frames, (r) => r.blem?.count), regions: {} },
    tone: { blotch: pick(frames, (r) => r.tone.blotch), spots: pick(frames, (r) => r.tone.spots), spotArea: pick(frames, (r) => r.tone.spotArea), regions: {}, spotRegions: {} },
    dark: { dL: pick(frames, (r) => r.dark.dL), regions: {} },
    lines: { forehead: pick(frames, (r) => r.lines.forehead), crow: pick(frames, (r) => r.lines.crow), nl: pick(frames, (r) => r.lines.nl), regions: {} },
    texture: { rms: pick(frames, (r) => r.texture.rms), regions: {} },
  };
  // Per-region values for the face maps; a cheek turned away from the camera doesn't count.
  const vis = (fr, reg) => !fr.weights || fr.weights[reg] !== 0;
  const regionMed = (path, regs) => {
    const out = {};
    for (const reg of regs) out[reg] = med(frames.filter((fr) => vis(fr, reg)).map((fr) => fr[path].regions?.[reg]));
    return out;
  };
  raw.redness.regions = regionMed('redness', ['cheekA', 'cheekB', 'nose', 'chin']);
  raw.shine.regions = regionMed('shine', ['forehead', 'nose', 'cheekA', 'cheekB', 'chin']);
  raw.tone.regions = regionMed('tone', ['forehead', 'cheekA', 'cheekB']);
  for (const reg of ['forehead', 'cheekA', 'cheekB']) raw.tone.spotRegions[reg] = med(frames.map((fr) => fr.tone.spotRegions?.[reg] || 0));
  raw.blem.regions = regionMed('blem', ['forehead', 'cheekA', 'cheekB', 'chin']);
  raw.dark.regions = regionMed('dark', ['underA', 'underB']);
  raw.lines.regions = regionMed('lines', ['forehead', 'crowA', 'crowB', 'nlA', 'nlB']);
  raw.texture.regions = regionMed('texture', ['cheekA', 'cheekB']);

  // Scores from the median raw values; steadiness from the spread of per-frame scores.
  const fake = {
    blem: raw.blem, redness: raw.redness, shine: raw.shine, tone: raw.tone, dark: raw.dark, lines: raw.lines, texture: raw.texture,
  };
  const scores = frameScores(fake);
  const per = frames.map(frameScores);
  const m = {};
  for (const k of MEASURES) {
    const vals = per.map((s) => s[k]).filter(Number.isFinite);
    const iqr = q(vals, 0.75) - q(vals, 0.25);
    // standard error of a median ≈ 1.25·σ/√n, σ ≈ IQR/1.35
    const se = vals.length ? 1.25 * (iqr / 1.35) / Math.sqrt(vals.length) : NaN;
    m[k] = { score: Math.round(scores[k]), spread: Math.round(iqr), se: Math.round(se * 10) / 10, frames: vals.length };
  }
  m.shine.detail = { tzone: Math.round(shineScore(raw.shine.tzone)), cheeks: Math.round(shineScore(raw.shine.cheeks)) };
  return { m, raw };
}

export function level(score) {
  if (!Number.isFinite(score)) return { id: 'na', label: 'Not measured' };
  if (score < 34) return { id: 'low', label: 'Low' };
  if (score < 67) return { id: 'some', label: 'Some' };
  return { id: 'noticeable', label: 'Noticeable' };
}

// ---- Words: neutral, kind, and always something positive the scan saw ----
const listWords = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
const uniq = (a) => [...new Set(a)];
const NICE = { cheekA: 'cheeks', cheekB: 'cheeks', nose: 'nose', chin: 'chin', forehead: 'forehead', underA: 'under-eyes', underB: 'under-eyes', crowA: 'eye corners', crowB: 'eye corners', nlA: 'smile lines', nlB: 'smile lines' };

function topRegions(regions, threshold, max = 2) {
  return uniq(Object.entries(regions).filter(([, v]) => Number.isFinite(v) && v >= threshold).sort((a, b) => b[1] - a[1]).map(([r]) => NICE[r])).slice(0, max);
}
function calmRegions(regions, threshold) {
  return uniq(Object.entries(regions).filter(([, v]) => Number.isFinite(v) && v < threshold).sort((a, b) => a[1] - b[1]).map(([r]) => NICE[r]));
}

export function sentence(k, res) {
  const { m, raw } = res;
  const lv = level(m[k].score).id;
  switch (k) {
    case 'spots': {
      const nSpots = Math.round(raw.blem.count || 0);
      if (lv === 'low') return nSpots ? `Clear-looking skin: only ${nSpots === 1 ? 'one small spot' : `${nSpots} small spots`} stood out.` : 'Clear-looking skin, with no spots standing out.';
      const where = topRegions(raw.blem.regions, 1);
      return `We may have seen about ${nSpots} small spots${where.length ? `, mostly on your ${listWords(where)}` : ''}. Gentle, steady care and not picking help them settle.`;
    }
    case 'redness': {
      const hot = topRegions(raw.redness.regions, 3);
      const calm = calmRegions(raw.redness.regions, 2);
      if (lv === 'low') return 'Your colour looks calm and even, with no redness standing out.';
      const where = hot.length ? ` around your ${listWords(hot)}` : '';
      const pos = calm.length ? ` Your ${listWords(calm.slice(0, 2))} look${calm.length === 1 && !calm[0].endsWith('s') ? 's' : ''} calm.` : ' Your forehead gives a calm baseline.';
      return `${lv === 'some' ? 'Some' : 'Noticeable'} redness${where}.${pos}`;
    }
    case 'shine': {
      const t = m.shine.detail.tzone, c = m.shine.detail.cheeks;
      if (lv === 'low') return 'Very little shine today: your skin looks comfortably balanced.';
      if (t > c + 15) return `${lv === 'some' ? 'Some' : 'Noticeable'} shine across the T-zone, while your cheeks stay matte.`;
      return `${lv === 'some' ? 'Some' : 'Noticeable'} shine on the T-zone and cheeks. A healthy glow often looks like this too.`;
    }
    case 'tone': {
      const spots = Math.round(raw.tone.spots || 0);
      if (lv === 'low') return 'Your tone looks even, with few dark spots.';
      const sp = spots >= 2 ? ` We counted about ${spots} small darker spots.` : '';
      return `${lv === 'some' ? 'Some' : 'Noticeable'} unevenness in tone.${sp} Even tone is one of the most responsive goals to sunscreen and gentle actives.`;
    }
    case 'darkCircles':
      if (lv === 'low') return 'Your under-eyes look close to your cheeks in tone. Nice and rested-looking.';
      return `${lv === 'some' ? 'Some' : 'Noticeable'} darkness under the eyes compared with your cheeks. This is often inherited or from shadow, and very common.`;
    case 'lines': {
      const where = topRegions(raw.lines.regions, 0.55);
      if (lv === 'low') return 'Your skin looks smooth, with few fine lines.';
      return `${lv === 'some' ? 'Some' : 'Noticeable'} fine lines${where.length ? ` at the ${listWords(where)}` : ''}. They’re a normal part of expressive faces.`;
    }
    case 'texture':
      if (lv === 'low') return 'Your cheeks look smooth in texture.';
      return `${lv === 'some' ? 'Some' : 'Noticeable'} fine texture on the cheeks (a rough estimate: cameras vary a lot here).`;
    default: return '';
  }
}

/** Overall: no single score. The top two to focus on, and one positive. */
export function summary(res) {
  const ranked = MEASURES.filter((k) => Number.isFinite(res.m[k].score)).sort((a, b) => res.m[b].score - res.m[a].score);
  // Texture is the least reliable measure, so it only becomes a focus when it's clearly noticeable.
  const focus = ranked.filter((k) => res.m[k].score >= (k === 'texture' ? 67 : 34)).slice(0, 2);
  const best = ranked[ranked.length - 1];
  const POS = {
    spots: 'clear-looking skin', redness: 'calm, even colour', shine: 'a nicely balanced level of oil', tone: 'an even tone', darkCircles: 'bright, rested-looking under-eyes',
    lines: 'smooth skin with few fine lines', texture: 'smooth texture on your cheeks',
  };
  const FOCUS = { spots: 'clearing spots', redness: 'calming redness', shine: 'balancing shine', tone: 'evening out tone', darkCircles: 'brightening under-eyes', lines: 'softening fine lines', texture: 'smoothing texture' };
  let text;
  if (!focus.length) text = 'Nothing stands out today. Keep up sunscreen and gentle care.';
  else if (focus.length === 1) text = `One thing to focus on: ${FOCUS[focus[0]]}.`;
  else text = `Two things to focus on: ${FOCUS[focus[0]]} and ${FOCUS[focus[1]]}.`;
  const positive = best ? `The scan also saw ${POS[best]}.` : '';
  return { text, positive, focus };
}

/** Medical escalation: strong, widespread redness, or many dark spots. */
export function escalation(res) {
  const strongRed = res.m.redness.score >= 70 && (res.raw.redness.area || 0) >= 0.35;
  const manySpots = (res.raw.tone.spots || 0) >= 25;   // freckles alone shouldn't trigger it
  return strongRed || manySpots;
}
