// The arena: painted ground, walls, scenery, cover pieces and the two bases.
import * as THREE from 'three';
import { toon, glowMat, additive, GEO } from './gfx.js';
import { ARENA } from './config.js';
import { mulberry32 } from './sim.js';
import { PAL } from './models.js';

const W = ARENA.halfW, Lh = ARENA.halfL;

function groundTexture(maxAniso) {
  const S = 2048, span = 120, k = S / span;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const X = (x) => (x + span / 2) * k, Z = (z) => (z + span / 2) * k;
  const R = mulberry32(7);
  // outside: meadow on the human side, dark tech floor on the AI side
  const grad = g.createLinearGradient(0, Z(-8), 0, Z(8));
  grad.addColorStop(0, '#2C3A44'); grad.addColorStop(1, '#86AA5B');
  g.fillStyle = '#2C3A44'; g.fillRect(0, 0, S, Z(-8));
  g.fillStyle = grad; g.fillRect(0, Z(-8), S, Z(8) - Z(-8));
  g.fillStyle = '#86AA5B'; g.fillRect(0, Z(8), S, S - Z(8));
  for (let i = 0; i < 900; i++) { // grass patches
    const x = R() * S, y = Z(4) + R() * (S - Z(4));
    g.fillStyle = R() < 0.5 ? 'rgba(70,110,50,0.18)' : 'rgba(170,200,110,0.16)';
    g.beginPath(); g.ellipse(x, y, 10 + R() * 40, 6 + R() * 22, R() * 3, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(23,163,152,0.22)'; g.lineWidth = 2;
  for (let x = -60; x <= 60; x += 3) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), Z(-6)); g.stroke(); }
  for (let z = -60; z <= -6; z += 3) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(S, Z(z)); g.stroke(); }
  // field
  g.fillStyle = '#E4CF9E'; g.fillRect(X(-W), Z(0), X(W) - X(-W), Z(Lh) - Z(0));
  for (let i = 0; i < 1400; i++) { // sand grain + pebbles
    const x = X(-W) + R() * (X(W) - X(-W)), y = Z(0) + R() * (Z(Lh) - Z(0));
    g.fillStyle = R() < 0.6 ? 'rgba(160,120,70,0.06)' : 'rgba(255,250,235,0.12)';
    g.beginPath(); g.ellipse(x, y, 3 + R() * 14, 2 + R() * 8, R() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 260; i++) { // small stones
    const x = X(-W) + R() * (X(W) - X(-W)), y = Z(0) + R() * (Z(Lh) - Z(0));
    g.fillStyle = R() < 0.5 ? 'rgba(120,100,80,0.35)' : 'rgba(150,135,115,0.3)';
    g.beginPath(); g.ellipse(x, y, 2 + R() * 3, 1.5 + R() * 2, R() * 3, 0, 7); g.fill();
  }
  g.fillStyle = '#4C5C69'; g.fillRect(X(-W), Z(-Lh), X(W) - X(-W), Z(0) - Z(-Lh));
  g.strokeStyle = 'rgba(20,30,38,0.55)'; g.lineWidth = 3;
  for (let x = -W; x <= W; x += 4.25) { g.beginPath(); g.moveTo(X(x), Z(-Lh)); g.lineTo(X(x), Z(0)); g.stroke(); }
  for (let z = -Lh; z <= 0; z += 4.25) { g.beginPath(); g.moveTo(X(-W), Z(z)); g.lineTo(X(W), Z(z)); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = -W; x < W; x += 4.25) for (let z = -Lh; z < 0; z += 4.25) if (R() < 0.35) g.fillRect(X(x) + 3, Z(z) + 3, 4.25 * k - 6, 4.25 * k - 6);
  g.strokeStyle = 'rgba(60,240,220,0.35)'; g.lineWidth = 2.5; // circuit traces
  for (let i = 0; i < 26; i++) {
    let x = -W + 1 + R() * (2 * W - 2), z = -Lh + 1 + R() * (Lh - 3);
    g.beginPath(); g.moveTo(X(x), Z(z));
    for (let s = 0; s < 4; s++) { if (R() < 0.5) x += (R() - 0.5) * 8; else z += (R() - 0.5) * 8; x = Math.max(-W + 0.5, Math.min(W - 0.5, x)); z = Math.max(-Lh + 0.5, Math.min(-0.5, z)); g.lineTo(X(x), Z(z)); }
    g.stroke();
    g.fillStyle = 'rgba(90,255,235,0.55)'; g.beginPath(); g.arc(X(x), Z(z), 4, 0, 7); g.fill();
  }
  // lane markings
  g.setLineDash([22, 18]); g.lineWidth = 5;
  for (const x of [-6, 6]) {
    g.strokeStyle = 'rgba(255,255,255,0.32)';
    g.beginPath(); g.moveTo(X(x), Z(-Lh + 9)); g.lineTo(X(x), Z(Lh - 9)); g.stroke();
  }
  g.setLineDash([]);
  // centre line + circle
  g.strokeStyle = 'rgba(255,246,225,0.85)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(X(-W), Z(0)); g.lineTo(X(W), Z(0)); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.arc(X(0), Z(0), 5 * k, 0, 7); g.stroke();
  // base zones
  for (const [z, col] of [[ARENA.baseZ, '232,116,59'], [-ARENA.baseZ, '23,163,152']]) {
    g.fillStyle = `rgba(${col},0.22)`; g.strokeStyle = `rgba(${col},0.9)`; g.lineWidth = 6;
    g.beginPath(); g.arc(X(0), Z(z), 9.5 * k, 0, 7); g.fill(); g.stroke();
  }
  // edge band
  g.strokeStyle = 'rgba(30,25,20,0.45)'; g.lineWidth = 10;
  g.strokeRect(X(-W), Z(-Lh), X(W) - X(-W), Z(Lh) - Z(-Lh));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso; tex.generateMipmaps = true;
  return tex;
}

