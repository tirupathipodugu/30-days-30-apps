// Shared look: soft toon materials with a rim light, unit geometries, geometry baking (many parts -> one
// vertex-coloured mesh), and the instanced "crowd" renderer that draws every minion of one model with one
// draw call per moving body group.
import * as THREE from 'three';

// shared clock for shader animation (grass sway, banners, holo screens). world.update advances it.
export const TIME = { value: 0 };

// soft 3-tone ramp: a cel look with gently blended terminators instead of hard bands
const gradTex = (() => {
  const v = [92, 104, 128, 160, 196, 224, 244, 255];
  const d = new Uint8Array(v.length * 4);
  v.forEach((x, i) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = x; d[i * 4 + 3] = 255; });
  const t = new THREE.DataTexture(d, v.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();
export const GRADIENT = gradTex;

const RIM = `{
  float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  outgoingLight += vec3(1.0, 0.94, 0.85) * pow(rimF, 2.8) * rimStrength * (0.55 + 0.45 * clamp(normal.y + 0.6, 0.0, 1.0));
}`;
// wind sway, weighted by the per-vertex "aw" attribute (0 at roots, ~1 at banner tips)
const SWAY_V = `
  #ifdef USE_INSTANCING
    vec3 swW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vec3 swW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float swP = swW.x * 0.35 + swW.z * 0.21;
  float swS = sin(uTime * swayF - aw * 4.0 + swP) * 0.7 + sin(uTime * swayF * 2.3 + swP * 1.7) * 0.3;
  transformed += vec3(0.55, 0.0, 0.8) * swS * aw * swayA;
`;

const matCache = new Map();
// Toon material with a soft fresnel rim so characters pop off the ground.
// extra.sway = [amplitude, frequency] adds wind motion driven by the "aw" vertex attribute.
export function toon(color = 0xffffff, rim = 0.32, extra = {}, unique = false) {
  const key = color + ':' + rim + ':' + JSON.stringify(extra);
  if (!unique && matCache.has(key)) return matCache.get(key);
  const { sway, ...params } = extra;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...params });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimStrength = { value: rim };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float rimStrength;\nvoid main() {')
      .replace('#include <opaque_fragment>', RIM + '\n#include <opaque_fragment>');
    if (sway) {
      sh.uniforms.uTime = TIME; sh.uniforms.swayA = { value: sway[0] }; sh.uniforms.swayF = { value: sway[1] };
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute float aw; uniform float uTime, swayA, swayF;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_V);
    }
  };
  m.customProgramCacheKey = () => 'rim' + rim + (sway ? 'sw' + sway.join('_') : '');
  if (!unique) matCache.set(key, m);
  return m;
}
// Glow colours are pushed above 1.0 so only they cross the bloom threshold.
export const GLOW = 3.2;
export function glowMat(color = 0xffffff, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...opts });
  if (!opts.vertexColors) m.color.multiplyScalar(GLOW);
  return m;
}
export function additive(color = 0xffffff, opacity = 1, boost = 2) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  m.color.multiplyScalar(boost);
  return m;
}

// ---------- geometry ----------
function roundedBox(r = 0.22, seg = 4) {
  const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const h = 0.5 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
    v.sub(c);
    if (v.lengthSq() < 1e-8) v.copy(c).normalize();
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// Unit-sized geometries; parts scale them. "limb" variants hang down from their origin (pivot at the top).
export const GEO = {};
(function makeGeos() {
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.rbox = roundedBox(0.22, 3);
  GEO.rboxS = roundedBox(0.12, 2);
  GEO.limb = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
  GEO.cap = new THREE.CapsuleGeometry(0.5, 1, 4, 12).scale(1, 0.5, 1); // fits a 1x1x1 box, rounded
  GEO.capLimb = new THREE.CapsuleGeometry(0.5, 1, 3, 8).scale(1, 0.5, 1).translate(0, -0.5, 0);
  GEO.sphere = new THREE.SphereGeometry(0.5, 14, 10);
  GEO.sphereLo = new THREE.SphereGeometry(0.5, 8, 6);
  GEO.sphereHi = new THREE.SphereGeometry(0.5, 22, 16);
  GEO.hemi = new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  GEO.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  GEO.cylLo = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  GEO.cylLimb = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, -0.5, 0);
  GEO.taper = new THREE.CylinderGeometry(0.36, 0.5, 1, 10);
  GEO.barrel = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5); // points +z
  GEO.cone = new THREE.ConeGeometry(0.5, 1, 12);
  GEO.wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 14).rotateZ(Math.PI / 2);
  GEO.torus = new THREE.TorusGeometry(0.5, 0.11, 6, 20).rotateX(Math.PI / 2);
  GEO.ring = new THREE.TorusGeometry(0.5, 0.008, 4, 48).rotateX(Math.PI / 2);
  GEO.ico = new THREE.IcosahedronGeometry(0.5, 0);
  GEO.blob = new THREE.IcosahedronGeometry(0.5, 1);
  GEO.dodec = new THREE.DodecahedronGeometry(0.5, 0);
  GEO.octa = new THREE.OctahedronGeometry(0.5, 0);
  GEO.disk = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 20);
  GEO.wedge = new THREE.CylinderGeometry(0, 0.5, 1, 4).rotateY(Math.PI / 4); // pyramid
  GEO.plane = new THREE.PlaneGeometry(1, 1);
  GEO.cloth = new THREE.BoxGeometry(1, 1, 1, 1, 3, 1).translate(0, -0.5, 0); // capes / scarves hang from the top edge
})();

