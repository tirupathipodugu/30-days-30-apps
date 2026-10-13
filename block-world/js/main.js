// Block World: turn a photo, or the live camera, into a block-game world. Two on-device AIs say how far
// away every part of the picture is and what it is. voxel.js places every point in real 3D (flat floor,
// upright walls), snaps it to big blocks and gives each block the material of what it is: plaster walls,
// plank floors, wool sofas, leaf plants, glass windows. Every object is its own group you can pick up and
// move. Nothing is uploaded.

import * as THREE from 'three';
import { TYPES, typeFor, materialFor, cubeGeometry } from './blocks.js';
import { voxelize } from './voxel.js';

const $ = (id) => document.getElementById(id);
const NICE = { 'television receiver': 'TV', windowpane: 'window', 'chest of drawers': 'drawers', 'crt screen': 'screen', person: 'you' };
const nice = (n) => NICE[n] || n;

// ---------- three.js ----------

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const SKY = new THREE.Color(0x8fc4f2);
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY, 90, 220);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1000);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a888, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(0.6, 1, 0.45);
scene.add(sun);

let world = null;   // { meshes: {type: InstancedMesh}, blocks, groups, bounds }
const tmpColor = new THREE.Color();

// ---------- camera orbit ----------

const orbit = { yaw: 0, pitch: 0.1, dist: 60, target: new THREE.Vector3(), idle: 0, swayCentre: 0 };
function placeCamera() {
  const { yaw, pitch, dist, target } = orbit;
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
}
function fitCamera(bounds) {
  const fov = camera.fov * Math.PI / 180;
  const w = bounds.max.x - bounds.min.x + 2, h = bounds.max.y - bounds.min.y + 2;
  orbit.target.set((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2);
  const front = bounds.max.z - orbit.target.z;
  orbit.dist = Math.max(h / 2 / Math.tan(fov / 2), w / 2 / Math.tan(fov / 2) / camera.aspect) * 0.92 + front;
  orbit.yaw = 0; orbit.pitch = 0.12; orbit.idle = 0;
  placeCamera();
}

// ---------- meshes ----------

const pool = {};        // type -> InstancedMesh, grown when needed
function meshFor(type, need) {
  let m = pool[type];
  if (!m || m.instanceMatrix.count < need) {
    if (m) { scene.remove(m); m.dispose(); }
    m = new THREE.InstancedMesh(cubeGeometry(), materialFor(type), Math.max(256, Math.ceil(need * 1.4)));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
    m.frustumCulled = false;
    m.userData.type = type;
    scene.add(m);
    pool[type] = m;
  }
  return m;
}
function hideAll() { for (const m of Object.values(pool)) { m.count = 0; m.userData.list = []; } }

function setInstance(m, k, x, y, z, s) {
  const a = m.instanceMatrix.array, o = k * 16;
  a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
function setColor(m, k, c) {
  tmpColor.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  const a = m.instanceColor.array;
  a[k * 3] = tmpColor.r; a[k * 3 + 1] = tmpColor.g; a[k * 3 + 2] = tmpColor.b;
}

/** Draw a list of blocks [{x,y,z,type,color}] into the pooled meshes. */
function drawBlocks(blocks) {
  const byType = {};
  for (const b of blocks) (byType[b.type] ||= []).push(b);
  hideAll();
  for (const [type, list] of Object.entries(byType)) {
    const m = meshFor(type, list.length + (world ? 2000 : 0));
    m.userData.list = list;
    list.forEach((b, k) => { b.mesh = m; b.k = k; setColor(m, k, b.color); });
    m.count = list.length;
    m.instanceColor.needsUpdate = true;
  }
}

// ---------- groups: each object is a connected patch of one label ----------

function findGroups(labels, names, gw, gh) {
  const group = new Int32Array(gw * gh);
  const groups = [{ name: 'room', offset: new THREE.Vector3(), blocks: [] }];
  for (let i = 0; i < gw * gh; i++) {
    if (group[i] || labels[i] < 0) continue;
    const t = typeFor(names[labels[i]]);
    if (!t || TYPES[t].fixed) continue;
    const stack = [i], cells = [];
    group[i] = -1;
    while (stack.length) {
      const k = stack.pop(); cells.push(k);
      const r = Math.floor(k / gw), c = k % gw;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= gh || cc >= gw) continue;
        const kk = rr * gw + cc;
        if (!group[kk] && labels[kk] === labels[i]) { group[kk] = -1; stack.push(kk); }
      }
    }
    const id = cells.length >= 20 ? groups.length : 0;
    if (id) groups.push({ name: nice(names[labels[i]]), offset: new THREE.Vector3(), blocks: [] });
    for (const k of cells) group[k] = id;
  }
  for (let i = 0; i < gw * gh; i++) if (group[i] < 0) group[i] = 0;
  return { group, groups };
}

