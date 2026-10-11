// Living Heart entry point: the scenes and cameras, the study controls, the blocked-thread circulation, and
// the frame loop.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Cycle } from './cycle.js';
import { loadHeart, WALL_PARTS } from './heart.js';
import { growThreads } from './threads.js';
import { buildThreadMeshes } from './thread-mesh.js';
import { createPost } from './post.js';
import { createUi } from './ui.js';
import { HeartSound } from './sound.js';
import { Hover } from './hover.js';
import { CameraRig, bindControls } from './camera-rig.js';
import { PartPicker } from './picker.js';
import { Blockage } from './blockage.js';
import { PARTS, TOUR, BLOCKED, ARREST } from './heart-facts.js';

const canvas = document.getElementById('scene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const params = new URLSearchParams(location.search);
const clampBpm = (b) => Math.min(220, Math.max(30, Number(b) || 72));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Quality tier: phones, narrow screens and small CPUs get the light version.
// ?tier=high or ?tier=low pins the tier and turns off auto-downgrade.
const pinnedTier = ['high', 'low'].includes(params.get('tier')) ? params.get('tier') : null;
let low = pinnedTier ? pinnedTier === 'low' : coarse.matches || innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
const TIERS = {
  high: { trunkW: 3.0, tipW: 0.6, wandW: 0, dprCap: 2, density: 1 },
  low: { trunkW: 2.4, tipW: 0.7, wandW: 0.1, dprCap: 2, density: 1 },
};
let tier = TIERS[low ? 'low' : 'high'];
// Thread density follows the screen's area, so a wide desktop is as full of threads as a phone.
// A 390×844 phone gets about 700 attractors and 60 wanderers, as it always has.
function threadBudget(w, h) {
  const k = (w * h) / (390 * 844);
  return {
    attractors: Math.round(Math.min(5200, Math.max(400, 700 * k * tier.density))),
    wanderers: Math.round(Math.min(220, Math.max(30, 60 * k * tier.density))),
    maxSamples: Math.round(Math.min(60000, Math.max(10000, 12500 * k))),
  };
}

// Renderer and the three scenes: threads behind, the heart, threads in front.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);   // the page's #050507 is added after tone mapping (post.js)
renderer.toneMapping = THREE.NeutralToneMapping;   // AgX turns wet red muscle pink; Neutral keeps it red
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const backScene = new THREE.Scene(), frontScene = new THREE.Scene(), heartScene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
heartScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const pageCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const heartCam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
heartScene.add(heartCam);
// The lights ride with the study camera, so whichever side you look at is lit like the front.
const key = new THREE.DirectionalLight(0xfff1e6, 2.6);
key.position.set(-1.2, 1.4, 1.6);
key.target.position.set(0, 0, -1);
const rimCool = new THREE.DirectionalLight(0xa9c8ff, 1.6);
rimCool.position.set(1.8, 1.4, -2.6);
const rimWarm = new THREE.DirectionalLight(0xffd9d0, 0.9);
rimWarm.position.set(-2.2, -0.4, -2.4);
for (const l of [key, rimCool, rimWarm]) { l.target.position.set(0, 0, -3); heartCam.add(l, l.target); }

const heartGroup = new THREE.Group();
heartGroup.position.y = -0.2;   // the chambers sit a little low, leaving room for the great vessels above
heartScene.add(heartGroup);
const rig = new CameraRig(heartCam);
rig.home.target.set(0, 0, 0);

// The cutaway: a frontal plane that sweeps in to slice the heart open.
const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2);
const cut = { on: false, k: 0 };

