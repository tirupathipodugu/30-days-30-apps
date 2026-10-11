// Draws the 20 sample products as product-style SVG renders on white (our own artwork, no third-party photos).
// usage: node tools/make-catalog.mjs   -> writes assets/catalog/*.svg
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'catalog');
mkdirSync(OUT, { recursive: true });

const svg = (defs, body, w = 800, h = 800) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<defs>${defs}</defs><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>\n`;

const lin = (id, stops, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
  stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') + '</linearGradient>';
const rad = (id, stops, cx = 0.35, cy = 0.3, r = 0.75) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">` +
  stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') + '</radialGradient>';

// ---------- glasses ----------
// A lens outline centred on (cx, cy), drawn for the left lens; `flip` mirrors it for the right lens.
function lensPath(style, cx, cy, w, h, flip) {
  const s = flip ? -1 : 1;
  const X = (u) => cx + s * u * w / 2;   // u in [-1, 1], -1 = nose side for the right lens after flip
  const Y = (v) => cy + v * h / 2;
  // outer = temple side (u = -1 for the left lens), inner = nose side (u = +1)
  switch (style) {
    case 'round':
      return `M${X(0)} ${Y(-1)} C${X(0.56)} ${Y(-1)} ${X(1)} ${Y(-0.56)} ${X(1)} ${Y(0)} C${X(1)} ${Y(0.56)} ${X(0.56)} ${Y(1)} ${X(0)} ${Y(1)} C${X(-0.56)} ${Y(1)} ${X(-1)} ${Y(0.56)} ${X(-1)} ${Y(0)} C${X(-1)} ${Y(-0.56)} ${X(-0.56)} ${Y(-1)} ${X(0)} ${Y(-1)}Z`;
    case 'aviator':
      return `M${X(-0.95)} ${Y(-0.85)} C${X(-0.3)} ${Y(-1.02)} ${X(0.6)} ${Y(-1.0)} ${X(0.95)} ${Y(-0.8)} C${X(1.08)} ${Y(-0.55)} ${X(0.9)} ${Y(0.05)} ${X(0.55)} ${Y(0.55)} C${X(0.25)} ${Y(1.0)} ${X(-0.35)} ${Y(1.08)} ${X(-0.72)} ${Y(0.72)} C${X(-1.05)} ${Y(0.38)} ${X(-1.08)} ${Y(-0.45)} ${X(-0.95)} ${Y(-0.85)}Z`;
    case 'wayfarer':
      return `M${X(-1)} ${Y(-1)} L${X(0.95)} ${Y(-0.92)} C${X(1.02)} ${Y(-0.6)} ${X(0.95)} ${Y(0.3)} ${X(0.7)} ${Y(0.8)} C${X(0.5)} ${Y(1.02)} ${X(-0.4)} ${Y(1.05)} ${X(-0.72)} ${Y(0.8)} C${X(-0.95)} ${Y(0.5)} ${X(-1.02)} ${Y(-0.4)} ${X(-1)} ${Y(-1)}Z`;
    case 'cateye':
      return `M${X(-1.08)} ${Y(-1.15)} C${X(-0.4)} ${Y(-0.95)} ${X(0.6)} ${Y(-0.95)} ${X(0.95)} ${Y(-0.7)} C${X(1.05)} ${Y(-0.2)} ${X(0.85)} ${Y(0.7)} ${X(0.35)} ${Y(0.95)} C${X(-0.1)} ${Y(1.08)} ${X(-0.65)} ${Y(0.85)} ${X(-0.85)} ${Y(0.4)} C${X(-0.98)} ${Y(0.05)} ${X(-1.0)} ${Y(-0.6)} ${X(-1.08)} ${Y(-1.15)}Z`;
    case 'rect':
    default:
      return `M${X(-1)} ${Y(-0.85)} C${X(-1)} ${Y(-1)} ${X(-0.9)} ${Y(-1)} ${X(-0.8)} ${Y(-1)} L${X(0.82)} ${Y(-1)} C${X(0.96)} ${Y(-1)} ${X(1)} ${Y(-0.92)} ${X(1)} ${Y(-0.75)} L${X(0.98)} ${Y(0.6)} C${X(0.96)} ${Y(0.95)} ${X(0.85)} ${Y(1)} ${X(0.65)} ${Y(1)} L${X(-0.7)} ${Y(1)} C${X(-0.92)} ${Y(1)} ${X(-1)} ${Y(0.9)} ${X(-1)} ${Y(0.6)}Z`;
  }
}

