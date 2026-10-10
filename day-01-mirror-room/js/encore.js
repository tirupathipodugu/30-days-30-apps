// Encore: a slow, cinematic replay for screen recordings. One clean mirror, a single strike, a held
// beat, then a cascade of strikes coming faster and faster until the glass is a full web, then a
// restore. With reduced motion the strikes are spaced out calmly instead.

const FIRST_HOLD_MS = 900;
const CASCADE_GAPS_MS = [1300, 520, 400, 300, 230, 180, 140, 110, 90];
const CALM_GAP_MS = 900;
const HOLD_MS = 2200;

/**
 * Play the encore. `actions` provides wholeMirror(), strike(x, y) and restore().
 * Returns a function that cancels whatever has not happened yet.
 */
export function playEncore(actions, size, reduced, onDone) {
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const somewhere = () => [size.width * (0.12 + Math.random() * 0.76), size.height * (0.12 + Math.random() * 0.76)];

  actions.wholeMirror();
  let t = FIRST_HOLD_MS;
  at(t, () => actions.strike(size.width * 0.5, size.height * 0.42));
  for (const gap of CASCADE_GAPS_MS) {
    t += reduced ? CALM_GAP_MS : gap;
    at(t, () => actions.strike(...somewhere()));
  }
  t += HOLD_MS;
  at(t, () => {
    actions.restore();
    onDone();
  });

  return () => {
    for (const id of timers) clearTimeout(id);
    onDone();
  };
}
