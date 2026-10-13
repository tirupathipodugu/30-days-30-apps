// Block types: a 16 x 16 pixel texture drawn in code for each one, how much of the photo's own colour
// shows through, and which of the 150 scene labels become which block. Original textures, our style.

import * as THREE from 'three';

// tint: the type's own colour; keep: how much of the photo colour survives (0..1).
export const TYPES = {
  plaster:  { tint: [0.93, 0.91, 0.87], keep: 0.85, fixed: true },
  brick:    { tint: [0.62, 0.32, 0.26], keep: 0.45, fixed: true },
  planks:   { tint: [0.74, 0.54, 0.32], keep: 0.55 },
  floor:    { tint: [0.74, 0.54, 0.32], keep: 0.6, fixed: true },
  wool:     { tint: [0.9, 0.9, 0.9], keep: 0.9 },
  leaves:   { tint: [0.28, 0.55, 0.2], keep: 0.45 },
  grass:    { tint: [0.36, 0.62, 0.26], keep: 0.4, fixed: true },
  dirt:     { tint: [0.52, 0.38, 0.24], keep: 0.45, fixed: true },
  sand:     { tint: [0.86, 0.79, 0.56], keep: 0.5, fixed: true },
  stone:    { tint: [0.55, 0.55, 0.55], keep: 0.5, fixed: true },
  glass:    { tint: [0.8, 0.92, 1.0], keep: 0.6, transparent: 0.45 },
  water:    { tint: [0.2, 0.42, 0.85], keep: 0.4, transparent: 0.7, fixed: true },
  iron:     { tint: [0.86, 0.86, 0.88], keep: 0.55 },
  screen:   { tint: [0.06, 0.06, 0.09], keep: 0.25 },
  glow:     { tint: [1.0, 0.94, 0.7], keep: 0.3, emissive: true },
  books:    { tint: [0.6, 0.4, 0.3], keep: 0.8 },
  plain:    { tint: [1, 1, 1], keep: 1.0 },
};

const MAP = {
  plaster: ['wall', 'ceiling', 'column', 'fireplace', 'blind', 'bannister'],
  brick: ['building', 'house', 'skyscraper', 'tower', 'hovel', 'chimney', 'booth'],
  floor: ['floor', 'stairs', 'stairway', 'step'],
  planks: ['table', 'cabinet', 'door', 'chair', 'shelf', 'wardrobe', 'desk', 'box', 'chest of drawers', 'counter', 'countertop', 'coffee table', 'kitchen island', 'bench', 'stool', 'barrel', 'case', 'bar', 'buffet', 'fence', 'railing', 'swivel chair', 'cradle', 'pool table', 'basket', 'stage', 'pier', 'bulletin board', 'tray'],
  wool: ['bed', 'sofa', 'armchair', 'seat', 'cushion', 'pillow', 'curtain', 'rug', 'blanket', 'towel', 'apparel', 'ottoman', 'bag', 'tent', 'awning', 'canopy', 'flag', 'plaything', 'ball'],
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

function paint(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const r = rng([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const px = (x, y, v, a = 1) => { g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(x, y, 1, 1); };
  const noise = (base, spread) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, Math.round(base + (r() - 0.5) * spread)); };

  switch (name) {
    case 'plaster': noise(236, 14); break;
    case 'brick':
      noise(225, 20);
      for (let y = 0; y < 16; y += 4) { g.fillStyle = '#9a9a9a'; g.fillRect(0, y, 16, 1); }
      for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < 16; x += 8) { g.fillStyle = '#9a9a9a'; g.fillRect(x, y, 1, 4); }
      break;
    case 'planks': case 'floor':
      noise(220, 18);
      for (let y = 0; y < 16; y += 4) { g.fillStyle = '#8c8c8c'; g.fillRect(0, y + 3, 16, 1); }
      for (let y = 0; y < 16; y += 4) { const x = Math.floor(r() * 16); g.fillStyle = '#8c8c8c'; g.fillRect(x, y, 1, 3); }
      for (let i = 0; i < 6; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), 170);
      break;
    case 'wool': noise(228, 26); for (let i = 0; i < 20; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), 255); break;
    case 'leaves':
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = r(); px(x, y, v < 0.2 ? 120 : v < 0.55 ? 200 : 245); }
      break;
    case 'grass': noise(225, 40); for (let x = 0; x < 16; x++) { g.fillStyle = '#ffffff'; g.fillRect(x, 0, 1, 2 + Math.floor(r() * 3)); } break;
    case 'dirt': case 'sand': noise(215, 45); break;
    case 'stone':
      noise(205, 30);
      for (let i = 0; i < 5; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 14); g.fillStyle = '#8f8f8f'; g.fillRect(x, y, 2 + Math.floor(r() * 3), 1); }
      break;
    case 'glass':
      g.clearRect(0, 0, 16, 16); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
      g.fillRect(4, 4, 1, 1); g.fillRect(5, 3, 1, 1); g.fillRect(10, 10, 2, 1);
      break;
    case 'water': noise(215, 30); for (let y = 2; y < 16; y += 5) for (let x = 0; x < 16; x++) if ((x + y) % 4 < 2) px(x, y, 255); break;
    case 'iron':
      noise(225, 10); g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
      g.fillStyle = '#9e9e9e'; g.fillRect(3, 3, 1, 1); g.fillRect(12, 3, 1, 1); g.fillRect(3, 12, 1, 1); g.fillRect(12, 12, 1, 1);
      break;
    case 'screen': noise(70, 20); for (let i = 0; i < 6; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), 160); break;
    case 'glow':
      noise(240, 14); g.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) g.fillRect(2 + Math.floor(r() * 10), 2 + Math.floor(r() * 10), 3, 3);
      break;
    case 'books':
      noise(200, 10);
      for (let x = 0; x < 16; x += 2) { const v = 140 + Math.floor(r() * 110); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 1, 2, 6); g.fillRect(x, 9, 2, 6); }
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 7, 16, 2); g.fillRect(0, 15, 16, 1);
      break;
    default: noise(238, 16);
  }
  // A thin darker frame on every block so the grid reads clearly.
  if (name !== 'glass') { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const textures = {};
export function materialFor(type) {
  const spec = TYPES[type];
  const map = textures[type] || (textures[type] = paint(type));
  const m = new THREE.MeshLambertMaterial({ map, transparent: !!spec.transparent, opacity: spec.transparent ? 1 - spec.transparent * 0.6 : 1, depthWrite: !spec.transparent });
  if (spec.emissive) { m.emissive = new THREE.Color(0.45, 0.4, 0.25); m.emissiveMap = map; }
  return m;
}

/** Photo colour (0..1 rgb) mixed with the type's tint. */
export function blockColor(type, rgb) {
  const { tint, keep } = TYPES[type];
  return [0, 1, 2].map((i) => rgb[i] * keep + tint[i] * (1 - keep) * (0.6 + 0.4 * rgb[i] * 1.2));
}
