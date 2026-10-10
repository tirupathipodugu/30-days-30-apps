// Mirror Room entry point: opens the camera (or the demo feed), runs the frame loop and connects
// taps, keys and the quiet controls to the glass. The interesting parts live in the modules below.

import { Mirror } from './shards.js';
import { MirrorRenderer } from './mirror-renderer.js';
import { Ripple } from './ripple.js';
import { TimeBuffer } from './time-buffer.js';
import { openCamera, cameraProblem, PROBLEMS } from './camera.js';
import { createDemoFeed } from './demo-feed.js';
import { Sound } from './sound.js';
import { clipFormat, recordCanvas, showClip } from './recorder.js';
import { playEncore } from './encore.js';
import { Aim } from './aim.js';
import { prefersReducedMotion } from './motion.js';

const $ = (id) => document.getElementById(id);
const canvas = $('glass');
const stage = $('stage');
const counter = $('counter');
const hint = $('hint');

const RECORD_MS = 6000;
const IDLE_MS = 3000;
const LIGHT_HEIGHT = 900;              // px: how high above the glass the pointer light hangs
const TAG = 'Mirror Room · Day 1 / 30 · @tirupathipodugu';
const ENCORE_KEYS = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];

const mirror = new Mirror();
const sound = new Sound();
let renderer = null;
let ripple = null;
let timeBuffer = null;

let source = null;
let sourceKind = 'camera';
let frameId = 0;
let running = false;
let timeOn = false;
let recording = false;
let photoPending = false;
let cancelEncore = null;
let volley = [];                       // timers for a "shatter" volley
let idleTimer = 0;
let titleTaps = [];
let recentKeys = [];

const effects = { glintAt: -Infinity };
const pointer = { x: 0, y: 0, down: null, movedAt: -Infinity };
// Everything the renderer needs each frame, allocated once.
const frame = {
  mirror,
  now: 0,
  ripple: null,
  timeBuffer: null,
  timeOn: false,
  light: new Float32Array([0, 0, LIGHT_HEIGHT]),
  glint: 0,
  tagOn: false,
};

// ---------------------------------------------------------------- starting and stopping

function setUpGraphics() {
  if (renderer) return true;
  try {
    renderer = new MirrorRenderer(canvas);
  } catch (error) {
    console.error(error);
    return false;
  }
  ripple = new Ripple(renderer.gl);
  timeBuffer = new TimeBuffer(renderer.gl);
  renderer.setTag(TAG);
  new Aim($('aim'), $('reticle'), strike);
  frame.ripple = ripple;
  frame.timeBuffer = timeBuffer;
  new ResizeObserver(() => { if (running) resize(); }).observe(stage);
  return true;
}

async function start(kind) {
  sourceKind = kind;
  if (!setUpGraphics()) return showProblem('webgl');
  try {
    source = kind === 'demo' ? createDemoFeed() : await openCamera($('camera'));
  } catch (error) {
    return showProblem(cameraProblem(error));
  }
  $('landing').hidden = true;
  $('error').hidden = true;
  stage.hidden = false;
  setSoundLabel();
  mirror.reset(stage.clientWidth, stage.clientHeight);
  resize();
  frame.light[0] = mirror.width * 0.3;
  frame.light[1] = mirror.height * 0.25;
  updateCounter();
  hint.classList.remove('gone');
  wake();
  running = true;
  frameId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  cancelAnimationFrame(frameId);
  cancelEncore?.();
  stopVolley();
  setTime(false);
  source?.stop();
  source = null;
  stage.hidden = true;
  $('landing').hidden = false;
  $('open').focus();
}

function showProblem(key) {
  $('error-text').textContent = PROBLEMS[key];
  $('landing').hidden = true;
  stage.hidden = true;
  $('error').hidden = false;
  $('retry').focus();
}

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  renderer.resize(width, height);
  ripple.resize(width, height);
  if (timeOn) timeBuffer.allocate(width, height);
  if (width !== mirror.width || height !== mirror.height) mirror.resize(width, height);
}