// helper: instanced copies of one geometry
function scatter(scene, geo, mat, list, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
    im.setMatrixAt(i, m);
    if (it.c !== undefined) im.setColorAt(i, new THREE.Color(it.c));
  });
  im.castShadow = shadow; im.receiveShadow = true;
  scene.add(im);
  return im;
}

function buildScenery(scene) {
  const R = mulberry32(11);
  const trees = [], leaves = [], leaves2 = [], bushes = [], rocks = [], pylons = [], strips = [], crystals = [];
  for (let i = 0; i < 140; i++) {
    let x = (R() < 0.5 ? -1 : 1) * (W + 3 + R() * 34), z = 3 + R() * 52;
    if (R() < 0.25) { x = (R() - 0.5) * 70; z = Lh + 3 + R() * 22; }
    const s = 0.8 + R() * 0.8;
    if (R() < 0.6) {
      trees.push({ x, y: 1 * s, z, sx: 0.35 * s, sy: 2 * s, sz: 0.35 * s });
      leaves.push({ x, y: 2.8 * s, z, sx: 2.4 * s, sy: 2.6 * s, sz: 2.4 * s, ry: R() * 3, c: R() < 0.5 ? 0x5E9A4A : 0x4F8A3F });
      leaves2.push({ x, y: 4.1 * s, z, sx: 1.7 * s, sy: 2 * s, sz: 1.7 * s, ry: R() * 3, c: R() < 0.5 ? 0x6FAE55 : 0x5E9A4A });
    } else if (R() < 0.6) bushes.push({ x, y: 0.4 * s, z, sx: 1.6 * s, sy: 1.1 * s, sz: 1.4 * s, c: R() < 0.5 ? 0x6BA34F : 0x7FB85C });
    else rocks.push({ x, y: 0.3 * s, z, sx: 1.6 * s, sy: 1 * s, sz: 1.3 * s, ry: R() * 3, c: 0x9C9282 });
  }
  for (let i = 0; i < 90; i++) {
    let x = (R() < 0.5 ? -1 : 1) * (W + 3 + R() * 34), z = -3 - R() * 52;
    if (R() < 0.25) { x = (R() - 0.5) * 70; z = -Lh - 3 - R() * 22; }
    const h = 2 + R() * 7;
    if (R() < 0.65) {
      pylons.push({ x, y: h / 2, z, sx: 1.6, sy: h, sz: 1.6, c: R() < 0.5 ? 0x26323B : 0x1E2830 });
      for (let k = 0; k < 3; k++) if (R() < 0.8) strips.push({ x: x + 0.81, y: 0.5 + R() * (h - 0.8), z, sx: 0.04, sy: 0.12, sz: 1.2, c: R() < 0.8 ? 0x5FFFE8 : 0xFFB070 });
    } else crystals.push({ x, y: 0.8, z, sx: 1 + R(), sy: 2 + R() * 2, sz: 1 + R(), ry: R() * 3, rz: (R() - 0.5) * 0.5, c: R() < 0.5 ? 0x17A398 : 0x2BC4B5 });
  }
  scatter(scene, GEO.cyl, toon(0x7A5131), trees);
  scatter(scene, GEO.cone, toon(0xffffff, 0.2), leaves);
  scatter(scene, GEO.cone, toon(0xffffff, 0.2), leaves2);
  scatter(scene, GEO.sphere, toon(0xffffff, 0.2), bushes);
  scatter(scene, GEO.dodec, toon(0xffffff, 0.15), rocks);
  scatter(scene, GEO.box, toon(0xffffff, 0.25), pylons);
  scatter(scene, GEO.box, glowMat(0xffffff), strips, false);
  scatter(scene, GEO.octa, toon(0xffffff, 0.6), crystals);

  // arena walls: wooden palisade on the human half, metal barrier on the AI half
  const posts = [], rails = [], barriers = [], glows = [];
  for (const sx of [-1, 1]) {
    for (let z = 1; z <= Lh; z += 1.6) posts.push({ x: sx * (W + 0.45), y: 0.55, z, sx: 0.32, sy: 1.1 + (Math.round(z * 3) % 3) * 0.12, sz: 0.32, c: 0x9B6A3A });
    rails.push({ x: sx * (W + 0.45), y: 0.75, z: Lh / 2, sx: 0.16, sy: 0.14, sz: Lh, c: 0x7A5131 });
    barriers.push({ x: sx * (W + 0.45), y: 0.5, z: -Lh / 2, sx: 0.45, sy: 1.0, sz: Lh, c: 0x3A4650 });
    glows.push({ x: sx * (W + 0.45) - sx * 0.24, y: 0.7, z: -Lh / 2, sx: 0.04, sy: 0.08, sz: Lh, c: 0x5FFFE8 });
  }
  for (let x = -W; x <= W; x += 1.6) posts.push({ x, y: 0.55, z: Lh + 0.45, sx: 0.32, sy: 1.1, sz: 0.32, c: 0x9B6A3A });
  rails.push({ x: 0, y: 0.75, z: Lh + 0.45, sx: 2 * W, sy: 0.14, sz: 0.16, c: 0x7A5131 });
  barriers.push({ x: 0, y: 0.5, z: -Lh - 0.45, sx: 2 * W + 1.4, sy: 1, sz: 0.45, c: 0x3A4650 });
  glows.push({ x: 0, y: 0.7, z: -Lh - 0.2, sx: 2 * W, sy: 0.08, sz: 0.04, c: 0x5FFFE8 });
  scatter(scene, GEO.cyl, toon(0xffffff, 0.2), posts);
  scatter(scene, GEO.box, toon(0xffffff, 0.2), rails);
  scatter(scene, GEO.box, toon(0xffffff, 0.3), barriers);
  scatter(scene, GEO.box, glowMat(0xffffff), glows, false);
}