function glasses({ style, frame, frameWidth, lens, lensW = 250, lensH = 190, gap = 64, aviatorBar = false }) {
  const cy = 400, lx = 400 - gap / 2 - lensW / 2, rx = 400 + gap / 2 + lensW / 2;
  const defs =
    lin('fr', frame) +
    lin('ln', lens) +
    lin('gl', [[0, '#fff', 0.55], [0.35, '#fff', 0.08], [1, '#fff', 0]], 1, 1);
  const L = lensPath(style, lx, cy, lensW, lensH, false);
  const R = lensPath(style, rx, cy, lensW, lensH, true);
  const topY = cy - lensH / 2 + (style === 'cateye' ? -6 : 6);
  const bridge = `M${lx + lensW / 2 - 4} ${topY + 18} C${400 - 22} ${topY - 8} ${400 + 22} ${topY - 8} ${rx - lensW / 2 + 4} ${topY + 18}`;
  const bar = aviatorBar ? `<path d="M${lx - 30} ${cy - lensH / 2 - 4} C${lx + 60} ${cy - lensH / 2 - 26} ${rx - 60} ${cy - lensH / 2 - 26} ${rx + 30} ${cy - lensH / 2 - 4}" fill="none" stroke="url(#fr)" stroke-width="${frameWidth * 0.55}" stroke-linecap="round"/>` : '';
  const hinge = (x, dir) => `<rect x="${dir < 0 ? x - 34 : x + 2}" y="${cy - lensH / 2 + 4}" width="32" height="${frameWidth + 12}" rx="${(frameWidth + 12) / 3}" fill="url(#fr)"/>`;
  const outerL = lx - lensW / 2, outerR = rx + lensW / 2;
  const shine = (x) => `<path d="M${x - lensW * 0.32} ${cy - lensH * 0.32} L${x - lensW * 0.12} ${cy - lensH * 0.38} L${x - lensW * 0.36} ${cy + lensH * 0.2} L${x - lensW * 0.44} ${cy + lensH * 0.1}Z" fill="url(#gl)"/>`;
  const body =
    `<path d="${L}" fill="url(#ln)"/><path d="${R}" fill="url(#ln)"/>` + shine(lx) + shine(rx) +
    `<path d="${L}" fill="none" stroke="url(#fr)" stroke-width="${frameWidth}" stroke-linejoin="round"/>` +
    `<path d="${R}" fill="none" stroke="url(#fr)" stroke-width="${frameWidth}" stroke-linejoin="round"/>` +
    `<path d="${bridge}" fill="none" stroke="url(#fr)" stroke-width="${frameWidth * 0.8}" stroke-linecap="round"/>` + bar +
    hinge(outerL, -1) + hinge(outerR, 1);
  return svg(defs, body);
}

// ---------- caps and hats ----------
function cap({ base, dark, light }) {
  const defs =
    rad('cr', [[0, light], [0.55, base], [1, dark]], 0.42, 0.25, 0.85) +
    lin('br', [[0, dark], [0.5, base], [1, dark]], 1, 0) +
    lin('un', [[0, '#000', 0.5], [1, '#000', 0]]);
  const body =
    `<path d="M150 470 C150 250 260 165 400 165 C540 165 650 250 650 470 Z" fill="url(#cr)"/>` +
    `<path d="M400 168 L400 470 M282 205 C250 300 240 390 246 470 M518 205 C550 300 560 390 554 470" stroke="#000" stroke-opacity=".22" stroke-width="3" fill="none"/>` +
    `<path d="M300 300 Q 400 280 500 300" stroke="#fff" stroke-opacity=".08" stroke-width="40" fill="none"/>` +
    `<ellipse cx="400" cy="170" rx="22" ry="11" fill="${dark}"/>` +
    `<path d="M140 468 C220 452 580 452 660 468 L660 482 C580 470 220 470 140 482Z" fill="${dark}"/>` +
    `<path d="M120 485 C240 455 560 455 680 485 C640 560 520 600 400 600 C280 600 160 560 120 485Z" fill="url(#br)"/>` +
    `<path d="M140 488 C250 468 550 468 660 488 C600 500 500 505 400 505 C300 505 200 500 140 488Z" fill="url(#un)"/>` +
    `<path d="M150 500 C260 560 540 560 650 500" stroke="#fff" stroke-opacity=".12" stroke-width="3" fill="none" stroke-dasharray="7 7"/>`;
  return svg(defs, body);
}

