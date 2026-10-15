// Game feel: pooled particles, shockwave rings, damage numbers, screen shake and light flashes.
import * as THREE from 'three';
import { additive, toon, GEO } from './gfx.js?v=1015.3030';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

// Fixed-size particle pool drawn with one InstancedMesh. Struct-of-arrays for speed.
class Pool {
  constructor(scene, geo, mat, max, { shadow = false, bounce = false } = {}) {
    this.max = max; this.n = 0; this.bounce = bounce;
    this.im = new THREE.InstancedMesh(geo, mat, max);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.im.frustumCulled = false; this.im.count = 0; this.im.castShadow = shadow;
    scene.add(this.im);
    const F = (k = 1) => new Float32Array(max * k);
    this.p = F(3); this.v = F(3); this.life = F(); this.max0 = F(); this.size = F(); this.grav = F(); this.drag = F();
    this.col = F(3); this.rot = F(3); this.spin = F(3); this.mode = new Uint8Array(max); this.stretch = F();
  }
  spawn(x, y, z, vx, vy, vz, life, size, color, grav = 0, drag = 0, mode = 0, stretch = 0) {
    let i = this.n;
    if (i >= this.max) { i = (Math.random() * this.max) | 0; } else this.n++;
    const p = this.p, v = this.v;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    this.life[i] = life; this.max0[i] = life; this.size[i] = size; this.grav[i] = grav; this.drag[i] = drag;
    _c.setHex(color); this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = 0;
    this.spin[i * 3] = (Math.random() - 0.5) * 14; this.spin[i * 3 + 1] = (Math.random() - 0.5) * 14; this.spin[i * 3 + 2] = 0;
    this.mode[i] = mode; this.stretch[i] = stretch;
  }
  update(dt) {
    const p = this.p, v = this.v;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const d = Math.exp(-this.drag[i] * dt);
      v[i * 3] *= d; v[i * 3 + 1] = v[i * 3 + 1] * d - this.grav[i] * dt; v[i * 3 + 2] *= d;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (this.bounce && p[i * 3 + 1] < this.size[i] * 0.5) {
        p[i * 3 + 1] = this.size[i] * 0.5;
        if (v[i * 3 + 1] < 0) { v[i * 3 + 1] *= -0.35; v[i * 3] *= 0.6; v[i * 3 + 2] *= 0.6; this.spin[i * 3] *= 0.5; this.spin[i * 3 + 1] *= 0.5; }
      }
      this.rot[i * 3] += this.spin[i * 3] * dt; this.rot[i * 3 + 1] += this.spin[i * 3 + 1] * dt;
      const k = this.life[i] / this.max0[i];
      let sc;
      switch (this.mode[i]) {
        case 1: sc = this.size[i] * (k > 0.8 ? (1 - k) / 0.2 : 1) * (0.4 + 0.6 * Math.sqrt(k)) * (1.6 - k * 0.6); break; // puff: pop then shrink
        case 2: sc = this.size[i] * Math.min(1, k * 4); break; // debris: hold then vanish
        case 3: { // confetti: flutters side to side as it drifts down
          sc = this.size[i] * Math.min(1, k * 3);
          const w = Math.sin(this.life[i] * 9 + i) * 2.2;
          p[i * 3] += w * dt; p[i * 3 + 2] += Math.cos(this.life[i] * 7 + i) * 1.6 * dt;
          break;
        }
        default: sc = this.size[i] * k;
      }
      _e.set(this.rot[i * 3], this.rot[i * 3 + 1], 0); _q.setFromEuler(_e);
      if (this.stretch[i] > 0) {
        const vx = v[i * 3], vy = v[i * 3 + 1], vz = v[i * 3 + 2];
        const sp = Math.hypot(vx, vy, vz) || 1;
        _q.setFromUnitVectors(_v.set(0, 0, 1), _s.set(vx / sp, vy / sp, vz / sp));
        _s.set(sc, sc, sc + sp * this.stretch[i] * k);
      } else if (this.mode[i] === 3) _s.set(sc, sc * 0.6, sc * 0.05);
      else _s.set(sc, sc, sc);
      _m.compose(_v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]), _q, _s);
      this.im.setMatrixAt(i, _m);
      _c.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]);
      this.im.setColorAt(i, _c);
      i++;
    }
    this.im.count = this.n;
    this.im.instanceMatrix.needsUpdate = true;
    if (this.n) this.im.instanceColor.needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const a of [this.p, this.v, this.col, this.rot, this.spin]) { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; }
    for (const a of [this.life, this.max0, this.size, this.grav, this.drag, this.mode, this.stretch]) a[i] = a[j];
  }
  clear() { this.n = 0; this.im.count = 0; }
}

