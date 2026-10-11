// Debris: pieces of glass that have come out of the frame. A piece keeps its slice of the reflection
// as it drops: it falls with gravity, turns in the plane and tips over on a random axis. Tipping is
// faked in 2D by squashing the piece across that axis, shifting its reflection and dimming it as it
// turns away from the light; past 90° the painted back shows. Where it meets the floor (the bottom
// edge of the screen) a few splinters jump up once and fade. Pure logic: every frame it writes all
// pieces as triangles for the renderer's debris pass.

import { triangulate } from './geometry.js';
import { clamp01 } from './motion.js';

export const DEBRIS_FLOATS = 9;        // x, y, source x, source y, shade, sheen, mode, alpha, frost
const MODE_FACE = 0, MODE_EDGE = 1, MODE_BACK = 2, MODE_SHADOW = 3;

const MAX_FALLING = 24;                // pieces in flight at once; beyond that a piece just fades
const MAX_PIECES = 64;                 // anything past this leaves no debris at all
const FADE_MS = 260;                   // reduced motion (and overflow): a piece fades where it was
const VANISH_MS = 220;                 // restore: pieces in flight fade away
const TILT_SHIFT = 420;                // px of reflection shift per unit of sin(tilt)
const THICKNESS = 3.5;                 // px of glass edge seen as a piece tips
const SHADOW = { x: 6, y: 10, ms: 350 };
const BIT_LIFE_MS = 750;

class Piece {
  constructor(local, x, y, look, frost, kind) {
    this.local = local;                // triangle vertices around the centre, flat x/y pairs
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.rot = 0;
    this.spin = 0;
    this.tilt = 0;
    this.tiltRate = 0;
    this.axis = Math.random() * Math.PI;
    this.dx = look.dx;                 // the reflection shift it had in the frame
    this.dy = look.dy;
    this.light = look.light;
    this.frost = frost;
    this.kind = kind;                  // 'fall', 'fade' or 'bit'
    this.born = 0;
    this.landed = false;
    this.alpha = 1;
    this.vanishAt = Infinity;
    let r = 0;
    for (let i = 0; i < local.length; i += 2) r = Math.max(r, Math.hypot(local[i], local[i + 1]));
    this.radius = r;
  }
}

export class Debris {
  constructor() {
    this.pieces = [];
    this.landings = [];                // filled by update(): { x, size } for each piece reaching the floor
    this.data = new Float32Array(4096);
    this.vertices = 0;
    this.last = 0;
  }

  get active() {
    return this.pieces.length > 0;
  }

  clear() {
    this.pieces.length = 0;
    this.vertices = 0;
  }

  /** Restore: whatever is still in the air fades out. */
  vanish(now) {
    for (const p of this.pieces) p.vanishAt = Math.min(p.vanishAt, now);
  }

