// Draws everything the simulation owns except the hero: minions (instanced), shots, telegraphs,
// shield walls, firewalls, drones, pickups and health bars.
import * as THREE from 'three';
import { Crowd, rootMatrix, additive, glowMat, toon, GEO, TIME, contactShadowMat, SHADOW_PLANE } from './gfx.js';
import { minionModel, PAL } from './models.js';
import { KINDS, PICKUPS } from './config.js';

// visual size of minions vs their collision radius: a touch bigger than life so they read from the fixed wide camera
const VIS_SCALE = 1.2;
const MAXES = { grunt: 90, runner: 70, shooter: 45, brute: 30, boss: 2 };
const _root = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), _right = new THREE.Vector3();

// a glowing streak: bright head at the origin fading to nothing along -z (additive, so black = invisible)
function streakGeometry() {
  const g = new THREE.ConeGeometry(0.5, 1, 8, 4, false).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = Math.pow(1 + p.getZ(i), 1.6); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function streakMat() {
  const m = additive(0xffffff, 1, 2.4); m.vertexColors = true; return m;
}
// magical vertical curtains: kind 0 = honeycomb shield shimmer, kind 1 = rising code-fire
function curtainMat(color, kind) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uColor: { value: new THREE.Color(color) }, uFade: { value: 1 }, uLen: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime, uFade, uLen; uniform vec3 uColor; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 uv = vUv; float a;
        ${kind === 0 ? `
        vec2 g = vec2(uv.x * uLen * 2.2, uv.y * 3.0);
        g.x += floor(g.y) * 0.5;
        vec2 f = abs(fract(g) - 0.5);
        float cell = smoothstep(0.38, 0.5, max(f.x * 1.15, f.y));
        float sweep = smoothstep(0.15, 0.0, abs(fract(uv.x * 0.6 - uTime * 0.5) - 0.5) - 0.3);
        float edge = smoothstep(0.82, 1.0, uv.y) + smoothstep(0.1, 0.0, uv.y) * 0.6;
        a = (0.1 + cell * 0.4 + edge * 0.6 + sweep * 0.2 + 0.06 * sin(uTime * 9.0 + uv.x * 20.0)) * 0.6;
        a *= 1.0 - smoothstep(0.9, 1.0, uv.y) * 0.0;` : `
        float t = uTime * 2.2;
        float fl = n(vec2(uv.x * uLen * 3.0, uv.y * 2.5 - t)) * 0.65 + n(vec2(uv.x * uLen * 7.0, uv.y * 5.0 - t * 1.7)) * 0.35;
        float body = fl * (1.2 - uv.y) - uv.y * 0.6;
        float shape = smoothstep(0.02, 0.2, body);
        float core = smoothstep(0.25, 0.5, body);
        float bits = step(0.88, h(floor(vec2(uv.x * uLen * 8.0, uv.y * 8.0 - t * 3.0)))) * (1.0 - uv.y);
        a = shape * 0.45 + core * 0.55 + bits * 0.5;`}
        vec3 c = mix(uColor, vec3(1.0), clamp(a - 1.0, 0.0, 0.6));
        gl_FragColor = vec4(c * a * uFade * 1.1, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
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
    const streak = streakGeometry();
    this.bolts = instanced(scene, streak, streakMat(), 400);
    this.boltCores = instanced(scene, streak, streakMat(), 400);
    this.boltHeads = instanced(scene, GEO.sphereLo, additive(0xffffff, 0.9, 2.6), 400);
    this.orbs = instanced(scene, GEO.sphere, additive(0xffffff, 1), 200);
    this.orbHalo = instanced(scene, GEO.sphere, additive(0xffffff, 0.35), 200);
    this.bolts.renderOrder = this.orbs.renderOrder = 3;
    // health bars
    this.barBg = instanced(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }), 160);
    this.barFg = instanced(scene, new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 1, toneMapped: false }), 160);
    this.barBg.renderOrder = 10; this.barFg.renderOrder = 11;
    // soft contact-shadow blobs under every unit — grounds them so they stop "floating" on the arena
    this.shadows = new THREE.InstancedMesh(SHADOW_PLANE, contactShadowMat(0.85), 300);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false; this.shadows.count = 0; this.shadows.renderOrder = 1;
    scene.add(this.shadows);
    // elite / ally markers on the ground
    this.marks = instanced(scene, new THREE.RingGeometry(0.72, 1, 28).rotateX(-Math.PI / 2), additive(0xffffff, 0.75), 240);
    this.dying = []; this.seen = new Map(); this.alive = new Set();
    // telegraphs
    this.tele = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const norm = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.9));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.3));
      const cross = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 4).rotateX(-Math.PI / 2), norm(0xff2a2a, 0.8));
      const rock = new THREE.Mesh(GEO.dodec, toon(0x2E1C18, 0.2)); rock.castShadow = true; rock.visible = false;
      const rockGlow = new THREE.Mesh(GEO.dodec, additive(0xFF6A1E, 0.9, 2.4)); rockGlow.scale.setScalar(1.15); rock.add(rockGlow);
      g.add(ring, fill, cross, rock); g.visible = false; g.position.y = 0.06;
      ring.renderOrder = fill.renderOrder = 4;
      scene.add(g); this.tele.push({ g, ring, fill, cross, rock });
    }
    // shield walls (Team Human Q)
    this.walls = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), curtainMat(0xFF4A12, 1)); panel.scale.set(7.6, 2.8, 1); panel.position.y = 0; panel.material.uniforms.uLen.value = 3.6;
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
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0x4FC8FF, 0.35, 1.2));
      const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0xCFEFFF, 0.25, 1.2));
      strip.position.y = 0.07; core.position.y = 0.08; strip.visible = core.visible = false;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), curtainMat(0x6FD8FF, 0));
      wall.visible = false; wall.renderOrder = 5; scene.add(wall);
      scene.add(strip, core); this.fires.push({ strip, core, wall });
    }
    // drones (Team AI E)
    this.drones = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(GEO.sphere, additive(0x4FC8FF, 0.8, 1.8)); b.scale.set(0.55, 0.5, 0.55);
      const eye = new THREE.Mesh(GEO.sphere, glowMat(0xBFF4FF)); eye.scale.set(0.22, 0.14, 0.12); eye.position.set(0, 0.02, 0.24);
      const rot = new THREE.Mesh(GEO.torus, glowMat(0x6FD8FF)); rot.scale.set(0.75, 0.75, 0.75); rot.position.y = 0.18;
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
    const dt = Math.max(0, Math.min(0.1, this.lastT == null ? 1 / 60 : t - this.lastT));
    this.lastT = t;
    if (g !== this.lastG) { this.lastG = g; this.seen.clear(); this.dying.length = 0; }
    for (const c of this.crowds.values()) c.begin();
    let nb = 0, nm = 0, nsh = 0;
    const camQ = camera.quaternion;
    const bgC = new THREE.Color(0x1a1a1a);
    for (const u of g.units) {
      const key = u.side + '_' + u.kind;
      const crowd = this.crowd(key);
      const model = crowd.model;
      const kr = KINDS[u.kind === 'grunt' && u.ally ? 'ally' : u.kind].r;
      const speed = Math.hypot(u.vx, u.vz);
      // per-unit animation memory: ease move amount and run a hit-stagger so motion isn't poppy
      let rec = this.seen.get(u.id);
      if (!rec) { rec = { key, x: 0, z: 0, face: 0, s: 1, y: 0, mv: 0, recoil: 0, hitPrev: 0 }; this.seen.set(u.id, rec); }
      const targetMv = Math.min(1, speed / 2.5);
      rec.mv += (targetMv - rec.mv) * Math.min(1, dt * 9);
      if (u.hitT > rec.hitPrev + 1e-3) rec.recoil = u.kind === 'boss' ? 0.22 : (u.kind === 'brute' || u.elite) ? 0.6 : 1; // fresh damage -> stagger (heavies barely flinch)
      rec.hitPrev = u.hitT;
      rec.recoil = Math.max(0, rec.recoil - dt / 0.22);
      const recoilE = rec.recoil * rec.recoil;                    // ease-out
      st.mv = rec.mv;
      st.ph = u.walk * (Math.PI * 2 / model.stride);
      st.roll = u.walk / 0.45;
      st.seed = u.id;
      st.swing = u.swing;
      st.recoil = recoilE;
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
      let pop = 1; // gentle ease-in on spawn (less of a "pop")
      if (age < 0.3) pop = 0.7 + 0.3 * (1 - (1 - age / 0.3) * (1 - age / 0.3));
      const flash = u.hitT > 0.05 ? Math.min(1, u.hitT / 0.11) * (u.kind === 'boss' ? 0.35 : u.kind === 'brute' || u.elite ? 0.55 : 0.9) : 0;
      const sq = flash * 0.06;
      const s = model.scale * VIS_SCALE * (u.r / kr) * Math.max(0.01, pop);
      // weight shift (roll side to side with each step) + a backward lean when staggered + stun wobble
      const roll = Math.sin(st.ph) * 0.06 * st.mv + (u.stun > 0 ? Math.sin(t * 22 + u.id) * 0.18 : 0);
      const lean = model.lean * st.mv - recoilE * 0.5;
      const sway = Math.sin(st.ph * 0.5) * 0.045 * st.mv; // subtle hip/shoulder sway on the facing
      rootMatrix(_root, u.x, y, u.z, u.face + sway, s * (1 + sq), s * (1 - sq), s * (1 + sq), lean, roll);
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
      // soft contact shadow under the unit (a touch bigger than its footprint), grounds it on the arena
      if (nsh < 300) {
        const sr = u.r * (u.kind === 'boss' ? 2.8 : u.kind === 'brute' || u.elite ? 2.2 : 1.7) * Math.max(0.2, pop);
        _m.compose(_v.set(u.x, 0.035 + y * 0.02, u.z), _q.identity(), _s.set(sr, 1, sr));
        this.shadows.setMatrixAt(nsh++, _m);
      }
      // team-coloured ground ring so sides read at a glance from the wide camera (gold for elites)
      if (nm < 240) {
        const rr = u.r * (u.elite ? 1.4 : 1.12);
        _m.compose(_v.set(u.x, 0.05, u.z), _q.identity(), _s.set(rr, 1, rr)); this.marks.setMatrixAt(nm, _m);
        if (u.elite) _c.setHex(0xFFC83D); else _c.setHex(u.side === 'human' ? 0xFF6A1E : 0x4FC8FF).multiplyScalar(u.ally ? 0.5 : 0.32);
        this.marks.setColorAt(nm, _c); nm++;
      }
      this.alive.add(u.id);
      rec.x = u.x; rec.z = u.z; rec.face = u.face; rec.s = s; rec.y = y; rec.elite = u.elite;
    }
    // units that vanished this frame crumple: they tip over, flatten and sink into the ground
    for (const [id, rec] of this.seen) {
      if (this.alive.has(id)) continue;
      this.seen.delete(id);
      if (this.dying.length < 40) this.dying.push({ ...rec, id, t: 0, tip: Math.sin(id) > 0 ? 1 : -1 });
    }
    this.alive.clear();
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      const T = 0.5;
      if (d.t >= T) { this.dying.splice(i, 1); continue; }
      const k = d.t / T, e = 1 - (1 - k) * (1 - k); // ease-out
      const fall = d.tip * e * 1.5;                 // keel over forward/back
      const sink = -e * 0.2;                        // sink into the ground
      const sc = d.s * (1 - e * e * 0.8);           // crumple away near the end
      st.mv = 0; st.swing = 0; st.ph = 0; st.recoil = 0; st.seed = d.id;
      rootMatrix(_root, d.x, d.y + sink, d.z, d.face, sc, sc * (1 - e * 0.25), sc, fall, Math.sin(d.id) * 0.4 * e);
      this.crowd(d.key).add(_root, st, Math.max(0, 1 - k * 2.5), d.elite);
      if (nsh < 300) { const sr = Math.max(0.01, sc * 1.7); _m.compose(_v.set(d.x, 0.035, d.z), _q.identity(), _s.set(sr, 1, sr)); this.shadows.setMatrixAt(nsh++, _m); }
    }
    this.shadows.count = nsh; this.shadows.instanceMatrix.needsUpdate = true;
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
        this.orbs.setMatrixAt(norb, _m); this.orbs.setColorAt(norb, _c.setHex(s.side === 'human' ? 0xFFD8A0 : 0xDFF6FF));
        _m.compose(_v, _q, _s.setScalar(s.r * 3.4 * pulse));
        this.orbHalo.setMatrixAt(norb, _m); this.orbHalo.setColorAt(norb, _c.setHex(s.side === 'human' ? 0xFF5A1E : 0x4FC8FF));
        norb++;
      } else {
        _q.setFromAxisAngle(UP, yaw);
        const big = s.big ? 2.4 : 1;
        const l = (s.src === 'turret' ? 2.2 : s.drone ? 1.6 : 3.2) * (s.big ? 1.3 : 1);
        _m.compose(_v.set(s.x, 1.15, s.z), _q, _s.set(0.36 * big, 0.36 * big, l));
        this.bolts.setMatrixAt(nbolt, _m);
        if (s.src === 'hero') {
          if (trail.prism) _c.setHSL((t * 0.8 + s.x * 0.05) % 1, 1, 0.6); else _c.setHex(s.crit ? 0xFFE066 : heroCol);
        } else _c.setHex(s.side === 'human' ? 0xFF7A2A : 0x7FE0FF);
        this.bolts.setColorAt(nbolt, _c);
        _m.compose(_v, _q, _s.set(0.12 * big, 0.12 * big, l * 0.75));
        this.boltCores.setMatrixAt(nbolt, _m); this.boltCores.setColorAt(nbolt, _c.setHex(0xFFFFFF));
        _m.compose(_v, _q, _s.setScalar(0.34 * big));
        this.boltHeads.setMatrixAt(nbolt, _m); this.boltHeads.setColorAt(nbolt, this.bolts.instanceColor ? _c.fromArray(this.bolts.instanceColor.array, nbolt * 3) : _c);
        nbolt++;
      }
    }
    for (const im of [this.bolts, this.boltCores, this.boltHeads]) { im.count = nbolt; im.instanceMatrix.needsUpdate = true; if (nbolt) im.instanceColor.needsUpdate = true; }
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
      w.panel.material.uniforms.uFade.value = fade;
    });
    // firewalls
    this.fires.forEach((f, i) => {
      const s = g.fires[i];
      f.strip.visible = f.core.visible = f.wall.visible = !!s;
      if (!s) return;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      const yaw = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
      const grow = Math.min(1, (s.max - s.t) / 0.15), fade = Math.min(1, s.t / 0.4);
      for (const m of [f.strip, f.core]) { m.position.x = cx; m.position.z = cz; m.rotation.y = yaw; }
      f.strip.scale.set(s.w * 2.2 * fade, 1, L * grow); f.core.scale.set(s.w * 0.7 * fade, 1, L * grow);
      f.strip.material.opacity = 0.45 + Math.sin(t * 14) * 0.1;
      f.wall.position.set(cx, 0.05, cz); f.wall.rotation.y = yaw - Math.PI / 2;
      f.wall.scale.set(L * grow, 3.2 * fade, 1);
      f.wall.material.uniforms.uLen.value = L / 2; f.wall.material.uniforms.uFade.value = fade;
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
      const def = PICKUPS[s.kind], col = def.color, ab = !!def.ability; // ability power-ups read bigger/brighter + a taller spinning crystal
      p.gem.material.color.setHex(col); p.gem.material.emissive.setHex(col).multiplyScalar(ab ? 0.6 : 0.35);
      p.halo.material.color.setHex(col); p.beam.material.color.setHex(col); p.ring.material.color.setHex(col);
      p.halo.material.opacity = ab ? 0.42 : 0.25; p.beam.material.opacity = ab ? 0.3 : 0.18;
      p.gem.scale.set(ab ? 0.82 : 0.7, ab ? 1.35 : 1, ab ? 0.82 : 0.7);
      p.g.position.set(s.x, 0, s.z);
      p.gem.rotation.y = t * (ab ? 3.6 : 2.5); p.gem.position.y = 1.1 + Math.sin(t * 4 + i) * 0.18;
      const blink = s.t < 3 ? (Math.floor(t * 8) % 2 ? 0.3 : 1) : 1;
      p.g.scale.setScalar((ab ? 1.28 : 1) * (blink === 0.3 ? 0.85 : 1));
      p.ring.scale.setScalar(1 + ((t * (ab ? 2.2 : 1.5)) % 1) * (ab ? 0.95 : 0.6));
    });
  }
}
