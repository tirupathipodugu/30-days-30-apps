// Plain 2D geometry for the fracture: segment intersection, point-in-polygon, area, triangulation,
// and splitting a polygon along a crack path. Points are {x, y} objects in stage pixels.

const ON_EDGE = 0.01;   // px: how close a point must be to count as lying on an edge

/** Where segment a→b crosses segment c→d, as { t (along a→b), u (along c→d) }, or null. */
export function segmentHit(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  const e = 1e-7;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { t, u };
}

export function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Even-odd ray test. */
export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function signedArea(poly) {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return sum / 2;
}

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return { x: poly[0].x, y: poly[0].y };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Put point p into the polygon's outline. Returns [outline, index of p], or null if p is not on it. */
function insertOnOutline(poly, p) {
  for (let i = 0; i < poly.length; i++) {
    if (distance(poly[i], p) < ON_EDGE) return [poly, i];
  }
  for (let i = 0; i < poly.length; i++) {
    if (distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]) < ON_EDGE) {
      return [[...poly.slice(0, i + 1), p, ...poly.slice(i + 1)], i + 1];
    }
  }
  return null;
}

/**
 * Split a polygon along a path whose first and last points lie on its outline and whose middle
 * runs through its inside. Returns the two halves, or null if the path doesn't cut it cleanly.
 */
export function splitPolygon(poly, path, minArea) {
  const start = path[0];
  const end = path[path.length - 1];
  const first = insertOnOutline(poly, start);
  if (!first) return null;
  const second = insertOnOutline(first[0], end);
  if (!second) return null;
  const outline = second[0];
  const ib = second[1];
  const ia = outline.indexOf(first[0][first[1]]);
  if (ia === ib || ia < 0) return null;

  const walk = (from, to) => {
    const out = [];
    for (let i = from; ; i = (i + 1) % outline.length) {
      out.push(outline[i]);
      if (i === to) return out;
    }
  };
  const inner = path.slice(1, -1);
  const a = [...walk(ia, ib), ...inner.slice().reverse()];
  const b = [...walk(ib, ia), ...inner];
  if (Math.abs(signedArea(a)) < minArea || Math.abs(signedArea(b)) < minArea) return null;
  return [a, b];
}

/** Ear-clipping triangulation of a simple polygon. Returns a flat list of points, three per triangle. */
export function triangulate(poly) {
  const pts = poly.slice();
  const sign = signedArea(pts) >= 0 ? 1 : -1;
  const out = [];
  const cross = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * sign;
  const inTriangle = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;

  let guard = pts.length * pts.length + 8;
  let i = 0;
  while (pts.length > 3 && guard-- > 0) {
    const n = pts.length;
    const a = pts[(i + n - 1) % n], b = pts[i % n], c = pts[(i + 1) % n];
    const turn = cross(a, b, c);
    if (Math.abs(turn) < 1e-9) {              // collinear point (a T-junction): drop it
      pts.splice(i % n, 1);
      continue;
    }
    let ear = turn > 0;
    for (let k = 0; ear && k < n; k++) {
      const p = pts[k];
      if (p !== a && p !== b && p !== c && inTriangle(p, a, b, c)) ear = false;
    }
    if (ear) {
      out.push(a, b, c);
      pts.splice(i % n, 1);
    } else {
      i = (i + 1) % n;
    }
  }
  if (pts.length === 3) {
    out.push(pts[0], pts[1], pts[2]);
  } else {
    for (let k = 1; k + 1 < pts.length; k++) out.push(pts[0], pts[k], pts[k + 1]);   // numerical fallback
  }
  return out;
}
