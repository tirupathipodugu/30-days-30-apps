// FIRE vs WATER arena (internal team keys stay 'human' = Fire at +z, 'ai' = Water at -z).
// Stylised-realistic, all procedural: basalt + flowing lava on the Fire half, rippling ice-water on the
// Water half, clashing steam down the middle, an obsidian fortress and a coral/ice citadel.
// Elemental motion is done with scrolling emissive/normal shaders and pooled point particles — not a real
// fluid sim — so it reads believable from the fixed camera without a GPU-heavy simulation.
import * as THREE from 'three';
import { toon, glowMat, additive, GEO, Baker, M4, TIME, GLOW } from './gfx.js';
import { ARENA } from './config.js';
import { mulberry32 } from './sim.js';

const W = ARENA.halfW, Lh = ARENA.halfL, BZ = ARENA.baseZ;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z) {
  return (Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) + Math.sin(z * 0.17 + Math.cos(x * 0.11) * 2) + Math.sin((x + z) * 0.37) * 0.5) / 2.5;
}

// palettes
const FIRE = { rock: 0x2A1E1E, rockD: 0x1A1214, rockL: 0x3E2C28, obsid: 0x241A22, lava: 0xFF5A14, lavaHot: 0xFFC040, ember: 0xFF7A2A, scorch: 0x120C0C };
const WATER = { ice: 0xBFE6FF, iceD: 0x7FB8DA, deep: 0x0C3C5C, surf: 0x1E8FC0, foam: 0xEAFBFF, coral: 0x2CC0D6, crystal: 0x8FE8F2 };

