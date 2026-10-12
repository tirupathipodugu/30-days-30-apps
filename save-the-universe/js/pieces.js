// Pieces: the universe is drawn as separate pieces on a 2D canvas, and the black hole tears them
// off one by one, nearest first. A torn piece wobbles loose, spirals in under the hole's gravity,
// stretches along the line to the hole (tidal forces), shrinks and is gone, leaving empty space
// behind. If you save the universe, every piece flies back home. The sky goes last.

import { buildUniverse } from './universes.js';

const WOBBLE = 0.35;      // seconds a piece shakes before it tears loose

export class Pieces {
  constructor(universe, w, h, scale) {
    this.universe = universe;
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d');
    this.layout(w, h, scale);
  }

  layout(w, h, scale) {
    this.w = w;
    this.h = h;
    this.k = scale;
    this.L = Math.min(w, h);
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    this.list = buildUniverse(this.universe, w, h).map((p) => piece(p));
    // Small pieces cost less, so a sky full of stars drains at a steady pace.
    const unit = (this.L / 7) ** 2;
    for (const p of this.list) p.cost = Math.max(0.12, Math.min(1.5, (p.w * p.h) / unit));
    this.eaten = 0;
    this.releaseClock = 0;
  }

  get total() { return this.list.length; }
  get remaining() { return this.list.filter((p) => p.state === 'home').length; }
  get flying() { return this.list.filter((p) => p.state === 'flying'); }