// Layout: the heart (one unit, the chambers) fills about 42% of the viewport height (250–480 px),
// or 60% of a portrait phone's width.
const view = { w: 1, h: 1, dpr: 1, dist: 8, visH: 4, visW: 4, aspect: 1 };
const MODEL_W = 1.34;
function layout() {
  const w = innerWidth, h = innerHeight;
  view.w = w; view.h = h; view.aspect = w / h;
  view.dpr = Math.min(devicePixelRatio || 1, tier.dprCap);
  let frac = Math.min(480, Math.max(250, 0.42 * h)) / h;
  if (w < h) frac = (0.6 * w / MODEL_W) / h;
  if (h < 500) frac = Math.min(frac, 0.34);   // phones in landscape
  const t = Math.tan(THREE.MathUtils.degToRad(15));
  view.visH = 1 / frac;
  view.visW = view.visH * view.aspect;
  view.dist = view.visH / (2 * t);
  for (const c of [pageCam, heartCam]) { c.aspect = view.aspect; c.updateProjectionMatrix(); }
  pageCam.position.set(0, 0, view.dist);
  pageCam.lookAt(0, 0, 0);
  pageCam.updateMatrixWorld();
  rig.setHome(view.dist);
  renderer.setPixelRatio(view.dpr);
  renderer.setSize(w, h, false);
  post?.setSize(w, h, view.dpr);
  if (threads) threads.material.uniforms.uRes.value.set(w * view.dpr, h * view.dpr);
  blockage.setClotSize(clotSize());
}
const clotSize = () => (coarse.matches ? 9 : 7.5) * view.visH / view.h;

// Threads: grown for the window's shape and area; regrown (debounced) when either changes a lot.
let threads = null, threadKey = null, roots = null;
const SPEED_PAGES = 1.1;
const HEART_CLEAR = { x: 0.7, y: 1.0 };   // the heart's footprint on the page, kept free of branches
const blockage = new Blockage(frontScene);
function buildThreads() {
  if (!roots) return;
  if (threads) {
    backScene.remove(threads.back); frontScene.remove(threads.front);
    threads.back.geometry.dispose(); threads.front.geometry.dispose(); threads.material.dispose();
  }
  const slab = { halfW: view.visW * 1.15 / 2, halfH: view.visH * 1.15 / 2, halfD: 0.6 };
  const budget = threadBudget(view.w, view.h);
  const shifted = roots.map((r) => ({ pos: [r.pos[0], r.pos[1] + heartGroup.position.y, r.pos[2]], dir: r.dir }));
  const paths = growThreads(shifted, slab, budget, HEART_CLEAR);
  for (const p of paths) {
    p.trunkW = tier.trunkW; p.tipW = tier.tipW;
    if (p.wanderer) p.w0 += tier.wandW;
  }
  // Pulses travel 1.1 page-heights a second; the glow fades with distance along the thread.
  const v = SPEED_PAGES * view.visH;
  threads = buildThreadMeshes(paths, { dpr: view.dpr, halfD: slab.halfD, v, atten: Math.max(2.2, view.visH * 0.75) });
  threads.material.uniforms.uRes.value.set(view.w * view.dpr, view.h * view.dpr);
  threads.speed = v;
  threads.paths = paths;
  backScene.add(threads.back); frontScene.add(threads.front);
  threadKey = { aspect: view.aspect, area: view.w * view.h };
  hover.setSamples(threads.hover, v);
  blockage.setThreads(threads);
}

let post = null;
const hover = new Hover(pageCam, canvas);
layout();
post = createPost(renderer, { back: backScene, heart: heartScene, front: frontScene, pageCamera: pageCam, heartCamera: heartCam }, { bloom: !low, samples: low ? 0 : 4 });
post.setSize(view.w, view.h, view.dpr);

// ---- Heart rate: ?bpm=, the slider, and window.setHeartRate for the WHOOP bridge (all set the resting rate) ----
const startClock = performance.now();
const now = () => (performance.now() - startClock) / 1000;
let restBpm = clampBpm(params.get('bpm') || 72);
const cycle = new Cycle(restBpm, now());
let lastLive = -Infinity;
// The heart stops once 85% of the flow along the six main trunks is blocked.
const ARREST_AT = 0.85;
const circ = { state: 'normal', load: 0, strain: 0, failAt: 0, stopAt: 0, kick: 0, beatAmp: 1, arrestShown: false };
const targetBpm = () => {
  const top = Math.max(restBpm + 60, 190);
  return restBpm + (top - restBpm) * Math.pow(Math.min(1, circ.load / ARREST_AT), 0.85);
};
const applyRate = () => { if (circ.state === 'normal') cycle.setBpm(targetBpm(), 2); };
window.setHeartRate = (bpm) => {
  restBpm = clampBpm(bpm);
  lastLive = now();
  ui.setRest(Math.round(restBpm));
  applyRate();
  return restBpm;
};

