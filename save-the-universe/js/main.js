// Save the Universe: the start screen, the picture sources (camera, a browser tab, a photo or a
// built-in starfield), input, the game loop and the end card.

import { STEP, createWorld, resizeWorld, step, escapeShare, touches } from './physics.js';
import { Warp } from './warp.js';
import { Sound } from './audio.js';
import { postOnX, saveImage } from '../../shared/share-x.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('space');
const sound = new Sound();

let warp = null;
let world = null;
let source = null;      // { kind: 'camera' | 'tab' | 'photo' | 'stars', el, live, mirror }
let stream = null;
let raf = 0;
let last = 0;
let acc = 0;
let ending = null;      // { kind: 'won' | 'lost', t0 }
let suck = 0;           // how much of the picture the hole has swallowed, 0..1
let flash = 0;
let lastScore = '';
const pointer = { down: false, x: 0, y: 0 };
const keys = new Set();

// ---------- start screen ----------

if (navigator.mediaDevices?.getDisplayMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) $('use-tab').hidden = false;

$('use-camera').addEventListener('click', () => begin(async () => {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  await playVideo(stream);
  return { kind: 'camera', el: video, live: true, mirror: true };
}));

$('use-tab').addEventListener('click', () => begin(async () => {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  stream.getVideoTracks()[0].addEventListener('ended', () => { if (source?.kind === 'tab') source.live = false; });
  await playVideo(stream);
  return { kind: 'tab', el: video, live: true, mirror: false };
}));

$('use-photo').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  begin(() => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ kind: 'photo', el: img, live: false, mirror: false });
    img.onerror = () => reject(new Error('photo'));
    img.src = URL.createObjectURL(file);
  }));
  e.target.value = '';
});

$('use-stars').addEventListener('click', () => begin(async () => ({ kind: 'stars', el: starfield(), live: false, mirror: false })));

async function playVideo(s) {
  video.srcObject = s;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
}

async function begin(getSource) {
  sound.start();
  $('error').hidden = true;
  try {
    if (!warp) warp = new Warp(canvas);
  } catch {
    return showError('This game needs WebGL2, which this browser does not have. Try a recent Chrome, Safari or Firefox.');
  }
  try {
    source = await getSource();
  } catch (err) {
    stopStream();
    const name = err?.name || '';
    if (name === 'NotAllowedError') return showError('Permission was blocked. Allow it in the address bar and try again, or just play with stars.');
    if (name === 'NotFoundError') return showError('No camera found. Try a photo, or just play with stars.');
    return showError('That did not work. Try another option, or just play with stars.');
  }
  warp.upload(source.el);
  $('landing').hidden = true;
  $('stage').hidden = false;
  newGame();
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// A built-in picture for people who don't want to share anything: planets, a galaxy and stars.
function starfield() {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 1600, 1000);
  sky.addColorStop(0, '#0b0820');
  sky.addColorStop(1, '#03111c');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1600, 1000);
  for (const [x, y, r, col] of [[400, 300, 340, 'rgba(120,60,200,.35)'], [1200, 700, 420, 'rgba(30,140,200,.3)'], [900, 200, 260, 'rgba(220,80,120,.22)']]) {
    const n = g.createRadialGradient(x, y, 0, x, y, r);
    n.addColorStop(0, col);
    n.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = n;
    g.fillRect(0, 0, 1600, 1000);
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
    const s = rnd() < 0.97 ? 1.2 : 2.6;
    g.fillRect(rnd() * 1600, rnd() * 1000, s, s);
  }
  for (const [x, y, r, a, b] of [[1250, 260, 70, '#ffcf8a', '#b5651d'], [300, 760, 46, '#9fe7ff', '#1d5fb5'], [760, 560, 28, '#ff9d9d', '#8a1d3a'], [1450, 880, 36, '#d6ffb0', '#3a7a1d']]) {
    const p = g.createRadialGradient(x - r / 3, y - r / 3, r / 6, x, y, r);
    p.addColorStop(0, a);
    p.addColorStop(1, b);
    g.fillStyle = p;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,220,170,.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.ellipse(1250, 260, 120, 26, -0.3, 0, Math.PI * 2);
  g.stroke();
  return c;
}

// ---------- game ----------

function size() {
  const w = innerWidth, h = innerHeight;
  warp.resize(w, h, Math.min(devicePixelRatio || 1, 2));
  return { w, h };
}

