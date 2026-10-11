// Macro Mirror: wires the camera (or demo clip), face tracking, the plate and the timeline to the
// renderer. Each new video frame is tracked and then drawn with the landmarks from that same frame,
// so the change never slides behind the face.

import { Renderer } from './renderer.js';
import { buildRig, landmarksToCanvas } from './face-rig.js';
import { Sound } from './sound.js';
import { composeCard, showResult, clipFormat, recordCanvas } from './share.js';
import {
  FOODS, DEFAULT_PLATE, ACTIVITY, AGE_BANDS, SEXES, STOPS,
  daysAt, kgAfter, maintenance, intake, betterPlate, faceParams, captionFor, formatKg,
} from './model.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEBUG = params.has('debug');

const PROBLEMS = {
  blocked: "Camera is blocked. Allow it in your browser's address bar, then try again.",
  missing: 'No camera found. Connect one and try again, or watch the demo.',
  busy: 'Your camera is busy in another app. Close it there, then try again.',
  insecure: 'The camera only works on a secure (https) page. Open the https link and try again.',
  webgl: "This browser can't run WebGL2, which the mirror needs. Try a recent Chrome, Safari or Firefox.",
  tracking: "Face tracking couldn't start on this browser. Try a recent Chrome or Safari.",
};
function problemOf(error) {
  switch (error && error.name) {
    case 'NotAllowedError': case 'SecurityError': return 'blocked';
    case 'NotReadableError': case 'AbortError': return 'busy';
    case 'InsecureContext': return 'insecure';
    case 'WebGL': return 'webgl';
    case 'Tracking': return 'tracking';
    default: return 'missing';
  }
}

// ---- State -----------------------------------------------------------------------------------
const state = {
  plate: { ...DEFAULT_PLATE },
  profile: { age: '30', sex: 'x', height: 170, weight: 72, activity: 'walk', smoking: false },
  pos: 0,               // slider 0..6
  future: 'this',       // 'this' | 'better'
  split: false,
  hold: false,
  mirror: !DEMO,
  amount: 0,            // face found fade
  shown: { this: null, better: null },   // smoothed face params
};
if (params.has('t')) state.pos = Math.max(0, Math.min(6, parseFloat(params.get('t')) || 0));
if (params.get('future') === 'better') state.future = 'better';
if (params.has('split')) state.split = true;

const sound = new Sound();
let renderer = null;
let tracker = null;
let video = $('camera');
let stream = null;
let running = false;
let fresh = false;
let lastP = null;          // landmarks in canvas px from the latest frame
let recording = null;      // { canvas, ctx, start, guess }
let pausedDemoAt = null;

// ---- Numbers -----------------------------------------------------------------------------------
function numbers() {
  const burn = maintenance(state.profile);
  const eat = intake(state.plate);
  const better = betterPlate(state.plate, burn);
  return { burn, eat, surplus: eat - burn, better, betterSurplus: better.kcal - burn };
}

function kcalText(surplus) {
  const v = Math.round(Math.abs(surplus) / 10) * 10;
  if (v < 30) return 'About <strong>even</strong> with what you burn';
  return `About <strong>${surplus > 0 ? '+' : '−'}${v} kcal/day</strong> ${surplus > 0 ? 'over' : 'under'} what you burn`;
}

function stopIndex(pos) { return Math.round(pos); }