function buildCover(scene, cover) {
  const R = mulberry32(5);
  const rocks = [], crates = [], bands = [], cryst = [], boxes = [], strips = [];
  for (const c of cover) {
    const human = c.z > 0;
    if (c.k === 'rock') {
      if (human) {
        rocks.push({ x: c.x, y: c.r * 0.45, z: c.z, sx: c.r * 2.1, sy: c.r * 1.5, sz: c.r * 1.9, ry: R() * 3, c: 0xA59A88 });
        rocks.push({ x: c.x + c.r * 0.8, y: 0.25, z: c.z - c.r * 0.6, sx: 0.8, sy: 0.6, sz: 0.7, ry: R() * 3, c: 0x8E8473 });
      } else {
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + R();
          cryst.push({ x: c.x + Math.cos(a) * c.r * 0.45, y: c.r * 0.7, z: c.z + Math.sin(a) * c.r * 0.45, sx: c.r * 0.9, sy: c.r * (1.6 + R()), sz: c.r * 0.9, ry: R() * 3, rx: Math.cos(a) * 0.3, rz: Math.sin(a) * 0.3, c: i === 0 ? 0x2BC4B5 : 0x17A398 });
        }
      }
    } else {
      const s = c.r * 1.55;
      if (human) {
        crates.push({ x: c.x, y: s / 2, z: c.z, sx: s, sy: s, sz: s, ry: 0.3, c: 0xB98446 });
        bands.push({ x: c.x, y: s / 2, z: c.z, sx: s * 1.02, sy: s * 0.16, sz: s * 1.02, ry: 0.3, c: 0x6E4A26 });
        bands.push({ x: c.x, y: s / 2, z: c.z, sx: s * 0.16, sy: s * 1.02, sz: s * 1.02, ry: 0.3, c: 0x6E4A26 });
      } else {
        boxes.push({ x: c.x, y: s / 2, z: c.z, sx: s, sy: s, sz: s, ry: -0.3, c: 0x2F3B45 });
        strips.push({ x: c.x, y: s * 0.75, z: c.z, sx: s * 1.03, sy: 0.1, sz: s * 1.03, ry: -0.3, c: 0x5FFFE8 });
      }
    }
  }
  scatter(scene, GEO.dodec, toon(0xffffff, 0.2), rocks);
  scatter(scene, GEO.box, toon(0xffffff, 0.25), crates);
  scatter(scene, GEO.box, toon(0xffffff, 0.2), bands);
  scatter(scene, GEO.octa, toon(0xffffff, 0.7), cryst);
  scatter(scene, GEO.box, toon(0xffffff, 0.35), boxes);
  scatter(scene, GEO.box, glowMat(0xffffff), strips, false);
}

