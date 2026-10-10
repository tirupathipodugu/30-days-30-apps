// Glass thread ribbons in one merged geometry (drawn behind and in front of the heart), with the blood pulse in the shader.

import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aTangent;
attribute float aSide, aS, aWidth, aSeed;
uniform float uTime, uDpr, uV, uAtten, uHover, uReduced, uHalfD;
uniform vec4 uBeats;
uniform vec2 uRes;
varying float vSide, vAlpha, vHover, vS, vSeed;
varying vec2 vGlow;

// The pulse front (x) and the blood left filling the thread behind it (y).
vec2 glowAt(float s) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float dt = uTime - uBeats[i];
    if (dt < 0.0 || dt > 6.0) continue;
    if (uReduced > 0.5) {
      g.x += 0.45 * exp(-dt / 0.35) * (1.0 - exp(-dt / 0.05));
    } else {
      float x = s - uV * dt;
      g.x += exp(-(x / 0.06) * (x / 0.06));
      float pass = dt - s / uV;
      if (pass > 0.0) g.y += 0.25 * exp(-pass / 0.15);
    }
  }
  return g * exp(-s / uAtten);
}

void main() {
  vec3 p = position;
  float depthF = clamp(abs(p.z) / uHalfD, 0.0, 1.0);
  if (uReduced < 0.5) {
    // Slow floating sway, anchored at the heart and growing toward the tips.
    vec3 n = normalize(cross(aTangent, vec3(0.0, 0.0, 1.0)) + vec3(0.0, 0.0, 0.0001));
    p += n * 0.004 * min(aS, 4.0) * sin(uTime * 0.3 + aSeed * 1.7 + aS * 2.0);
  }
  vec2 gg = glowAt(aS);
  float g = gg.x + gg.y;
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p + aTangent * 0.02, 1.0);
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float swell = uReduced > 0.5 ? 0.0 : 0.45 * min(g, 1.5);
  float w = aWidth * uDpr * (1.0 + 1.5 * depthF) * (1.0 + swell);
  float drawW = max(w, 1.0 * uDpr) + uDpr;                 // at least a pixel, plus an edge for antialiasing
  c0.xy += perp * aSide * drawW / uRes * c0.w;
  gl_Position = c0;
  vSide = aSide * drawW / max(drawW - uDpr, 0.5);
  vAlpha = (1.0 - 0.6 * depthF) * min(1.0, w / uDpr);
  vGlow = gg;
  vHover = abs(aSeed - uHover) < 0.5 ? 1.0 : 0.0;
  vS = aS;
  vSeed = aSeed;
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uGlass, uBlood, uHot;
varying float vSide, vAlpha, vHover, vS, vSeed;
varying vec2 vGlow;

void main() {
  float a = abs(vSide);
  float edge = 1.0 - smoothstep(1.0, 1.0 + 0.6, a);       // soft outer pixel
  float side = min(a, 1.0);
  float fres = side * side * side;
  float alpha = 0.05 + 0.22 * fres;
  // A thin highlight streak that slides along the thread.
  float sd = (side - 0.55) / 0.12;
  float streak = exp(-sd * sd) * (0.5 + 0.5 * sin(vS * 9.0 - uTime * 0.3 + vSeed));
  vec3 col = uGlass * alpha + uGlass * streak * 0.08;
  float g = clamp(vGlow.x, 0.0, 2.0);
  float core = 1.0 - side * side;
  // The front glows hot (and blooms); the blood filling in behind it is darker and fades back to glass.
  vec3 blood = mix(uBlood, uHot, smoothstep(0.7, 1.0, g)) * (0.6 + 0.4 * core);
  col = mix(col, blood * 0.85, clamp(g, 0.0, 1.0)) + blood * (max(g - 1.0, 0.0) * 0.5 + g * g * 1.2 * core);   // the core is bright enough to bloom
  col += uBlood * 0.12 * vGlow.y * (0.4 + 0.6 * core);
  float k = vAlpha * edge * (1.0 + vHover);
  gl_FragColor = vec4(col * k, 1.0);
}
`;

const linear = (hex) => new THREE.Color(hex);

export function buildThreadMeshes(paths, { dpr, halfD, v, atten }) {
  let samples = 0;
  for (const p of paths) samples += p.pts.length;
  const pos = new Float32Array(samples * 2 * 3), tan = new Float32Array(samples * 2 * 3);
  const side = new Float32Array(samples * 2), sArr = new Float32Array(samples * 2), width = new Float32Array(samples * 2), seed = new Float32Array(samples * 2);
  const back = [], front = [];
  const hover = [];
  let vi = 0;
  for (const path of paths) {
    const pts = path.pts, n = pts.length;
    let s = path.s0;
    const first = vi;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      const w = threadWidth(path, i / (n - 1), pts[i].src);
      for (let k = 0; k < 2; k++) {
        pos.set(pts[i], vi * 3); tan.set([tx, ty, tz], vi * 3);
        side[vi] = k ? 1 : -1; sArr[vi] = s; width[vi] = w; seed[vi] = path.id;
        vi++;
      }
      if (i % 3 === 0) hover.push(pts[i][0], pts[i][1], pts[i][2], s, path.id);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = first + i * 2;
      const list = (pts[i][2] + pts[i + 1][2]) * 0.5 < 0 ? back : front;
      list.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), aTangent: new THREE.BufferAttribute(tan, 3),
    aSide: new THREE.BufferAttribute(side, 1), aS: new THREE.BufferAttribute(sArr, 1),
    aWidth: new THREE.BufferAttribute(width, 1), aSeed: new THREE.BufferAttribute(seed, 1),
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uDpr: { value: dpr }, uV: { value: v }, uAtten: { value: atten }, uHover: { value: -10 },
      uReduced: { value: 0 }, uHalfD: { value: halfD }, uBeats: { value: new THREE.Vector4(-99, -99, -99, -99) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGlass: { value: linear(0xcfe3ee) }, uBlood: { value: linear(0xb3001b).multiplyScalar(3.2) }, uHot: { value: linear(0xff3b30).multiplyScalar(8.0) },
    },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const make = (idx, order) => {
    const g = new THREE.BufferGeometry();
    for (const k in attrs) g.setAttribute(k, attrs[k]);
    g.setIndex(new THREE.BufferAttribute(samples * 2 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = order;
    return m;
  };
  return { back: make(back, 1), front: make(front, 3), material, hover: new Float32Array(hover), vertices: samples * 2 };
}

// CSS-pixel widths: trunks taper to tips by how much tree each segment feeds; wanderers stay fine.
function threadWidth(path, t, src) {
  if (path.wanderer) return path.w0;
  const ws = path.widths;
  const j = Math.min(ws.length - 1, Math.max(0, src ?? t * (ws.length - 1)));
  const i0 = Math.floor(j), f = j - i0;
  const w = ws[i0] * (1 - f) + ws[Math.min(ws.length - 1, i0 + 1)] * f;
  return path.tipW + (path.trunkW - path.tipW) * w;
}
