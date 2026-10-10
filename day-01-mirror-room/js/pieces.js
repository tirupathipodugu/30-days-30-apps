// The mirror as a binary split tree of rectangles, in stage (CSS pixel) coordinates.
// Only the leaves are kept, because only leaves are drawn: each leaf is one piece of glass.
// Breaking a piece replaces that leaf with its two children. This module is pure logic, with no
// drawing; every frame it writes each piece's current shape and look into a float array for the GPU.

import { clamp01, easeInOutCubic, easeOutBack } from './motion.js';

export const MAX_PIECES = 512;
export const MIN_SIDE = 28;            // CSS px, short side of the smallest piece that can exist

const GAP = 4;                         // px of dark gap between neighbouring pieces
const CRACK_MS = 120;                  // the hairline draws out from the tap point
const SETTLE_MS = 230;                 // then the halves slide apart, overshoot and settle
const WAVE_MS = 400;                   // a "break all" wave, centre to edge
const REASSEMBLE_MS = 600;
const WOBBLE_MS = 320;
const FADE_MS = 160;                   // reduced motion: splits and reassembly are quick fades

const MAX_SHIFT = 3;                   // px of reflection misalignment per piece
const MAX_TILT = 0.6 * Math.PI / 180;  // radians
const MAX_LIGHT = 0.04;                // ±4% brightness
const NO_JITTER = Object.freeze({ dx: 0, dy: 0, tilt: 0, light: 1 });

/** Floats per piece per row in the GPU array, and the three rows (see writeGpuData). */
export const GPU_ROWS = 3;
const EDGE = 0.5;                      // px tolerance for "this side touches the stage border"

class Piece {
  constructor(x, y, w, h) {
    // Home rectangle: where this piece sits, and therefore which part of the picture it shows.
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    // The shard look eases from the parent's look (so the split starts seamless) to its own.
    this.from = NO_JITTER;
    this.to = NO_JITTER;
    // The crack this piece was born from.
    this.splitAt = -Infinity;
    this.newEdge = -1;                 // 0 left, 1 top, 2 right, 3 bottom
    this.slideX = 0;                   // direction this half slides when the gap opens
    this.slideY = 0;
    this.crackX = 0;
    this.crackY = 0;
    this.crackLength = 0;
    this.wobbleAt = -Infinity;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
}

function randomJitter() {
  const r = () => Math.random() * 2 - 1;
  return { dx: r() * MAX_SHIFT, dy: r() * MAX_SHIFT, tilt: r() * MAX_TILT, light: 1 + r() * MAX_LIGHT };
}

export class Mirror {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.pieces = [];
    this.reassembleAt = -Infinity;
    this.reduced = false;              // set from prefers-reduced-motion by the caller
    this.version = 0;                  // bumps whenever the set of pieces changes
    this.scratch = { dx: 0, dy: 0, tilt: 0, light: 1 };
  }

  get count() { return this.pieces.length; }

  /** Back to one clean mirror filling a stage of the given size. */
  reset(width, height) {
    this.width = width;
    this.height = height;
    this.pieces = [new Piece(0, 0, width, height)];
    this.reassembleAt = -Infinity;
    this.version++;
  }

  /** Stretch every piece to a new stage size, keeping the pattern of cracks. */
  resize(width, height) {
    const sx = width / this.width;
    const sy = height / this.height;
    for (const p of this.pieces) {
      p.x *= sx; p.w *= sx; p.crackX *= sx;
      p.y *= sy; p.h *= sy; p.crackY *= sy;
      p.crackLength *= Math.max(sx, sy);
    }
    this.width = width;
    this.height = height;
    this.version++;
  }

  isReassembling(now) {
    return now - this.reassembleAt < this.reassembleDuration();
  }

  reassembleDuration() {
    return this.reduced ? FADE_MS : REASSEMBLE_MS;
  }