function skyFrom(colors, labels, names, gw, gh) {
  let s = [0, 0, 0], n = 0;
  for (let i = 0; i < gw * gh; i++) if (labels[i] >= 0 && names[labels[i]] === 'sky') { s[0] += colors[i * 3]; s[1] += colors[i * 3 + 1]; s[2] += colors[i * 3 + 2]; n++; }
  const c = n > 30 ? new THREE.Color(s[0] / n / 255, s[1] / n / 255, s[2] / n / 255) : SKY.clone();
  scene.background = c; scene.fog.color = c;
}

function boundsOf(blocks) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const b of blocks) { min.min(new THREE.Vector3(b.x, b.y, b.z)); max.max(new THREE.Vector3(b.x, b.y, b.z)); }
  return { min, max };
}

// ---------- building a world you can edit ----------

function buildWorld(colors, depth, labels, names, gw, gh) {
  skyFrom(colors, labels, names, gw, gh);
  const { group, groups } = findGroups(labels, names, gw, gh);
  const { voxels } = voxelize({ colors, depth, labels, names, gw, gh, across: 48, groupOf: group });
  const bounds = boundsOf(voxels);
  const span = bounds.max.y - bounds.min.y || 1;
  const blocks = voxels.map((v) => ({ ...v, rise: (bounds.max.y - v.y) / span, gone: false }));
  for (const b of blocks) groups[b.group].blocks.push(b);
  world = { blocks, groups, bounds };
  drawBlocks(blocks);
  writeAll(1);
  fitCamera(bounds);
  const found = [...new Set(groups.slice(1).map((g) => g.name))];
  $('found').textContent = found.length ? `Found ${found.slice(0, 8).join(', ')}${found.length > 8 ? '…' : ''}` : '';
  $('count').textContent = `${blocks.length.toLocaleString()} blocks · ${groups.length - 1} objects`;
}

function writeAll(rise) {
  for (const b of world.blocks) writeBlock(b, rise);
  for (const m of Object.values(pool)) m.instanceMatrix.needsUpdate = true;
}
function writeBlock(b, rise = 1) {
  const off = world.groups[b.group].offset;
  let y = b.y + off.y;
  if (rise < 1) {
    const t = Math.min(1, Math.max(0, (rise - b.rise * 0.6) / 0.4));
    y += (1 - t * t * (3 - 2 * t)) * 40;
  }
  setInstance(b.mesh, b.k, b.x + off.x, y, b.z + off.z, b.gone ? 0 : 1);
}

// ---------- tools: look, move, break, place ----------

let tool = 'look';
for (const btn of document.querySelectorAll('[data-tool]')) {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    $('hint').textContent = { look: 'Drag to look around. Pinch or scroll to zoom.', move: 'Drag any object to move it.', break: 'Tap a block to break it.', place: 'Tap a block to place a new one on it.' }[tool];
  });
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(e) {
  if (!world) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(Object.values(pool).filter((m) => m.count), false);
  for (const h of hits) {
    const b = h.object.userData.list?.[h.instanceId];
    if (b && !b.gone) return { b, h };
  }
  return null;
}