function fedora({ felt, dark, band }) {
  const defs = rad('fc', [[0, felt], [1, dark]], 0.45, 0.3, 0.9) + lin('fb', [[0, dark], [0.5, felt], [1, dark]], 1, 0);
  const body =
    `<path d="M70 470 C70 430 230 418 400 418 C570 418 730 430 730 470 C730 520 570 540 400 540 C230 540 70 520 70 470Z" fill="url(#fb)"/>` +
    `<path d="M220 452 C215 330 240 230 300 215 C340 205 360 245 400 245 C440 245 460 205 500 215 C560 230 585 330 580 452 C480 470 320 470 220 452Z" fill="url(#fc)"/>` +
    `<path d="M220 400 C320 418 480 418 580 400 L580 452 C480 470 320 470 220 452Z" fill="${band}"/>` +
    `<path d="M340 240 C370 300 430 300 460 240" stroke="#000" stroke-opacity=".25" stroke-width="5" fill="none"/>`;
  return svg(defs, body);
}

function bucket({ base, dark, light }) {
  const defs = rad('bc', [[0, light], [1, dark]], 0.45, 0.3, 0.9) + lin('bb', [[0, dark], [0.5, base], [1, dark]], 1, 0);
  const body =
    `<path d="M110 540 C170 450 250 440 400 440 C550 440 630 450 690 540 C600 585 200 585 110 540Z" fill="url(#bb)"/>` +
    `<path d="M240 455 C245 330 270 230 400 225 C530 230 555 330 560 455 C480 470 320 470 240 455Z" fill="url(#bc)"/>` +
    `<path d="M150 528 C260 560 540 560 650 528" stroke="#000" stroke-opacity=".2" stroke-width="3" fill="none" stroke-dasharray="8 6"/>` +
    `<path d="M250 410 C340 425 460 425 550 410" stroke="#000" stroke-opacity=".2" stroke-width="3" fill="none" stroke-dasharray="8 6"/>`;
  return svg(defs, body);
}

// ---------- earrings (a pair, side by side) ----------
const GOLD = [[0, '#fff3c4'], [0.35, '#e2b65a'], [0.7, '#a8761f'], [1, '#f2d27c']];
const SILVER = [[0, '#ffffff'], [0.35, '#c9ced6'], [0.7, '#7d848f'], [1, '#e6e9ee']];

function earrings(kind) {
  let defs = lin('m', GOLD, 1, 1) + lin('s', SILVER, 1, 1) + rad('p', [[0, '#ffffff'], [0.5, '#f1ece2'], [0.85, '#cfc6b8'], [1, '#b8ad9c']], 0.38, 0.32, 0.75);
  const one = (cx) => {
    switch (kind) {
      case 'hoop':
        return `<path d="M${cx} 250 v22" stroke="#c99a3e" stroke-width="7" stroke-linecap="round"/>` +
          `<ellipse cx="${cx}" cy="390" rx="105" ry="115" fill="none" stroke="url(#m)" stroke-width="20"/>`;
      case 'pearl':
        return `<path d="M${cx} 250 C${cx - 28} 250 ${cx - 28} 290 ${cx} 300" fill="none" stroke="url(#m)" stroke-width="6" stroke-linecap="round"/>` +
          `<circle cx="${cx}" cy="306" r="13" fill="url(#m)"/><path d="M${cx} 318 v26" stroke="#c99a3e" stroke-width="5"/>` +
          `<circle cx="${cx}" cy="400" r="58" fill="url(#p)"/>`;
      case 'stud':
        return `<g transform="translate(${cx} 380)"><circle r="56" fill="url(#s)"/>` +
          `<polygon points="0,-44 31,-31 44,0 31,31 0,44 -31,31 -44,0 -31,-31" fill="#eef5ff"/>` +
          `<polygon points="0,-44 31,-31 0,0" fill="#ffffff"/><polygon points="44,0 31,31 0,0" fill="#c9d6ea"/>` +
          `<polygon points="-44,0 -31,-31 0,0" fill="#dfe9f7"/><polygon points="0,44 -31,31 0,0" fill="#b5c3da"/>` +
          `<circle r="10" fill="#fff"/></g>`;
      case 'drop':
      default:
        return `<path d="M${cx} 180 C${cx - 26} 180 ${cx - 26} 214 ${cx} 222" fill="none" stroke="url(#m)" stroke-width="6" stroke-linecap="round"/>` +
          `<circle cx="${cx}" cy="230" r="10" fill="url(#m)"/>` +
          `<path d="M${cx} 240 v130" stroke="#c99a3e" stroke-width="4" stroke-dasharray="7 4"/>` +
          `<path d="M${cx} 370 C${cx + 48} 440 ${cx + 46} 560 ${cx} 590 C${cx - 46} 560 ${cx - 48} 440 ${cx} 370Z" fill="url(#m)"/>` +
          `<path d="M${cx - 8} 420 C${cx - 22} 470 ${cx - 20} 530 ${cx - 6} 560" stroke="#fff" stroke-opacity=".6" stroke-width="5" fill="none"/>`;
    }
  };
  return svg(defs, one(250) + one(550));
}

