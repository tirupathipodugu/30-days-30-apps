// The look: lighting, sky, tone mapping, post-processing (ink outlines + bloom + FXAA), quality tiers,
// and the fixed camera framing. Nothing in here moves the camera during play.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from '../vendor/three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from '../vendor/three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';
import { ARENA } from './config.js';

export const SKY_TOP = 0x5FA8E0, SKY_HORIZON = 0xF6E3C4, HAZE = 0xE9DCC6;

// Ink outline: darkens pixels where the depth jumps by more than ~half a world unit, so characters,
// props and buildings get a hand-drawn edge while the ground and grass stay clean.
class OutlinePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      near: { value: camera.near }, far: { value: camera.far }, thick: { value: 1 }, strength: { value: 0.78 }, aspect: { value: 1.6 },
    };
    this.fsQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tDepth; uniform vec2 texel; uniform float near, far, thick, strength, aspect;
        varying vec2 vUv;
        float lin(vec2 uv) { float d = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * near * far / (far + near - d * (far - near)); }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float c = lin(vUv);
          vec2 o = texel * thick;
          float a = lin(vUv + vec2(o.x, 0.0)), b = lin(vUv - vec2(o.x, 0.0)), e = lin(vUv + vec2(0.0, o.y)), f = lin(vUv - vec2(0.0, o.y));
          // only the nearer side of a depth jump gets the line, so lines hug the object, not the ground behind it
          float d = max(max(a - c, b - c), max(e - c, f - c));
          float k = clamp(c / 60.0, 0.6, 1.6);
          float edge = smoothstep(0.45 * k, 0.95 * k, d) * (1.0 - smoothstep(far * 0.55, far * 0.8, c));
          vec3 ink = col.rgb * vec3(0.16, 0.13, 0.17);
          vec3 o2 = mix(col.rgb, ink, edge * strength);
          // grade: a little extra saturation and a soft warm vignette, like a film frame
          float l = dot(o2, vec3(0.2126, 0.7152, 0.0722));
          o2 = mix(vec3(l), o2, 1.12);
          vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
          float vig = smoothstep(1.05, 0.35, length(q));
          o2 *= mix(vec3(0.62, 0.58, 0.66), vec3(1.0), vig);
          gl_FragColor = vec4(o2, col.a);
        }`,
    }));
  }
  setSize(w, h) { this.uniforms.texel.value.set(1 / w, 1 / h); this.uniforms.thick.value = h > 1300 ? 2 : 1; this.uniforms.aspect.value = w / h; }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.near.value = this.camera.near; this.uniforms.far.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(SKY_TOP) }, hor: { value: new THREE.Color(SKY_HORIZON) }, bot: { value: new THREE.Color(HAZE) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hor, bot; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, top, pow(smoothstep(0.0, 0.7, h), 0.8)) : mix(hor, bot, smoothstep(0.0, -0.25, h));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 12), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

export const TIERS = {
  high: { post: true, outline: true, bloom: true, fxaa: true, shadow: 2048, soft: true, pr: 2, detail: 1 },
  medium: { post: true, outline: true, bloom: true, fxaa: false, shadow: 1536, soft: true, pr: 1.5, detail: 0.7 },
  low: { post: false, outline: false, bloom: false, fxaa: false, shadow: 1024, soft: false, pr: 1.25, detail: 0.45 },
};

export function createLook(renderer, scene, camera, lowEnd) {
  let tierName = lowEnd ? 'low' : 'high';
  try { const q = new URLSearchParams(location.search).get('q'); if (TIERS[q]) tierName = q; } catch (e) { /* ignore */ }
  let tier = TIERS[tierName];

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // count every pass of a frame together
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = tier.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(HAZE, 95, 190);
  scene.add(skyDome());

  // environment map for speculars on water, metal and gems
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  // lights: warm low sun (long soft shadows), cool sky fill, hemisphere bounce
  const hemi = new THREE.HemisphereLight(0xC9E2FF, 0x6E5A3E, 1.25);
  const sun = new THREE.DirectionalLight(0xFFD6A3, 3.4);
  sun.position.set(34, 36, 30); sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadow, tier.shadow);
  Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 50, bottom: -50, near: 10, far: 120 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0x9CC2FF, 0.9); fill.position.set(-30, 18, -26);
  scene.add(hemi, sun, sun.target, fill);

  // post
  let composer = null, outline = null, bloom = null, fxaa = null;
  const size = new THREE.Vector2();
  function buildComposer() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
    if (!tier.post) return;
    renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    composer = new EffectComposer(renderer, rt);
    // a cloned depth texture shares its GPU source with the original; give the second buffer its own
    composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    composer.renderTarget2.depthTexture.type = THREE.UnsignedIntType;
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    if (tier.outline) { outline = new OutlinePass(camera); composer.addPass(outline); }
    if (tier.bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.45, 1.25);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
    if (tier.fxaa) { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
    resize();
  }
  function resize() {
    if (!composer) return;
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    if (fxaa) { const pr = renderer.getPixelRatio(); fxaa.material.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr)); }
  }
  buildComposer();

  // adaptive tier: if real frames stay slow, step down once per few seconds
  let slowAcc = 0, slowN = 0, cool = 0;
  function adapt(rdt, playing) {
    cool -= rdt;
    if (!playing || cool > 0) return;
    slowAcc += rdt; slowN++;
    if (slowAcc > 3) {
      const avg = slowAcc / slowN; slowAcc = 0; slowN = 0;
      if (avg > 1 / 38 && tierName !== 'low') setTier(tierName === 'high' ? 'medium' : 'low');
    }
  }
  function setTier(name) {
    if (!TIERS[name]) return;
    tierName = name; tier = TIERS[name];
    renderer.shadowMap.type = tier.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(tier.shadow, tier.shadow);
    outline = bloom = fxaa = null;
    buildComposer();
    cool = 4;
  }

  return {
    sun, hemi, fill,
    get tier() { return tierName; }, get detail() { return tier.detail; }, get maxPR() { return tier.pr; },
    setTier, adapt, resize,
    // haze starts just past the arena so the diorama edges melt into the sky colour
    fitFog() { const d = camera.position.length(); scene.fog.near = d * 1.2; scene.fog.far = d * 2.6; },
    render() { renderer.info.reset(); if (composer) composer.render(); else renderer.render(scene, camera); },
  };
}

// ---------------- FIXED CAMERA ----------------
// One still framing per team and screen shape. Landscape: a side-on diorama view with your base on the
// left and theirs on the right. Portrait: from behind your base looking down the field. Never moves in play.
const _v = new THREE.Vector3(), _t = new THREE.Vector3();
function framePoints() {
  const W = ARENA.halfW, L = ARENA.halfL, B = ARENA.baseZ;
  return [
    [-W, 0, -L], [W, 0, -L], [-W, 0, L], [W, 0, L],
    [-W, 0, 0], [W, 0, 0],
    [-4.5, 0, B + 6.5], [4.5, 0, B + 6.5], [-4.5, 0, -B - 6], [4.5, 0, -B - 6],
    [0, 9.5, B], [0, 10.5, -B], [-3, 7, B], [3, 7, -B],
  ];
}
const PTS = framePoints();
// margins in NDC: [left, right, bottom, top] (top leaves room for the HUD, bottom for the ability bar)
export function fixedCamera(camera, team, w, h) {
  const aspect = w / h;
  const portrait = aspect < 0.95;
  const side = team === 'ai' ? -1 : 1;
  let yaw, elev, fov, m;
  if (portrait) { yaw = team === 'ai' ? Math.PI : 0; elev = 1.12; fov = 40; m = [0.03, 0.03, 0.2, 0.42]; }
  else { yaw = side * Math.PI / 2; elev = 0.86; fov = aspect > 2 ? 30 : 34; m = [0.035, 0.035, 0.12, 0.24]; }
  camera.fov = fov; camera.aspect = aspect; camera.near = 2; camera.far = 420;
  const dir = _v.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
  const target = _t.set(0, 0, 0);
  const box = () => {
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (const p of PTS) {
      const q = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    return { x0, x1, y0, y1 };
  };
  const place = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  };
  let d = 80;
  // ground-plane screen-up direction, used to slide the target so the arena sits in the safe area
  const upG = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightG = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (let it = 0; it < 4; it++) {
    let lo = 20, hi = 300;
    for (let k = 0; k < 26; k++) {
      const mid = (lo + hi) / 2; place(mid);
      const b = box();
      const fits = b.x0 >= -1 + m[0] && b.x1 <= 1 - m[1] && b.y0 >= -1 + m[2] && b.y1 <= 1 - m[3];
      if (fits) hi = mid; else lo = mid;
    }
    d = hi; place(d);
    const b = box();
    const cy = (b.y0 + b.y1) / 2, wantY = ((-1 + m[2]) + (1 - m[3])) / 2;
    const cx = (b.x0 + b.x1) / 2, wantX = ((-1 + m[0]) + (1 - m[1])) / 2;
    const th = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * d;
    target.addScaledVector(upG, (cy - wantY) * th / Math.sin(elev));
    target.addScaledVector(rightG, (cx - wantX) * th * aspect);
  }
  place(d);
  return { yaw, portrait };
}