// ---------------- arena floor canvas (basalt | ice) + a lava crack mask ----------------
function floorTexture(maxAniso) {
  const FW = 36, FL = 72, k = 30;
  const c = document.createElement('canvas'); c.width = FW * k; c.height = FL * k;
  const g = c.getContext('2d');
  const X = (x) => (x + FW / 2) * k, Z = (z) => (z + FL / 2) * k;
  const R = mulberry32(7);
  // lava crack mask: R = crack intensity, G = distance along the crack (for flow), B = hot node
  const MK = 16, mc = document.createElement('canvas'); mc.width = FW * MK; mc.height = (FL / 2 + 2) * MK;
  const mg = mc.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, mc.width, mc.height); mg.lineCap = 'round';
  const MX = (x) => (x + FW / 2) * MK, MZ = (z) => (z + 1) * MK; // mask covers z in [-1, 37]

  // ---- FIRE half (z > 0): dark cracked basalt ----
  g.fillStyle = '#1C1416'; g.fillRect(0, Z(-1), c.width, c.height - Z(-1));
  for (let i = 0; i < 1400; i++) { // basalt mottling + cooled lava patches
    const x = R() * c.width, y = Z(-1) + R() * (c.height - Z(-1));
    const v = R();
    g.fillStyle = v < 0.5 ? 'rgba(10,8,9,0.5)' : v < 0.8 ? 'rgba(52,38,34,0.4)' : 'rgba(80,40,26,0.25)';
    g.beginPath(); g.ellipse(x, y, 6 + R() * 30, 5 + R() * 20, R() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 40; i++) { // scorch rings where lava has pooled
    const x = X((R() - 0.5) * 30), y = Z(2 + R() * 32), r = 20 + R() * 60;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(90,30,10,0.35)'); rg.addColorStop(0.7, 'rgba(40,16,10,0.2)'); rg.addColorStop(1, 'rgba(40,16,10,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // a lava channel network, painted dim on the floor and bright+flowing in the mask
  function crack(x, z, len, width, segs) {
    let px = x, pz = z, ang = R() * 7, dist = R() * 4;
    g.lineWidth = width * k; g.strokeStyle = 'rgba(70,24,8,0.6)';
    g.beginPath(); g.moveTo(X(px), Z(pz));
    mg.lineWidth = width * MK * 0.7;
    for (let s = 0; s < segs; s++) {
      ang += (R() - 0.5) * 1.1;
      const nx = px + Math.cos(ang) * len, nz = pz + Math.sin(ang) * len;
      g.lineTo(X(nx), Z(nz));
      const l = Math.hypot(nx - px, nz - pz);
      const lg = mg.createLinearGradient(MX(px), MZ(pz), MX(nx) + 0.01, MZ(nz) + 0.01);
      const steps = 6;
      for (let q = 0; q <= steps; q++) { const d = ((dist + l * q / steps) / 5) % 1; lg.addColorStop(q / steps, `rgb(255,${Math.round(d * 255)},0)`); }
      mg.strokeStyle = lg; mg.beginPath(); mg.moveTo(MX(px), MZ(pz)); mg.lineTo(MX(nx), MZ(nz)); mg.stroke();
      dist += l; px = nx; pz = nz;
    }
    g.stroke();
    mg.fillStyle = 'rgb(255,128,255)'; mg.beginPath(); mg.arc(MX(px), MZ(pz), width * MK * 1.1, 0, 7); mg.fill();
  }
  for (let i = 0; i < 16; i++) crack(-W + 1 + R() * (2 * W - 2), 1 + R() * (Lh - 3), 2.2 + R() * 1.6, 0.18 + R() * 0.22, 4 + (R() * 3 | 0));
  // a glowing channel straight down from the fortress gate
  crack(0, BZ - 5, 2.6, 0.5, 11);

  // ---- WATER half (z < 0): pale rippled ice ----
  g.fillStyle = '#A9D8EC'; g.fillRect(0, 0, c.width, Z(1));
  { const lg = g.createLinearGradient(0, Z(-6), 0, Z(2)); // shoreline where ice meets basalt
    lg.addColorStop(0, '#A9D8EC'); lg.addColorStop(0.5, '#8FB7C4'); lg.addColorStop(1, '#4A3B36');
    g.fillStyle = lg; g.fillRect(0, Z(-6), c.width, Z(2) - Z(-6)); }
  for (let i = 0; i < 1600; i++) { // ice sheen + deeper patches
    const x = R() * c.width, y = Z(-Lh) + R() * (Z(1) - Z(-Lh));
    const v = R();
    g.fillStyle = v < 0.5 ? 'rgba(120,190,215,0.22)' : v < 0.82 ? 'rgba(235,250,255,0.22)' : 'rgba(40,120,160,0.2)';
    g.beginPath(); g.ellipse(x, y, 8 + R() * 34, 5 + R() * 18, R() * 3, 0, 7); g.fill();
  }
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(235,250,255,0.5)'; // ice cracks
  for (let i = 0; i < 90; i++) {
    let x = (R() - 0.5) * FW, z = -Lh + R() * (Lh + 1), ang = R() * 7;
    g.beginPath(); g.moveTo(X(x), Z(z));
    for (let s = 0; s < 3; s++) { ang += (R() - 0.5) * 1.3; x += Math.cos(ang) * (1.5 + R() * 2.5); z += Math.sin(ang) * (1.5 + R() * 2.5); g.lineTo(X(x), Z(z)); }
    g.stroke();
  }
  g.strokeStyle = 'rgba(180,230,245,0.3)'; g.lineWidth = 6; // broad caustic hints
  for (let i = 0; i < 40; i++) { const x = R() * c.width, y = Z(-Lh) + R() * (Z(0) - Z(-Lh)); g.beginPath(); g.ellipse(x, y, 30 + R() * 50, 18 + R() * 30, R() * 3, 0, Math.PI * 1.4); g.stroke(); }

  // centre clash line + base zones
  g.strokeStyle = 'rgba(255,230,200,0.5)'; g.lineWidth = 7;
  g.beginPath(); g.arc(X(0), Z(0), 5 * k, 0, 7); g.stroke();
  for (const [z, col] of [[BZ, '255,120,40'], [-BZ, '120,220,255']]) {
    const rg = g.createRadialGradient(X(0), Z(z), 4 * k, X(0), Z(z), 10 * k);
    rg.addColorStop(0, `rgba(${col},0.0)`); rg.addColorStop(0.8, `rgba(${col},0.28)`); rg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = rg; g.fillRect(X(-12), Z(z - 11), 24 * k, 22 * k);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
  const mask = new THREE.CanvasTexture(mc); mask.anisotropy = maxAniso;
  return { tex, mask };
}

// flowing lava glow over the Fire half, driven by the crack mask
function lavaOverlay(mask) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uMask: { value: mask } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform sampler2D uMask; varying vec2 vUv;
      void main(){
        vec4 t = texture2D(uMask, vUv);
        float crack = t.r;
        float flow = fract(t.g - uTime * 0.18);
        float pulse = smoothstep(0.55, 1.0, flow) * (0.6 + 0.4 * sin(uTime * 2.0 + t.g * 30.0));
        float node = t.b * (0.7 + 0.3 * sin(uTime * 4.0 + vUv.x * 60.0));
        float heat = crack * (0.5 + pulse * 1.6) + node * 2.2;
        vec3 col = mix(vec3(1.6, 0.25, 0.03), vec3(1.9, 1.1, 0.25), smoothstep(0.6, 1.8, heat));
        gl_FragColor = vec4(col * heat, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(36, 38).rotateX(-Math.PI / 2), m);
  p.position.set(0, 0.03, 18); p.renderOrder = 1; // z in [-1, 37]
  return p;
}

// a thin animated water sheen + caustics + foam over the ice half (keeps characters readable)
function waterOverlay() {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 q = vW.xz * 0.5;
        // moving caustic web
        float a = n(q + vec2(0.0, uTime * 0.25));
        float b = n(q * 1.9 - vec2(uTime * 0.18, 0.0));
        float caustic = pow(smoothstep(0.55, 0.95, a) + smoothstep(0.6, 0.98, b), 1.5);
        // foam at the centre clash line and near the base
        float foam = smoothstep(2.2, 0.0, abs(vW.z)) * (0.5 + 0.5 * n(q * 3.0 + uTime * 0.6));
        foam += smoothstep(8.0, 4.0, abs(vW.z + ${BZ.toFixed(1)})) * 0.3 * n(q * 2.0 - uTime * 0.4);
        float alpha = caustic * 0.18 + foam * 0.5;
        vec3 col = mix(vec3(0.6, 0.9, 1.0), vec3(1.0), foam);
        gl_FragColor = vec4(col * (caustic * 0.8 + foam * 1.4), clamp(alpha, 0.0, 0.7));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(36, 38).rotateX(-Math.PI / 2), m);
  p.position.set(0, 0.04, -18); p.renderOrder = 1; // z in [-37, 1]
  return p;
}

// ---------------- big outer surfaces: ocean (water side) + lava lake (fire side) ----------------
function oceanSurface() {
  const geo = new THREE.PlaneGeometry(260, 150, 80, 48).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: TIME },
    vertexShader: `uniform float uTime; varying vec3 vW; varying float vH;
      void main(){
        vec3 p = position;
        // a couple of Gerstner-ish waves
        float w1 = sin(p.x * 0.18 + uTime * 1.1) * 0.5;
        float w2 = sin((p.z * 0.14 - p.x * 0.06) + uTime * 0.8) * 0.4;
        float w3 = sin((p.x * 0.4 + p.z * 0.3) + uTime * 1.9) * 0.12;
        p.y += w1 + w2 + w3; vH = w1 + w2 + w3;
        vec4 wld = modelMatrix * vec4(p, 1.0); vW = wld.xyz;
        gl_Position = projectionMatrix * viewMatrix * wld;
      }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; varying float vH;
      void main(){
        vec3 deep = vec3(0.03, 0.18, 0.30), shallow = vec3(0.12, 0.52, 0.66);
        vec3 col = mix(deep, shallow, smoothstep(-0.6, 0.6, vH));
        float crest = smoothstep(0.55, 0.95, vH);
        col = mix(col, vec3(0.9, 0.98, 1.0), crest * 0.7);               // white caps
        // faint broad glints only on the crests (no regular dot lattice)
        col += vec3(0.6, 0.85, 1.0) * crest * 0.2;
        gl_FragColor = vec4(col, 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(0, -0.35, -Lh - 48); m.renderOrder = 0;
  return m;
}
function lavaLake() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec2 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 q = vW * 0.12;
        float f = n(q + vec2(0.0, uTime * 0.05)) * 0.6 + n(q * 2.3 - uTime * 0.03) * 0.4;
        // dark cooled crust broken by bright molten veins
        float vein = smoothstep(0.52, 0.42, abs(f - 0.5));
        vec3 crust = vec3(0.09, 0.05, 0.05);
        vec3 molten = mix(vec3(1.8, 0.4, 0.05), vec3(2.0, 1.2, 0.3), smoothstep(0.0, 0.3, f));
        vec3 col = mix(crust, molten, vein);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 150).rotateX(-Math.PI / 2), mat);
  m.position.set(0, -0.3, Lh + 48); m.renderOrder = 0;
  return m;
}

// ---------------- terrain (rolling basalt on fire side, low seabed on water side) ----------------
function buildTerrain(scene, G) {
  const geo = new THREE.PlaneGeometry(260, 260, 96, 96).rotateX(-Math.PI / 2);
  const p = geo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const ax = Math.abs(x), inRect = ax < W + 2.3 && Math.abs(z) < Lh + 2.3;
    const fire = smooth(-6, 4, z);
    let h = 0;
    if (!inRect) {
      const edge = smooth(W + 2, W + 16, Math.max(ax, Math.abs(z) - Lh + W));
      h = (vnoise(x * 0.8, z * 0.8) * 0.9 + 0.5) * edge * 3.2 * fire; // fire hills
      h -= (1 - fire) * 1.6;                                          // water side sinks (seabed, under the ocean)
    }
    p.setY(i, h - 0.05);
    const n = vnoise(x * 1.7, z * 1.7);
    c.setRGB(0.14 + n * 0.04, 0.09 + n * 0.02, 0.09 + n * 0.02, THREE.SRGBColorSpace);       // basalt
    if (h > 1.2) c.lerp(c2.setRGB(0.26, 0.18, 0.16, THREE.SRGBColorSpace), Math.min(1, (h - 1.2) * 0.4));
    c2.setRGB(0.05, 0.12, 0.16, THREE.SRGBColorSpace);                                        // seabed
    c.lerp(c2, 1 - fire);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, toon(0xffffff, 0, { vertexColors: true })); m.receiveShadow = true;
  scene.add(m);
  // a few glowing lava veins running through the far basalt
  const R = mulberry32(13);
  for (let i = 0; i < 22; i++) {
    const side = R() < 0.5 ? -1 : 1; let x = side * (W + 6 + R() * 40), z = 6 + R() * 58, ang = R() * 7;
    for (let s = 0; s < 4; s++) {
      const nx = x + Math.cos(ang) * (2 + R() * 3), nz = z + Math.sin(ang) * (2 + R() * 3);
      const yy = (terrainHeightApprox(x) + terrainHeightApprox(nx)) / 2;
      G.add(GEO.box, FIRE.lava, M4((x + nx) / 2, yy + 0.08, (z + nz) / 2, [0.25, 0.05, Math.hypot(nx - x, nz - z)], [0, Math.atan2(nx - x, nz - z), 0]), { boost: GLOW * 0.8 });
      x = nx; z = nz; ang += (R() - 0.5);
    }
  }
}
function terrainHeightApprox(x) { const ax = Math.abs(x); return ax < W + 2 ? 0 : (vnoise(x * 0.8, 30) * 0.9 + 0.5) * smooth(W + 2, W + 16, ax) * 3.2; }

// ---------------- rising/falling particles: embers (fire) and mist/spray (water) + clash steam ----------------
function motes(scene, count, box, color, size, rise, fade) {
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(count * 3), S = new Float32Array(count);
  const R = mulberry32(Math.round(color));
  for (let i = 0; i < count; i++) { P[i * 3] = R(); P[i * 3 + 1] = R(); P[i * 3 + 2] = R(); S[i] = 0.5 + R(); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: fade === 'soft' ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uMin: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uSize: { value: new THREE.Vector3(box[3], box[4], box[5]) },
      uColor: { value: new THREE.Color(color) }, uPx: { value: size } },
    vertexShader: `uniform float uTime, uPx; uniform vec3 uMin, uSize; attribute float aS; varying float vA;
      void main(){
        vec3 p = position;
        p.x = fract(p.x + sin(uTime * 0.5 + p.z * 30.0) * 0.01);
        p.y = fract(p.y + uTime * ${rise.toFixed(3)} * aS);
        p.z = fract(p.z + cos(uTime * 0.4 + p.x * 20.0) * 0.008);
        vec3 w = uMin + p * uSize;
        vA = smoothstep(0.0, 0.12, p.y) * (1.0 - smoothstep(0.7, 1.0, p.y)) * (0.6 + 0.4 * sin(uTime * 3.0 + aS * 20.0));
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_PointSize = uPx * aS * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * a * vA, a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 6;
  scene.add(pts); return mat;
}

// ---------------- cover pieces (obsidian boulders | ice shards) ----------------
function buildCover(B, G, S, cover) {
  const R = mulberry32(5);
  for (const c of cover) {
    const fire = c.z > 0;
    if (fire) {
      B.add(GEO.blob, FIRE.obsid, M4(c.x, c.r * 0.6, c.z, [c.r * 2.0, c.r * 1.8, c.r * 1.8], [R() * 0.3, R() * 6, 0]), { flat: true, jitter: 0.3 });
      B.add(GEO.blob, FIRE.rock, M4(c.x - c.r * 0.5, c.r * 1.1, c.z + c.r * 0.3, [c.r * 1.1, c.r * 1.0, c.r * 1.0], [R(), R() * 6, 0]), { flat: true, jitter: 0.3 });
      for (let k = 0; k < 3; k++) G.add(GEO.box, FIRE.lava, M4(c.x + (R() - 0.5) * c.r, c.r * (0.4 + R() * 0.8), c.z + (R() - 0.5) * c.r, [0.12, 0.5 + R() * 0.5, 0.12], [R(), R() * 6, R()]), { boost: GLOW * 0.7 });
    } else {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + R();
        const m = M4(c.x + Math.cos(a) * c.r * 0.42, c.r * 0.9, c.z + Math.sin(a) * c.r * 0.42, [c.r * 0.8, c.r * (1.8 + R()), c.r * 0.8], [Math.cos(a) * 0.3, R() * 3, Math.sin(a) * 0.3]);
        G.add(GEO.octa, i === 0 ? WATER.crystal : WATER.coral, m, { boost: 0.9, flat: true });
      }
      S.add(GEO.cyl, WATER.iceD, M4(c.x, 0.14, c.z, [c.r * 2.0, 0.28, c.r * 2.0]));
    }
  }
}

// ---------------- the obsidian fortress (Fire base, +z) ----------------
function buildFortress(B, G, S) {
  const z0 = BZ + 0.6;
  const rock = FIRE.rock, rockD = FIRE.rockD, obsid = FIRE.obsid, molten = FIRE.lava;
  const st = { jitter: 0.2, cell: 0.5 };
  B.add(GEO.cyl, rockD, M4(0, 0.3, z0, [12, 0.6, 10.5]), st);
  // a ring of lava around the base
  G.add(GEO.ring, molten, M4(0, 0.32, z0, [11.6, 4, 10.1]), { boost: GLOW });
  // keep (jagged molten rock)
  B.add(GEO.rbox, rock, M4(0, 3.6, z0 + 1.2, [5.4, 6.0, 4.4]), st);
  for (let i = -2; i <= 2; i++) for (const dz of [-1.0, 3.4]) B.add(GEO.wedge, rock, M4(i * 1.15, 6.9, z0 + dz, [0.7, 1.0, 0.7]), st);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) B.add(GEO.wedge, rock, M4(sx * 2.45, 6.9, z0 + 0.1 + i * 1.15, [0.6, 0.9, 0.6]), st);
  B.add(GEO.wedge, obsid, M4(0, 8.4, z0 + 1.2, [5.0, 3.0, 4.0]), { jitter: 0.12, cell: 0.4 });
  // glowing seams up the keep
  for (const sx of [-1, 1]) G.add(GEO.box, molten, M4(sx * 2.6, 3.6, z0 - 1.0, [0.12, 5.0, 0.1]), { boost: GLOW * 0.8 });
  G.add(GEO.box, FIRE.lavaHot, M4(0, 3.0, z0 - 1.02, [1.2, 2.0, 0.1]), { boost: GLOW });
  // towers = basalt spires with molten tips
  const towers = [[-4.1, z0 - 1.6, 7.2], [4.1, z0 - 1.6, 7.2], [-3.6, z0 + 3.4, 6.2], [3.6, z0 + 3.4, 6.2]];
  const gouts = [];
  for (const [x, z, h] of towers) {
    B.add(GEO.taper, rock, M4(x, h / 2, z, [2.8, h, 2.8]), st);
    B.add(GEO.cone, obsid, M4(x, h + 1.2, z, [2.6, 2.6, 2.6]), { jitter: 0.14, cell: 0.4 });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; G.add(GEO.box, molten, M4(x + Math.cos(a) * 1.2, h - 0.2 + (k % 2) * 0.4, z + Math.sin(a) * 1.2, [0.1, 1.2, 0.1]), { boost: GLOW * 0.7 }); }
    gouts.push([x, h + 2.4, z]);       // fire erupts from each tower top
  }
  // curtain wall + gate with a lava-glow portcullis
  B.add(GEO.rbox, rock, M4(0, 1.9, z0 - 1.6, [6.4, 3.8, 1.2]), st);
  for (let i = -2; i <= 2; i++) B.add(GEO.wedge, rock, M4(i * 1.2, 4.1, z0 - 2.05, [0.7, 0.8, 0.5]), st);
  B.add(GEO.box, FIRE.scorch, M4(0, 1.35, z0 - 2.18, [2.1, 2.7, 0.1]));
  G.add(GEO.box, FIRE.lavaHot, M4(0, 1.2, z0 - 2.2, [1.9, 2.4, 0.06]), { boost: GLOW * 0.8 });
  for (let i = -2; i <= 2; i++) G.add(GEO.box, molten, M4(i * 0.42, 1.3, z0 - 2.24, [0.07, 2.5, 0.04]), { boost: GLOW });
  gouts.push([0, 5.4, z0 - 1.6]);
  // turret (a magma catapult arm)
  const turret = new THREE.Group(); turret.position.set(0, 4.45, z0 - 1.6);
  const tb = new Baker(), tg = new Baker();
  tb.add(GEO.rbox, obsid, M4(0, 0.25, 0, [0.6, 0.5, 1.6]), { jitter: 0.1 });
  tb.add(GEO.box, rock, M4(0, 0.45, 0.6, [2.2, 0.18, 0.18]));
  tg.add(GEO.sphereLo, FIRE.lavaHot, M4(0, 0.6, 0.95, 0.3), { boost: GLOW });
  const tm = new THREE.Mesh(tb.geometry(), toon(0xffffff, 0.2, { vertexColors: true })); tm.castShadow = true;
  turret.add(tm, new THREE.Mesh(tg.geometry(), glowMat(0xffffff, { vertexColors: true })));
  // damage cracks (glowing lava fractures)
  const cracks = crackMeshes(z0, true);
  void S;
  return { turret, gouts, cracks };
}

