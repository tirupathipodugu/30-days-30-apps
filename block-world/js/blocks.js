// Block types: a 16 x 16 pixel texture drawn in code for each one (our own designs), the block's own
// colour, and which of the 150 scene labels become which block. Blocks are shaded per face like a
// block game: top brightest, sides darker, bottom darkest.

import * as THREE from 'three';

// tint: the block's own colour. dye: takes one colour per object from the dye palette instead.
// fixed: part of the room (can't be picked up). transparent: see-through amount.
export const TYPES = {
  plaster: { tint: [0.93, 0.92, 0.89], dye: true, fixed: true },
  brick:   { tint: [0.64, 0.31, 0.25], fixed: true },
  planks:  { tint: [0.74, 0.55, 0.34] },
  floor:   { tint: [0.74, 0.55, 0.34], fixed: true },
  wool:    { tint: [0.9, 0.9, 0.9], dye: true },
  leaves:  { tint: [0.33, 0.62, 0.22], cutout: true },
  grass:   { tint: [1, 1, 1], fixed: true },
  dirt:    { tint: [0.56, 0.4, 0.27], fixed: true },
  sand:    { tint: [0.88, 0.81, 0.58], fixed: true },
  stone:   { tint: [0.57, 0.57, 0.58], fixed: true },
  log:     { tint: [0.45, 0.33, 0.21] },
  glass:   { tint: [0.88, 0.96, 1.0], transparent: 0.5 },
  water:   { tint: [0.24, 0.45, 0.9], transparent: 0.35, fixed: true },
  iron:    { tint: [0.84, 0.85, 0.88] },
  screen:  { tint: [0.1, 0.1, 0.13] },
  glow:    { tint: [1.0, 0.88, 0.55], emissive: true },
  books:   { tint: [1, 1, 1] },
  plain:   { tint: [1, 1, 1], dye: true },
};

const MAP = {
  plaster: ['wall', 'ceiling', 'column', 'fireplace', 'blind', 'bannister'],
  brick: ['building', 'house', 'skyscraper', 'tower', 'hovel', 'chimney', 'booth'],
  floor: ['floor', 'stairs', 'stairway', 'step', 'rug'],
  planks: ['table', 'cabinet', 'door', 'chair', 'shelf', 'wardrobe', 'desk', 'box', 'chest of drawers', 'counter', 'countertop', 'coffee table', 'kitchen island', 'bench', 'stool', 'barrel', 'case', 'bar', 'buffet', 'fence', 'railing', 'swivel chair', 'cradle', 'pool table', 'basket', 'stage', 'pier', 'bulletin board', 'tray'],
  wool: ['bed', 'sofa', 'armchair', 'seat', 'cushion', 'pillow', 'curtain', 'blanket', 'towel', 'apparel', 'ottoman', 'bag', 'tent', 'awning', 'canopy', 'flag', 'plaything', 'ball'],
  leaves: ['tree', 'plant', 'flower', 'palm'],
  grass: ['grass', 'field', 'hill'],
  dirt: ['earth', 'land', 'dirt track', 'path', 'mountain'],
  sand: ['sand'],
  stone: ['road', 'sidewalk', 'rock', 'runway', 'bridge', 'sculpture', 'base', 'fountain'],
  glass: ['windowpane', 'glass', 'mirror', 'screen door', 'vase', 'bottle', 'shower'],
  water: ['water', 'sea', 'river', 'lake', 'swimming pool', 'waterfall'],
  iron: ['refrigerator', 'oven', 'microwave', 'stove', 'washer', 'dishwasher', 'sink', 'bathtub', 'toilet', 'car', 'bus', 'truck', 'van', 'boat', 'ship', 'airplane', 'minibike', 'bicycle', 'radiator', 'hood', 'fan', 'pole', 'ashcan', 'tank', 'pot', 'plate', 'arcade machine', 'escalator', 'conveyer belt', 'traffic light', 'clock', 'computer'],
  screen: ['television receiver', 'screen', 'monitor', 'crt screen'],
  glow: ['lamp', 'light', 'chandelier', 'sconce', 'streetlight'],
  books: ['book', 'bookcase', 'painting', 'poster', 'signboard', 'trade name'],
};
const BY_LABEL = {};
for (const [type, labels] of Object.entries(MAP)) for (const l of labels) BY_LABEL[l] = type;

