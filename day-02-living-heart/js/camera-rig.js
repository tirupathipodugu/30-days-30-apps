// The study camera: orbit, tilt and zoom around a target, eased toward goals set by keys, buttons, drag,
// wheel and pinch. Zooming past the target carries the camera forward, so it can fly into the heart.

import * as THREE from 'three';

const D2R = Math.PI / 180;
const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.home = { target: new THREE.Vector3(), yaw: 0, pitch: -4 * D2R, dist: 8 };
    this.cur = { target: new THREE.Vector3(), yaw: 0, pitch: -4 * D2R, dist: 8 };
    this.goal = { target: new THREE.Vector3(), yaw: 0, pitch: -4 * D2R, dist: 8 };
    this.held = { yaw: 0, pitch: 0, zoom: 0 };   // continuous input from held keys and buttons, −1..1
    this.minDist = 0.05;
    this.maxDist = 20;
    this.bounds = 1.2;   // how far the target may wander from the heart's centre
    this.flying = 0;     // > 0 while a fly-to is in progress (eases more gently)
    this.dir = new THREE.Vector3();
  }

  setHome(dist) {
    const wasHome = this.isNearHome();
    this.home.dist = dist;
    this.maxDist = dist * 2.4;
    if (wasHome) { this.goal.dist = dist; this.cur.dist = dist; }
  }

  isNearHome() {
    return Math.abs(this.goal.dist - this.home.dist) < 0.05 * this.home.dist && this.goal.target.lengthSq() < 1e-4 && Math.abs(wrap(this.goal.yaw)) < 0.02 && Math.abs(this.goal.pitch - this.home.pitch) < 0.02;
  }

  /** How far the view is from the opening framing, 0 (home) to 1 (studying close up or turned away). */
  awayness() {
    const z = THREE.MathUtils.clamp(1 - this.cur.dist / this.home.dist, 0, 1);
    const turn = Math.min(1, (Math.abs(wrap(this.cur.yaw)) + Math.abs(this.cur.pitch - this.home.pitch)) / (35 * D2R));
    const pan = Math.min(1, this.cur.target.length() / 0.3);
    return Math.min(1, Math.max(z * 1.6, turn, pan));
  }

  reset() { this.flyTo({ target: this.home.target, yaw: 0, pitch: this.home.pitch, dist: this.home.dist }); }

  rotate(dYaw, dPitch) {
    this.goal.yaw += dYaw;
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dPitch, -85 * D2R, 85 * D2R);
    this.flying = 0;
  }

  /** Zoom by a factor (< 1 is closer). At the closest distance, keep going: move the target forward. */
  zoom(f) {
    this.flying = 0;
    const next = this.goal.dist * f;
    if (next < this.minDist && f < 1) {
      const step = (this.goal.dist - next) + (this.minDist - Math.min(this.minDist, next)) * 0.5;
      this.viewDir(this.dir);
      this.goal.target.addScaledVector(this.dir, step);
      this.goal.target.clampLength(0, this.bounds);
      this.goal.dist = this.minDist;
      return;
    }
    // Zooming back out pulls the target home again, so the camera never ends up orbiting empty space.
    if (f > 1) this.goal.target.multiplyScalar(Math.max(0, 1 - (f - 1) * 1.4));
    this.goal.dist = THREE.MathUtils.clamp(next, this.minDist, this.maxDist);
  }

  /** Frame a view: { target: Vector3, yaw, pitch, dist }. The shortest way round is taken. */
  flyTo(v) {
    this.goal.target.copy(v.target);
    this.goal.yaw = this.cur.yaw + wrap(v.yaw - this.cur.yaw);
    this.goal.pitch = THREE.MathUtils.clamp(v.pitch, -85 * D2R, 85 * D2R);
    this.goal.dist = THREE.MathUtils.clamp(v.dist, this.minDist, this.maxDist);
    this.flying = 1;
  }

  /** A view that puts the camera at `eye` looking at `target`. */
  static viewFrom(eye, target) {
    const d = new THREE.Vector3().subVectors(eye, target);
    const dist = d.length();
    d.normalize();
    return { target: target.clone(), yaw: Math.atan2(d.x, d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), dist };
  }

  viewDir(out) {
    const { yaw, pitch } = this.goal;
    return out.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  update(dt, reduced) {
    const h = this.held;
    if (h.yaw || h.pitch) this.rotate(h.yaw * 75 * D2R * dt, h.pitch * 55 * D2R * dt);
    if (h.zoom) this.zoom(Math.exp(-h.zoom * 1.3 * dt));
    // Exponential easing; a fly-to is slower and calmer than direct control.
    const rate = reduced ? 30 : this.flying ? 3.2 : 9;
    const k = 1 - Math.exp(-rate * dt);
    const c = this.cur, g = this.goal;
    c.target.lerp(g.target, k);
    c.yaw += (g.yaw - c.yaw) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    // Distance eases in log space so long zooms feel even.
    c.dist = Math.exp(Math.log(c.dist) + (Math.log(g.dist) - Math.log(c.dist)) * k);
    if (this.flying && Math.abs(Math.log(c.dist / g.dist)) < 0.01 && c.target.distanceTo(g.target) < 0.002) this.flying = 0;

    const cam = this.camera;
    cam.position.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist).add(c.target);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.target);
    // Close in, a tight near plane lets the camera slip between structures, and the lens widens
    // (30° outside, up to 70° inside a chamber) so a whole valve fits in view.
    const near = THREE.MathUtils.clamp(c.dist * 0.08, 0.004, 0.1);
    const t = THREE.MathUtils.clamp((c.dist - 0.12) / (0.9 - 0.12), 0, 1);
    const fov = 70 - 40 * t * t * (3 - 2 * t);
    if (Math.abs(cam.near - near) > near * 0.05 || Math.abs(cam.fov - fov) > 0.05) { cam.near = near; cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}