function updateReadout() {
  const n = numbers();
  const which = state.future;
  const surplus = which === 'better' ? n.betterSurplus : n.surplus;
  const days = daysAt(state.pos);
  const kg = kgAfter(surplus, days);
  $('kcal').innerHTML = (which === 'better' ? 'Better plate: ' : '') + kcalText(surplus);
  $('sheet-kcal').innerHTML = `${Math.round(n.eat)} kcal eaten · ${Math.round(n.burn)} burned · ${kcalText(n.surplus).replace('About ', 'about ')}`;
  const idx = stopIndex(state.pos);
  const near = Math.abs(state.pos - idx) < 0.08;
  const capped = kg < -8 ? ' (shown up to −8 kg)' : kg > 15 ? ' (shown up to +15 kg)' : '';
  if (days < 1) {
    $('caption').textContent = captionFor(0, 0, which);
    $('numbers').innerHTML = 'Drag the timeline to see where this plate leads. <button type="button" data-info>Assumptions</button>';
  } else {
    const label = near ? STOPS[idx].label : timeLabel(days);
    $('caption').textContent = near ? captionFor(idx, kg, which) : `${label} from now`;
    const swaps = which === 'better' && n.better.swaps.length
      ? ` Swapped: ${n.better.swaps.map((s) => `${s.from.toLowerCase()} → ${s.to.toLowerCase()}`).join(', ')}.` : '';
    $('numbers').innerHTML = `about ${formatKg(kg)} after ${label} at this rate${capped}.${swaps} <button type="button" data-info>(i) Not a prediction</button>`;
  }
  // Split view tags carry their own numbers.
  if (state.split) {
    $('split-left').textContent = `Better plate · ${formatKg(kgAfter(n.betterSurplus, days))}`;
    $('split-right').textContent = `This plate · ${formatKg(kgAfter(n.surplus, days))}`;
  }
}

function timeLabel(days) {
  if (days < 45) return `${Math.max(1, Math.round(days / 7))} weeks`;
  if (days < 340) return `${Math.round(days / 30.4)} months`;
  const y = days / 365.25;
  return y < 1.5 ? '1 year' : `${y < 4 ? y.toFixed(1).replace('.0', '') : Math.round(y)} years`;
}

function targetParams(which, pos) {
  const n = numbers();
  const surplus = which === 'better' ? n.betterSurplus : n.surplus;
  const days = daysAt(pos);
  const plate = which === 'better' ? swappedPlate(n.better) : state.plate;
  return faceParams(kgAfter(surplus, days), days / 365.25, plate, state.profile);
}

function swappedPlate(better) {
  const p = { ...state.plate };
  for (const s of better.swaps) {
    const f = FOODS.find((x) => x.name === s.from);
    if (f) p[f.id] = 0;
  }
  return p;
}

const ZERO = { gain: 0, lean: 0, age: 0, grey: 0, flush: 0 };
function smooth(cur, target, k) {
  if (!cur) return { ...target };
  const out = {};
  for (const key of Object.keys(target)) out[key] = cur[key] + (target[key] - cur[key]) * k;
  return out;
}

// ---- Video sources -------------------------------------------------------------------------------
async function openCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera needs https'), { name: 'InsecureContext' });
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  video.removeAttribute('src');
  video.loop = false;
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
}

async function openDemo() {
  video.srcObject = null;
  video.src = 'assets/demo-portrait.mp4';
  video.poster = 'assets/demo-poster.jpg';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('demo clip failed')), { once: true });
    video.load();
  });
  try { await video.play(); } catch { /* autoplay blocked: frames still draw once it starts */ }
}

function watchFrames() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const cb = () => { fresh = true; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
}
function takeFrame() {
  if (video.readyState < 2) return false;
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return true;
  const f = fresh;
  fresh = false;
  return f;
}

// ---- Layout ----------------------------------------------------------------------------------------
const canvas = $('view');
let layoutDirty = true;
window.addEventListener('resize', () => { layoutDirty = true; });
let free = null;      // the part of the screen between the readout and the controls, canvas px
let measureFree = function () {
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / Math.max(1, r.width);
  const readout = document.querySelector('.readout').getBoundingClientRect();
  const bottom = document.querySelector('.bottom').getBoundingClientRect();
  const top = readout.height && getComputedStyle(document.querySelector('.readout')).display !== 'none' ? readout.bottom : 60;
  free = { top: top * dpr, bottom: Math.max(top + 120, bottom.top) * dpr };
};