// ---- Sound: on by default, started by the first gesture (browsers allow nothing sooner) ----
const sound = new HeartSound();
let soundWanted = true, soundStarted = false;
// Touch only counts as a gesture when the finger lifts (and iOS wants touchend), so listen for every kind,
// and keep trying until the audio is actually running.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
const firstGesture = async (e) => {
  if (soundStarted || (e.type === 'pointerdown' && e.pointerType !== 'mouse')) return;
  if (!soundWanted) { stopListening(); return; }
  const on = await sound.setOn(true);
  if (on) { soundStarted = true; stopListening(); }
  ui.setSoundLabel(soundWanted);
};
const stopListening = () => { for (const g of GESTURES) removeEventListener(g, firstGesture, true); };
for (const g of GESTURES) addEventListener(g, firstGesture, true);

// ---- The interface ----
let heart = null, picker = null, selected = null, hovered = null, tourAt = -1;
const tourTag = document.getElementById('tourTag');
let tourParts = new Set();                  // parts lit up by the current tour stop
const ui = createUi({
  onRate: (b) => { restBpm = clampBpm(b); applyRate(); },
  onSound: async (on) => {
    soundWanted = on;
    soundStarted = true;
    stopListening();
    const applied = await sound.setOn(on);
    if (circ.state === 'stopped' && applied) sound.flatline(true);
    return on ? applied : false;
  },
  onFlyTo: () => { if (selected) flyToPart(selected); },
  onClosePanel: () => select(null),
  onTour: tour,
  onCutaway: (on) => setCutaway(on),
  onReset: () => { endTour(); select(null); setCutaway(false); rig.reset(); },
  onRestart: restart,
});
ui.setRest(Math.round(restBpm));

loadHeart({
  lowTier: low,
  clippingPlanes: [cutPlane],
  onProgress: (f) => ui.progress(f),
  onInfo(info) { roots = info.threadRoots; buildThreads(); },
}).then((h) => {
  heart = h;
  heartGroup.add(h.group);
  heartGroup.updateMatrixWorld(true);
  picker = new PartPicker(heartCam, h);
  ui.setCredit(h.credit.text, h.credit.href);
  ui.loaded();
  heartFadeStart = now();
}).catch((err) => { console.error('Living Heart could not load the heart.', err); ui.loadFailed(); });
let heartFadeStart = Infinity;

// ---- Selecting parts and framing them ----
const V3 = (a) => new THREE.Vector3(...a).add(heartGroup.position);
function select(id, { panel = true } = {}) {
  selected = id;
  if (!id) { ui.closePanel(); return; }
  if (panel && PARTS[id]) ui.openPanel(PARTS[id]);
}
function highlightOf(partId) {
  if (tourParts.size) return tourParts.has(partId) ? 2 : 0;
  if (!selected) return 0;
  if (selected === 'myocardium') return WALL_PARTS.has(partId) ? 1 : 0;
  return partId === selected ? 1 : 0;
}

