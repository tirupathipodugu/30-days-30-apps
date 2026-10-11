// Skin Check: the flow. Landing → light check → 10-second scan → results → goals → routine,
// plus progress and a share card. Camera frames are analysed in a worker and never leave the device.

import { startCamera, startDemo, stopCamera } from './camera.js';
import { loadTracker, track } from './tracker.js';
import { buildRegions, headPose, noseOffset } from './regions.js';
import { aggregate, MEASURES, NAMES, HOW, level, sentence, summary, escalation } from './measures.js';
import { faceMapSVG, intensitiesFor } from './facemap.js';
import { GOALS, SKIN_TYPES, AGE_BANDS, BUDGETS, buildRoutine, suggestGoals, suggestSkinType } from './routine-rules.js';
import { loadScans, saveScan, deleteAll, trends, history, saveProfile, loadProfile } from './progress.js';
import { drawShareCard, shareCanvas } from './share.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEBUG = params.has('debug');
const FACE_W = 360;            // every face crop is scaled to this width, so measures are normalised by face size
const SCAN_SECONDS = 9;
const MIN_FRAMES = 12;

const sound = new Sound();
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const crop = $('crop');
const cctx = crop.getContext('2d', { willReadFrequently: true });
const worker = new Worker(new URL('./measure-worker.js', import.meta.url));

const state = {
  view: 'landing',
  cam: null,
  mode: 'idle',              // 'light' | 'countdown' | 'scan' | 'idle'
  face: null,                // latest tracking: { lm (px), pose, geo, t }
  busy: false,
  frameId: 0,
  pending: null,             // geometry for the frame in the worker
  lightHistory: [],
  ticks: {},
  readySince: 0,
  countdownEnd: 0,
  scan: null,
  results: null,
  photo: null,
  profile: null,
  routine: null,
  raf: 0,
};

// ------------------------------------------------------------------ views
function show(view) {
  for (const v of ['landing', 'stage', 'error', 'results', 'goals', 'routine', 'progress']) $(v).hidden = v !== view;
  state.view = view;
  document.body.classList.toggle('camera', view === 'stage');
  document.body.classList.toggle('at-landing', view === 'landing');
  if (['results', 'goals', 'routine', 'progress'].includes(view)) {
    window.scrollTo(0, 0);
    const h = $(view).querySelector('.h1');
    h?.focus({ preventScroll: true });
  }
}

function say(text) { $('live').textContent = text; }

// ------------------------------------------------------------------ sound toggle
function renderSound() {
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('soundLabel').textContent = sound.enabled ? 'Sound on' : 'Sound off';
}
$('sound').addEventListener('click', () => { sound.setEnabled(!sound.enabled); renderSound(); });
const unlock = () => sound.unlock();
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.suspend(); else sound.resume();
});

// ------------------------------------------------------------------ landing
function renderLanding() {
  $('startLabel').textContent = DEMO ? 'Start demo scan' : 'Start scan';
  $('demoLink').hidden = DEMO;
  $('openProgress').hidden = loadScans().length === 0;
}
$('start').addEventListener('click', () => openCamera());
$('retry').addEventListener('click', () => openCamera());
$('home').addEventListener('click', () => { closeCamera(); renderLanding(); show('landing'); });
$('openProgress').addEventListener('click', () => { renderProgress(); show('progress'); });

// ------------------------------------------------------------------ camera
async function openCamera() {
  show('stage');
  $('guide').textContent = 'Starting the camera…';
  $('lightPanel').hidden = false;
  $('scanPanel').hidden = true;
  resetTicks();
  try {
    const trackerP = loadTracker();
    state.cam = DEMO ? await startDemo(video, DEBUG && params.get('src') ? params.get('src') : undefined) : await startCamera(video);
    $('feed').classList.toggle('mirrored', state.cam.mirrored);
    if (DEBUG && params.get('t0')) video.currentTime = +params.get('t0');
    $('guide').textContent = 'Loading the face tracker…';
    await trackerP;
    $('guide').textContent = 'Finding your face…';
    state.mode = 'light';
    state.readySince = 0;
    cancelAnimationFrame(state.raf);
    loop();
  } catch (err) {
    closeCamera();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('errorText').textContent = denied
      ? 'Camera access was blocked. Allow the camera for this site and try again, or try the demo.'
      : `The camera couldn’t start${err?.message ? ` (${err.message})` : ''}. You can try again, or try the demo.`;
    show('error');
  }
}