function viewMapping() {
  const W = canvas.width, H = canvas.height;
  const vw = video.videoWidth || 720, vh = video.videoHeight || 1280;
  let scale = Math.max(W / vw, H / vh);
  let ox = (W - vw * scale) / 2, oy = (H - vh * scale) / 2;
  if (DEMO && free) {
    // The demo clip is framed very close. Fit forehead-to-neck (about 10%..75% of its height)
    // into the free part of the screen so nothing that changes hides under the controls.
    scale = Math.min(scale, (free.bottom - free.top) / (0.66 * vh));
    ox = (W - vw * scale) / 2;
    oy = free.top - 0.09 * vh * scale;
  }
  return { map: [ox, oy, vw * scale, vh * scale], mirror: state.mirror };
}

function fitCanvas() {
  const r = canvas.getBoundingClientRect();
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  const maxPx = 2.6e6;
  if (r.width * r.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (r.width * r.height));
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (!free || canvas.width !== w || canvas.height !== h || layoutDirty) {
    renderer?.resize(w, h);
    measureFree();
    layoutDirty = false;
  }
  return dpr;
}

// ---- The loop --------------------------------------------------------------------------------------
let lastTime = performance.now();
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (recording) driveRecording(now);
  fitCanvas();
  const view = viewMapping();
  if (takeFrame()) {
    if (tracker) {
      const found = tracker.detect(video, now);
      if (found) lastP = landmarksToCanvas(tracker.points, view);
      else lastP = null;
    }
    renderer.upload(video);
  } else if (lastP && tracker?.found) {
    // Same frame, but the canvas may have been resized or flipped.
    lastP = landmarksToCanvas(tracker.points, view);
  }

  const target = lastP ? 1 : 0;
  state.amount += (target - state.amount) * Math.min(1, dt * (target ? 6 : 10));
  const k = Math.min(1, dt * 9);
  const tThis = state.hold ? ZERO : targetParams('this', state.pos);
  const tBetter = state.hold ? ZERO : targetParams('better', state.pos);
  state.shown.this = smooth(state.shown.this, tThis, k);
  state.shown.better = smooth(state.shown.better, tBetter, k);

  const passes = [];
  const W = canvas.width;
  if (lastP && state.amount > 0.001) {
    if (state.split) {
      const splitX = Math.max(1, Math.min(W - 1, lastP[6].x));
      passes.push({ rig: buildRig(lastP, view, state.shown.better, state.amount, W, canvas.height), scissor: [0, splitX] });
      passes.push({ rig: buildRig(lastP, view, state.shown.this, state.amount, W, canvas.height), scissor: [splitX, W] });
      placeSplitLabels(lastP);
    } else {
      const fp = state.future === 'better' ? state.shown.better : state.shown.this;
      passes.push({ rig: buildRig(lastP, view, fp, state.amount, W, canvas.height), scissor: null });
    }
  }
  renderer.draw(view, passes);
  if (recording) drawRecordingFrame();
  if (DEBUG) drawDebug(view);
  updateStatus();
}

let statusShown = null;
function updateStatus() {
  let text = '';
  if (!tracker) text = 'Starting face tracking…';
  else if (!lastP) text = 'Face the camera, in good light';
  if (text !== statusShown) {
    statusShown = text;
    $('status').textContent = text;
    $('status').hidden = !text;
  }
}

function placeSplitLabels(P) {
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  const x = P[6].x / dpr;
  const topY = Math.min(P[10].y, P[54].y, P[284].y) / dpr;
  const left = $('split-left'), right = $('split-right'), seam = $('seam');
  seam.style.left = `${x}px`;
  const s = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y) / dpr;
  seam.style.top = `${Math.max(0, topY - 60)}px`;
  seam.style.bottom = 'auto';
  seam.style.height = `${P[152].y / dpr + 0.7 * s - Math.max(0, topY - 60)}px`;
  const y = Math.max(150, topY - 52);
  left.style.top = right.style.top = `${y}px`;
  left.style.right = `calc(100% - ${x - 8}px)`;
  left.style.left = 'auto';
  right.style.left = `${x + 8}px`;
}