  /** Index of the piece whose home contains the point (gaps count as the piece beside them). */
  pieceAt(x, y) {
    x = Math.min(Math.max(x, 0), this.width - 0.001);
    y = Math.min(Math.max(y, 0), this.height - 0.001);
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return i;
    }
    return -1;
  }

  /**
   * Crack one piece across its longer side, through (x, y), at 30–70% so both halves are usable.
   * Returns 'broke', 'small' (it wobbles instead), 'full' (512 pieces) or 'busy' (reassembling).
   */
  breakAt(index, x, y, now) {
    if (this.isReassembling(now)) return 'busy';
    if (this.pieces.length >= MAX_PIECES) return 'full';
    const p = this.pieces[index];
    const acrossX = p.w >= p.h;
    const long = acrossX ? p.w : p.h;
    const short = acrossX ? p.h : p.w;
    const lo = Math.max(0.3, MIN_SIDE / long);
    const hi = Math.min(0.7, 1 - MIN_SIDE / long);
    if (short < MIN_SIDE || lo > hi) {
      p.wobbleAt = now;
      return 'small';
    }
    const at = acrossX ? (x - p.x) / p.w : (y - p.y) / p.h;
    this.split(index, acrossX, Math.min(Math.max(at, lo), hi), now, 0, x, y);
    return 'broke';
  }

  /** Split every piece in half along its longer side, in a wave from the centre. Returns how many split. */
  breakAll(now) {
    if (this.isReassembling(now)) return 0;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const farthest = Math.hypot(cx, cy);
    const distance = (p) => Math.hypot(p.cx - cx, p.cy - cy);
    // Centre first, so if the 512 cap stops the wave it stops at the edges.
    const byDistance = this.pieces.slice().sort((a, b) => distance(a) - distance(b));
    let made = 0;
    for (const p of byDistance) {
      if (this.pieces.length >= MAX_PIECES) break;
      const acrossX = p.w >= p.h;
      const long = acrossX ? p.w : p.h;
      const short = acrossX ? p.h : p.w;
      if (long / 2 < MIN_SIDE || short < MIN_SIDE) continue;
      const delay = this.reduced ? 0 : (WAVE_MS - CRACK_MS) * distance(p) / farthest;
      this.split(this.pieces.indexOf(p), acrossX, 0.5, now, delay, p.cx, p.cy);
      made++;
    }
    return made;
  }

  /** Start sliding everything home. Returns false if there is nothing to reassemble. */
  reassemble(now) {
    if (this.pieces.length === 1 || this.isReassembling(now)) return false;
    this.reassembleAt = now;
    return true;
  }

  /** Advance time. Returns true on the frame a reassembly finishes and the mirror is whole again. */
  update(now) {
    if (this.reassembleAt > -Infinity && !this.isReassembling(now)) {
      this.reset(this.width, this.height);
      return true;
    }
    return false;
  }

  /** Pieces sorted top-to-bottom, then left-to-right: the order Tab visits them. */
  readingOrder() {
    return this.pieces.slice().sort((a, b) => (Math.round(a.y) - Math.round(b.y)) || (a.x - b.x));
  }

  split(index, acrossX, at, now, delay, originX, originY) {
    const p = this.pieces[index];
    const look = this.lookAt(p, now);
    let a, b;
    if (acrossX) {
      const cut = p.w * at;
      a = new Piece(p.x, p.y, cut, p.h);
      b = new Piece(p.x + cut, p.y, p.w - cut, p.h);
      a.newEdge = 2; a.slideX = -1;
      b.newEdge = 0; b.slideX = 1;
    } else {
      const cut = p.h * at;
      a = new Piece(p.x, p.y, p.w, cut);
      b = new Piece(p.x, p.y + cut, p.w, p.h - cut);
      a.newEdge = 3; a.slideY = -1;
      b.newEdge = 1; b.slideY = 1;
    }
    const crackLength = acrossX
      ? Math.max(originY - p.y, p.y + p.h - originY)
      : Math.max(originX - p.x, p.x + p.w - originX);
    for (const child of [a, b]) {
      child.from = this.inheritLook(look, p, child);
      child.to = randomJitter();
      child.splitAt = now + delay;
      child.crackX = originX;
      child.crackY = originY;
      child.crackLength = crackLength;
    }
    // Child a keeps the parent's slot, so pieces[0] is always the top-left piece.
    this.pieces[index] = a;
    this.pieces.push(b);
    this.version++;
  }

  /**
   * The parent's look re-expressed around the child's own centre. Each piece tilts its reflection
   * about its centre, so to start the split seamless the child's shift has to absorb the difference.
   */
  inheritLook(look, parent, child) {
    const ox = child.cx - parent.cx;
    const oy = child.cy - parent.cy;
    const c = Math.cos(look.tilt);
    const s = Math.sin(look.tilt);
    return {
      dx: look.dx + ox - (c * ox - s * oy),
      dy: look.dy + oy - (s * ox + c * oy),
      tilt: look.tilt,
      light: look.light,
    };
  }

  /** The piece's current shard look (shift, tilt, brightness). Writes into a shared scratch object. */
  lookAt(p, now) {
    const settle = easeInOutCubic((now - p.splitAt) / (CRACK_MS + SETTLE_MS));
    const whole = 1 - this.reassembleProgress(now);
    const out = this.scratch;
    out.dx = (p.from.dx + (p.to.dx - p.from.dx) * settle) * whole;
    out.dy = (p.from.dy + (p.to.dy - p.from.dy) * settle) * whole;
    out.tilt = (p.from.tilt + (p.to.tilt - p.from.tilt) * settle) * whole;
    out.light = 1 + (p.from.light - 1 + (p.to.light - p.from.light) * settle) * whole;
    return out;
  }

  reassembleProgress(now) {
    if (this.reassembleAt === -Infinity) return 0;
    return easeInOutCubic((now - this.reassembleAt) / this.reassembleDuration());
  }

  /** How strongly cracks and edges show: 1 normally, fading to 0 while reassembling. */
  crackStrength(now) {
    return 1 - this.reassembleProgress(now);
  }

  /**
   * Fill `out` (Float32Array of MAX_PIECES * GPU_ROWS * 4) with one texel per piece in each row:
   *   row 0: displayed rect (x0, y0, x1, y1) in stage px, after gaps and motion
   *   row 1: reflection (shiftX, shiftY, tilt, brightness)
   *   row 2: newest crack (originX, originY, revealed radius, which edge)
   * Runs every frame, so it allocates nothing.
   */
  writeGpuData(now, out) {
    const half = (GAP / 2) * (1 - this.reassembleProgress(now));
    const row1 = MAX_PIECES * 4;
    const row2 = MAX_PIECES * 8;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      const t = now - p.splitAt;
      let open = 1;
      let slide = 0;
      let reveal = 1e9;
      if (t < CRACK_MS + SETTLE_MS) {
        if (this.reduced) {
          open = clamp01(t / FADE_MS);
          reveal = t < 0 ? 0 : 1e9;
        } else {
          const u = (t - CRACK_MS) / SETTLE_MS;
          open = u <= 0 ? 0 : easeOutBack(u);
          slide = u <= 0 ? 0 : 2.5 * Math.sin(Math.PI * u) * (1 - u);
          reveal = t < 0 ? 0 : t < CRACK_MS ? (t / CRACK_MS) * p.crackLength : 1e9;
        }
      }
      let ox = p.slideX * slide;
      let oy = p.slideY * slide;
      const tw = (now - p.wobbleAt) / WOBBLE_MS;
      if (tw < 1 && !this.reduced) ox += 2.5 * Math.sin(tw * 6 * Math.PI) * (1 - tw);

      // Inset each side that is a crack (not the stage border) to open the gap.
      const left = p.x > EDGE ? half * (p.newEdge === 0 ? open : 1) : 0;
      const top = p.y > EDGE ? half * (p.newEdge === 1 ? open : 1) : 0;
      const right = p.x + p.w < this.width - EDGE ? half * (p.newEdge === 2 ? open : 1) : 0;
      const bottom = p.y + p.h < this.height - EDGE ? half * (p.newEdge === 3 ? open : 1) : 0;

      const look = this.lookAt(p, now);
      let k = i * 4;
      out[k] = p.x + left + ox;
      out[k + 1] = p.y + top + oy;
      out[k + 2] = p.x + p.w - right + ox;
      out[k + 3] = p.y + p.h - bottom + oy;
      k = row1 + i * 4;
      out[k] = ox + look.dx;
      out[k + 1] = oy + look.dy;
      out[k + 2] = look.tilt;
      out[k + 3] = look.light;
      k = row2 + i * 4;
      out[k] = p.crackX;
      out[k + 1] = p.crackY;
      out[k + 2] = reveal;
      out[k + 3] = p.newEdge;
    }
  }
}
