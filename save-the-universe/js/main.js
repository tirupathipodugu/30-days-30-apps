// Save the Universe: choose a universe, then escape the black hole that tears it apart. This file
// has the start screen, the tutorial, input, the game loop and the end card.

import { STEP, createWorld, resizeWorld, step, tap, touches } from './physics.js';
import { Warp } from './warp.js';
import { Pieces } from './pieces.js';
import { UNIVERSES, buildUniverse } from './universes.js';
import { Sound } from './audio.js';
import { postOnX, saveImage } from '../../shared/share-x.js';

const $ = (id) => document.getElementById(id);
const canvas = $('space');
const sound = new Sound();

let warp = null;
let world = null;
let pieces = null;
let universe = 'solar';
let raf = 0;
let last = 0;
let acc = 0;
let ending = null;      // { kind: 'won' | 'lost', t0 }
let suck = 0;           // how much of everything the hole has swallowed at the very end, 0..1
let wind = 0;           // how far space near the hole has been dragged round
let flash = 0;
let lastScore = '';
let lastLevel = 1;
let goalClock = 0;      // drives the moving goal
let started = false;    // false while the tutorial or countdown is showing
let bump = 0;           // a short shake when a piece hits you
const taps = [];        // recent tap times, for the tap-speed meter
const pointer = { down: false, x: 0, y: 0 };
const keys = new Set();
let level = 1;
try { level = Math.max(1, Math.min(20, Number(localStorage.getItem('stu-level')) || 1)); } catch {}
// ?level=5 starts at that level (handy for testing, or for daring a friend).
const askedLevel = Number(new URLSearchParams(location.search).get('level'));
if (askedLevel >= 1 && askedLevel <= 20) level = Math.floor(askedLevel);
try { universe = localStorage.getItem('stu-universe') || universe; } catch {}
if (!UNIVERSES.some((u) => u.id === universe)) universe = 'solar';

// ---------- start screen: choose a universe ----------

/** A small preview of a universe, drawn from the same pieces the game uses. */
function preview(id, cv) {
  const w = 320, h = 240;
  cv.width = w * 2;
  cv.height = h * 2;
  const g = cv.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const list = buildUniverse(id, w, h).sort((a, b) => (b.sheet ? 1 : 0) - (a.sheet ? 1 : 0));
  for (const p of list) g.drawImage(p.img, p.hx - p.w / 2, p.hy - p.h / 2, p.w, p.h);
}

function pick(id) {
  universe = id;
  try { localStorage.setItem('stu-universe', id); } catch {}
  for (const b of document.querySelectorAll('.universe')) b.setAttribute('aria-checked', String(b.dataset.id === id));
  for (const b of document.querySelectorAll('[data-universe]')) b.classList.toggle('current', b.dataset.universe === id);
}

for (const u of UNIVERSES) {
  const b = document.createElement('button');
  b.className = 'universe';
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.id = u.id;
  const cv = document.createElement('canvas');
  b.append(cv);
  b.insertAdjacentHTML('beforeend', `<b>${u.name}</b><span>${u.blurb}</span>`);
  b.addEventListener('click', () => pick(u.id));
  b.addEventListener('dblclick', () => { pick(u.id); begin(); });
  $('universes').append(b);
  preview(u.id, cv);

  // The same choices on the end card: picking one starts a new game there at once.
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.type = 'button';
  chip.dataset.universe = u.id;
  chip.textContent = u.name;
  chip.addEventListener('click', () => { pick(u.id); newGame(); });
  $('switch').append(chip);
}
pick(universe);
$('play').addEventListener('click', () => begin());

function begin() {
  sound.start();
  $('error').hidden = true;
  try {
    if (!warp) warp = new Warp(canvas);
  } catch {
    return showError('This game needs WebGL2, which this browser does not have. Try a recent Chrome, Safari or Firefox.');
  }
  $('landing').hidden = true;
  $('stage').hidden = false;
  newGame();
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

// ---------- game ----------

function size() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  warp.resize(w, h, dpr);
  return { w, h, dpr };
}

function newGame() {
  const { w, h } = size();
  world = createWorld(w, h, level);
  ending = null;
  started = false;
  suck = 0;
  wind = 0;
  flash = 0;
  taps.length = 0;
  $('card').hidden = true;
  $('hint').classList.add('gone');
  $('you').classList.remove('gone');
  $('level').textContent = `Level ${level}`;
  pieces = new Pieces(universe, w, h, Math.min(devicePixelRatio || 1, 1.5));
  let seen = false;
  try { seen = localStorage.getItem('stu-seen') === '1'; } catch {}
  $('tutorial').hidden = seen;
  $('countdown').hidden = true;
  $('start').hidden = false;
  $('intro').classList.remove('counting');
  $('intro').hidden = false;
  last = performance.now();
  acc = 0;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  $('start').focus();
}