// ---- Debug overlay (?debug=1): landmark numbers, to check the anatomy -------------------------------
function drawDebug() {
  const c = $('debug');
  c.hidden = false;
  if (c.width !== canvas.width) { c.width = canvas.width; c.height = canvas.height; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!lastP) return;
  ctx.font = `${Math.round(c.width / 140)}px monospace`;
  for (let i = 0; i < 468; i++) {
    const p = lastP[i];
    ctx.fillStyle = 'rgba(0,255,180,.9)';
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    if (params.get('debug') === '2') { ctx.fillStyle = 'rgba(255,255,0,.85)'; ctx.fillText(i, p.x + 2, p.y - 2); }
  }
}

// ---- Share card --------------------------------------------------------------------------------------
function faceCrop() {
  const P = lastP;
  const s = Math.hypot(P[454].x - P[234].x, P[454].y - P[234].y);
  const cx = (P[6].x + P[152].x) / 2;
  const cy = P[6].y + (P[152].y - P[6].y) * 0.55;
  let h = s * 2.35, w = h * (480 / 720);
  const W = canvas.width, H = canvas.height;
  h = Math.min(h, H); w = Math.min(w, W);
  let x = cx - w / 2, y = cy - h * 0.5;
  x = Math.max(0, Math.min(W - w, x));
  y = Math.max(0, Math.min(H - h, y));
  return [x, y, w, h];
}

function snapshot(fp, crop) {
  const view = viewMapping();
  renderer.draw(view, [{ rig: buildRig(lastP, view, fp, 1, canvas.width, canvas.height), scissor: null }]);
  const c = document.createElement('canvas');
  c.width = 480 * 1.5; c.height = 720 * 1.5;
  c.getContext('2d').drawImage(canvas, crop[0], crop[1], crop[2], crop[3], 0, 0, c.width, c.height);
  return c;
}

function makeCard() {
  if (!lastP) {
    flashStatus('Face the camera, then try again');
    return;
  }
  sound.shutter();
  const n = numbers();
  const fiveYears = 1826;
  const kgThis = kgAfter(n.surplus, fiveYears);
  const kgBetter = kgAfter(n.betterSurplus, fiveYears);
  const crop = faceCrop();
  const pThis = faceParams(kgThis, 5, state.plate, state.profile);
  const pBetter = faceParams(kgBetter, 5, swappedPlate(n.better), state.profile);
  const panels = [
    { image: snapshot(ZERO, crop), title: 'Today', value: 'This is me, right now' },
    { image: snapshot(pThis, crop), title: '5 years · this plate', value: `about ${formatKg(kgThis)}` },
    { image: snapshot(pBetter, crop), title: '5 years · better plate', value: `about ${formatKg(kgBetter)}` },
  ];
  const v = Math.round(Math.abs(n.surplus) / 10) * 10;
  const header = v < 30 ? 'My plate: about even with what I burn' : `My plate: about ${n.surplus > 0 ? '+' : '−'}${v} kcal/day ${n.surplus > 0 ? 'over' : 'under'} what I burn`;
  const card = composeCard(panels, header, 'An illustration from a simple energy-balance model, not a prediction or medical advice.');
  card.toBlob((blob) => { if (blob) showResult(blob, 'png', 'Your future'); }, 'image/png');
}

let flashTimer = 0;
function flashStatus(text) {
  $('status').textContent = text;
  $('status').hidden = false;
  statusShown = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { statusShown = '?'; }, 2200);
}

