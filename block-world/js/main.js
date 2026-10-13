// Block World: turn one photo into a world of blocks. Two on-device AIs say how far away
// every part of the photo is and what it is; here each patch becomes blocks at that depth, with a
// block texture that fits (walls plaster, floor planks, plants leaves, windows glass). Every object
// (sofa, chair, lamp, each plant) is its own group you can pick up and move. Nothing is uploaded.

import * as THREE from 'three';
import { TYPES, typeFor, materialFor, blockColor } from './blocks.js';

const $ = (id) => document.getElementById(id);
const ZR = 56;                 // how many blocks deep the scene is, from nearest to farthest
const NICE = { 'television receiver': 'TV', windowpane: 'window', 'chest of drawers': 'drawers', 'coffee table': 'coffee table', 'crt screen': 'screen', person: 'you' };
const nice = (n) => NICE[n] || n;

// ---------- three.js ----------

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3f5);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
sunLight.position.set(40, 80, 60);
scene.add(sunLight);

let world = null;            // { meshes: {type: InstancedMesh}, blocks: [], groups: [], gw, gh }
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

// ---------- camera orbit ----------

const orbit = { yaw: 0, pitch: 0.05, dist: 120, target: new THREE.Vector3(), idle: 0 };
function placeCamera() {
  const { yaw, pitch, dist, target } = orbit;
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
}

// ---------- building the world ----------

