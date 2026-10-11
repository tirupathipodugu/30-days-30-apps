// Tissue materials: one clearcoat physical material per part, patched for the beat, wet tissue detail, the
// cutaway's cut faces, the clipping sphere around the camera, and the study highlight. Every part shares one
// shader program and one set of beat uniforms; only the colours and the highlight differ.

import * as THREE from 'three';

const DEFORM = /* glsl */`
attribute vec4 aHeart;      // h (apex 0 .. AV plane 1), ventricle weight, atrium weight, vessel weight
attribute vec3 aPivot;      // atrium centre, or the nearest point on a great artery's axis
attribute vec4 color;       // r: epicardial fat, g: inner lining (endocardium)
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uLen, uVent, uTwist, uAtria, uSwell, uAmp;
varying vec3 vRest;
varying vec3 vW;            // ventricle, atrium, fat
varying vec2 vTissue;       // fat, inner lining
varying vec3 vWorld;

vec3 rotAxis(vec3 v, vec3 k, float a) {
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}

vec3 deform(vec3 p) {
  vec3 rel = p - uApex;
  float along = dot(rel, uAxis);
  vec3 radial = rel - uAxis * along;
  float h = clamp(aHeart.x, 0.0, 1.0);
  float vent = uVent * uAmp;
  // Ventricles squeeze 7% toward the long axis, the base descends toward a near-still apex, and twist.
  radial *= 1.0 - 0.07 * vent;
  radial = rotAxis(radial, uAxis, uTwist * uAmp * radians(mix(10.0, -4.0, h)));
  vec3 pv = uApex + uAxis * (along - (0.01 + 0.05 * h) * vent * uLen) + radial;
  // Atria lose volume in atrial systole and balloon a little while the ventricles squeeze.
  float sA = 1.0 - 0.035 * uAtria * uAmp + 0.02 * vent;
  vec3 pa = aPivot + (p - aPivot) * sA - uAxis * (0.03 * vent * uLen);
  // The great arteries swell 2% with ejection.
  vec3 ps = aPivot + (p - aPivot) * (1.0 + 0.02 * uSwell * uAmp);
  return p + aHeart.y * (pv - p) + aHeart.z * (pa - p) + aHeart.w * (ps - p);
}
`;

const NOISE = /* glsl */`
varying vec3 vRest;
varying vec3 vW;
varying vec2 vTissue;
varying vec3 vWorld;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Value noise with its analytic gradient (after Inigo Quilez): returns (value, d/dx, d/dy, d/dz).
vec4 noised(vec3 x) {
  vec3 i = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  float a = hash3(i), b = hash3(i + vec3(1, 0, 0)), c = hash3(i + vec3(0, 1, 0)), d = hash3(i + vec3(1, 1, 0));
  float e = hash3(i + vec3(0, 0, 1)), f = hash3(i + vec3(1, 0, 1)), g = hash3(i + vec3(0, 1, 1)), h = hash3(i + vec3(1, 1, 1));
  float k0 = a, k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
  return vec4(-1.0 + 2.0 * (k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z),
    2.0 * du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}
// Fat lobules: domes around jittered cell centres; returns (height, gradient).
vec4 lobules(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float best = 8.0; vec3 bestD = vec3(0.0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 c = o + vec3(hash3(i + o), hash3(i + o + 17.3), hash3(i + o + 41.7));
    vec3 d = f - c;
    float dd = dot(d, d);
    if (dd < best) { best = dd; bestD = d; }
  }
  return vec4(1.0 - best, -2.0 * bestD);
}
`;

// Linear colours from sRGB hex.
const C = (hex) => new THREE.Color(hex);

