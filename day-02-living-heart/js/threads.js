// Grows the glass threads: vessel trunks, a space-colonisation tree across the page, and tangling curl-noise wanderers.

import { rng, curl3 } from './noise.js';

const SEED = 20261011;

/**
 * roots: [{ pos: [x,y,z], dir: [x,y,z] }] at the vessel cuts (heart units, heart at the origin)
 * slab:  { halfW, halfH, halfD } — the frustum at the heart's depth × 1.15, ±0.6 heart heights deep
 */
export function growThreads(roots, slab, { attractors: nAttr, wanderers: nWand, maxSamples }, clear = { x: 0.42, y: 0.55 }) {
  const rand = rng(SEED);
  const nodes = [];   // { p, parent, s, kids, root }
  let rootIndex = -1;
  const addNode = (p, parent) => {
    const s = parent < 0 ? 0 : nodes[parent].s + dist(p, nodes[parent].p);
    nodes.push({ p, parent, s, kids: [], root: parent < 0 ? ++rootIndex : nodes[parent].root });
    if (parent >= 0) nodes[parent].kids.push(nodes.length - 1);
    return nodes.length - 1;
  };

  // Trunks: along each vessel, then curving out toward the page.
  for (const r of roots) {
    let p = r.pos.slice(), dir = norm(r.dir), idx = addNode(p, -1);
    const out = norm([r.pos[0] + r.dir[0] * 0.3 + Math.sign(r.pos[0] || 1) * 0.25, (r.pos[1] + r.dir[1] * 0.3) * 0.45, 0]);   // fan out sideways, so no trunk leaves the page straight up or down
    // Each trunk runs unbranched until it is clear of the heart, so it reads as one main vessel.
    const inside = (q) => Math.abs(q[0]) < clear.x && Math.abs(q[1]) < clear.y;
    let outside = 0;
    for (let i = 0; i < 80 && (i < 26 || outside < 4); i++) {
      if (!inside(p)) outside++;
      const k = Math.min(1, i / 6) * 0.2;
      dir = norm([dir[0] * (1 - k) + out[0] * k, dir[1] * (1 - k) + out[1] * k, dir[2] * (1 - k)]);
      p = [p[0] + dir[0] * 0.025, p[1] + dir[1] * 0.025, p[2] + dir[2] * 0.025];
      idx = addNode(p, idx);
    }
  }

  colonise(nodes, addNode, slab, rand, nAttr, clear);
  const { paths, nodePath } = treePaths(nodes);

  // Wanderers: long curl-noise walks from random branch nodes, out past the edges.
  const c = [0, 0, 0];
  const limitX = slab.halfW * 1.05, limitY = slab.halfH * 1.05;
  for (let w = 0; w < nWand; w++) {
    // Wanderers leave from the open page, never from a trunk still crossing the heart.
    let startIdx = Math.floor(rand() * nodes.length);
    for (let tries = 0; tries < 20 && Math.abs(nodes[startIdx].p[0]) < clear.x && Math.abs(nodes[startIdx].p[1]) < clear.y; tries++) startIdx = Math.floor(rand() * nodes.length);
    const start = nodes[startIdx];
    let p = start.p.slice();
    const pts = [p];
    const off = rand() * 100;
    let dir = norm([p[0] + rand() - 0.5, p[1] + rand() - 0.5, rand() - 0.5]);
    let push = 0;
    for (let i = 0; i < 700; i++) {
      // Curl noise steers, a little momentum keeps the curves long, a weak bias carries it outward.
      // If the walk has circled in place for a while, the outward bias grows until it breaks free.
      if (i >= 90 && i % 30 === 0 && dist(p, pts[i - 90]) < 0.5) push = 40;
      const bias = push-- > 0 ? 1.6 : 0.35;
      const cn = norm(curl3(p[0] * 1.4 + off, p[1] * 1.4, p[2] * 1.4, c));
      const out = norm([p[0], p[1], 0]);
      const back = p[2] > slab.halfD ? -0.8 : p[2] < -slab.halfD ? 0.8 : 0;
      dir = norm([dir[0] * 1.6 + cn[0] + out[0] * bias, dir[1] * 1.6 + cn[1] + out[1] * bias, dir[2] * 1.6 + cn[2] * 0.6 + back]);
      p = [p[0] + dir[0] * 0.02, p[1] + dir[1] * 0.02, p[2] + dir[2] * 0.02];
      pts.push(p);
      if (Math.abs(p[0]) > limitX || Math.abs(p[1]) > limitY) break;
    }
    paths.push({ pts, s0: start.s, w0: 0.8 + rand() * 0.6, wanderer: true, root: start.root, parentKey: nodePath[startIdx] });
  }

  // Smooth and resample everything, keeping under the vertex budget.
  let total = 0;
  for (const p of paths) total += polyLength(p.pts);
  const step = Math.max(0.01, total / maxSamples);
  // Ids are dense after filtering; each path keeps its parent (where it branched off) so a block upstream
  // can shut everything downstream. Parents always come before their children.
  const kept = paths.map((p, key) => ({ ...p, key, pts: catmullResample(p.pts, step) })).filter((p) => p.pts.length >= 2);
  const idOf = new Map(kept.map((p, i) => [p.key, i]));
  // A parent dropped as too short hands its children on to its own parent.
  const resolve = (key) => { while (key >= 0 && !idOf.has(key)) key = paths[key].parentKey ?? -1; return key >= 0 ? idOf.get(key) : -1; };
  return kept.map((p, i) => ({ ...p, id: i, parent: resolve(p.parentKey ?? -1), trunk: !p.wanderer && (p.parentKey ?? -1) < 0 }));
}

