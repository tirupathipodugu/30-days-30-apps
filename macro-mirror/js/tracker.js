// Face tracking: MediaPipe Face Landmarker (478 landmarks), vendored in ../vendor and ../assets so
// nothing loads from a CDN. One face only. Landmarks are lightly smoothed with a One Euro filter,
// which removes sub-pixel jitter at rest but follows fast head turns with almost no lag.

import { FaceLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.js';

const WASM = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL = new URL('../assets/face_landmarker.task', import.meta.url).href;

class OneEuro {
  constructor(minCutoff, beta) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.x = null;
    this.dx = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, dt, scale) {
    if (this.x === null) { this.x = value; return value; }
    const d = (value - this.x) / dt / scale;
    this.dx += OneEuro.alpha(1, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class Tracker {
  static async create() {
    // MediaPipe prints routine start-up notes ("INFO: Created TensorFlow Lite XNNPACK delegate")
    // through console.error. They aren't errors, so they're kept out of the console.
    const error = console.error;
    console.error = (...args) => { if (!/^(INFO|W\d{4}|I\d{4})/.test(String(args[0]))) error(...args); };
    const files = await FilesetResolver.forVisionTasks(WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    let landmarker;
    try {
      landmarker = await FaceLandmarker.createFromOptions(files, options('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(files, options('CPU'));
    }
    return new Tracker(landmarker);
  }

  constructor(landmarker) {
    this.landmarker = landmarker;
    this.filters = null;
    this.points = null;          // Float32Array(478 * 3), smoothed, in video-normalised coords
    this.lastTime = 0;
    this.lastStamp = 0;
    this.found = false;
    this.ms = 0;                 // last detection time, for the stats line
  }

  /** Track one frame. Returns true when a face was found. */
  detect(video, now) {
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, stamp);
    } catch {
      return this.found;
    }
    this.ms = performance.now() - t0;
    const face = result.faceLandmarks && result.faceLandmarks[0];
    if (!face) {
      this.found = false;
      this.filters = null;
      return false;
    }
    const n = face.length;
    if (!this.points || this.points.length !== n * 3) this.points = new Float32Array(n * 3);
    const dt = this.filters ? Math.max(1 / 120, Math.min(0.2, (now - this.lastTime) / 1000)) : 1 / 30;
    this.lastTime = now;
    if (!this.filters) {
      this.filters = [];
      for (let i = 0; i < n * 3; i++) this.filters.push(new OneEuro(2.2, 1.6));
    }
    // Scale speeds by face width so the filter behaves the same near and far from the camera.
    const a = face[234], b = face[454];
    const width = Math.hypot(a.x - b.x, a.y - b.y) || 0.2;
    for (let i = 0; i < n; i++) {
      const p = face[i];
      this.points[i * 3] = this.filters[i * 3].filter(p.x, dt, width);
      this.points[i * 3 + 1] = this.filters[i * 3 + 1].filter(p.y, dt, width);
      this.points[i * 3 + 2] = this.filters[i * 3 + 2].filter(p.z, dt, width);
    }
    this.found = true;
    return true;
  }
}