/** The look of each kind of tissue. Arteries lean faintly red and veins faintly blue, as a study aid only. */
export const TISSUE = {
  ventricle: { base: '#5c1417', inner: '#7e2a2c', fat: 1, cap: 1, bump: 1, sss: 1 },
  atrium: { base: '#62181c', inner: '#7f2d30', fat: 1, cap: 1, bump: 0.8, sss: 1 },
  valve: { base: '#c9a596', inner: '#c9a596', fat: 0, cap: 0, bump: 0.35, sss: 0.5, rough: 0.36 },
  papillary: { base: '#6e1d20', inner: '#6e1d20', fat: 0, cap: 1, bump: 0.8, sss: 1 },
  artery: { base: '#8c5752', inner: '#6a3432', fat: 0, cap: 0, bump: 0.45, sss: 0.45, sheen: 0.1 },
  arteryBlue: { base: '#6f5d66', inner: '#4a3a44', fat: 0, cap: 0, bump: 0.45, sss: 0.4, sheen: 0.1 },
  vein: { base: '#3e3045', inner: '#2b2131', fat: 0, cap: 0, bump: 0.4, sss: 0.3, sheen: 0.1 },
  veinRed: { base: '#6e3e40', inner: '#5a3234', fat: 0, cap: 0, bump: 0.4, sss: 0.4, sheen: 0.1 },
  coronary: { base: '#8f2622', inner: '#8f2622', fat: 0, cap: 0, bump: 0.3, sss: 0.7 },
  cardiacVein: { base: '#3d2c48', inner: '#3d2c48', fat: 0, cap: 0, bump: 0.3, sss: 0.35 },
  node: { base: '#6e4f2a', inner: '#6e4f2a', fat: 0, cap: 0, bump: 0, sss: 0, glow: 1 },
};

/** Uniforms every part shares: the beat, the light, the camera, the stress of a blocked circulation. */
export function createSharedUniforms({ apex, axis, len }) {
  return {
    uApex: { value: apex.clone() }, uAxis: { value: axis.clone() }, uLen: { value: len },
    uVent: { value: 0 }, uTwist: { value: 0 }, uAtria: { value: 0 }, uSwell: { value: 0 }, uAmp: { value: 1 },
    uEject: { value: 0 }, uAtriaGloss: { value: 0 }, uFade: { value: 0 }, uDusk: { value: 0 }, uTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0, 0, 1) }, uNormalMat: { value: new THREE.Matrix3() },
    uCamPos: { value: new THREE.Vector3() }, uClipR: { value: 0 },
    uSss: { value: C('#8a0d16') }, uRim: { value: C('#c4242c') },
    uFatColor: { value: C('#b8956a').multiply(new THREE.Color(0.72, 0.64, 0.5)) },
    uCapColor: { value: C('#5a1416') }, uHiColor: { value: C('#ffd9c9') },
  };
}