export class FX {
  constructor(scene, camera, numsEl, lowEnd) {
    this.scene = scene; this.camera = camera; this.numsEl = numsEl;
    const q = lowEnd ? 0.6 : 1;
    this.sparks = new Pool(scene, GEO.box, additive(0xffffff, 1), Math.round(700 * q));
    this.glow = new Pool(scene, GEO.sphereLo, additive(0xffffff, 0.55), Math.round(400 * q));
    this.puffs = new Pool(scene, GEO.blob, toon(0xffffff, 0.35), Math.round(260 * q));
    this.confetti = new Pool(scene, GEO.box, toon(0xffffff, 0.3, { side: THREE.DoubleSide }), Math.round(420 * q));
    this.debris = new Pool(scene, GEO.box, toon(0xffffff, 0.2), Math.round(300 * q), { bounce: true });
    this.sparks.im.renderOrder = 5; this.glow.im.renderOrder = 5;
    // shockwave rings
    this.rings = [];
    for (let i = 0; i < 20; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), additive(0xffffff, 1));
      r.visible = false; r.renderOrder = 4; scene.add(r);
      this.rings.push({ m: r, t: 0, max: 1, r0: 1, r1: 2, y: 0.1, op: 1 });
    }
    // light flashes
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 1.6); scene.add(this.muzzleLight);
    this.boomLight = new THREE.PointLight(0xffa050, 0, 16, 1.4); scene.add(this.boomLight);
    // muzzle flash sprite
    this.flash = new THREE.Mesh(GEO.octa, additive(0xffffff, 1)); this.flash.visible = false; this.flash.renderOrder = 6; scene.add(this.flash);
    this.flashT = 0;
    // damage numbers (DOM)
    this.nums = [];
    for (let i = 0; i < 44; i++) {
      const el = document.createElement('span'); el.className = 'num'; numsEl.appendChild(el);
      this.nums.push({ el, x: 0, y: 0, z: 0, t: 0, max: 1, vy: 0, on: false, scale: 1 });
    }
    this.numI = 0;
    this.trauma = 0; this.kick = new THREE.Vector2();
    this.shakeOff = new THREE.Vector3();
    this.t = 0;
  }
  // ---------- primitives ----------
  ring(x, z, r0, r1, life, color, y = 0.12, op = 0.9) {
    const R = this.rings.find((r) => r.t <= 0) || this.rings[0];
    R.t = life; R.max = life; R.r0 = r0; R.r1 = r1; R.y = y; R.op = op;
    R.m.material.color.setHex(color); R.m.visible = true;
    R.m.position.set(x, y, z);
  }
  burst(x, y, z, n, color, speed = 8, life = 0.4, size = 0.18, grav = 12, stretch = 0.03) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 0.9 + 0.1, sp = speed * (0.4 + Math.random() * 0.8);
      this.sparks.spawn(x, y, z, Math.cos(a) * sp * u, sp * (0.3 + Math.random() * 0.9), Math.sin(a) * sp * u, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, grav, 2.5, 0, stretch);
    }
  }
  dirBurst(x, y, z, dx, dz, n, color, speed = 10, spread = 0.9, life = 0.3, size = 0.14) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * spread * 2, sp = speed * (0.5 + Math.random() * 0.7);
      this.sparks.spawn(x, y, z, Math.sin(a) * sp, Math.random() * speed * 0.5, Math.cos(a) * sp, life * (0.6 + Math.random() * 0.6), size, color, 14, 3, 0, 0.04);
    }
  }
  puff(x, y, z, n, color, size = 0.8, speed = 2.5, life = 0.6, rise = 1.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * Math.random();
      this.puffs.spawn(x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3, Math.cos(a) * sp, rise * (0.5 + Math.random()), Math.sin(a) * sp, life * (0.7 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.7), color, -0.5, 2.2, 1);
    }
  }
  chunks(x, y, z, n, colors, speed = 6, size = 0.22, dx = 0, dz = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
      this.debris.spawn(x, y + Math.random() * 0.6, z, Math.cos(a) * sp + dx * speed * 0.6, 4 + Math.random() * 6, Math.sin(a) * sp + dz * speed * 0.6, 1.4 + Math.random() * 0.8, size * (0.5 + Math.random() * 0.9), colors[i % colors.length], 22, 0.4, 2);
    }
    // only big kills throw a little confetti now; ordinary deaths read through the crumple animation + debris
    if (n > 10) this.confettiBurst(x, y + 0.4, z, Math.min(16, Math.round(n * 0.7)), colors, speed * 0.8);
  }
  // team-coloured confetti that pops out of a defeated unit and flutters down
  confettiBurst(x, y, z, n, colors, speed = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.8);
      this.confetti.spawn(x, y, z, Math.cos(a) * sp, 5 + Math.random() * 6, Math.sin(a) * sp, 1.1 + Math.random() * 0.9, 0.22 + Math.random() * 0.14, colors[i % colors.length], 9, 2.6, 3);
    }
  }
  // victory fireworks: rockets rise from around the arena and burst into coloured stars
  fireworks(n = 10, colors = [0xFFC83D, 0xFF6F91, 0x6FFFEA, 0xFFFFFF, 0xB79CFF, 0xFF9A3D]) {
    for (let k = 0; k < n; k++) {
      setTimeout(() => {
        const x = (Math.random() - 0.5) * 30, z = (Math.random() - 0.5) * 50, h = 12 + Math.random() * 8, col = colors[k % colors.length];
        for (let j = 0; j < 8; j++) this.glow.spawn(x, 1 + j * 0.4, z, 0, 22, 0, 0.5 - j * 0.03, 0.3, 0xFFE6B0, 0, 0.8);
        setTimeout(() => {
          for (let i = 0; i < 60; i++) {
            const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 9 + Math.random() * 3;
            this.sparks.spawn(x, h, z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, 1.1 + Math.random() * 0.5, 0.22, col, 5, 1.2, 0, 0.05);
          }
          this.glow.spawn(x, h, z, 0, 0, 0, 0.3, 4, col, 0, 1);
          this.light(x, h, z, col, 40);
        }, 480);
      }, k * 260);
    }
  }
  glowDot(x, y, z, vx, vy, vz, life, size, color, grav = 0, drag = 1) { this.glow.spawn(x, y, z, vx, vy, vz, life, size, color, grav, drag); }
  number(x, y, z, text, cls = '', life = 0.8) {
    // merge rapid hits on the same spot into one rising total so numbers don't stack into clutter
    const m = /^([+-]?)(\d+)$/.exec(text), mergeable = m && (cls === '' || cls === 'big' || cls === 'crit');
    if (mergeable) {
      for (const o of this.nums) {
        if (!o.on || o.mergeCls !== cls || o.t < 0.25) continue;
        if (Math.abs(o.bx - x) + Math.abs(o.bz - z) > 1.8) continue;
        o.val += +m[2]; o.t = o.max = Math.max(o.t, life);
        const c = cls !== 'crit' && o.val >= 60 ? 'big' : cls;
        o.el.textContent = m[1] + o.val; o.el.className = 'num on ' + c;
        return;
      }
    }
    const n = this.nums[this.numI++ % this.nums.length];
    n.bx = x; n.bz = z; n.val = m ? +m[2] : 0; n.mergeCls = mergeable ? cls : null;
    n.x = x + (Math.random() - 0.5) * 0.5; n.y = y; n.z = z + (Math.random() - 0.5) * 0.5; n.t = life; n.max = life; n.on = true;
    n.el.textContent = text; n.el.className = 'num on ' + cls;
  }
  shake() { /* the camera never moves: impacts read through flashes, sparks and rings instead */ }
  muzzle(pos, color) {
    this.muzzleLight.position.copy(pos); this.muzzleLight.color.setHex(color); this.muzzleLight.intensity = 14;
    this.flash.position.copy(pos); this.flash.material.color.setHex(color); this.flash.visible = true; this.flashT = 0.05;
    this.flash.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.flash.scale.setScalar(0.45 + Math.random() * 0.25);
  }
  light(x, y, z, color, intensity) {
    if (intensity < this.boomLight.intensity) return;
    this.boomLight.position.set(x, y, z); this.boomLight.color.setHex(color); this.boomLight.intensity = intensity;
  }

  update(dt, rdt) {
    this.t += dt;
    this.sparks.update(dt); this.glow.update(dt); this.puffs.update(dt); this.debris.update(dt); this.confetti.update(dt);
    for (const R of this.rings) {
      if (R.t <= 0) continue;
      R.t -= dt;
      if (R.t <= 0) { R.m.visible = false; continue; }
      const k = 1 - R.t / R.max, e = 1 - (1 - k) * (1 - k);
      R.m.scale.setScalar(R.r0 + (R.r1 - R.r0) * e);
      R.m.material.opacity = R.op * (1 - k);
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - rdt * 160);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - rdt * 90);
    this.flashT -= rdt; if (this.flashT <= 0) this.flash.visible = false;
    this.trauma = Math.max(0, this.trauma - rdt * 1.6);
    // damage numbers: project to screen
    const cam = this.camera, w = window.innerWidth, h = window.innerHeight;
    for (const n of this.nums) {
      if (!n.on) continue;
      n.t -= rdt;
      if (n.t <= 0) { n.on = false; n.el.className = 'num'; continue; }
      const k = 1 - n.t / n.max;
      _v.set(n.x, n.y + k * 1.4, n.z).project(cam);
      const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      const pop = k < 0.15 ? 0.6 + k / 0.15 * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
      n.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
      n.el.style.opacity = k > 0.6 ? ((1 - k) / 0.4).toFixed(2) : '1';
    }
  }
  // camera offset from trauma (call after update)
  shakeVec(t) {
    const s = this.trauma * this.trauma;
    return this.shakeOff.set(
      (Math.sin(t * 61.3) + Math.sin(t * 23.1)) * 0.5 * s * 0.9,
      (Math.sin(t * 57.7 + 1) + Math.sin(t * 19.9)) * 0.5 * s * 0.6,
      (Math.sin(t * 66.1 + 2) + Math.sin(t * 27.3)) * 0.5 * s * 0.9,
    );
  }
  clear() {
    this.sparks.clear(); this.glow.clear(); this.puffs.clear(); this.debris.clear(); this.confetti.clear();
    for (const R of this.rings) { R.t = 0; R.m.visible = false; }
    for (const n of this.nums) { n.on = false; n.el.className = 'num'; }
    this.trauma = 0;
  }
}