// ---------------- the coral/ice citadel (Water base, -z) ----------------
function buildCitadel(B, G, S) {
  const z0 = -BZ - 0.4;
  S.add(GEO.cyl, WATER.iceD, M4(0, 0.3, z0, [12, 0.6, 10.5]));
  G.add(GEO.ring, WATER.crystal, M4(0, 0.32, z0, [11.6, 4, 10.1]), { boost: GLOW * 0.9 });
  // tiered ice blocks
  const blocks = [[0, 1.9, 0, 6.0, 2.8, 5.0], [0, 4.6, -0.2, 4.6, 2.8, 4.0], [0, 7.2, -0.3, 3.2, 2.6, 2.8]];
  for (const [x, y, z, w, h, d] of blocks) {
    S.add(GEO.rbox, WATER.ice, M4(x, y, z0 + z, [w, h, d]));
    for (const sz of [-1, 1]) G.add(GEO.box, WATER.crystal, M4(x, y + h / 2 - 0.14, z0 + z + sz * (d / 2 + 0.01), [w * 0.86, 0.06, 0.03]), { boost: GLOW * 0.8 });
  }
  // coral fans on the flanks
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5 - 0.4) * 1.6;
      B.add(GEO.cone, WATER.coral, M4(sx * 3.6 + Math.cos(a) * 0.4, 1.4 + k * 0.3, z0 + 0.6 + Math.sin(a) * 1.2, [0.5, 1.8 + k * 0.2, 0.5], [0.4, 0, -sx * a]), { jitter: 0.2 });
    }
    S.add(GEO.rbox, WATER.iceD, M4(sx * 3.9, 2.4, z0 + 0.4, [1.6, 4.4, 2.6]));
  }
  // waterfalls down the front faces (scrolling translucent planes)
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9,78.2))) * 43758.5); }
      void main(){
        float streak = h(vec2(floor(vUv.x * 14.0), 0.0));
        float flow = fract(vUv.y * 2.0 + uTime * (1.2 + streak));
        float bright = 0.4 + 0.6 * smoothstep(0.0, 0.3, flow) * (1.0 - smoothstep(0.3, 1.0, flow));
        float foam = smoothstep(0.85, 1.0, vUv.y) + smoothstep(0.1, 0.0, vUv.y);
        vec3 col = mix(vec3(0.5, 0.8, 1.0), vec3(1.0), foam);
        gl_FragColor = vec4(col, (0.35 + bright * 0.4 + foam * 0.5) * 0.8);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const falls = [];
  for (const [x, y, z, w, hh] of [[-2.4, 3.2, z0 + 2.62, 1.8, 5.5], [2.4, 3.2, z0 + 2.62, 1.8, 5.5], [0, 5.6, z0 + 2.1, 2.2, 4.0]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), fallMat); f.position.set(x, y, z); f.renderOrder = 3;
    falls.push(f);
  }
  // central glowing core (a frozen orb) + rings
  S.add(GEO.cyl, WATER.iceD, M4(0, 10.0, z0 - 0.3, [0.55, 3.6, 0.55]));
  const rings = [];
  const ringA = new THREE.Mesh(GEO.torus, toon(WATER.crystal, 0.4)); ringA.position.set(0, 10.0, z0 - 0.3); ringA.scale.setScalar(2.6); ringA.castShadow = true;
  const ringB = new THREE.Mesh(GEO.torus, glowMat(WATER.crystal)); ringB.position.set(0, 11.0, z0 - 0.3); ringB.scale.setScalar(1.7);
  rings.push(ringA, ringB);
  const core = new THREE.Mesh(GEO.sphere, glowMat(0xCFF4FF)); core.position.set(0, 12.4, z0 - 0.3);
  const coreHalo = new THREE.Mesh(GEO.sphere, additive(WATER.crystal, 0.25, 1.5)); coreHalo.scale.setScalar(2.2); core.add(coreHalo);
  // turret (a water cannon)
  const turret = new THREE.Group(); turret.position.set(0, 6.05, z0 + 1.5);
  const tb = new Baker(), tg = new Baker();
  tb.add(GEO.hemi, WATER.iceD, M4(0, 0, 0, [1.4, 1.2, 1.4]));
  tb.add(GEO.barrel, WATER.crystal, M4(0, 0.3, 0.2, [0.22, 0.22, 1.2]));
  tg.add(GEO.sphereLo, 0xCFF4FF, M4(0, 0.3, 1.4, 0.25), { boost: GLOW });
  const tm = new THREE.Mesh(tb.geometry(), toon(0xffffff, 0.3, { vertexColors: true })); tm.castShadow = true;
  turret.add(tm, new THREE.Mesh(tg.geometry(), glowMat(0xffffff, { vertexColors: true })));
  const cracks = crackMeshes(z0, false);
  return { turret, falls, rings, core, cracks };
}

