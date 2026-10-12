// Pieces: the screen is drawn as separate pieces on a 2D canvas, and the black hole tears them off
// one by one. A torn piece wobbles loose, spirals in under the hole's gravity, stretches along the
// line to the hole (tidal forces), shrinks and is gone, leaving empty space behind. If you save the
// universe, every piece flies back home.
//
// What the pieces are depends on the background:
// - a picture (camera, browser tab, photo): the objects found in it (a person, a cup, a laptop…) go
//   first, cut out of the live picture; then the rest of the picture, in tiles.
// - the universe: every star and planet is its own piece; the sky behind them goes last.
// - the website: its real parts (menu, headline, buttons, cards); the page behind them goes last.

const WOBBLE = 0.35;      // seconds a piece shakes before it tears loose

export class Pieces {
  /** source: { kind, el, mirror }. objects: detections in source pixels (pictures only). */
  constructor(source, w, h, scale, objects = []) {
    this.source = source;
    this.objects = objects;
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d');
    this.layout(w, h, scale);
  }

  layout(w, h, scale) {
    this.w = w;
    this.h = h;
    this.k = scale;
    this.L = Math.min(w, h);
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    const kind = this.source.kind;
    if (kind === 'website') this.list = websitePieces(w, h);
    else if (kind === 'stars') this.list = starPieces(w, h);
    else this.list = [...objectPieces(this.source, this.objects, w, h), ...tilePieces(this.source, w, h)];
    // Small pieces cost less, so a sky full of stars drains at a steady pace.
    const unit = (this.L / 7) ** 2;
    for (const p of this.list) p.cost = Math.max(0.12, Math.min(1.5, (p.w * p.h) / unit));
    this.eaten = 0;
    this.releaseClock = 0;
  }

  get total() { return this.list.length; }
  get remaining() { return this.list.filter((p) => p.state === 'home').length; }
  get flying() { return this.list.filter((p) => p.state === 'flying'); }

