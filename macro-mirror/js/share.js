// Share card and clips, made on this device. The card is Today | 5 years on this plate | 5 years on
// the better plate, cropped around the face, with the numbers. Clips record a 6 s slider sweep.

const TYPES = [['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm', 'webm']];

export function clipFormat(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
  const f = TYPES.find(([t]) => MediaRecorder.isTypeSupported(t));
  return f ? { type: f[0], extension: f[1] } : null;
}

export function recordCanvas(canvas, format, ms) {
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: format.type, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error);
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: format.type.split(';')[0] })); };
    rec.start();
    setTimeout(() => rec.stop(), ms);
  });
}

/** Draw text with a soft shadow so it reads over any picture. */
function label(ctx, text, x, y, size, weight = 300, color = 'rgba(255,255,255,.92)', align = 'left') {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function spaced(ctx, text, x, y, size, spacing, color) {
  ctx.font = `300 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
}

/**
 * panels: [{ image: canvas, title, value }], header: string. Returns a canvas.
 */
export function composeCard(panels, header, footnote) {
  const W = 1620, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.45, W * 0.7);
  bg.addColorStop(0, '#121116');
  bg.addColorStop(1, '#050506');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  spaced(ctx, 'MACRO MIRROR', 60, 78, 24, 7, 'rgba(255,255,255,.85)');
  label(ctx, header, W - 60, 80, 26, 400, 'rgba(255,255,255,.92)', 'right');

  const gap = 30, top = 120, pw = (W - 120 - gap * 2) / 3, ph = 720;
  panels.forEach((p, i) => {
    const x = 60 + i * (pw + gap);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, top, pw, ph, 18);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, top, pw, ph);
    if (p.image) ctx.drawImage(p.image, x, top, pw, ph);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, top, pw, ph, 18);
    ctx.stroke();
    label(ctx, p.title, x + 4, top + ph + 52, 30, 400, '#fff');
    label(ctx, p.value, x + 4, top + ph + 94, 26, 300, i === 0 ? 'rgba(255,255,255,.6)' : '#e9d8c4');
  });
  label(ctx, footnote, 60, H - 34, 20, 300, 'rgba(255,255,255,.5)');
  label(ctx, 'Macro Mirror · @tirupathipodugu', W - 60, H - 34, 22, 400, 'rgba(255,255,255,.8)', 'right');
  return c;
}

/** Show a card (canvas) or clip (Blob) in the result dialog. */
export function showResult(blob, extension, title) {
  const dialog = document.getElementById('result');
  const preview = document.getElementById('preview');
  const share = document.getElementById('share');
  const download = document.getElementById('download');
  const isVideo = blob.type.startsWith('video/');
  const name = `macro-mirror.${extension}`;
  const file = new File([blob], name, { type: blob.type });
  const url = URL.createObjectURL(blob);
  const media = document.createElement(isVideo ? 'video' : 'img');
  media.src = url;
  if (isVideo) { media.muted = true; media.loop = true; media.playsInline = true; media.autoplay = true; }
  else media.alt = 'Your face today, in 5 years on this plate, and in 5 years on the better plate';
  preview.replaceChildren(media);
  document.getElementById('result-title').textContent = title;
  download.href = url;
  download.download = name;
  download.textContent = isVideo ? 'Save video' : 'Save image';
  document.getElementById('result-note').textContent = isVideo
    ? 'Made on this device. Nothing was uploaded.'
    : 'Made on this device. On iPhone you can also press and hold the picture to save it.';
  const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  share.hidden = !canShare;
  share.onclick = () => navigator.share({ files: [file], title: 'Macro Mirror' }).catch(() => {});
  const old = dialog._url;
  if (old) URL.revokeObjectURL(old);
  dialog._url = url;
  if (!dialog.open) dialog.showModal();
}
