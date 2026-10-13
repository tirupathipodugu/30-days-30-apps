// The two on-device AI models, loaded only when needed:
//  1. Depth Anything V2 (small): how far away every part of the picture is.
//  2. SegFormer B0 trained on ADE20K: what every part of the picture is (150 kinds of things).
// Both download once from Hugging Face, then run in the browser: on the graphics chip (WebGPU) when the
// phone has it, otherwise with WebAssembly.

import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';

env.allowLocalModels = false;
let depthPipe = null, segPipe = null;
export let depthDevice = 'wasm';

const progress = (what, report) => (p) => {
  if (p.status === 'progress' && p.total) report({ type: 'progress', what, loaded: p.loaded, total: p.total });
};

export async function loadDepth(report = () => {}) {
  if (depthPipe) return;
  if (navigator.gpu) {
    try {
      depthPipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: 'webgpu', dtype: 'fp16', progress_callback: progress('depth', report) });
      depthDevice = 'webgpu';
      return;
    } catch { /* fall back to WebAssembly below */ }
  }
  depthPipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: 'wasm', dtype: 'q8', progress_callback: progress('depth', report) });
  depthDevice = 'wasm';
}

export async function loadSeg(report = () => {}) {
  if (!segPipe) segPipe = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512', { dtype: 'q8', device: 'wasm', progress_callback: progress('objects', report) });
}
export const segReady = () => !!segPipe;

/** A RawImage from a canvas (OffscreenCanvas or <canvas>). */
export function fromCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new RawImage(d.data, canvas.width, canvas.height, 4).rgb();
}

/** Depth for a gw x gh grid, 0 (far) .. 1 (near), relative. `fast` uses a smaller model input for live video. */
export async function depthGrid(img, gw, gh, fast = false) {
  // Smaller model input for live video (about 4x faster), full size for photos.
  const proc = depthPipe.processor;
  const ip = (proc && (proc.image_processor || proc.feature_extractor)) || proc;
  const size = fast ? { height: 196, width: 196 } : { height: 518, width: 518 };
  if (ip) { ip.size = size; if (ip.config) ip.config.size = size; }
  const d = await depthPipe(img);
  const dimg = d.depth;
  const depth = new Float32Array(gw * gh);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    let s = 0;
    for (const [oy, ox] of [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75], [0.5, 0.5]]) {
      const x = Math.min(dimg.width - 1, Math.floor((c + ox) / gw * dimg.width));
      const y = Math.min(dimg.height - 1, Math.floor((r + oy) / gh * dimg.height));
      s += dimg.data[(y * dimg.width + x) * dimg.channels];
    }
    depth[r * gw + c] = s / 5 / 255;
  }
  return depth;
}

/** What each grid cell is: { labels: Int16Array (index into names, or -1), names }. */
export async function labelGrid(img, gw, gh) {
  const segs = await segPipe(img);
  const labels = new Int16Array(gw * gh).fill(-1);
  const names = segs.map((s) => String(s.label).trim());
  // Larger regions first, smaller ones on top, so thin objects (a lamp pole) aren't swallowed.
  const order = segs.map((s, i) => {
    let area = 0; const m = s.mask.data;
    for (let k = 0; k < m.length; k += 13) area += m[k] > 127;
    return { i, area };
  }).sort((a, b) => b.area - a.area);
  for (const { i } of order) {
    const m = segs[i].mask;
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      const x = Math.min(m.width - 1, Math.floor((c + 0.5) / gw * m.width));
      const y = Math.min(m.height - 1, Math.floor((r + 0.5) / gh * m.height));
      if (m.data[y * m.width + x] > 127) labels[r * gw + c] = i;
    }
  }
  return { labels, names };
}

/** Photo mode: everything in one go, reporting progress. */
export async function run(data, report) {
  try {
    report({ type: 'stage', text: 'Getting the AI ready. It downloads once (about 50 MB), then it\'s saved on your phone…' });
    await loadDepth(report);
    await loadSeg(report);
    const img = await RawImage.fromBlob(data.blob);
    report({ type: 'stage', text: 'Measuring how far away everything is…' });
    const depth = await depthGrid(img, data.gw, data.gh);
    report({ type: 'stage', text: 'Finding every object…' });
    const { labels, names } = await labelGrid(img, data.gw, data.gh);
    report({ type: 'done', depth, labels, names });
  } catch (err) {
    report({ type: 'error', message: err.message || String(err) });
  }
}
