// Walk mode: first person inside the block world. Gravity, jumping, collisions with blocks, a crosshair,
// an outline on the block you're looking at, breaking (with falling bits) and placing, a held block
// that swings, and a gentle head bob while walking. Laptop: WASD / arrows + mouse (click to capture),
// space to jump, left click break, right click place. Phone: left thumb joystick, drag on the right
// to look, Jump button, tap to break, long-press to place.
//
// The world is rebuilt from a photo, so a room is about 25 blocks tall. The player is scaled to the
// room (eye height about 55% of the room), and speeds and jumps scale with it.

import * as THREE from 'three';

export function createWalk(ctx) {
  const { camera, scene, renderer, $ } = ctx;
  const state = {
    on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false,
    eye: 8, radius: 1.4, speed: 12, jumpV: 14, gravity: 40, bob: 0, swing: 0, keys: new Set(), stick: { x: 0, y: 0 },
  };
  let solid = new Set();
  const key = (x, y, z) => `${x},${y},${z}`;
  const isSolid = (x, y, z) => solid.has(key(Math.round(x), Math.round(y), Math.round(z)));

  function rebuildSolid() {
    solid = new Set();
    const w = ctx.world();
    if (!w) return;
    for (const b of w.blocks) {
      if (b.gone || b.type === 'water') continue;
      const o = w.groups[b.group].offset;
      solid.add(key(b.x + o.x, b.y + o.y, b.z + o.z));
    }
  }

  // ---------- outline, held block, particles ----------

  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: 0x111111 }));
  outline.visible = false;
  scene.add(outline);

  const held = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  held.visible = false;
  camera.add(held);
  scene.add(camera);

  const bits = [];
  const bitGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  function burst(p, color) {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(bitGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace) }));
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6));
      m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4), life: 0.7 + Math.random() * 0.5 };
      scene.add(m); bits.push(m);
    }
  }

  // ---------- start / stop ----------

  function start() {
    const w = ctx.world();
    if (!w) return;
    rebuildSolid();
    // Eye height from the room: floor to ceiling, using the floor blocks near the front.
    const floors = w.blocks.filter((b) => b.type === 'floor' || b.type === 'grass');
    const floorY = floors.length ? Math.min(...floors.map((b) => b.y)) : w.bounds.min.y;
    const roomH = Math.max(6, w.bounds.max.y - floorY);
    state.eye = Math.min(20, Math.max(3, roomH * 0.55));
    state.radius = Math.max(0.6, state.eye * 0.16);
    state.speed = state.eye * 1.5;
    state.gravity = state.eye * 5;
    state.jumpV = Math.sqrt(2 * state.gravity * state.eye * 0.3);
    // Start near the front middle, standing on the floor, looking into the room.
    const cx = (w.bounds.min.x + w.bounds.max.x) / 2;
    let sx = cx, sz = w.bounds.max.z - 2;
    const fronts = floors.filter((b) => b.z > w.bounds.max.z - 12).sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
    if (fronts.length) { sx = fronts[0].x; sz = fronts[0].z; }
    state.pos.set(sx, floorY + 0.5, sz);
    while (collides(state.pos) && state.pos.y < w.bounds.max.y + 5) state.pos.y += 1;
    state.vel.set(0, 0, 0);
    state.yaw = 0; state.pitch = -0.05;
    state.on = true;
    camera.near = 0.1; camera.updateProjectionMatrix();
    held.position.set(state.eye * 0.05 + 0.35, -0.32, -0.6);
    held.visible = true;
    setHeld(ctx.placeType());
    $('walkui').hidden = false;
    $('crosshair').hidden = false;
  }
  function stop() {
    state.on = false;
    outline.visible = false; held.visible = false;
    camera.near = 0.3; camera.updateProjectionMatrix();
    $('walkui').hidden = true; $('crosshair').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function setHeld(type) {
    const c = ctx.colorFor(type);
    held.material = ctx.materialFor(type);
    if (Array.isArray(held.material)) held.material = held.material[2];
    held.material = held.material.clone();
    held.material.vertexColors = false;
    held.material.color = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  }

  // ---------- physics ----------

  function collides(p) {
    const r = state.radius, h = state.eye * 1.1;
    // Check every block the body overlaps (steps under one block, so thin walls can't be skipped).
    const n = Math.max(1, Math.ceil((2 * r) / 0.9));
    for (let dy = 0.05; dy <= h; dy += 0.9) {
      for (let a = 0; a <= n; a++) {
        const dx = -r + (2 * r * a) / n;
        for (let b = 0; b <= n; b++) {
          const dz = -r + (2 * r * b) / n;
          if (isSolid(p.x + dx, p.y + dy, p.z + dz)) return true;
        }
      }
    }
    return false;
  }

  function step(dt) {
    if (!state.on) return;
    const k = state.keys;
    let fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + state.stick.x;
    let fz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + state.stick.y;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    const wantX = (fx * cos + fz * sin) * state.speed, wantZ = (-fx * sin + fz * cos) * state.speed;
    const ease = state.onGround ? 12 : 3;
    state.vel.x += (wantX - state.vel.x) * Math.min(1, ease * dt);
    state.vel.z += (wantZ - state.vel.z) * Math.min(1, ease * dt);
    state.vel.y -= state.gravity * dt;
    if ((k.has('Space') || jumpHeld) && state.onGround) { state.vel.y = state.jumpV; state.onGround = false; ctx.sound('jump'); }

    // Move one axis at a time; step up onto single blocks like stairs.
    const p = state.pos;
    for (const axis of ['x', 'z']) {
      const old = p[axis];
      p[axis] += state.vel[axis] * dt;
      if (collides(p)) {
        p.y += 1;
        if (!state.onGround || collides(p)) { p.y -= 1; p[axis] = old; state.vel[axis] = 0; }
      }
    }
    p.y += state.vel.y * dt;
    state.onGround = false;
    if (collides(p)) {
      if (state.vel.y < 0) { p.y = Math.ceil(p.y - 0.05 - 0.5) + 0.5; while (collides(p)) p.y += 0.25; state.onGround = true; }
      else p.y -= state.vel.y * dt;
      state.vel.y = 0;
    }
    const w = ctx.world();
    if (p.y < w.bounds.min.y - 30) { start(); return; }   // fell off the edge: back to the start

    // Head bob while walking on the ground.
    const moving = state.onGround && Math.hypot(state.vel.x, state.vel.z) > state.speed * 0.2;
    if (moving) {
      const before = Math.sin(state.bob);
      state.bob += dt * 9;
      if (before < 0 && Math.sin(state.bob) >= 0) ctx.sound('step');
    }
    const bobY = moving ? Math.abs(Math.sin(state.bob)) * state.eye * 0.025 : 0;
    camera.position.set(p.x, p.y + state.eye + bobY, p.z);
    camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');

    // Held block: sways with walking, swings on break/place.
    state.swing = Math.max(0, state.swing - dt * 5);
    const s = Math.sin(state.swing * Math.PI);
    held.position.set(0.42 + Math.sin(state.bob) * 0.02, -0.34 - s * 0.12 + Math.abs(Math.sin(state.bob)) * 0.015, -0.62 + s * 0.08);
    held.rotation.set(0.5 + s * 0.8, 0.6, 0.15);

    // Outline the block in the crosshair.
    const t = target();
    outline.visible = !!t;
    if (t) outline.position.copy(t.pos);

    // Falling bits.
    for (let i = bits.length - 1; i >= 0; i--) {
      const m = bits[i];
      m.userData.v.y -= 18 * dt;
      m.position.addScaledVector(m.userData.v, dt);
      m.userData.life -= dt;
      m.rotation.x += dt * 6; m.rotation.y += dt * 5;
      if (m.userData.life <= 0) { scene.remove(m); m.material.dispose(); bits.splice(i, 1); }
    }
  }

  const center = new THREE.Vector2(0, 0);
  function target() {
    const h = ctx.pickAt(center);
    if (!h) return null;
    const max = state.eye * 3;
    if (h.h.distance > max) return null;
    const o = ctx.world().groups[h.b.group].offset;
    return { ...h, pos: new THREE.Vector3(h.b.x + o.x, h.b.y + o.y, h.b.z + o.z) };
  }
  function breakAtCrosshair() {
    const t = target();
    state.swing = 1;
    if (!t) return;
    burst(t.pos, t.b.color);
    ctx.breakBlock(t.b);
    solid.delete(key(t.pos.x, t.pos.y, t.pos.z));
  }
  function placeAtCrosshair() {
    const t = target();
    state.swing = 1;
    if (!t) return;
    const n = t.h.face.normal;
    const p = t.pos.clone().add(new THREE.Vector3(Math.round(n.x), Math.round(n.y), Math.round(n.z)));
    // Don't place a block inside yourself.
    const me = state.pos;
    if (Math.abs(p.x - me.x) <= state.radius + 0.5 && Math.abs(p.z - me.z) <= state.radius + 0.5 && p.y >= me.y - 0.5 && p.y <= me.y + state.eye * 1.1) return;
    ctx.placeAt(p, t.b);
    solid.add(key(p.x, p.y, p.z));
  }

  // ---------- input ----------

  const el = renderer.domElement;
  let jumpHeld = false;
  addEventListener('keydown', (e) => {
    if (!state.on) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) { state.keys.add(e.code); e.preventDefault(); }
    if (/^Digit[1-9]$/.test(e.code)) ctx.pickSlot(Number(e.code.slice(5)) - 1);
    if (e.code === 'Escape') ctx.exitWalk();
  });
  addEventListener('keyup', (e) => state.keys.delete(e.code));
  el.addEventListener('mousedown', (e) => {
    if (!state.on || e.pointerType === 'touch') return;
    if (!document.pointerLockElement && matchMedia('(pointer: fine)').matches) { el.requestPointerLock?.(); return; }
    if (e.button === 0) breakAtCrosshair();
    if (e.button === 2) placeAtCrosshair();
  });
  el.addEventListener('contextmenu', (e) => { if (state.on) e.preventDefault(); });
  addEventListener('mousemove', (e) => {
    if (!state.on || document.pointerLockElement !== el) return;
    look(e.movementX, e.movementY);
  });
  function look(dx, dy) {
    state.yaw -= dx * 0.0025;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * 0.0025));
  }

  // Touch: left joystick, right side drag to look, tap to break, long press to place.
  const touches = new Map();
  el.addEventListener('touchstart', (e) => {
    if (!state.on) return;
    for (const t of e.changedTouches) {
      const left = t.clientX < innerWidth * 0.4 && t.clientY > innerHeight * 0.45;
      touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, left, t0: performance.now(), moved: false,
        hold: left ? 0 : setTimeout(() => { const s = touches.get(t.identifier); if (s && !s.moved) { s.placed = true; placeAtCrosshair(); } }, 450) });
      if (left) showStick(t.clientX, t.clientY);
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    if (!state.on) return;
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (!s) continue;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      s.x = t.clientX; s.y = t.clientY;
      if (Math.hypot(s.x - s.x0, s.y - s.y0) > 10) s.moved = true;
      if (s.left) {
        const R = 55;
        let vx = (s.x - s.x0) / R, vy = (s.y - s.y0) / R;
        const l = Math.hypot(vx, vy); if (l > 1) { vx /= l; vy /= l; }
        state.stick.x = vx; state.stick.y = vy;
        moveStick(vx, vy);
      } else look(dx * 2.2, dy * 2.2);
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (!s) continue;
      clearTimeout(s.hold);
      if (s.left) { state.stick.x = 0; state.stick.y = 0; hideStick(); }
      else if (!s.moved && !s.placed && performance.now() - s.t0 < 450) breakAtCrosshair();
      touches.delete(t.identifier);
    }
  });
  function showStick(x, y) { const b = $('stick'); b.style.left = `${x - 50}px`; b.style.top = `${y - 50}px`; b.hidden = false; moveStick(0, 0); }
  function moveStick(vx, vy) { $('knob').style.transform = `translate(${vx * 32}px, ${vy * 32}px)`; }
  function hideStick() { $('stick').hidden = true; }
  $('jump').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpHeld = true; });
  $('jump').addEventListener('pointerup', () => (jumpHeld = false));
  $('jump').addEventListener('pointerleave', () => (jumpHeld = false));

  return { start, stop, step, setHeld, rebuildSolid, get on() { return state.on; }, state };
}
