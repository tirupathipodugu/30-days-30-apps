// The universes you can choose. Each one is a list of pieces: every star, planet, moon, asteroid,
// cloud and galaxy is its own piece, so the black hole can tear them off one at a time. The sky
// behind them is cut into big sheets that go last.
//
// A piece is { hx, hy, w, h, img, sheet?, twinkle? }: its home centre, its size and a small canvas.

export const UNIVERSES = [
  { id: 'solar', name: 'Solar System', blurb: 'A sun, eight planets, rings, moons and an asteroid belt.' },
  { id: 'galaxy', name: 'Spiral Galaxy', blurb: 'Hundreds of stars in glowing spiral arms.' },
  { id: 'nebula', name: 'Nebula Nursery', blurb: 'Colourful gas clouds where new stars are born.' },
  { id: 'deep', name: 'Deep Field', blurb: 'Dozens of distant galaxies of every shape.' },
];

export function buildUniverse(id, w, h) {
  starIndex = 0;
  const make = { solar, galaxy, nebula, deep }[id] || solar;
  return make(w, h, rng(id.length * 7919 + 17));
}

// ---------- helpers ----------

function rng(seed) {
  let s = seed % 2147483647;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Draw into a small canvas of size pw x ph (CSS px, 2x pixels). */
function paint(pw, ph, fn) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(pw * 2));
  c.height = Math.max(1, Math.ceil(ph * 2));
  const g = c.getContext('2d');
  g.scale(2, 2);
  fn(g, pw, ph);
  return c;
}

const starCache = new Map();
/** A glowing star sprite; many stars share the same few canvases. */
function starImg(size, tint, spikes) {
  const key = `${Math.round(size)}|${tint}|${spikes}`;
  if (!starCache.has(key)) {
    starCache.set(key, paint(size, size, (g, s) => {
      const c = s / 2;
      const glow = g.createRadialGradient(c, c, 0, c, c, c);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.18, tint);
      glow.addColorStop(0.45, tint.replace('rgb(', 'rgba(').replace(')', ',.35)'));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, s, s);
      if (spikes) {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(0, c); g.lineTo(s, c); g.moveTo(c, 0); g.lineTo(c, s);
        g.stroke();
      }
    }));
  }
  return starCache.get(key);
}

const STAR_TINTS = ['rgb(255,255,255)', 'rgb(200,220,255)', 'rgb(170,200,255)', 'rgb(255,236,200)', 'rgb(255,210,170)', 'rgb(255,190,190)'];

function addStars(list, r, count, area, opts = {}) {
  const [x0, y0, aw, ah] = area;
  for (let i = 0; i < count; i++) {
    const big = r() < (opts.bigShare ?? 0.08);
    const size = big ? 10 + r() * 8 : 3 + r() * 4;
    const tint = opts.tints ? opts.tints[Math.floor(r() * opts.tints.length)] : STAR_TINTS[Math.floor(r() * STAR_TINTS.length)];
    const x = opts.at ? opts.at(r)[0] : x0 + r() * aw;
    const y = opts.at ? opts.at.last : y0 + r() * ah;
    list.push({ hx: x, hy: y, w: size, h: size, img: starImg(size, tint, big), twinkle: r() * 6.28, label: big ? starName() : undefined });
  }
}

const STAR_NAMES = ['Sirius', 'Vega', 'Rigel', 'Betelgeuse', 'Polaris', 'Antares', 'Arcturus', 'Capella', 'Aldebaran', 'Altair', 'Deneb', 'Spica', 'Procyon', 'Canopus', 'Regulus', 'Mira', 'Bellatrix', 'Castor', 'Pollux', 'Fomalhaut'];
let starIndex = 0;
function starName() { return STAR_NAMES[starIndex++ % STAR_NAMES.length]; }

/** The sky behind everything, in big sheets. */
function sky(list, w, h, paintSky) {
  const big = paint(w, h, paintSky);
  const rows = 3, cols = w > h ? 4 : 3;
  const sw = w / cols, sh = h / rows;
  for (let rr = 0; rr < rows; rr++) {
    for (let c = 0; c < cols; c++) {
      const img = paint(sw + 1, sh + 1, (g) => g.drawImage(big, c * sw * 2, rr * sh * 2, (sw + 1) * 2, (sh + 1) * 2, 0, 0, sw + 1, sh + 1));
      list.push({ hx: c * sw + sw / 2, hy: rr * sh + sh / 2, w: sw + 1, h: sh + 1, img, sheet: true });
    }
  }
}

