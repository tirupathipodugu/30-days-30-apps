// The player's hero: a chibi Ranger for Team Human, a hovering helper-bot (Unit-7) for Team AI.
// Each bone (legs, torso, head, arms, cape, gun) is one baked vertex-coloured mesh, so a hero costs ~12 draw calls.
// Procedural animation: walk cycle with squash & stretch, idle breathing, blinking, lean, recoil kick,
// dash stretch, cape follow-through, hurt flash. A floating team marker keeps the hero easy to find.
import * as THREE from 'three';
import { toon, glowMat, additive, GEO, Baker, M4, GLOW, GRADIENT, blinkAt, TIME } from './gfx.js';
import { PAL } from './models.js';

// Fire hero = a dark ember body overlaid with a climbing flame glow; Water hero = a pale translucent body
// with a strong cyan fresnel shimmer. The elemental look comes from the materials; the chibi silhouette and
// the procedural animation stay so the hero still reads clearly.
export const DEFAULT_SKIN = { human: { main: 0x3A1A12, trim: 0xFF8A2A }, ai: { main: 0x8FD8F0, trim: 0xCFF4FF } };
const HERO_SCALE = 1.75;

const NOISE = 'float fn(vec2 p){ return fract(sin(dot(floor(p), vec2(12.9,78.2))) * 43758.5); }';
function elementalMaterial(team) {
  const fire = team === 'human';
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: GRADIENT, transparent: !fire, opacity: fire ? 1 : 0.84 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vWp;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const add = fire ? `{
        float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        float flame = fn(vec2(vWp.x * 6.0, vWp.y * 6.0 - uTime * 4.0));
        float heat = smoothstep(0.35, 1.0, flame) * (0.55 + 0.45 * sin(uTime * 10.0 + vWp.y * 8.0));
        vec3 glow = mix(vec3(1.7, 0.4, 0.04), vec3(2.0, 1.3, 0.3), heat);
        outgoingLight += glow * (heat * 0.6 + pow(rimF, 1.8) * 0.9);
      }` : `{
        float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        float shimmer = fn(vec2(vWp.x * 5.0 + uTime, vWp.y * 5.0 - uTime * 0.7));
        outgoingLight += vec3(0.3, 0.85, 1.1) * (pow(rimF, 1.5) * 1.3 + smoothstep(0.6, 1.0, shimmer) * 0.5);
        outgoingLight = mix(outgoingLight, vec3(0.75, 0.95, 1.1), 0.18);
      }`;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uTime; varying vec3 vWp;\n' + NOISE + '\nvoid main() {')
      .replace('#include <opaque_fragment>', add + '\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => (fire ? 'heroFire' : 'heroWater');
  return m;
}

function G(parent, p) { const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); parent.add(g); return g; }

export class Hero {
  constructor(scene, team, skin) {
    this.team = team;
    this.root = new THREE.Group();
    scene.add(this.root);
    skin = skin || DEFAULT_SKIN[team];
    this.skin = skin;
    // one elemental material per hero (fire glow / water shimmer); hurt flash tints its emissive
    this.mat = elementalMaterial(team);
    this.mats = [this.mat];
    this.glow = glowMat(0xffffff, { vertexColors: true });
    this.bones = [];
    if (team === 'human') this.buildHuman(skin); else this.buildRobot(skin);
    this.finishBones();
    // ground marker: a bold glowing ring with a bright inner disc, an expanding "sonar" pulse,
    // an aim chevron, and a spinning gem overhead — so the player's own hero is never in doubt.
    const tc = team === 'human' ? 0xFFB070 : 0x6FFFEA;
    const ringMat = additive(tc, 0.85, 2.0);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.12, 48).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.05; this.root.add(this.ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40).rotateX(-Math.PI / 2), additive(tc, 0.22, 1));
    disc.position.y = 0.04; this.ring.add(disc);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40).rotateX(-Math.PI / 2), additive(tc, 0.6, 1.6));
    this.pulse.position.y = 0.06; this.root.add(this.pulse);
    const tri = new THREE.Shape(); tri.moveTo(0, 0.55); tri.lineTo(0.32, 0); tri.lineTo(-0.32, 0); tri.lineTo(0, 0.55);
    this.chev = new THREE.Mesh(new THREE.ShapeGeometry(tri).rotateX(-Math.PI / 2), ringMat);
    this.chev.position.set(0, 0.05, 1.3); this.root.add(this.chev);
    // a spinning gem that points down at the hero, with a soft glow halo
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.0, 4).rotateX(Math.PI), glowMat(tc));
    this.marker.add(new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.3, 4).translate(0, 0.65, 0), glowMat(0xffffff)));
    const halo = new THREE.Mesh(GEO.sphere, additive(tc, 0.28, 1.4)); halo.scale.setScalar(1.4); this.marker.add(halo);
    scene.add(this.marker);
    this.walk = 0; this.lean = 0; this.roll = 0; this.yaw = 0; this.flash = 0; this.pop = 1; this.t = 0;
    this.capeV = 0; this.capeA = 0.2; this.land = 0; this.prevSin = 0;
    this.bank = 0; this.kick = 0; this.hurtPrev = 0; this.recover = 0; this.dashPrev = false;
    this.muzzle = new THREE.Vector3();
  }
  // collect parts per bone: p(bone, geo, color, [x,y,z], scale, rot, opts)
  p(bone, geo, color, pos, s, r, opts = {}) {
    let b = this.bones.find((x) => x.g === bone);
    if (!b) { b = { g: bone, tb: new Baker(), gb: new Baker() }; this.bones.push(b); }
    const glow = opts.glow;
    (glow ? b.gb : b.tb).add(GEO[geo], color, M4(pos[0], pos[1], pos[2], s, r), { boost: glow ? GLOW : 0, jitter: opts.j || 0 });
  }
  finishBones() {
    for (const b of this.bones) {
      if (!b.tb.empty) { const m = new THREE.Mesh(b.tb.geometry(), this.mat); m.castShadow = true; b.g.add(m); }
      if (!b.gb.empty) { const m = new THREE.Mesh(b.gb.geometry(), this.glow); b.g.add(m); }
    }
  }
  eyes(bone, y, z, dx, s = 1) {
    this.eyeG = G(bone, [0, y, z]);
    for (const sx of [-1, 1]) {
      this.p(this.eyeG, 'sphere', PAL.ink, [sx * dx, 0, 0], [0.12 * s, 0.17 * s, 0.07]);
      this.p(this.eyeG, 'sphereLo', 0xffffff, [sx * dx + 0.03 * s, 0.05 * s, 0.035], [0.05 * s, 0.055 * s, 0.03]);
    }
  }
  buildHuman(skin) {
    const main = skin.main, trim = skin.trim, S = PAL.skin, cloth = 0x4E3A2A, leather = 0x3A281A, hair = 0x5A3820;
    this.body = G(this.root, [0, 0, 0]);
    this.legL = G(this.body, [-0.16, 0.5, 0]); this.legR = G(this.body, [0.16, 0.5, 0]);
    for (const leg of [this.legL, this.legR]) {
      this.p(leg, 'capLimb', cloth, [0, 0, 0], [0.22, 0.38, 0.24]);
      this.p(leg, 'sphere', leather, [0, -0.42, 0.06], [0.27, 0.18, 0.36]);
    }
    this.torso = G(this.body, [0, 0.52, 0]);
    this.p(this.torso, 'cap', main, [0, 0.3, 0], [0.7, 0.62, 0.52]);
    this.p(this.torso, 'taper', trim, [0, 0.07, 0], [0.7, 0.16, 0.56]);
    this.p(this.torso, 'cyl', leather, [0, 0.14, 0], [0.68, 0.09, 0.54]);
    this.p(this.torso, 'rboxS', PAL.gold, [0, 0.14, 0.27], [0.14, 0.11, 0.04]);
    this.p(this.torso, 'box', leather, [0, 0.36, 0], [0.1, 0.72, 0.56], [0, 0, 0.62]);
    // quiver
    this.p(this.torso, 'cyl', PAL.wood, [0.16, 0.5, -0.3], [0.2, 0.62, 0.2], [0.2, 0, -0.35]);
    for (let i = 0; i < 3; i++) this.p(this.torso, 'cone', [0xFFFFFF, trim, 0xE04848][i], [0.26 + i * 0.05, 0.86 + i * 0.02, -0.36], [0.07, 0.16, 0.07], [0.2, 0, -0.35]);
    // scarf
    this.p(this.torso, 'torus', trim, [0, 0.62, 0], [0.62, 0.9, 0.58]);
    this.cape = G(this.torso, [0, 0.62, -0.22]);
    this.p(this.cape, 'cloth', main, [0, 0, -0.02], [0.66, 0.78, 0.05]);
    this.p(this.cape, 'cloth', trim, [0.18, 0, 0.02], [0.14, 0.5, 0.04]);
    // head: big, round, with a ranger hood
    this.head = G(this.torso, [0, 0.98, 0.02]);
    this.p(this.head, 'sphereHi', S, [0, 0, 0], [0.82, 0.78, 0.78]);
    this.p(this.head, 'hemi', hair, [0, 0.06, -0.04], [0.86, 0.74, 0.84]);
    this.p(this.head, 'sphere', hair, [0.16, 0.3, 0.26], [0.28, 0.16, 0.24], [0.5, 0, -0.4]);
    this.p(this.head, 'sphere', hair, [-0.12, 0.33, 0.24], [0.24, 0.14, 0.22], [0.5, 0, 0.5]);
    this.p(this.head, 'sphereHi', main, [0, 0.08, -0.1], [0.92, 0.86, 0.86]);
    this.p(this.head, 'cone', main, [0, 0.12, -0.52], [0.36, 0.5, 0.36], [-1.95, 0, 0]);
    this.p(this.head, 'sphereLo', S, [0, -0.08, 0.4], [0.1, 0.09, 0.08]);
    this.p(this.head, 'sphereLo', PAL.cheek, [-0.24, -0.12, 0.31], [0.13, 0.07, 0.05]);
    this.p(this.head, 'sphereLo', PAL.cheek, [0.24, -0.12, 0.31], [0.13, 0.07, 0.05]);
    this.p(this.head, 'box', hair, [-0.15, 0.17, 0.36], [0.16, 0.035, 0.03], [0, 0, 0.15]);
    this.p(this.head, 'box', hair, [0.15, 0.17, 0.36], [0.16, 0.035, 0.03], [0, 0, -0.15]);
    this.eyes(this.head, 0.02, 0.36, 0.15);
    // arms hold the crossbow out front
    this.armL = G(this.torso, [-0.42, 0.5, 0]); this.armR = G(this.torso, [0.42, 0.5, 0]);
    for (const arm of [this.armL, this.armR]) {
      this.p(arm, 'capLimb', main, [0, 0, 0], [0.19, 0.42, 0.19]);
      this.p(arm, 'sphere', S, [0, -0.46, 0], [0.2, 0.2, 0.2]);
    }
    this.armL.rotation.set(-1.2, 0.5, 0); this.armR.rotation.set(-1.3, -0.25, 0);
    this.gun = G(this.torso, [0.12, 0.3, 0.42]);
    this.p(this.gun, 'box', PAL.wood, [0, 0, 0.1], [0.14, 0.18, 0.78], null, { j: 0.1 });
    this.p(this.gun, 'box', PAL.wood, [0, 0.05, 0.42], [1.0, 0.08, 0.1], [0, 0, 0]);
    this.p(this.gun, 'box', PAL.steel, [0, 0.12, 0.2], [0.07, 0.07, 0.62]);
    this.p(this.gun, 'box', 0xE8E2D2, [0, 0.07, 0.36], [0.96, 0.015, 0.015], [0, 0.42, 0]);
    this.tip = G(this.gun, [0, 0.12, 0.56]);
    this.p(this.tip, 'octa', skin.trim === 0xFFF1D6 ? 0xFFC890 : skin.trim, [0, 0, 0], [0.13, 0.13, 0.22], null, { glow: true });
    this.tipLocal = new THREE.Vector3(0, 0, 0.16);
    this.hover = false;
  }
  buildRobot(skin) {
    const main = skin.main, trim = skin.trim, gun = PAL.gun, black = 0x151C22;
    const glowC = trim === 0x17A398 ? 0x7BFFEE : trim;
    this.body = G(this.root, [0, 0, 0]);
    this.hoverG = G(this.body, [0, 0.42, 0]);
    this.p(this.hoverG, 'cone', gun, [0, 0.12, 0], [0.5, 0.42, 0.5], [Math.PI, 0, 0]);
    this.p(this.hoverG, 'torus', trim, [0, 0.26, 0], [0.62, 0.9, 0.62]);
    this.thrust = G(this.hoverG, [0, -0.1, 0]);
    this.p(this.thrust, 'cone', glowC, [0, -0.2, 0], [0.32, 0.5, 0.32], [Math.PI, 0, 0], { glow: true });
    this.torso = G(this.hoverG, [0, 0.42, 0]);
    this.p(this.torso, 'sphereHi', main, [0, 0.12, 0], [0.74, 0.62, 0.66]);
    this.p(this.torso, 'cyl', trim, [0, 0.12, 0], [0.76, 0.12, 0.68]);
    this.p(this.torso, 'sphere', glowC, [0, 0.16, 0.32], [0.2, 0.2, 0.08], null, { glow: true });
    this.p(this.torso, 'rbox', black, [0, 0.2, -0.34], [0.5, 0.42, 0.2]);
    for (const sx of [-1, 1]) this.p(this.torso, 'sphere', trim, [sx * 0.44, 0.34, 0], [0.3, 0.26, 0.3]);
    // head: a big round shell with a dark face screen and glowing eyes
    this.head = G(this.torso, [0, 0.82, 0]);
    this.p(this.head, 'sphereHi', main, [0, 0, 0], [0.96, 0.84, 0.88]);
    this.p(this.head, 'rbox', black, [0, -0.02, 0.24], [0.74, 0.5, 0.44]);
    this.p(this.head, 'torus', trim, [0, 0, 0], [0.98, 1.2, 0.9]);
    for (const sx of [-1, 1]) this.p(this.head, 'cyl', trim, [sx * 0.47, 0, 0], [0.26, 0.1, 0.26], [0, 0, Math.PI / 2]);
    this.p(this.head, 'cylLo', gun, [0.18, 0.5, -0.05], [0.04, 0.3, 0.04]);
    this.p(this.head, 'sphereLo', glowC, [0.18, 0.67, -0.05], [0.12, 0.12, 0.12], null, { glow: true });
    this.eyeG = G(this.head, [0, 0.0, 0.46]);
    for (const sx of [-1, 1]) this.p(this.eyeG, 'rboxS', glowC, [sx * 0.15, 0, 0], [0.13, 0.19, 0.04], null, { glow: true });
    this.p(this.eyeG, 'box', glowC, [0, -0.15, 0], [0.16, 0.035, 0.03], null, { glow: true });
    // arms: left claw, right arm cannon
    this.armL = G(this.torso, [-0.5, 0.3, 0]); this.armR = G(this.torso, [0.5, 0.3, 0]);
    this.p(this.armL, 'capLimb', gun, [0, 0, 0], [0.15, 0.4, 0.15]);
    this.p(this.armL, 'rboxS', trim, [0, -0.46, 0], [0.24, 0.22, 0.24]);
    this.p(this.armR, 'capLimb', gun, [0, 0, 0], [0.16, 0.3, 0.16]);
    this.armL.rotation.set(-0.9, 0.35, 0); this.armR.rotation.set(-1.45, 0, 0);
    this.gun = G(this.armR, [0, -0.38, 0]);
    this.p(this.gun, 'cyl', main, [0, -0.08, 0], [0.32, 0.4, 0.32]);
    this.p(this.gun, 'cylLimb', gun, [0, -0.26, 0], [0.18, 0.42, 0.18]);
    for (let i = 0; i < 2; i++) this.p(this.gun, 'torus', glowC, [0, -0.34 - i * 0.15, 0], [0.26, 0.26, 0.26], null, { glow: true });
    this.tip = G(this.gun, [0, -0.72, 0]);
    this.p(this.tip, 'sphere', glowC, [0, 0, 0], [0.16, 0.16, 0.16], null, { glow: true });
    this.tipLocal = new THREE.Vector3(0, -0.1, 0);
    this.hover = true;
  }
  // h: sim hero. dt: frame time.
  update(h, dt, t) {
    this.t = t;
    const r = this.root;
    if (h.dead) { r.visible = false; this.marker.visible = false; this.pop = 0; return; }
    r.visible = true; this.marker.visible = true;
    this.pop = Math.min(1, this.pop + dt * 4);
    r.position.set(h.x, 0, h.z);
    // turn toward aim (eased), and bank the body into the turn
    let da = h.aim - this.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    const applied = da * Math.min(1, dt * 15);
    this.yaw += applied;
    r.rotation.y = this.yaw;
    const turnBank = Math.max(-0.3, Math.min(0.3, applied / Math.max(dt, 1e-3) * 0.028));
    this.bank += (turnBank - this.bank) * Math.min(1, dt * 8);
    const sp = Math.hypot(h.vx, h.vz);
    const fwdMv = (h.vx * Math.sin(this.yaw) + h.vz * Math.cos(this.yaw)) / 9;
    const sideMv = (h.vx * Math.cos(this.yaw) - h.vz * Math.sin(this.yaw)) / 9;
    const mv = Math.min(1, sp / 8);
    const dashing = h.dashT > 0;
    // hit stagger: a sharp recoil the instant damage lands, easing back out
    if (h.hurtT > this.hurtPrev + 1e-3) this.kick = 1;
    this.hurtPrev = h.hurtT;
    this.kick = Math.max(0, this.kick - dt / 0.26);
    const kickE = this.kick * this.kick;
    // dash recovery: a landing squash when a dash ends
    if (this.dashPrev && !dashing) this.recover = 1;
    this.dashPrev = dashing;
    this.recover = Math.max(0, this.recover - dt / 0.22);
    this.walk += dt * (4 + sp * 1.05) * (fwdMv < -0.2 ? -1 : 1);
    this.lean += ((dashing ? 0.5 : fwdMv * 0.3) - this.lean) * Math.min(1, dt * 10);
    this.roll += (-sideMv * 0.24 + this.bank - this.roll) * Math.min(1, dt * 12);
    const rec = h.recoil || 0;
    const pop = this.pop < 1 ? 1 + Math.sin(this.pop * Math.PI) * 0.3 : 1;
    const s = HERO_SCALE * pop;
    // squash on each footfall, stretch on dash, landing squash on recover
    const sw = Math.sin(this.walk);
    if (!this.hover && Math.sign(sw) !== Math.sign(this.prevSin) && mv > 0.2) this.land = 1;
    this.prevSin = sw;
    this.land = Math.max(0, this.land - dt * 7);
    const breathe = Math.sin(t * 2.2) * 0.02 * (1 - mv);
    const sq = this.land * 0.07 * mv + this.recover * this.recover * 0.14;
    if (dashing) r.scale.set(s * 0.86, s * 0.9, s * 1.35);
    else r.scale.set(s * (1 + sq * 0.6), s * (1 - sq + breathe), s * (1 + sq * 0.6));
    if (this.hover) {
      this.hoverG.position.y = 0.42 + Math.sin(t * 3.2) * 0.08 - kickE * 0.1;
      this.body.rotation.set(this.lean * 1.2 - kickE * 0.4, 0, this.roll * 1.4);
      this.torso.rotation.x = -rec * 0.12 - kickE * 0.25;
      this.head.rotation.set(Math.sin(t * 1.1) * 0.05 - kickE * 0.5, Math.sin(t * 1.3) * 0.12, Math.sin(t * 0.9) * 0.05);
      const fl = 0.9 + Math.sin(t * 33) * 0.12 + mv * 0.35;
      this.thrust.scale.set(fl, fl * (1 + mv * 0.6), fl);
      this.armR.rotation.x = -1.45 + rec * 0.35 + kickE * 0.3;
      this.gun.position.y = -0.38 + rec * 0.12;
      this.armL.rotation.x = -0.9 + Math.sin(t * 2) * 0.08 - mv * 0.3 + kickE * 0.4;
    } else {
      this.legL.rotation.x = sw * 0.9 * mv; this.legR.rotation.x = -sw * 0.9 * mv;
      this.body.position.y = Math.abs(Math.cos(this.walk)) * 0.1 * mv;
      this.body.rotation.set(this.lean - kickE * 0.35, Math.sin(this.walk) * 0.06 * mv, this.roll); // hips counter-rotate with the stride
      this.torso.rotation.set(-rec * 0.1 - kickE * 0.3, -sw * 0.12 * mv, 0);                        // shoulders counter the hips
      this.gun.position.z = 0.42 - rec * 0.18;
      this.armR.rotation.x = -1.3 + rec * 0.25 + kickE * 0.2; this.armL.rotation.x = -1.2 + rec * 0.15 + sw * 0.25 * mv;
      // cape: a damped spring that trails behind movement and snaps on a hit
      const target = 0.15 + mv * 0.75 + (dashing ? 0.6 : 0) + kickE * 0.5;
      this.capeV += ((target - this.capeA) * 60 - this.capeV * 9) * dt;
      this.capeA += this.capeV * dt;
      this.cape.rotation.x = this.capeA + Math.sin(t * 8) * 0.05 * (0.3 + mv);
      this.cape.rotation.z = -this.roll * 0.8;
      this.head.rotation.set(-this.lean * 0.5 + Math.sin(t * 1.6) * 0.03 - kickE * 0.4, Math.sin(t * 0.8) * 0.1 * (1 - mv), 0);
    }
    this.eyeG.scale.y = blinkAt(t, 3);
    // hurt flash / invulnerability blink
    const hurt = h.hurtT > 0 ? h.hurtT / 0.35 : 0;
    this.mat.emissive.setRGB(hurt * 0.9, hurt * 0.25, hurt * 0.2);
    r.visible = !(h.inv > 0.4 && Math.floor(t * 18) % 2 === 0);
    this.ring.material.opacity = 0.55 + Math.sin(t * 4) * 0.15;
    this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.04);
    this.marker.position.set(h.x, (this.hover ? 4.3 : 4.2) + Math.sin(t * 3) * 0.15, h.z);
    this.marker.rotation.y = t * 1.5;
    this.root.updateMatrixWorld(true);
    this.muzzle.copy(this.tipLocal).applyMatrix4(this.tip.matrixWorld);
  }
  dispose(scene) { scene.remove(this.root); scene.remove(this.marker); }
}