function closeCamera() {
  cancelAnimationFrame(state.raf);
  state.mode = 'idle';
  sound.stopSweep();
  if (state.cam) stopCamera(video, state.cam);
  state.cam = null;
  state.face = null;
}

$('cancelLight').addEventListener('click', () => { closeCamera(); renderLanding(); show('landing'); });
$('cancelScan').addEventListener('click', () => { closeCamera(); renderLanding(); show('landing'); });
$('scanNow').addEventListener('click', () => { if (allOk()) beginScan(); });

// ------------------------------------------------------------------ main loop
let lastVideoTime = -1;
function loop() {
  state.raf = requestAnimationFrame(loop);
  if (!state.cam || video.readyState < 2) return;
  const now = performance.now();
  if (video.currentTime !== lastVideoTime || state.cam.stream) {
    lastVideoTime = video.currentTime;
    let t = null;
    try { t = track(video); } catch { t = null; }
    if (t) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const lm = t.landmarks.map((p) => ({ x: p.x * vw, y: p.y * vh }));
      const pose = headPose(t.matrix) || { yaw: 0, pitch: 0, roll: 0 };
      pose.side = noseOffset(lm);
      state.face = { lm, pose, geo: buildRegions(lm), t: now };
      if (!state.busy && (state.mode === 'light' || state.mode === 'countdown' || state.mode === 'scan')) sendFrame();
    } else if (state.face && now - state.face.t > 600) {
      state.face = null;
    }
  }
  tickModes(now);
  drawOverlay(now);
}

function sendFrame() {
  const { lm } = state.face;
  const vw = video.videoWidth, vh = video.videoHeight;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const fw = x1 - x0, fh = y1 - y0;
  if (fw < 40) return;
  const pad = 0.06;
  const sx = Math.max(0, x0 - fw * pad), sy = Math.max(0, y0 - fh * pad);
  const sw = Math.min(vw, x1 + fw * pad) - sx, sh = Math.min(vh, y1 + fh * pad) - sy;
  const s = FACE_W / fw;
  const w = Math.round(sw * s), h = Math.round(sh * s);
  if (crop.width !== w || crop.height !== h) { crop.width = w; crop.height = h; }
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  if (DEBUG) debugAlter(lm, sx, sy, s, w, h);
  const img = cctx.getImageData(0, 0, w, h);
  // Geometry in crop coordinates.
  const clm = lm.map((p) => ({ x: (p.x - sx) * s, y: (p.y - sy) * s }));
  const geo = buildRegions(clm);
  const flat = (poly) => poly.flatMap((p) => p);
  const regions = {};
  for (const [k, poly] of Object.entries(geo.regions)) regions[k] = flat(poly);
  if (DEBUG) state.lastCrop = { regions };
  state.busy = true;
  const id = ++state.frameId;
  state.pending = { id, pose: { ...state.face.pose }, faceW: fw, frameMin: Math.min(vw, vh), t: performance.now() };
  worker.postMessage({
    type: 'frame', id, width: w, height: h, data: img.data.buffer,
    regions, eyes: { A: flat(geo.eyes.A), B: flat(geo.eyes.B) }, ed: geo.ed, grad: geo.grad,
  }, [img.data.buffer]);
  // A face snapshot for the optional share-card photo, taken once, early in the scan, while straight.
  if (state.mode === 'scan' && !state.photo && performance.now() - state.scan.start > 1200 && Math.abs(state.face.pose.yaw) < 10) {
    const pc = document.createElement('canvas');
    const side = Math.max(fw, fh) * 1.25;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    pc.width = pc.height = 480;
    const px = pc.getContext('2d');
    if (state.cam.mirrored) { px.translate(480, 0); px.scale(-1, 1); }
    px.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, 480, 480);
    state.photo = pc;
  }
}

