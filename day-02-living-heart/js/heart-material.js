// The wet heart material: clearcoat physical material patched for the beat, subsurface glow, rim and tissue detail.

import * as THREE from 'three';

const DEFORM = /* glsl */`
attribute vec4 aHeart;      // h (apex 0 .. AV plane 1), ventricle weight, atrium weight, vessel weight
attribute vec3 aPivot;      // atrium centre, or the nearest point on a great vessel's axis
attribute float aFat;
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uLen, uVent, uTwist, uAtria, uSwell, uAmp;
varying vec3 vRest;
varying vec3 vW;            // ventricle, atrium, fat

vec3 rotAxis(vec3 v, vec3 k, float a) {
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}

vec3 deform(vec3 p) {
  vec3 rel = p - uApex;
  float along = dot(rel, uAxis);
  vec3 radial = rel - uAxis * along;
  float h = clamp(aHeart.x, 0.0, 1.0);
  float vent = uVent * uAmp;
  // Ventricles squeeze 7% toward the long axis, the base descends 9% toward a near-still apex, and twist.
  radial *= 1.0 - 0.07 * vent;
  radial = rotAxis(radial, uAxis, uTwist * uAmp * radians(mix(10.0, -4.0, h)));
  vec3 pv = uApex + uAxis * (along - (0.015 + 0.075 * h) * vent * uLen) + radial;
  // Atria lose about 10% of their volume in atrial systole and balloon about 6% while the ventricles squeeze.
  float sA = 1.0 - 0.035 * uAtria * uAmp + 0.02 * vent;
  vec3 pa = aPivot + (p - aPivot) * sA - uAxis * (0.045 * vent * uLen);
  // The aorta and pulmonary trunk swell 2% with ejection.
  vec3 ps = aPivot + (p - aPivot) * (1.0 + 0.02 * uSwell * uAmp);
  return p + aHeart.y * (pv - p) + aHeart.z * (pa - p) + aHeart.w * (ps - p);
}
`;

const NOISE = /* glsl */`
uniform float uEject, uAtriaGloss;
varying vec3 vRest;
varying vec3 vW;

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

export function createHeartMaterial({ maps, procedural, apex, axis, len }) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: procedural,
    roughness: procedural ? 0.42 : 0.75,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07,
    ior: 1.4,
    specularIntensity: 0.6,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xff6b5e),
    sheenRoughness: 0.45,
    envMapIntensity: 0.35,
  });
  if (maps) {
    if (maps.map) m.map = maps.map;
    if (maps.normalMap) { m.normalMap = maps.normalMap; if (maps.normalScale) m.normalScale.copy(maps.normalScale); }
    if (maps.roughnessMap) m.roughnessMap = maps.roughnessMap;
  }
  const uniforms = {
    uApex: { value: apex.clone() }, uAxis: { value: axis.clone() }, uLen: { value: len },
    uVent: { value: 0 }, uTwist: { value: 0 }, uAtria: { value: 0 }, uSwell: { value: 0 }, uAmp: { value: 1 },
    uEject: { value: 0 }, uAtriaGloss: { value: 0 }, uFade: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0, 0, 1) }, uNormalMat: { value: new THREE.Matrix3() },
    uSss: { value: new THREE.Color(0x8a0d16) }, uRim: { value: new THREE.Color(0xc4242c) },
    uFatColor: { value: new THREE.Color(0xd8b089).multiply(new THREE.Color(0.85, 0.78, 0.6)) },   // #d8b089, a little deeper and yellower
  };
  m.userData.uniforms = uniforms;
  if (procedural) m.defines = { PROCEDURAL: '' };

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
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
        vW = vec3(aHeart.y, aHeart.z, aFat);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = dPos;');

    shader.fragmentShader = NOISE + /* glsl */`
      uniform vec3 uKeyDir, uSss, uRim, uFatColor;
      uniform float uFade;
      uniform mat3 uNormalMat;
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float fatW = 0.0;
        #ifdef PROCEDURAL
          float tone = noised(vRest * 9.0).x * 0.5 + noised(vRest * 23.0).x * 0.25;
          diffuseColor.rgb *= 1.0 + 0.12 * tone;
          // Epicardial fat: the smooth groove field broken into irregular, lobulated patches.
          float fatN = noised(vRest * 9.0 + 3.1).x * 0.55 + noised(vRest * 19.0).x * 0.3 + noised(vRest * 41.0).x * 0.15;
          fatW = smoothstep(0.4, 0.47, vW.z + 0.42 * fatN);
          vec4 lob = lobules(vRest * 26.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFatColor * (0.78 + 0.3 * lob.x), fatW);
        #endif
        // Stretched muscle with the blood squeezed out reads darker and glossier.
        float squeeze = vW.x * uEject + vW.y * uAtriaGloss;
        diffuseColor.rgb *= 1.0 - 0.06 * squeeze;`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        #ifdef PROCEDURAL
          roughnessFactor = mix(0.42, 0.5, fatW) * (1.0 + 0.15 * noised(vRest * 31.0).x);
        #endif
        roughnessFactor *= 1.0 - 0.08 * squeeze;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        #ifdef PROCEDURAL
        {
          // Bump from analytic gradients: fine muscle grain under the film, lobulated fat.
          vec3 grad = noised(vRest * 18.0).yzw * 0.0016 + noised(vRest * 47.0).yzw * 0.0006;
          vec4 lb = lobules(vRest * 26.0);
          grad = mix(grad, lb.yzw * 0.0045, fatW);
          vec3 gView = normalize(uNormalMat * grad) * length(grad) * 26.0;
          normal = normalize(normal - (gView - normal * dot(gView, normal)));
        }
        #endif`)
      .replace('#include <opaque_fragment>', /* glsl */`
        {
          // Light bleeding into the shadow side (wrap diffuse) and a red Fresnel rim.
          vec3 V = normalize(vViewPosition);
          float ndl = dot(normal, uKeyDir);
          float wrap = max(0.0, (ndl + 0.45) / 1.45) - max(0.0, ndl);
          outgoingLight += uSss * wrap * 0.55 * (1.0 - 0.6 * fatW);
          outgoingLight += uRim * pow(1.0 - max(dot(normal, V), 0.0), 3.0) * 0.25;
          outgoingLight *= uFade;
        }
        #include <opaque_fragment>`);
  };
  return m;
}
