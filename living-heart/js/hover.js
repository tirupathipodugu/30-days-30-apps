// Thread hit-testing: a 32×32 grid of projected samples, nearest sample within a radius of the pointer
// (8 px for a mouse, much more for a finger).

import * as THREE from 'three';

const GRID = 32;

export class Hover {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.samples = null;
    this.speed = 1;
    this.cells = null;
    this.ref = new THREE.Vector3(1, 1, 0);
    this.refScreen = new THREE.Vector2(-1e9, -1e9);
    this.v = new THREE.Vector3();
  }

  setSamples(samples, speed) {
    this.samples = samples;
    this.speed = speed;
    this.invalidate();
  }

  invalidate() { this.cells = null; }

  project(x, y, z, out) {
    this.v.set(x, y, z).project(this.camera);
    out.x = (this.v.x * 0.5 + 0.5) * innerWidth;
    out.y = (-this.v.y * 0.5 + 0.5) * innerHeight;
    return out;
  }

  // Cheap check: if a reference point has moved more than 4 px, the grid is stale.
  maybeRefresh() {
    if (!this.cells) return;
    const p = this.project(this.ref.x, this.ref.y, this.ref.z, { x: 0, y: 0 });
    if (Math.hypot(p.x - this.refScreen.x, p.y - this.refScreen.y) > 4) this.cells = null;
  }

  rebuild() {
    const s = this.samples, n = s.length / 5;
    this.xy = new Float32Array(n * 2);
    this.cells = Array.from({ length: GRID * GRID }, () => []);
    const p = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) {
      this.project(s[i * 5], s[i * 5 + 1], s[i * 5 + 2], p);
      this.xy[i * 2] = p.x; this.xy[i * 2 + 1] = p.y;
      const cx = Math.floor((p.x / innerWidth) * GRID), cy = Math.floor((p.y / innerHeight) * GRID);
      if (cx >= 0 && cy >= 0 && cx < GRID && cy < GRID) this.cells[cy * GRID + cx].push(i);
    }
    const r = this.project(this.ref.x, this.ref.y, this.ref.z, { x: 0, y: 0 });
    this.refScreen.set(r.x, r.y);
  }

  /** Nearest sample within RADIUS px; weight(id) < 1 favours some threads (the main trunks). */
  pick(x, y, RADIUS = 8, weight = null) {
    if (!this.samples) return null;
    if (!this.cells) this.rebuild();
    const cw = innerWidth / GRID, ch = innerHeight / GRID;
    const x0 = Math.floor((x - RADIUS) / cw), x1 = Math.floor((x + RADIUS) / cw);
    const y0 = Math.floor((y - RADIUS) / ch), y1 = Math.floor((y + RADIUS) / ch);
    let best = -1, bd = RADIUS * RADIUS;
    for (let cy = Math.max(0, y0); cy <= Math.min(GRID - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(GRID - 1, x1); cx++) {
        for (const i of this.cells[cy * GRID + cx]) {
          let d = (this.xy[i * 2] - x) ** 2 + (this.xy[i * 2 + 1] - y) ** 2;
          if (weight) d *= weight(this.samples[i * 5 + 4]);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0) return null;
    const s = this.samples;
    return { id: s[best * 5 + 4], s: s[best * 5 + 3], delay: s[best * 5 + 3] / this.speed, pos: [s[best * 5], s[best * 5 + 1], s[best * 5 + 2]] };
  }
}