function mesh(geo, mat, x, y, z, sx, sy, sz, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = shadow; m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

// Castle: built facing +z in local space.
function buildCastle() {
  const g = new THREE.Group();
  const stone = toon(0xD3C6AF, 0.25), stoneD = toon(0xAE9F86, 0.25), roof = toon(PAL.hTeam, 0.3), wood = toon(0x7A5131, 0.2);
  mesh(GEO.cyl, stoneD, 0, 0.25, 0, 10, 0.5, 9, g);
  mesh(GEO.box, stone, 0, 2.9, -0.3, 5.6, 4.8, 4.2, g);
  for (let i = -2; i <= 2; i++) {
    mesh(GEO.box, stone, i * 1.15, 5.6, 1.8, 0.6, 0.7, 0.5, g);
    mesh(GEO.box, stone, i * 1.15, 5.6, -2.4, 0.6, 0.7, 0.5, g);
  }
  const towers = [];
  for (const sx of [-1, 1]) {
    mesh(GEO.cyl, stone, sx * 3.4, 3.6, 0.6, 2.6, 7.2, 2.6, g);
    mesh(GEO.cyl, stoneD, sx * 3.4, 7.3, 0.6, 3.0, 0.5, 3.0, g);
    towers.push(mesh(GEO.cone, roof, sx * 3.4, 8.8, 0.6, 3.3, 2.6, 3.3, g));
    mesh(GEO.box, toon(0x2A2018), sx * 3.4, 5, 1.88, 0.35, 0.7, 0.1, g);
  }
  mesh(GEO.box, wood, 0, 1.6, 1.83, 1.9, 2.6, 0.2, g);
  mesh(GEO.box, toon(0x4E3420), 0, 1.6, 1.95, 0.12, 2.6, 0.06, g);
  for (const sx of [-1, 1]) { // banners
    mesh(GEO.box, roof, sx * 1.75, 3.8, 1.85, 0.9, 2.2, 0.06, g);
    mesh(GEO.box, toon(0xFFF3E0), sx * 1.75, 3.6, 1.9, 0.4, 0.4, 0.04, g).rotation.z = Math.PI / 4;
  }
  const pole = mesh(GEO.cyl, wood, 3.4, 11.2, 0.6, 0.12, 2.6, 0.12, g);
  const flag = new THREE.Group(); flag.position.set(3.4, 12, 0.6); g.add(flag);
  mesh(GEO.box, roof, 0.75, 0, 0, 1.5, 0.9, 0.06, flag);
  // ballista turret on the keep
  const turret = new THREE.Group(); turret.position.set(0, 5.6, -0.3); g.add(turret);
  mesh(GEO.box, wood, 0, 0.3, 0, 0.5, 0.5, 1.6, turret);
  mesh(GEO.box, wood, 0, 0.45, 0.6, 2.2, 0.15, 0.15, turret);
  mesh(GEO.box, toon(PAL.steel), 0, 0.5, 0.95, 0.12, 0.12, 0.5, turret);
  void pole; void towers;
  return { group: g, turret, flag, height: 9 };
}
function buildServerTower() {
  const g = new THREE.Group();
  const dark = toon(0x222D36, 0.35), dark2 = toon(0x2F3B46, 0.35), glow = glowMat(0x6FFFEA), teal = toon(PAL.aTeam, 0.4);
  mesh(GEO.cyl, dark2, 0, 0.2, 0, 10, 0.4, 9, g);
  const ring = mesh(GEO.torus, glow, 0, 0.42, 0, 9.4, 1, 8.4, g, false);
  mesh(GEO.box, dark, 0, 4, 0, 4.2, 7.4, 3.4, g);
  for (let i = 0; i < 6; i++) mesh(GEO.box, glow, 0, 1.2 + i * 1.1, 1.72, 3.4, 0.08, 0.04, g, false);
  for (const sx of [-1, 1]) {
    mesh(GEO.box, dark2, sx * 3.1, 2.4, 0.2, 1.8, 4.6, 2.8, g);
    mesh(GEO.box, teal, sx * 3.1, 4.8, 0.2, 1.9, 0.3, 2.9, g);
    for (let i = 0; i < 4; i++) mesh(GEO.box, glow, sx * 3.1, 0.8 + i * 1, 1.62, 1.3, 0.06, 0.04, g, false);
  }
  mesh(GEO.box, teal, 0, 7.9, 0, 4.5, 0.4, 3.7, g);
  mesh(GEO.cyl, dark2, 0, 10, 0, 0.5, 4.5, 0.5, g);
  const rings = [mesh(GEO.torus, teal, 0, 10.2, 0, 2.6, 2.6, 2.6, g), mesh(GEO.torus, glow, 0, 11.2, 0, 1.7, 1.7, 1.7, g, false)];
  const core = mesh(GEO.sphere, glow, 0, 12.5, 0, 1, 1, 1, g, false);
  const turret = new THREE.Group(); turret.position.set(0, 8.3, 0.4); g.add(turret);
  mesh(GEO.hemi, dark2, 0, 0, 0, 1.4, 1.2, 1.4, turret);
  mesh(GEO.barrel, toon(PAL.gun), 0, 0.3, 0.2, 0.22, 0.22, 1.2, turret);
  mesh(GEO.sphere, glow, 0, 0.3, 1.4, 0.25, 0.25, 0.25, turret, false);
  return { group: g, turret, rings, core, ring, height: 12 };
}

export function buildWorld(scene, renderer, cover) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ map: groundTexture(Math.min(8, maxAniso)) }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  buildScenery(scene);
  buildCover(scene, cover);

  const castle = buildCastle();
  castle.group.position.set(0, 0, ARENA.baseZ); castle.group.rotation.y = Math.PI; castle.group.scale.setScalar(0.78);
  const server = buildServerTower();
  server.group.position.set(0, 0, -ARENA.baseZ); server.group.scale.setScalar(0.78);
  scene.add(castle.group, server.group);
  const bases = { human: castle, ai: server };
  for (const k of ['human', 'ai']) {
    const b = bases[k];
    b.home = b.group.position.clone();
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(7.2, 2), additive(k === 'human' ? 0xFFB070 : 0x6FFFEA, 0.16));
    dome.position.copy(b.home); dome.visible = false; dome.renderOrder = 2;
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(7.25, 2), new THREE.MeshBasicMaterial({ color: k === 'human' ? 0xFFC890 : 0x9FFFF2, wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }));
    dome.add(wire); wire.scale.setScalar(1 / 1.0);
    scene.add(dome);
    b.dome = dome;
  }

  let t = 0;
  return {
    bases,
    update(dt, game, turretAims) {
      t += dt;
      castle.flag.rotation.y = Math.sin(t * 2.2) * 0.25;
      server.rings[0].rotation.x = Math.sin(t * 0.8) * 0.4; server.rings[0].rotation.z = t * 0.9;
      server.rings[1].rotation.x = t * 1.3; server.rings[1].rotation.z = Math.cos(t) * 0.4;
      server.core.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
      server.ring.material.color.setHSL(0.47, 1, 0.6 + Math.sin(t * 3) * 0.12);
      if (!game) return;
      for (const k of ['human', 'ai']) {
        const b = bases[k], sb = game.bases[k];
        const shake = sb.hitT > 0 ? sb.hitT * 1.2 : 0;
        b.group.position.set(b.home.x + (Math.random() - 0.5) * shake, 0, b.home.z + (Math.random() - 0.5) * shake);
        const dying = 1 - sb.hp / sb.max;
        b.group.rotation.z = dying > 0.85 ? Math.sin(t * 20) * 0.01 : 0;
        b.dome.visible = sb.shield;
        if (sb.shield) { b.dome.rotation.y = t * 0.3; b.dome.material.opacity = 0.12 + Math.sin(t * 5) * 0.04; }
        const aim = turretAims[k];
        if (aim) {
          const wp = b.group.position;
          const yaw = Math.atan2(aim.x - wp.x, aim.z - wp.z) - b.group.rotation.y;
          b.turret.rotation.y += (yaw - b.turret.rotation.y) * Math.min(1, dt * 10);
        }
      }
    },
  };
}