function countdown() {
  if ($('start').disabled) return;
  try { localStorage.setItem('stu-seen', '1'); } catch {}
  sound.start();
  $('tutorial').hidden = true;
  $('start').hidden = true;
  $('intro').classList.add('counting');
  const c = $('countdown');
  c.hidden = false;
  let n = 3;
  c.textContent = n;
  sound.tick(n);
  const timer = setInterval(() => {
    n -= 1;
    if (n > 0) { c.textContent = n; sound.tick(n); return; }
    clearInterval(timer);
    $('intro').hidden = true;
    started = true;
    last = performance.now();
    acc = 0;
    $('hint').classList.remove('gone');
    clearTimeout(newGame.hintTimer);
    newGame.hintTimer = setTimeout(() => $('hint').classList.add('gone'), 2500);
    setTimeout(() => $('you').classList.add('gone'), 3000);
  }, 750);
}
$('start').addEventListener('click', countdown);

/** A tap: push toward the point, count it for the meter, click sound. */
function doTap(x, y) {
  if (!started || ending) return;
  tap(world, x, y);
  taps.push(performance.now());
  sound.tap();
}

function tapRate() {
  const now = performance.now();
  while (taps.length && now - taps[0] > 1000) taps.shift();
  return taps.length;
}

function goalRect() {
  const r = $('goal').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function holdDir() {
  let x = 0, y = 0;
  if (keys.has('left')) x -= 1;
  if (keys.has('right')) x += 1;
  if (keys.has('up')) y -= 1;
  if (keys.has('down')) y += 1;
  if (!x && !y && pointer.down) {
    x = pointer.x - world.x;
    y = pointer.y - world.y;
    if (Math.hypot(x, y) < world.radius) return { x: 0, y: 0 };
  }
  return { x, y };
}

/** Pieces falling past you knock you toward the hole. Dodge them. */
function collide() {
  for (const p of pieces.flying) {
    if (p.hitCool > 0) continue;
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d < pieces.hitRadius(p, world) + world.radius) {
      world.vx += (p.vx - world.vx) * 0.45;
      world.vy += (p.vy - world.vy) * 0.45;
      p.hitCool = 0.5;
      bump = 1;
      sound.bump();
    }
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!world) return;

  const hold = ending || !started ? { x: 0, y: 0 } : holdDir();
  acc += dt;
  while (acc >= STEP) {
    if (started && (!ending || ending.kind === 'lost')) step(world, hold);
    acc -= STEP;
  }

  wind += dt * (0.6 + (started ? Math.min(2.5, world.t * 0.18) : 0) + (ending?.kind === 'lost' ? 6 : 0));
  if (ending?.kind === 'won') wind *= 1 - Math.min(1, dt * 2.5);

  if (pieces) {
    // The hole reaches further every second and takes pieces faster.
    const mode = ending?.kind || (started ? 'playing' : 'waiting');
    const reach = world.rs * 3 + (started ? world.t * 0.075 * world.L : 0) + (mode === 'lost' ? 9 * world.L : 0);
    const rate = mode === 'waiting' ? 0 : mode === 'lost' ? 45 : (2.5 + world.t * 0.18) * world.hard;
    pieces.update(dt, world, reach, rate, mode);
    if (started && !ending) collide();
  }

  if (!ending && started) {
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
      suck = Math.min(1, Math.max(0, e - 1.6) / 1.6);
      if (e > 3 && $('card').hidden) showCard();
    } else {
      // The hole lets go: everything flies back home with a flash.
      const s = Math.min(1, e / 1.2);
      world.rs = world.rs0 * Math.max(0.02, 1 - s);
      flash = Math.max(0, 0.6 - e * 1.2);
      if (e > 1.4 && $('card').hidden) showCard();
    }
  }

  const dist = Math.hypot(world.hole.x - world.x, world.hole.y - world.y);
  const closeness = Math.max(0, Math.min(1, 1 - (dist - world.rs) / (world.L * 0.6)));
  sound.update(ending || !started ? 0 : closeness, !ending && Math.hypot(hold.x, hold.y) > 0);

  if (!ending) $('timer').textContent = `${world.t.toFixed(1)} s`;
  const rate = tapRate();
  const fill = $('speed-fill');
  fill.style.width = `${Math.min(100, (rate / 5) * 100)}%`;
  fill.classList.toggle('enough', rate >= 4);
  const you = $('you');
  you.style.left = `${world.x}px`;
  you.style.top = `${world.y + world.radius + 8}px`;

  moveGoal(now);
  bump = Math.max(0, bump - dt * 4);
  const shake = bump * 4;
  if (pieces) {
    pieces.draw(world, now / 1000);
    warp.upload(pieces.canvas);
  }
  warp.draw({
    hole: world.hole, rs: world.rs, suck, wind, time: now / 1000,
    x: world.x + (Math.random() - 0.5) * shake, y: world.y + (Math.random() - 0.5) * shake,
    radius: world.radius, bubbleScale,
    face: false,
    stretch, thrust: { x: 0, y: 0 }, flash,
  });
}