function newGame() {
  const { w, h } = size();
  world = createWorld(w, h);
  ending = null;
  suck = 0;
  flash = 0;
  $('card').hidden = true;
  $('hint').classList.remove('gone');
  clearTimeout(newGame.hintTimer);
  newGame.hintTimer = setTimeout(() => $('hint').classList.add('gone'), 5000);
  last = performance.now();
  acc = 0;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function goalRect() {
  const r = $('goal').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function thrustDir() {
  let x = 0, y = 0;
  if (keys.has('left')) x -= 1;
  if (keys.has('right')) x += 1;
  if (keys.has('up')) y -= 1;
  if (keys.has('down')) y += 1;
  if (!x && !y && pointer.down) {
    x = pointer.x - world.x;
    y = pointer.y - world.y;
    if (Math.hypot(x, y) < world.radius * 0.6) return { x: 0, y: 0 };
  }
  return { x, y };
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (source?.live) warp.upload(source.el);

  const thrust = ending ? { x: 0, y: 0 } : thrustDir();
  acc += dt;
  while (acc >= STEP) {
    if (!ending || ending.kind === 'lost') step(world, thrust);
    acc -= STEP;
  }

  if (!ending) {
    // The hole slowly eats the picture while you play.
    suck = Math.min(0.28, world.t * 0.012);
    if (world.state === 'lost') endGame('lost');
    else if (touches(world, goalRect())) endGame('won');
  }

  let stretch = { x: 0, y: 0 };
  let bubbleScale = 1;
  if (ending) {
    const e = (now - ending.t0) / 1000;
    if (ending.kind === 'lost') {
      const dx = world.hole.x - world.x, dy = world.hole.y - world.y, dl = Math.hypot(dx, dy) || 1;
      const s = Math.min(1, e / 0.8);
      stretch = { x: (dx / dl) * s, y: (dy / dl) * s };
      bubbleScale = Math.max(0, 1 - e / 1.1);
      suck = Math.min(1, 0.28 + Math.max(0, e - 0.4) / 2.2);
      if (e > 2.6 && $('card').hidden) showCard();
    } else {
      // The hole lets go: the picture springs back with a little overshoot and a flash.
      const s = Math.min(1, e / 1.2);
      suck = 0.28 * Math.max(0, 1 - s) * Math.cos(s * 9);
      world.rs = world.rs0 * Math.max(0.02, 1 - s);
      flash = Math.max(0, 0.6 - e * 1.2);
      if (e > 1.2 && $('card').hidden) showCard();
    }
  }

  const dist = Math.hypot(world.hole.x - world.x, world.hole.y - world.y);
  const closeness = Math.max(0, Math.min(1, 1 - (dist - world.rs) / (world.L * 0.6)));
  sound.update(ending ? 0 : closeness, !ending && Math.hypot(thrust.x, thrust.y) > 0);

  if (!ending) $('timer').textContent = `${world.t.toFixed(1)} s`;
  $('speed-fill').style.width = `${Math.min(100, escapeShare(world) * 100)}%`;

  const tl = Math.hypot(thrust.x, thrust.y);
  warp.draw({
    hole: world.hole, rs: world.rs, suck, time: now / 1000,
    x: world.x, y: world.y, radius: world.radius, bubbleScale,
    face: source.kind === 'camera', mirror: source.mirror,
    stretch, thrust: tl ? { x: thrust.x / tl, y: thrust.y / tl } : { x: 0, y: 0 }, flash,
  });
}

function endGame(kind) {
  ending = { kind, t0: performance.now() };
  world.state = kind;
  sound.silence();
  if (kind === 'won') sound.win(); else sound.lose();
  $('hint').classList.add('gone');
  if (kind === 'won') {
    world.vx = world.vy = 0;
    const t = world.t;
    let best = null;
    try {
      best = Number(localStorage.getItem('stu-best')) || null;
      if (!best || t < best) localStorage.setItem('stu-best', String(t));
    } catch {}
    lastScore = t.toFixed(1);
    $('card-kicker').textContent = best && t >= best ? `Your best: ${best.toFixed(1)} s` : 'New best';
    $('card-title').textContent = 'You saved the universe';
    $('card-sub').textContent = `in ${lastScore} seconds`;
  } else {
    lastScore = '';
    $('card-kicker').textContent = 'Event horizon crossed';
    $('card-title').textContent = 'The universe is gone';
    $('card-sub').textContent = 'Push along your orbit to build speed, then break for the button.';
  }
}

function showCard() {
  $('card').hidden = false;
  $('again').focus();
}

// ---------- input ----------

canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  sound.start();
});
canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { pointer.down = false; });

const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
addEventListener('keydown', (e) => {
  const k = KEYMAP[e.key];
  if (k && !$('stage').hidden) { keys.add(k); e.preventDefault(); }
  if ((e.key === 'Enter' || e.key === ' ') && !$('card').hidden) { e.preventDefault(); newGame(); }
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) keys.delete(k); });
addEventListener('blur', () => { keys.clear(); pointer.down = false; });

$('goal').addEventListener('click', () => {
  if (ending || !world) return;
  if (touches(world, goalRect())) return endGame('won');
  const g = $('goal');
  g.classList.remove('shake');
  void g.offsetWidth;
  g.classList.add('shake');
  toast('Too far away. Fly your bubble to the button first.');
});

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

$('again').addEventListener('click', newGame);
$('sound').addEventListener('click', () => {
  sound.start();
  sound.setOn(!sound.on);
  $('sound').textContent = sound.on ? 'Sound on' : 'Sound off';
  $('sound').setAttribute('aria-pressed', String(sound.on));
});
$('close').addEventListener('click', () => {
  cancelAnimationFrame(raf);
  sound.silence();
  stopStream();
  source = null;
  $('stage').hidden = true;
  $('landing').hidden = false;
});

addEventListener('resize', () => {
  if (!world || $('stage').hidden) return;
  const { w, h } = size();
  resizeWorld(world, w, h);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sound.silence(); keys.clear(); pointer.down = false; }
  last = performance.now();
});

// ---------- share ----------

$('postX').addEventListener('click', () => postOnX({
  path: 'save-the-universe/',
  text: lastScore ? `I saved the universe in ${lastScore} seconds. 🌌 Can you beat it?` : 'A black hole ate my whole screen. 🕳️',
}));

$('saveShot').addEventListener('click', () => {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const k = canvas.width / innerWidth;
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.fillRect(0, out.height - 90 * k, out.width, 90 * k);
  g.fillStyle = '#fff';
  g.font = `700 ${22 * k}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(lastScore ? `Saved the universe in ${lastScore} s` : 'The universe is gone', out.width / 2, out.height - 52 * k);
  g.font = `400 ${13 * k}px system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.fillText('Save the Universe · 30 Days, 30 Apps by @tirupathipodugu', out.width / 2, out.height - 26 * k);
  out.toBlob((b) => b && saveImage(b, 'save-the-universe.png', 'Save the Universe'), 'image/png');
});
