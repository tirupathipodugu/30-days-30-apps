// Post-processing: half-resolution bloom (desktop only), tone mapping, then vignette, film grain and a chromatic fringe.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFringe: { value: 0.6 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uFringe;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uRes.x / uRes.y, 1.0));
      // Chromatic fringe: red and blue pulled apart by up to uFringe pixels at the corners.
      vec2 off = normalize(c + 1e-6) * uFringe * smoothstep(0.25, 0.9, r) / uRes;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - 0.35 * smoothstep(0.2, 1.0, r);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float grain = hash(vUv * uRes + fract(uTime * 7.31) * 113.0) - 0.5;
      col += grain * 0.035 * (0.35 + 0.65 * sqrt(lum));
      // The page colour, #050507, lives here: tone mapping would lift a near-black clear colour to grey.
      col += vec3(0.0196, 0.0196, 0.0275) * (1.0 - clamp(lum * 6.0, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { bloom, samples }) {
  // A multisampled half-float target keeps hairline threads smooth.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let bloomPass = null;
  if (bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 1.2);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  return {
    composer,
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      finish.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    removeBloom() {
      if (!bloomPass) return;
      composer.removePass(bloomPass);
      bloomPass.dispose();
      bloomPass = null;
    },
    render(time) {
      finish.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
