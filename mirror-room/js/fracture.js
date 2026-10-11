// Fracture: what one impact does to the glass.
// Like a real struck mirror, an impact sends 7–12 jagged radial cracks out from the point. Then
// 2–4 rough concentric rings cut the wedges between them, two tight rings crush the centre, and a few
// branches split off the radials. Every crack is traced through the shard it starts in and stops at
// the first crack or edge it meets, so new cracks end at old ones, as in real glass. Each crack that
// crosses a shard splits that polygon in two (see Mirror.split).

import { segmentHit, lerpPoint, distance } from './geometry.js';

const TAU = Math.PI * 2;

/** A jagged crack heading out from `from` at `angle`, wandering a little but keeping its heading. */
function jaggedRay(from, angle, length, random) {
  const points = [from];
  let a = angle;
  let p = from;
  let along = from.along;
  while (along - from.along < length) {
    const out = along - from.along;
    a += (random() - 0.5) * 0.42 + (angle - a) * 0.3;
    const step = 5 + out * 0.07 + random() * 9;
    p = { x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step, along: along + step };
    along += step;
    points.push(p);
  }
  return points;
}

/**
 * Follow `path` from its first point through `poly` until it meets the polygon's outline.
 * Returns the points up to and including that meeting point, or null if it never meets it.
 */
function traceInside(poly, path, startsOnOutline) {
  const out = [path[0]];
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k], b = path[k + 1];
    const length = distance(a, b);
    const skip = k === 0 && startsOnOutline ? 0.05 / length : 1e-9;
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const hit = segmentHit(a, b, poly[i], poly[(i + 1) % poly.length]);
      if (hit && hit.t > skip && (!best || hit.t < best.t)) best = hit;
    }
    if (best) {
      const p = lerpPoint(a, b, best.t);
      p.along = a.along + (b.along - a.along) * best.t;
      out.push(p);
      return out;
    }
    out.push(b);
  }
  return null;
}

/** The point where a traced radial first reaches `radius` from the impact, or null. */
function pointAtRadius(points, center, radius) {
  for (let k = 0; k + 1 < points.length; k++) {
    const s0 = points[k], s1 = points[k + 1];
    if (distance(s1, center) < radius) continue;
    if (distance(s0, center) >= radius) return null;
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    const fx = s0.x - center.x, fy = s0.y - center.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    const p = lerpPoint(s0, s1, t);
    p.along = s0.along + (s1.along - s0.along) * t;
    return p;
  }
  return null;
}

/** Trace `path` inside whichever shard it heads into, and split that shard. Returns the crack or null. */
function crack(mirror, path, startsOnOutline) {
  const a = path[0], b = path[1];
  const d = distance(a, b) || 1;
  const shard = mirror.shardAt((a.x + (b.x - a.x) * 0.4 / d), (a.y + (b.y - a.y) * 0.4 / d));
  if (!shard) return null;
  const traced = traceInside(shard.poly, path, startsOnOutline);
  if (!traced || !mirror.split(shard, traced)) return null;
  return traced;
}

/**
 * Break the glass at (x, y). Returns { cracks, reach, crushRadius }: how many cracks it made,
 * how far the crack network runs (for the propagation animation) and the size of the crushed centre.
 */
export function fracture(mirror, x, y, random = Math.random) {
  const center = { x, y, along: 0 };
  const length = Math.hypot(mirror.width, mirror.height) * 1.25;
  let cracks = 0;
  let reach = 1;
  const note = (traced) => {
    cracks++;
    reach = Math.max(reach, traced[traced.length - 1].along);
  };

  // 1. Radial cracks, at irregular angles.
  const count = 7 + Math.floor(random() * 6);
  const spacing = TAU / count;
  const turn = random() * TAU;
  const rays = Array.from({ length: count }, (_, i) =>
    jaggedRay(center, turn + i * spacing + (random() - 0.5) * spacing * 0.75, length, random));

  // The first two run through the impact as one cut; every later one starts from the impact point.
  const traced = new Array(count).fill(null);
  const first = mirror.shardAt(x, y);
  if (!first) return { cracks, reach, crushRadius: 0 };
  const half = Math.floor(count / 2);
  const left = traceInside(first.poly, rays[0], false);
  const right = traceInside(first.poly, rays[half], false);
  if (!left || !right) return { cracks, reach, crushRadius: 0 };
  const through = [...left.slice().reverse(), ...right.slice(1)];
  if (!mirror.split(first, through)) return { cracks, reach, crushRadius: 0 };
  traced[0] = left;
  traced[half] = right;
  note(left);
  note(right);
  for (let i = 1; i < count; i++) {
    if (i === half) continue;
    traced[i] = crack(mirror, rays[i], true);
    if (traced[i]) note(traced[i]);
  }

  // 2. Rings: two tight ones crush the centre, then 2–4 looser ones further out.
  const crushRadius = 6 + random() * 3;
  const radii = [crushRadius, crushRadius * 1.9 + random() * 3];
  let r = 22 + random() * 16;
  for (let k = 2 + Math.floor(random() * 3); k > 0; k--) {
    radii.push(r);
    r *= 1.7 + random() * 0.7;
  }
  const live = traced.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  for (const radius of radii) {
    for (let n = 0; n < live.length; n++) {
      if (random() < (radius > 20 ? 0.12 : 0.25)) continue;  // real rings have gaps
      // The crushed centre is chaotic; the outer rings are only slightly irregular.
      const rough = radius > 20 ? 0.14 : 0.7;
      const from = pointAtRadius(traced[live[n]], center, radius * (1 + (random() - 0.5) * rough));
      const to = pointAtRadius(traced[live[(n + 1) % live.length]], center, radius * (1 + (random() - 0.5) * rough));
      if (!from || !to) continue;
      // A rough chord between the two radials, kinked once or twice.
      const path = [from];
      const kinks = distance(from, to) > 50 ? 2 : 1;
      for (let j = 1; j <= kinks; j++) {
        const p = lerpPoint(from, to, j / (kinks + 1));
        const wobble = (random() - 0.5) * 0.18 * distance(from, to);
        const nx = -(to.y - from.y), ny = to.x - from.x;
        const nl = Math.hypot(nx, ny) || 1;
        p.x += (nx / nl) * wobble;
        p.y += (ny / nl) * wobble;
        p.along = Math.max(from.along, to.along) + distance(p, from);
        path.push(p);
      }
      const end = { x: to.x, y: to.y, along: Math.max(from.along, to.along) + distance(from, to) };
      // Run a few px past the far radial, so the trace meets it mid-segment rather than at a tip.
      const last = path[path.length - 1];
      const run = distance(last, end) || 1;
      path.push(end, {
        x: end.x + ((end.x - last.x) / run) * 3,
        y: end.y + ((end.y - last.y) / run) * 3,
        along: end.along + 3,
      });
      const made = crack(mirror, path, true);
      if (made) note(made);
    }
  }

  // 3. Branches: now and then a crack forks off a radial at a sharp angle.
  for (const i of live) {
    if (random() < 0.45) continue;
    const ray = traced[i];
    const end = ray[ray.length - 1].along;
    if (end < 70) continue;
    const start = pointAtRadius(ray, center, 30 + random() * Math.min(end - 40, 240));
    if (!start) continue;
    const heading = Math.atan2(start.y - y, start.x - x) + (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.5);
    const made = crack(mirror, jaggedRay(start, heading, 420, random), true);
    if (made) note(made);
  }

  return { cracks, reach, crushRadius };
}