/** Where the camera goes for a part: inside its chamber for interior structures, outside for the rest. */
function viewFor(id, { wide = false, outside = false } = {}) {
  const L = heart.landmarks, ch = heart.chambers;
  const facts = PARTS[id] || {};
  if (id === 'myocardium') {
    setCutaway(true);
    return { target: V3([0.1, -0.1, 0]), yaw: 0.35, pitch: 0.1, dist: view.dist * 0.62 };
  }
  const info = heart.partInfo[id];
  const centre = V3(info.centre);
  // The outlet valves are seen as a surgeon sees them, from the artery above.
  const room = { ...ch, ao: L.aorta.path[2], pt: L.pulmonaryTrunk.path[2] };
  const inside = { 'aortic-valve': 'ao', 'pulmonary-valve': 'pt' }[id] || facts.inside;
  if (!wide && !outside && inside && room[inside]) {
    const chamber = V3(room[inside]);
    let eye = chamber, target = centre;
    // Stand back from a valve as far as the chamber allows, so the whole valve fits in view.
    const back = target.distanceTo(chamber);
    if (back > 0.05 && /valve|node/.test(id)) eye = target.clone().addScaledVector(chamber.clone().sub(target).normalize(), Math.min(back + 0.07, Math.max(back * 1.3, info.radius * 1.4)));
    if (id === 'papillary-muscles') { eye = V3(ch.lv).lerp(V3(L.avPlane.point), 0.35); target = V3(ch.lv).lerp(V3(L.apex), 0.6); }
    // A chamber itself: stand in it and look at its inlet valve, with the cords and muscles that hold it.
    const LOOK = { 'left-ventricle': 'mitral-valve', 'right-ventricle': 'tricuspid-valve', 'left-atrium': 'mitral-valve', 'right-atrium': 'tricuspid-valve' };
    if (LOOK[id]) target = V3(heart.partInfo[LOOK[id]].centre);
    if (eye.distanceTo(target) < 0.08) target = eye.clone().add(new THREE.Vector3(0, -0.02, -0.1));
    return CameraRig.viewFrom(eye, target);
  }
  const out = centre.clone().sub(heartGroup.position).setY(centre.y * 0.6);
  if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
  const dir = out.normalize().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.12, 0.75)).normalize();
  const dist = Math.min(view.dist * 0.95, Math.max(1.3, info.radius * (wide ? 7 : 4.6)));
  return CameraRig.viewFrom(centre.clone().addScaledVector(dir, dist), centre);
}
function flyToPart(id, opts) { if (heart) rig.flyTo(viewFor(id, opts)); }

function setCutaway(on) {
  cut.on = on;
  ui.setCutaway(on);
}

// ---- Tour: the path of blood, one stop per click ----
function tour(cmd) {
  if (!heart) return;
  if (cmd === 'end') { endTour(); return; }
  if (cmd === 'start') tourAt = 0;
  else if (cmd === 'next') tourAt++;
  else if (cmd === 'back') tourAt = Math.max(0, tourAt - 1);
  if (tourAt >= TOUR.length) { endTour(); rig.reset(); return; }
  const stop = TOUR[tourAt];
  ui.closePanel();
  selected = stop.part;
  tourParts = new Set(stop.parts || [stop.part]);
  ui.showTour(tourAt, TOUR.length, stop);
  flyToPart(stop.part, { wide: !!stop.lungs, outside: !!stop.outside });
}
function endTour() {
  if (tourAt < 0) return;
  tourAt = -1;
  selected = null;
  tourParts = new Set();
  tourTag.hidden = true;
  ui.hideTour();
}

// ---- Pointer: tap a part to learn about it, tap a thread to block it, tap a clot to clear it ----
const projectPage = (p) => {
  const v = p.clone().project(pageCam);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
};
// The main trunks are easier to hit: they count as three times closer than a fine branch.
const trunkWeight = (id) => (threads.paths[id]?.trunk ? 0.11 : 1);
const threadsActive = () => threads && threadFade > 0.45 && circ.state !== 'stopped';
const cutInfo = () => ({ plane: cut.k > 0.02 ? cutPlane : null, clipR: heart?.shared.uClipR.value || 0, camPos: heartCam.position });

