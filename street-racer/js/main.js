// Street Racer: fetch the real roads and buildings around a place (OpenStreetMap data, served as map
// tiles by OpenFreeMap), turn them into a small 3D town, and drive a toy car through it past five
// checkpoints. No AI and no keys at runtime.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { decodeTile } from './mvt.js';

const $ = (id) => document.getElementById(id);
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
const START = { lat: 28.6315, lon: 77.2167, name: 'Connaught Place, New Delhi' };
const ROAD_R = 650;      // metres of road around the place
const BUILD_R = 450;     // metres of buildings around the place
const WIDTH = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, minor: 7, service: 5 };

// ---------- scene ----------

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe6f2);
scene.fog = new THREE.Fog(0xcfe6f2, 180, 520);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1500);

scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x7c8a5a, 1.35));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
sun.position.set(120, 220, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 600 });
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0xa9c58a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let world = new THREE.Group();
scene.add(world);

// ---------- the car ----------

function makeCar() {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4), new THREE.MeshLambertMaterial({ color: 0xffd23f }));
  body.position.y = 0.65;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2), new THREE.MeshLambertMaterial({ color: 0x353a44 }));
  cab.position.set(0, 1.25, -0.2);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14).rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.38, z);
    car.add(w);
  }
  const lights = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
  lights.position.set(0, 0.75, -2.02);
  car.add(body, cab, lights);
  car.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return car;
}
const car = makeCar();
scene.add(car);

// ---------- map data ----------

let origin = START;
const toXZ = (lat, lon) => ({
  x: (lon - origin.lon) * Math.cos(origin.lat * Math.PI / 180) * 111320,
  z: -(lat - origin.lat) * 110540,
});

