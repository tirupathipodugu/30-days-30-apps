// Object detection: MediaPipe's EfficientDet-Lite0 finds things in the picture (a person, a cup,
// a chair, a laptop…), so the black hole can pull those in first. It runs on this device; the
// picture never leaves it. The MediaPipe runtime is shared with Macro Mirror, so it's not copied.

const RUNTIME = new URL('../../macro-mirror/vendor/mediapipe/', import.meta.url).href;
const MODEL = new URL('../assets/efficientdet_lite0.tflite', import.meta.url).href;

let detector = null;
let loading = null;

/** Load once. Resolves to true when ready, false if this device can't run it. */
export function loadDetector() {
  if (!loading) {
    loading = (async () => {
      try {
        const { FilesetResolver, ObjectDetector } = await import(RUNTIME + 'vision_bundle.js');
        const files = await FilesetResolver.forVisionTasks(RUNTIME + 'wasm');
        const make = (delegate) => ObjectDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'IMAGE',
          scoreThreshold: 0.35,
          maxResults: 8,
        });
        detector = await make('CPU'); // the GPU path returned nothing on some devices in testing
        return true;
      } catch (err) {
        console.warn('object detection unavailable', err);
        return false;
      }
    })();
  }
  return loading;
}

/** Find objects in a video, image or canvas. Boxes are in the source's own pixels. */
export function detect(el) {
  if (!detector) return [];
  try {
    const result = detector.detect(el);
    return result.detections.map((d) => ({
      label: d.categories[0]?.categoryName || 'thing',
      score: d.categories[0]?.score || 0,
      x: d.boundingBox.originX,
      y: d.boundingBox.originY,
      w: d.boundingBox.width,
      h: d.boundingBox.height,
    }));
  } catch (err) {
    console.warn('detect failed', err);
    return [];
  }
}