function colonise(nodes, addNode, slab, rand, count, clear) {
  const attr = [];
  while (attr.length < count) {
    const p = [(rand() * 2 - 1) * slab.halfW * 1.05, (rand() * 2 - 1) * slab.halfH * 1.05, (rand() * 2 - 1) * slab.halfD];
    if (Math.abs(p[0]) < clear.x && Math.abs(p[1]) < clear.y) continue;   // keep the heart's own footprint clear
    attr.push(p);
  }
  const alive = new Uint8Array(attr.length).fill(1);
  const KILL = 0.04, STEP = 0.025, CELL = 0.5, MAX_INFLUENCE = 1.0;
  let influence = 0.35;
  // Attractors never move and nodes are only ever added, so each attractor keeps its nearest node
  // and only new nodes need checking against the attractors around them.
  const grid = new Map();
  const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  attr.forEach((p, i) => {
    const k = key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL));
    let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i);
  });
  const best = new Int32Array(attr.length).fill(-1);
  const bestD = new Float32Array(attr.length).fill(Infinity);
  let seen = 0;
  const meetNewNodes = () => {
    for (; seen < nodes.length; seen++) {
      const q = nodes[seen].p;
      if (Math.abs(q[0]) < clear.x && Math.abs(q[1]) < clear.y) continue;   // no branches over the heart
      const gx = Math.floor(q[0] / CELL), gy = Math.floor(q[1] / CELL), gz = Math.floor(q[2] / CELL);
      for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const b = grid.get(key(gx + dx, gy + dy, gz + dz));
        if (!b) continue;
        for (let n = 0; n < b.length; n++) {
          const a = b[n], p = attr[a];
          const d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
          if (d2 < bestD[a]) { bestD[a] = d2; best[a] = seen; }
        }
      }
    }
  };
  let lastRemaining = -1, stagnant = 0;
  for (let iter = 0; iter < 600; iter++) {
    meetNewNodes();
    const pull = new Map();
    let remaining = 0;
    const inf2 = influence * influence;
    for (let a = 0; a < attr.length; a++) {
      if (!alive[a]) continue;
      if (bestD[a] < KILL * KILL) { alive[a] = 0; continue; }
      remaining++;
      if (bestD[a] > inf2) continue;
      const p = attr[a], i = best[a], q = nodes[i].p, l = Math.sqrt(bestD[a]);
      let v = pull.get(i); if (!v) pull.set(i, v = [0, 0, 0]);
      v[0] += (p[0] - q[0]) / l; v[1] += (p[1] - q[1]) / l; v[2] += (p[2] - q[2]) / l;
    }
    if (!remaining) break;
    // Stop once the last few attractors stop being consumed: the page is covered.
    stagnant = remaining === lastRemaining ? stagnant + 1 : 0;
    lastRemaining = remaining;
    if (stagnant > 12 && remaining < count * 0.08) break;
    let grew = 0;
    for (const [i, v] of pull) {
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l < 1e-3) continue;
      const q = nodes[i].p;
      // Small jitter keeps the branches from looking ruled.
      const j = 0.25;
      const d = norm([v[0] / l + (rand() - 0.5) * j, v[1] / l + (rand() - 0.5) * j, v[2] / l + (rand() - 0.5) * j]);
      addNode([q[0] + d[0] * STEP, q[1] + d[1] * STEP, q[2] + d[2] * STEP], i);
      grew++;
    }
    influence = grew ? Math.max(0.35, influence * 0.96) : Math.min(influence * 1.3, MAX_INFLUENCE);
    if (!grew && influence >= MAX_INFLUENCE) break;
  }
}

// Split the tree into paths: each continues through its first child; other children start new paths
// at the branch point. Width follows the pipe model (how many tips each segment feeds).
function treePaths(nodes) {
  const tips = new Float32Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!nodes[i].kids.length) tips[i] = 1;
    if (nodes[i].parent >= 0) tips[nodes[i].parent] += tips[i];
  }
  let maxTips = 1;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].parent < 0) maxTips = Math.max(maxTips, tips[i]);
  const paths = [];
  const nodePath = new Int32Array(nodes.length).fill(-1);
  const stack = nodes.map((n, i) => i).filter((i) => nodes[i].parent < 0).map((i) => ({ start: i, from: -1, gen: 0 }));
  while (stack.length) {
    const { start, from, gen } = stack.pop();
    const pts = [], widths = [];
    const key = paths.length;
    if (from >= 0) { pts.push(nodes[from].p); widths.push(Math.pow(tips[start] / maxTips, 0.42)); }
    let i = start;
    for (;;) {
      nodePath[i] = key;
      pts.push(nodes[i].p);
      widths.push(Math.pow(tips[i] / maxTips, 0.42));
      const kids = nodes[i].kids;
      if (!kids.length) break;
      // Thickest child continues the path.
      kids.sort((a, b) => tips[b] - tips[a]);
      for (let k = 1; k < kids.length; k++) stack.push({ start: kids[k], from: i, gen: gen + 1 });
      i = kids[0];
    }
    // Short stubs still hold a slot so the node-to-path map stays valid; they are dropped after resampling.
    paths.push({ pts: pts.length >= 3 ? pts : [], widths, s0: nodes[from >= 0 ? from : start].s, gen, root: nodes[start].root, parentKey: from >= 0 ? nodePath[from] : -1 });
  }
  return { paths, nodePath };
}

function catmullResample(pts, step) {
  if (pts.length < 2) return [];
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = dist(p1, p2);
    let t = carry;
    while (t < len) {
      const u = t / len, u2 = u * u, u3 = u2 * u;
      out.push([0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3)));
      out[out.length - 1].src = i + u;
      t += step;
    }
    carry = t - len;
  }
  const last = pts[pts.length - 1].slice();
  last.src = pts.length - 1;
  out.push(last);
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const polyLength = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; };
