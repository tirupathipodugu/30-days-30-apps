// Living Heart entry point: scene, camera and quality tier, threads and heart, and the frame loop.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Cycle } from './cycle.js';
import { loadHeart } from './heart.js';
import { growThreads } from './threads.js';
import { buildThreadMeshes } from './thread-mesh.js';
import { createPost } from './post.js';
import { createUi } from './ui.js';
import { HeartSound } from './sound.js';
import { Hover } from './hover.js';

const canvas = document.getElementById('scene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const clampBpm = (b) => Math.min(220, Math.max(30, Number(b) || 72));

// Quality tier: phones, narrow screens and small CPUs get the light version.
// ?tier=high or ?tier=low pins the tier and turns off auto-downgrade.
const pinnedTier = ['high', 'low'].includes(params.get('tier')) ? params.get('tier') : null;
let low = pinnedTier ? pinnedTier === 'low' : matchMedia('(pointer: coarse)').matches || innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
const TIERS = {
  high: { attractors: 1800, wanderers: 140, maxSamples: 40000, trunkW: 3.0, tipW: 0.6, wandW: 0, dprCap: 2 },
  low: { attractors: 700, wanderers: 60, maxSamples: 12500, trunkW: 2.4, tipW: 0.7, wandW: 0.1, dprCap: 1.5 },
};
let tier = TIERS[low ? 'low' : 'high'];

// Renderer, scene, light.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);   // the page's #050507 is added after tone mapping (post.js)
renderer.toneMapping = THREE.NeutralToneMapping;   // AgX turns wet red muscle pink; Neutral keeps it red
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const key = new THREE.DirectionalLight(0xfff1e6, 3.2);
key.position.set(-1.2, 1.4, 1.6);
scene.add(key);
const rimCool = new THREE.SpotLight(0xa9c8ff, 6, 0, 0.5, 0.6, 2);
rimCool.position.set(1.8, 1.4, -2.6);
const rimWarm = new THREE.SpotLight(0xffd9d0, 3, 0, 0.5, 0.6, 2);
rimWarm.position.set(-2.2, -0.4, -2.4);
for (const s of [rimCool, rimWarm]) { s.target.position.set(0, 0, 0); scene.add(s, s.target); }

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const heartGroup = new THREE.Group();
heartGroup.renderOrder = 2;
scene.add(heartGroup);

// Layout: the heart is about 24% of the viewport height (160–260 px), or 38% of a portrait phone's width.
const view = { w: 1, h: 1, dpr: 1, dist: 8, visH: 4, visW: 4, aspect: 1 };
let heartWidth = 0.62;   // heart units; refined once the heart has loaded
function layout() {
  const w = innerWidth, h = innerHeight;
  view.w = w; view.h = h; view.aspect = w / h;
  view.dpr = Math.min(devicePixelRatio || 1, tier.dprCap);
  let frac = Math.min(260, Math.max(160, 0.24 * h)) / h;
  if (w < h) frac = (0.38 * w / heartWidth) / h;
  const t = Math.tan(THREE.MathUtils.degToRad(15));
  view.visH = 1 / frac;
  view.visW = view.visH * view.aspect;
  view.dist = view.visH / (2 * t);
  camera.aspect = view.aspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(view.dpr);
  renderer.setSize(w, h, false);
  post?.setSize(w, h, view.dpr);
  if (threads) threads.material.uniforms.uRes.value.set(w * view.dpr, h * view.dpr);
}

// Threads: grown once per layout; regrown only if the shape of the window changes a lot.
let threads = null, threadAspect = 0, roots = null;
const SPEED_PAGES = 1.1;
function buildThreads() {
  if (!roots) return;
  if (threads) {
    scene.remove(threads.back, threads.front);
    threads.back.geometry.dispose(); threads.front.geometry.dispose(); threads.material.dispose();
  }
  const slab = { halfW: view.visW * 1.15 / 2, halfH: view.visH * 1.15 / 2, halfD: 0.6 };
  const paths = growThreads(roots, slab, tier);
  for (const p of paths) {
    p.trunkW = tier.trunkW; p.tipW = tier.tipW;
    if (p.wanderer) p.w0 += tier.wandW;
  }
  // Pulses travel 1.1 page-heights a second; the glow fades with distance along the thread.
  const v = SPEED_PAGES * view.visH;
  threads = buildThreadMeshes(paths, { dpr: view.dpr, halfD: slab.halfD, v, atten: Math.max(2.2, view.visH * 0.75) });
  threads.material.uniforms.uRes.value.set(view.w * view.dpr, view.h * view.dpr);
  threads.speed = v;
  scene.add(threads.back, threads.front);
  threadAspect = view.aspect;
  hover.setSamples(threads.hover, v);
}

let post = null;
const hover = new Hover(camera, canvas);
layout();
post = createPost(renderer, scene, camera, { bloom: !low, samples: low ? 0 : 4 });
post.setSize(view.w, view.h, view.dpr);

// Heart rate input: ?bpm=, the slider, and window.setHeartRate for the WHOOP bridge.
const startClock = performance.now();
const now = () => (performance.now() - startClock) / 1000;
const cycle = new Cycle(clampBpm(params.get('bpm') || 72), now());
let lastLive = -Infinity;
window.setHeartRate = (bpm) => {
  const b = clampBpm(bpm);
  cycle.setBpm(b);
  lastLive = now();
  return b;
};
const sound = new HeartSound();
const ui = createUi({
  onRate: (b) => cycle.setBpm(clampBpm(b)),
  onSound: (on) => sound.setOn(on),
});

// Heart: landmarks first (tiny) so the threads can grow while the mesh downloads.
let heart = null;
loadHeart({
  lowTier: low,
  onLandmarks(lm) {
    roots = lm.roots;
    heartWidth = lm.width || heartWidth;
    layout();
    buildThreads();
  },
}).then((h) => {
  heart = h;
  heartGroup.add(h.mesh);
  if (h.credit) ui.setCredit(h.credit.text, h.credit.href);
  heartFadeStart = now();
}).catch((err) => console.error('Living Heart could not load the heart.', err));
let heartFadeStart = Infinity;

// Drag rotates the heart (±25° yaw, ±12° pitch) and it springs back on release.
const drag = { active: false, x: 0, y: 0, yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, vYaw: 0, vPitch: 0, moved: false };
canvas.addEventListener('pointerdown', (e) => {
  drag.active = true; drag.moved = false; drag.x = e.clientX; drag.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag.active) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    drag.tYaw = THREE.MathUtils.clamp(dx * 0.35, -25, 25);
    drag.tPitch = THREE.MathUtils.clamp(dy * 0.25, -12, 12);
  } else if (e.pointerType === 'mouse') {
    showHover(e.clientX, e.clientY, false);
  }
});
const release = (e) => {
  if (drag.active && !drag.moved && e.pointerType !== 'mouse') showHover(e.clientX, e.clientY, true);
  drag.active = false; drag.tYaw = 0; drag.tPitch = 0;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { if (!drag.active) { ui.hideTip(); setHover(-10); } });