// ---- 6 s clip: the slider sweeps from today to 10 years -----------------------------------------------
async function startRecording(guess) {
  if (recording) return;
  const format = clipFormat(document.createElement('canvas'));
  if (!format) { flashStatus("This browser can't record clips"); return; }
  $('result').close();
  const W = canvas.width, H = canvas.height;
  const scale = Math.min(1, 1080 / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale / 2) * 2;
  c.height = Math.round(H * scale / 2) * 2;
  recording = { canvas: c, ctx: c.getContext('2d'), start: performance.now(), guess, savedPos: state.pos };
  document.body.classList.add('recording');
  $('rec-badge').hidden = false;
  const blob = await recordCanvas(c, format, 6000);
  state.pos = recording.savedPos;
  syncSlider();
  recording = null;
  $('rec-badge').hidden = true;
  showResult(blob, format.extension, guess ? 'Guess my plate' : 'Your 6 s clip');
}

function driveRecording(now) {
  const t = (now - recording.start) / 1000;
  const f = Math.min(1, t / 5);
  state.pos = 6 * (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
  syncSlider(true);
}

function drawRecordingFrame() {
  const { canvas: c, ctx, guess } = recording;
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const u = c.width / 400;
  const n = numbers();
  const days = daysAt(state.pos);
  const g = ctx.createLinearGradient(0, c.height * 0.7, 0, c.height);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, c.height * 0.7, c.width, c.height * 0.3);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `400 ${Math.round(22 * u)}px system-ui, sans-serif`;
  const idx = stopIndex(state.pos);
  const label = days < 1 ? 'Today' : Math.abs(state.pos - idx) < 0.08 ? STOPS[idx].label : timeLabel(days);
  ctx.fillText(guess ? `Guess my plate · ${label}` : `${label} · ${formatKg(kgAfter(n.surplus, days))}`, c.width / 2, c.height - 44 * u);
  ctx.font = `300 ${Math.round(12 * u)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.fillText('Macro Mirror · @tirupathipodugu · an illustration, not a prediction', c.width / 2, c.height - 20 * u);
}

// ---- Controls ---------------------------------------------------------------------------------------------
const slider = $('slider');
function syncSlider(fromCode) {
  slider.value = String(state.pos);
  slider.style.setProperty('--fill', `${(state.pos / 6) * 100}%`);
  const idx = stopIndex(state.pos);
  slider.setAttribute('aria-valuetext', Math.abs(state.pos - idx) < 0.08 ? STOPS[idx].label : timeLabel(daysAt(state.pos)));
  document.querySelectorAll('#stops button').forEach((b, i) => b.classList.toggle('on', Math.abs(state.pos - i) < 0.08));
  if (!fromCode) return;
  updateReadout();
}

function buildStops() {
  const wrap = $('stops');
  STOPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.style.left = `${(i / 6) * 100}%`;
    b.innerHTML = `<span class="short">${s.short}</span><span class="long">${s.label}</span>`;
    b.addEventListener('click', () => moveTo(i, true));
    wrap.append(b);
  });
}

let lastSliderPos = 0, lastSliderTime = 0, settleTimer = 0;
function moveTo(pos, animate) {
  if (animate) {
    const from = state.pos, start = performance.now();
    const step = (now) => {
      const f = Math.min(1, (now - start) / 450);
      const e = 1 - Math.pow(1 - f, 3);
      setPos(from + (pos - from) * e);
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } else setPos(pos);
}

function setPos(pos) {
  const before = state.pos;
  state.pos = Math.max(0, Math.min(6, pos));
  const now = performance.now();
  const speed = (state.pos - lastSliderPos) / Math.max(0.016, (now - lastSliderTime) / 1000);
  lastSliderPos = state.pos; lastSliderTime = now;
  sound.whoosh(speed);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => sound.whoosh(0), 120);
  // A chime for each milestone passed.
  const a = Math.min(before, state.pos), b = Math.max(before, state.pos);
  for (let i = 1; i < STOPS.length; i++) if (a < i && b >= i && before !== state.pos && Math.abs(b - a) < 3) sound.chime(i);
  syncSlider(true);
}

slider.addEventListener('input', () => setPos(parseFloat(slider.value)));
slider.addEventListener('change', () => {
  const idx = stopIndex(state.pos);
  if (Math.abs(state.pos - idx) < 0.15) moveTo(idx, true);
});

function setFuture(which) {
  state.future = which;
  $('fut-this').setAttribute('aria-checked', String(which === 'this'));
  $('fut-better').setAttribute('aria-checked', String(which === 'better'));
  updateReadout();
}
$('fut-this').addEventListener('click', () => { setSplit(false); setFuture('this'); });
$('fut-better').addEventListener('click', () => { setSplit(false); setFuture('better'); });

function setSplit(on) {
  state.split = on;
  $('split').setAttribute('aria-pressed', String(on));
  $('split-labels').hidden = !on;
  // The better future always shows first: on the left in split view.
  if (on) setFuture('better');
  updateReadout();
}
$('split').addEventListener('click', () => setSplit(!state.split));

const hold = $('hold');
const holdOn = (e) => { e.preventDefault(); state.hold = true; hold.classList.add('held'); };
const holdOff = () => { state.hold = false; hold.classList.remove('held'); };
hold.addEventListener('pointerdown', holdOn);
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) hold.addEventListener(t, holdOff);
hold.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') holdOn(e); });
hold.addEventListener('keyup', holdOff);
hold.addEventListener('contextmenu', (e) => e.preventDefault());

$('save').addEventListener('click', makeCard);
$('record').addEventListener('click', () => startRecording(false));
$('record-guess').addEventListener('click', () => startRecording(true));
$('result-close').addEventListener('click', () => $('result').close());

function renderSound() {
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound-label').textContent = sound.enabled ? 'Sound on' : 'Sound off';
}
$('sound').addEventListener('click', () => { sound.setEnabled(!sound.enabled); renderSound(); });
renderSound();

$('info').addEventListener('click', () => $('info-dialog').showModal());
document.addEventListener('click', (e) => { if (e.target.closest('[data-info]')) $('info-dialog').showModal(); });

// ---- The plate sheet -------------------------------------------------------------------------------------
function buildPlate() {
  const foods = $('foods');
  for (const f of FOODS) {
    const card = document.createElement('div');
    card.className = 'food';
    card.innerHTML = `<span class="label"><span class="name">${f.name}</span><span class="meta">${f.portion} · ${f.kcal} kcal</span></span>
      <span class="stepper"><button type="button" aria-label="One less ${f.name.toLowerCase()}">−</button><output aria-live="polite">0</output><button type="button" aria-label="One more ${f.name.toLowerCase()}">+</button></span>`;
    const [minus, plus] = card.querySelectorAll('button');
    const out = card.querySelector('output');
    const render = () => {
      const n = state.plate[f.id] || 0;
      out.textContent = n;
      minus.disabled = n === 0;
      card.classList.toggle('has', n > 0);
    };
    minus.addEventListener('click', () => { state.plate[f.id] = Math.max(0, (state.plate[f.id] || 0) - 1); render(); updateReadout(); });
    plus.addEventListener('click', () => { state.plate[f.id] = Math.min(12, (state.plate[f.id] || 0) + 1); render(); updateReadout(); });
    // Tapping the card itself adds one too.
    card.querySelector('.label').addEventListener('click', () => plus.click());
    render();
    foods.append(card);
  }
  chips('activity', ACTIVITY, () => state.profile.activity, (v) => { state.profile.activity = v; });
  chips('age', AGE_BANDS, () => state.profile.age, (v) => { state.profile.age = v; });
  chips('sex', SEXES, () => state.profile.sex, (v) => { state.profile.sex = v; });
  chips('smoking', [{ id: 'no', label: 'Non-smoker' }, { id: 'yes', label: 'Smoker' }], () => (state.profile.smoking ? 'yes' : 'no'), (v) => { state.profile.smoking = v === 'yes'; });
  for (const key of ['height', 'weight']) {
    const input = $(key);
    input.value = state.profile[key];
    const sync = () => {
      state.profile[key] = +input.value;
      $(`${key}-out`).textContent = `${input.value} ${key === 'height' ? 'cm' : 'kg'}`;
      updateReadout();
    };
    input.addEventListener('input', sync);
    sync();
  }
  $('trueview').addEventListener('change', (e) => { state.mirror = DEMO ? e.target.checked : !e.target.checked; });
  if (DEMO) $('trueview').parentElement.querySelector('span').textContent = 'Mirror the picture';
}

function chips(id, options, get, set) {
  const wrap = $(id);
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.textContent = o.label;
    b.dataset.id = o.id;
    b.addEventListener('click', () => { set(o.id); renderChips(wrap, get()); updateReadout(); });
    wrap.append(b);
  }
  renderChips(wrap, get());
}
function renderChips(wrap, value) {
  wrap.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === value)));
}

$('plate-open').addEventListener('click', () => { $('plate').hidden = false; $('plate-done').focus(); });
$('plate-done').addEventListener('click', () => { $('plate').hidden = true; $('plate-open').focus(); });

// ---- Start / stop -----------------------------------------------------------------------------------------
async function start(useDemo) {
  sound.unlock();
  $('landing').hidden = true;
  $('error').hidden = true;
  $('stage').hidden = false;
  try {
    if (!renderer) renderer = new Renderer(canvas);
    if (useDemo) await openDemo();
    else await openCamera();
  } catch (error) {
    showError(problemOf(error));
    return;
  }
  watchFrames();
  running = true;
  requestAnimationFrame(frame);
  if (!tracker) {
    try {
      const { Tracker } = await import('./tracker.js');
      tracker = await Tracker.create();
    } catch (error) {
      console.warn('Face tracking failed to start', error);
      showError('tracking');
    }
  }
}

function stop() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
}

function showError(key) {
  stop();
  $('stage').hidden = true;
  $('error').hidden = false;
  $('error-text').textContent = PROBLEMS[key] || PROBLEMS.missing;
}

$('open').addEventListener('click', () => start(DEMO));
$('retry').addEventListener('click', () => start(DEMO));
$('error-demo').addEventListener('click', () => { location.search = '?demo=1'; });
$('close').addEventListener('click', () => {
  stop();
  $('stage').hidden = true;
  $('landing').hidden = false;
  $('plate').hidden = true;
});

document.addEventListener('visibilitychange', () => { if (document.hidden) sound.suspend(); else sound.resume(); });
window.addEventListener('pointerdown', () => sound.unlock(), { once: true, capture: true });

buildStops();
buildPlate();
setFuture(state.future);
if (state.split) setSplit(true);
syncSlider(true);
if (DEMO) {
  $('open').lastChild.textContent = ' Watch the demo';
  document.querySelector('#landing .quiet').textContent = 'A short public-domain clip stands in for your camera.';
}
if (params.has("autostart")) { sound.unlocked = false; start(DEMO); }

// Hooks for quick headless checks (no camera, no clicks needed).
window.__mm = {
  state,
  setPos: (p) => { state.pos = p; syncSlider(true); },
  setFuture,
  setSplit,
  openPlate: () => { $('plate').hidden = false; },
  card: makeCard,
  ready: () => Boolean(tracker && lastP),
  pauseAt: (t) => new Promise((resolve) => {
    pausedDemoAt = t;
    video.pause();
    video.currentTime = t;
    video.addEventListener('seeked', () => { fresh = true; setTimeout(resolve, 300); }, { once: true });
  }),
  settle: () => { state.shown.this = null; state.shown.better = null; },
  flags: (f) => { Object.assign(renderer.flags, f); },
  clean: () => {
    document.querySelectorAll('.top, .readout, .bottom, #status').forEach((e) => { e.style.visibility = 'hidden'; });
    measureFree = () => { free = { top: canvas.height * 0.03, bottom: canvas.height * 0.97 }; };
    layoutDirty = true;
  },
  stats: () => ({ t: video.currentTime, ms: tracker?.ms, found: Boolean(lastP), w: canvas.width, h: canvas.height }),
};