const pointers = new Map();
let drag = null, pinch0 = 0, dist0 = 0;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
  orbit.idle = -1e9;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = orbit.dist; drag = null; return;
  }
  if (tool === 'move') {
    const h = pick(e);
    if (h && h.b.group > 0) {
      const g = world.groups[h.b.group];
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.h.point.y);
      const start = new THREE.Vector3();
      ray.ray.intersectPlane(plane, start);
      drag = { g, plane, start, off0: g.offset.clone() };
      $('picked').textContent = `Moving the ${g.name}`;
      blip(440);
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    orbit.dist = Math.min(300, Math.max(6, dist0 * pinch0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
    placeCamera(); return;
  }
  if (drag) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const now = new THREE.Vector3();
    if (ray.ray.intersectPlane(drag.plane, now)) {
      drag.g.offset.set(Math.round(drag.off0.x + now.x - drag.start.x), drag.off0.y, Math.round(drag.off0.z + now.z - drag.start.z));
      for (const b of drag.g.blocks) writeBlock(b);
      for (const m of Object.values(pool)) m.instanceMatrix.needsUpdate = true;
    }
    return;
  }
  orbit.yaw -= dx * 0.006;
  orbit.pitch = Math.min(1.35, Math.max(-0.5, orbit.pitch + dy * 0.005));
  placeCamera();
});
canvas.addEventListener('pointerup', (e) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (drag) { drag = null; setTimeout(() => ($('picked').textContent = ''), 1200); return; }
  if (!p || live) return;
  const tap = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8 && performance.now() - p.t < 400;
  if (!tap) return;
  const h = pick(e);
  if (!h) return;
  if (tool === 'break') { h.b.gone = true; writeBlock(h.b); h.b.mesh.instanceMatrix.needsUpdate = true; crunch(); }
  else if (tool === 'place') placeBlock(h);
  else if (h.b.group > 0) { $('picked').textContent = `That's the ${world.groups[h.b.group].name}`; setTimeout(() => ($('picked').textContent = ''), 1500); }
});
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(300, Math.max(6, orbit.dist * (1 + e.deltaY * 0.001))); orbit.idle = -1e9; placeCamera(); }, { passive: false });

let placeType = 'planks';
$('blockType').addEventListener('change', (e) => (placeType = e.target.value));
function placeBlock({ b, h }) {
  const n = h.face.normal;
  const off = world.groups[b.group].offset;
  const nb = { type: placeType, x: b.x + off.x + Math.round(n.x), y: b.y + off.y + Math.round(n.y), z: b.z + off.z + Math.round(n.z), color: TYPES[placeType].dye ? [0.9, 0.9, 0.9] : TYPES[placeType].tint, group: 0, rise: 0, gone: false };
  let m = pool[placeType];
  if (!m || m.count >= m.instanceMatrix.count) {
    // Grow this mesh, keeping what's there.
    const list = m?.userData.list || [];
    m = meshFor(placeType, list.length + 500);
    m.userData.list = list;
    list.forEach((x, k) => { x.mesh = m; x.k = k; setColor(m, k, x.color); writeBlock(x); });
    m.count = list.length;
  }
  nb.mesh = m; nb.k = m.count;
  m.userData.list.push(nb);
  world.blocks.push(nb);
  world.groups[0].blocks.push(nb);
  m.count++;
  setColor(m, nb.k, nb.color);
  m.instanceColor.needsUpdate = true;
  writeBlock(nb);
  m.instanceMatrix.needsUpdate = true;
  blip(660);
}

// ---------- photo in, world out ----------

async function fromImage(source) {
  stopLive();
  showBusy('Reading your photo…');
  const bmp = await createImageBitmap(source);
  const landscape = bmp.width >= bmp.height;
  const gw = landscape ? 160 : 120, gh = Math.round(gw * bmp.height / bmp.width);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const big = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  big.getContext('2d').drawImage(bmp, 0, 0, big.width, big.height);
  const blob = await big.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const small = new OffscreenCanvas(gw, gh);
  const sg = small.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(bmp, 0, 0, gw, gh);
  const px = sg.getImageData(0, 0, gw, gh).data;
  const colors = new Uint8Array(gw * gh * 3);
  for (let i = 0; i < gw * gh; i++) { colors[i * 3] = px[i * 4]; colors[i * 3 + 1] = px[i * 4 + 1]; colors[i * 3 + 2] = px[i * 4 + 2]; }

  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      if (data.type === 'stage') showBusy(data.text);
      else if (data.type === 'progress') showBusy(`Getting the ${data.what} AI ready… ${Math.round(data.loaded / data.total * 100)}%`);
      else if (data.type === 'error') reject(new Error(data.message));
      else if (data.type === 'done') {
        showBusy('Placing the blocks…');
        setTimeout(() => {
          buildWorld(colors, data.depth, data.labels, data.names, gw, gh);
          hideBusy(); $('tools').hidden = false;
          rising = true; riseStart = performance.now();
          thud();
          resolve();
        }, 30);
      }
    };
    import('./ai.js').then((ai) => ai.run({ blob, gw, gh }, onMsg)).catch(reject);
  });
}