function cloud(g, x, y, rad, color, a) {
  const n = g.createRadialGradient(x, y, 0, x, y, rad);
  n.addColorStop(0, `rgba(${color},${a})`);
  n.addColorStop(0.6, `rgba(${color},${a * 0.4})`);
  n.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = n;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

function planet(r, color1, color2, opts = {}) {
  const ring = opts.ring;
  const pw = ring ? r * 4 : r * 2.2, ph = ring ? r * 2.4 : r * 2.2;
  return paint(pw, ph, (g) => {
    const cx = pw / 2, cy = ph / 2;
    if (ring) {
      // back half of the ring
      g.strokeStyle = ring;
      g.lineWidth = r * 0.22;
      g.beginPath();
      g.ellipse(cx, cy, r * 1.85, r * 0.55, -0.3, Math.PI, Math.PI * 2);
      g.stroke();
    }
    const p = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
    p.addColorStop(0, color1);
    p.addColorStop(1, color2);
    g.fillStyle = p;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    if (opts.bands) {
      g.save();
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.clip();
      for (let i = -3; i <= 3; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,.12)' : 'rgba(80,40,20,.15)';
        g.fillRect(cx - r, cy + i * r * 0.28 - r * 0.1, r * 2, r * 0.18);
      }
      g.restore();
    }
    // night side
    const shade = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    shade.addColorStop(0.45, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    if (ring) {
      g.strokeStyle = ring;
      g.lineWidth = r * 0.22;
      g.beginPath();
      g.ellipse(cx, cy, r * 1.85, r * 0.55, -0.3, 0, Math.PI);
      g.stroke();
    }
  });
}

function rock(r, size) {
  return paint(size, size, (g, s) => {
    const c = s / 2, n = 7;
    g.fillStyle = `rgb(${120 + r() * 50},${105 + r() * 40},${95 + r() * 30})`;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rad = c * (0.65 + r() * 0.35);
      g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rad, c + Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.arc(c + s * 0.12, c + s * 0.1, s * 0.12, 0, Math.PI * 2);
    g.fill();
  });
}

/** A small galaxy sprite: spiral, elliptical or edge-on. */
function galaxyImg(r, size, kind, hue) {
  return paint(size, size, (g, s) => {
    const c = s / 2;
    const core = g.createRadialGradient(c, c, 0, c, c, s * (kind === 'elliptical' ? 0.48 : 0.22));
    core.addColorStop(0, 'rgba(255,245,225,1)');
    core.addColorStop(0.4, `hsla(${hue},70%,75%,.7)`);
    core.addColorStop(1, `hsla(${hue},70%,60%,0)`);
    if (kind === 'elliptical') {
      g.save();
      g.translate(c, c);
      g.scale(1, 0.65);
      g.translate(-c, -c);
      g.fillStyle = core;
      g.fillRect(0, 0, s, s);
      g.restore();
      return;
    }
    g.save();
    g.translate(c, c);
    g.rotate(r() * Math.PI);
    if (kind === 'edge') g.scale(1, 0.22); else g.scale(1, 0.55 + r() * 0.4);
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 120; i++) {
        const t = i / 120;
        const a = arm * Math.PI + t * 4.2;
        const rad = t * c * 0.95;
        const x = Math.cos(a) * rad + (r() - 0.5) * c * 0.14;
        const y = Math.sin(a) * rad + (r() - 0.5) * c * 0.14;
        g.fillStyle = `hsla(${hue + r() * 40 - 20},80%,${70 + r() * 25}%,${0.5 * (1 - t) + 0.15})`;
        g.fillRect(x, y, 1.2, 1.2);
      }
    }
    g.restore();
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
  });
}

// ---------- 1. Solar System ----------

