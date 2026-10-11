// Camera (or the demo clip) into one muted, inline <video>. Nothing is recorded or uploaded.

export const DEMO_SRC = 'assets/demo-portrait.mp4';

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('This browser has no camera access.'), { code: 'unsupported' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  await video.play().catch(() => {});
  await ready(video);
  return { stream, mirrored: true, demo: false };
}

export async function startDemo(video, src = DEMO_SRC) {
  video.srcObject = null;
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.setAttribute('playsinline', '');
  video.poster = 'assets/demo-poster.jpg';
  video.src = src;
  await video.play().catch(() => {});
  await ready(video);
  return { stream: null, mirrored: false, demo: true };
}

export function stopCamera(video, cam) {
  cam?.stream?.getTracks().forEach((t) => t.stop());
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  video.removeAttribute('poster');
  video.load();
}

function ready(video) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The video did not start.')), 15000);
    video.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