function setHover(id) { if (threads) threads.material.uniforms.uHover.value = id; }
function showHover(x, y, touch) {
  const hit = hover.pick(x, y);
  if (!hit) { if (!touch) ui.hideTip(); setHover(-10); return; }
  setHover(hit.id);
  ui.showTip(x, y, `+${Math.round(hit.delay * 1000)} ms`, touch);
}

addEventListener('resize', () => {
  layout();
  if (threads && Math.abs(view.aspect / threadAspect - 1) > 0.15) buildThreads();
  hover.invalidate();
});

// Frame loop.
const beats = new THREE.Vector4(-99, -99, -99, -99);
let beatSlot = 0, lastEject = -1;
const fps = { frames: 0, since: 0, slow: 0 };
const keyView = new THREE.Vector3();
let lastFrame = now();

function frame() {
  requestAnimationFrame(frame);
  const t = now();
  const dt = Math.min(0.1, t - lastFrame);
  lastFrame = t;
  const rm = reduced.matches;
  const c = cycle.update(t);
  const ev = cycle.events;

  if (ev.newBeat) sound.lub();
  if (ev.s2) sound.dub();
  // Record each ejection time once, for the thread shader's ring buffer.
  if (ev.ejectAt !== lastEject && t >= ev.ejectAt) {
    lastEject = ev.ejectAt;
    beats.setComponent(beatSlot, ev.ejectAt);
    beatSlot = (beatSlot + 1) % 4;
  }

  // Camera: slightly below, looking up 4°, with a slow ±1.5° drift.
  const drift = rm ? 0 : THREE.MathUtils.degToRad(1.5);
  const yaw = drift * Math.sin(t * Math.PI * 2 * 0.05);
  const pitch = THREE.MathUtils.degToRad(-4) + drift * 0.6 * Math.sin(t * Math.PI * 2 * 0.05 * 0.73 + 1.3);
  camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(view.dist);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // Drag spring (critically damped).
  const k = 60, damp = 2 * Math.sqrt(k);
  drag.vYaw += ((drag.tYaw - drag.yaw) * k - drag.vYaw * damp) * dt;
  drag.vPitch += ((drag.tPitch - drag.pitch) * k - drag.vPitch * damp) * dt;
  drag.yaw += drag.vYaw * dt; drag.pitch += drag.vPitch * dt;

  if (heart) {
    const u = heart.material.userData.uniforms;
    const amp = rm ? 0.4 : 1;
    u.uVent.value = c.vent; u.uTwist.value = c.twist; u.uAtria.value = c.atria; u.uAmp.value = amp;
    u.uEject.value = c.eject; u.uAtriaGloss.value = c.atria;
    // The great vessels swell 30 ms after ejection starts.
    const sinceEject = t - ev.ejectAt - 0.03;
    u.uSwell.value = sinceEject > 0 ? Math.exp(-sinceEject / 0.18) * Math.min(1, sinceEject / 0.04) : 0;
    const fade = Math.min(1, Math.max(0, (t - heartFadeStart) / 1.2));
    u.uFade.value = fade * fade * (3 - 2 * fade);
    // Apex tap: a 0.6° nod that brings the apex forward at the start of ejection.
    const sinceTap = t - ev.ejectAt;
    const tap = sinceTap >= 0 ? THREE.MathUtils.degToRad(0.6) * amp * Math.exp(-sinceTap / 0.09) * Math.min(1, sinceTap / 0.02) : 0;
    heartGroup.rotation.set(THREE.MathUtils.degToRad(drag.pitch) - tap, THREE.MathUtils.degToRad(drag.yaw), 0);
    heartGroup.updateMatrixWorld();
    keyView.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
    u.uKeyDir.value.copy(keyView);
    heart.mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, heart.mesh.matrixWorld);
    u.uNormalMat.value.getNormalMatrix(heart.mesh.modelViewMatrix);
  }

  if (threads) {
    const tu = threads.material.uniforms;
    tu.uTime.value = t; tu.uBeats.value.copy(beats); tu.uReduced.value = rm ? 1 : 0;
    hover.maybeRefresh();
  }

  ui.update(cycle.bpm, cycle.beats, t - lastLive < 10, Math.max(0, c.vent));
  post.render(t);
  watchFps(t);
}

// Auto-downgrade: high → low if under 45 fps for 2 s; on low, under 28 fps halves the wanderers.
function watchFps(t) {
  fps.frames++;
  if (t - fps.since < 1) return;
  const rate = fps.frames / (t - fps.since);
  fps.frames = 0; fps.since = t;
  if (document.hidden || t < 4 || pinnedTier) return;
  const floor = low ? 28 : 45;
  fps.slow = rate < floor ? fps.slow + 1 : 0;
  if (fps.slow < 2) return;
  fps.slow = 0;
  if (!low) {
    low = true;
    tier = TIERS.low;
    post.removeBloom();
    layout();
    buildThreads();
  } else if (tier.wanderers > 15) {
    tier = { ...tier, wanderers: Math.floor(tier.wanderers / 2) };
    buildThreads();
  }
}

requestAnimationFrame(frame);

