// Input: keyboard + mouse, twin-stick touch, and gamepad. Produces screen-space intents;
// main.js turns them into world directions using the camera.
export class Input {
  constructor(canvas, stickEls) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edge = { dash: false, q: false, e: false, r: false };
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, seen: false };
    this.touchMode = false;
    this.sticks = { move: null, aim: null };
    this.stickEls = stickEls;
    this.pad = null;
    this.handlers = {};
    this.enabled = false;
    this.lastAim = { x: 0, y: 1 };
    this.R = 82; // touch stick travel radius: big and forgiving
    this.inject = null; // test hook: { mv:{x,y}, aim:{...} } overrides live input

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && this.enabled) e.preventDefault();
      if (!e.repeat) {
        if (k === 'ShiftLeft' || k === 'ShiftRight') this.edge.dash = true;
        if (k === 'KeyQ') this.edge.q = true;      // powers back on keys (no cooldown)
        if (k === 'KeyE') this.edge.e = true;
        if (k === 'KeyR') this.edge.r = true;
        this.emit('key', k);
      }
      this.keys.add(k);
      this.setTouchMode(false);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.sticks.move = this.sticks.aim = null; this.drawSticks(); });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e));
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, v) { if (this.handlers[name]) this.handlers[name](v); }
  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
    this.emit('mode', on);
  }
  down(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.setTouchMode(true);
      e.preventDefault();
      const left = e.clientX < innerWidth * 0.5;
      const which = left ? 'move' : 'aim';
      if (!this.sticks[which]) {
        this.sticks[which] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.drawSticks();
      }
      return;
    }
    this.setTouchMode(false);
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
    if (e.button === 0) this.mouse.down = true;
    if (e.button === 2) this.edge.dash = true;
  }
  move(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      for (const k of ['move', 'aim']) {
        const s = this.sticks[k];
        if (s && s.id === e.pointerId) {
          s.x = e.clientX; s.y = e.clientY;
          // the base follows the thumb if it drifts too far
          const R = this.R, dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
          if (d > R) { s.ox = s.x - dx / d * R; s.oy = s.y - dy / d * R; }
        }
      }
      this.drawSticks();
      return;
    }
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
  }
  up(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      for (const k of ['move', 'aim']) if (this.sticks[k] && this.sticks[k].id === e.pointerId) this.sticks[k] = null;
      this.drawSticks();
      return;
    }
    if (e.button === 0) this.mouse.down = false;
  }
  stickVec(s) {
    if (!s) return { x: 0, y: 0, m: 0 };
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), R = this.R, DZ = 9;
    if (d < DZ) return { x: 0, y: 0, m: 0 };
    // smooth ramp out of the dead zone so the first bit of travel is gentle, not a jump
    let m = Math.min(1, (d - DZ) / (R - DZ));
    m = m * m * (3 - 2 * m);
    return { x: (dx / d) * m, y: (-dy / d) * m, m };
  }
  drawSticks() {
    for (const k of ['move', 'aim']) {
      const el = this.stickEls[k], s = this.sticks[k];
      if (!el) continue;
      if (s) {
        el.classList.add('on');
        el.style.left = s.ox + 'px'; el.style.top = s.oy + 'px';
        const v = this.stickVec(s);
        el.firstElementChild.style.transform = `translate(${v.x * 52}px, ${-v.y * 52}px)`;
      } else {
        el.classList.remove('on');
        el.style.left = ''; el.style.top = '';
        el.firstElementChild.style.transform = '';
      }
    }
  }
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((x) => x && x.connected);
    if (!p) { this.pad = null; return; }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const prev = this.pad ? this.pad.btn : [];
    const btn = p.buttons.map((b) => b.pressed);
    const pressed = (i) => btn[i] && !prev[i];
    if (pressed(0) || pressed(4) || pressed(1) || pressed(5)) this.edge.dash = true; // face/shoulder buttons all dash now
    if (pressed(9)) this.emit('key', 'Escape');
    this.pad = { mx: dz(p.axes[0]), my: -dz(p.axes[1]), ax: dz(p.axes[2] || 0), ay: -dz(p.axes[3] || 0), fire: (p.buttons[7] && p.buttons[7].value > 0.3), btn };
  }
  // Screen-space move vector, y up.
  moveVec() {
    if (this.inject && this.inject.mv) return { x: this.inject.mv.x, y: this.inject.mv.y };
    let x = 0, y = 0;
    const K = this.keys;
    if (K.has('KeyA') || K.has('ArrowLeft')) x -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) x += 1;
    if (K.has('KeyW') || K.has('ArrowUp')) y += 1;
    if (K.has('KeyS') || K.has('ArrowDown')) y -= 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; }
    if (this.sticks.move) { const v = this.stickVec(this.sticks.move); return { x: v.x, y: v.y }; }
    if (this.pad && (this.pad.mx || this.pad.my)) return { x: this.pad.mx, y: this.pad.my };
    return { x: 0, y: 0 };
  }
  // Aim: { kind: 'mouse', sx, sy, fire } | { kind: 'dir', x, y (screen, y up), fire } | null
  aim() {
    if (this.inject && this.inject.aim) return this.inject.aim;
    if (this.sticks.aim) {
      const v = this.stickVec(this.sticks.aim);
      if (v.m > 0.15) { this.lastAim = { x: v.x, y: v.y }; }
      return { kind: 'dir', x: this.lastAim.x, y: this.lastAim.y, fire: v.m > 0.3 };
    }
    if (this.pad && (this.pad.ax || this.pad.ay)) {
      this.lastAim = { x: this.pad.ax, y: this.pad.ay };
      return { kind: 'dir', x: this.pad.ax, y: this.pad.ay, fire: true };
    }
    if (this.touchMode) return { kind: 'dir', x: this.lastAim.x, y: this.lastAim.y, fire: false, idle: true };
    return { kind: 'mouse', sx: this.mouse.x, sy: this.mouse.y, fire: this.mouse.down || this.keys.has('Space') || (this.pad && this.pad.fire) || this.keys.has('KeyJ') };
  }
  takeEdges() { const e = { ...this.edge }; this.edge.dash = this.edge.q = this.edge.e = this.edge.r = false; return e; }
  reset() { this.mouse.down = false; this.sticks.move = this.sticks.aim = null; this.keys.clear(); this.drawSticks(); this.takeEdges(); }
}