/** Debug only (?debug=1): simulate dimmer light (&gain=0.7) or a red flush on the cheeks (&tint=0.12), to check the measures respond. */
function debugAlter(lm, sx, sy, s, w, h) {
  const gain = +params.get('gain') || 1;
  const tint = +params.get('tint') || 0;
  if (gain !== 1) {
    cctx.save(); cctx.globalCompositeOperation = 'multiply';
    const g = Math.round(255 * gain); cctx.fillStyle = `rgb(${g},${g},${g})`; cctx.fillRect(0, 0, w, h); cctx.restore();
  }
  if (tint) {
    const geo = buildRegions(lm.map((p) => ({ x: (p.x - sx) * s, y: (p.y - sy) * s })));
    cctx.save(); cctx.fillStyle = `rgba(230,30,40,${tint})`; cctx.filter = 'blur(6px)';
    for (const r of ['cheekA', 'cheekB']) { cctx.beginPath(); geo.regions[r].forEach(([x, y], i) => (i ? cctx.lineTo(x, y) : cctx.moveTo(x, y))); cctx.closePath(); cctx.fill(); }
    cctx.restore();
  }
}

worker.onmessage = (ev) => {
  state.busy = false;
  const { id, result, error } = ev.data;
  if (error) { console.warn('measure', error); return; }
  const meta = state.pending && state.pending.id === id ? state.pending : null;
  if (!meta || !result) return;
  if (state.mode === 'light' || state.mode === 'countdown') updateLight(result, meta);
  else if (state.mode === 'scan') addScanFrame(result, meta);
};
worker.onerror = (e) => { state.busy = false; console.warn('worker', e.message); };

// ------------------------------------------------------------------ light check
const TICKS = ['face', 'bright', 'even', 'distance', 'straight'];
function resetTicks() {
  state.lightHistory = [];
  state.ticks = {};
  for (const t of TICKS) setTick(t, false, '');
  $('scanNow').disabled = true;
  $('scanNowLabel').textContent = 'Waiting for good light';
}
function setTick(name, ok, hint) {
  const li = $('ticks').querySelector(`[data-tick="${name}"]`);
  const was = state.ticks[name];
  state.ticks[name] = ok;
  li.classList.toggle('ok', ok);
  li.classList.toggle('bad', !ok && !!hint);
  li.querySelector('[data-hint]').textContent = ok ? '' : hint;
  if (ok && was === false && state.view === 'stage') sound.tick();
}
const allOk = () => TICKS.every((t) => state.ticks[t]);