  /** Advance the pieces. pullR is how far the hole reaches (CSS px); rate is pieces per second. */
  update(dt, world, pullR, rate, mode) {
    const hole = world.hole;
    if (mode !== 'won') {
      this.releaseClock += dt * rate;
      // Found objects go first, nearest first, wherever they are. Then everything else in reach.
      const home = this.list.filter((p) => p.state === 'home');
      const objects = home.filter((p) => p.object);
      let ready = objects.length
        ? objects
        : home.filter((p) => distToRect(hole, p) < pullR && !(p.sheet && sheetBlocked(this.list, p)));
      ready.sort((a, b) => distToRect(hole, a) - distToRect(hole, b));
      while (ready.length && this.releaseClock >= ready[0].cost) {
        const p = ready.shift();
        this.releaseClock -= p.cost;
        p.state = 'wobble';
        p.timer = WOBBLE;
      }
      if (!ready.length) this.releaseClock = Math.min(this.releaseClock, 1);
    }

    const G = world.G0 * 3.2 * (mode === 'lost' ? 3 : 1);
    for (const p of this.list) {
      if (p.state === 'wobble') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.state = 'flying';
          // A little sideways speed so it spirals in instead of dropping straight.
          const dx = p.x - hole.x, dy = p.y - hole.y, r = Math.hypot(dx, dy) || 1;
          const v = Math.sqrt(G / r) * 0.55 * p.spin;
          p.vx = (-dy / r) * v;
          p.vy = (dx / r) * v;
        }
      } else if (p.state === 'flying') {
        const dx = hole.x - p.x, dy = hole.y - p.y, r = Math.hypot(dx, dy) || 1;
        const a = G / Math.max(r * r, world.rs * world.rs);
        p.vx += (dx / r) * a * dt;
        p.vy += (dy / r) * a * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spinRate * dt;
        p.hitCool = Math.max(0, (p.hitCool || 0) - dt);
        if (r < world.rs * 1.05) { p.state = 'gone'; this.eaten += 1; }
      } else if (p.state === 'return') {
        p.timer = Math.min(1, p.timer + dt / 0.9);
        const e = 1 - Math.pow(1 - p.timer, 3);
        p.x = p.fromX + (p.hx - p.fromX) * e;
        p.y = p.fromY + (p.hy - p.fromY) * e;
        p.rot = p.fromRot * (1 - e);
        if (p.timer >= 1) { p.state = 'home'; p.x = p.hx; p.y = p.hy; p.rot = 0; }
      }
    }
  }

  /** Bring every piece home (the universe is saved). */
  restore(world) {
    for (const p of this.list) {
      if (p.state === 'home') continue;
      const gone = p.state === 'gone';
      p.fromX = gone ? world.hole.x : p.x;
      p.fromY = gone ? world.hole.y : p.y;
      p.fromRot = gone ? 0 : p.rot;
      p.state = 'return';
      p.timer = 0;
    }
  }

  /** The size of a flying piece right now, for collisions with your bubble. */
  hitRadius(p, world) {
    const r = Math.hypot(world.hole.x - p.x, world.hole.y - p.y);
    const shrink = Math.max(0.05, Math.min(1, (r - world.rs) / (world.rs * 6)));
    return 0.42 * Math.min(p.w, p.h) * shrink + 0.15 * Math.max(p.w, p.h) * shrink;
  }

  draw(world, time, showLabels) {
    const g = this.g, k = this.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const hole = world.hole;
    // Where a found object has left the picture, the tiles under it show a hole too.
    const away = this.list.filter((p) => p.object && p.state !== 'home');
    // Draw home pieces first and flying ones on top, objects above tiles.
    const order = [...this.list].sort((a, b) => rank(a) - rank(b));
    for (const p of order) {
      if (p.state === 'gone') continue;
      let x = p.x, y = p.y, sx = 1, sy = 1, along = 0;
      if (p.state === 'wobble') {
        const j = (1 - p.timer / WOBBLE) * 3;
        x += Math.sin(time * 70 + p.seed * 9) * j;
        y += Math.cos(time * 63 + p.seed * 5) * j;
      } else if (p.state === 'flying' || p.state === 'return') {
        // Tidal stretch: long toward the hole, thin across, and smaller as it nears the horizon.
        const dx = hole.x - x, dy = hole.y - y, r = Math.hypot(dx, dy) || 1;
        along = Math.atan2(dy, dx);
        const tide = Math.min(4, (world.rs * 2.2) / r);
        sx = 1 + tide * 1.6;
        sy = 1 / (1 + tide);
        const shrink = Math.max(0.05, Math.min(1, (r - world.rs) / (world.rs * 6)));
        sx *= shrink;
        sy *= shrink;
        if (p.state === 'return') { const e = p.timer; sx += (1 - sx) * e; sy += (1 - sy) * e; }
      }
      g.save();
      g.translate(x, y);
      if (along) {
        g.rotate(along);
        g.scale(sx, sy);
        g.rotate(-along);
      }
      g.rotate(p.rot);
      if (p.tile && away.length && (p.state === 'home' || p.state === 'wobble')) {
        // Cut the departed objects out of this tile.
        g.beginPath();
        g.rect(-p.w / 2, -p.h / 2, p.w, p.h);
        for (const o of away) g.rect(o.hx - o.w / 2 - p.hx - 1, o.hy - o.h / 2 - p.hy - 1, o.w + 2, o.h + 2);
        g.clip('evenodd');
      }
      p.draw(g, this.source, -p.w / 2, -p.h / 2, p.w, p.h);
      if (p.object && showLabels && p.state !== 'flying') label(g, p, time);
      g.restore();
    }
  }
}

const rank = (p) => (p.state === 'flying' ? 3 : 0) + (p.object ? 2 : 0) + (p.sheet ? -1 : 0);

function label(g, p, time) {
  const a = 0.75 + 0.25 * Math.sin(time * 6);
  g.strokeStyle = `rgba(124,245,255,${a})`;
  g.lineWidth = 2;
  g.setLineDash([6, 4]);
  g.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
  g.setLineDash([]);
  const text = p.label;
  g.font = '700 12px system-ui, sans-serif';
  const tw = g.measureText(text).width + 12;
  g.fillStyle = `rgba(124,245,255,${a})`;
  g.fillRect(-p.w / 2, -p.h / 2 - 18, tw, 18);
  g.fillStyle = '#002';
  g.textBaseline = 'middle';
  g.fillText(text, -p.w / 2 + 6, -p.h / 2 - 9);
}