// ---------------------------------------------------------------- the frame loop

function tick(now) {
  if (!running) return;
  frameId = requestAnimationFrame(tick);
  if (source.width && source.takeFrame()) renderer.uploadFrame(source.element, source.width, source.height);

  mirror.reduced = prefersReducedMotion();
  if (mirror.update(now)) onRestored(now);
  ripple.update(now);
  moveLight(now);

  frame.now = now;
  frame.timeOn = timeOn;
  frame.tagOn = recording || photoPending;
  frame.glint = (now - effects.glintAt) / 1400;
  renderer.render(frame);

  // A photo must be read in the same frame it was drawn.
  if (photoPending) {
    photoPending = false;
    canvas.toBlob((blob) => blob && showClip(blob, 'png'), 'image/png');
  }
}

/**
 * The light follows the pointer. Without one (on a phone, or when the mouse rests) it drifts
 * slowly on its own, so the shards keep catching light at their own angles.
 */
function moveLight(now) {
  let x = pointer.x;
  let y = pointer.y;
  if (now - pointer.movedAt > 2500 && !pointer.down) {
    const t = now / 1000;
    x = mirror.width * (0.5 + 0.38 * Math.sin(t * 0.23));
    y = mirror.height * (0.45 + 0.3 * Math.sin(t * 0.31 + 1));
  }
  const follow = prefersReducedMotion() ? 1 : 0.12;
  frame.light[0] += (x - frame.light[0]) * follow;
  frame.light[1] += (y - frame.light[1]) * follow;
}

// ---------------------------------------------------------------- breaking and restoring

function strike(x, y, force = 1) {
  const now = performance.now();
  const result = mirror.impact(x, y, now);
  if (result === 'broke') {
    sound.crack(force);
    navigator.vibrate?.(8);
    if (!prefersReducedMotion()) ripple.touch(x, y, 0.3, 22, now);
    hint.classList.add('gone');
    updateCounter();
    announce(`${mirror.count} shards`);
  } else if (result === 'full') {
    announce('The glass can’t break any further.');
  }
}

/** Shatter: a volley of 5–7 strikes at random points, a few hundred ms apart. */
function shatter() {
  if (!running || volley.length) return;
  const strikes = 5 + Math.floor(Math.random() * 3);
  let t = 0;
  for (let i = 0; i < strikes; i++) {
    const x = mirror.width * (0.1 + Math.random() * 0.8);
    const y = mirror.height * (0.1 + Math.random() * 0.8);
    volley.push(setTimeout(() => {
      strike(x, y, 1 - i * 0.08);
      if (i === strikes - 1) volley = [];
    }, t));
    t += 140 + Math.random() * 160;
  }
}

function stopVolley() {
  for (const id of volley) clearTimeout(id);
  volley = [];
}

function restore() {
  stopVolley();
  if (!mirror.heal(performance.now())) return;
  sound.restore(mirror.healDuration() / 1000);
}

function onRestored(now) {
  if (!mirror.reduced) effects.glintAt = now;
  updateCounter();
  announce('Restored');
}

function updateCounter() {
  counter.textContent = mirror.whole ? '' : String(mirror.count);
}

function announce(text) {
  $('live').textContent = text;
}

// ---------------------------------------------------------------- time, encore, recording, sound

function setTime(on) {
  timeOn = on;
  $('time').setAttribute('aria-pressed', String(on));
  if (on) timeBuffer.allocate(mirror.width, mirror.height);
  else timeBuffer?.release();
}

function encore() {
  if (cancelEncore || !running) return;
  stopVolley();
  cancelEncore = playEncore({
    wholeMirror: () => {
      mirror.reset(mirror.width, mirror.height);
      updateCounter();
    },
    strike: (x, y) => strike(x, y, 0.9),
    restore,
  }, mirror, prefersReducedMotion(), () => { cancelEncore = null; });
}