/** Evaluate one frame's light values; ticks use a majority over the last 8 frames, so they don't flicker. */
function updateLight(r, meta) {
  const L = r.light;
  const p = meta.pose;
  const faceFrac = meta.faceW / meta.frameMin;
  const checks = {
    bright: L.clip > 0.05 ? 'Too bright: step out of direct sun or away from the lamp'
      : (L.eyeRef < 40 || L.faceL < 18) ? 'Too dark: face a window or a soft lamp' : '',
    even: Math.abs(L.cheekA - L.cheekB) > 11 ? 'Light from one side: turn to face the light'
      : Math.max(L.spreadA, L.spreadB) > 30 ? 'Harsh shadows: find softer, even light' : '',
    distance: (faceFrac < 0.28 || meta.faceW < 170) ? 'Move a little closer' : faceFrac > 0.9 ? 'Move back a little' : '',
    straight: Math.abs(p.yaw) > 14 ? 'Turn to face the camera' : Math.abs(p.pitch) > 18 ? (p.pitch > 0 ? 'Lift your chin a little' : 'Lower your chin a little')
      : Math.abs(p.roll) > 12 ? 'Hold your head level' : '',
  };
  if (Number.isNaN(L.cheekA) || Number.isNaN(L.cheekB)) checks.even = 'Keep both cheeks in view';
  state.lightHistory.push(checks);
  if (state.lightHistory.length > 8) state.lightHistory.shift();
  state.lastLight = L;
  for (const k of Object.keys(checks)) {
    const okCount = state.lightHistory.filter((c) => !c[k]).length;
    const ok = okCount >= Math.ceil(state.lightHistory.length * 0.6) && state.lightHistory.length >= 3;
    const recent = [...state.lightHistory].reverse().find((c) => c[k]);
    setTick(k, ok, ok ? '' : checks[k] || recent?.[k] || '');
  }
  if (DEBUG) $('guide').textContent = `cA ${L.cheekA?.toFixed(0)} cB ${L.cheekB?.toFixed(0)} L ${L.faceL?.toFixed(0)} eye ${L.eyeRef?.toFixed(0)} Δcheek ${(L.cheekA - L.cheekB).toFixed(1)} spread ${Math.max(L.spreadA, L.spreadB).toFixed(0)} clip ${(L.clip * 100).toFixed(1)}% size ${(faceFrac * 100).toFixed(0)}% yaw ${p.yaw.toFixed(0)} pitch ${p.pitch.toFixed(0)} roll ${p.roll.toFixed(0)}`;
}

function tickModes(now) {
  if (state.mode !== 'light' && state.mode !== 'countdown') {
    if (state.mode === 'scan') tickScan(now);
    return;
  }
  setTick('face', !!state.face, state.face ? '' : 'Bring your face into the oval');
  if (!state.face) state.lightHistory = [];
  const ok = allOk() || (DEBUG && params.has('force') && !!state.face);
  if (ok) {
    if (!state.readySince) state.readySince = now;
    if (state.mode === 'light' && now - state.readySince > 800) {
      state.mode = 'countdown';
      state.countdownEnd = now + 3000;
    }
  } else {
    state.readySince = 0;
    if (state.mode === 'countdown') state.mode = 'light';
  }
  $('scanNow').disabled = !ok;
  if (state.mode === 'countdown') {
    const s = Math.ceil((state.countdownEnd - now) / 1000);
    $('scanNowLabel').textContent = `Starting in ${s}… Start now`;
    if (!DEBUG) $('guide').textContent = 'Good light. Hold still';
    if (now >= state.countdownEnd) beginScan();
  } else {
    $('scanNowLabel').textContent = ok ? 'Start scan' : 'Waiting for good light';
    if (!DEBUG) {
      const first = TICKS.find((t) => !state.ticks[t]);
      const hint = first && $('ticks').querySelector(`[data-tick="${first}"] [data-hint]`).textContent;
      $('guide').textContent = state.face ? (hint || 'Checking your light…') : 'Bring your face into the oval';
    }
  }
}

// ------------------------------------------------------------------ scan
const SWEEP = [
  { until: 1.5, regions: ['forehead'], text: 'Measuring your forehead' },
  { until: 3, regions: ['nose'], text: 'Measuring your T-zone' },
  { until: 5, regions: ['cheekA', 'cheekB'], text: 'Measuring your cheeks' },
  { until: 6.5, regions: ['underA', 'underB', 'crowA', 'crowB'], text: 'Measuring your under-eyes' },
  { until: 8, regions: ['nlA', 'nlB'], text: 'Measuring your smile lines' },
  { until: 9, regions: ['chin'], text: 'Measuring your chin' },
];
const POSES = [
  { until: 3, text: 'Look straight at the camera' },
  { until: 6, text: 'Turn slightly to your left' },
  { until: 9, text: 'Now slightly to your right' },
];

function beginScan() {
  state.mode = 'scan';
  state.photo = null;
  state.scan = { start: performance.now(), frames: [], lost: 0, lastFace: performance.now(), elapsed: 0, last: performance.now(), lights: [] };
  $('lightPanel').hidden = true;
  $('scanPanel').hidden = false;
  sound.startSweep(SCAN_SECONDS);
  say('Scan started. Look straight at the camera.');
}

