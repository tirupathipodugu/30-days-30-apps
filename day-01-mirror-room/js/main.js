// Mirror Room entry point: opens the camera (or the demo feed), runs the frame loop and connects
// taps, keys and buttons to the mirror. The interesting parts live in the modules imported below.

import { Mirror } from './pieces.js';
import { MirrorRenderer } from './mirror-renderer.js';
import { Ripple } from './ripple.js';
import { TimeBuffer } from './time-buffer.js';
import { openCamera, cameraProblem, PROBLEMS } from './camera.js';
import { createDemoFeed } from './demo-feed.js';
import { Sound } from './sound.js';
import { clipFormat, recordCanvas, showClip } from './recorder.js';
import { playEncore } from './encore.js';
import { PieceFocus } from './piece-focus.js';
import { prefersReducedMotion } from './motion.js';

const $ = (id) => document.getElementById(id);
const canvas = $('glass');
const stage = $('stage');
const counter = $('counter');
const hint = $('hint');

const RECORD_MS = 6000;
const TAG = 'Mirror Room · Day 1 of 30 · @tirupathipodugu';
const ENCORE_KEYS = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];

const mirror = new Mirror();
const sound = new Sound();
let renderer = null;
let ripple = null;
let timeBuffer = null;
let focus = null;

let source = null;
let sourceKind = 'camera';
let frameId = 0;
let running = false;
let timeOn = false;
let recording = false;
let photoPending = false;
let cancelEncore = null;
let lastTap = { x: 0, y: 0, t: -Infinity };
let titleTaps = [];
let recentKeys = [];
let announceTimer = 0;

const effects = { glintAt: -Infinity, ringAt: -Infinity };
const pointer = { x: 0, y: 0, inside: false, down: null };
// Everything the renderer needs each frame, allocated once.
const frame = {
  mirror,
  now: 0,
  ripple: null,
  timeBuffer: null,
  timeOn: false,
  pointerGlow: new Float32Array(3),
  glint: 0,
  ring: new Float32Array(4),
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
  focus = new PieceFocus($('pieces'), mirror, (index) => breakPiece(index, mirror.pieces[index].cx, mirror.pieces[index].cy));
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
  $('camera-off').setAttribute('aria-label', kind === 'demo' ? 'Leave the demo' : 'Turn camera off');
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  mirror.reset(stage.clientWidth, stage.clientHeight);
  resize();
  updateCounter(false);
  hint.hidden = false;
  running = true;
  frameId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  cancelAnimationFrame(frameId);
  cancelEncore?.();
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

  const reduced = prefersReducedMotion();
  mirror.reduced = reduced;
  if (mirror.update(now)) onReassembled(now);
  ripple.update(now);
  focus.sync();

  frame.now = now;
  frame.timeOn = timeOn;
  frame.tagOn = recording || photoPending;
  const glow = reduced || !ripple.supported;
  frame.pointerGlow[0] = pointer.x;
  frame.pointerGlow[1] = pointer.y;
  frame.pointerGlow[2] = glow && pointer.inside ? 1 : 0;
  frame.glint = (now - effects.glintAt) / 700;
  const ring = (now - effects.ringAt) / 900;
  frame.ring[0] = mirror.width / 2;
  frame.ring[1] = mirror.height / 2;
  frame.ring[2] = ring * Math.hypot(mirror.width, mirror.height) * 0.6;
  frame.ring[3] = ring < 1 ? 0.9 * (1 - ring) : 0;
  renderer.render(frame);

  // A photo must be read in the same frame it was drawn.
  if (photoPending) {
    photoPending = false;
    canvas.toBlob((blob) => blob && showClip(blob, 'png'), 'image/png');
  }
}

// ---------------------------------------------------------------- breaking and mending

function breakPiece(index, x, y) {
  if (index < 0) return;
  const result = mirror.breakAt(index, x, y, performance.now());
  if (result === 'broke') {
    sound.tink(Math.random() * 3);
    navigator.vibrate?.(8);
    afterBreak();
  } else if (result === 'full') {
    announce(`${mirror.count} mirrors. That's as small as it goes.`);
  }
}

function breakAll() {
  const made = mirror.breakAll(performance.now());
  if (!made) return;
  // Each wave rings a little higher than the last.
  sound.tink(Math.log2(mirror.count) * 2 - 4);
  navigator.vibrate?.(8);
  afterBreak();
}