// ---------- baking: many parts -> one non-indexed, vertex-coloured geometry ----------
const _hc = new THREE.Color();
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
// Adds a part into arrays. opts: { jitter: colour noise amount, cell: noise cell size (per-face bricks),
// flat: use face normals, aw: sway weight (number, or 'y' to grow with local height), elite: 1/0 }
export class Baker {
  constructor() { this.P = []; this.N = []; this.C = []; this.A = []; this.E = []; }
  add(geo, color, matrix, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!opts.raw) g.applyMatrix4(matrix);
    if (opts.flat) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    _hc.set(color);
    if (opts.boost) _hc.multiplyScalar(opts.boost);
    const jit = opts.jitter || 0, cell = opts.cell || 0;
    const local = opts.aw === 'y' ? geo.attributes.position : null;
    let ymin = Infinity, ymax = -Infinity;
    if (opts.aw === 'y') { for (let i = 0; i < p.count; i++) { const y = p.getY(i); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); } }
    for (let i = 0; i < p.count; i += 3) {
      let f = 1;
      if (jit) {
        if (cell) {
          const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
          f = 1 + (hash3(Math.floor(cx / cell), Math.floor(cy / cell * 1.8), Math.floor(cz / cell)) - 0.5) * jit;
        }
      }
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        this.P.push(p.getX(j), p.getY(j), p.getZ(j));
        this.N.push(n.getX(j), n.getY(j), n.getZ(j));
        let ff = f;
        if (jit && !cell) ff = 1 + (hash3(p.getX(j) * 1.7, p.getY(j) * 1.7, p.getZ(j) * 1.7) - 0.5) * jit;
        if (opts.shade) ff *= 1 - opts.shade * (1 - Math.max(0, Math.min(1, (p.getY(j) - (opts.shadeY0 || 0)) / (opts.shadeH || 1))));
        this.C.push(_hc.r * ff, _hc.g * ff, _hc.b * ff);
        let aw = 0;
        if (opts.aw === 'y') aw = (p.getY(j) - ymin) / Math.max(1e-4, ymax - ymin) * (opts.awScale || 1);
        else if (typeof opts.aw === 'number') aw = opts.aw;
        else if (opts.awFn) aw = opts.awFn(p.getX(j), p.getY(j), p.getZ(j), j);
        this.A.push(aw);
        this.E.push(opts.elite ? 1 : 0);
      }
    }
    void local;
    return this;
  }
  get empty() { return this.P.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aw', new THREE.Float32BufferAttribute(this.A, 1));
    g.setAttribute('aElite', new THREE.Float32BufferAttribute(this.E, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bv = new THREE.Vector3(), _bs = new THREE.Vector3();
// matrix helper: position, scale (number or [x,y,z]), rotation [x,y,z]
export function M4(x, y, z, s = 1, r = null, out = new THREE.Matrix4()) {
  if (r) { _be.set(r[0], r[1], r[2], r[3] || 'XYZ'); _bq.setFromEuler(_be); } else _bq.identity();
  if (typeof s === 'number') _bs.set(s, s, s); else _bs.set(s[0], s[1], s[2]);
  return out.compose(_bv.set(x, y, z), _bq, _bs);
}

// ---------- materials for baked / crowd meshes ----------
const CROWD_V_HEAD = 'attribute vec2 aFx; attribute float aElite; varying float vFlash;\nvoid main() {';
const CROWD_V_BODY = `#include <color_vertex>
  vFlash = aFx.x;
  #ifdef USE_COLOR
    vColor.rgb = mix(vColor.rgb, vec3(1.0, 0.72, 0.16), aElite * aFx.y);
  #endif`;
let crowdMat = null, crowdGlow = null;
export function crowdMaterial() {
  if (crowdMat) return crowdMat;
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradTex, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimStrength = { value: 0.42 };
    sh.vertexShader = sh.vertexShader.replace('void main() {', CROWD_V_HEAD).replace('#include <color_vertex>', CROWD_V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float rimStrength; varying float vFlash;\nvoid main() {')
      .replace('#include <opaque_fragment>', RIM + '\noutgoingLight = mix(outgoingLight, vec3(1.5, 1.42, 1.32), vFlash);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'crowd';
  crowdMat = m;
  return m;
}
export function crowdGlowMaterial() {
  if (crowdGlow) return crowdGlow;
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', CROWD_V_HEAD).replace('#include <color_vertex>', CROWD_V_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vFlash;\nvoid main() {')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, vec3(2.0), vFlash);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'crowdGlow';
  crowdGlow = m;
  return m;
}

// ---------- part-based models ----------
// A part: { g: geometry key, c: color, p: pivot [x,y,z], o: offset from pivot, s: scale, r: rotation, a: anim, glow }
// Animations are applied at the pivot so limbs swing from shoulders and hips.
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = [0, 0, 0];

// blink: eyes close for ~0.12 s every few seconds, each unit on its own rhythm
export function blinkAt(t, seed) {
  const period = 2.6 + (seed % 7) * 0.37;
  const ph = (t + seed * 0.61) % period;
  return ph < 0.12 ? Math.max(0.08, Math.abs(ph - 0.06) / 0.06) : 1;
}

// Pose of the moving pivot of a part group (no local offsets). st: { ph, mv, swing, t, roll, seed }
function pivotMatrix(a, p, st, out) {
  let ax = 0, ay = 0, az = 0, ty = 0, tz = 0, sy = 1, sxz = 1;
  if (a) {
    const sw = Math.sin(st.ph);
    if (a === 'legL') ax = sw * 0.8 * st.mv;
    else if (a === 'legR') ax = -sw * 0.8 * st.mv;
    else if (a === 'armL') { ax = -sw * 0.7 * st.mv - st.swing * 0.5; az = -0.12 - st.mv * 0.08; }
    else if (a === 'armR') { ax = sw * 0.7 * st.mv - st.swing * 2.4; az = 0.12 + st.mv * 0.08; }
    else if (a === 'armsUp') ax = -1.2 - st.swing * 1.6;
    else if (a === 'aim') ax = -1.45 + st.swing * 0.35;
    else if (a === 'wheel') ax = st.roll;
    else if (a === 'spin') ay = st.t * 4 + st.seed;
    else if (a === 'spinFast') ay = st.t * 12 + st.seed;
    else if (a === 'gun') tz = -st.swing * 0.3;
    else if (a === 'head') { ay = Math.sin(st.t * 1.7 + st.seed) * 0.22; ax = -0.06 + Math.sin(st.ph * 2) * 0.05 * st.mv; }
    else if (a === 'flap') az = Math.sin(st.t * 9 + st.seed) * 0.2;
    else if (a === 'cape') ax = 0.1 + st.mv * 0.38 + Math.sin(st.t * 7 + st.seed) * 0.07 * (0.4 + st.mv) + st.swing * 0.15;
    else if (a === 'blink') sy = blinkAt(st.t, st.seed);
    else if (a === 'thrust') { const f = 0.85 + Math.sin(st.t * 31 + st.seed) * 0.15; sy = f * (1 + st.mv * 0.4); sxz = f; }
    else if (a === 'bob') ty = Math.sin(st.t * 2.4 + st.seed) * 0.05;
  }
  // body bob: everything above the hips rises and falls twice per stride (squash & stretch on landing)
  if (a !== 'legL' && a !== 'legR' && a !== 'wheel') ty += Math.abs(Math.sin(st.ph)) * 0.09 * st.mv;
  out.makeTranslation(p[0], p[1] + ty, p[2] + tz);
  if (ax || ay || az) { _e.set(ax, ay, az); _m.makeRotationFromEuler(_e); out.multiply(_m); }
  if (sy !== 1 || sxz !== 1) { _m.makeScale(sxz, sy, sxz); out.multiply(_m); }
  return out;
}
function localMatrix(part, out) {
  const o = part.o || ZERO, r = part.r || ZERO, s = part.s;
  out.identity();
  if (!part.a) out.makeTranslation(part.p[0], part.p[1], part.p[2]);
  if (o[0] || o[1] || o[2]) { _m.makeTranslation(o[0], o[1], o[2]); out.multiply(_m); }
  if (r[0] || r[1] || r[2]) { _e.set(r[0], r[1], r[2]); _m.makeRotationFromEuler(_e); out.multiply(_m); }
  _m.makeScale(s[0], s[1], s[2]); out.multiply(_m);
  return out;
}
// Group parts that move together (same anim + pivot, same material) and bake each group into one geometry.
export function bakeModel(model) {
  const groups = new Map();
  for (const part of model.parts) {
    const key = (part.glow ? 'g' : 't') + '|' + (part.a || '') + '|' + (part.a ? part.p.join(',') : '');
    let gr = groups.get(key);
    if (!gr) { gr = { a: part.a || null, p: part.a ? part.p : ZERO, glow: !!part.glow, baker: new Baker(), shadow: !part.glow }; groups.set(key, gr); }
    if (part.noShadow || part.a === 'blink' || part.a === 'thrust') gr.shadow = false; // tiny parts: not worth a shadow draw
    gr.baker.add(GEO[part.g], part.c, localMatrix(part, _m2), { boost: part.glow ? GLOW : 0, elite: part.eliteC, jitter: part.j || 0 });
  }
  return [...groups.values()].map((g) => ({ a: g.a, p: g.p, glow: g.glow, shadow: g.shadow, geo: g.baker.geometry() }));
}

// Draws N copies of a part-model with one InstancedMesh per moving group.
export class Crowd {
  constructor(scene, model, max) {
    this.model = model; this.max = max; this.meshes = [];
    this.groups = bakeModel(model);
    for (const gr of this.groups) {
      const fx = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
      fx.setUsage(THREE.DynamicDrawUsage);
      gr.geo.setAttribute('aFx', fx);
      const im = new THREE.InstancedMesh(gr.geo, gr.glow ? crowdGlowMaterial() : crowdMaterial(), max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = gr.shadow; im.receiveShadow = false;
      im.frustumCulled = false; im.count = 0;
      scene.add(im);
      this.meshes.push(im);
      gr.fx = fx;
    }
    this.n = 0;
  }
  begin() { this.n = 0; }
  // root: Matrix4 of the minion, st: anim state, flash 0..1 (white hit flash), gold: elite tint
  add(root, st, flash, gold) {
    if (this.n >= this.max) return;
    const i = this.n++;
    for (let k = 0; k < this.groups.length; k++) {
      const gr = this.groups[k];
      pivotMatrix(gr.a, gr.p, st, _m2);
      _m2.premultiply(root);
      this.meshes[k].setMatrixAt(i, _m2);
      gr.fx.array[i * 2] = flash; gr.fx.array[i * 2 + 1] = gold ? 1 : 0;
    }
  }
  end() {
    for (let k = 0; k < this.meshes.length; k++) {
      const im = this.meshes[k];
      im.count = this.n;
      im.visible = this.n > 0;
      if (this.n) { im.instanceMatrix.needsUpdate = true; this.groups[k].fx.needsUpdate = true; }
    }
  }
}

// Builds a model as a real Group of baked meshes (used for props) so groups can be animated individually.
export function buildGroup(model) {
  const g = new THREE.Group();
  const groups = bakeModel(model).map((gr) => {
    const mesh = new THREE.Mesh(gr.geo, gr.glow ? crowdGlowMaterial() : crowdMaterial());
    mesh.castShadow = gr.shadow; mesh.matrixAutoUpdate = false;
    g.add(mesh);
    return { gr, mesh };
  });
  return { group: g, pose(st) { for (const { gr, mesh } of groups) pivotMatrix(gr.a, gr.p, st, mesh.matrix); } };
}

export function rootMatrix(out, x, y, z, yaw, sx, sy, sz, lean = 0, roll = 0) {
  _e.set(lean, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
// legacy single-part matrix (kept for callers that pose one part at a time)
export function partMatrix(part, st, out) {
  pivotMatrix(part.a, part.a ? part.p : ZERO, st, out);
  return out.multiply(localMatrix(part, _m2));
}