function tickScan(now) {
  const sc = state.scan;
  const dt = (now - sc.last) / 1000;
  sc.last = now;
  // The clock only runs while a face is in view.
  if (state.face) { sc.elapsed += dt; sc.lastFace = now; }
  const t = sc.elapsed;
  const lost = !state.face && now - sc.lastFace > 700;
  const pose = POSES.find((p) => t < p.until) || POSES[POSES.length - 1];
  $('guide').textContent = lost ? 'I’ve lost your face. Look back at the camera' : pose.text;
  const step = SWEEP.find((s) => t < s.until) || SWEEP[SWEEP.length - 1];
  $('scanStep').textContent = step.text;
  const pct = Math.min(100, Math.round((t / SCAN_SECONDS) * 100));
  $('scanBar').firstElementChild.style.width = pct + '%';
  $('scanBar').setAttribute('aria-valuenow', String(pct));
  if (t >= SCAN_SECONDS) {
    if (sc.frames.length >= MIN_FRAMES || t >= SCAN_SECONDS + 6) finishScan();
    else $('scanStep').textContent = 'Just a moment more…';
  }
}

function addScanFrame(r, meta) {
  const p = meta.pose;
  if (Math.abs(p.yaw) > 32 || Math.abs(p.pitch) > 24 || r.light.clip > 0.12) return;
  // A cheek or under-eye turned away from the camera is foreshortened: don't count it in that frame.
  const c = r.counts;
  const weights = {
    cheekA: c.cheekA < 0.55 * c.cheekB ? 0 : 1, cheekB: c.cheekB < 0.55 * c.cheekA ? 0 : 1,
    underA: c.underA < 0.55 * c.underB ? 0 : 1, underB: c.underB < 0.55 * c.underA ? 0 : 1,
  };
  r.weights = weights;
  state.scan.frames.push(r);
  state.scan.lights.push(r.light.faceL);
}

function finishScan() {
  const sc = state.scan;
  state.mode = 'idle';
  sound.stopSweep();
  if (sc.frames.length < 8) {
    closeCamera();
    $('errorText').textContent = 'I couldn’t get a steady reading. Try again facing soft, even light, and keep your face in the oval.';
    show('error');
    return;
  }
  const res = aggregate(sc.frames);
  res.frames = sc.frames.length;
  res.light = median(sc.lights);
  res.date = new Date();
  res.demo = !!state.cam?.demo;
  const sum = summary(res);
  res.focus = sum.focus;
  state.results = res;
  window.__skin.lastRaw = res;
  closeCamera();
  renderResults();
  show('results');
  sound.chime();
  say('Your results are ready.');
}

function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