// damage fractures that light up as a base is destroyed (lava for fire, crystal for water)
function crackMeshes(z0, fire) {
  const cracks = [];
  for (let stage = 0; stage < 3; stage++) {
    const cb = new Baker(); const R = mulberry32((fire ? 40 : 60) + stage);
    for (let k = 0; k < 5; k++) {
      let x = (R() - 0.5) * 5, y = 1 + R() * (stage === 2 ? 6 : 3);
      const z = fire ? (stage === 1 ? z0 - 2.26 : z0 - 1.03) : (stage === 2 ? z0 + 1.71 : z0 + 2.62);
      if (stage === 2) x *= 0.6;
      for (let s = 0; s < 4; s++) {
        const a = -Math.PI / 2 + (R() - 0.5) * 1.6, l = 0.35 + R() * 0.5;
        cb.add(GEO.box, fire ? FIRE.lavaHot : WATER.crystal, M4(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2, z, [l, 0.06, 0.04], [0, 0, a]), { boost: GLOW * 0.8 });
        x += Math.cos(a) * l; y += Math.sin(a) * l;
      }
    }
    const cm = new THREE.Mesh(cb.geometry(), glowMat(0xffffff, { vertexColors: true }));
    cm.visible = false; cracks.push(cm);
  }
  return cracks;
}

