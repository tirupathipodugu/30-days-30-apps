// Mirror Room entry point: opens the camera (or the demo feed), runs the frame loop and connects
// taps, the shooter's keys and buttons, and the controls to the glass. The interesting parts live in the modules below.

import { Mirror } from './shards.js';
import { Debris } from './debris.js';
import { MirrorRenderer } from './mirror-renderer.js';
import { Ripple } from './ripple.js';
import { TimeBuffer } from './time-buffer.js';
import { openCamera, cameraProblem, PROBLEMS } from './camera.js';
import { createDemoFeed } from './demo-feed.js';
import { Sound } from './sound.js';
import { clipFormat, recordCanvas, showClip } from './recorder.js';
import { playEncore } from './encore.js';
import { Shooter } from './shooter.js';
import { prefersReducedMotion } from './motion.js';

const $ = (id) => document.getElementById(id);
const canvas = $('glass');
const stage = $('stage');
const counter = $('counter');
const hint = $('hint');
const scene = $('scene');              // the video behind the mirror
const actors = $('actors');            // the shooter's 2D canvas, over the glass

const RECORD_MS = 6000;
const IDLE_MS = 3000;
const LIGHT_HEIGHT = 900;              // px: how high above the glass the pointer light hangs
const TAG = 'Mirror Room · Day 1 / 30 · @tirupathipodugu';
const COLLAPSE_STRIKES = 11;           // shatter: strikes spread over the whole mirror
const COLLAPSE_HOLD_MS = 700;          // a held beat between the last crack and the first piece falling
const COLLAPSE_MS = 6800;              // then every piece falls within this
const AMBIENCE_FLOOR = 0.12;           // the world behind is faintly audible even through whole glass
const AMBIENCE_EVERY_MS = 250;          // how often the ambience follows how much glass is left
const KEY_MOVES = { ArrowLeft: ['move', -1], ArrowRight: ['move', 1], ArrowUp: ['raise', -1], ArrowDown: ['raise', 1] };
const SHOT_REACH = 40;                 // px: a shot into a hole clips the nearest piece within this
const SWEEP_STEP = 6;                  // px between the points a sweep tests for pieces
const SWEEP_SIDES = [0, -9, 9];        // px either side of the path a sweep also reaches
const BROKEN_AT = 0.03;                // once less glass than this is left, the rest falls on its own
const ENDING_DELAY_MS = 1600;          // from the last pieces falling to the message
const SOUND_GAP_MS = 45;               // pieces landing together share one sound

const mirror = new Mirror();
const debris = new Debris();
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
let shooter = null;
let collapse = null;                   // shatter's collapse in progress: { start, order, next }
let ambienceAt = 0;
let broken = false;                    // the ending: all the glass is gone and only the scene is left
let sweeping = false;
let lastSound = { loose: -Infinity, land: -Infinity, shell: -Infinity };
let sceneTime = -1;                    // -1 nothing shown yet, -2 the poster, else the video's time
// Recordings and photos are composed from the glass and the shooter on one canvas.
const poster = new Image();
poster.src = scene.getAttribute('poster');
const surface = document.createElement('canvas');
const surfaceCtx = surface.getContext('2d');

const effects = { glintAt: -Infinity };
const pointer = { x: 0, y: 0, down: null, movedAt: -Infinity };
// Everything the renderer needs each frame, allocated once.
const frame = {
  mirror,
  debris,
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
  shooter = new Shooter(actors, {
    onHit: shotAt,
    onFire: () => sound.shot(),
    onShellLand: (size) => {
      const now = performance.now();
      if (now - lastSound.shell > SOUND_GAP_MS) {
        lastSound.shell = now;
        sound.shell(size);
      }
    },
  });
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
  scene.play().catch(() => {});        // muted and inline, so it may start without a gesture
  mirror.reset(stage.clientWidth, stage.clientHeight);
  debris.clear();
  resize();
  setTime(true);                       // Time is on by default: farther shards show a moment ago
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
  if (width !== mirror.width || height !== mirror.height) {
    mirror.resize(width, height);
    debris.clear();
  }
  // The shooter stands just above the bottom controls.
  const footer = stage.querySelector('.bottom').getBoundingClientRect();
  shooter.resize(width, height, footer.top - stage.getBoundingClientRect().top - 4);
}