// ------------------------------------------------------------------ overlay
function drawOverlay(now) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = overlay.clientWidth, ch = overlay.clientHeight;
  if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) {
    overlay.width = Math.round(cw * dpr); overlay.height = Math.round(ch * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, cw, ch);
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  // A tall video on a wide screen (the demo clip on a laptop) is shown whole, not cropped.
  const contain = vw / vh < 0.85 && cw / ch > 1.1;
  video.classList.toggle('contain', contain);
  const s = contain ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const P = (p) => [ox + p[0] * s, oy + p[1] * s];
  const poly = (pts) => { octx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); if (i) octx.lineTo(x, y); else octx.moveTo(x, y); }); octx.closePath(); };

  if (!state.face) {
    // An oval guide where the face should go.
    octx.strokeStyle = 'rgba(255,255,255,.55)';
    octx.lineWidth = 2;
    octx.setLineDash([6, 8]);
    octx.beginPath();
    const r = Math.min(cw, ch);
    octx.ellipse(cw / 2, ch * 0.42, r * 0.26, r * 0.34, 0, 0, Math.PI * 2);
    octx.stroke();
    octx.setLineDash([]);
    return;
  }
  const { geo } = state.face;
  // Face outline, soft.
  poly(geo.oval);
  octx.strokeStyle = state.mode === 'scan' ? 'rgba(255,181,154,.55)' : (allOk() ? 'rgba(143,224,176,.7)' : 'rgba(255,255,255,.4)');
  octx.lineWidth = 1.5;
  octx.stroke();

  if (state.mode === 'scan') {
    const t = state.scan.elapsed;
    const idx = SWEEP.findIndex((s2) => t < s2.until);
    SWEEP.forEach((step, i) => {
      const active = i === (idx === -1 ? SWEEP.length - 1 : idx);
      const done = idx === -1 || i < idx;
      if (!active && !done) return;
      for (const r of step.regions) {
        poly(geo.regions[r]);
        const pulse = active ? 0.22 + 0.14 * Math.sin(now / 160) : 0.1;
        octx.fillStyle = `rgba(255,181,154,${pulse})`;
        octx.fill();
        octx.strokeStyle = `rgba(255,181,154,${active ? 0.85 : 0.35})`;
        octx.lineWidth = 1.2;
        octx.stroke();
      }
    });
  } else if (DEBUG) {
    octx.font = '11px system-ui';
    for (const [name, pts] of Object.entries(geo.regions)) {
      poly(pts);
      octx.strokeStyle = 'rgba(255,220,120,.9)'; octx.lineWidth = 1; octx.stroke();
      const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
      const [x, y] = P(c);
      octx.save();
      if (state.cam?.mirrored) { octx.translate(x, y); octx.scale(-1, 1); octx.translate(-x, -y); }
      octx.fillStyle = '#fff'; octx.fillText(name, x - 14, y + 4);
      octx.restore();
    }
    for (const side of ['A', 'B']) { poly(geo.eyes[side]); octx.strokeStyle = 'rgba(120,200,255,.9)'; octx.stroke(); }
    if (params.get('debug') === 'pts') {
      for (const i of [50, 280, 205, 425, 123, 352, 117, 346, 187, 411, 101, 330, 36, 266, 147, 376, 213, 433, 192, 416, 234, 454, 132, 361, 93, 323]) {
        const [x, y] = P([state.face.lm[i].x, state.face.lm[i].y]);
        octx.fillStyle = '#7cf'; octx.fillRect(x - 2, y - 2, 4, 4);
        octx.save();
        if (state.cam?.mirrored) { octx.translate(x, y); octx.scale(-1, 1); octx.translate(-x, -y); }
        octx.fillStyle = '#fff'; octx.fillText(String(i), x + 3, y - 3);
        octx.restore();
      }
    }
  }
}

// ------------------------------------------------------------------ results
const INFO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>';

function renderResults() {
  const res = state.results;
  $('resultsDate').textContent = res.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('demoNote').hidden = !res.demo;
  const sum = summary(res);
  $('summaryText').textContent = sum.text;
  $('summaryPositive').textContent = sum.positive;
  $('escalate').hidden = !escalation(res);
  const cards = $('cards');
  cards.innerHTML = '';
  for (const k of MEASURES) {
    const m = res.m[k];
    const lv = level(m.score);
    const card = document.createElement('article');
    card.className = 'card glass';
    const howId = `how-${k}`;
    card.innerHTML = `
      <h3>${NAMES[k]}${k === 'texture' ? ' <span class="rough">rough estimate</span>' : ''}
        <button class="info" type="button" aria-expanded="false" aria-controls="${howId}" aria-label="How ${NAMES[k].toLowerCase()} is measured">${INFO_ICON}</button></h3>
      <div class="lvl ${lv.id}"><b>${lv.label}</b> · ${Number.isFinite(m.score) ? m.score : '–'}/100</div>
      <div class="bar" aria-hidden="true"><span style="width:${Number.isFinite(m.score) ? Math.max(3, m.score) : 0}%"></span></div>
      ${faceMapSVG(intensitiesFor(k, res.raw), `Where ${NAMES[k].toLowerCase()} was seen`)}
      <p>${sentence(k, res)}</p>
      <p class="how" id="${howId}" hidden>${HOW[k]}</p>`;
    const btn = card.querySelector('.info');
    btn.addEventListener('click', () => {
      const how = card.querySelector('.how');
      how.hidden = !how.hidden;
      btn.setAttribute('aria-expanded', String(!how.hidden));
    });
    cards.append(card);
  }
  const maxSe = Math.max(...MEASURES.map((k) => res.m[k].se).filter(Number.isFinite));
  $('steady').textContent = `Averaged over ${res.frames} frames.${Number.isFinite(maxSe) ? ` Frame-to-frame wobble in this scan: about ±${Math.max(1, Math.round(maxSe * 2))} points.` : ''} To compare like with like, re-scan in the same light.`;
  $('saveLabel').textContent = 'Save this scan';
  $('saveScan').disabled = false;
}