export function createTissueMaterial(kind, shared, { lowTier, clippingPlanes }) {
  const t = TISSUE[kind];
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: t.rough ?? 0.42,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    ior: 1.4,
    specularIntensity: 0.6,
    sheen: lowTier ? 0 : t.sheen ?? 0.3,
    sheenColor: new THREE.Color(0xff6b5e),
    sheenRoughness: 0.45,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
    clippingPlanes,
  });
  const own = {
    uBase: { value: C(t.base) }, uInner: { value: C(t.inner) }, uFatOn: { value: t.fat }, uCap: { value: t.cap },
    uBump: { value: t.bump }, uSssAmt: { value: t.sss }, uGlow: { value: t.glow ? 1 : 0 },
    uHi: { value: 0 }, uHover: { value: 0 }, uDim: { value: 0 }, uMuscle: { value: kind === 'ventricle' || kind === 'atrium' || kind === 'papillary' ? 1 : 0 },
  };
  m.userData.uniforms = own;
  m.customProgramCacheKey = () => 'living-heart-tissue';

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = DEFORM + shader.vertexShader
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec3 dPos = deform(position);
        vec3 objectNormal;
        {
          vec3 n0 = normalize(normal);
          vec3 t1 = normalize(cross(n0, abs(n0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 t2 = cross(n0, t1);
          float e = 0.004;
          vec3 nn = cross(deform(position + t1 * e) - dPos, deform(position + t2 * e) - dPos);
          objectNormal = dot(nn, nn) > 1e-12 ? normalize(nn) * sign(dot(nn, n0) + 1e-6) : n0;
        }
        vRest = position;
        vW = vec3(aHeart.y, aHeart.z, color.r);
        vTissue = color.rg;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = dPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = NOISE + /* glsl */`
      uniform vec3 uKeyDir, uSss, uRim, uFatColor, uCapColor, uHiColor, uBase, uInner, uCamPos;
      uniform float uFade, uEject, uAtriaGloss, uDusk, uTime, uClipR, uFatOn, uCap, uBump, uSssAmt, uGlow, uHi, uHover, uDim, uMuscle;
      uniform mat3 uNormalMat;
    ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', /* glsl */`
        #include <clipping_planes_fragment>
        // Flying inside: everything within uClipR of the camera is cut away so the walls never fill the view.
        if (uClipR > 0.0 && distance(vWorld, uCamPos) < uClipR) discard;`)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        bool cut = !gl_FrontFacing && uCap > 0.5;
        float inner = vTissue.y;
        vec3 base = mix(uBase, uInner, inner);
        float tone = noised(vRest * 9.0).x * 0.5 + noised(vRest * 23.0).x * 0.25;
        base *= 1.0 + 0.12 * tone;
        // Epicardial fat: the band along the coronary vessels broken into irregular, lobulated patches.
        float fatN = noised(vRest * 9.0 + 3.1).x * 0.55 + noised(vRest * 19.0).x * 0.3 + noised(vRest * 41.0).x * 0.15;
        float fatW = uFatOn * smoothstep(0.6, 0.7, vTissue.x * 0.85 + 0.3 * fatN) * (1.0 - inner);
        vec4 lob = lobules(vRest * 26.0);
        base = mix(base, uFatColor * (0.78 + 0.3 * lob.x), fatW);
        // Strained muscle short of oxygen turns dusky.
        base = mix(base, base * vec3(0.62, 0.5, 0.78), uDusk * 0.7 * uMuscle);
        if (cut) {
          // A cut face: raw muscle with a faint fibre grain.
          float fib = noised(vRest * vec3(90.0, 14.0, 90.0)).x;
          base = uCapColor * (0.85 + 0.18 * fib + 0.1 * tone);
          fatW = 0.0;
        }
        diffuseColor.rgb = base;
        // Stretched muscle with the blood squeezed out reads darker and glossier.
        float squeeze = vW.x * uEject + vW.y * uAtriaGloss;
        diffuseColor.rgb *= 1.0 - 0.06 * squeeze * uMuscle;`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, fatW) * (1.0 + 0.15 * noised(vRest * 31.0).x);
        roughnessFactor *= 1.0 - 0.08 * squeeze - 0.18 * inner;
        if (cut) roughnessFactor = 0.62;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        if (uBump > 0.0) {
          // Bump from analytic gradients: fine muscle grain under the wet film, lobulated fat.
          vec3 grad = noised(vRest * 18.0).yzw * 0.0016 + noised(vRest * 47.0).yzw * 0.0006;
          vec4 lb = lobules(vRest * 26.0);
          grad = mix(grad, lb.yzw * 0.0045, fatW) * uBump * (cut ? 1.6 : 1.0);
          vec3 gView = normalize(uNormalMat * grad) * length(grad) * 26.0;
          normal = normalize(normal - (gView - normal * dot(gView, normal)));
        }`)
      .replace('#include <lights_physical_fragment>', /* glsl */`
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          if (cut) material.clearcoat = 0.2;
        #endif`)
      .replace('#include <opaque_fragment>', /* glsl */`
        {
          // Light bleeding into the shadow side (wrap diffuse), a red Fresnel rim, then the study highlight.
          vec3 V = normalize(vViewPosition);
          float ndv = max(dot(normal, V), 0.0);
          float ndl = dot(normal, uKeyDir);
          float wrap = max(0.0, (ndl + 0.45) / 1.45) - max(0.0, ndl);
          outgoingLight += uSss * wrap * 0.55 * (1.0 - 0.6 * fatW) * uSssAmt;
          outgoingLight += uRim * pow(1.0 - ndv, 3.0) * 0.25 * uSssAmt;
          float edge = pow(1.0 - ndv, 2.0);
          outgoingLight += uHiColor * (0.05 + 0.5 * edge) * uHi * (0.85 + 0.15 * sin(uTime * 3.0));
          outgoingLight += uHiColor * 0.3 * edge * uHover;
          outgoingLight *= mix(1.0, 0.42, uDim);
          outgoingLight += uBase * uGlow * (0.18 + 0.7 * uAtriaGloss);
          outgoingLight *= uFade;
        }
        #include <opaque_fragment>`);
  };
  return m;
}
