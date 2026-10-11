// The shooter: a small figure on the floor in front of the mirror, seen from behind, holding a compact
// gun up at the glass. Left/Right walk, Up/Down raise or lower the aim, Space or Enter fires (hold for
// about four shots a second). A faint laser shows where the shot will land. Each shot is a muzzle
// flash, a tracer racing into the glass, a short recoil and a brass shell that bounces on the floor.
// Everything is drawn with a few shaded shapes on a 2D canvas laid over the glass.

import { clamp01 } from './motion.js';

const FIRE_GAP_MS = 250;               // held trigger: four shots a second
const TRACER_MS = 55;                  // muzzle to glass
const TRACER_FADE_MS = 90;
const FLASH_MS = 55;
const RECOIL_MS = 90;
const SHELL_LIFE_MS = 1500;
const MAX_SHELLS = 24;
const SHELL_GRAVITY = 1500;            // px/s²
const HEIGHT_SHARE = 0.1;              // the figure is about a tenth of the screen tall
const MIN_HEIGHT = 64, MAX_HEIGHT = 112;

const RIM = 'rgba(206, 226, 255, 0.55)';   // cool light from the mirror, catching the figure's edges
const LASER = '255, 92, 72';

export class Shooter {
  /**
   * `onHit(x, y)` is called when a shot reaches the glass; `onShellLand(size)` when a shell first
   * hits the floor; `onFire()` as each shot leaves the gun.
   */
  constructor(canvas, { onHit, onShellLand, onFire }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHit = onHit;
    this.onShellLand = onShellLand;
    this.onFire = onFire;
    this.width = 1;
    this.height = 1;
    this.floor = 1;
    this.size = 80;
    this.x = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.move = 0;                     // -1, 0, 1 while a walk key or button is held
    this.raise = 0;                    // -1 (up), 0, 1 (down) while an aim key or button is held
    this.trigger = false;              // held fire
    this.lastShot = -Infinity;
    this.walkPhase = 0;
    this.shots = [];                   // { from, to, at, hit }
    this.shells = [];
    this.last = 0;
    this.enabled = true;
    this.calm = false;                 // the ending: lowered weapon, no laser, no firing
  }