function solar(w, h, r) {
  const list = [];
  const L = Math.min(w, h), tall = h > w;
  sky(list, w, h, (g, pw, ph) => {
    const bg = g.createLinearGradient(0, 0, pw, ph);
    bg.addColorStop(0, '#05040f');
    bg.addColorStop(1, '#020814');
    g.fillStyle = bg;
    g.fillRect(0, 0, pw, ph);
    cloud(g, pw * 0.8, ph * 0.15, L * 0.6, '70,40,140', 0.25);
    cloud(g, pw * 0.15, ph * 0.85, L * 0.55, '20,90,140', 0.22);
    for (let i = 0; i < (pw * ph) / 900; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
      g.fillRect(r() * pw, r() * ph, 1, 1);
    }
  });
  addStars(list, r, Math.round((w * h) / 2200), [0, 0, w, h]);

  // The sun sits on the far side from the hole (bottom on tall screens, right on wide ones).
  const sun = tall ? [w * 0.5, h * 0.98] : [w * 1.0, h * 0.5];
  const sunR = L * 0.24;
  const sunImg = paint(sunR * 2.6, sunR * 2.6, (g, s) => {
    const c = s / 2;
    const gl = g.createRadialGradient(c, c, sunR * 0.6, c, c, c);
    gl.addColorStop(0, 'rgba(255,190,90,.6)');
    gl.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gl;
    g.fillRect(0, 0, s, s);
    const body = g.createRadialGradient(c - sunR * 0.2, c - sunR * 0.2, sunR * 0.1, c, c, sunR);
    body.addColorStop(0, '#fffbe0');
    body.addColorStop(0.5, '#ffd25a');
    body.addColorStop(1, '#ff8a1e');
    g.fillStyle = body;
    g.beginPath();
    g.arc(c, c, sunR, 0, Math.PI * 2);
    g.fill();
  });
  list.push({ hx: sun[0], hy: sun[1], w: sunR * 2.6, h: sunR * 2.6, img: sunImg, label: 'Sun' });

  // Planets on arcs around the sun.
  const planets = [
    [0.36, 0.022, '#d9c8b4', '#7a6a5a'], [0.48, 0.032, '#ffe0a8', '#c9893d'], [0.6, 0.034, '#8ed0ff', '#1e5fb0'],
    [0.72, 0.026, '#ffb08a', '#a8432a'], [0.92, 0.07, '#ffe2b8', '#b7793f', { bands: true }],
    [1.12, 0.058, '#fff0c8', '#c9a060', { ring: 'rgba(230,210,170,.75)' }], [1.3, 0.042, '#c8fbff', '#3aa7c0'], [1.46, 0.04, '#a8c4ff', '#2b4fb8'],
  ];
  const NAMES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  planets.forEach(([orbit, rad, c1, c2, opts], i) => {
    const a = (tall ? -Math.PI / 2 : Math.PI) + (r() - 0.5) * 1.6;
    const d = orbit * L;
    const x = sun[0] + Math.cos(a) * d, y = sun[1] + Math.sin(a) * d;
    if (x < -40 || x > w + 40 || y < -40 || y > h + 40) return;
    const pr = rad * L;
    const img = planet(pr, c1, c2, opts);
    list.push({ hx: x, hy: y, w: img.width / 2, h: img.height / 2, img, label: NAMES[i] });
    // a moon or two
    const moons = i === 2 ? 1 : i >= 4 ? 2 : 0;
    for (let m = 0; m < moons; m++) {
      const mr = pr * 0.25, ma = r() * Math.PI * 2, md = pr * (1.9 + m * 0.7);
      const mi = planet(mr, '#eeeeee', '#777777');
      const moonName = i === 2 ? 'Moon' : i === 4 ? ['Io', 'Europa'][m] : ['Titan', 'Enceladus'][m];
      list.push({ hx: x + Math.cos(ma) * md, hy: y + Math.sin(ma) * md, w: mi.width / 2, h: mi.height / 2, img: mi, label: moonName });
    }
  });
  // Asteroid belt between the 4th and 5th planets.
  for (let i = 0; i < 70; i++) {
    const a = (tall ? -Math.PI / 2 : Math.PI) + (r() - 0.5) * 2.6;
    const d = (0.8 + r() * 0.06) * L;
    const s = 3 + r() * 5;
    const x = sun[0] + Math.cos(a) * d, y = sun[1] + Math.sin(a) * d;
    if (x < 0 || x > w || y < 0 || y > h) continue;
    list.push({ hx: x, hy: y, w: s, h: s, img: rock(r, s) });
  }
  // A comet
  const comet = paint(L * 0.22, L * 0.05, (g, pw, ph) => {
    const tail = g.createLinearGradient(0, 0, pw, 0);
    tail.addColorStop(0, 'rgba(180,230,255,0)');
    tail.addColorStop(1, 'rgba(220,245,255,.8)');
    g.fillStyle = tail;
    g.beginPath();
    g.moveTo(0, ph / 2); g.lineTo(pw - ph / 2, ph * 0.15); g.lineTo(pw - ph / 2, ph * 0.85);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(pw - ph / 2, ph / 2, ph * 0.3, 0, Math.PI * 2);
    g.fill();
  });
  list.push({ hx: w * 0.75, hy: h * 0.32, w: L * 0.22, h: L * 0.05, img: comet, label: "Halley's Comet" });
  return list;
}