function showBusy(text) { $('busyText').textContent = text; $('busy').hidden = false; $('start').hidden = true; }
function hideBusy() { $('busy').hidden = true; }
function failed(err) {
  $('busy').hidden = true; $('start').hidden = false; $('tools').hidden = true; $('livebar').hidden = true;
  $('status').textContent = `That didn't work (${err.message}). Try another photo, or the sample room.`;
}

$('photo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { startSound(); fromImage(f).catch(failed); } e.target.value = ''; });
$('sample').addEventListener('click', async () => {
  startSound();
  try { const res = await fetch(new URL('../assets/sample-room.jpg', import.meta.url)); fromImage(await res.blob()).catch(failed); } catch (err) { failed(err); }
});
$('again').addEventListener('click', () => { stopLive(); world = null; hideAll(); $('tools').hidden = true; $('start').hidden = false; $('status').textContent = ''; $('found').textContent = ''; $('count').textContent = ''; });
$('front').addEventListener('click', () => { if (world) fitCamera(world.bounds); });
$('save').addEventListener('click', () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'my-block-world.png'; a.click();
  }, 'image/png');
});

// ---------- live camera ----------
// Depth runs as often as the AI can manage; the object AI refreshes every 1.5 s in the background.
// Each depth update rebuilds the block world from the newest picture.

const LGW = 112;
let live = null, liveFacing = 'environment';

function onProgress(data) {
  if (data.type === 'progress') showBusy(`Getting the ${data.what} AI ready… ${Math.round(data.loaded / data.total * 100)}%`);
}

async function startLive(src) {
  startSound();
  world = null; hideAll();
  showBusy('Starting the camera…');
  const video = document.createElement('video');
  video.playsInline = true; video.muted = true;
  let stream = null, mirror = false;
  try {
    if (src) { video.src = src; video.loop = true; }
    else {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: liveFacing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video.srcObject = stream;
      mirror = liveFacing === 'user';
    }
    try { await video.play(); } catch { await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true }))); }
  } catch {
    failed(new Error('the camera didn\'t start. Allow it in your browser, or use a photo'));
    return;
  }
  const ai = await import('./ai.js');
  try {
    showBusy('Getting the AI ready. It downloads once (about 50 MB), then it\'s saved on your phone…');
    await ai.loadDepth(onProgress);
  } catch (err) { if (stream) stream.getTracks().forEach((t) => t.stop()); failed(err); return; }
  ai.loadSeg().catch(() => {});
  const vw = video.videoWidth, vh = video.videoHeight;
  const gw = LGW, gh = Math.round(LGW * vh / vw);
  live = {
    ai, video, stream, mirror, gw, gh,
    colorsCv: new OffscreenCanvas(gw, gh), aiCv: new OffscreenCanvas(256, Math.max(64, Math.round(256 * vh / vw))),
    depth: null, labels: new Int16Array(gw * gh).fill(-1), names: [], colors: new Uint8Array(gw * gh * 3),
    busyD: false, busyS: false, lastSeg: 0, updates: 0, statT: performance.now(), fitted: false,
  };
  hideBusy();
  $('tools').hidden = true; $('livebar').hidden = false; $('start').hidden = true;
}

function readColors(L) {
  const cg = L.colorsCv.getContext('2d', { willReadFrequently: true });
  if (L.mirror) { cg.setTransform(-1, 0, 0, 1, L.gw, 0); } else cg.setTransform(1, 0, 0, 1, 0, 0);
  cg.drawImage(L.video, 0, 0, L.gw, L.gh);
  const px = cg.getImageData(0, 0, L.gw, L.gh).data;
  for (let i = 0; i < L.gw * L.gh; i++) { L.colors[i * 3] = px[i * 4]; L.colors[i * 3 + 1] = px[i * 4 + 1]; L.colors[i * 3 + 2] = px[i * 4 + 2]; }
}
function grab(L) {
  const g = L.aiCv.getContext('2d', { willReadFrequently: true });
  if (L.mirror) g.setTransform(-1, 0, 0, 1, L.aiCv.width, 0); else g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(L.video, 0, 0, L.aiCv.width, L.aiCv.height);
  return L.ai.fromCanvas(L.aiCv);
}