function onTap(x, y, type) {
  if (!document.getElementById('arrest').hidden) return;
  const touch = type !== 'mouse';
  // A clot first: it is small and sits on top.
  if (threadsActive()) {
    const clot = blockage.clotAt(x, y, projectPage, touch ? 30 : 16);
    if (clot) { blockage.remove(clot); showBlockedPanel(); ui.showTip(x, y, 'Clot cleared', true); return; }
  }
  // A thread passing in front of the heart, right under the pointer, wins over the heart behind it.
  if (threadsActive()) {
    const t = hover.pick(x, y, touch ? 14 : 6, trunkWeight);
    if (t && t.pos[2] > -0.05) { blockAt(t, x, y); return; }
  }
  const hit = picker?.pick(x, y, cutInfo());
  if (hit) {
    endTour();
    select(hit.id);
    if (touch) ui.showTip(x, y, PARTS[hit.id]?.name || '', true);
    return;
  }
  if (threadsActive()) {
    const t = hover.pick(x, y, touch ? 26 : 10, trunkWeight);
    if (t) { blockAt(t, x, y); return; }
  }
  if (ui.panelOpen()) select(null);
}
function blockAt(t, x, y) {
  blockage.add(t.id, t.s, new THREE.Vector3(...t.pos), clotSize());
  showBlockedPanel();
  ui.showTip(x, y, 'Blocked', true);
}
function showBlockedPanel() {
  endTour();
  selected = null;
  ui.openPanel(BLOCKED, {
    fly: false,
    live: () => `<p><strong>${Math.round(circ.load * 100)}%</strong> of flow blocked · heart at <strong>${Math.round(cycle.bpm)}</strong> BPM${circ.state === 'failing' ? ' · <strong>failing</strong>' : ''}</p>`,
  });
}

let hoverQueued = null;
function onHover(x, y) { hoverQueued = [x, y]; }
function doHover() {
  if (!hoverQueued) return;
  const [x, y] = hoverQueued;
  hoverQueued = null;
  const hit = picker?.pick(x, y, cutInfo());
  hovered = hit ? hit.id : null;
  document.body.classList.toggle('over-part', !!hit);
  if (hit) { setThreadHover(-10); ui.showTip(x, y, PARTS[hit.id]?.name || ''); return; }
  if (threadsActive()) {
    if (blockage.clotAt(x, y, projectPage, 16)) { setThreadHover(-10); ui.showTip(x, y, 'Clot · click to clear'); document.body.classList.add('over-part'); return; }
    const t = hover.pick(x, y, 10, trunkWeight);
    if (t) {
      const trunk = threads.paths[t.id].trunk;
      setThreadHover(t.id);
      ui.showTip(x, y, trunk ? 'Main vessel · click to block it and all its branches' : `Vessel · +${Math.round(t.delay * 1000)} ms · click to block`);
      document.body.classList.add('over-part');
      return;
    }
  }
  setThreadHover(-10);
  ui.hideTip();
}
function setThreadHover(id) { if (threads) threads.material.uniforms.uHover.value = id; }
canvas.addEventListener('pointerleave', () => { ui.hideTip(); setThreadHover(-10); hovered = null; });
bindControls(rig, canvas, { onTap, onHover, onDragStart: () => ui.hideTip() });
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (tourAt >= 0) endTour(); else if (ui.panelOpen()) select(null);
});

// ---- The circulation under strain ----
blockage.onChange((load) => {
  circ.load = load;
  if (circ.state === 'failing' && load < ARREST_AT) { circ.state = 'normal'; }
  applyRate();
});
function restart() {
  blockage.clear();
  circ.load = 0;
  circ.state = 'normal';
  circ.arrestShown = false;
  circ.kick = 1;
  sound.flatline(false);
  ui.hideArrest();
  cycle.restart(now(), restBpm + 40, restBpm, 8);
  ui.closePanel();
}

// Resizes: re-lay out at once, regrow the threads once the window settles.
let resizeTimer = 0;
addEventListener('resize', () => {
  layout();
  hover.invalidate();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!threadKey) return;
    if (Math.abs(view.aspect / threadKey.aspect - 1) > 0.15 || Math.abs(view.w * view.h / threadKey.area - 1) > 0.3) buildThreads();
  }, 350);
});