function buildWorld(colors, depth, labels, names, gw, gh) {
  if (world) for (const m of Object.values(world.meshes)) { scene.remove(m); m.geometry.dispose(); }

  // Normalise depth to 0 (far) .. 1 (near).
  let lo = 1, hi = 0;
  for (const d of depth) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  const zOf = (i) => Math.round((1 - (depth[i] - lo) / ((hi - lo) || 1)) * ZR);

  const cellType = new Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) cellType[i] = labels[i] < 0 ? 'plain' : typeFor(names[labels[i]]);

  // Sky colour becomes the background.
  let sky = [0, 0, 0], skyN = 0;
  for (let i = 0; i < gw * gh; i++) if (cellType[i] === null) { sky[0] += colors[i * 3]; sky[1] += colors[i * 3 + 1]; sky[2] += colors[i * 3 + 2]; skyN++; }
  scene.background = skyN > 20 ? new THREE.Color(sky[0] / skyN / 255, sky[1] / skyN / 255, sky[2] / skyN / 255) : new THREE.Color(0x9fd3f5);

  // Objects: connected patches of the same label that aren't walls, floors or ground.
  const group = new Int32Array(gw * gh);
  const groups = [{ name: 'room', offset: new THREE.Vector3(), blocks: [] }];
  for (let i = 0; i < gw * gh; i++) {
    if (group[i] || !cellType[i] || TYPES[cellType[i]].fixed || labels[i] < 0) continue;
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
    const id = cells.length >= 8 ? groups.length : 0;
    if (id) groups.push({ name: nice(names[labels[i]]), offset: new THREE.Vector3(), blocks: [] });
    for (const k of cells) group[k] = id;
  }

  // Blocks: one at each cell's depth, then filled backwards toward its neighbours so there are no
  // holes when you turn the world, and objects get some thickness.
  const blocks = [];
  const occupied = new Set();
  const cx = gw / 2, cy = gh / 2, cz = ZR / 2;
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const i = r * gw + c, type = cellType[i];
    if (!type) continue;
    const z = zOf(i);
    let back = z;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= gh || cc >= gw || !cellType[rr * gw + cc]) continue;
      back = Math.max(back, zOf(rr * gw + cc));
    }
    const fixed = TYPES[type].fixed;
    back = Math.min(back, z + (fixed ? 3 : 8));
    if (!fixed) back = Math.max(back, z + 1);
    const rgb = [colors[i * 3] / 255, colors[i * 3 + 1] / 255, colors[i * 3 + 2] / 255];
    const col = blockColor(type, rgb);
    for (let zz = z; zz <= back; zz++) {
      const x = c - cx, y = gh - 1 - r - cy, zw = cz - zz;
      const key = `${x},${y},${zw}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      // Blocks behind the front face get a little darker, like real shade.
      const shade = zz === z ? 1 : 0.82;
      const b = { type, x, y, z: zw, color: col.map((v) => v * shade), group: group[i], row: r, gone: false };
      blocks.push(b);
      groups[b.group].blocks.push(b);
    }
  }

  // One instanced mesh per block type, with room to place new blocks.
  const meshes = {};
  const byType = {};
  for (const b of blocks) (byType[b.type] ||= []).push(b);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const type of Object.keys(TYPES)) {
    const list = byType[type] || [];
    const mesh = new THREE.InstancedMesh(geo, materialFor(type), list.length + 3000);
    mesh.count = list.length;
    mesh.userData = { type, list };
    list.forEach((b, k) => {
      b.mesh = mesh; b.k = k;
      mesh.setColorAt(k, tmpColor.setRGB(b.color[0], b.color[1], b.color[2], THREE.SRGBColorSpace));
    });
    if (!list.length) mesh.setColorAt(0, tmpColor.set(1, 1, 1));
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes[type] = mesh;
  }
  world = { meshes, blocks, groups, gw, gh, built: performance.now(), occupied };
  writeAll(1);

  // Start in front, as the photo was taken, a little further back so everything fits.
  const fov = camera.fov * Math.PI / 180;
  orbit.target.set(0, 0, 0);
  orbit.dist = Math.max(gh / 2 / Math.tan(fov / 2), gw / 2 / Math.tan(fov / 2) / camera.aspect) + cz + 6;
  orbit.yaw = 0; orbit.pitch = 0.05; orbit.idle = 0;
  placeCamera();

  // What we found.
  const found = [...new Set(groups.slice(1).map((g) => g.name))];
  $('found').textContent = found.length ? `Found ${found.slice(0, 8).join(', ')}${found.length > 8 ? '…' : ''}` : '';
  $('count').textContent = `${blocks.length.toLocaleString()} blocks · ${groups.length - 1} objects`;
  return world;
}

// Write every block's matrix. `rise` (0..1) animates the build: rows fall into place top to bottom.
function writeAll(rise) {
  for (const mesh of Object.values(world.meshes)) {
    for (const b of mesh.userData.list) writeBlock(b, rise);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
function writeBlock(b, rise = 1) {
  const off = world.groups[b.group].offset;
  let y = b.y + off.y;
  if (rise < 1) {
    const delay = (b.row / world.gh) * 0.6;
    const t = Math.min(1, Math.max(0, (rise - delay) / 0.4));
    y += (1 - t * t * (3 - 2 * t)) * 60;
  }
  dummy.position.set(b.x + off.x, y, b.z + off.z);
  dummy.scale.setScalar(b.gone ? 0 : 1);
  dummy.updateMatrix();
  b.mesh.setMatrixAt(b.k, dummy.matrix);
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
function hit(e) {
  if (!world) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(Object.values(world.meshes).filter((m) => m.count), false);
  for (const h of hits) {
    const b = h.object.userData.list[h.instanceId];
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
    const h = hit(e);
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
    orbit.dist = Math.min(400, Math.max(15, dist0 * pinch0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
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
      for (const m of Object.values(world.meshes)) m.instanceMatrix.needsUpdate = true;
    }
    return;
  }
  orbit.yaw -= dx * 0.006;
  orbit.pitch = Math.min(1.3, Math.max(-0.6, orbit.pitch + dy * 0.005));
  placeCamera();
});
canvas.addEventListener('pointerup', (e) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (drag) { drag = null; setTimeout(() => ($('picked').textContent = ''), 1200); return; }
  if (!p) return;
  const tap = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8 && performance.now() - p.t < 400;
  if (!tap) return;
  const h = hit(e);
  if (!h) return;
  if (tool === 'break') { h.b.gone = true; writeBlock(h.b); h.b.mesh.instanceMatrix.needsUpdate = true; crunch(); }
  else if (tool === 'place') placeBlock(h);
  else if (h.b.group > 0) { $('picked').textContent = `That's the ${world.groups[h.b.group].name}`; setTimeout(() => ($('picked').textContent = ''), 1500); }
});
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(400, Math.max(15, orbit.dist * (1 + e.deltaY * 0.001))); orbit.idle = -1e9; placeCamera(); }, { passive: false });

