// The mirror's glass: a set of shard polygons, plus every crack drawn between them.
// It starts as one rectangle. Each impact (see fracture.js) cuts shards in two along crack paths.
// Every shard keeps showing its own part of the reflection, slightly misaligned, as if tilted a hair
// in its frame: a facet normal, a small shift and twist, and its own brightness and tint. A broken
// piece can also fall out of the frame (see debris.js), leaving a hole that shows the ocean behind
// the mirror. This module is pure logic; every frame it writes each shard's look into a float array
// for the GPU.

import { fracture } from './fracture.js';
import { splitPolygon, pointInPolygon, centroid, bounds, triangulate, distance, signedArea } from './geometry.js';
import { clamp01, easeInOutCubic } from './motion.js';

export const MAX_SHARDS = 2000;
export const GPU_ROWS = 3;

export const CRACK_MS = 150;           // cracks race out from the impact
const SETTLE_MS = 180;                 // a shard tips to its new angle as the crack passes it
const HEAL_MS = 1000;                  // restore: cracks heal back into the impact points
const FADE_MS = 200;                   // reduced motion: restore is a short fade
const MIN_AREA = 0.8;                  // px²: smaller slivers are not cut off
export const LOOSE_AREA = 0.03;        // a tapped piece under this share of the glass falls out; a bigger one cracks
export const RIM_PX = 6;               // px: the bevel drawn inside a hole, along the glass's cut edge
const RIM_CELL = 48;                   // px: grid cell for finding which hole lies across an edge
export const RIM_FLOATS = 5;           // x, y, normal into the hole x, y, across (0 at the edge, 1 inside)

const SHIFT_PER_TILT = 240;            // px of reflection shift per radian of facet tilt
const FLAT = Object.freeze({ dx: 0, dy: 0, rot: 0, nx: 0, ny: 0, light: 1, tint: 0 });

function gaussian(random) {
  return (random() + random() + random() - 1.5) / 0.75;
}

/** A shard's reflection look: tilted by up to ~1° near the impact, a fraction of that far away. */
function randomLook(strength, parent) {
  const r = Math.random;
  const nx = parent.nx * 0.5 + gaussian(r) * 0.013 * strength;
  const ny = parent.ny * 0.5 + gaussian(r) * 0.013 * strength;
  return {
    nx,
    ny,
    dx: -nx * SHIFT_PER_TILT + gaussian(r) * 0.4,
    dy: -ny * SHIFT_PER_TILT + gaussian(r) * 0.4,
    rot: gaussian(r) * 0.0035 * strength,
    // Facets tipped toward the room light (upper left) read a touch brighter.
    light: 1 + (-nx * 0.6 - ny * 0.8) * 3 + gaussian(r) * 0.015 * strength,
    tint: gaussian(r) * 0.018 * strength,
  };
}

class Shard {
  constructor(poly, from, to, settleAt) {
    this.poly = poly;
    this.box = bounds(poly);
    this.center = centroid(poly);
    this.from = from;
    this.to = to;
    this.settleAt = settleAt;
    this.area = Math.abs(signedArea(poly));
    this.missing = false;              // chipped out at the impact, or fallen: the ocean behind shows
    this.fallen = false;               // knocked out of the frame by a tap or a sweep
    this.frost = 0;                    // crushed glass right by the impact scatters light
    this.triangles = null;
  }

  contains(x, y) {
    const b = this.box;
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && pointInPolygon(this.poly, x, y);
  }
}