// ---------- watches and bracelets (strap vertical) ----------
function watch({ caseStops, dial, strap, strapDark, hands = '#f4f4f4', links = false }) {
  const defs = lin('cs', caseStops, 1, 1) + rad('dl', dial, 0.4, 0.35, 0.8) + lin('st', [[0, strapDark], [0.5, strap], [1, strapDark]], 1, 0);
  let straps;
  if (links) {
    straps = '';
    for (let y = 40; y < 760; y += 34) {
      if (y > 240 && y < 560) continue;
      straps += `<rect x="318" y="${y}" width="164" height="30" rx="6" fill="url(#cs)"/><rect x="380" y="${y}" width="40" height="30" fill="#000" fill-opacity=".12"/>`;
    }
  } else {
    straps = `<path d="M325 20 L475 20 L478 280 L322 280Z" fill="url(#st)"/><path d="M322 520 L478 520 L475 780 L325 780Z" fill="url(#st)"/>` +
      `<path d="M335 20 v260 M465 20 v260 M335 520 v260 M465 520 v260" stroke="#fff" stroke-opacity=".18" stroke-width="2" stroke-dasharray="6 5"/>` +
      `<rect x="372" y="640" width="56" height="10" rx="5" fill="#000" fill-opacity=".35"/><rect x="372" y="680" width="56" height="10" rx="5" fill="#000" fill-opacity=".35"/>`;
  }
  let idx = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r1 = i % 3 ? 112 : 100, r2 = 128;
    idx += `<line x1="${400 + Math.sin(a) * r1}" y1="${400 - Math.cos(a) * r1}" x2="${400 + Math.sin(a) * r2}" y2="${400 - Math.cos(a) * r2}" stroke="${hands}" stroke-width="${i % 3 ? 3 : 6}" stroke-linecap="round"/>`;
  }
  const body = straps +
    `<path d="M300 250 L500 250 L520 300 L520 500 L500 550 L300 550 L280 500 L280 300Z" fill="url(#cs)"/>` +
    `<rect x="538" y="380" width="26" height="40" rx="6" fill="url(#cs)"/>` +
    `<circle cx="400" cy="400" r="168" fill="url(#cs)"/><circle cx="400" cy="400" r="150" fill="#1b1d22"/>` +
    `<circle cx="400" cy="400" r="142" fill="url(#dl)"/>` + idx +
    `<line x1="400" y1="400" x2="350" y2="330" stroke="${hands}" stroke-width="8" stroke-linecap="round"/>` +
    `<line x1="400" y1="400" x2="480" y2="300" stroke="${hands}" stroke-width="5" stroke-linecap="round"/>` +
    `<line x1="400" y1="430" x2="400" y2="290" stroke="#d94a3a" stroke-width="2"/>` +
    `<circle cx="400" cy="400" r="9" fill="${hands}"/>` +
    `<path d="M300 300 C340 250 420 240 470 262" stroke="#fff" stroke-opacity=".22" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  return svg(defs, body);
}

function bracelet(kind) {
  const defs = lin('m', kind === 'chain' ? SILVER : GOLD, 1, 1) +
    rad('bd', [[0, '#7c8a96'], [0.6, '#3d4650'], [1, '#1d2329']], 0.35, 0.3, 0.8) +
    rad('bd2', [[0, '#e9d3a7'], [0.6, '#b88d4c'], [1, '#6e4f22']], 0.35, 0.3, 0.8);
  let body = '';
  const n = kind === 'chain' ? 30 : 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = 400 + Math.cos(a) * 260, y = 400 + Math.sin(a) * 150;
    if (kind === 'chain') {
      const rot = (Math.atan2(Math.cos(a) * 150, -Math.sin(a) * 260) * 180) / Math.PI;
      body += `<ellipse cx="${x}" cy="${y}" rx="30" ry="17" fill="none" stroke="url(#m)" stroke-width="10" transform="rotate(${rot} ${x} ${y})"/>`;
    } else {
      body += `<circle cx="${x}" cy="${y}" r="${i % 6 === 0 ? 40 : 34}" fill="url(#${i % 6 === 0 ? 'bd2' : 'bd'})"/>`;
    }
  }
  return svg(defs, body);
}

const files = {
  'aviator-gold.svg': glasses({ style: 'aviator', frame: GOLD, frameWidth: 9, lens: [[0, '#3c5a46', 0.96], [1, '#1d2a22', 0.96]], aviatorBar: true }),
  'wayfarer-black.svg': glasses({ style: 'wayfarer', frame: [[0, '#3a3a3e'], [0.4, '#0d0d0f'], [1, '#1c1c20']], frameWidth: 26, lens: [[0, '#2a2c30'], [1, '#0f1012']] }),
  'round-tortoise.svg': glasses({ style: 'round', frame: [[0, '#6b3d1c'], [0.3, '#2b1608'], [0.55, '#8a5427'], [0.8, '#3a1d0b'], [1, '#6b3d1c']], frameWidth: 18, lens: [[0, '#ffffff'], [1, '#ffffff']], lensW: 220, lensH: 210, gap: 70 }),
  'crystal-clear.svg': glasses({ style: 'rect', frame: [[0, '#d3dae3'], [0.5, '#9aa5b3'], [1, '#c4ccd6']], frameWidth: 22, lens: [[0, '#ffffff'], [1, '#ffffff']], lensH: 170 }),
  'cateye-black.svg': glasses({ style: 'cateye', frame: [[0, '#2b2b2f'], [0.5, '#050506'], [1, '#232327']], frameWidth: 22, lens: [[0, '#4a3a36', 0.95], [1, '#1a1210', 0.95]] }),
  'titanium-rect.svg': glasses({ style: 'rect', frame: [[0, '#9aa3ae'], [0.5, '#56606c'], [1, '#a9b2bd']], frameWidth: 7, lens: [[0, '#ffffff'], [1, '#ffffff']], lensH: 160 }),
  'sport-blue.svg': glasses({ style: 'wayfarer', frame: [[0, '#4b5563'], [0.5, '#111827'], [1, '#374151']], frameWidth: 16, lens: [[0, '#2f6ea8', 0.95], [0.6, '#1b3f6b', 0.95], [1, '#3b2a6b', 0.95]], lensW: 270, lensH: 170, gap: 40 }),
  'cap-navy.svg': cap({ base: '#1f2b46', dark: '#0d1424', light: '#33456b' }),
  'cap-black.svg': cap({ base: '#1c1c1f', dark: '#08080a', light: '#34343a' }),
  'cap-sand.svg': cap({ base: '#c9b48e', dark: '#8f7b58', light: '#e3d3b2' }),
  'fedora-charcoal.svg': fedora({ felt: '#4a4a50', dark: '#202024', band: '#121214' }),
  'bucket-olive.svg': bucket({ base: '#5d6447', dark: '#363b27', light: '#7c8461' }),
  'hoops-gold.svg': earrings('hoop'),
  'pearl-drops.svg': earrings('pearl'),
  'studs-diamond.svg': earrings('stud'),
  'drops-gold.svg': earrings('drop'),
  'watch-steel.svg': watch({ caseStops: SILVER, dial: [[0, '#2a2f38'], [1, '#0b0d11']], strap: '#9aa1ab', strapDark: '#5c636d', links: true }),
  'watch-gold-leather.svg': watch({ caseStops: GOLD, dial: [[0, '#fbf7ee'], [1, '#e2dac8']], hands: '#2a2219', strap: '#6b4026', strapDark: '#3b2112' }),
  'bracelet-chain.svg': bracelet('chain'),
  'bracelet-beads.svg': bracelet('beads'),
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(OUT, name), text);
console.log('wrote', Object.keys(files).length, 'renders');