let placeType = 'planks';
$('blockType').addEventListener('change', (e) => (placeType = e.target.value));
function placeBlock({ b, h }) {
  const n = h.face.normal;
  const off = world.groups[b.group].offset;
  const x = b.x + off.x + Math.round(n.x), y = b.y + off.y + Math.round(n.y), z = b.z + off.z + Math.round(n.z);
  const mesh = world.meshes[placeType];
  if (mesh.count >= mesh.instanceMatrix.count) return;
  const nb = { type: placeType, x, y, z, color: TYPES[placeType].tint.slice(), group: 0, row: 0, gone: false, mesh, k: mesh.count };
  mesh.userData.list.push(nb);
  world.groups[0].blocks.push(nb);
  mesh.count++;
  mesh.setColorAt(nb.k, tmpColor.setRGB(nb.color[0], nb.color[1], nb.color[2], THREE.SRGBColorSpace));
  mesh.instanceColor.needsUpdate = true;
  writeBlock(nb);
  mesh.instanceMatrix.needsUpdate = true;
  blip(660);
}

// ---------- photo in, world out ----------

async function fromImage(source) {
  showBusy('Reading your photo…');
  const bmp = await createImageBitmap(source);
  const landscape = bmp.width >= bmp.height;
  const gw = landscape ? 128 : 96, gh = Math.round(gw * bmp.height / bmp.width);
  // A smaller copy for the AI (faster), and the block colours from a gw x gh copy.
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
          hideBusy();
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
function hideBusy() { $('busy').hidden = true; $('tools').hidden = false; }
function failed(err) {
  $('busy').hidden = true; $('start').hidden = false;
  $('status').textContent = `That didn't work (${err.message}). Try another photo, or the sample room.`;
}

$('photo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { startSound(); fromImage(f).catch(failed); } e.target.value = ''; });
$('sample').addEventListener('click', async () => {
  startSound();
  try { const res = await fetch(new URL('../assets/sample-room.jpg', import.meta.url)); fromImage(await res.blob()).catch(failed); } catch (err) { failed(err); }
});
$('again').addEventListener('click', () => { stopLive(); $('tools').hidden = true; $('start').hidden = false; $('status').textContent = ''; });
$('front').addEventListener('click', () => { orbit.yaw = 0; orbit.pitch = 0.05; orbit.idle = 0; placeCamera(); });
$('save').addEventListener('click', () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'my-block-world.png'; a.click();
  }, 'image/png');
});

// ---------- live camera ----------
// Depth runs on every frame the AI can manage; the object AI refreshes every 1.5 s in the background.
// Each cell is drawn as a short stack of 3 blocks, which glide toward the newest depth.

const LGW = 72;
let live = null, liveFacing = 'environment';

function clearWorld() {
  if (world) for (const m of Object.values(world.meshes)) { scene.remove(m); m.geometry.dispose(); }
  world = null;
  $('found').textContent = ''; $('count').textContent = '';
}

function onProgress(data) {
  if (data.type === 'progress') showBusy(`Getting the ${data.what} AI ready… ${Math.round(data.loaded / data.total * 100)}%`);
}