/** From level 2 the goal slides back and forth along its edge, wider and faster each level. */
function moveGoal(now) {
  const g = $('goal');
  const tall = innerHeight > innerWidth;
  if (level < 2 || !started) {
    g.style.transform = '';
    goalClock = 0;
    return;
  }
  if (!ending) goalClock += Math.min(0.1, (now - (moveGoal.last || now)) / 1000);
  moveGoal.last = now;
  const span = tall ? (innerWidth - g.offsetWidth) / 2 - 16 : (innerHeight - g.offsetHeight) / 2 - 70;
  const amp = Math.max(0, span) * Math.min(1, 0.35 + 0.15 * (level - 2));
  const d = amp * Math.sin(goalClock * (0.7 + 0.12 * level));
  g.style.transform = tall ? `translateX(calc(-50% + ${d}px))` : `translateY(calc(-50% + ${d}px))`;
}

function endGame(kind) {
  ending = { kind, t0: performance.now() };
  world.state = kind;
  sound.silence();
  if (kind === 'won') sound.win(); else sound.lose();
  $('hint').classList.add('gone');
  const total = pieces?.total || 0;
  if (kind === 'won') {
    world.vx = world.vy = 0;
    const taken = pieces ? pieces.list.filter((p) => p.state !== 'home').length : 0;
    pieces?.restore(world);
    const t = world.t;
    lastScore = t.toFixed(1);
    lastLevel = level;
    $('card-kicker').textContent = `Level ${level} cleared`;
    $('card-title').textContent = 'You saved the universe';
    const back = taken ? `${taken} of its ${total} pieces flew back home.` : 'Nothing was lost.';
    $('card-sub').textContent = `in ${lastScore} seconds. ${back} Level ${level + 1} pulls harder.`;
    level = Math.min(20, level + 1);
    try { localStorage.setItem('stu-level', String(level)); } catch {}
    $('again').textContent = `Play level ${level}`;
  } else {
    lastScore = '';
    $('again').textContent = 'Try again';
    $('card-kicker').textContent = `Level ${level} · event horizon crossed`;
    $('card-title').textContent = 'The universe is gone';
    $('card-sub').textContent = 'Tap faster (4 a second or more), and dodge the pieces falling in: they drag you down.';
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
  doTap(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { pointer.down = false; });

const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
addEventListener('keydown', (e) => {
  const k = KEYMAP[e.key];
  if (k && !$('stage').hidden) { keys.add(k); e.preventDefault(); }
  if (e.key === ' ' && !e.repeat && started && !ending) {
    e.preventDefault();
    const g = goalRect();
    doTap(g.x + g.w / 2, g.y + g.h / 2);
  }
  if ((e.key === 'Enter' || e.key === ' ') && !$('card').hidden) { e.preventDefault(); newGame(); }
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) keys.delete(k); });
addEventListener('blur', () => { keys.clear(); pointer.down = false; });

// The goal is also where people tap toward, so a tap on it while playing is a push, not a miss.
$('goal').addEventListener('pointerdown', (e) => {
  if (!started || ending || !world) return;
  e.preventDefault();
  if (touches(world, goalRect())) return endGame('won');
  doTap(e.clientX, e.clientY);
});

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
  world = null;
  pieces = null;
  $('stage').hidden = true;
  $('landing').hidden = false;
});

addEventListener('resize', () => {
  if (!world || $('stage').hidden) return;
  const { w, h } = size();
  resizeWorld(world, w, h);
  pieces?.layout(w, h, pieces.k);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sound.silence(); keys.clear(); pointer.down = false; }
  last = performance.now();
});

// ---------- share ----------

$('postX').addEventListener('click', () => postOnX({
  path: 'save-the-universe/',
  text: lastScore ? `I saved the universe on level ${lastLevel} in ${lastScore} seconds. 🌌 Can you beat it?` : `A black hole ate my whole screen, piece by piece, on level ${level}. 🕳️`,
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
  g.fillText(lastScore ? `Saved the universe · level ${lastLevel} · ${lastScore} s` : 'The universe is gone', out.width / 2, out.height - 52 * k);
  g.font = `400 ${13 * k}px system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.fillText('Save the Universe · 30 Days, 30 Apps by @tirupathipodugu', out.width / 2, out.height - 26 * k);
  out.toBlob((b) => b && saveImage(b, 'save-the-universe.png', 'Save the Universe'), 'image/png');
});