// ---------------------------------------------------------------- the frame loop

function tick(now) {
  if (!running) return;
  frameId = requestAnimationFrame(tick);
  if (source.width && source.takeFrame()) renderer.uploadFrame(source.element, source.width, source.height);
  // The scene only needs uploading once something has opened a view onto it.
  if (mirror.holes) {
    if (scene.readyState >= 2 && scene.currentTime !== sceneTime) {
      sceneTime = scene.currentTime;
      renderer.uploadScene(scene, scene.videoWidth, scene.videoHeight);
    } else if (sceneTime < 0 && poster.complete && poster.naturalWidth) {
      sceneTime = -2;                  // the still frame, until the video has one of its own
      renderer.uploadScene(poster, poster.naturalWidth, poster.naturalHeight);
    }
  }

  mirror.reduced = prefersReducedMotion();
  shooter.update(now, mirror.reduced);
  collapseStep(now);
  if (now - ambienceAt > AMBIENCE_EVERY_MS) {
    ambienceAt = now;
    updateAmbience(now);
  }
  if (mirror.update(now)) onRestored(now);
  debris.update(now, mirror.height);
  if (debris.landings.length && now - lastSound.land > SOUND_GAP_MS) {
    lastSound.land = now;
    const biggest = Math.max(...debris.landings.map((l) => l.size));
    sound.land(Math.min(1, biggest / 120));
  }
  ripple.update(now);
  moveLight(now);

  frame.now = now;
  frame.timeOn = timeOn;
  frame.tagOn = recording || photoPending;
  frame.glint = (now - effects.glintAt) / 1400;
  renderer.render(frame);
  shooter.draw(now);

  // The recording surface, like a photo, must be drawn in the same frame as the glass.
  if (recording || photoPending) compose();
  if (photoPending) {
    photoPending = false;
    surface.toBlob((blob) => blob && showClip(blob, 'png'), 'image/png');
  }
}

/** Glass and shooter, together on one canvas, for recordings and photos. */
function compose() {
  if (surface.width !== canvas.width || surface.height !== canvas.height) {
    surface.width = canvas.width;
    surface.height = canvas.height;
  }
  surfaceCtx.drawImage(canvas, 0, 0);
  surfaceCtx.drawImage(actors, 0, 0, surface.width, surface.height);
}