function distToRect(pt, p) {
  const cx = Math.max(p.hx - p.w / 2, Math.min(pt.x, p.hx + p.w / 2));
  const cy = Math.max(p.hy - p.h / 2, Math.min(pt.y, p.hy + p.h / 2));
  return Math.hypot(pt.x - cx, pt.y - cy);
}

/** Sheets (the page, the sky) only tear once nothing else on them is left. */
function sheetBlocked(list, sheet) {
  return list.some((p) => !p.sheet && p.state === 'home' && Math.abs(p.hx - sheet.hx) < sheet.w / 2 && Math.abs(p.hy - sheet.hy) < sheet.h / 2);
}

function piece(hx, hy, w, h, draw, extra = {}) {
  return {
    hx, hy, w, h, x: hx, y: hy, rot: 0, draw, seed: Math.random(),
    spin: Math.random() < 0.5 ? 1 : 1.15,
    spinRate: (Math.random() - 0.5) * 6,
    state: 'home', timer: 0, vx: 0, vy: 0,
    ...extra,
  };
}

// ---------- pictures: found objects, then tiles ----------

function coverMap(el, w, h) {
  const sw = el.videoWidth || el.naturalWidth || el.width;
  const sh = el.videoHeight || el.naturalHeight || el.height;
  if (!sw || !sh) return null;
  const k = Math.max(w / sw, h / sh);
  return { k, sw, sh, ox: (w - sw * k) / 2, oy: (h - sh * k) / 2 };
}

/** Draw the screen rect (x0, y0, rw, rh) of the live picture into (dx, dy, dw, dh). */
function drawRegion(g, src, w, h, x0, y0, rw, rh, dx, dy, dw, dh) {
  const s = coverMap(src.el, w, h);
  if (!s) return;
  let ux = (x0 - s.ox) / s.k;
  const uy = (y0 - s.oy) / s.k, uw = rw / s.k, uh = rh / s.k;
  if (src.mirror) {
    ux = s.sw - ux - uw;
    g.save();
    g.scale(-1, 1);
    g.drawImage(src.el, ux, uy, uw, uh, -dx - dw, dy, dw, dh);
    g.restore();
  } else {
    g.drawImage(src.el, ux, uy, uw, uh, dx, dy, dw, dh);
  }
}

function objectPieces(source, objects, w, h) {
  const s = coverMap(source.el, w, h);
  if (!s) return [];
  const list = [];
  for (const o of objects) {
    // Source box to screen box (mirrored for the camera), clipped to the screen.
    let x = s.ox + (source.mirror ? s.sw - o.x - o.w : o.x) * s.k;
    let y = s.oy + o.y * s.k;
    let bw = o.w * s.k, bh = o.h * s.k;
    const x1 = Math.min(w, x + bw), y1 = Math.min(h, y + bh);
    x = Math.max(0, x);
    y = Math.max(0, y);
    bw = x1 - x;
    bh = y1 - y;
    if (bw < 12 || bh < 12) continue;
    const x0 = x, y0 = y;
    list.push(piece(x + bw / 2, y + bh / 2, bw, bh,
      (g, src, dx, dy, dw, dh) => drawRegion(g, src, w, h, x0, y0, bw, bh, dx, dy, dw, dh),
      { object: true, label: o.label }));
  }
  return list;
}

function tilePieces(source, w, h) {
  const size = Math.min(w, h) / 7;
  const cols = Math.ceil(w / size), rows = Math.ceil(h / size);
  const tw = w / cols, th = h / rows;
  const list = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * tw, y0 = r * th;
      list.push(piece(x0 + tw / 2, y0 + th / 2, tw + 0.6, th + 0.6,
        (g, src, dx, dy, dw, dh) => drawRegion(g, src, w, h, x0, y0, tw, th, dx, dy, dw, dh),
        { tile: true }));
    }
  }
  return list;
}

// ---------- shared helpers for drawn pieces ----------

/** A piece drawn once into its own small canvas. */
function sprite(list, x, y, pw, ph, paint, extra) {
  const c = document.createElement('canvas');
  const k = 2;
  c.width = Math.max(1, Math.ceil(pw * k));
  c.height = Math.max(1, Math.ceil(ph * k));
  const g = c.getContext('2d');
  g.scale(k, k);
  paint(g, pw, ph);
  list.push(piece(x + pw / 2, y + ph / 2, pw, ph, (gg, src, dx, dy, dw, dh) => gg.drawImage(c, dx, dy, dw, dh), extra));
}