async function record() {
  if (recording || !running) return;
  const format = clipFormat(canvas);
  if (!format) {
    photoPending = true;
    return;
  }
  const button = $('rec');
  const label = $('rec-label');
  recording = true;
  button.classList.add('recording');
  let left = RECORD_MS / 1000;
  label.textContent = `recording ${left}`;
  const countdown = setInterval(() => { label.textContent = `recording ${--left}`; }, 1000);
  try {
    const blob = await recordCanvas(canvas, format, RECORD_MS);
    showClip(blob, format.extension);
  } catch (error) {
    console.error(error);
    photoPending = true;
  } finally {
    clearInterval(countdown);
    recording = false;
    button.classList.remove('recording');
    label.textContent = 'record';
  }
}

function setSoundLabel() {
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound').textContent = sound.enabled ? 'sound on' : 'sound off';
}

// ---------------------------------------------------------------- input

/** Show the controls, and hide them again after a few seconds without movement. */
function wake() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!stage.querySelector('.chrome :focus-visible')) stage.classList.add('idle');
  }, IDLE_MS);
}

function stagePoint(event) {
  const box = canvas.getBoundingClientRect();
  return [event.clientX - box.left, event.clientY - box.top];
}

stage.addEventListener('pointermove', wake);
stage.addEventListener('pointerdown', wake);

canvas.addEventListener('pointerdown', (event) => {
  const [x, y] = stagePoint(event);
  pointer.down = { x, y, t: event.timeStamp };
  pointer.x = x;
  pointer.y = y;
  pointer.movedAt = performance.now();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  const [x, y] = stagePoint(event);
  pointer.x = x;
  pointer.y = y;
  pointer.movedAt = performance.now();
  // Mouse: ripple wherever it moves. Touch: only while a finger drags.
  if (!prefersReducedMotion() && running) ripple.touch(x, y, pointer.down ? 0.3 : 0.15, 16, performance.now());
});

canvas.addEventListener('pointerup', (event) => {
  const down = pointer.down;
  pointer.down = null;
  if (!down) return;
  const [x, y] = stagePoint(event);
  if (Math.hypot(x - down.x, y - down.y) < 10 && event.timeStamp - down.t < 600 && !cancelEncore) strike(x, y);
});

canvas.addEventListener('pointercancel', () => { pointer.down = null; });

$('stage-title').addEventListener('pointerdown', (event) => {
  titleTaps = titleTaps.filter((t) => event.timeStamp - t < 600);
  titleTaps.push(event.timeStamp);
  if (titleTaps.length >= 3) {
    titleTaps = [];
    encore();
  }
});

document.addEventListener('keydown', (event) => {
  if (!running || event.metaKey || event.ctrlKey || event.altKey || $('sheet').open) return;
  wake();
  if (event.key.startsWith('Arrow')) {
    recentKeys = [...recentKeys, event.key].slice(-ENCORE_KEYS.length);
    if (recentKeys.join() === ENCORE_KEYS.join()) {
      recentKeys = [];
      encore();
    }
    return;
  }
  const actions = { b: shatter, 0: restore, t: () => setTime(!timeOn), r: record };
  const action = actions[event.key.toLowerCase()];
  if (action) {
    event.preventDefault();
    action();
  }
});

$('shatter').addEventListener('click', shatter);
$('restore').addEventListener('click', restore);
$('time').addEventListener('click', () => setTime(!timeOn));
$('rec').addEventListener('click', record);
$('camera-off').addEventListener('click', stop);
$('sound').addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  setSoundLabel();
});
$('open').addEventListener('click', () => start('camera'));
$('retry').addEventListener('click', () => start(sourceKind));
$('error-demo').addEventListener('click', () => start('demo'));
$('close-sheet').addEventListener('click', () => $('sheet').close());

if (new URLSearchParams(location.search).get('demo') === '1') start('demo');