// ---- Frame loop ----
const beats = new THREE.Vector4(-99, -99, -99, -99);
let beatSlot = 0, lastEject = -1;
const fps = { frames: 0, since: 0, slow: 0 };
const keyView = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
let lastFrame = now(), threadFade = 1, sheetShift = 0, sheetZoom = 1;

function ecgAt(t) {
  if (cycle.stopped) return 0;
  const rr = cycle.rr, tb = t - cycle.start;
  const g = (x, s) => Math.exp(-(x / s) * (x / s));
  return 1.0 * g(tb - 0.02, 0.012) - 0.18 * g(tb - 0.0, 0.01) - 0.25 * g(tb - 0.045, 0.012)
    + 0.28 * g(tb - 0.26 * Math.sqrt(rr / 0.83), 0.05) + 0.12 * g(tb - (rr - 0.13), 0.025);
}

function frame() {
  // ?debug exposes the moving parts to the console for checking.
if (params.has('debug')) {
  window.__lh = {
    rig, cycle, circ, blockage, hover, projectPage, pick: (x, y) => picker?.pick(x, y, cutInfo()),
    get threads() { return threads; },
    trunkExits: () => threads.paths.filter((p) => p.trunk).map((p) => {
      const q = p.pts.find((v) => Math.abs(v[0]) > HEART_CLEAR.x + 0.08 || Math.abs(v[1]) > HEART_CLEAR.y + 0.08) || p.pts[p.pts.length - 1];
      return projectPage(new THREE.Vector3(...q));
    }),
    trunkPoints: (i = 10) => threads.paths.filter((p) => p.trunk).map((p) => projectPage(new THREE.Vector3(...p.pts[Math.min(i, p.pts.length - 1)]))),
  };
}

requestAnimationFrame(frame);
  const t = now();
  const dt = Math.min(0.1, t - lastFrame);
  lastFrame = t;
  const rm = reduced.matches;

  // The failing heart: frantic irregular beats for a few seconds, one last bulge, then it stops.
  if (circ.state === 'normal' && circ.load >= ARREST_AT) { circ.state = 'failing'; circ.failAt = t; }
  const c = cycle.update(t);
  const ev = cycle.events;
  if (circ.state === 'failing') {
    if (ev.newBeat) { cycle.nextAfter(0.2 + Math.random() * 0.36); circ.beatAmp = 0.55 + Math.random() * 0.8; }
    if (t - circ.failAt > 3.2) { circ.state = 'stopped'; circ.stopAt = t; cycle.stop(); }
  } else if (circ.state === 'normal') circ.beatAmp += (1 - circ.beatAmp) * Math.min(1, dt * 3);
  if (circ.state === 'stopped') {
    if (!circ.flat && t - circ.stopAt > 0.6) { circ.flat = true; sound.flatline(true); }
    if (!circ.arrestShown && t - circ.stopAt > 2.0) { circ.arrestShown = true; ui.closePanel(); ui.showArrest(ARREST.title, ARREST.text, ARREST.careTitle, ARREST.care); }
  } else circ.flat = false;

  const strainTarget = circ.state === 'normal' ? circ.load : 1;
  circ.strain += (strainTarget - circ.strain) * Math.min(1, dt * 1.5);
  circ.kick *= Math.exp(-dt / 0.5);

  if (ev.newBeat) sound.lub(1 + 0.4 * circ.strain + 0.6 * circ.kick);
  if (ev.s2) sound.dub();
  if (ev.ejectAt !== lastEject && t >= ev.ejectAt && !cycle.stopped) {
    lastEject = ev.ejectAt;
    beats.setComponent(beatSlot, ev.ejectAt);
    beatSlot = (beatSlot + 1) % 4;
  }

  // Camera, and the bottom sheet pushing the view up so the selected part stays visible.
  rig.update(dt, rm);
  // A bottom sheet: centre the heart in the space left between the top bar and the sheet, smaller to fit.
  const cover = ui.sheetCover();
  const headerBottom = cover ? document.querySelector('.topbar').getBoundingClientRect().bottom + 8 : 0;
  const freeH = view.h - cover - headerBottom;
  const shiftGoal = cover ? view.h / 2 - (headerBottom + view.h - cover) / 2 : 0;
  const zoomGoal = cover ? THREE.MathUtils.clamp(freeH / (view.h * 0.85), 0.4, 1) : 1;
  const sk = Math.min(1, dt * 6);
  sheetShift += (shiftGoal - sheetShift) * sk;
  sheetZoom += (zoomGoal - sheetZoom) * sk;
  if (Math.abs(sheetShift) > 0.5 || sheetZoom < 0.995) {
    heartCam.zoom = sheetZoom;
    heartCam.setViewOffset(view.w, view.h, 0, sheetShift, view.w, view.h);
  } else if (heartCam.view?.enabled) { heartCam.zoom = 1; heartCam.clearViewOffset(); }

  if (heart) {
    const u = heart.shared;
    const amp = (rm ? 0.4 : 1) * (1 + 0.6 * circ.strain + 0.5 * circ.kick) * circ.beatAmp;
    u.uVent.value = c.vent; u.uTwist.value = c.twist; u.uAtria.value = c.atria; u.uAmp.value = amp;
    u.uEject.value = c.eject; u.uAtriaGloss.value = c.atria; u.uTime.value = t;
    u.uDusk.value = circ.strain * (circ.state === 'stopped' ? 1 : 0.8);
    // The great vessels swell 30 ms after ejection starts.
    const sinceEject = t - ev.ejectAt - 0.03;
    u.uSwell.value = !cycle.stopped && sinceEject > 0 ? Math.exp(-sinceEject / 0.18) * Math.min(1, sinceEject / 0.04) : 0;
    const fade = Math.min(1, Math.max(0, (t - heartFadeStart) / 1.2));
    u.uFade.value = fade * fade * (3 - 2 * fade);
    // Under strain the heart dilates as it fills; the last beat bulges, then it stays a little swollen.
    let swell = (rm ? 0.4 : 1) * circ.strain * 0.045 * (1 - Math.min(1, c.vent));
    if (circ.state === 'stopped') { const k = Math.min(1, (t - circ.stopAt) / 0.9); swell = (rm ? 0.02 : 0.07 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k * 0.4)) + 0.025; }
    // Apex tap: a 0.6° nod that brings the apex forward at the start of ejection.
    const sinceTap = t - ev.ejectAt;
    const tap = !cycle.stopped && sinceTap >= 0 ? THREE.MathUtils.degToRad(0.6) * amp * Math.exp(-sinceTap / 0.09) * Math.min(1, sinceTap / 0.02) : 0;
    heartGroup.rotation.set(-tap, 0, 0);
    heartGroup.scale.setScalar(1 + swell);
    heartGroup.updateMatrixWorld();

    // Cutaway sweep, and the clipping sphere that opens a way in for the camera.
    cut.k += ((cut.on ? 1 : 0) - cut.k) * Math.min(1, dt * (rm ? 20 : 2.4));
    cutPlane.constant = THREE.MathUtils.lerp(1.4, 0.02, cut.k);
    const camFromHeart = heartCam.position.distanceTo(heartGroup.position);
    u.uClipR.value = camFromHeart < 1.0 ? THREE.MathUtils.clamp(rig.cur.dist * 0.3, 0.02, 0.08) * smooth(1.0, 0.75, camFromHeart) : 0;
    u.uCamPos.value.copy(heartCam.position);

    keyView.copy(key.position).normalize();
    u.uKeyDir.value.copy(keyView);
    tmpM.multiplyMatrices(heartCam.matrixWorldInverse, heartGroup.matrixWorld);
    u.uNormalMat.value.getNormalMatrix(tmpM);

    // Tour: a name tag pinned to the part being described.
    if (tourAt >= 0 && heart.partInfo[TOUR[tourAt].part]) {
      const pt = V3(heart.partInfo[TOUR[tourAt].part].centre).project(heartCam);
      const onScreen = pt.z < 1 && Math.abs(pt.x) < 0.95 && Math.abs(pt.y) < 0.95;
      tourTag.hidden = !onScreen;
      if (onScreen) {
        tourTag.textContent = TOUR[tourAt].title;
        tourTag.style.transform = `translate(${(pt.x + 1) / 2 * innerWidth}px, ${(1 - pt.y) / 2 * innerHeight}px) translate(-50%, -130%)`;
      }
    }

    // Highlight the selected part and dim the rest; hover lifts a part a touch.
    const ek = Math.min(1, dt * 8);
    for (const p of heart.parts.values()) {
      const pu = p.material.userData.uniforms;
      const hi = highlightOf(p.id);
      // Inside a highlighted chamber, its glow would wash out the whole view: keep it to a hint.
      // Inside the heart a normal highlight is kept to a hint; on the tour it stays clearly lit.
      const inside = heart.shared.uClipR.value > 0;
      const level = hi > 1 ? (inside ? 1.25 : hi) : hi * (inside ? 0.2 : 1);
      pu.uHi.value += (level - pu.uHi.value) * ek;
      pu.uDim.value += ((selected && !hi ? 1 : 0) - pu.uDim.value) * ek;
      pu.uHover.value += ((hovered === p.id && !hi ? 1 : 0) - pu.uHover.value) * ek;
    }
  }

  // Threads: fixed to the page, dimmed while studying close up so they never get in the way.
  const fadeTarget = (1 - 0.82 * rig.awayness()) * (heart && heart.shared.uClipR.value > 0 ? 0.4 : 1);
  threadFade += (fadeTarget - threadFade) * Math.min(1, dt * 4);
  if (threads) {
    const tu = threads.material.uniforms;
    tu.uTime.value = t; tu.uBeats.value.copy(beats); tu.uReduced.value = rm ? 1 : 0;
    tu.uFade.value = threadFade;
    tu.uStrength.value = 1 + 0.8 * circ.strain;
    tu.uV.value = threads.speed * (1 + 0.5 * circ.strain);
    hover.maybeRefresh();
  }
  blockage.update(t, Math.max(0.35, threadFade));
  doHover();

  const mode = circ.state === 'stopped' ? 'stopped' : circ.state === 'failing' ? 'failing' : circ.load > 0.02 ? 'strain' : t - lastLive < 10 ? 'live' : 'rest';
  ui.update(dt, cycle.bpm, cycle.beats, mode, ecgAt(t));
  post.render(t);
  watchFps(t);
}