  /** Advance the pieces. pullR is how far the hole reaches (CSS px); rate is pieces per second. */
  update(dt, world, pullR, rate, mode) {
    const hole = world.hole;
    if (mode !== 'won') {
      this.releaseClock += dt * rate;
      // Everything in reach, nearest first; the sky only once what's on it has gone.
      const ready = this.list.filter((p) => p.state === 'home' && distToRect(hole, p) < pullR && !(p.sheet && sheetBlocked(this.list, p)));
      ready.sort((a, b) => distToRect(hole, a) - distToRect(hole, b));
      while (ready.length && this.releaseClock >= ready[0].cost) {
        const p = ready.shift();
        this.releaseClock -= p.cost;
        p.state = 'wobble';
        p.timer = WOBBLE;
      }
      if (!ready.length) this.releaseClock = Math.min(this.releaseClock, 1);
    }

    // The same 1/r pull as yours, stronger, so pieces visibly fall in.
    const G = world.G0 * 4 * (mode === 'lost' ? 3 : 1);
    for (const p of this.list) {
      if (p.state === 'wobble') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.state = 'flying';
          // A little sideways speed so it spirals in instead of dropping straight.
          const dx = p.x - hole.x, dy = p.y - hole.y, r = Math.hypot(dx, dy) || 1;
          const v = Math.sqrt(G) * 0.5 * p.spin;
          p.vx = (-dy / r) * v;
          p.vy = (dx / r) * v;
        }
      } else if (p.state === 'flying') {
        const dx = hole.x - p.x, dy = hole.y - p.y, r = Math.hypot(dx, dy) || 1;
        const a = G / Math.max(r, world.rs);
        p.vx += (dx / r) * a * dt;
        p.vy += (dy / r) * a * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spinRate * dt;
        p.hitCool = Math.max(0, (p.hitCool || 0) - dt);
        if (r < world.rs * 1.05) { p.state = 'gone'; this.eaten += 1; }
      } else if (p.state === 'return') {
        p.timer = Math.min(1, p.timer + dt / 0.9);
        const e = 1 - Math.pow(1 - p.timer, 3);
        p.x = p.fromX + (p.hx - p.fromX) * e;
        p.y = p.fromY + (p.hy - p.fromY) * e;
        p.rot = p.fromRot * (1 - e);
        if (p.timer >= 1) { p.state = 'home'; p.x = p.hx; p.y = p.hy; p.rot = 0; }
      }
    }
  }

  /** Bring every piece home (the universe is saved). */
  restore(world) {
    for (const p of this.list) {
      if (p.state === 'home') continue;
      const gone = p.state === 'gone';
      p.fromX = gone ? world.hole.x : p.x;
      p.fromY = gone ? world.hole.y : p.y;
      p.fromRot = gone ? 0 : p.rot;
      p.state = 'return';
      p.timer = 0;
    }
  }

  /** The size of a flying piece right now, for collisions with your bubble. */
  hitRadius(p, world) {
    const r = Math.hypot(world.hole.x - p.x, world.hole.y - p.y);
    const shrink = Math.max(0.05, Math.min(1, (r - world.rs) / (world.rs * 6)));
    return 0.42 * Math.min(p.w, p.h) * shrink + 0.15 * Math.max(p.w, p.h) * shrink;
  }

  draw(world, time) {
    const g = this.g, k = this.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const hole = world.hole;
    // The sky first, then everything at home, then what's falling on top.
    const order = [...this.list].sort((a, b) => rank(a) - rank(b));
    for (const p of order) {
      if (p.state === 'gone') continue;
      let x = p.x, y = p.y, sx = 1, sy = 1, along = 0;
      if (p.state === 'wobble') {
        const j = (1 - p.timer / WOBBLE) * 3;
        x += Math.sin(time * 70 + p.seed * 9) * j;
        y += Math.cos(time * 63 + p.seed * 5) * j;
      } else if (p.state === 'flying' || p.state === 'return') {
        // Tidal stretch: long toward the hole, thin across, and smaller as it nears the horizon.
        const dx = hole.x - x, dy = hole.y - y, r = Math.hypot(dx, dy) || 1;
        along = Math.atan2(dy, dx);
        const tide = Math.min(4, (world.rs * 2.2) / r);
        sx = 1 + tide * 1.6;
        sy = 1 / (1 + tide);
        const shrink = Math.max(0.05, Math.min(1, (r - world.rs) / (world.rs * 6)));
        sx *= shrink;
        sy *= shrink;
        if (p.state === 'return') { const e = p.timer; sx += (1 - sx) * e; sy += (1 - sy) * e; }
      }
      g.save();
      g.translate(x, y);
      if (along) {
        g.rotate(along);
        g.scale(sx, sy);
        g.rotate(-along);
      }
      g.rotate(p.rot);
      if (p.twinkle !== undefined) g.globalAlpha = 0.75 + 0.25 * Math.sin(time * 2.3 + p.twinkle);
      g.drawImage(p.img, -p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
      // Small name under named things while they're still in place.
      if (p.label && (p.state === 'home' || p.state === 'wobble')) {
        g.font = '500 10px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillStyle = 'rgba(255,255,255,.62)';
        g.fillText(p.label, x, Math.min(this.h - 12, y + Math.min(p.h, 60) / 2 + 2));
      }
    }
  }
}

const rank = (p) => (p.sheet ? 0 : 1) + (p.state === 'flying' ? 2 : 0);

function distToRect(pt, p) {
  const cx = Math.max(p.hx - p.w / 2, Math.min(pt.x, p.hx + p.w / 2));
  const cy = Math.max(p.hy - p.h / 2, Math.min(pt.y, p.hy + p.h / 2));
  return Math.hypot(pt.x - cx, pt.y - cy);
}

/** Sheets (the page, the sky) only tear once nothing else on them is left. */
function sheetBlocked(list, sheet) {
  return list.some((p) => !p.sheet && p.state === 'home' && Math.abs(p.hx - sheet.hx) < sheet.w / 2 && Math.abs(p.hy - sheet.hy) < sheet.h / 2);
}

function piece(p) {
  return {
    ...p, x: p.hx, y: p.hy, rot: 0, seed: Math.random(),
    spin: Math.random() < 0.5 ? 1 : 1.15,
    spinRate: (Math.random() - 0.5) * 6,
    state: 'home', timer: 0, vx: 0, vy: 0,
  };
}