function reassemble() {
  if (!mirror.reassemble(performance.now())) return;
  sound.whoosh(mirror.reassembleDuration() / 1000);
}

function afterBreak() {
  hint.hidden = true;
  updateCounter(true);
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => announce(counterText()), 400);
}

function onReassembled(now) {
  if (!mirror.reduced) effects.glintAt = now;
  updateCounter(false);
  announce('Reassembled');
}

function counterText() {
  return mirror.count === 1 ? '1 mirror' : `${mirror.count} mirrors`;
}

function updateCounter(pop) {
  counter.textContent = counterText();
  if (pop && !prefersReducedMotion()) {
    counter.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }
}

function announce(text) {
  $('live').textContent = text;
}

// ---------------------------------------------------------------- time, encore, recording

function setTime(on) {
  timeOn = on;
  $('time').setAttribute('aria-pressed', String(on));
  if (on) timeBuffer.allocate(mirror.width, mirror.height);
  else timeBuffer?.release();
}

function encore() {
  if (cancelEncore || !running) return;
  cancelEncore = playEncore({
    wholeMirror: () => {
      mirror.reset(mirror.width, mirror.height);
      updateCounter(false);
    },
    breakAll,
    thump: () => sound.thump(),
    ring: () => { effects.ringAt = performance.now(); },
    reassemble,
  }, prefersReducedMotion(), () => { cancelEncore = null; });
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
  label.textContent = `${left}s`;
  const countdown = setInterval(() => { label.textContent = `${--left}s`; }, 1000);
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
    label.textContent = 'Rec 6s';
  }
}

// ---------------------------------------------------------------- input

function stagePoint(event) {
  const box = canvas.getBoundingClientRect();
  return [event.clientX - box.left, event.clientY - box.top];
}

canvas.addEventListener('pointerdown', (event) => {
  const [x, y] = stagePoint(event);
  pointer.down = { x, y, t: event.timeStamp };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  const [x, y] = stagePoint(event);
  pointer.x = x;
  pointer.y = y;
  pointer.inside = true;
  // Mouse: ripple wherever it moves. Touch: only while a finger is down, which is the only time we hear it.
  if (!prefersReducedMotion() && running) ripple.touch(x, y, pointer.down ? 0.5 : 0.3, 16, performance.now());
});

canvas.addEventListener('pointerup', (event) => {
  const down = pointer.down;
  pointer.down = null;
  if (!down) return;
  const [x, y] = stagePoint(event);
  if (Math.hypot(x - down.x, y - down.y) < 10 && event.timeStamp - down.t < 600) tap(x, y);
});

canvas.addEventListener('pointercancel', () => { pointer.down = null; });
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

function tap(x, y) {
  if (cancelEncore) return;
  const now = performance.now();
  if (!prefersReducedMotion()) ripple.touch(x, y, 1.1, 30, now);
  // A second quick tap in the same spot is a double-tap: break everything.
  if (now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
    lastTap.t = -Infinity;
    breakAll();
    return;
  }
  lastTap = { x, y, t: now };
  breakPiece(mirror.pieceAt(x, y), x, y);
}

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
  if (event.key.startsWith('Arrow')) {
    recentKeys = [...recentKeys, event.key].slice(-ENCORE_KEYS.length);
    if (recentKeys.join() === ENCORE_KEYS.join()) {
      recentKeys = [];
      encore();
    }
    return;
  }
  const actions = { b: breakAll, 0: reassemble, t: () => setTime(!timeOn), r: record };
  const action = actions[event.key.toLowerCase()];
  if (action) {
    event.preventDefault();
    action();
  }
});

$('break-all').addEventListener('click', breakAll);
$('reassemble').addEventListener('click', reassemble);
$('time').addEventListener('click', () => setTime(!timeOn));
$('rec').addEventListener('click', record);
$('camera-off').addEventListener('click', stop);
$('sound').addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
});
$('open').addEventListener('click', () => start('camera'));
$('retry').addEventListener('click', () => start(sourceKind));
$('error-demo').addEventListener('click', () => start('demo'));
$('close-sheet').addEventListener('click', () => $('sheet').close());

if (new URLSearchParams(location.search).get('demo') === '1') start('demo');