export class Mirror {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.shards = [];
    this.cracks = [];                  // { points (each with .along), impact }
    this.impacts = [];                 // { x, y, at, reach }
    this.healAt = -Infinity;
    this.reduced = false;
    this.version = 0;                  // bumps whenever shards or cracks change
    this.current = null;               // the impact being applied
    this.look = { dx: 0, dy: 0, rot: 0, nx: 0, ny: 0, light: 1, tint: 0 };
  }

  /** Shards still in the frame (chipped-out ones don't count). */
  get count() {
    let n = 0;
    for (const s of this.shards) if (!s.missing) n++;
    return n;
  }

  /** Pieces that have fallen out of the frame. */
  get fallen() {
    let n = 0;
    for (const s of this.shards) if (s.fallen) n++;
    return n;
  }

  /** True once any glass is gone, so the ocean behind can show. */
  get holes() {
    for (const s of this.shards) if (s.missing) return true;
    return false;
  }

  /** The share of the frame still covered by glass, 0..1. */
  glassLeft() {
    let area = 0;
    for (const s of this.shards) if (!s.missing) area += s.area;
    return area / (this.width * this.height);
  }

  /** Can this piece come out of the frame? Only once the mirror is broken, and not mid-restore. */
  canFall(shard, now) {
    return !!shard && !shard.missing && !this.whole && !this.isHealing(now);
  }

  /** Small enough that a tap knocks it out, rather than cracking it further. */
  isLoose(shard) {
    return shard.area <= LOOSE_AREA * this.width * this.height;
  }

  /** The piece leaves the frame; its outline stays behind as a hole. */
  detach(shard, now) {
    shard.missing = true;
    shard.fallen = true;
    shard.fallenAt = now;
    this.version++;
  }

  get whole() {
    return this.shards.length === 1;
  }

  reset(width, height) {
    this.width = width;
    this.height = height;
    const poly = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    this.shards = [new Shard(poly, FLAT, FLAT, -Infinity)];
    this.cracks = [];
    this.impacts = [];
    this.healAt = -Infinity;
    this.version++;
  }

  /** Stretch everything to a new stage size. Points are shared between shards and cracks, so scale each once. */
  resize(width, height) {
    const sx = width / this.width;
    const sy = height / this.height;
    const seen = new Set();
    const scale = (p) => {
      if (seen.has(p)) return;
      seen.add(p);
      p.x *= sx;
      p.y *= sy;
    };
    for (const s of this.shards) {
      s.poly.forEach(scale);
      s.box = bounds(s.poly);
      s.center = centroid(s.poly);
      s.area *= sx * sy;
      s.triangles = null;
    }
    for (const c of this.cracks) c.points.forEach(scale);
    for (const i of this.impacts) {
      i.x *= sx;
      i.y *= sy;
    }
    this.width = width;
    this.height = height;
    this.version++;
  }

  shardAt(x, y) {
    for (const s of this.shards) if (s.contains(x, y)) return s;
    return null;
  }

  isHealing(now) {
    return now - this.healAt < this.healDuration();
  }

  healDuration() {
    return this.reduced ? FADE_MS : HEAL_MS;
  }

  /** Strike the glass at (x, y). Returns 'broke', 'full' (at the shard cap), 'busy' or 'none'. */
  impact(x, y, now) {
    if (this.isHealing(now)) return 'busy';
    if (this.shards.length >= MAX_SHARDS - 4) return 'full';
    const impact = { x, y, at: now, reach: 1 };
    this.current = impact;
    this.created = [];
    const result = fracture(this, x, y);
    this.current = null;
    if (!result.cracks) return 'none';
    impact.reach = result.reach;
    this.impacts.push(impact);
    // Settle each new shard as the crack front reaches it, and chip out the crushed centre.
    for (const s of this.created) {
      const d = distance(s.center, impact);
      s.settleAt = now + this.crackDelay(d / impact.reach);
      if (d < result.crushRadius * 0.85) s.missing = true;
      else if (d < result.crushRadius * 2.6) s.frost = (0.12 + Math.random() * 0.45) * (1.2 - d / (result.crushRadius * 2.6));
    }
    this.created = null;
    this.version++;
    return 'broke';
  }

  /** When the crack front, easing out like real fracture, reaches a fraction `f` of its reach. */
  crackDelay(f) {
    if (this.reduced) return 0;
    return CRACK_MS * (1 - Math.cbrt(1 - clamp01(f)));
  }

  /** Cut `shard` along `path` (both ends on its outline). Called by fracture.js. */
  split(shard, path) {
    if (this.shards.length >= MAX_SHARDS || shard.fallen) return false;   // cracks stop at a hole
    const halves = splitPolygon(shard.poly, path, MIN_AREA);
    if (!halves) return false;
    const impact = this.current;
    const look = this.lookAt(shard, impact.at);
    const children = halves.map((poly) => {
      const child = new Shard(poly, null, null, impact.at);
      const strength = 0.3 + 1.1 * Math.exp(-distance(child.center, impact) / 170);
      child.from = this.inheritLook(look, shard.center, child.center);
      child.to = randomLook(strength, shard.to);
      child.missing = shard.missing;
      child.frost = shard.frost;
      return child;
    });
    const index = this.shards.indexOf(shard);
    this.shards[index] = children[0];
    this.shards.push(children[1]);
    if (this.created) {
      const at = this.created.indexOf(shard);
      if (at >= 0) this.created.splice(at, 1);
      this.created.push(...children);
    }
    this.cracks.push({ points: path, impact });
    return true;
  }

  /**
   * The parent's look re-expressed around the child's centre: each shard twists its reflection about
   * its own centre, so the child's shift absorbs the difference and the cut starts seamless.
   */
  inheritLook(look, parentCenter, childCenter) {
    const ox = childCenter.x - parentCenter.x;
    const oy = childCenter.y - parentCenter.y;
    const c = Math.cos(look.rot), s = Math.sin(look.rot);
    return {
      ...look,
      dx: look.dx + ox - (c * ox - s * oy),
      dy: look.dy + oy - (s * ox + c * oy),
    };
  }

  /** Start restoring. Returns false if there's nothing to restore. */
  heal(now) {
    if (this.whole || this.isHealing(now)) return false;
    this.healAt = now;
    return true;
  }

  /** 0 normally, rising to 1 as a restore completes. */
  healProgress(now) {
    if (this.healAt === -Infinity) return 0;
    return easeInOutCubic((now - this.healAt) / this.healDuration());
  }

  /** Advance time. Returns true on the frame a restore finishes and the mirror is whole again. */
  update(now) {
    if (this.healAt > -Infinity && !this.isHealing(now)) {
      this.reset(this.width, this.height);
      return true;
    }
    return false;
  }

  /** A shard's current look. Writes into a shared scratch object, so it allocates nothing. */
  lookAt(s, now) {
    const k = this.reduced ? (now >= s.settleAt ? 1 : 0) : easeInOutCubic((now - s.settleAt) / SETTLE_MS);
    const keep = 1 - this.healProgress(now);
    const out = this.look;
    const a = s.from, b = s.to;
    out.dx = (a.dx + (b.dx - a.dx) * k) * keep;
    out.dy = (a.dy + (b.dy - a.dy) * k) * keep;
    out.rot = (a.rot + (b.rot - a.rot) * k) * keep;
    out.nx = (a.nx + (b.nx - a.nx) * k) * keep;
    out.ny = (a.ny + (b.ny - a.ny) * k) * keep;
    out.light = 1 + (a.light - 1 + (b.light - a.light) * k) * keep;
    out.tint = (a.tint + (b.tint - a.tint) * k) * keep;
    return out;
  }

  /** Triangles for every shard, as (x, y, shard index) per vertex. Only rebuilt when shards change. */
  buildMesh() {
    let total = 0;
    for (const s of this.shards) {
      if (!s.triangles) s.triangles = triangulate(s.poly);
      total += s.triangles.length;
    }
    const data = new Float32Array(total * 3);
    let k = 0;
    this.shards.forEach((s, id) => {
      for (const p of s.triangles) {
        data[k++] = p.x;
        data[k++] = p.y;
        data[k++] = id;
      }
    });
    return data;
  }

  /**
   * The bevel around every hole: a strip along each glass edge that has a hole on its other side,
   * reaching RIM_PX into the hole. Holes are found through a coarse grid, so this stays quick with
   * thousands of shards. Returns RIM_FLOATS per vertex, six vertices per edge.
   */
  buildRims() {
    const grid = new Map();
    for (const h of this.shards) {
      if (!h.missing) continue;
      const b = h.box;
      for (let cx = Math.floor(b.x0 / RIM_CELL); cx <= Math.floor(b.x1 / RIM_CELL); cx++) {
        for (let cy = Math.floor(b.y0 / RIM_CELL); cy <= Math.floor(b.y1 / RIM_CELL); cy++) {
          const key = cx * 4096 + cy;
          let cell = grid.get(key);
          if (!cell) grid.set(key, (cell = []));
          cell.push(h);
        }
      }
    }
    if (!grid.size) return new Float32Array(0);
    const holeAt = (x, y) => {
      const cell = grid.get(Math.floor(x / RIM_CELL) * 4096 + Math.floor(y / RIM_CELL));
      if (cell) for (const h of cell) if (h.contains(x, y)) return true;
      return false;
    };
    const out = [];
    const vertex = (p, nx, ny, across) => out.push(p.x + nx * across * RIM_PX, p.y + ny * across * RIM_PX, nx, ny, across);
    for (const s of this.shards) {
      if (s.missing) continue;
      const poly = s.poly;
      const sign = signedArea(poly) >= 0 ? 1 : -1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 0.3) continue;
        // Outward from this shard: the left normal points inward for a positive signed area.
        const nx = (sign * (b.y - a.y)) / length, ny = (-sign * (b.x - a.x)) / length;
        const mx = (a.x + b.x) / 2 + nx * 1.5, my = (a.y + b.y) / 2 + ny * 1.5;
        if (!holeAt(mx, my)) continue;
        const tx = ((b.x - a.x) / length) * 0.5, ty = ((b.y - a.y) / length) * 0.5;
        const a2 = { x: a.x - tx, y: a.y - ty }, b2 = { x: b.x + tx, y: b.y + ty };
        vertex(a2, nx, ny, 0); vertex(b2, nx, ny, 0); vertex(b2, nx, ny, 1);
        vertex(a2, nx, ny, 0); vertex(b2, nx, ny, 1); vertex(a2, nx, ny, 1);
      }
    }
    return new Float32Array(out);
  }

  /**
   * Fill `out` (Float32Array of MAX_SHARDS * GPU_ROWS * 4), one texel per shard in each row:
   *   row 0: reflection (shiftX, shiftY, twist, brightness)
   *   row 1: (centreX, centreY, facet normal x, facet normal y)
   *   row 2: (tint, frost, opacity of the glass, unused)
   * Runs every frame, so it allocates nothing.
   */
  writeGpuData(now, out) {
    const heal = this.healProgress(now);
    const row1 = MAX_SHARDS * 4;
    const row2 = MAX_SHARDS * 8;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      const look = this.lookAt(s, now);
      let k = i * 4;
      out[k] = look.dx;
      out[k + 1] = look.dy;
      out[k + 2] = look.rot;
      out[k + 3] = look.light;
      k = row1 + i * 4;
      out[k] = s.center.x;
      out[k + 1] = s.center.y;
      out[k + 2] = look.nx;
      out[k + 3] = look.ny;
      k = row2 + i * 4;
      out[k] = look.tint;
      out[k + 1] = s.frost * (1 - heal);
      out[k + 2] = s.missing && (s.fallen || now >= s.settleAt) ? heal : 1;
      out[k + 3] = 0;
    }
  }
}