// ---------- 2. Spiral Galaxy ----------

function galaxy(w, h, r) {
  const list = [];
  const L = Math.min(w, h), tall = h > w;
  const cx = tall ? w * 0.5 : w * 0.62, cy = tall ? h * 0.62 : h * 0.5;
  const R = Math.max(w, h) * 0.55;
  sky(list, w, h, (g, pw, ph) => {
    g.fillStyle = '#03030a';
    g.fillRect(0, 0, pw, ph);
    // the galaxy's diffuse light, baked into the sky
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.4);
    g.scale(1, 0.62);
    cloud(g, 0, 0, R * 0.9, '120,90,200', 0.22);
    cloud(g, 0, 0, R * 0.35, '255,210,150', 0.35);
    g.restore();
    for (let i = 0; i < (pw * ph) / 700; i++) {
      g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.3})`;
      g.fillRect(r() * pw, r() * ph, 1, 1);
    }
  });
  // Spiral arms made of stars and pink star-forming knots.
  const arms = 2, perArm = Math.round((w * h) / 1300);
  const tilt = -0.4, squash = 0.62;
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 0; i < perArm; i++) {
      const t = Math.pow(r(), 0.8);
      const a = arm * Math.PI + t * 5.2 + (r() - 0.5) * 0.5;
      const rad = (0.06 + t * 0.94) * R;
      let x = Math.cos(a) * rad + (r() - 0.5) * R * 0.08;
      let y = Math.sin(a) * rad * squash + (r() - 0.5) * R * 0.05;
      const xr = x * Math.cos(tilt) - y * Math.sin(tilt), yr = x * Math.sin(tilt) + y * Math.cos(tilt);
      x = cx + xr; y = cy + yr;
      if (x < 0 || x > w || y < 0 || y > h) continue;
      const knot = r() < 0.06;
      const size = knot ? 8 + r() * 6 : t < 0.2 ? 5 + r() * 5 : 3 + r() * 4;
      const tint = knot ? 'rgb(255,140,190)' : t < 0.25 ? 'rgb(255,226,180)' : r() < 0.6 ? 'rgb(170,200,255)' : 'rgb(255,255,255)';
      list.push({ hx: x, hy: y, w: size, h: size, img: starImg(size, tint, r() < 0.05), twinkle: r() * 6.28 });
    }
  }
  // The bright core
  const coreS = L * 0.34;
  list.push({ hx: cx, hy: cy, w: coreS, h: coreS, label: 'Galactic core', img: paint(coreS, coreS, (g, s) => {
    const c = s / 2;
    const core = g.createRadialGradient(c, c, 0, c, c, c);
    core.addColorStop(0, 'rgba(255,250,235,1)');
    core.addColorStop(0.25, 'rgba(255,215,160,.8)');
    core.addColorStop(1, 'rgba(255,180,120,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
  }) });
  addStars(list, r, Math.round((w * h) / 5000), [0, 0, w, h], { bigShare: 0.15 });
  return list;
}

// ---------- 3. Nebula Nursery ----------

const NEBULAE = ['Orion Nebula', 'Eagle Nebula', 'Lagoon Nebula', 'Carina Nebula', 'Crab Nebula', 'Rosette Nebula', 'Trifid Nebula', 'Horsehead', 'Helix Nebula', 'Ring Nebula', "Cat's Eye", 'Tarantula'];

function nebula(w, h, r) {
  const list = [];
  const L = Math.min(w, h);
  sky(list, w, h, (g, pw, ph) => {
    g.fillStyle = '#040410';
    g.fillRect(0, 0, pw, ph);
    for (let i = 0; i < (pw * ph) / 800; i++) {
      g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.3})`;
      g.fillRect(r() * pw, r() * ph, 1, 1);
    }
  });
  // Gas clouds, each its own piece, in layers of colour.
  const palettes = ['255,90,150', '120,80,255', '60,200,255', '255,150,70', '80,255,190', '255,220,120'];
  const clouds = Math.round((w * h) / 9000);
  for (let i = 0; i < clouds; i++) {
    const s = L * (0.12 + r() * 0.28);
    const col = palettes[Math.floor(r() * palettes.length)];
    // Several soft puffs, all kept well inside the piece so it has no hard edges.
    const img = paint(s, s, (g, pw) => {
      for (let k = 0; k < 7; k++) {
        const rad = pw * (0.12 + r() * 0.2);
        const cx = rad + r() * (pw - 2 * rad), cy = rad + r() * (pw - 2 * rad);
        cloud(g, cx, cy, rad, col, 0.12 + r() * 0.1);
      }
    });
    list.push({ hx: r() * w, hy: r() * h, w: s, h: s, img, label: i < NEBULAE.length && s > L * 0.25 ? NEBULAE[i] : undefined });
  }
  // Dark dust lanes
  for (let i = 0; i < 6; i++) {
    const s = L * (0.15 + r() * 0.15);
    list.push({ hx: r() * w, hy: r() * h, w: s, h: s * 0.5, img: paint(s, s * 0.5, (g, pw, ph) => {
      const d = g.createRadialGradient(pw / 2, ph / 2, 0, pw / 2, ph / 2, pw / 2);
      d.addColorStop(0, 'rgba(5,3,10,.7)');
      d.addColorStop(1, 'rgba(5,3,10,0)');
      g.fillStyle = d;
      g.fillRect(0, 0, pw, ph);
    }) });
  }
  // Young blue stars and tight clusters
  addStars(list, r, Math.round((w * h) / 2400), [0, 0, w, h], { tints: ['rgb(170,200,255)', 'rgb(200,225,255)', 'rgb(255,255,255)', 'rgb(255,200,230)'], bigShare: 0.12 });
  for (let c = 0; c < 5; c++) {
    const ccx = r() * w, ccy = r() * h;
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 2) * L * 0.07;
      const s = 3 + r() * 6;
      list.push({ hx: ccx + Math.cos(a) * d, hy: ccy + Math.sin(a) * d, w: s, h: s, img: starImg(s, 'rgb(190,215,255)', s > 8), twinkle: r() * 6.28 });
    }
  }
  return list;
}