  /** Fit to the stage. `floor` is the y the figure stands on. */
  resize(width, height, floor) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const first = this.width === 1;
    this.width = width;
    this.height = height;
    this.floor = floor;
    this.size = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height * HEIGHT_SHARE));
    if (first) {
      this.x = width * 0.5;
      this.aimX = width * 0.5;
      this.aimY = height * 0.4;
    }
    this.x = Math.min(Math.max(this.x, this.size * 0.4), width - this.size * 0.4);
    this.aimAt(this.aimX, this.aimY);
  }

  top() { return this.height * 0.05; }
  bottom() { return this.floor - this.size * 1.35; }

  /** Where a shot will land on the glass. */
  get target() {
    return { x: this.aimX, y: this.aimY };
  }

  /** Point the gun at a spot on the glass (the last place touched, on a phone). */
  aimAt(x, y) {
    this.aimX = Math.min(Math.max(x, 4), this.width - 4);
    this.aimY = Math.min(Math.max(y, this.top()), this.bottom());
  }

  /** Pull the trigger once (respecting the fire rate). Returns true if a shot went off. */
  fire(now) {
    if (!this.enabled || this.calm || now - this.lastShot < FIRE_GAP_MS) return false;
    this.lastShot = now;
    const muzzle = this.pose(now).muzzle;
    this.shots.push({ from: muzzle, to: { ...this.target }, at: now, hit: false });
    this.ejectShell(now);
    this.onFire?.();
    return true;
  }

  ejectShell(now) {
    if (this.reduced) return;
    if (this.shells.length >= MAX_SHELLS) this.shells.shift();
    const { grip } = this.pose(now);
    const side = Math.random() < 0.7 ? 1 : -1;
    this.shells.push({
      x: grip.x + side * this.size * 0.06,
      y: grip.y,
      vx: side * (70 + Math.random() * 80),
      vy: -(170 + Math.random() * 110),
      rot: Math.random() * 6,
      spin: (Math.random() - 0.5) * 30,
      rest: this.floor - Math.random() * this.size * 0.06,   // a little depth on the floor
      bounces: 0,
      born: now,
    });
  }

  /** Advance walking, aiming, the trigger, shots and shells. */
  update(now, reduced) {
    this.reduced = reduced;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.move) {
      const speed = Math.min(480, Math.max(180, this.width * 0.38));
      const x = Math.min(Math.max(this.x + this.move * speed * dt, this.size * 0.4), this.width - this.size * 0.4);
      this.aimX = Math.min(Math.max(this.aimX + x - this.x, 4), this.width - 4);   // the aim walks along
      this.x = x;
      this.walkPhase += dt * 9;
    } else {
      this.walkPhase *= 0.85;
    }
    if (this.raise) {
      const speed = Math.max(220, this.height * 0.55);
      this.aimY = Math.min(Math.max(this.aimY + this.raise * speed * dt, this.top()), this.bottom());
    }
    if (this.trigger) this.fire(now);

    const travel = reduced ? 1 : TRACER_MS;
    for (const s of this.shots) {
      if (!s.hit && now - s.at >= travel) {
        s.hit = true;
        this.onHit(s.to.x, s.to.y);
      }
    }
    this.shots = this.shots.filter((s) => now - s.at < travel + TRACER_FADE_MS);

    for (const s of this.shells) {
      if (s.bounces > 2) continue;
      s.vy += SHELL_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      if (s.y >= s.rest && s.vy > 0) {
        s.y = s.rest;
        if (s.bounces === 0) this.onShellLand?.(Math.min(1, Math.abs(s.vy) / 500));
        s.bounces++;
        s.vy = -s.vy * 0.32;
        s.vx *= 0.55;
        s.spin *= 0.5;
        if (Math.abs(s.vy) < 40) s.bounces = 3;
      }
    }
    this.shells = this.shells.filter((s) => now - s.born < SHELL_LIFE_MS);
  }

  /** Body pose this frame: shoulders, the grip and the muzzle, with breathing, sway and recoil. */
  pose(now) {
    const u = this.size / 100;
    const t = now / 1000;
    const still = this.reduced ? 0 : 1;
    const recoil = this.reduced ? 0 : Math.exp(-(now - this.lastShot) / RECOIL_MS * 2.2) * (now >= this.lastShot ? 1 : 0);
    const bob = Math.abs(Math.sin(this.walkPhase)) * 1.6 * u;
    const breathe = Math.sin(t * 2.1) * 0.8 * u * still;
    const feet = { x: this.x, y: this.floor };
    const neck = { x: this.x, y: this.floor - 80 * u - breathe - bob + recoil * 1.5 * u };
    // Shouldered on the right, beside the head, pointing at the target on the glass.
    const cheek = { x: this.x + 8 * u, y: neck.y - 3 * u };
    let dx = this.aimX - cheek.x + Math.sin(t * 1.3) * 0.9 * u * still;
    let dy = this.aimY - cheek.y + Math.cos(t * 1.7) * 0.7 * u * still;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Seen from behind, the gun points into the scene, so its length on screen is foreshortened.
    const reach = 6 * u - recoil * 4 * u;
    const grip = { x: cheek.x + dx * reach, y: cheek.y + dy * reach };
    const gun = (14 + 8 * clamp01(len / (this.height * 0.6))) * u;
    const muzzle = { x: grip.x + dx * gun, y: grip.y + dy * gun };
    const support = { x: grip.x + dx * gun * 0.5, y: grip.y + dy * gun * 0.5 };
    return { u, feet, neck, grip, support, muzzle, dx, dy, recoil, bob };
  }

  draw(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.enabled) return;
    const p = this.pose(now);
    if (!this.calm) this.drawLaser(ctx, p, now);
    this.drawFigure(ctx, p, now);
    this.drawShells(ctx, now);
    this.drawShots(ctx, now);
  }

  drawLaser(ctx, p, now) {
    const { muzzle } = p;
    const t = this.target;
    const glow = 0.75 + 0.25 * Math.sin(now / 260);
    ctx.save();
    const g = ctx.createLinearGradient(muzzle.x, muzzle.y, t.x, t.y);
    g.addColorStop(0, `rgba(${LASER}, 0.32)`);
    g.addColorStop(1, `rgba(${LASER}, 0.12)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(muzzle.x, muzzle.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    const r = 9;
    const dot = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
    dot.addColorStop(0, `rgba(255, 240, 235, ${0.95 * glow})`);
    dot.addColorStop(0.25, `rgba(${LASER}, ${0.8 * glow})`);
    dot.addColorStop(1, `rgba(${LASER}, 0)`);
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFigure(ctx, p, now) {
    const { u, feet, neck, grip, support, muzzle, dx, dy } = p;
    const x = feet.x, y = feet.y;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Contact shadow on the floor.
    const shadow = ctx.createRadialGradient(x, y, 0, x, y, 26 * u);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shadow;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, 26 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Legs, in a slight stance; walking swings them.
    const swing = Math.sin(this.walkPhase) * 4 * u;
    const hips = neck.y + 34 * u;
    const leg = (side, offset) => {
      const g = ctx.createLinearGradient(x, hips, x, y);
      g.addColorStop(0, '#1a1e27');
      g.addColorStop(1, '#0b0d12');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x + side * 2 * u, hips);
      ctx.lineTo(x + side * 12 * u, hips);
      ctx.lineTo(x + side * 12 * u + offset, y - 5 * u);
      ctx.lineTo(x + side * 5 * u + offset, y - 5 * u);
      ctx.closePath();
      ctx.fill();
      // Boots, with a faint top highlight.
      ctx.fillStyle = '#07080b';
      ctx.beginPath();
      ctx.ellipse(x + side * 8.5 * u + offset, y - 2.6 * u, 5.4 * u, 3 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(206, 226, 255, 0.18)';
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.ellipse(x + side * 8.5 * u + offset, y - 2.6 * u, 5.4 * u, 3 * u, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    };
    leg(-1, -swing);
    leg(1, swing);

    // Torso: a dark technical jacket, lit from the mirror at its edges.
    const shoulder = neck.y + 3 * u;
    const torso = new Path2D();
    torso.moveTo(x - 12 * u, hips + 2 * u);
    torso.bezierCurveTo(x - 14 * u, hips - 12 * u, x - 18 * u, shoulder + 10 * u, x - 17 * u, shoulder + 3 * u);
    torso.quadraticCurveTo(x - 15 * u, shoulder - 1 * u, x - 7 * u, shoulder - 1.5 * u);
    torso.lineTo(x + 7 * u, shoulder - 1.5 * u);
    torso.quadraticCurveTo(x + 15 * u, shoulder - 1 * u, x + 17 * u, shoulder + 3 * u);
    torso.bezierCurveTo(x + 18 * u, shoulder + 10 * u, x + 14 * u, hips - 12 * u, x + 12 * u, hips + 2 * u);
    torso.closePath();
    const body = ctx.createLinearGradient(x, shoulder, x, hips);
    body.addColorStop(0, '#2b313d');
    body.addColorStop(1, '#13161d');
    ctx.fillStyle = body;
    ctx.fill(torso);
    const side = ctx.createLinearGradient(x - 18 * u, 0, x + 18 * u, 0);
    side.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    side.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    side.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = side;
    ctx.fill(torso);
    // A seam down the back and a belt line.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath();
    ctx.moveTo(x, shoulder + 2 * u);
    ctx.lineTo(x, hips);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(206, 226, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(x - 12 * u, hips - 1 * u);
    ctx.lineTo(x + 12 * u, hips - 1 * u);
    ctx.stroke();
    ctx.strokeStyle = RIM;
    ctx.lineWidth = 1 * u;
    ctx.stroke(torso);

    // Arms: the right hand on the grip, the left reaching forward under the barrel, elbows out.
    const arm = (s, hand) => {
      const sx = x + s * 14 * u, sy = shoulder + 3 * u;
      const ex = (sx + hand.x) / 2 + s * 7 * u, ey = (sy + hand.y) / 2 + 4 * u;
      ctx.strokeStyle = '#1e232d';
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(ex, ey, hand.x, hand.y);
      ctx.stroke();
      ctx.strokeStyle = RIM;
      ctx.lineWidth = 0.9 * u;
      ctx.beginPath();
      ctx.moveTo(sx + s * 3.2 * u, sy - 1.5 * u);
      ctx.quadraticCurveTo(ex + s * 3.2 * u, ey - 2 * u, hand.x + s * 2.5 * u, hand.y - 1.5 * u);
      ctx.stroke();
    };
    arm(-1, support);
    arm(1, grip);

    // The gun: a compact carbine, foreshortened, with a lit top edge and a small status light.
    const nx = -dy, ny = dx;
    const half = 2.6 * u;
    ctx.fillStyle = '#0d0f14';
    ctx.beginPath();
    ctx.moveTo(grip.x + nx * half, grip.y + ny * half);
    ctx.lineTo(muzzle.x + nx * half * 0.7, muzzle.y + ny * half * 0.7);
    ctx.lineTo(muzzle.x - nx * half * 0.7, muzzle.y - ny * half * 0.7);
    ctx.lineTo(grip.x - nx * half, grip.y - ny * half);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(206, 226, 255, 0.5)';
    ctx.lineWidth = 0.8 * u;
    ctx.beginPath();
    ctx.moveTo(grip.x + nx * half, grip.y + ny * half);
    ctx.lineTo(muzzle.x + nx * half * 0.7, muzzle.y + ny * half * 0.7);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120, 230, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(grip.x + dx * 4 * u - nx * 1.2 * u, grip.y + dy * 4 * u - ny * 1.2 * u, 0.9 * u, 0, Math.PI * 2);
    ctx.fill();
    // Gloved hands.
    ctx.fillStyle = '#101218';
    for (const h of [grip, support]) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head: short dark hair from behind, a collar, and the rim light.
    const hx = x, hy = neck.y - 8.5 * u;
    ctx.fillStyle = '#15181f';
    ctx.beginPath();
    ctx.ellipse(x, neck.y + 1.5 * u, 7.5 * u, 3 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    const head = ctx.createRadialGradient(hx - 2 * u, hy - 4 * u, 1 * u, hx, hy, 9 * u);
    head.addColorStop(0, '#2a2622');
    head.addColorStop(1, '#0c0b0c');
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 7.6 * u, 8.6 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RIM;
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 7.6 * u, 8.6 * u, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
  }

  drawShells(ctx, now) {
    const u = this.size / 100;
    for (const s of this.shells) {
      const fade = 1 - clamp01((now - s.born - SHELL_LIFE_MS * 0.6) / (SHELL_LIFE_MS * 0.4));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      const g = ctx.createLinearGradient(0, -1.2 * u, 0, 1.2 * u);
      g.addColorStop(0, '#f1d48a');
      g.addColorStop(0.5, '#c79a45');
      g.addColorStop(1, '#6e5222');
      ctx.fillStyle = g;
      ctx.fillRect(-2.6 * u, -1.1 * u, 5.2 * u, 2.2 * u);
      ctx.restore();
    }
  }

  drawShots(ctx, now) {
    const travel = this.reduced ? 1 : TRACER_MS;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.shots) {
      const age = now - s.at;
      const head = clamp01(age / travel);
      const fade = 1 - clamp01((age - travel) / TRACER_FADE_MS);
      const tail = clamp01(head - 0.45 - (1 - fade) * 0.55);
      const hx = s.from.x + (s.to.x - s.from.x) * head, hy = s.from.y + (s.to.y - s.from.y) * head;
      const tx = s.from.x + (s.to.x - s.from.x) * tail, ty = s.from.y + (s.to.y - s.from.y) * tail;
      // The tracer: a hot core thinning as it goes into the scene.
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'rgba(255, 200, 130, 0)');
      g.addColorStop(1, `rgba(255, 236, 200, ${0.95 * fade})`);
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.4 - head * 1.2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // Muzzle flash: a brief warm bloom with a few short spikes.
      if (age < FLASH_MS) {
        const k = 1 - age / FLASH_MS;
        const r = this.size * 0.11 * (0.7 + 0.3 * k);
        const f = ctx.createRadialGradient(s.from.x, s.from.y, 0, s.from.x, s.from.y, r);
        f.addColorStop(0, `rgba(255, 250, 230, ${k})`);
        f.addColorStop(0.35, `rgba(255, 190, 90, ${0.8 * k})`);
        f.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = f;
        ctx.beginPath();
        ctx.arc(s.from.x, s.from.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A small spark where it meets the glass.
      if (age >= travel && fade > 0) {
        const r = 10 * fade;
        const h = ctx.createRadialGradient(s.to.x, s.to.y, 0, s.to.x, s.to.y, r);
        h.addColorStop(0, `rgba(255, 245, 225, ${fade})`);
        h.addColorStop(1, 'rgba(255, 200, 140, 0)');
        ctx.fillStyle = h;
        ctx.beginPath();
        ctx.arc(s.to.x, s.to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