function sheets(list, w, h, rows, cols, paint) {
  const sw = w / cols, sh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sprite(list, c * sw, r * sh, sw + 1, sh + 1, (g, pw, ph) => paint(g, pw, ph, c * sw, r * sh), { sheet: true });
    }
  }
}

// ---------- the universe: every star and planet ----------

function starPieces(w, h) {
  const list = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // The sky: deep blue-black with two faint nebulae, baked into sheets.
  const neb = [[w * 0.25, h * 0.3, Math.max(w, h) * 0.35, 'rgba(120,60,200,.28)'], [w * 0.8, h * 0.72, Math.max(w, h) * 0.4, 'rgba(30,140,200,.24)']];
  sheets(list, w, h, 3, w > h ? 4 : 3, (g, pw, ph, ox, oy) => {
    const sky = g.createLinearGradient(-ox, -oy, w - ox, h - oy);
    sky.addColorStop(0, '#0b0820');
    sky.addColorStop(1, '#03111c');
    g.fillStyle = sky;
    g.fillRect(0, 0, pw, ph);
    for (const [nx, ny, nr, col] of neb) {
      const n = g.createRadialGradient(nx - ox, ny - oy, 0, nx - ox, ny - oy, nr);
      n.addColorStop(0, col);
      n.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = n;
      g.fillRect(0, 0, pw, ph);
    }
  });
  // Stars
  const count = Math.round((w * h) / 2600);
  for (let i = 0; i < count; i++) {
    const big = rnd() < 0.12;
    const s = big ? 9 + rnd() * 5 : 4 + rnd() * 3;
    const tint = ['#ffffff', '#cfe3ff', '#ffe9c4', '#ffd2d2'][Math.floor(rnd() * 4)];
    sprite(list, rnd() * (w - s), rnd() * (h - s), s, s, (g, pw) => {
      const c = pw / 2;
      const glow = g.createRadialGradient(c, c, 0, c, c, c);
      glow.addColorStop(0, tint);
      glow.addColorStop(0.35, tint);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, pw, pw);
      if (big) {
        g.strokeStyle = 'rgba(255,255,255,.6)';
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(0, c); g.lineTo(pw, c); g.moveTo(c, 0); g.lineTo(c, pw);
        g.stroke();
      }
    });
  }
  // Planets
  const L = Math.min(w, h);
  const planets = [[0.72, 0.62, 0.11, '#ffcf8a', '#b5651d', true], [0.2, 0.78, 0.07, '#9fe7ff', '#1d5fb5'], [0.55, 0.42, 0.045, '#ff9d9d', '#8a1d3a'], [0.88, 0.9, 0.05, '#d6ffb0', '#3a7a1d']];
  for (const [px, py, pr, a, b, ring] of planets) {
    const r = pr * L, size = ring ? r * 3.6 : r * 2;
    sprite(list, px * w - size / 2, py * h - size / 2, size, ring ? r * 2.2 : size, (g, pw, ph) => {
      const cx = pw / 2, cy = ph / 2;
      const p = g.createRadialGradient(cx - r / 3, cy - r / 3, r / 6, cx, cy, r);
      p.addColorStop(0, a);
      p.addColorStop(1, b);
      g.fillStyle = p;
      g.beginPath();
      g.arc(cx, cy, r * (ring ? 0.95 : 1), 0, Math.PI * 2);
      g.fill();
      if (ring) {
        g.strokeStyle = 'rgba(255,220,170,.7)';
        g.lineWidth = r * 0.08;
        g.beginPath();
        g.ellipse(cx, cy, pw * 0.48, ph * 0.18, -0.25, 0, Math.PI * 2);
        g.stroke();
      }
    });
  }
  return list;
}

// ---------- the website: its real parts ----------

