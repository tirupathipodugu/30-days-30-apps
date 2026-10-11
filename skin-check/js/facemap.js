// Mini face maps: a simple drawn face (shown as a mirror, like the camera view) with the regions
// where a measure was seen lit up. Drawn as inline SVG, so it's sharp at any size.

const SHAPES = {
  forehead: '<ellipse cx="50" cy="31" rx="21" ry="8"/>',
  nose: '<path d="M46 52 L54 52 L56 70 Q50 75 44 70 Z"/>',
  cheekA: '<ellipse cx="69" cy="72" rx="10" ry="9"/>',
  cheekB: '<ellipse cx="31" cy="72" rx="10" ry="9"/>',
  underA: '<ellipse cx="63" cy="58" rx="8" ry="2.8"/>',
  underB: '<ellipse cx="37" cy="58" rx="8" ry="2.8"/>',
  crowA: '<ellipse cx="78" cy="50" rx="4" ry="5"/>',
  crowB: '<ellipse cx="22" cy="50" rx="4" ry="5"/>',
  nlA: '<ellipse cx="60" cy="80" rx="2.6" ry="8" transform="rotate(-24 60 80)"/>',
  nlB: '<ellipse cx="40" cy="80" rx="2.6" ry="8" transform="rotate(24 40 80)"/>',
  chin: '<ellipse cx="50" cy="102" rx="11" ry="6"/>',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** intensities: { regionName: 0..1 } */
export function faceMapSVG(intensities, label) {
  const parts = Object.entries(SHAPES).map(([r, shape]) => {
    const v = intensities[r];
    if (v === undefined || !Number.isFinite(v)) return '';
    const o = 0.12 + 0.78 * clamp01(v);
    return `<g class="fm-region" fill="var(--hl)" fill-opacity="${o.toFixed(2)}">${shape}</g>`;
  }).join('');
  return `<svg class="facemap" viewBox="0 0 100 124" role="img" aria-label="${label}">
  <path class="fm-face" d="M50 8 C76 8 88 30 87 58 C86 88 72 116 50 117 C28 116 14 88 13 58 C12 30 24 8 50 8 Z"/>
  ${parts}
  <path class="fm-line" d="M29 46 Q37 42 44 46 M56 46 Q63 42 71 46"/>
  <ellipse class="fm-line" cx="37" cy="52" rx="6" ry="2.6"/><ellipse class="fm-line" cx="63" cy="52" rx="6" ry="2.6"/>
  <path class="fm-line" d="M41 89 Q50 93 59 89"/>
</svg>`;
}

/** Which regions to light up for each measure, from the raw per-region values. */
export function intensitiesFor(k, raw) {
  const out = {};
  const set = (regs, f) => { for (const [r, v] of Object.entries(regs || {})) if (Number.isFinite(v)) out[r] = f(v, r); };
  switch (k) {
    case 'spots': set(raw.blem?.regions, (v) => clamp01(v / 4)); break;
    case 'redness': set(raw.redness.regions, (v) => clamp01(v / 5)); break;
    case 'shine': set(raw.shine.regions, (v) => clamp01(v / 0.08)); break;
    case 'tone':
      set(raw.tone.regions, (v, r) => Math.max(clamp01((v - 0.5) / 1.7), clamp01((raw.tone.spotRegions?.[r] || 0) / 6)));
      break;
    case 'darkCircles': set(raw.dark.regions, (v) => clamp01((v - 1) / 8)); break;
    case 'lines': set(raw.lines.regions, (v) => clamp01((v - 0.2) / 0.9)); break;
    case 'texture': set(raw.texture.regions, (v) => clamp01((v - 0.4) / 1.2)); break;
    default: break;
  }
  return out;
}