let tileUrl = null;
async function getTile(x, y) {
  if (!tileUrl) tileUrl = (await (await fetch(TILEJSON)).json()).tiles[0];
  const res = await fetch(tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
  if (!res.ok) throw new Error(`map tiles said ${res.status}`);
  return { x, y, layers: decodeTile(await res.arrayBuffer(), ['transportation', 'transportation_name', 'building']) };
}
const lonToTile = (lon) => (lon + 180) / 360 * 2 ** Z;
const latToTile = (lat) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z;
const tileToLon = (t) => t / 2 ** Z * 360 - 180;
const tileToLat = (t) => { const n = Math.PI - 2 * Math.PI * t / 2 ** Z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

async function geocode(text) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('search failed');
    const [hit] = await res.json();
    if (hit) return { lat: +hit.lat, lon: +hit.lon, name: hit.display_name.split(',').slice(0, 3).join(',') };
  } catch {}
  // Second search service, in case the first is busy.
  const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(text)}`);
  if (!res.ok) throw new Error('search failed');
  const f = (await res.json()).features?.[0];
  if (!f) throw new Error('not found');
  const pr = f.properties;
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: [pr.name, pr.city || pr.county, pr.country].filter(Boolean).join(', ') };
}

// Road segments for lookups: which street am I on, and am I on a road at all.
let segs = [];
const GRID = 25;
let grid = new Map();
let names = [], nameGrid = new Map();
const cellKey = (x, z) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;

function indexSegment(i, list = segs, into = grid) {
  const s = list[i];
  const steps = Math.max(1, Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / (GRID / 2)));
  const seen = new Set();
  for (let k = 0; k <= steps; k++) {
    const x = s.ax + (s.bx - s.ax) * k / steps, z = s.az + (s.bz - s.az) * k / steps;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const key = cellKey(x + dx * GRID, z + dz * GRID);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!into.has(key)) into.set(key, []);
      into.get(key).push(i);
    }
  }
}

function streetName(x, z) {
  let best = null, bestD = 18;
  for (const i of nameGrid.get(cellKey(x, z)) || []) {
    const s = names[i];
    const vx = s.bx - s.ax, vz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(x - (s.ax + vx * t), z - (s.az + vz * t));
    if (d < bestD) { bestD = d; best = s.name; }
  }
  return best;
}

function nearestRoad(x, z) {
  let best = null, bestD = Infinity, bx = x, bz = z;
  for (const i of grid.get(cellKey(x, z)) || []) {
    const s = segs[i];
    const vx = s.bx - s.ax, vz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz || 1)));
    const px = s.ax + vx * t, pz = s.az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) { bestD = d; best = s; bx = px; bz = pz; }
  }
  return { seg: best, dist: bestD, px: bx, pz: bz };
}

function ribbon(points, width) {
  // A flat strip along a polyline, with mitred joins, lying just above the ground.
  const pos = [], idx = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    pos.push(p.x - dz * width / 2, 0, p.z + dx * width / 2, p.x + dz * width / 2, 0, p.z - dx * width / 2);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildingGeo(points, height) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

async function loadPlace(place) {
  showLoading(`Fetching the streets around ${place.name}…`);
  origin = place;
  // Fetch the 2 x 2 tiles nearest the place (each z14 tile is about 2 km across), in parallel.
  const tx = lonToTile(place.lon), ty = latToTile(place.lat);
  const x0 = Math.round(tx) - 1, y0 = Math.round(ty) - 1;
  const tiles = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => getTile(x0 + dx, y0 + dy)));
  const toWorld = (t, ext, [px, py]) => toXZ(tileToLat(t.y + py / ext), tileToLon(t.x + px / ext));
  const near = (pts, r) => pts.some((p) => Math.hypot(p.x, p.z) < r);
  const roads = [], builds = [], nameLines = [];
  for (const t of tiles) {
    const tr = t.layers.transportation, tn = t.layers.transportation_name, bl = t.layers.building;
    for (const f of tr?.features || []) {
      if (!WIDTH[f.tags.class] || f.type !== 2) continue;
      for (const line of f.geometry) {
        const pts = line.map((p) => toWorld(t, tr.extent, p));
        if (pts.length > 1 && near(pts, ROAD_R)) roads.push({ pts, w: WIDTH[f.tags.class] });
      }
    }
    for (const f of tn?.features || []) {
      if (!f.tags.name) continue;
      for (const line of f.geometry) nameLines.push({ pts: line.map((p) => toWorld(t, tn.extent, p)), name: String(f.tags.name).split(';')[0] });
    }
    for (const f of bl?.features || []) {
      if (f.type !== 3 || !f.geometry[0] || f.geometry[0].length < 4) continue;
      const pts = f.geometry[0].map((p) => toWorld(t, bl.extent, p));
      if (near(pts, BUILD_R)) builds.push({ pts, h: f.tags.render_height });
    }
  }
  if (roads.length < 5) throw new Error('Not enough roads here. Try a busier area.');

  scene.remove(world);
  world.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
  world = new THREE.Group();
  segs = []; grid = new Map(); names = []; nameGrid = new Map();
  for (const n of nameLines) for (let i = 0; i < n.pts.length - 1; i++) {
    names.push({ ax: n.pts[i].x, az: n.pts[i].z, bx: n.pts[i + 1].x, bz: n.pts[i + 1].z, name: n.name });
    indexSegment(names.length - 1, names, nameGrid);
  }

  const majorG = [], minorG = [], lineG = [];
  for (const r of roads) {
    const { pts, w } = r;
    (w >= 9 ? majorG : minorG).push(ribbon(pts, w));
    if (w >= 9) lineG.push(ribbon(pts, 0.25));
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, w });
      indexSegment(segs.length - 1);
    }
  }
  const road = (geos, color, y) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color }));
    m.position.y = y;
    m.receiveShadow = true;
    world.add(m);
  };
  road(minorG, 0x5a5f69, 0.03);
  road(majorG, 0x40444d, 0.05);
  road(lineG, 0xf2e6b0, 0.07);

  const palettes = [0xf1e3cf, 0xe6d6c3, 0xd9dfe6, 0xf3efe6, 0xe9d1c2];
  const byColor = palettes.map(() => []);
  builds.slice(0, 2500).forEach((b, i) => {
    const pts = b.pts;
    if (pts.length > 2 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].z - pts.at(-1).z) < 0.01) pts.pop();
    try { byColor[i % palettes.length].push(buildingGeo(pts, b.h > 0 ? Math.min(b.h, 120) : 7 + (i % 9))); } catch {}
  });
  byColor.forEach((geos, i) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: palettes[i] }));
    m.castShadow = true; m.receiveShadow = true;
    world.add(m);
  });

  placeCheckpoints();
  scene.add(world);
  resetCar();
  hideLoading();
}

// ---------- checkpoints ----------

let cps = [], cpNext = 0, raceStart = 0, racing = false, finished = false;
const ringGeo = new THREE.TorusGeometry(4.5, 0.45, 10, 36);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
const ringDone = new THREE.MeshBasicMaterial({ color: 0x8fd18a, transparent: true, opacity: 0.45 });

function placeCheckpoints() {
  // Five points on real roads, 90 to 420 m from the start, spread out, then ordered as a loop.
  const picks = [];
  const pool = segs.filter((s) => s.w >= 6).map((s) => ({ x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2, s }));
  let tries = 0;
  while (picks.length < 5 && tries++ < 4000) {
    const p = pool[(Math.random() * pool.length) | 0];
    const d = Math.hypot(p.x, p.z);
    if (d < 90 || d > 420) continue;
    if (picks.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 110)) continue;
    picks.push(p);
  }
  picks.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  cps = picks.map((p) => {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(p.x, 4.6, p.z);
    ring.rotation.y = Math.atan2(p.s.bx - p.s.ax, p.s.bz - p.s.az);
    world.add(ring);
    return { x: p.x, z: p.z, ring };
  });
  cpNext = 0;
}

// ---------- driving ----------

const keys = { up: false, down: false, left: false, right: false };
const state = { x: 0, z: 0, yaw: 0, speed: 0 };

function resetCar() {
  // Start on the road nearest the centre, facing along it.
  // Prefer the nearest main road within 250 m of the centre, so the race doesn't start in a lane.
  let seg = null, bestD = 250;
  for (const s of segs) {
    if (s.w < 9) continue;
    const d = Math.hypot((s.ax + s.bx) / 2, (s.az + s.bz) / 2);
    if (d < bestD) { bestD = d; seg = s; }
  }
  if (!seg) seg = nearestRoad(0, 0).seg;
  if (seg) {
    const t = 0.5;
    state.x = seg.ax + (seg.bx - seg.ax) * t;
    state.z = seg.az + (seg.bz - seg.az) * t;
    state.yaw = Math.atan2(-(seg.bx - seg.ax), -(seg.bz - seg.az));
  } else { state.x = 0; state.z = 0; state.yaw = 0; }
  state.speed = 0;
  camPos.set(state.x + Math.sin(state.yaw) * 13, 6.5, state.z + Math.cos(state.yaw) * 13);
  racing = false; finished = false;
  cps.forEach((c) => (c.ring.material = ringMat));
  cpNext = 0;
  $('done').hidden = true;
  updateHud(0);
}

const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); startSound(); }
  if (e.code === 'KeyR') resetCar();
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
for (const b of document.querySelectorAll('.pad')) {
  const k = b.dataset.key;
  const on = (e) => { e.preventDefault(); keys[k] = true; b.classList.add('on'); startSound(); };
  const off = () => { keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
}

function step(dt) {
  const onRoad = nearestRoad(state.x, state.z);
  const road = onRoad.seg && onRoad.dist < onRoad.seg.w / 2 + 1.5;
  const top = road ? 26 : 7;                // m/s: about 94 km/h on a road, crawling off it
  if (keys.up) state.speed += 14 * dt;
  if (keys.down) state.speed -= (state.speed > 0 ? 26 : 8) * dt;
  if (!keys.up && !keys.down) state.speed *= Math.pow(0.55, dt);
  if (state.speed > top) state.speed = road ? top : state.speed + (top - state.speed) * Math.min(1, 3 * dt);
  state.speed = Math.max(-8, state.speed);
  const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  const grip = Math.min(1, Math.abs(state.speed) / 6);
  state.yaw += steer * 1.9 * grip * dt * Math.sign(state.speed || 1);
  state.x -= Math.sin(state.yaw) * state.speed * dt;
  state.z -= Math.cos(state.yaw) * state.speed * dt;

  // The road edges are walls: if the car drifts past the edge, put it back on the road and scrub speed.
  const after = nearestRoad(state.x, state.z);
  if (after.seg) {
    const limit = Math.max(1, after.seg.w / 2 - 1.1);
    if (after.dist > limit) {
      const k = limit / after.dist;
      state.x = after.px + (state.x - after.px) * k;
      state.z = after.pz + (state.z - after.pz) * k;
      state.speed *= Math.pow(0.35, dt * 4);
    }
  }

  if (!racing && !finished && Math.abs(state.speed) > 1) { racing = true; raceStart = performance.now(); }
  const cp = cps[cpNext];
  if (racing && cp && Math.hypot(cp.x - state.x, cp.z - state.z) < 7) {
    cp.ring.material = ringDone;
    chime();
    cpNext++;
    if (cpNext >= cps.length) finish();
  }
  return onRoad;
}

function finish() {
  racing = false; finished = true;
  const t = (performance.now() - raceStart) / 1000;
  $('doneTime').textContent = fmt(t);
  $('donePlace').textContent = `${cps.length} checkpoints around ${origin.name}`;
  $('done').hidden = false;
  $('done').dataset.time = fmt(t);
}

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function updateHud(now, road) {
  $('speed').textContent = Math.round(Math.abs(state.speed) * 3.6);
  $('cps').textContent = `${Math.min(cpNext, cps.length)}/${cps.length}`;
  $('time').textContent = racing ? fmt((now - raceStart) / 1000) : finished ? $('done').dataset.time : '0:00.0';
  const name = road?.seg && road.dist < road.seg.w / 2 + 6 ? (streetName(state.x, state.z) || 'Unnamed road') : 'Off road';
  if ($('street').textContent !== name) $('street').textContent = name;
  const cp = cps[cpNext];
  const arrow = $('arrow');
  if (cp && !finished) {
    const ang = Math.atan2(-(cp.x - state.x), -(cp.z - state.z)) - state.yaw;
    arrow.style.transform = `rotate(${-ang}rad)`;
    arrow.style.opacity = 1;
  } else arrow.style.opacity = 0;
}

// ---------- sound: a soft engine hum and a checkpoint chime, on by default after the first input ----------

let ac = null, engine = null, engineGain = null, soundOn = true;
try { soundOn = localStorage.getItem('street-racer-sound') !== 'off'; } catch {}
$('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
function startSound() {
  if (ac || !soundOn) return;
  ac = new AudioContext();
  engine = ac.createOscillator();
  engine.type = 'sawtooth';
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 600;
  engineGain = ac.createGain(); engineGain.gain.value = 0;
  engine.connect(filter).connect(engineGain).connect(ac.destination);
  engine.start();
}
function chime() {
  if (!ac || !soundOn) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = 880; o.type = 'sine';
  g.gain.setValueAtTime(0.18, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.5);
}
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
  try { localStorage.setItem('street-racer-sound', soundOn ? 'on' : 'off'); } catch {}
  if (!soundOn && engineGain) engineGain.gain.value = 0;
  if (soundOn) startSound();
});

// ---------- loop ----------

const camPos = new THREE.Vector3(0, 30, 30);
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const road = segs.length ? step(dt) : null;
  car.position.set(state.x, 0, state.z);
  car.rotation.y = state.yaw;

  const back = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  const want = new THREE.Vector3(state.x, 0, state.z).addScaledVector(back, 13).add(new THREE.Vector3(0, 6.5, 0));
  camPos.lerp(want, Math.min(1, 4 * dt));
  camera.position.copy(camPos);
  camera.lookAt(state.x, 1.5, state.z);
  sun.position.set(state.x + 120, 220, state.z + 80);
  sun.target.position.set(state.x, 0, state.z);
  for (const c of cps) c.ring.rotation.z += dt * 0.6;

  if (engineGain && soundOn) {
    engine.frequency.setTargetAtTime(55 + Math.abs(state.speed) * 4, ac.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(0.025 + Math.min(0.05, Math.abs(state.speed) / 500), ac.currentTime, 0.1);
  }
  updateHud(now, road);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// ---------- UI ----------

function showLoading(text) { $('loadText').textContent = text; $('loading').hidden = false; }
function hideLoading() { $('loading').hidden = true; }
function fail(err) {
  showLoading(err.message === 'not found' ? 'Couldn\'t find that place. Try a nearby landmark or area name.' : `Couldn't load the streets (${err.message}). Try again in a moment.`);
  setTimeout(hideLoading, 3500);
}

$('where').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('place').value.trim();
  if (!text) return;
  $('place').blur();
  try { await loadPlace(await geocode(text)); } catch (err) { fail(err); }
});
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return fail(new Error('location not available'));
  showLoading('Finding where you are…');
  navigator.geolocation.getCurrentPosition(
    (p) => loadPlace({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'your street' }).catch(fail),
    () => fail(new Error('location permission was declined')),
    { enableHighAccuracy: false, timeout: 10000 },
  );
});
$('again').addEventListener('click', resetCar);
$('copy').addEventListener('click', async () => {
  const text = `I raced the real streets of ${origin.name} in ${$('done').dataset.time}. Your street: ${location.origin}${location.pathname}`;
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Copied'; } catch { $('copy').textContent = 'Couldn\'t copy'; }
  setTimeout(() => ($('copy').textContent = 'Copy my time'), 1800);
});

if (location.search.includes('test')) window.__sr = { step, state, keys, cps: () => ({ next: cpNext, list: cps }), nearestRoad, streetName };
loadPlace(START).catch(fail);