async function startLive(src) {
  startSound();
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
  clearWorld();
  const meshes = {};
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const type of Object.keys(TYPES)) {
    const mesh = new THREE.InstancedMesh(geo, materialFor(type), gw * gh * 3);
    mesh.count = 0;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gw * gh * 3 * 3), 3);
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes[type] = mesh;
  }
  live = {
    ai, video, stream, mirror, gw, gh, meshes,
    colorsCv: new OffscreenCanvas(gw, gh), aiCv: new OffscreenCanvas(256, Math.max(64, Math.round(256 * vh / vw))),
    target: new Float32Array(gw * gh), z: new Float32Array(gw * gh), lastDepth: new Float32Array(gw * gh),
    labels: new Int16Array(gw * gh).fill(-1), names: [], colors: new Uint8Array(gw * gh * 3),
    busyD: false, busyS: false, lastSeg: 0, have: false, updates: 0, statT: performance.now(), lists: null,
  };
  assignLists();
  fitCamera(gw, gh);
  hideBusy();
  $('tools').hidden = true; $('livebar').hidden = false; $('start').hidden = true;
}

function fitCamera(gw, gh) {
  const fov = camera.fov * Math.PI / 180;
  orbit.target.set(0, 0, 0);
  orbit.dist = Math.max(gh / 2 / Math.tan(fov / 2), gw / 2 / Math.tan(fov / 2) / camera.aspect) + ZR / 2 + 6;
  orbit.yaw = 0; orbit.pitch = 0.05; orbit.idle = 0;
  placeCamera();
}

function assignLists() {
  const L = live, lists = {};
  for (const t of Object.keys(TYPES)) lists[t] = [];
  for (let i = 0; i < L.gw * L.gh; i++) {
    const type = L.labels[i] < 0 ? 'plain' : typeFor(L.names[L.labels[i]]);
    if (type) lists[type].push(i);
  }
  L.lists = lists;
  const seen = new Set();
  for (const x of L.labels) {
    if (x < 0) continue;
    const t = typeFor(L.names[x]);
    if (t && !TYPES[t].fixed) seen.add(nice(L.names[x]));
  }
  const objs = [...seen];
  $('found').textContent = objs.length ? `Seeing ${objs.slice(0, 6).join(', ')}` : '';
}

function liveTick(now) {
  const L = live, v = L.video;
  if (v.readyState < 2) return;
  const cg = L.colorsCv.getContext('2d', { willReadFrequently: true });
  cg.drawImage(v, 0, 0, L.gw, L.gh);
  const px = cg.getImageData(0, 0, L.gw, L.gh).data;
  for (let i = 0; i < L.gw * L.gh; i++) { L.colors[i * 3] = px[i * 4]; L.colors[i * 3 + 1] = px[i * 4 + 1]; L.colors[i * 3 + 2] = px[i * 4 + 2]; }

  const grab = () => { const g = L.aiCv.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, L.aiCv.width, L.aiCv.height); return L.ai.fromCanvas(L.aiCv); };
  if (!L.busyD) {
    L.busyD = true;
    L.ai.depthGrid(grab(), L.gw, L.gh, true).then((d) => {
      if (live !== L) return;
      let lo = 1, hi = 0;
      for (const x of d) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      for (let i = 0; i < d.length; i++) { L.lastDepth[i] = d[i]; L.target[i] = (1 - (d[i] - lo) / ((hi - lo) || 1)) * ZR; }
      if (!L.have) { L.z.set(L.target); L.have = true; }
      L.updates++;
    }).catch(() => {}).finally(() => { L.busyD = false; });
  }
  if (L.ai.segReady() && !L.busyS && now - L.lastSeg > 1500) {
    L.busyS = true; L.lastSeg = now;
    L.ai.labelGrid(grab(), L.gw, L.gh).then(({ labels, names }) => {
      if (live !== L) return;
      L.labels = labels; L.names = names; assignLists();
    }).catch(() => {}).finally(() => { L.busyS = false; });
  }
  if (now - L.statT > 1000) {
    $('liveStat').textContent = `Live · ${L.updates} depth updates a second · ${L.ai.depthDevice === 'webgpu' ? 'fast mode' : 'standard mode'}`;
    L.updates = 0; L.statT = now;
  }
  if (!L.have) return;
  for (let i = 0; i < L.z.length; i++) L.z[i] += (L.target[i] - L.z[i]) * 0.35;
  writeLive();
}

