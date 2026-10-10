// Encore: an automatic showcase for screen recordings. From one mirror it breaks all, again and again,
// each split faster than the last (1 → 2 → 4 → 8 → … → 128), lands on a heartbeat thump and a ring
// of light, then reassembles. With reduced motion it steps through calm stills instead.

const SPLIT_GAPS_MS = [700, 560, 440, 260, 170, 130, 110];   // before each "break all"
const CALM_GAP_MS = 900;
const THUMP_AFTER_MS = 450;
const HOLD_MS = 1500;

/**
 * Play the encore. `actions` provides: wholeMirror(), breakAll(), thump(), ring(), reassemble().
 * Returns a function that cancels whatever has not happened yet.
 */
export function playEncore(actions, reduced, onDone) {
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let t = 0;

  actions.wholeMirror();
  for (const gap of SPLIT_GAPS_MS) {
    t += reduced ? CALM_GAP_MS : gap;
    at(t, actions.breakAll);
  }
  t += THUMP_AFTER_MS;
  at(t, () => {
    actions.thump();
    if (!reduced) actions.ring();
  });
  t += HOLD_MS;
  at(t, () => {
    actions.reassemble();
    onDone();
  });

  return () => {
    for (const id of timers) clearTimeout(id);
    onDone();
  };
}
