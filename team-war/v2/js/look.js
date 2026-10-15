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
import { ARENA } from './config.js?v=1015.3030';

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
          // ink edges only — colour grade + vignette now happen in GradePass after tone mapping
          vec3 ink = col.rgb * vec3(0.16, 0.13, 0.17);
          vec3 o2 = mix(col.rgb, ink, edge * strength);
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

// Colour grade + vignette (+ optional film grain), run AFTER tone mapping on the display-referred image.
// One warm, filmic grade unifies the fire/water palette into a single world: gentle contrast, a warm/cool
// split-tone (warm highlights, cool shadows), a touch of saturation, and a soft vignette to focus the centre.
class GradePass extends ShaderPass {
  constructor(opts = {}) {
    super({
      uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, aspect: { value: 1.6 },
        contrast: { value: 1.1 }, saturation: { value: 1.14 }, warmth: { value: 0.3 },
        lift: { value: 0.012 }, vignette: { value: 0.28 }, grain: { value: 0.0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uTime, aspect, contrast, saturation, warmth, lift, vignette, grain;
        varying vec2 vUv;
        void main() {
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          // filmic S-curve contrast about mid-grey, then lift the deepest shadows a hair so darks aren't crushed
          col = (col - 0.5) * contrast + 0.5;
          col += lift * (1.0 - smoothstep(0.0, 0.5, col));
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          // split-tone: warm (amber) highlights, cool (teal) shadows — the classic "one world" cinema grade
          col = mix(col, col * vec3(1.055, 1.005, 0.93), smoothstep(0.45, 1.0, l) * warmth);
          col = mix(col, col * vec3(0.95, 1.0, 1.06), smoothstep(0.5, 0.0, l) * 0.55 * warmth);
          // overall warm bias + saturation
          col += vec3(0.018, 0.006, -0.012) * warmth;
          col = mix(vec3(l), col, saturation);
          // soft vignette to focus the arena
          vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
          float vig = smoothstep(0.98, 0.34, length(q));
          col *= mix(1.0, vig, vignette);
          // very subtle animated grain (high tier only) — hides banding, adds a filmic texture
          if (grain > 0.0) {
            float n = fract(sin(dot(vUv * (uTime * 60.0 + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
            col += n * grain;
          }
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    this.grainOn = !!opts.grain;
    this.uniforms.grain.value = opts.grain ? 0.022 : 0.0;
  }
  setSize(w, h) { this.uniforms.aspect.value = w / h; }
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

// grade (warm filmic LUT-style grade + vignette) and fog are cheap, so they run on EVERY tier. Bloom, the
// ink outline, FXAA, film grain and high-res shadows are gated up. Low still gets one cheap grade pass.
export const TIERS = {
  high: { grade: true, grain: true, outline: true, bloom: true, fxaa: true, shadow: 2048, soft: true, pr: 2, detail: 1 },
  medium: { grade: true, grain: false, outline: true, bloom: true, fxaa: false, shadow: 1536, soft: true, pr: 1.5, detail: 0.7 },
  low: { grade: true, grain: false, outline: false, bloom: false, fxaa: false, shadow: 1024, soft: false, pr: 1.25, detail: 0.45 },
};

export function createLook(renderer, scene, camera, lowEnd) {
  let tierName = lowEnd ? 'low' : 'high';
  try { const q = new URLSearchParams(location.search).get('q'); if (TIERS[q]) tierName = q; } catch (e) { /* ignore */ }
  let tier = TIERS[tierName];

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // count every pass of a frame together
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = tier.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

  scene.background = new THREE.Color(SKY_HORIZON);
  // FogExp2 matched to the horizon colour: kept light so the arena stays crisp and only the far
  // background (volcanoes, ocean, diorama edges) melts into the sky — depth & mood without hazing the subject.
  scene.fog = new THREE.FogExp2(HAZE, 0.003);
  scene.add(skyDome());

  // environment map for speculars on water, metal and gems (kept dim so it fills, not washes)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.2;
  pmrem.dispose();

  // Artist lighting: one warm directional KEY (the sun, shadow caster), a dim cool hemisphere/dir FILL
  // (~4:1 key:fill so forms read 3D, not flat), and a cool RIM/back light so units separate from the ground.
  const hemi = new THREE.HemisphereLight(0xBBD6FF, 0x4A3A2E, 0.5);
  const sun = new THREE.DirectionalLight(0xFFCF9E, 3.9);
  sun.position.set(34, 40, 30); sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadow, tier.shadow);
  // tightened frustum (hugs the arena + bases) so shadow texels aren't wasted on empty sky
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 44, bottom: -44, near: 12, far: 125 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.045; sun.shadow.radius = 3.2;
  const fill = new THREE.DirectionalLight(0x8FB4FF, 0.32); fill.position.set(-30, 18, -26);
  // rim / back light opposite the key: a cool edge that lifts silhouettes off the background
  const rim = new THREE.DirectionalLight(0xDDEBFF, 1.15); rim.position.set(-22, 26, -40); rim.target.position.set(0, 2, 0);
  scene.add(hemi, sun, sun.target, fill, rim, rim.target);

  // post
  let composer = null, outline = null, bloom = null, fxaa = null, grade = null;
  const size = new THREE.Vector2();
  function buildComposer() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
    outline = bloom = fxaa = grade = null;
    renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    if (tier.outline) { // the ink pass reads scene depth; only allocate a depth buffer when it's on
      rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
      rt.depthTexture.type = THREE.UnsignedIntType;
    }
    composer = new EffectComposer(renderer, rt);
    if (tier.outline) {
      // a cloned depth texture shares its GPU source with the original; give the second buffer its own
      composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
      composer.renderTarget2.depthTexture.type = THREE.UnsignedIntType;
    }
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    if (tier.outline) { outline = new OutlinePass(camera); composer.addPass(outline); }
    if (tier.bloom) {
      // selective bloom: high threshold so only emissive / out-of-range things (lava, visors, FX) glow,
      // and a gentle strength so the frame stays clean rather than hazed.
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.26, 0.62, 1.9);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass()); // tone map + sRGB
    if (tier.grade) { grade = new GradePass({ grain: tier.grain }); composer.addPass(grade); } // warm filmic grade + vignette
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
    buildComposer();
    cool = 4;
  }

  return {
    sun, hemi, fill, rim,
    get tier() { return tierName; }, get detail() { return tier.detail; }, get maxPR() { return tier.pr; },
    setTier, adapt, resize,
    // exponential haze scaled to the camera distance: the arena stays clear while the diorama edges and
    // the far volcanoes / ocean melt into the sky colour (hides pop-in, adds depth & mood).
    fitFog() { const d = camera.position.length() || 80; scene.fog.density = Math.min(0.01, Math.max(0.0016, 0.17 / d)); },
    render() {
      renderer.info.reset();
      if (grade && grade.grainOn) grade.uniforms.uTime.value = performance.now() * 0.001;
      if (composer) composer.render(); else renderer.render(scene, camera);
    },
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