  /** Knock `shard` out of the frame, nudged away from (tapX, tapY). `look` is its current reflection look. */
  drop(shard, look, frost, tapX, tapY, now, reduced) {
    if (this.pieces.length >= MAX_PIECES) return;
    const tris = shard.triangles || triangulate(shard.poly);
    const c = shard.center;
    const local = new Float32Array(tris.length * 2);
    tris.forEach((p, i) => {
      local[i * 2] = p.x - c.x;
      local[i * 2 + 1] = p.y - c.y;
    });
    let falling = 0;
    for (const p of this.pieces) if (p.kind === 'fall') falling++;
    const piece = new Piece(local, c.x, c.y, look, frost, reduced || falling >= MAX_FALLING ? 'fade' : 'fall');
    piece.born = now;
    if (piece.kind === 'fall') {
      // A small push away from the finger, a slight pop out of the frame, then gravity takes it.
      let ax = c.x - tapX, ay = c.y - tapY;
      const len = Math.hypot(ax, ay);
      if (len < 1) {
        const a = Math.random() * Math.PI * 2;
        ax = Math.cos(a);
        ay = Math.sin(a);
      } else {
        ax /= len;
        ay /= len;
      }
      const push = 45 + Math.random() * 70;
      piece.vx = ax * push;
      piece.vy = ay * push * 0.5 - (30 + Math.random() * 60);
      // Big pieces turn slowly; slivers flick round.
      const size = Math.sqrt(shard.area);
      const nimble = Math.min(1.6, Math.pow(80 / Math.max(20, size), 0.45));
      piece.spin = (Math.random() - 0.5) * 2.4 * nimble;
      piece.tiltRate = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2.2) * nimble;
    }
    this.pieces.push(piece);
  }

  /** Advance every piece. `height` is where the floor is. Landings are left in this.landings. */
  update(now, height) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.landings.length = 0;
    if (!this.pieces.length) return;
    const gravity = Math.max(1700, height * 2.6);
    const bits = [];
    this.pieces = this.pieces.filter((p) => {
      const age = now - p.born;
      const vanish = 1 - clamp01((now - p.vanishAt) / VANISH_MS);
      if (p.kind === 'fade') {
        p.alpha = (1 - clamp01(age / FADE_MS)) * vanish;
        return p.alpha > 0;
      }
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.tilt += p.tiltRate * dt;
      if (p.kind === 'bit') {
        p.alpha = (1 - clamp01((age - BIT_LIFE_MS * 0.45) / (BIT_LIFE_MS * 0.55))) * vanish;
        return p.alpha > 0 && p.y - p.radius < height + 4;
      }
      p.alpha = vanish;
      if (!p.landed && p.y + p.radius * 0.5 >= height) {
        p.landed = true;
        if (vanish > 0.5) {
          this.landings.push({ x: p.x, size: p.radius });
          this.splinter(p, height, now, bits);
        }
      }
      return p.alpha > 0 && p.y - p.radius < height + 30;
    });
    for (const b of bits) if (this.pieces.length < MAX_PIECES + 16) this.pieces.push(b);
  }

  /** 2–4 tiny bits thrown up from where a piece struck the floor. */
  splinter(p, height, now, out) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const r = 2 + Math.random() * Math.min(6, 1 + p.radius * 0.06);
      const a0 = Math.random() * Math.PI * 2;
      const local = new Float32Array(6);
      for (let k = 0; k < 3; k++) {
        const a = a0 + k * 2.1 + (Math.random() - 0.5) * 0.8;
        const d = r * (0.6 + Math.random() * 0.4);
        local[k * 2] = Math.cos(a) * d;
        local[k * 2 + 1] = Math.sin(a) * d;
      }
      const bit = new Piece(local, p.x + (Math.random() - 0.5) * p.radius * 0.9, height - 1,
        { dx: p.dx, dy: p.dy, light: p.light }, p.frost, 'bit');
      bit.born = now;
      bit.vx = (Math.random() - 0.5) * 260;
      bit.vy = -(140 + Math.random() * 200);
      bit.spin = (Math.random() - 0.5) * 16;
      bit.tilt = Math.random() * 3;
      bit.tiltRate = (Math.random() - 0.5) * 18;
      out.push(bit);
    }
  }

  /** Write every piece as triangles into this.data. `light` is the pointer light [x, y, height]. */
  write(now, light) {
    let need = 0;
    for (const p of this.pieces) need += (p.local.length / 2) * (p.kind === 'bit' ? 1 : 3) * DEBRIS_FLOATS;
    if (need > this.data.length) this.data = new Float32Array(Math.ceil(need * 1.5));
    const out = this.data;
    let k = 0;
    for (const p of this.pieces) {
      const c = Math.cos(p.tilt), s = Math.sin(p.tilt);
      const squash = Math.max(0.06, Math.abs(c));
      const ux = Math.cos(p.axis), uy = Math.sin(p.axis);
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      // The source of the reflection: the frame's misalignment, plus a big swing as the piece tips.
      const sx = ux * s * TILT_SHIFT - p.dx, sy = uy * s * TILT_SHIFT - p.dy;
      // A glint when the tipped face catches the pointer light.
      let lx = light[0] - p.x, ly = light[1] - p.y, lz = light[2];
      const ll = Math.hypot(lx, ly, lz);
      lx /= ll; ly /= ll; lz = lz / ll + 1;
      const hl = Math.hypot(lx, ly, lz);
      const spec = Math.pow(Math.max(0, (ux * s * lx + uy * s * ly + c * lz) / hl), 160);
      const front = c >= 0;
      const shade = front ? p.light * (0.4 + 0.6 * squash) : 0.5 + 0.5 * squash;
      const sheen = front ? spec * 0.5 : 0;
      const emit = (ox, oy, mode, shadeOut, sheenOut, alpha) => {
        const l = p.local;
        for (let i = 0; i < l.length; i += 2) {
          const rx = cr * l[i] - sr * l[i + 1];
          const ry = sr * l[i] + cr * l[i + 1];
          const d = (rx * ux + ry * uy) * (1 - squash);
          const x = p.x + rx - d * ux + ox, y = p.y + ry - d * uy + oy;
          out[k++] = x;
          out[k++] = y;
          out[k++] = x + sx;
          out[k++] = y + sy;
          out[k++] = shadeOut;
          out[k++] = sheenOut;
          out[k++] = mode;
          out[k++] = alpha;
          out[k++] = p.frost;
        }
      };
      if (p.kind !== 'bit') {
        const away = clamp01((now - p.born) / SHADOW.ms);
        emit(SHADOW.x * away, SHADOW.y * away, MODE_SHADOW, 0, 0, p.alpha * away);
      }
      const edge = s * THICKNESS * (front ? -1 : 1);
      if (p.kind !== 'bit') emit(ux * edge, uy * edge, MODE_EDGE, 0.55 + 0.45 * Math.abs(s), sheen, p.alpha);
      emit(0, 0, front ? MODE_FACE : MODE_BACK, shade, sheen, p.alpha);
    }
    this.vertices = k / DEBRIS_FLOATS;
    return this.vertices;
  }
}