/** The ambience fades up as more of the scene behind the glass is revealed. Full at the ending. */
function updateAmbience(now) {
  let level = AMBIENCE_FLOOR;
  if (broken) level = 1;
  else if (!mirror.whole && !mirror.isHealing(now)) level = AMBIENCE_FLOOR + (1 - AMBIENCE_FLOOR) * Math.pow(1 - mirror.glassLeft(), 0.8);
  if (Math.abs(level - sound.ambienceLevel) > 0.01 || (level && !sound.ambienceGain)) sound.ambience(level);
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

/**
 * A tap. On intact glass, or on a big piece, it cracks the glass. On a small piece of glass that is
 * already broken off (under LOOSE_AREA of the mirror) it knocks that piece out of the frame.
 * Shatter and the encore only crack (`mayFall` false).
 */
function strike(x, y, force = 1, mayFall = true) {
  if (broken) return;
  const now = performance.now();
  const shard = mirror.shardAt(x, y);
  if (shard?.fallen) return;           // nothing left to hit there
  if (mayFall && mirror.canFall(shard, now) && mirror.isLoose(shard)) {
    knockOut(shard, x, y, now);
    return;
  }
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

/**
 * A shot lands like a tap. If it lands in a hole, it clips the nearest small piece at the hole's edge
 * instead, so holding fire on one spot keeps eating into the glass.
 */
function shotAt(x, y) {
  const now = performance.now();
  const hit = mirror.shardAt(x, y);
  if (hit?.missing && !broken) {
    let best = null, bestD = SHOT_REACH;
    for (const s of mirror.shards) {
      if (!mirror.canFall(s, now) || !mirror.isLoose(s)) continue;
      const d = Math.hypot(s.center.x - x, s.center.y - y) - Math.sqrt(s.area) / 2;
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (best) knockOut(best, x, y, now);
    return;
  }
  strike(x, y);
}

/** Take one piece out of the frame: it falls, and the scene behind shows where it was. */
function knockOut(shard, x, y, now) {
  const look = mirror.lookAt(shard, now);
  debris.drop(shard, look, shard.frost, x, y, now, prefersReducedMotion());
  mirror.detach(shard, now);
  if (now - lastSound.loose > SOUND_GAP_MS) {
    lastSound.loose = now;
    sound.loosen();
    navigator.vibrate?.(5);
  }
  hint.classList.add('gone');
  updateCounter();
  if (!broken && mirror.glassLeft() <= BROKEN_AT) breakDown(now);
}

/** A press-and-drag over broken glass knocks out every piece it passes over, whatever its size. */
function sweep(x0, y0, x1, y1) {
  if (broken || mirror.whole) return;
  const now = performance.now();
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(length / SWEEP_STEP));
  // A fingertip is wide: test a few px either side of the path too.
  const nx = length ? -(y1 - y0) / length : 0, ny = length ? (x1 - x0) / length : 1;
  for (let i = 1; i <= steps; i++) {
    for (const side of SWEEP_SIDES) {
      const x = x0 + ((x1 - x0) * i) / steps + nx * side, y = y0 + ((y1 - y0) * i) / steps + ny * side;
      const shard = mirror.shardAt(x, y);
      if (mirror.canFall(shard, now)) knockOut(shard, x, y, now);
      if (broken) return;
    }
  }
}

/** The ending: the last slivers drop on their own, the scene behind fills the screen, and a message fades in. */
function breakDown(now) {
  broken = true;
  collapse = null;
  stopVolley();
  cancelEncore?.();
  stage.classList.add('broken');
  updateCounter();
  const rest = mirror.shards.filter((s) => !s.missing);
  rest.forEach((s, i) => {
    setTimeout(() => {
      if (!running || s.missing) return;
      const t = performance.now();
      debris.drop(s, mirror.lookAt(s, t), s.frost, s.center.x, s.center.y - 10, t, prefersReducedMotion());
      mirror.detach(s, t);
      updateCounter();
    }, Math.min(900, i * 35));
  });
  shooter.calm = true;
  setTimeout(() => {
    if (!running) return;
    const ending = $('ending');
    ending.hidden = false;
    requestAnimationFrame(() => ending.classList.add('shown'));
    announce('When you are broken, all you need is a break to restart.');
    setTimeout(() => $('restart').focus({ preventScroll: true }), 400);
  }, Math.min(900, rest.length * 35) + ENDING_DELAY_MS);
}

/**
 * Shatter: the whole mirror comes down, slowly. First a spread of strikes cracks it all over, then
 * the pieces start to drop a few at a time, top first, faster and faster, until the glass is gone and
 * the ending plays. The drops run from the frame loop (see collapseStep); restore stops them.
 */
function shatter() {
  if (!running || volley.length || collapse || broken) return;
  const reduced = prefersReducedMotion();
  const n = COLLAPSE_STRIKES;
  const cols = Math.max(2, Math.round(Math.sqrt((n * mirror.width) / mirror.height)));
  const rows = Math.ceil(n / cols);
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && points.length < n; c++) {
      points.push([
        mirror.width * ((c + 0.2 + Math.random() * 0.6) / cols),
        mirror.height * ((r + 0.2 + Math.random() * 0.6) / rows),
      ]);
    }
  }
  points.sort(() => Math.random() - 0.5);
  let t = 0;
  points.forEach(([x, y], i) => {
    volley.push(setTimeout(() => strike(x, y, 1 - i * 0.05, false), t));
    t += (reduced ? 260 : 150) + Math.random() * 90;
  });
  volley.push(setTimeout(() => {
    volley = [];
    startCollapse();
  }, t + COLLAPSE_HOLD_MS));
}

