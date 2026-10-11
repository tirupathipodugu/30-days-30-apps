// Share card: "My skin check" with the top 3 measures and the routine summary. The face is only
// included if the person turns "Include my photo" on. Drawn on a canvas; nothing is uploaded.

import { NAMES, level } from './measures.js';

const W = 1080, H = 1350;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{res, top:string[], routine, photo:HTMLCanvasElement|null, includePhoto:boolean, date:Date}} o
 */
export function drawShareCard(canvas, o) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  const g = ctx.createRadialGradient(W / 2, H * 0.32, 60, W / 2, H * 0.4, H * 0.9);
  g.addColorStop(0, '#17151a'); g.addColorStop(1, '#060507');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const pad = 84;
  let y = 120;
  ctx.fillStyle = 'rgba(242,241,243,.62)';
  ctx.font = font(500, 30);
  ctx.letterSpacing = '9px';
  ctx.fillText('MY SKIN CHECK', pad, y);
  ctx.letterSpacing = '0px';
  ctx.font = font(400, 30);
  ctx.textAlign = 'right';
  ctx.fillText(o.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), W - pad, y);
  ctx.textAlign = 'left';

  y += 50;
  if (o.includePhoto && o.photo) {
    const size = 300;
    const cx = W / 2, cy = y + size / 2 + 10;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.clip();
    const p = o.photo;
    const s = Math.max(size / p.width, size / p.height);
    ctx.drawImage(p, cx - (p.width * s) / 2, cy - (p.height * s) / 2, p.width * s, p.height * s);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.stroke();
    y += size + 60;
  } else {
    y += 40;
    ctx.fillStyle = '#f2f1f3';
    ctx.font = font(300, 64);
    for (const line of wrap(ctx, o.summary, W - pad * 2)) { ctx.fillText(line, pad, y + 40); y += 76; }
    y += 40;
  }

  // Top 3 measures
  for (const k of o.top) {
    const m = o.res.m[k];
    const lv = level(m.score);
    roundRect(ctx, pad, y, W - pad * 2, 120, 26);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#f2f1f3'; ctx.font = font(500, 38);
    ctx.fillText(NAMES[k], pad + 34, y + 54);
    ctx.fillStyle = 'rgba(242,241,243,.7)'; ctx.font = font(400, 30);
    ctx.textAlign = 'right';
    ctx.fillText(`${lv.label} · ${m.score}/100`, W - pad - 34, y + 54);
    ctx.textAlign = 'left';
    const bx = pad + 34, bw = W - pad * 2 - 68, by = y + 82;
    roundRect(ctx, bx, by, bw, 10, 5); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
    roundRect(ctx, bx, by, Math.max(10, bw * m.score / 100), 10, 5); ctx.fillStyle = '#ffb59a'; ctx.fill();
    y += 144;
  }

  // Routine summary
  y += 20;
  const short = (steps) => steps.map((s) => s.name.replace('Sunscreen, SPF 30+', 'SPF 30+').replace('Ceramide moisturiser', 'Moisturiser').replace('Gentle cleanser', 'Cleanser').replace('Salicylic acid (BHA)', 'BHA')).join(' · ');
  for (const [label, steps] of [['Morning', o.routine.am], ['Night', o.routine.pm]]) {
    ctx.fillStyle = 'rgba(242,241,243,.62)'; ctx.font = font(600, 26);
    ctx.letterSpacing = '4px';
    ctx.fillText(label.toUpperCase(), pad, y);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = '#f2f1f3'; ctx.font = font(400, 32);
    y += 46;
    for (const line of wrap(ctx, short(steps), W - pad * 2)) { ctx.fillText(line, pad, y); y += 44; }
    y += 22;
  }

  // Footer
  ctx.fillStyle = 'rgba(242,241,243,.62)'; ctx.font = font(400, 26);
  ctx.fillText('A cosmetic check, not a medical diagnosis.', pad, H - 120);
  ctx.fillStyle = '#f2f1f3'; ctx.font = font(500, 32);
  ctx.fillText('Skin Check · @tirupathipodugu', pad, H - 72);
  return canvas;
}

export async function shareCanvas(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'my-skin-check.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My skin check' });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'my-skin-check.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