// ---------------- background set pieces ----------------
function buildVolcano(B, G, x, z) {
  const y = terrainHeightApprox(x);
  B.add(GEO.cone, FIRE.rockD, M4(x, y + 6, z, [16, 13, 16]), { jitter: 0.18, cell: 1.0 });
  B.add(GEO.cone, FIRE.obsid, M4(x, y + 11.5, z, [7, 4, 7]), { jitter: 0.15, cell: 0.6 });
  const crater = new THREE.Group(); crater.position.set(x, y + 13, z);
  const gb = new Baker();
  gb.add(GEO.cyl, FIRE.lavaHot, M4(0, 0, 0, [3.2, 0.6, 3.2]), { boost: GLOW });
  crater.add(new THREE.Mesh(gb.geometry(), glowMat(0xffffff, { vertexColors: true })));
  // lava running down a flank
  G.add(GEO.box, FIRE.lava, M4(x + 2, y + 6, z + 3, [0.6, 0.2, 10], [0.5, 0.3, 0]), { boost: GLOW * 0.7 });
  return crater;
}
function buildIceberg(B, G, x, z) {
  const y = -1.0;
  B.add(GEO.octa, WATER.ice, M4(x, y + 5, z, [10, 11, 9], [0.2, 0.6, 0.1]), { flat: true, jitter: 0.25 });
  B.add(GEO.octa, WATER.iceD, M4(x + 6, y + 3, z + 3, [6, 7, 6], [0.1, 1.2, 0.2]), { flat: true, jitter: 0.25 });
  G.add(GEO.box, WATER.crystal, M4(x, y + 8, z, [0.3, 5, 0.3]), { boost: GLOW * 0.5 });
  return null;
}

