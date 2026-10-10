// Recording: captures the mirror canvas for a few seconds with MediaRecorder (mp4 where the browser
// can, else webm), then offers the clip in a sheet with Share, Save and Close. The file never leaves
// the device unless the visitor shares it themselves.

const TYPES = [
  ['video/mp4;codecs=avc1.42E01E', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm', 'webm'],
];

/** The first clip format this browser can record, or null if it can't record a canvas at all. */
export function clipFormat(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
  const found = TYPES.find(([type]) => MediaRecorder.isTypeSupported(type));
  return found ? { type: found[0], extension: found[1] } : null;
}

/** Record the canvas for `ms` milliseconds. Resolves to a Blob. */
export function recordCanvas(canvas, format, ms) {
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: format.type, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = (event) => reject(event.error);
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      resolve(new Blob(chunks, { type: format.type.split(';')[0] }));
    };
    recorder.start();
    setTimeout(() => recorder.stop(), ms);
  });
}

/** Show a recorded clip (or photo) in the share sheet. */
export function showClip(blob, extension) {
  const sheet = document.getElementById('sheet');
  const preview = document.getElementById('preview');
  const share = document.getElementById('share');
  const save = document.getElementById('save');
  const isVideo = blob.type.startsWith('video/');
  const name = `mirror-room.${extension}`;
  const file = new File([blob], name, { type: blob.type });
  const url = URL.createObjectURL(blob);

  const media = document.createElement(isVideo ? 'video' : 'img');
  media.src = url;
  if (isVideo) {
    media.muted = true;
    media.loop = true;
    media.playsInline = true;
    media.autoplay = true;
  } else {
    media.alt = 'Photo of the broken mirror';
  }
  preview.replaceChildren(media);
  document.getElementById('sheet-title').textContent = isVideo ? 'Your clip' : 'Your photo';

  save.href = url;
  save.download = name;
  save.textContent = isVideo ? 'Save video' : 'Save photo';

  const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  share.hidden = !canShare;
  share.onclick = () => navigator.share({ files: [file], title: 'Mirror Room' }).catch(() => {});

  sheet.addEventListener('close', () => {
    preview.replaceChildren();
    URL.revokeObjectURL(url);
  }, { once: true });
  sheet.showModal();
}