/** Every piece left, in the order it will fall: from the top down, loosely. */
function startCollapse() {
  if (broken || !running) return;
  const now = performance.now();
  const order = mirror.shards
    .filter((s) => !s.missing)
    .map((s) => ({ s, key: s.center.y + (Math.random() - 0.5) * mirror.height * 0.35 }))
    .sort((p, q) => p.key - q.key)
    .map((p) => p.s);
  collapse = { start: now, order, next: 0 };
}

/** Drop the pieces that are due: slow at first, then accelerating, like a building coming down. */
function collapseStep(now) {
  if (!collapse) return;
  if (broken || mirror.isHealing(now)) {
    collapse = null;
    return;
  }
  const progress = Math.min(1, (now - collapse.start) / COLLAPSE_MS);
  const due = Math.ceil(collapse.order.length * Math.pow(progress, 1.9));
  while (collapse && collapse.next < due && !broken) {
    const s = collapse.order[collapse.next++];
    if (mirror.canFall(s, now)) knockOut(s, s.center.x + (Math.random() - 0.5) * 20, s.center.y - 12, now);
  }
  if (collapse && collapse.next >= collapse.order.length) collapse = null;
}

function stopVolley() {
  for (const id of volley) clearTimeout(id);
  volley = [];
}

function restore() {
  if (broken) return;                  // past the ending, the only way back is to restart
  stopVolley();
  collapse = null;
  const now = performance.now();
  if (!mirror.heal(now)) return;
  debris.vanish(now);
  sound.restore(mirror.healDuration() / 1000);
}

function onRestored(now) {
  if (!mirror.reduced) effects.glintAt = now;
  debris.clear();
  updateCounter();
  announce('Restored');
}

function updateCounter() {
  const fallen = mirror.fallen;
  counter.textContent = mirror.whole || broken ? '' : fallen ? `${mirror.count} · ${fallen} fallen` : String(mirror.count);
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
  if (cancelEncore || !running || broken) return;
  stopVolley();
  cancelEncore = playEncore({
    wholeMirror: () => {
      mirror.reset(mirror.width, mirror.height);
      debris.clear();
      updateCounter();
    },
    strike: (x, y) => strike(x, y, 0.9, false),
    restore,
  }, mirror, prefersReducedMotion(), () => { cancelEncore = null; });
}

async function record() {
  if (recording || !running) return;
  compose();
  const format = clipFormat(surface);
  if (!format) {
    photoPending = true;
    return;
  }
  const button = $('rec');
  const label = $('rec-label');
  recording = true;
  button.classList.add('recording');
  let left = RECORD_MS / 1000;
  label.textContent = `Recording ${left}`;
  const countdown = setInterval(() => { label.textContent = `Recording ${--left}`; }, 1000);
  try {
    const blob = await recordCanvas(surface, format, RECORD_MS);
    showClip(blob, format.extension);
  } catch (error) {
    console.error(error);
    photoPending = true;
  } finally {
    clearInterval(countdown);
    recording = false;
    button.classList.remove('recording');
    label.textContent = 'Record';
  }
}

function setSoundLabel() {
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound-label').textContent = sound.enabled ? 'Sound on' : 'Sound off';
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

/**
 * Browsers only allow audio after a gesture, so the first tap, click or key press unlocks it (sound is
 * on by default) and starts the ambience. It is also a chance to start the scene video if autoplay was
 * blocked, as it can be in iOS low-power mode.
 */
function onGesture() {
  sound.unlock();
  if (running) updateAmbience(performance.now());
  if (scene.paused && running && !document.hidden) scene.play().catch(() => {});
}
// Touch only counts as a gesture when the finger lifts, so listen for the end of a press too.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, onGesture, { capture: true });
}

