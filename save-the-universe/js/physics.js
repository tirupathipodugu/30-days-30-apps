// Physics: the black hole's pull, your thrust, and the clock that makes the hole hungrier.
// Everything is measured in screen pixels, scaled by L (the short side of the screen), so the game
// feels the same on a phone and a monitor. The step is fixed at 1/120 s for the same reason.

export const STEP = 1 / 120;

// You start in orbit around the hole. A little drag (the hole's gas and its growing hunger) makes
// that orbit decay, so doing nothing spirals you in within a few seconds. Your thrust is weaker than
// the pull, so flying straight out fails: you have to push along your orbit to build speed, swing
// out, and then break for the goal.
const TUNING = {
  holeRadius: 0.055,  // event horizon, in L
  startDistance: 4.2, // in hole radii
  period: 2.6,        // seconds for one lap of the starting orbit
  thrustShare: 0.7,   // thrust / pull at the start distance
  drag: 0.22,         // per second: how fast the orbit decays
  growRate: 0.012,    // hole radius grows 1.2% per second
  hungerRate: 0.02,   // pull grows 2% per second
  maxGrow: 1.8,
  maxHunger: 2.2,
  maxSpeed: 3,        // L per s
  bounce: 0.4,        // speed kept when you hit a screen edge
};

/** Where the hole and the goal sit: top and bottom on tall screens, left and right on wide ones. */
export function layout(w, h) {
  const L = Math.min(w, h);
  const tall = h > w;
  const hole = tall ? { x: w / 2, y: h * 0.2 } : { x: w * 0.2, y: h / 2 };
  return { w, h, L, tall, hole };
}

export function createWorld(w, h) {
  const lay = layout(w, h);
  const rs = TUNING.holeRadius * lay.L;
  const r0 = TUNING.startDistance * rs;
  const vc = (2 * Math.PI * r0) / TUNING.period;   // circular orbit speed
  const pull = (vc * vc) / r0;                     // pull at the start distance
  // Start beside the hole, at right angles to the way out, moving along a circular orbit.
  const side = lay.tall ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const dir = lay.tall ? { x: 0, y: -1 } : { x: 1, y: 0 };
  return {
    ...lay,
    rs0: rs,
    rs,
    G0: vc * vc * r0,
    G: vc * vc * r0,
    thrust: TUNING.thrustShare * pull,
    x: lay.hole.x + side.x * r0,
    y: lay.hole.y + side.y * r0,
    vx: dir.x * vc,
    vy: dir.y * vc,
    radius: Math.max(14, 0.035 * lay.L),
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
    rs0: world.rs0 * k, rs: world.rs * k, G0: world.G0 * k * k * k, thrust: world.thrust * k,
    x: lay.hole.x + rel.x, y: lay.hole.y + rel.y, vx: world.vx * k, vy: world.vy * k,
    radius: Math.max(14, 0.035 * lay.L),
  });
}

/** Advance one fixed step. thrust is a direction (any length; zero for none). */
export function step(world, thrust) {
  const w = world;
  w.t += STEP;
  const grow = Math.min(TUNING.maxGrow, 1 + TUNING.growRate * w.t);
  const hunger = Math.min(TUNING.maxHunger, 1 + TUNING.hungerRate * w.t);
  w.rs = w.rs0 * grow;
  w.G = w.G0 * hunger;

  const dx = w.hole.x - w.x;
  const dy = w.hole.y - w.y;
  const r = Math.hypot(dx, dy);
  const rr = Math.max(r, w.rs * 0.5);
  const pull = w.G / (rr * rr);
  // Drag fades with distance, so once you are well clear of the hole you coast freely.
  const drag = TUNING.drag * Math.min(1, (w.rs0 * TUNING.startDistance * 1.5) / r);
  let ax = (dx / r) * pull - w.vx * drag;
  let ay = (dy / r) * pull - w.vy * drag;

  const tl = Math.hypot(thrust.x, thrust.y);
  if (tl > 0 && w.state === 'playing') {
    const T = w.thrust;
    ax += (thrust.x / tl) * T;
    ay += (thrust.y / tl) * T;
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

/** Speed as a share of the speed you need to escape from where you are (1 = enough). */
export function escapeShare(world) {
  const r = Math.max(world.rs, Math.hypot(world.hole.x - world.x, world.hole.y - world.y));
  const vEsc = Math.sqrt((2 * world.G) / r);
  return Math.hypot(world.vx, world.vy) / vEsc;
}

/** True when the bubble overlaps the goal rectangle {x, y, w, h}. */
export function touches(world, rect) {
  const cx = Math.max(rect.x, Math.min(world.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(world.y, rect.y + rect.h));
  return Math.hypot(world.x - cx, world.y - cy) < world.radius;
}
