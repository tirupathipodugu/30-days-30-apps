// Bakes the procedural heart into assets/heart-procedural.{bin,json} so no phone pays the meshing cost (run with node).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProceduralHeart } from '../js/procedural-heart.js';
import { normalizeLandmarks } from '../js/landmarks.js';

const t0 = performance.now();
const h = buildProceduralHeart(false);
const count = h.positions.length / 3;

// Normalise to one unit tall around the bounding-box centre, exactly as the runtime does for a glTF.
{
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], h.positions[i * 3 + k]); hi[k] = Math.max(hi[k], h.positions[i * 3 + k]);
  }
  const centre = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2), s = 1 / (hi[1] - lo[1]);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) h.positions[i * 3 + k] = (h.positions[i * 3 + k] - centre[k]) * s;
  h.landmarks = normalizeLandmarks(h.landmarks, centre, s);
  h.width = (hi[0] - lo[0]) * s;
}

// Quantise: positions to 16 bits inside the bounding box, normals and colours to 8 bits.
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
  min[k] = Math.min(min[k], h.positions[i * 3 + k]);
  max[k] = Math.max(max[k], h.positions[i * 3 + k]);
}
const pos = new Uint16Array(count * 3);
const nrm = new Int8Array(count * 3);
const col = new Uint8Array(count * 4);
for (let i = 0; i < count; i++) {
  for (let k = 0; k < 3; k++) {
    pos[i * 3 + k] = Math.round(((h.positions[i * 3 + k] - min[k]) / (max[k] - min[k])) * 65535);
    nrm[i * 3 + k] = Math.round(h.normals[i * 3 + k] * 127);
    col[i * 4 + k] = Math.round(Math.sqrt(h.colors[i * 3 + k]) * 255);   // sqrt keeps dark reds precise
  }
  col[i * 4 + 3] = Math.round(h.fat[i] * 255);
}
const index = count < 65536 ? new Uint16Array(h.index) : new Uint32Array(h.index);

const sections = [];
const chunks = [];
let offset = 0;
for (const [name, arr] of [['position', pos], ['normal', nrm], ['color', col], ['index', index]]) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  sections.push({ name, type: arr.constructor.name, offset, length: arr.length });
  chunks.push(bytes);
  const pad = (4 - (bytes.length % 4)) % 4;
  if (pad) chunks.push(new Uint8Array(pad));
  offset += bytes.length + pad;
}
const header = new TextEncoder().encode(JSON.stringify({ count, min, max, sections }));
const headerPad = (4 - ((header.length + 8) % 4)) % 4;
const out = new Uint8Array(8 + header.length + headerPad + offset);
const dv = new DataView(out.buffer);
dv.setUint32(0, 0x5452484c, true);            // "LHRT"
dv.setUint32(4, header.length + headerPad, true);
out.set(header, 8);
out.fill(32, 8 + header.length, 8 + header.length + headerPad);
let o = 8 + header.length + headerPad;
for (const c of chunks) { out.set(c, o); o += c.length; }

const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v);
writeFileSync(fileURLToPath(new URL('../assets/heart-procedural.bin', import.meta.url)), out);
writeFileSync(fileURLToPath(new URL('../assets/heart-procedural.json', import.meta.url)), JSON.stringify({ width: h.width, landmarks: h.landmarks }, round));
console.log(`${count} vertices, ${index.length / 3} triangles, ${(out.length / 1024).toFixed(0)} KB in ${(performance.now() - t0).toFixed(0)} ms`);