function websitePieces(w, h) {
  const list = [];
  const pad = Math.max(16, w * 0.05);
  const inner = w - pad * 2;
  const wide = w > 700;
  const text = (g, str, x, y, size, weight, color) => {
    g.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(str, x, y);
  };
  const box = (g, x, y, bw, bh, r, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x, y, bw, bh, r);
    g.fill();
  };
  const add = (x, y, pw, ph, paint) => sprite(list, x, y, pw, ph, paint);

  // The page itself, in big sheets that go last.
  sheets(list, w, h, 4, wide ? 3 : 2, (g, pw, ph) => {
    g.fillStyle = '#f4f6fa';
    g.fillRect(0, 0, pw, ph);
  });

  let y = pad * 0.6;
  // Top bar: logo and links
  add(pad, y, 120, 34, (g) => { box(g, 0, 4, 26, 26, 8, '#5b5bf6'); text(g, 'mysite', 34, 17, 18, 800, '#121426'); });
  const links = wide ? ['Work', 'Blog', 'About', 'Contact'] : ['Work', 'Blog'];
  let lx = w - pad;
  for (const l of links.slice().reverse()) {
    const lw = l.length * 8.5 + 16;
    lx -= lw;
    add(lx, y + 4, lw, 26, (g, pw, ph) => text(g, l, 8, ph / 2, 14, 600, '#3a3f5c'));
    lx -= 6;
  }
  y += 34 + pad;

  // Hero: kicker, headline, a paragraph, two buttons
  add(pad, y, 150, 24, (g, pw, ph) => { box(g, 0, 0, pw, ph, 12, '#e6e6ff'); text(g, '✦ New this week', 10, ph / 2, 12, 700, '#4b4bd8'); });
  y += 36;
  const hs = Math.min(44, inner / 9);
  for (const line of ['Build small things', 'that people love.']) {
    const lw = Math.min(inner, line.length * hs * 0.52);
    add(pad, y, lw, hs * 1.15, (g, pw, ph) => text(g, line, 0, ph / 2, hs, 800, '#121426'));
    y += hs * 1.2;
  }
  y += 8;
  for (const line of ['A tiny studio making playful web apps.', 'One new experiment every single day.']) {
    const lw = Math.min(inner, line.length * 7.6);
    add(pad, y, lw, 22, (g, pw, ph) => text(g, line, 0, ph / 2, 14, 400, '#5a607a'));
    y += 24;
  }
  y += 12;
  add(pad, y, 132, 44, (g, pw, ph) => { box(g, 0, 0, pw, ph, 22, '#121426'); text(g, 'Get started', 22, ph / 2, 15, 700, '#fff'); });
  add(pad + 144, y, 112, 44, (g, pw, ph) => {
    box(g, 0, 0, pw, ph, 22, '#fff');
    g.strokeStyle = '#cfd3e3';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(0.75, 0.75, pw - 1.5, ph - 1.5, 22);
    g.stroke();
    text(g, 'See work', 22, ph / 2, 15, 700, '#121426');
  });
  y += 44 + pad;

  // Cards: picture, title, one line
  const cols = wide ? 3 : 2;
  const gap = 14;
  const cw = (inner - gap * (cols - 1)) / cols;
  const colors = [['#ff9a8b', '#ff6a88'], ['#8fd3f4', '#84fab0'], ['#a18cd1', '#fbc2eb'], ['#fddb92', '#d1fdff'], ['#f6d365', '#fda085'], ['#96fbc4', '#f9f586']];
  const titles = ['Mirror Room', 'Living Heart', 'Night Sky', 'Paper Plane', 'Tiny Synth', 'Pixel Pet'];
  let i = 0;
  while (y + cw * 0.62 + 50 < h - pad && i < 12) {
    for (let c = 0; c < cols && i < 12; c++, i++) {
      const x = pad + c * (cw + gap);
      const [a, b] = colors[i % colors.length];
      const title = titles[i % titles.length];
      const day = i + 1;
      add(x, y, cw, cw * 0.62, (g, pw, ph) => {
        const grad = g.createLinearGradient(0, 0, pw, ph);
        grad.addColorStop(0, a);
        grad.addColorStop(1, b);
        box(g, 0, 0, pw, ph, 14, grad);
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.beginPath();
        g.arc(pw * 0.72, ph * 0.38, ph * 0.18, 0, Math.PI * 2);
        g.fill();
      });
      add(x, y + cw * 0.62 + 6, cw, 22, (g, pw, ph) => text(g, title, 2, ph / 2, 15, 700, '#121426'));
      add(x, y + cw * 0.62 + 28, cw * 0.8, 18, (g, pw, ph) => text(g, `Day ${day} · play it`, 2, ph / 2, 12, 400, '#7a8099'));
    }
    y += cw * 0.62 + 56;
  }
  return list;
}