function writeLive() {
  const L = live, cx = L.gw / 2, cy = L.gh / 2, cz = ZR / 2;
  for (const [type, cells] of Object.entries(L.lists)) {
    const mesh = L.meshes[type], ma = mesh.instanceMatrix.array, ca = mesh.instanceColor.array;
    const { tint, keep } = TYPES[type];
    let k = 0;
    for (const i of cells) {
      const c = i % L.gw, r = (i - c) / L.gw;
      const x = (L.mirror ? L.gw - 1 - c : c) - cx, y = L.gh - 1 - r - cy, z0 = Math.round(L.z[i]);
      const rgb = [L.colors[i * 3] / 255, L.colors[i * 3 + 1] / 255, L.colors[i * 3 + 2] / 255];
      const base = rgb.map((v, j) => v * keep + tint[j] * (1 - keep) * (0.6 + 0.48 * v));
      for (let d = 0; d < 3; d++) {
        const o = k * 16;
        ma[o] = 1; ma[o + 1] = 0; ma[o + 2] = 0; ma[o + 3] = 0;
        ma[o + 4] = 0; ma[o + 5] = 1; ma[o + 6] = 0; ma[o + 7] = 0;
        ma[o + 8] = 0; ma[o + 9] = 0; ma[o + 10] = 1; ma[o + 11] = 0;
        ma[o + 12] = x; ma[o + 13] = y; ma[o + 14] = cz - (z0 + d); ma[o + 15] = 1;
        const sh = d ? 0.8 : 1;
        // sRGB to linear, roughly, since the renderer works in linear light.
        ca[k * 3] = (base[0] * sh) ** 2.2; ca[k * 3 + 1] = (base[1] * sh) ** 2.2; ca[k * 3 + 2] = (base[2] * sh) ** 2.2;
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}

function stopLive() {
  if (!live) return;
  if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
  live.video.pause();
  for (const m of Object.values(live.meshes)) { scene.remove(m); m.dispose(); }
  live = null;
  $('livebar').hidden = true;
}

$('live').addEventListener('click', () => startLive().catch(failed));
$('stopLive').addEventListener('click', () => { stopLive(); clearWorld(); $('start').hidden = false; });
$('flip').addEventListener('click', () => { liveFacing = liveFacing === 'user' ? 'environment' : 'user'; stopLive(); startLive().catch(failed); });
$('freeze').addEventListener('click', () => {
  if (!live || !live.have) return;
  const L = live;
  // Freeze what the camera sees right now into the full world you can edit.
  let colors = L.colors.slice(), depth = L.lastDepth.slice(), labels = L.labels.slice();
  if (L.mirror) {
    const flip = (arr, ch) => { const out = arr.slice(); for (let r = 0; r < L.gh; r++) for (let c = 0; c < L.gw; c++) for (let j = 0; j < ch; j++) out[(r * L.gw + c) * ch + j] = arr[(r * L.gw + (L.gw - 1 - c)) * ch + j]; return out; };
    colors = flip(colors, 3); depth = flip(depth, 1); labels = flip(labels, 1);
  }
  const names = L.names.slice(), gw = L.gw, gh = L.gh;
  stopLive();
  buildWorld(colors, depth, labels, names, gw, gh);
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
    const t = (now - riseStart) / 1600;
    writeAll(Math.min(1, t));
    if (t >= 1) rising = false;
  }
  // When nobody touches it, it sways gently so you can see it's 3D.
  if ((world || live) && orbit.idle >= 0) { orbit.idle += dt; orbit.yaw = Math.sin(orbit.idle * 0.35) * 0.45; placeCamera(); }
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
if (location.search.includes('test')) window.__bw = { get world() { return world; }, get live() { return live; }, startLive, liveTick, writeAll, renderer, scene, camera, orbit, placeCamera };