function liveTick(now) {
  const L = live;
  if (L.video.readyState < 2) return;
  if (!L.busyD) {
    L.busyD = true;
    readColors(L);
    L.ai.depthGrid(grab(L), L.gw, L.gh, true).then((d) => {
      if (live !== L) return;
      L.depth = d;
      L.updates++;
      const { voxels } = voxelize({ colors: L.colors, depth: d, labels: L.labels, names: L.names, gw: L.gw, gh: L.gh, across: 44 });
      drawBlocks(voxels);
      for (const m of Object.values(pool)) {
        (m.userData.list || []).forEach((b, k) => setInstance(m, k, b.x, b.y, b.z, 1));
        m.instanceMatrix.needsUpdate = true;
      }
      if (!L.fitted) { fitCamera(boundsOf(voxels)); L.fitted = true; }
    }).catch(() => {}).finally(() => { L.busyD = false; });
  }
  if (L.ai.segReady() && !L.busyS && now - L.lastSeg > 1500) {
    L.busyS = true; L.lastSeg = now;
    L.ai.labelGrid(grab(L), L.gw, L.gh).then(({ labels, names }) => {
      if (live !== L) return;
      L.labels = labels; L.names = names;
      skyFrom(L.colors, labels, names, L.gw, L.gh);
      const seen = new Set();
      for (const x of labels) if (x >= 0) { const t = typeFor(names[x]); if (t && !TYPES[t].fixed) seen.add(nice(names[x])); }
      $('found').textContent = seen.size ? `Seeing ${[...seen].slice(0, 6).join(', ')}` : '';
    }).catch(() => {}).finally(() => { L.busyS = false; });
  }
  if (now - L.statT > 1000) {
    $('liveStat').textContent = `Live · ${L.updates} updates a second · ${L.ai.depthDevice === 'webgpu' ? 'fast mode' : 'standard mode'}`;
    L.updates = 0; L.statT = now;
  }
}

function stopLive() {
  if (!live) return;
  if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
  live.video.pause();
  live = null;
  $('livebar').hidden = true;
}

$('live').addEventListener('click', () => startLive().catch(failed));
$('stopLive').addEventListener('click', () => { stopLive(); hideAll(); $('start').hidden = false; $('found').textContent = ''; });
$('flip').addEventListener('click', () => { liveFacing = liveFacing === 'user' ? 'environment' : 'user'; stopLive(); startLive().catch(failed); });
$('freeze').addEventListener('click', () => {
  if (!live || !live.depth) return;
  const L = live;
  const args = [L.colors.slice(), L.depth.slice(), L.labels.slice(), L.names.slice(), L.gw, L.gh];
  stopLive();
  buildWorld(...args);
  $('tools').hidden = false;
  rising = true; riseStart = performance.now();
  thud();
});

// ---------- loop ----------

let rising = false, riseStart = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (live) liveTick(now);
  if (world && rising) {
    const t = Math.max(0, (performance.now() - riseStart) / 1600);
    writeAll(Math.min(1, t));
    if (t >= 1) rising = false;
  }
  // When nobody touches it, it sways gently so you can see it's 3D.
  if ((world || live) && orbit.idle >= 0) { orbit.idle += dt; orbit.yaw = Math.sin(orbit.idle * 0.35) * 0.5; placeCamera(); }
  renderer.render(scene, camera);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
placeCamera();
requestAnimationFrame(frame);

// ---------- sound ----------

let ac = null, soundOn = true;
try { soundOn = localStorage.getItem('block-world-sound') !== 'off'; } catch {}
$('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
function startSound() { if (!ac && soundOn) try { ac = new AudioContext(); } catch {} }
function tone(f, len, type = 'square', vol = 0.05) {
  if (!ac || !soundOn) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len);
}
const blip = (f) => tone(f, 0.12);
function crunch() { tone(180, 0.15, 'sawtooth', 0.06); tone(120, 0.2, 'square', 0.04); }
function thud() { for (let i = 0; i < 6; i++) setTimeout(() => tone(90 + Math.random() * 40, 0.18, 'triangle', 0.08), i * 220); }
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
  try { localStorage.setItem('block-world-sound', soundOn ? 'on' : 'off'); } catch {}
  startSound();
});

if (new URLSearchParams(location.search).has('sample')) $('sample').click();
if (location.search.includes('test')) window.__bw = { finishRise: () => { rising = false; }, get world() { return world; }, get live() { return live; }, startLive, liveTick, writeAll, renderer, scene, camera, orbit, placeCamera, fitCamera, pool };