// Hidden tab: pause the video and the audio.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    scene.pause();
    sound.suspend();
    releaseAll();
  } else if (running) {
    scene.play().catch(() => {});
    sound.resume();
  }
});

stage.addEventListener('pointermove', wake);
stage.addEventListener('pointerdown', wake);

canvas.addEventListener('pointerdown', (event) => {
  const [x, y] = stagePoint(event);
  shooter?.aimAt(x, y);               // the gun follows the last spot you touched
  pointer.down = { x, y, t: event.timeStamp };
  sweeping = false;
  pointer.x = x;
  pointer.y = y;
  pointer.movedAt = performance.now();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  const [x, y] = stagePoint(event);
  // Press and drag: once the finger has moved off its starting point, it sweeps pieces out.
  if (pointer.down && running && !cancelEncore) {
    shooter.aimAt(x, y);
    if (!sweeping && Math.hypot(x - pointer.down.x, y - pointer.down.y) >= 10) {
      sweeping = true;
      sweep(pointer.down.x, pointer.down.y, x, y);
    } else if (sweeping) {
      sweep(pointer.x, pointer.y, x, y);
    }
  }
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
  if (!sweeping && Math.hypot(x - down.x, y - down.y) < 10 && event.timeStamp - down.t < 600 && !cancelEncore) strike(x, y);
  sweeping = false;
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

// The shooter: arrows walk and aim, Space or Enter fires (hold for semi-auto).
const isFireKey = (event) => event.key === ' ' || event.key === 'Enter';
const onControl = (event) => event.target.closest?.('button, a, input, dialog');

document.addEventListener('keydown', (event) => {
  if (!running || event.metaKey || event.ctrlKey || event.altKey || $('sheet').open) return;
  wake();
  const held = KEY_MOVES[event.key];
  if (held) {
    event.preventDefault();
    shooter[held[0]] = held[1];
    hint.classList.add('gone');
    return;
  }
  if (isFireKey(event) && !onControl(event)) {
    event.preventDefault();
    if (!event.repeat) shooter.fire(performance.now());
    shooter.trigger = true;
    hint.classList.add('gone');
    return;
  }
  const actions = { b: shatter, 0: restore, t: () => setTime(!timeOn), r: record };
  const action = actions[event.key.toLowerCase()];
  if (action) {
    event.preventDefault();
    action();
  }
});

document.addEventListener('keyup', (event) => {
  if (!shooter) return;
  const held = KEY_MOVES[event.key];
  if (held && shooter[held[0]] === held[1]) shooter[held[0]] = 0;
  if (isFireKey(event)) shooter.trigger = false;
});

/** Let go of everything held, e.g. when the window loses focus mid-press. */
function releaseAll() {
  if (!shooter) return;
  shooter.move = 0;
  shooter.raise = 0;
  shooter.trigger = false;
}
window.addEventListener('blur', releaseAll);

// On-screen pad (shown on touch screens): press and hold to walk, aim or fire.
for (const button of document.querySelectorAll('#pad [data-hold]')) {
  const [key, value] = button.dataset.hold.split(':');
  const press = (event) => {
    event.preventDefault();
    if (!running) return;
    button.setPointerCapture?.(event.pointerId);
    button.classList.add('held');
    hint.classList.add('gone');
    if (key === 'trigger') {
      shooter.fire(performance.now());
      shooter.trigger = true;
    } else {
      shooter[key] = Number(value);
    }
  };
  const release = () => {
    button.classList.remove('held');
    if (!shooter) return;
    if (key === 'trigger') shooter.trigger = false;
    else if (shooter[key] === Number(value)) shooter[key] = 0;
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

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
$('restart').addEventListener('click', () => location.reload());

if (new URLSearchParams(location.search).get('demo') === '1') start('demo');
