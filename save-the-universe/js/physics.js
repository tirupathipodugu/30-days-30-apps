// Physics: the black hole's pull, your thrust, and the clock that makes the hole hungrier.
// Everything is measured in screen pixels, scaled by L (the short side of the screen), so the game
// feels the same on a phone and a monitor. The step is fixed at 1/120 s for the same reason.

export const STEP = 1 / 120;

// You start at rest just outside the hole, and it pulls you in. Every tap gives your bubble a push
// toward where you tapped, so tapping fast is how you build enough speed to break free. Holding a
// finger down (or an arrow key) gives a weaker steady push. The pull ramps up over the first
// seconds, then the hole gets hungrier every second.
// The pull falls off as 1/r rather than 1/r², so it stays a fight all the way to the button instead
// of being impossible near the hole and nothing a little way out. Each level pulls 12% harder.
const TUNING = {
  holeRadius: 0.015,  // event horizon at the start, in L: it starts small and grows
  startDistance: 23, // in starting hole radii
  pullAtStart: 0.30,  // L per s² at the start distance
  tap: 0.055,         // speed added per tap, L per s
  hold: 0.048,         // steady push while holding, L per s²
  damping: 0.6,       // per second: you lose speed quickly, so you have to keep tapping
  ramp: 2.5,          // seconds for the pull to reach full strength
  growRate: 0.07,     // the hole grows 7% of its starting size per second...
  hungerRate: 0.03,
  maxGrow: 3.5,       // ...up to 3.5x
  maxHunger: 2.4,
  maxSpeed: 1.6,      // L per s
  bounce: 0.4,
};

/** Where the hole and the goal sit: top and bottom on tall screens, left and right on wide ones. */
export function layout(w, h) {
  const L = Math.min(w, h);
  const tall = h > w;
  const hole = tall ? { x: w / 2, y: h * 0.2 } : { x: w * 0.2, y: h / 2 };
  return { w, h, L, tall, hole };
}

export function createWorld(w, h, level = 1) {
  const hard = 1 + 0.12 * (level - 1);
  const lay = layout(w, h);
  const rs = TUNING.holeRadius * lay.L;
  const r0 = TUNING.startDistance * rs;
  // Start between the hole and the goal, so the way out is obvious.
  const out = lay.tall ? { x: 0, y: 1 } : { x: 1, y: 0 };
  return {
    ...lay,
    rs0: rs,
    rs,
    G0: TUNING.pullAtStart * hard * lay.L * r0,
    hard,
    G: 0,
    x: lay.hole.x + out.x * r0,
    y: lay.hole.y + out.y * r0,
    vx: 0,
    vy: 0,
    radius: Math.max(9, 0.022 * lay.L),
    t: 0,
    state: 'playing', // 'playing' | 'won' | 'lost'
  };
}

/** Rescale a running world to a new screen size, keeping everything in proportion. */
export function resizeWorld(world, w, h) {
  const k = Math.min(w, h) / world.L;
  const lay = layout(w, h);
  const rel = { x: (world.x - world.hole.x) * k, y: (world.y - world.hole.y) * k };
  Object.assign(world, lay, {
    rs0: world.rs0 * k, rs: world.rs * k, G0: world.G0 * k * k,
    x: lay.hole.x + rel.x, y: lay.hole.y + rel.y, vx: world.vx * k, vy: world.vy * k,
    radius: Math.max(9, 0.022 * lay.L),
  });
}

/** A tap: an instant push toward the point (x, y). */
export function tap(world, x, y) {
  if (world.state !== 'playing') return;
  const dx = x - world.x, dy = y - world.y, d = Math.hypot(dx, dy);
  if (d < 1) return;
  world.vx += (dx / d) * TUNING.tap * world.L;
  world.vy += (dy / d) * TUNING.tap * world.L;
}

/** Advance one fixed step. hold is a direction for the steady push (zero for none). */
export function step(world, hold) {
  const w = world;
  w.t += STEP;
  const grow = Math.min(TUNING.maxGrow, 1 + TUNING.growRate * w.t);
  const hunger = Math.min(TUNING.maxHunger, 1 + TUNING.hungerRate * w.hard * w.t);
  w.rs = w.rs0 * grow;
  w.G = w.G0 * hunger * Math.min(1, w.t / TUNING.ramp);

  const dx = w.hole.x - w.x;
  const dy = w.hole.y - w.y;
  const r = Math.hypot(dx, dy);
  const rr = Math.max(r, w.rs * 0.5);
  const pull = w.G / rr;
  let ax = (dx / r) * pull - w.vx * TUNING.damping;
  let ay = (dy / r) * pull - w.vy * TUNING.damping;

  const hl = Math.hypot(hold.x, hold.y);
  if (hl > 0 && w.state === 'playing') {
    ax += (hold.x / hl) * TUNING.hold * w.L;
    ay += (hold.y / hl) * TUNING.hold * w.L;
  }

  w.vx += ax * STEP;
  w.vy += ay * STEP;
  const v = Math.hypot(w.vx, w.vy);
  const vmax = TUNING.maxSpeed * w.L;
  if (v > vmax) { w.vx *= vmax / v; w.vy *= vmax / v; }
  w.x += w.vx * STEP;
  w.y += w.vy * STEP;

  // Screen edges are walls that soak up most of the speed.
  const R = w.radius;
  if (w.x < R) { w.x = R; w.vx = Math.abs(w.vx) * TUNING.bounce; }
  if (w.x > w.w - R) { w.x = w.w - R; w.vx = -Math.abs(w.vx) * TUNING.bounce; }
  if (w.y < R) { w.y = R; w.vy = Math.abs(w.vy) * TUNING.bounce; }
  if (w.y > w.h - R) { w.y = w.h - R; w.vy = -Math.abs(w.vy) * TUNING.bounce; }

  if (w.state === 'playing' && Math.hypot(w.hole.x - w.x, w.hole.y - w.y) < w.rs * 1.05) w.state = 'lost';
  return w;
}

/** How hard the hole is pulling you right now, as a share of what fast tapping (5 a second) beats. */
export function danger(world) {
  const r = Math.max(world.rs, Math.hypot(world.hole.x - world.x, world.hole.y - world.y));
  return Math.min(1, world.G / r / (5 * TUNING.tap * world.L));
}

/** True when the bubble overlaps the goal rectangle {x, y, w, h}. */
export function touches(world, rect) {
  const cx = Math.max(rect.x, Math.min(world.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(world.y, rect.y + rect.h));
  return Math.hypot(world.x - cx, world.y - cy) < world.radius;
}
