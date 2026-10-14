// Draws everything the simulation owns except the hero: minions (instanced), shots, telegraphs,
// shield walls, firewalls, drones, pickups and health bars.
import * as THREE from 'three';
import { Crowd, rootMatrix, additive, glowMat, toon, GEO } from './gfx.js';
import { minionModel, PAL } from './models.js';
import { KINDS, PICKUPS } from './config.js';

const MAXES = { grunt: 90, runner: 70, shooter: 45, brute: 30, boss: 2 };
const _root = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), _right = new THREE.Vector3();

function instanced(scene, geo, mat, max, shadow = false) {
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  im.frustumCulled = false; im.count = 0; im.castShadow = shadow;
  scene.add(im);
  return im;
}

export class Entities {
  constructor(scene) {
    this.scene = scene;
    this.crowds = new Map();
    this.st = { ph: 0, mv: 0, swing: 0, t: 0, roll: 0, seed: 0 };
    // projectiles
    this.bolts = instanced(scene, GEO.box, additive(0xffffff, 1), 400);
    this.boltCores = instanced(scene, GEO.box, additive(0xffffff, 1), 400);
    this.orbs = instanced(scene, GEO.sphere, additive(0xffffff, 1), 200);
    this.orbHalo = instanced(scene, GEO.sphere, additive(0xffffff, 0.35), 200);
    this.bolts.renderOrder = this.orbs.renderOrder = 3;
    // health bars
    this.barBg = instanced(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }), 160);
    this.barFg = instanced(scene, new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 1, toneMapped: false }), 160);
    this.barBg.renderOrder = 10; this.barFg.renderOrder = 11;
    // elite / ally markers on the ground
    this.marks = instanced(scene, new THREE.RingGeometry(0.75, 1, 28).rotateX(-Math.PI / 2), additive(0xffffff, 0.75), 60);
    // telegraphs
    this.tele = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const norm = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.9));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.3));
      const cross = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 4).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.8));
      const rock = new THREE.Mesh(GEO.dodec, toon(0x9C9282, 0.2)); rock.castShadow = true; rock.visible = false;
      g.add(ring, fill, cross, rock); g.visible = false; g.position.y = 0.06;
      ring.renderOrder = fill.renderOrder = 4;
      scene.add(g); this.tele.push({ g, ring, fill, cross, rock });
    }
    // shield walls (Team Human Q)
    this.walls = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(GEO.box, additive(0xFFA85C, 0.4)); panel.scale.set(7.6, 2.2, 0.25); panel.position.y = 1.1;
      const edge = new THREE.Mesh(GEO.box, additive(0xFFE0B0, 0.9)); edge.scale.set(7.6, 0.08, 0.3); edge.position.y = 2.2;
      g.add(panel, edge);
      for (let k = 0; k < 7; k++) {
        const post = new THREE.Mesh(GEO.cone, toon(0x9B6A3A)); post.scale.set(0.38, 2.3, 0.38); post.position.set(-3.6 + k * 1.2, 1.1, 0); post.castShadow = true;
        g.add(post);
      }
      g.visible = false; scene.add(g); this.walls.push({ g, panel, edge });
    }
    // firewalls (Team AI Q)
    this.fires = [];
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0x3BFFE0, 0.5));
      const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0xB8FFF4, 0.35));
      strip.position.y = 0.07; core.position.y = 0.08; strip.visible = core.visible = false;
      scene.add(strip, core); this.fires.push({ strip, core });
    }
    // drones (Team AI E)
    this.drones = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(GEO.sphere, toon(PAL.metal, 0.5)); b.scale.set(0.55, 0.4, 0.55); b.castShadow = true;
      const eye = new THREE.Mesh(GEO.sphere, glowMat(0x7BFFEE)); eye.scale.set(0.22, 0.14, 0.12); eye.position.set(0, 0.02, 0.24);
      const rot = new THREE.Mesh(GEO.torus, glowMat(0x7BFFEE)); rot.scale.set(0.75, 0.75, 0.75); rot.position.y = 0.18;
      g.add(b, eye, rot); g.visible = false; scene.add(g); this.drones.push({ g, rot });
    }
    // pickups
    this.picks = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const gem = new THREE.Mesh(GEO.octa, toon(0xffffff, 0.8, {}, true)); gem.scale.set(0.7, 1, 0.7); gem.position.y = 1.1; gem.castShadow = true;
      const halo = new THREE.Mesh(GEO.sphere, additive(0xffffff, 0.25)); halo.scale.setScalar(1.5); halo.position.y = 1.1;
      const beam = new THREE.Mesh(GEO.cyl, additive(0xffffff, 0.18)); beam.scale.set(0.5, 6, 0.5); beam.position.y = 3;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 28).rotateX(-Math.PI / 2), additive(0xffffff, 0.7)); ring.position.y = 0.06;
      g.add(gem, halo, beam, ring); g.visible = false; scene.add(g);
      this.picks.push({ g, gem, halo, beam, ring });
    }
  }
  crowd(key) {
    let c = this.crowds.get(key);
    if (!c) {
      const [team, kind] = key.split('_');
      c = new Crowd(this.scene, minionModel(team, kind), MAXES[kind]);
      this.crowds.set(key, c);
    }
    return c;
  }
  prewarm(teams) { for (const t of teams) for (const k of Object.keys(MAXES)) this.crowd(t + '_' + k); }

  update(g, t, camera, trail) {
    const st = this.st;
    st.t = t;
    for (const c of this.crowds.values()) c.begin();
    let nb = 0, nm = 0;
    const camQ = camera.quaternion;
    const bgC = new THREE.Color(0x1a1a1a);
    for (const u of g.units) {
      const key = u.side + '_' + u.kind;
      const crowd = this.crowd(key);
      const model = crowd.model;
      const kr = KINDS[u.kind === 'grunt' && u.ally ? 'ally' : u.kind].r;
      const speed = Math.hypot(u.vx, u.vz);
      st.mv = Math.min(1, speed / 2.5);
      st.ph = u.walk * (Math.PI * 2 / model.stride);
      st.roll = u.walk / 0.45;
      st.seed = u.id;
      st.swing = u.swing;
      let y = 0;
      if (u.kind === 'boss') {
        if (u.state === 'wind') st.swing = Math.min(1, (1.05 - u.stateT) / 0.45);
        if (u.state === 'leap' && u.leap) {
          const p = 1 - Math.max(0, u.stateT) / u.leap.t;
          st.swing = Math.min(1, p * 2);
          y = p > 0.35 ? Math.sin(((p - 0.35) / 0.65) * Math.PI) * 7 : -Math.sin(p / 0.35 * Math.PI) * 0.3;
        }
      }
      if (model.hover) y += 0.15 + Math.sin(t * 3 + u.id) * 0.12;
      const age = g.t - u.born;
      let pop = 1;
      if (age < 0.35) { const a = age / 0.35; pop = a < 0.7 ? a / 0.7 * 1.15 : 1.15 - (a - 0.7) / 0.3 * 0.15; }
      const flash = u.hitT > 0.05 ? Math.min(1, u.hitT / 0.11) * (u.kind === 'boss' ? 0.35 : u.kind === 'brute' || u.elite ? 0.55 : 0.9) : 0;
      const sq = flash * 0.12;
      const s = model.scale * 1.12 * (u.r / kr) * Math.max(0.01, pop);
      const roll = u.stun > 0 ? Math.sin(t * 22 + u.id) * 0.18 : 0;
      rootMatrix(_root, u.x, y, u.z, u.face, s * (1 + sq), s * (1 - sq), s * (1 + sq), model.lean * st.mv, roll);
      crowd.add(_root, st, flash, u.elite);
      // health bar for damaged non-boss units
      if (u.hp < u.max && u.kind !== 'boss' && nb < 160) {
        const w = u.kind === 'brute' || u.elite ? 1.8 : 1.1;
        const h = u.kind === 'brute' ? 3.2 * s : u.kind === 'shooter' ? 2.1 * s : 2.0 * s;
        const cy = h + y;
        _m.compose(_v.set(u.x, cy, u.z), camQ, _s.set(w + 0.08, 0.2, 1)); this.barBg.setMatrixAt(nb, _m); this.barBg.setColorAt(nb, bgC);
        _right.set(1, 0, 0).applyQuaternion(camQ).multiplyScalar(w / 2);
        _m.compose(_v.set(u.x - _right.x, cy - _right.y, u.z - _right.z), camQ, _s.set(w * Math.max(0.001, u.hp / u.max), 0.12, 1)); this.barFg.setMatrixAt(nb, _m);
        this.barFg.setColorAt(nb, _c.setHex(u.ally ? 0x8CFF7A : u.elite ? 0xFFC83D : 0xFF4D4D));
        nb++;
      }
      if (u.elite && nm < 60) {
        _m.compose(_v.set(u.x, 0.06, u.z), _q.identity(), _s.set(u.r * 1.6, 1, u.r * 1.6)); this.marks.setMatrixAt(nm, _m);
        this.marks.setColorAt(nm, _c.setHex(0xFFC83D)); nm++;
      }
    }
    for (const c of this.crowds.values()) c.end();
    for (const im of [this.barBg, this.barFg]) { im.count = nb; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    this.marks.count = nm; this.marks.instanceMatrix.needsUpdate = true; if (nm) this.marks.instanceColor.needsUpdate = true;

    // shots
    let nbolt = 0, norb = 0;
    const heroCol = trail.color;
    for (const s of g.shots) {
      const yaw = Math.atan2(s.dx, s.dz);
      if (s.orb) {
        const pulse = 1 + Math.sin(t * 20 + s.x) * 0.12;
        _m.compose(_v.set(s.x, 1.1, s.z), _q.identity(), _s.setScalar(s.r * 1.6 * pulse));
        this.orbs.setMatrixAt(norb, _m); this.orbs.setColorAt(norb, _c.setHex(0xFFE3F0));
        _m.compose(_v, _q, _s.setScalar(s.r * 3.4 * pulse));
        this.orbHalo.setMatrixAt(norb, _m); this.orbHalo.setColorAt(norb, _c.setHex(0xFF2E7E));
        norb++;
      } else {
        _q.setFromAxisAngle(UP, yaw);
        const big = s.big ? 2.4 : 1;
        const l = s.src === 'turret' ? 1.4 : s.drone ? 1.0 : 1.9;
        _m.compose(_v.set(s.x - s.dx * l * 0.5, 1.15, s.z - s.dz * l * 0.5), _q, _s.set(0.2 * big, 0.2 * big, l * (s.big ? 1.3 : 1)));
        this.bolts.setMatrixAt(nbolt, _m);
        if (s.src === 'hero') {
          if (trail.prism) _c.setHSL((t * 0.8 + s.x * 0.05) % 1, 1, 0.6); else _c.setHex(s.crit ? 0xFFE066 : heroCol);
        } else _c.setHex(s.side === 'human' ? 0xFFB070 : 0x6FFFEA);
        this.bolts.setColorAt(nbolt, _c);
        _m.compose(_v, _q, _s.set(0.08 * big, 0.08 * big, l * 0.9));
        this.boltCores.setMatrixAt(nbolt, _m); this.boltCores.setColorAt(nbolt, _c.setHex(0xFFFFFF));
        nbolt++;
      }
    }
    for (const im of [this.bolts, this.boltCores]) { im.count = nbolt; im.instanceMatrix.needsUpdate = true; if (nbolt) im.instanceColor.needsUpdate = true; }
    for (const im of [this.orbs, this.orbHalo]) { im.count = norb; im.instanceMatrix.needsUpdate = true; if (norb) im.instanceColor.needsUpdate = true; }

    // telegraphs
    this.tele.forEach((tg, i) => {
      const s = g.slams[i];
      if (!s) { tg.g.visible = false; return; }
      tg.g.visible = true;
      const p = 1 - s.t / s.max;
      const foe = s.side === g.foe;
      const col = foe ? 0xFF2A2A : (g.team === 'human' ? 0xFF9A3D : 0x2BD9C6);
      tg.ring.material.color.setHex(col); tg.fill.material.color.setHex(col); tg.cross.material.color.setHex(col);
      tg.g.position.set(s.x, 0.06, s.z);
      tg.ring.scale.setScalar(s.r); tg.cross.scale.setScalar(s.r * (1 - p) + 0.5);
      tg.fill.scale.setScalar(Math.max(0.01, s.r * p));
      tg.rock.visible = s.kind === 'boulder';
      if (tg.rock.visible) { tg.rock.position.set(0, 0.8 + (1 - p) * (1 - p) * 22, 0); tg.rock.scale.setScalar(1.6); tg.rock.rotation.set(t * 5, t * 3, 0); }
      const blink = p > 0.7 ? (Math.floor(t * 20) % 2 ? 1 : 0.5) : 1;
      tg.ring.material.opacity = 0.95 * blink; tg.fill.material.opacity = 0.2 + p * 0.3;
    });
    // walls
    this.walls.forEach((w, i) => {
      const s = g.walls[i];
      if (!s) { w.g.visible = false; return; }
      w.g.visible = true;
      w.g.position.set(s.x, 0, s.z);
      w.g.rotation.y = Math.atan2(s.nx, s.nz);
      const age = s.max - s.t;
      const rise = Math.min(1, age / 0.18), fade = Math.min(1, s.t / 0.4);
      w.g.scale.set(1, Math.max(0.01, rise * fade), 1);
      w.panel.material.opacity = 0.3 + Math.sin(t * 9) * 0.06;
    });
    // firewalls
    this.fires.forEach((f, i) => {
      const s = g.fires[i];
      f.strip.visible = f.core.visible = !!s;
      if (!s) return;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      const yaw = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
      const grow = Math.min(1, (s.max - s.t) / 0.15), fade = Math.min(1, s.t / 0.4);
      for (const m of [f.strip, f.core]) { m.position.x = cx; m.position.z = cz; m.rotation.y = yaw; }
      f.strip.scale.set(s.w * 2.2 * fade, 1, L * grow); f.core.scale.set(s.w * 0.7 * fade, 1, L * grow);
      f.strip.material.opacity = 0.45 + Math.sin(t * 14) * 0.1;
    });
    // drones
    this.drones.forEach((d, i) => {
      const s = g.drones[i];
      d.g.visible = !!s;
      if (!s) return;
      d.g.position.set(s.x, 1.8 + Math.sin(t * 6 + i) * 0.2 - (s.dive ? 0.8 : 0), s.z);
      d.g.rotation.y = Math.atan2(s.vx, s.vz);
      d.rot.rotation.y = t * 30;
    });
    // pickups
    this.picks.forEach((p, i) => {
      const s = g.pickups[i];
      p.g.visible = !!s;
      if (!s) return;
      const col = PICKUPS[s.kind].color;
      p.gem.material.color.setHex(col); p.gem.material.emissive.setHex(col).multiplyScalar(0.35);
      p.halo.material.color.setHex(col); p.beam.material.color.setHex(col); p.ring.material.color.setHex(col);
      p.g.position.set(s.x, 0, s.z);
      p.gem.rotation.y = t * 2.5; p.gem.position.y = 1.1 + Math.sin(t * 4 + i) * 0.18;
      const blink = s.t < 3 ? (Math.floor(t * 8) % 2 ? 0.3 : 1) : 1;
      p.g.scale.setScalar(blink === 0.3 ? 0.85 : 1);
      p.ring.scale.setScalar(1 + ((t * 1.5) % 1) * 0.6);
    });
  }
}
