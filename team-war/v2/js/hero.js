// The player's hero: a chunky Ranger for Team Human, a hovering robot (Unit-7) for Team AI.
// Procedural animation: walk cycle, bob, lean into movement, recoil, dash stretch, hurt flash.
import * as THREE from 'three';
import { toon, glowMat, additive, GEO } from './gfx.js';
import { PAL } from './models.js';

export const DEFAULT_SKIN = { human: { main: 0xE8743B, trim: 0xFFF1D6 }, ai: { main: 0xE9EEF2, trim: 0x17A398 } };

function M(parent, geo, mat, p, s, r) {
  const m = new THREE.Mesh(GEO[geo], mat);
  m.position.set(p[0], p[1], p[2]); m.scale.set(s[0], s[1], s[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function G(parent, p) { const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); parent.add(g); return g; }

export class Hero {
  constructor(scene, team, skin) {
    this.team = team;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.mats = [];
    const mk = (c, rim = 0.4) => { const m = toon(c, rim, {}, true); this.mats.push(m); return m; };
    skin = skin || DEFAULT_SKIN[team];
    this.skin = skin;
    if (team === 'human') this.buildHuman(mk, skin); else this.buildRobot(mk, skin);
    // ground marker: ring + aim chevron
    const ringMat = additive(team === 'human' ? 0xFFB070 : 0x6FFFEA, 0.55);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 40).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.04; this.root.add(this.ring);
    const tri = new THREE.Shape(); tri.moveTo(0, 0.45); tri.lineTo(0.28, 0); tri.lineTo(-0.28, 0); tri.lineTo(0, 0.45);
    this.chev = new THREE.Mesh(new THREE.ShapeGeometry(tri).rotateX(-Math.PI / 2), ringMat);
    this.chev.position.y = 0.05; this.root.add(this.chev);
    this.walk = 0; this.lean = 0; this.roll = 0; this.yaw = 0; this.flash = 0; this.pop = 1; this.t = 0;
    this.muzzle = new THREE.Vector3();
  }
  buildHuman(mk, skin) {
    const main = mk(skin.main), trim = mk(skin.trim), skinM = mk(PAL.skin, 0.3), cloth = mk(0x4E3A2A, 0.3), leather = mk(0x3A281A, 0.3), steel = mk(PAL.steel, 0.5), wood = mk(PAL.wood, 0.3), hair = mk(0x3B2618, 0.3);
    this.body = G(this.root, [0, 0, 0]);
    this.legL = G(this.body, [-0.18, 0.74, 0]); this.legR = G(this.body, [0.18, 0.74, 0]);
    for (const leg of [this.legL, this.legR]) {
      M(leg, 'limb', cloth, [0, 0, 0], [0.26, 0.68, 0.28]);
      M(leg, 'box', leather, [0, -0.66, 0.06], [0.3, 0.16, 0.4]);
    }
    this.torso = G(this.body, [0, 0.78, 0]);
    M(this.torso, 'cap', main, [0, 0.36, 0], [0.78, 0.74, 0.52]);
    M(this.torso, 'box', leather, [0, 0.04, 0], [0.8, 0.12, 0.54]);
    M(this.torso, 'box', trim, [0, 0.42, 0], [0.12, 0.8, 0.56], [0, 0, 0.6]);
    M(this.torso, 'box', leather, [0, 0.42, -0.34], [0.5, 0.6, 0.24]);
    this.cape = G(this.torso, [0, 0.72, -0.3]);
    M(this.cape, 'box', main, [0, -0.45, -0.04], [0.7, 0.95, 0.05]);
    this.head = G(this.torso, [0, 0.98, 0.02]);
    M(this.head, 'sphere', skinM, [0, 0, 0], [0.56, 0.56, 0.56]);
    M(this.head, 'hemi', hair, [0, 0.04, -0.03], [0.6, 0.48, 0.6]);
    M(this.head, 'box', trim, [0, 0.1, 0.02], [0.6, 0.1, 0.58]);
    M(this.head, 'box', mk(0x1e1e1e), [-0.11, -0.01, 0.26], [0.08, 0.1, 0.04]);
    M(this.head, 'box', mk(0x1e1e1e), [0.11, -0.01, 0.26], [0.08, 0.1, 0.04]);
    M(this.head, 'sphere', skinM, [0, -0.07, 0.28], [0.1, 0.1, 0.1]);
    this.armL = G(this.torso, [-0.47, 0.62, 0]); this.armR = G(this.torso, [0.47, 0.62, 0]);
    for (const arm of [this.armL, this.armR]) {
      M(arm, 'capLimb', main, [0, 0, 0], [0.2, 0.55, 0.2]);
      M(arm, 'sphere', skinM, [0, -0.58, 0], [0.19, 0.19, 0.19]);
    }
    this.armL.rotation.set(-1.25, 0.45, 0); this.armR.rotation.set(-1.35, -0.2, 0);
    this.gun = G(this.torso, [0.14, 0.42, 0.5]);
    M(this.gun, 'box', wood, [0, 0, 0], [0.16, 0.22, 0.75]);
    M(this.gun, 'barrel', steel, [0, 0.06, 0.25], [0.12, 0.12, 0.6]);
    M(this.gun, 'box', steel, [0, 0.17, 0.05], [0.07, 0.08, 0.35]);
    this.tip = M(this.gun, 'barrel', glowMat(skin.trim === 0xFFF1D6 ? 0xFFC890 : skin.trim), [0, 0.06, 0.85], [0.15, 0.15, 0.06]);
    this.tipLocal = new THREE.Vector3(0, 0.06, 0.95);
    this.hover = false;
    this.root.scale.setScalar(1.25);
  }
  buildRobot(mk, skin) {
    const main = mk(skin.main, 0.45), trim = mk(skin.trim, 0.45), gun = mk(PAL.gun, 0.4), black = mk(0x1C242B, 0.3);
    const glow = glowMat(skin.trim === 0x17A398 ? 0x7BFFEE : skin.trim);
    this.glowMat = glow;
    this.body = G(this.root, [0, 0, 0]);
    this.hoverG = G(this.body, [0, 0.35, 0]);
    M(this.hoverG, 'cone', gun, [0, 0.35, 0], [0.55, 0.6, 0.55], [Math.PI, 0, 0]);
    this.thrust = M(this.hoverG, 'torus', glow, [0, 0.08, 0], [0.5, 0.5, 0.5]);
    this.thrust.castShadow = false;
    this.torso = G(this.hoverG, [0, 0.6, 0]);
    M(this.torso, 'sphere', gun, [0, 0, 0], [0.5, 0.4, 0.5]);
    M(this.torso, 'cap', main, [0, 0.45, 0], [0.86, 0.72, 0.6]);
    M(this.torso, 'box', trim, [0, 0.45, 0.28], [0.5, 0.42, 0.06]);
    M(this.torso, 'sphere', glow, [0, 0.47, 0.32], [0.2, 0.2, 0.08]).castShadow = false;
    M(this.torso, 'box', black, [0, 0.5, -0.36], [0.55, 0.5, 0.2]);
    for (const sx of [-1, 1]) M(this.torso, 'sphere', trim, [sx * 0.52, 0.72, 0], [0.36, 0.3, 0.36]);
    this.head = G(this.torso, [0, 1.06, 0]);
    M(this.head, 'cap', main, [0, 0, 0], [0.62, 0.5, 0.56]);
    this.visor = M(this.head, 'box', glow, [0, 0.02, 0.27], [0.5, 0.13, 0.04]);
    this.visor.castShadow = false;
    for (const sx of [-1, 1]) M(this.head, 'box', trim, [sx * 0.33, 0.02, 0], [0.08, 0.26, 0.26]);
    M(this.head, 'cyl', gun, [0.2, 0.36, -0.05], [0.04, 0.3, 0.04]);
    M(this.head, 'sphere', glow, [0.2, 0.52, -0.05], [0.09, 0.09, 0.09]).castShadow = false;
    this.armL = G(this.torso, [-0.56, 0.62, 0]); this.armR = G(this.torso, [0.56, 0.62, 0]);
    M(this.armL, 'limb', gun, [0, 0, 0], [0.17, 0.5, 0.17]);
    M(this.armL, 'box', main, [0, -0.55, 0], [0.22, 0.18, 0.22]);
    M(this.armR, 'limb', gun, [0, 0, 0], [0.18, 0.4, 0.18]);
    this.armL.rotation.set(-1.0, 0.35, 0); this.armR.rotation.set(-1.45, 0, 0);
    this.gun = G(this.armR, [0, -0.45, 0]);
    M(this.gun, 'cyl', main, [0, -0.1, 0], [0.3, 0.45, 0.3]);
    M(this.gun, 'cylLimb', gun, [0, -0.3, 0], [0.16, 0.45, 0.16]);
    for (let i = 0; i < 2; i++) M(this.gun, 'torus', glow, [0, -0.38 - i * 0.16, 0], [0.24, 0.24, 0.24]).castShadow = false;
    this.tip = M(this.gun, 'sphere', glow, [0, -0.78, 0], [0.14, 0.14, 0.14]);
    this.tip.castShadow = false;
    this.tipLocal = new THREE.Vector3(0, -0.85, 0);
    this.hover = true;
    this.root.scale.setScalar(1.22);
  }
  // h: sim hero. dt: frame time.
  update(h, dt, t) {
    this.t = t;
    const r = this.root;
    if (h.dead) { r.visible = false; this.pop = 0; return; }
    r.visible = true;
    this.pop = Math.min(1, this.pop + dt * 4);
    r.position.set(h.x, 0, h.z);
    // turn toward aim (smoothly)
    let da = h.aim - this.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    this.yaw += da * Math.min(1, dt * 22);
    r.rotation.y = this.yaw;
    // movement relative to facing
    const sp = Math.hypot(h.vx, h.vz);
    const fwdMv = (h.vx * Math.sin(this.yaw) + h.vz * Math.cos(this.yaw)) / 9;
    const sideMv = (h.vx * Math.cos(this.yaw) - h.vz * Math.sin(this.yaw)) / 9;
    const mv = Math.min(1, sp / 8);
    const dashing = h.dashT > 0;
    this.walk += dt * (4 + sp * 1.05) * (fwdMv < -0.2 ? -1 : 1);
    this.lean += ((dashing ? 0.5 : fwdMv * 0.28) - this.lean) * Math.min(1, dt * 10);
    this.roll += (-sideMv * 0.22 - this.roll) * Math.min(1, dt * 10);
    const rec = h.recoil;
    const pop = this.pop < 1 ? 1 + Math.sin(this.pop * Math.PI) * 0.35 : 1;
    const s = (this.hover ? 1.22 : 1.25) * pop;
    if (dashing) r.scale.set(s * 0.85, s * 0.9, s * 1.35); else r.scale.setScalar(s);
    if (this.hover) {
      this.hoverG.position.y = 0.35 + Math.sin(t * 3.2) * 0.09;
      this.body.rotation.set(this.lean * 1.2, 0, this.roll * 1.4);
      this.torso.rotation.x = -rec * 0.12;
      this.head.rotation.y = Math.sin(t * 1.3) * 0.12;
      this.thrust.scale.setScalar(0.5 + mv * 0.15 + Math.sin(t * 30) * 0.03);
      this.armR.rotation.x = -1.45 + rec * 0.35;
      this.gun.position.y = -0.45 + rec * 0.12;
      this.armL.rotation.x = -1.0 + Math.sin(t * 2) * 0.08;
      this.visor.scale.y = 0.13 * (Math.sin(t * 0.7) > 0.97 ? 0.2 : 1);
    } else {
      const sw = Math.sin(this.walk);
      this.legL.rotation.x = sw * 0.8 * mv; this.legR.rotation.x = -sw * 0.8 * mv;
      this.body.position.y = Math.abs(Math.cos(this.walk)) * 0.09 * mv;
      this.body.rotation.set(this.lean, 0, this.roll);
      this.torso.rotation.set(-rec * 0.1, Math.sin(this.walk) * 0.08 * mv, 0);
      this.gun.position.z = 0.5 - rec * 0.18;
      this.armR.rotation.x = -1.35 + rec * 0.25; this.armL.rotation.x = -1.25 + rec * 0.15;
      this.cape.rotation.x = 0.15 + mv * 0.5 + Math.sin(t * 7) * 0.06 * (0.3 + mv);
      this.head.rotation.x = -this.lean * 0.5;
    }
    // hurt flash / invulnerability blink
    const hurt = h.hurtT > 0 ? h.hurtT / 0.35 : 0;
    for (const m of this.mats) m.emissive.setRGB(hurt * 0.9, hurt * 0.25, hurt * 0.2);
    r.visible = !(h.inv > 0.4 && Math.floor(t * 18) % 2 === 0);
    this.ring.material.opacity = 0.35 + Math.sin(t * 4) * 0.12;
    this.chev.position.set(0, 0.05, 1.25);
    this.root.updateMatrixWorld(true);
    this.tip.updateMatrixWorld();
    this.muzzle.copy(this.tipLocal).applyMatrix4(this.tip.parent.matrixWorld);
  }
  dispose(scene) { scene.remove(this.root); }
}