// ---------- 4. Deep Field ----------

function deep(w, h, r) {
  const list = [];
  const L = Math.min(w, h);
  sky(list, w, h, (g, pw, ph) => {
    g.fillStyle = '#020207';
    g.fillRect(0, 0, pw, ph);
    for (let i = 0; i < (pw * ph) / 500; i++) {
      g.fillStyle = `hsla(${r() * 360},60%,80%,${0.08 + r() * 0.25})`;
      g.fillRect(r() * pw, r() * ph, 1.2, 1.2);
    }
  });
  const GALAXIES = ['Andromeda', 'Whirlpool', 'Sombrero', 'Pinwheel', 'Triangulum', 'Black Eye', 'Cartwheel', 'Sunflower', 'Cigar Galaxy', "Bode's Galaxy"];
  let named = 0;
  const kinds = ['spiral', 'spiral', 'elliptical', 'edge'];
  const count = Math.round((w * h) / 4500);
  for (let i = 0; i < count; i++) {
    const near = r() < 0.12;
    const s = near ? L * (0.12 + r() * 0.1) : L * (0.025 + r() * 0.05);
    const hue = r() < 0.5 ? 30 + r() * 30 : 200 + r() * 60;
    list.push({ hx: r() * w, hy: r() * h, w: s, h: s, img: galaxyImg(r, s, kinds[Math.floor(r() * kinds.length)], hue), label: near ? GALAXIES[named++ % GALAXIES.length] : undefined });
  }
  addStars(list, r, Math.round((w * h) / 9000), [0, 0, w, h], { bigShare: 0.3 });
  return list;
}