$('saveScan').addEventListener('click', () => {
  const ok = saveScan(state.results, state.results.light);
  $('saveLabel').textContent = ok ? 'Saved on device' : 'Can’t save here';
  $('saveScan').disabled = ok;
  say(ok ? 'Saved. Only the numbers are kept, on this device.' : 'Saving is blocked in this browser.');
});
$('again').addEventListener('click', () => openCamera());
$('toGoals').addEventListener('click', () => { renderGoals(); show('goals'); });

// ------------------------------------------------------------------ goals
function defaultProfile() {
  const saved = loadProfile();
  const res = state.results;
  const p = {
    goals: res ? suggestGoals(res) : [],
    skinType: res ? suggestSkinType(res.m) : 'normal',
    age: saved?.age || '25-34',
    budget: saved?.budget || 'mid',
    pregnant: saved?.pregnant || false,
  };
  if (saved?.skinType && saved.fromUser) p.skinType = saved.skinType;
  if (!p.goals.length) p.goals = ['hydration'];
  return p;
}

function chipGroup(el, items, isOn, onToggle) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(isOn(it.id)));
    b.addEventListener('click', () => { onToggle(it.id); chipGroup(el, items, isOn, onToggle); el.querySelectorAll('.chip')[items.indexOf(it)].focus(); });
    el.append(b);
  }
}

function renderGoals() {
  if (!state.profile) state.profile = defaultProfile();
  const p = state.profile;
  const suggested = state.results ? suggestSkinType(state.results.m) : null;
  $('typeHint').textContent = suggested ? `(the scan suggests ${suggested}; change it if it doesn’t feel right)` : '';
  chipGroup($('goalChips'), GOALS, (id) => p.goals.includes(id), (id) => {
    p.goals = p.goals.includes(id) ? p.goals.filter((g) => g !== id) : [...p.goals, id];
  });
  chipGroup($('typeChips'), SKIN_TYPES, (id) => p.skinType === id, (id) => { p.skinType = id; p.fromUser = true; });
  chipGroup($('ageChips'), AGE_BANDS, (id) => p.age === id, (id) => { p.age = id; });
  chipGroup($('budgetChips'), BUDGETS, (id) => p.budget === id, (id) => { p.budget = id; });
  chipGroup($('pregChips'), [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }], (id) => (id === 'yes') === p.pregnant, (id) => { p.pregnant = id === 'yes'; });
}
$('goalsBack').addEventListener('click', () => show('results'));
$('build').addEventListener('click', () => {
  saveProfile({ ...state.profile });
  state.routine = buildRoutine(state.profile);
  renderRoutine();
  show('routine');
});