export function typeFor(label) {
  if (label === 'sky') return null;            // the sky becomes the background, not blocks
  return BY_LABEL[label] || 'plain';
}

// ---------- textures ----------

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvas16(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grey = (v) => `rgb(${v},${v},${v})`;
const rgb = (r, g, b) => `rgb(${r},${g},${b})`;

function paint(name) {
  const r = rng([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const speckle = (g, base, spread, step = 1) => { for (let y = 0; y < 16; y += step) for (let x = 0; x < 16; x += step) { g.fillStyle = grey(Math.round(base + (r() - 0.5) * spread)); g.fillRect(x, y, step, step); } };
  return canvas16((g) => {
    switch (name) {
      case 'plaster':
        speckle(g, 238, 18);
        break;
      case 'brick':
        speckle(g, 222, 30);
        g.fillStyle = grey(150);
        for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
        for (let row = 0; row < 4; row++) for (let x = row % 2 ? 4 : 0; x < 16; x += 8) g.fillRect(x, row * 4, 1, 3);
        break;
      case 'planks': case 'floor':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = grey(Math.round(205 + Math.sin((x + (y >> 2) * 5) * 0.9) * 12 + (r() - 0.5) * 22)); g.fillRect(x, y, 1, 1); }
        g.fillStyle = grey(118);
        for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
        [[3, 0], [11, 4], [6, 8], [13, 12]].forEach(([x, y]) => g.fillRect(x, y, 1, 3));
        g.fillStyle = grey(150); [[1, 1], [9, 6], [4, 10], [14, 14]].forEach(([x, y]) => g.fillRect(x, y, 2, 1));
        break;
      case 'wool':
        speckle(g, 225, 30);
        g.fillStyle = 'rgba(255,255,255,.35)';
        for (let i = 0; i < 18; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 2, 1);
        g.fillStyle = 'rgba(0,0,0,.12)';
        for (let i = 0; i < 14; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 2);
        break;
      case 'leaves':
        g.clearRect(0, 0, 16, 16);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = r();
          if (v < 0.16) continue;                       // gaps you can see through
          g.fillStyle = grey(v < 0.4 ? 150 : v < 0.75 ? 205 : 245);
          g.fillRect(x, y, 1, 1);
        }
        break;
      case 'dirt':
        speckle(g, 200, 70);
        g.fillStyle = grey(120); for (let i = 0; i < 10; i++) g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1);
        break;
      case 'sand': speckle(g, 225, 40); break;
      case 'log':
        for (let x = 0; x < 16; x++) { const v = 170 + (x % 4 === 0 ? -50 : 0) + (r() - 0.5) * 40; for (let y = 0; y < 16; y++) { g.fillStyle = grey(Math.round(v + (r() - 0.5) * 24)); g.fillRect(x, y, 1, 1); } }
        g.fillStyle = grey(110); for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 14), 1, 3);
        break;
      case 'stone':
        speckle(g, 200, 34, 2);
        g.fillStyle = grey(132);
        for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 13), y = Math.floor(r() * 14); g.fillRect(x, y, 3 + Math.floor(r() * 3), 1); g.fillRect(x, y, 1, 2); }
        break;
      case 'glass':
        g.clearRect(0, 0, 16, 16);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, 16, 16);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
        g.fillStyle = 'rgba(255,255,255,.75)'; [[3, 3], [4, 4], [5, 5], [10, 2], [11, 3]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
        break;
      case 'water':
        speckle(g, 215, 24);
        g.fillStyle = 'rgba(255,255,255,.5)';
        for (let y = 2; y < 16; y += 5) for (let x = 0; x < 16; x++) if ((x + y) % 5 < 2) g.fillRect(x, y, 1, 1);
        break;
      case 'iron':
        speckle(g, 228, 12);
        g.fillStyle = grey(170);
        g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
        g.fillStyle = grey(150); [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
        g.fillStyle = grey(245); g.fillRect(3, 6, 10, 1);
        break;
      case 'screen':
        speckle(g, 60, 18);
        g.fillStyle = grey(110); g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16);
        g.fillStyle = 'rgba(120,170,255,.5)'; g.fillRect(4, 4, 3, 1); g.fillRect(9, 9, 4, 1);
        break;
      case 'glow':
        speckle(g, 230, 20);
        g.fillStyle = '#ffffff';
        [[3, 3], [10, 2], [6, 9], [12, 11], [2, 12]].forEach(([x, y]) => g.fillRect(x, y, 3, 3));
        break;
      case 'books':
        g.fillStyle = rgb(150, 105, 66); g.fillRect(0, 0, 16, 16);
        g.fillStyle = rgb(120, 82, 50); g.fillRect(0, 7, 16, 2); g.fillRect(0, 15, 16, 1);
        for (let x = 1; x < 15; x += 2) {
          const pick = [[160, 48, 44], [52, 92, 160], [70, 130, 60], [200, 170, 70], [110, 60, 130]][Math.floor(r() * 5)];
          g.fillStyle = rgb(...pick); g.fillRect(x, 1, 2, 6); g.fillRect(x, 9, 2, 6);
        }
        break;
      case 'grass_top':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = r(); g.fillStyle = rgb(Math.round(80 + v * 40), Math.round(150 + v * 50), Math.round(60 + v * 30)); g.fillRect(x, y, 1, 1); }
        break;
      case 'grass_side':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = r(); g.fillStyle = rgb(Math.round(130 + v * 40), Math.round(92 + v * 30), Math.round(60 + v * 25)); g.fillRect(x, y, 1, 1); }
        for (let x = 0; x < 16; x++) { const h = 3 + Math.floor(r() * 3); for (let y = 0; y < h; y++) { const v = r(); g.fillStyle = rgb(Math.round(80 + v * 40), Math.round(150 + v * 50), Math.round(60 + v * 30)); g.fillRect(x, y, 1, 1); } }
        break;
      default:
        speckle(g, 236, 20);
    }
    // A faint frame on every solid block so the grid reads clearly.
    if (!['glass', 'leaves', 'grass_top', 'grass_side'].includes(name)) {
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16);
    }
  });
}

