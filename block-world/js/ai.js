// The two on-device AI models (run on the page; loaded only when the first photo comes in):
//  1. Depth Anything V2 (small): how far away every part of the photo is.
//  2. SegFormer B0 trained on ADE20K: what every part of the photo is (150 kinds of things).
// Both download once from Hugging Face and then run in the browser with WebAssembly.

import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';

env.allowLocalModels = false;
let depthPipe = null, segPipe = null;

let postMessage = () => {};
const progress = (what) => (p) => {
  if (p.status === 'progress' && p.total) postMessage({ type: 'progress', what, loaded: p.loaded, total: p.total });
};

async function load() {
  if (!depthPipe) depthPipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8', device: 'wasm', progress_callback: progress('depth') });
  if (!segPipe) segPipe = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512', { dtype: 'q8', device: 'wasm', progress_callback: progress('objects') });
}

export async function run(data, report) {
  postMessage = report;
  try {
    postMessage({ type: 'stage', text: 'Getting the AI ready. It downloads once (about 50 MB), then it's saved on your phone…' });
    await load();
    const img = await RawImage.fromBlob(data.blob);
    const { gw, gh } = data;

    postMessage({ type: 'stage', text: 'Measuring how far away everything is…' });
    const d = await depthPipe(img);
    const dimg = d.depth;                       // RawImage, 1 channel, near = bright
    const depth = new Float32Array(gw * gh);
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      // Average a few samples per cell so thin details don't flicker.
      let s = 0, n = 0;
      for (const [oy, ox] of [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75], [0.5, 0.5]]) {
        const x = Math.min(dimg.width - 1, Math.floor((c + ox) / gw * dimg.width));
        const y = Math.min(dimg.height - 1, Math.floor((r + oy) / gh * dimg.height));
        s += dimg.data[(y * dimg.width + x) * dimg.channels]; n++;
      }
      depth[r * gw + c] = s / n / 255;
    }

    postMessage({ type: 'stage', text: 'Finding every object…' });
    const segs = await segPipe(img);           // [{ label, score, mask: RawImage }]
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
    postMessage({ type: 'done', depth, labels, names });
  } catch (err) {
    postMessage({ type: 'error', message: err.message || String(err) });
  }
}
