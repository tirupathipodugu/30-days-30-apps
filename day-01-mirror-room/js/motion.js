// Motion helpers: the reduced-motion preference and the easing curves the animations share.

const query = matchMedia('(prefers-reduced-motion: reduce)');

/** True when the visitor asked the OS for less motion. Read it live; it can change while the page is open. */
export function prefersReducedMotion() {
  return query.matches;
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function easeOutCubic(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Ease out with a small overshoot past 1 before settling: the "slide apart, overshoot, settle" feel. */
export function easeOutBack(t) {
  t = clamp01(t);
  const s = 1.9;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
