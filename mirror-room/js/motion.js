// Motion helpers: the reduced-motion preference and the easing curve the animations share.

const query = matchMedia('(prefers-reduced-motion: reduce)');

/** True when the visitor asked the OS for less motion. Read it live; it can change while the page is open. */
export function prefersReducedMotion() {
  return query.matches;
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