// Auto-downgrade: high → low if under 45 fps for 2 s; on low, under 28 fps thins the threads.
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
  // Regrowing the threads would lose the visitor's clots, so while any are placed only the bloom goes.
  const keep = blockage.blocks.length > 0;
  if (!low) {
    low = true;
    tier = TIERS.low;
    post.removeBloom();
    if (!keep) { layout(); buildThreads(); }
  } else if (tier.density > 0.4 && !keep) {
    tier = { ...tier, density: tier.density * 0.6, dprCap: 1.5 };
    layout();
    buildThreads();
  }
}

// ?debug exposes the moving parts to the console for checking.
if (params.has('debug')) {
  window.__lh = {
    rig, cycle, circ, blockage, hover, projectPage, pick: (x, y) => picker?.pick(x, y, cutInfo()),
    get threads() { return threads; },
    trunkExits: () => threads.paths.filter((p) => p.trunk).map((p) => {
      const q = p.pts.find((v) => Math.abs(v[0]) > HEART_CLEAR.x + 0.08 || Math.abs(v[1]) > HEART_CLEAR.y + 0.08) || p.pts[p.pts.length - 1];
      return projectPage(new THREE.Vector3(...q));
    }),
    trunkPoints: (i = 10) => threads.paths.filter((p) => p.trunk).map((p) => projectPage(new THREE.Vector3(...p.pts[Math.min(i, p.pts.length - 1)]))),
  };
}

requestAnimationFrame(frame);