// ------------------------------------------------------------------ routine
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderSteps(el, steps) {
  el.innerHTML = steps.map((s) => `
    <li>
      <h3>${esc(s.name)}${s.night ? `<span class="night">${s.night}</span>` : ''}</h3>
      <p class="prod">Try ${esc(s.product)}</p>
      <p>${esc(s.forText)}</p>
      <p class="startl"><b>How to start:</b> ${esc(s.start)}</p>
      ${s.notes.map((n) => `<p class="avoid">${esc(n)}</p>`).join('')}
    </li>`).join('');
}
function renderRoutine() {
  const r = state.routine;
  renderSteps($('amSteps'), r.am);
  renderSteps($('pmSteps'), r.pm);
  $('excludedBox').hidden = !r.excluded.length;
  $('excluded').innerHTML = r.excluded.map((x) => `<li><b>${esc(x.name)}:</b> ${esc(x.why)}</li>`).join('');
  $('intro').innerHTML = r.intro.map((x) => `<li>${esc(x)}</li>`).join('');
  $('routineNotes').innerHTML = r.notes.map((x) => `<li>${esc(x)}</li>`).join('');
}
$('routineBack').addEventListener('click', () => { renderGoals(); show('goals'); });
$('routineResults').addEventListener('click', () => show('results'));

// ------------------------------------------------------------------ progress
function renderProgress() {
  const list = loadScans();
  const tr = trends(list);
  const box = $('trendBox');
  if (!list.length) box.innerHTML = '<p>No saved scans yet. After a scan, tap “Save this scan”.</p>';
  else if (!tr) box.innerHTML = '<p>One scan saved. Scan again next week, in the same light, to see trends.</p>';
  else {
    box.innerHTML = `<h3>Since your earlier scan</h3><ul>${tr.lines.map((l) => `<li class="${l.dir < 0 ? 'trend-down' : l.dir > 0 ? 'trend-up' : ''}">${esc(l.text)}</li>`).join('')}</ul>
      <p class="fine">${tr.lightNote ? esc(tr.lightNote) + ' ' : ''}Same light as last time keeps comparisons like for like. Changes under 5 points are within the scan’s normal wobble.</p>`;
  }
  $('history').innerHTML = history(list).map((h) => `<li><b>${h.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</b>${MEASURES.map((k) => `${NAMES[k]} ${Number.isFinite(h.scores[k]) ? h.scores[k] : '–'}`).join(' · ')}</li>`).join('');
}
$('deleteData').addEventListener('click', () => {
  deleteAll();
  state.profile = null;
  renderProgress();
  say('All saved scans and settings are deleted from this device.');
  $('trendBox').innerHTML = '<p>Deleted. Nothing is stored on this device now.</p>';
});
$('progressScan').addEventListener('click', () => openCamera());

// ------------------------------------------------------------------ share
let includePhoto = false;
function drawCard() {
  const res = state.results;
  if (!state.routine) {
    if (!state.profile) state.profile = defaultProfile();
    state.routine = buildRoutine(state.profile);
  }
  const top = MEASURES.filter((k) => Number.isFinite(res.m[k].score)).sort((a, b) => res.m[b].score - res.m[a].score).slice(0, 3);
  drawShareCard($('card'), { res, top, routine: state.routine, photo: state.photo, includePhoto, date: res.date, summary: summary(res).text });
}
function openShare() {
  includePhoto = false;
  $('includePhoto').setAttribute('aria-pressed', 'false');
  $('includePhoto').hidden = !state.photo;
  drawCard();
  $('sheet').showModal();
}
$('shareOpen').addEventListener('click', openShare);
$('routineShare').addEventListener('click', openShare);
$('includePhoto').addEventListener('click', () => {
  includePhoto = !includePhoto;
  $('includePhoto').setAttribute('aria-pressed', String(includePhoto));
  drawCard();
});
$('sheetClose').addEventListener('click', () => $('sheet').close());
$('shareGo').addEventListener('click', async () => {
  const how = await shareCanvas($('card'));
  if (how === 'downloaded') say('Saved the card as an image.');
});

// ------------------------------------------------------------------ start
renderSound();
renderLanding();
show('landing');

// Hooks for quick headless checks (no effect on normal use).
window.__skin = {
  state,
  waitFor(view, ms = 55000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const id = setInterval(() => {
        if (state.view === view || performance.now() - t0 > ms) { clearInterval(id); resolve(state.view); }
      }, 200);
    });
  },
  scores() { return state.results ? Object.fromEntries(MEASURES.map((k) => [k, state.results.m[k].score])) : null; },
};