// ---------------- clash steam where fire meets water (dense rising plume along z=0) ----------------
function buildSteam(scene, count) {
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(count * 3), S = new Float32Array(count);
  const R = mulberry32(55);
  for (let i = 0; i < count; i++) { P[i * 3] = R(); P[i * 3 + 1] = R(); P[i * 3 + 2] = R(); S[i] = 0.5 + R(); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: TIME },
    vertexShader: `uniform float uTime; attribute float aS; varying float vA;
      void main(){
        vec3 p = position;
        float climb = fract(p.y + uTime * 0.07 * aS);
        float x = (p.x - 0.5) * ${(2 * W).toFixed(1)} + sin(uTime * 0.6 + aS * 10.0) * 1.2;
        float z = (p.z - 0.5) * 3.0;
        float y = climb * 5.0 + 0.2;
        vA = smoothstep(0.0, 0.2, climb) * (1.0 - smoothstep(0.55, 1.0, climb));
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_PointSize = (28.0 + aS * 40.0) * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vec3(0.9, 0.94, 0.97), a * vA * 0.26); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 7;
  scene.add(pts); return mat;
}

// ---------------- arena walls ----------------
function buildWalls(B, G, S) {
  // Fire half: jagged basalt wall with glowing lava seams
  for (const sx of [-1, 1]) {
    for (let z = 0.8; z <= Lh + 0.3; z += 0.85) {
      const h = 1.2 + Math.sin(z * 7.1) * 0.18;
      B.add(GEO.wedge, FIRE.rock, M4(sx * (W + 0.45), h / 2, z, [0.5, h, 0.5], [0, sx * 0.3, 0]), { jitter: 0.25 });
      if ((z * 3 | 0) % 2 === 0) G.add(GEO.box, FIRE.lava, M4(sx * (W + 0.45) - sx * 0.22, h * 0.5, z, [0.04, h * 0.7, 0.3]), { boost: GLOW * 0.6 });
    }
  }
  for (let x = -W; x <= W; x += 0.85) {
    const h = 1.2 + Math.sin(x * 5.3) * 0.18;
    B.add(GEO.wedge, FIRE.rock, M4(x, h / 2, Lh + 0.45, [0.5, h, 0.5], [0, 0.3, 0]), { jitter: 0.25 });
  }
  // Water half: translucent ice barrier with crystal glow
  for (const sx of [-1, 1]) {
    S.add(GEO.rbox, WATER.ice, M4(sx * (W + 0.45), 0.6, -Lh / 2 - 0.2, [0.5, 1.2, Lh + 0.4]));
    G.add(GEO.box, WATER.crystal, M4(sx * (W + 0.45) - sx * 0.28, 0.85, -Lh / 2, [0.04, 0.12, Lh]), { boost: GLOW * 0.7 });
    for (let z = -0.8; z >= -Lh - 0.2; z -= 1.3) B.add(GEO.octa, WATER.crystal, M4(sx * (W + 0.45), 1.1 + (z * 2 % 1) * 0.3, z, [0.4, 0.8, 0.4], [0, sx * 0.4, 0.2]), { flat: true });
  }
  S.add(GEO.rbox, WATER.ice, M4(0, 0.6, -Lh - 0.45, [2 * W + 1.4, 1.2, 0.5]));
  G.add(GEO.box, WATER.crystal, M4(0, 0.9, -Lh - 0.18, [2 * W, 0.12, 0.04]), { boost: GLOW * 0.7 });
}

// ---------------- base shield dome ----------------
function domeMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: TIME, uColor: { value: new THREE.Color(color) }, uHit: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uHit; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        vec2 hx = vec2(atan(vP.z, vP.x) * 6.0, vP.y * 2.2);
        float hex = smoothstep(0.42, 0.5, abs(fract(hx.x + floor(hx.y) * 0.5) - 0.5)) + smoothstep(0.42, 0.5, abs(fract(hx.y) - 0.5));
        float band = smoothstep(0.0, 0.3, 1.0 - abs(fract(vP.y * 0.12 - uTime * 0.35) - 0.5) * 4.0);
        float a = f * 0.9 + hex * 0.14 + band * 0.12 + uHit * 0.5;
        gl_FragColor = vec4(uColor * a * 1.8, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function buildWorld(scene, renderer, cover, detail = 1) {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const B = new Baker(), G = new Baker(), S = new Baker();
  buildTerrain(scene, G);
  const ft = floorTexture(maxAniso);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 72).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: ft.tex }));
  floor.receiveShadow = true; scene.add(floor);
  scene.add(lavaOverlay(ft.mask), waterOverlay(), oceanSurface(), lavaLake());

  buildWalls(B, G, S);
  buildCover(B, G, S, cover);
  const fort = buildFortress(B, G, S);
  const citadel = buildCitadel(B, G, S);
  const volcano = buildVolcano(B, G, -40, 34);
  buildVolcano(B, G, 42, 60);
  buildIceberg(B, G, -38, -40);
  buildIceberg(B, G, 40, -54);

  const add = (baker, mat, shadow = true) => { if (baker.empty) return; const m = new THREE.Mesh(baker.geometry(), mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); };
  add(B, toon(0xffffff, 0.16, { vertexColors: true }));
  add(S, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92 }));
  add(G, glowMat(0xffffff, { vertexColors: true }), false);
  scene.add(volcano, ...citadel.falls, ...citadel.rings, citadel.core);
  for (const c of fort.cracks) scene.add(c);
  for (const c of citadel.cracks) scene.add(c);

  // fire gouts erupting from the fortress
  const goutMat = additive(FIRE.lava, 0.95, 2.6), goutCore = additive(FIRE.lavaHot, 0.95, 2.6);
  const gouts = fort.gouts.map(([x, y, z]) => {
    const f = new THREE.Mesh(GEO.cone, goutMat); f.position.set(x, y, z); f.scale.set(0.7, 1.6, 0.7);
    const core = new THREE.Mesh(GEO.cone, goutCore); core.scale.set(0.5, 0.6, 0.5); core.position.y = -0.3; f.add(core);
    scene.add(f); return f;
  });
  const fireLight = new THREE.PointLight(0xFF6A2A, detail > 0.6 ? 15 : 0, 20, 1.8); fireLight.position.set(0, 7, BZ - 2);
  const waterLight = new THREE.PointLight(0x4DC8FF, detail > 0.6 ? 12 : 0, 18, 1.8); waterLight.position.set(0, 7, -BZ + 3);
  scene.add(fireLight, waterLight);

  // elemental ambience: embers over the fire half, cool mist over the water half, steam at the clash line
  motes(scene, Math.round(200 * detail), [-58, 0.2, -2, 116, 8, 72], 0xFF7A2A, 6, 0.03);        // embers rise
  const steam = buildSteam(scene, Math.round(80 * detail));

  // bases (turret + dome driven by the simulation)
  const human = { group: new THREE.Group(), turret: fort.turret, cracks: fort.cracks };
  const ai = { group: new THREE.Group(), turret: citadel.turret, cracks: citadel.cracks };
  human.group.add(fort.turret); ai.group.add(citadel.turret);
  scene.add(human.group, ai.group);
  const bases = { human, ai };
  for (const k of ['human', 'ai']) {
    const b = bases[k];
    b.home = new THREE.Vector3(0, 0, k === 'human' ? BZ : -BZ);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7.4, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial(k === 'human' ? 0xFF7A2A : 0x6FD8FF));
    dome.position.copy(b.home); dome.visible = false; dome.renderOrder = 4;
    scene.add(dome); b.dome = dome;
  }

  let t = 0;
  return {
    bases,
    update(dt, game, turretAims) {
      t += dt; TIME.value = t;
      volcano.children[0] && (volcano.rotation.y = t * 0.1);
      citadel.rings[0].rotation.x = Math.sin(t * 0.6) * 0.3; citadel.rings[0].rotation.z = t * 0.6;
      citadel.rings[1].rotation.x = t * 0.9; citadel.rings[1].rotation.z = Math.cos(t) * 0.3;
      citadel.core.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
      for (let i = 0; i < gouts.length; i++) {
        const f = gouts[i], k = 1.0 + Math.sin(t * 11 + i * 3) * 0.3 + Math.sin(t * 23 + i) * 0.2;
        f.scale.set(0.7 * (2 - k) * 0.8, 1.6 * k, 0.7 * (2 - k) * 0.8);
        f.rotation.z = Math.sin(t * 6 + i) * 0.12;
      }
      if (fireLight.intensity > 0) fireLight.intensity = 14 + Math.sin(t * 13) * 3 + Math.sin(t * 29) * 2;
      if (!game) return;
      for (const k of ['human', 'ai']) {
        const b = bases[k], sb = game.bases[k];
        const shake = sb.hitT > 0 ? sb.hitT * 0.5 : 0;
        b.group.position.set((Math.random() - 0.5) * shake, 0, (Math.random() - 0.5) * shake);
        const dmg = 1 - sb.hp / sb.max;
        b.cracks[0].visible = dmg > 0.3; b.cracks[1].visible = dmg > 0.55; b.cracks[2].visible = dmg > 0.78;
        b.dome.visible = sb.shield;
        if (sb.shield) b.dome.material.uniforms.uHit.value = sb.hitT > 0 ? sb.hitT * 3 : 0;
        const aim = turretAims[k];
        if (aim) {
          const wp = b.turret.getWorldPosition(_tp);
          const yaw = Math.atan2(aim.x - wp.x, aim.z - wp.z);
          let d = yaw - b.turret.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          b.turret.rotation.y += d * Math.min(1, dt * 10);
        }
      }
      void steam;
    },
  };
}
const _tp = new THREE.Vector3();