/** Keyboard, on-screen buttons, drag, wheel and pinch, feeding the rig. Returns a tap callback hook. */
export function bindControls(rig, canvas, { onTap, onHover, onDragStart }) {
  const keys = new Set();
  const isTyping = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'button';
  const syncKeys = () => {
    const shift = keys.has('Shift');
    const up = keys.has('ArrowUp'), down = keys.has('ArrowDown');
    // Left turns the heart's front to the left (the camera swings right); Up turns it upward.
    rig.held.yaw = (keys.has('ArrowLeft') ? 1 : 0) + (keys.has('ArrowRight') ? -1 : 0);
    rig.held.pitch = shift ? 0 : (up ? -1 : 0) + (down ? 1 : 0);
    rig.held.zoom = (keys.has('+') || keys.has('=') || keys.has('w') || keys.has('W') || (shift && up) ? 1 : 0)
      - (keys.has('-') || keys.has('_') || keys.has('s') || keys.has('S') || (shift && down) ? 1 : 0);
    rig.held.yaw += buttons.yaw; rig.held.pitch += buttons.pitch; rig.held.zoom += buttons.zoom;
  };
  const buttons = { yaw: 0, pitch: 0, zoom: 0 };
  const NAV = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'w', 'W', 's', 'S', 'Shift'];
  addEventListener('keydown', (e) => {
    if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!NAV.includes(e.key)) return;
    // Arrow keys on a focused button still drive the heart, as the page has no scrolling to protect.
    if (e.key !== 'Shift') e.preventDefault();
    keys.add(e.key);
    syncKeys();
  });
  addEventListener('keyup', (e) => { keys.delete(e.key); if (e.key === 'Shift') { keys.delete('ArrowUp'); keys.delete('ArrowDown'); } syncKeys(); });
  addEventListener('blur', () => { keys.clear(); syncKeys(); });

  // On-screen buttons: press and hold to keep moving; a quick tap still makes a clear step.
  for (const el of document.querySelectorAll('[data-nav]')) {
    const [axis, sign] = el.dataset.nav.split(':');
    let downAt = 0;
    const stop = () => {
      if (!downAt) return;
      buttons[axis] = 0;
      if (performance.now() - downAt < 180) {
        if (axis === 'zoom') rig.zoom(Math.exp(-Number(sign) * 0.35));
        else if (axis === 'yaw') rig.rotate(Number(sign) * 15 * D2R, 0);
        else rig.rotate(0, Number(sign) * 12 * D2R);
      }
      downAt = 0;
      syncKeys();
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); downAt = performance.now(); setTimeout(() => { if (downAt) { buttons[axis] = Number(sign); syncKeys(); } }, 180); });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (axis === 'zoom') rig.zoom(Math.exp(-Number(sign) * 0.35));
      else if (axis === 'yaw') rig.rotate(Number(sign) * 15 * D2R, 0);
      else rig.rotate(0, Number(sign) * 12 * D2R);
    });
  }

  // Drag to orbit (one finger or the mouse), pinch to zoom, wheel to zoom.
  const pointers = new Map();
  let drag = null, pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, type: e.pointerType };
    if (pointers.size === 2) { pinch = spread(); if (drag) drag.moved = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') onHover(e.clientX, e.clientY); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const s = spread();
      if (pinch > 0 && s > 0) rig.zoom(pinch / s);
      pinch = s;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) { drag.moved = true; onDragStart?.(); }
    if (drag.moved) rig.rotate(-dx * 0.32 * D2R, dy * 0.32 * D2R);
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (drag && !drag.moved && e.type === 'pointerup') onTap(e.clientX, e.clientY, drag.type);
      drag = null; pinch = 0;
    } else if (pointers.size === 1) {
      const [p] = pointers.values();
      drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, moved: true, type: e.pointerType };
      pinch = 0;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    rig.zoom(Math.exp(THREE.MathUtils.clamp(d, -120, 120) * 0.0016));
  }, { passive: false });
  function spread() {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
