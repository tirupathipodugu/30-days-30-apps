// Shared look: toon materials with a rim light, unit geometries, and the instanced "crowd" renderer
// that draws every minion of one model with one draw call per body part.
import * as THREE from 'three';

const gradTex = (() => {
  const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();

const matCache = new Map();
// Toon material with a soft fresnel rim so characters pop off the ground.
export function toon(color = 0xffffff, rim = 0.32, extra = {}, unique = false) {
  const key = color + ':' + rim + ':' + JSON.stringify(extra);
  if (!unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimStrength = { value: rim };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float rimStrength;\nvoid main() {')
      .replace('#include <opaque_fragment>', `{
        float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        outgoingLight += vec3(1.0, 0.95, 0.88) * pow(rimF, 2.6) * rimStrength;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'rim' + rim;
  if (!unique) matCache.set(key, m);
  return m;
}
export function glowMat(color = 0xffffff, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts });
}
export function additive(color = 0xffffff, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

// Unit-sized geometries; parts scale them. "limb" variants hang down from their origin (pivot at the top).
export const GEO = {};
(function makeGeos() {
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.limb = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
  GEO.cap = new THREE.CapsuleGeometry(0.5, 1, 4, 10).scale(1, 0.5, 1); // fits a 1x1x1 box, rounded
  GEO.capLimb = new THREE.CapsuleGeometry(0.5, 1, 3, 8).scale(1, 0.5, 1).translate(0, -0.5, 0);
  GEO.sphere = new THREE.SphereGeometry(0.5, 14, 10);
  GEO.hemi = new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  GEO.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  GEO.cylLimb = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, -0.5, 0);
  GEO.barrel = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5); // points +z
  GEO.cone = new THREE.ConeGeometry(0.5, 1, 12);
  GEO.wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 14).rotateZ(Math.PI / 2);
  GEO.torus = new THREE.TorusGeometry(0.5, 0.11, 6, 20).rotateX(Math.PI / 2);
  GEO.ico = new THREE.IcosahedronGeometry(0.5, 0);
  GEO.dodec = new THREE.DodecahedronGeometry(0.5, 0);
  GEO.octa = new THREE.OctahedronGeometry(0.5, 0);
  GEO.disk = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 20);
  GEO.wedge = new THREE.CylinderGeometry(0, 0.5, 1, 4).rotateY(Math.PI / 4); // pyramid
})();

// ---------- part-based models ----------
// A part: { g: geometry key, c: color, p: pivot [x,y,z], o: offset from pivot, s: scale, r: rotation, a: anim, glow }
// Animations are applied at the pivot so limbs swing from shoulders and hips.
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();

export function partMatrix(part, st, out) {
  // st: { ph (walk phase), mv (0..1 move amount), swing (0..1 attack), t, roll, seed }
  let ax = 0, ay = 0, az = 0, ty = 0, tz = 0;
  const a = part.a;
  if (a) {
    const sw = Math.sin(st.ph);
    if (a === 'legL') ax = sw * 0.75 * st.mv;
    else if (a === 'legR') ax = -sw * 0.75 * st.mv;
    else if (a === 'armL') ax = -sw * 0.6 * st.mv - st.swing * 0.6;
    else if (a === 'armR') ax = sw * 0.6 * st.mv - st.swing * 2.3;
    else if (a === 'armsUp') ax = -1.2 - st.swing * 1.6;
    else if (a === 'aim') ax = -1.45 + st.swing * 0.35;
    else if (a === 'wheel') ax = st.roll;
    else if (a === 'spin') ay = st.t * 4 + st.seed;
    else if (a === 'spinFast') ay = st.t * 12 + st.seed;
    else if (a === 'gun') tz = -st.swing * 0.3;
    else if (a === 'head') ay = Math.sin(st.t * 1.7 + st.seed) * 0.25;
    else if (a === 'flap') az = Math.sin(st.t * 9 + st.seed) * 0.2;
  }
  if (!a || (a !== 'legL' && a !== 'legR' && a !== 'wheel')) ty = Math.abs(Math.sin(st.ph)) * 0.07 * st.mv;
  const p = part.p, o = part.o || ZERO, r = part.r || ZERO, s = part.s;
  out.makeTranslation(p[0], p[1] + ty, p[2] + tz);
  if (ax || ay || az) { _e.set(ax, ay, az); _m.makeRotationFromEuler(_e); out.multiply(_m); }
  if (o[0] || o[1] || o[2]) { _m.makeTranslation(o[0], o[1], o[2]); out.multiply(_m); }
  if (r[0] || r[1] || r[2]) { _e.set(r[0], r[1], r[2]); _m.makeRotationFromEuler(_e); out.multiply(_m); }
  _m.makeScale(s[0], s[1], s[2]); out.multiply(_m);
  return out;
}
const ZERO = [0, 0, 0];

// Draws N copies of a part-model with InstancedMeshes (one per part).
export class Crowd {
  constructor(scene, model, max) {
    this.model = model; this.max = max; this.meshes = [];
    for (const part of model.parts) {
      const mat = part.glow ? glowMat(0xffffff) : toon(0xffffff, part.rim ?? 0.32);
      const im = new THREE.InstancedMesh(GEO[part.g], mat, max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = !part.glow && !part.noShadow; im.receiveShadow = false;
      im.frustumCulled = false; im.count = 0;
      scene.add(im);
      this.meshes.push(im);
    }
    this.n = 0;
    this.col = new THREE.Color();
  }
  begin() { this.n = 0; }
  // root: Matrix4 of the minion, st: anim state, flash 0..1 (white hit flash), tint (optional Color multiply)
  add(root, st, flash, gold) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const parts = this.model.parts;
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k], im = this.meshes[k];
      partMatrix(part, st, _m2);
      _m2.premultiply(root);
      im.setMatrixAt(i, _m2);
      this.col.setHex(gold && part.eliteC ? 0xFFC83D : part.c);
      if (flash > 0) { const f = flash; this.col.r += (1.8 - this.col.r) * f; this.col.g += (1.8 - this.col.g) * f; this.col.b += (1.8 - this.col.b) * f; }
      im.setColorAt(i, this.col);
    }
  }
  end() {
    for (const im of this.meshes) {
      im.count = this.n;
      im.visible = this.n > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

// Builds a model as a real Group (used for heroes and props) so parts can be animated individually.
export function buildGroup(model) {
  const g = new THREE.Group();
  const parts = [];
  for (const part of model.parts) {
    const mat = part.glow ? glowMat(part.c) : toon(part.c, part.rim ?? 0.32);
    const mesh = new THREE.Mesh(GEO[part.g], mat);
    mesh.castShadow = !part.glow && !part.noShadow;
    mesh.matrixAutoUpdate = false;
    g.add(mesh);
    parts.push({ part, mesh });
  }
  return {
    group: g, parts,
    pose(st) { for (const { part, mesh } of parts) partMatrix(part, st, mesh.matrix); },
  };
}

export function rootMatrix(out, x, y, z, yaw, sx, sy, sz, lean = 0, roll = 0) {
  _e.set(lean, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