// One cube geometry with per-face brightness, like a block game: top 1.0, sides 0.8 / 0.65, bottom 0.5.
let cube = null;
export function cubeGeometry() {
  if (cube) return cube;
  cube = new THREE.BoxGeometry(1, 1, 1);
  const shades = [0.8, 0.8, 1.0, 0.5, 0.66, 0.66];   // +x, -x, +y, -y, +z, -z
  const col = [];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) col.push(shades[f], shades[f], shades[f]);
  cube.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return cube;
}

const textures = {};
const tex = (name) => textures[name] || (textures[name] = paint(name));
function mat(name, spec = {}) {
  const m = new THREE.MeshLambertMaterial({
    map: tex(name), vertexColors: true,
    transparent: !!spec.transparent, opacity: spec.transparent ? 1 - spec.transparent : 1, depthWrite: !spec.transparent,
    alphaTest: spec.cutout ? 0.5 : 0, side: spec.cutout ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (spec.emissive) { m.emissive = new THREE.Color(0.55, 0.45, 0.25); m.emissiveMap = tex(name); }
  return m;
}

/** A material, or for grass an array of 6 (sides, top, bottom). */
export function materialFor(type) {
  const spec = TYPES[type];
  if (type === 'grass') { const s = mat('grass_side'), t = mat('grass_top'), b = mat('dirt'); return [s, s, t, b, s, s]; }
  return mat(type, spec);
}
