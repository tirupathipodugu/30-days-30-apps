// Face tracking with MediaPipe Tasks Vision Face Landmarker, vendored (no CDN at runtime).
// The WASM runtime and the face_landmarker.task model are served from ../vendor/mediapipe/.

import { FaceLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.js';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;

let landmarker = null;
let loading = null;

export function loadTracker() {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: BASE + 'face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
    return landmarker;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

let lastTs = -1;
/** Track one video frame. Returns { landmarks (normalised), matrix } or null when no face. */
export function track(video) {
  if (!landmarker || video.readyState < 2) return null;
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  const res = landmarker.detectForVideo(video, ts);
  if (!res.faceLandmarks || !res.faceLandmarks.length) return null;
  return { landmarks: res.faceLandmarks[0], matrix: res.facialTransformationMatrixes?.[0] || null };
}
