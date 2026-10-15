// FIRE vs WATER arena (internal team keys stay 'human' = Fire at +z, 'ai' = Water at -z).
// The play surface is a clean translucent GLASS island floating in a large expanse of realistic moving WATER,
// with a glowing VOLCANIC LAVA layer beneath the water. The lava level + heat track who's winning (fire base
// healthier -> lava rises and glows hotter; water ahead -> it sinks and dims), read live from the two bases'
// HP in update().
//
// WATER (makeWater) is a custom surface shader inspired by Evan Wallace's classic WebGL Water / the jeantimex
// three.js port (jeantimex.github.io/threejs-water) and the Anderson Mancini "Realistic Water" demo. From our
// fixed grazing camera a true planar-mirror ocean (three.js Water.js, still vendored) reflects only the warm sky
// and read as a flat sheet, so instead the surface does, per-pixel: animated Gerstner-ish swell + analytic
// ripple normals; REAL REFRACTION of what's below — the view ray is bent through the surface (Snell/refract())
// and marched down to the lava plane, so the molten crust/sea floor is sampled DISTORTED by the waves, not flat-
// tinted; animated CAUSTICS (the signature light web of that demo, a procedural caustic function evaluated at the
// refracted floor point and also laid onto the lava crust itself); a cool fresnel SKY reflection so the sea reads
// blue when cold; sun glints; foam; and distance fog. Honest limits below in makeWater.
//
// SCENE FIRE (makeFireTex / fireMaterial / FlameBillboard) adapts the THREE.Fire volumetric-flame technique
// (github.com/typeWolffo/THREE.Fire — ray-marched simplex-noise flames) into a cheaper CAMERA-BILLBOARDED,
// noise-scrolled procedural flame shader (no texture file: the flame mask is procedural so assets ship inline).
// The volcano craters, the fortress fire-gouts and the fire-side lava get real rising, flickering flames instead
// of flat emissive cones. Honest limit: it is a billboarded 2.5D flame, not a true 3D ray-marched volume.
//
// An obsidian fortress (+z) and a coral/ice citadel (-z) keep the Fire-vs-Water sides readable from the fixed camera.
import * as THREE from 'three';
// three.js Water.js stays vendored at vendor/three/addons/objects/Water.js (see the note above on why the
// sea is a custom refractive wave shader instead of the planar-reflection ocean under this fixed warm-sky camera).
import { toon, glowMat, additive, GEO, Baker, M4, TIME, GLOW, contactShadowMat, SHADOW_PLANE } from './gfx.js?v=1015.3030';
import { ARENA } from './config.js?v=1015.3030';
import { mulberry32 } from './sim.js?v=1015.3030';

const W = ARENA.halfW, Lh = ARENA.halfL, BZ = ARENA.baseZ;
// The glass PLAY PLATFORM hugs the play area (units move within x±W, z±Lh); its TOP surface stays at world
// y = 0 — the same plane entities.js renders units on. Water + lava live BELOW it (never move the play plane).
// The glass footprint is really pinned by the fixed play area (units move within x±W, z±Lh = ±17 x ±34, owned by
// ARENA in config.js) AND the arena walls that ring it at ±(W+0.45): the glass must stay under the walls or they
// float over water. So we trim it to the tightest that still covers the walls (edge ~0.05 inside the wall line,
// down from the old 0.5 border) and deliver the "smaller island" the founder asked for by pulling the sea and
// volcanoes in much closer (see the volcano/iceberg placement) so the island reads small and the sea dominates.
const GLASS_W = 2 * W + 0.8, GLASS_L = 2 * Lh + 0.8;     // 34.8 x 68.8 — edge right at the walls (was 35 x 69)
const GLASS_TOP = 0, GLASS_THICK = 0.5;                  // slab top at y=0, a little visible thickness below
const WATER_Y = -0.35;                                   // floor removed: the sea surface sits right at the play plane
const LAVA_MID = -4.7, LAVA_AMP = 2.7;                   // lava rests mid-deep; rises toward the surface (fire ahead) / sinks (water ahead)

// palettes — focused 5-ish colours per side with one mood anchor (fire = warm amber, water = cool teal) and
// a real value range (clear darks + a few brights), not muddy equal mid-tones.
const FIRE = { rock: 0x33231F, rockD: 0x1C1416, rockL: 0x4A342C, obsid: 0x281C26, lava: 0xFF5A14, lavaHot: 0xFFC040, ember: 0xFF7A2A, scorch: 0x140D0C };
// water pulled down from near-white into readable teal mid-tones so forms read and the half stops looking washed out
const WATER = { ice: 0x8FC8E6, iceD: 0x568FB2, deep: 0x0C3C5C, surf: 0x1C7FB0, foam: 0xCDEBF5, coral: 0x27B4CC, crystal: 0x8FE8F2 };

// ---------------- shared GLSL: value-noise fbm + a procedural caustic web ----------------
// Reused by the water surface (refracted-floor caustics), the lava crust (caustics on the sea floor) and the
// flame billboards (turbulence), so the molten floor the water refracts matches the real lava plane below it.
const NOISE_GLSL = `
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ return vnoise(p)*0.6 + vnoise(p*2.1 + 7.0)*0.3 + vnoise(p*4.3 - 3.0)*0.1; }`;
// The classic Shadertoy caustic (Dave Hoskins / "caustic" family): a few cheap domain-warp iterations whose
// focused ridges read exactly like refracted sunlight dancing on a pool floor. iter gates cost (3 hi / 2 lo).
const CAUSTIC_GLSL = `
  float caustic(vec2 uv, float t){
    // Pass a small SCALED coordinate (world * ~0.08); *TAU + mod wraps it into the classic tiling domain so the
    // focused ridges read as refracted sunlight. The 5-iteration count + 1.17/1.4/pow(8) constants are tuned
    // together (fewer iterations mis-normalise and flood the surface white), so this loop is a fixed 5.
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p; float c = 1.0; float inten = 0.005;
    for(int n=0; n<5; n++){
      float tt = t * 0.4 * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 5.0; c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.0);
  }`;

// ---------------- the realistic moving water expanse ----------------
// APPROACH (see the file header): three.js Water.js (the planar-reflection ocean) is vendored under
// vendor/three/addons/objects/Water.js, but from this fixed grazing camera its surface mirrors the warm sky
// almost completely and read as a flat sheet. So the sea is a custom refractive wave shader we fully control.
// WHAT'S REAL: the surface animates (swell + analytic ripple normals); it REFRACTS the floor for real (the view
// ray is bent through the surface with refract() and marched to the lava plane, so the molten crust is sampled
// warped by the waves and gets deeper/bluer the farther down it is); animated CAUSTICS are laced onto that
// refracted floor; the fresnel SKY reflection is cool so the sea reads blue when cold. WHAT'S FAKED: the floor
// it refracts is the lava evaluated procedurally in-shader (not a render-target of the real scene), the sky
// reflection is an analytic gradient (not a mirror of the geometry), and caustics are a procedural function
// (not Evan Wallace's differential-area light-focusing pass). uQ (quality) gates the costly refraction march +
// 3-iteration caustics to desktop/high|medium; low/phone falls back to the cheaper flat-tinted body + 2-iter.
const SEA = 620; // big enough to run past the horizon fog from the fixed camera
function makeWater(detail, sunDir) {
  const seg = Math.max(64, Math.round(190 * detail));
  const hi = detail >= 0.6 ? 1 : 0; // high/medium get real refraction + full caustics; low = simpler fallback
  const geo = new THREE.PlaneGeometry(SEA, SEA, seg, seg).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: TIME, uSun: { value: sunDir.clone() }, uHeat: { value: 0.5 },
      uLavaY: { value: LAVA_MID }, // live lava-plane depth, so refraction marches to where the lava actually is
      uQ: { value: hi },
      uHorizon: { value: new THREE.Color(0xE9DCC6) }, // matches look.js HAZE so the far sea melts into the sky
    },
    vertexShader: `uniform float uTime; varying vec3 vW;
      // big swell only, for the moving silhouette (fine ripples are done per-pixel in the fragment)
      float swell(vec2 p){
        return sin(p.x * 0.12 + uTime * 0.8) * 0.42
             + sin(dot(p, vec2(0.30, 0.95)) * 0.16 + uTime * 0.7) * 0.30
             + sin(dot(p, vec2(-0.6, 0.8)) * 0.27 + uTime * 1.05) * 0.16;
      }
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += swell(w.xz);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform float uTime, uHeat, uLavaY, uQ; uniform vec3 uSun, uHorizon; varying vec3 vW;
      ${NOISE_GLSL}
      ${CAUSTIC_GLSL}
      // The MOLTEN GLOW of the lava floor at a refracted floor point (the dark basalt baseline is left out here —
      // the blue water body already fills that role, so this is only the orange light that rises UP through the
      // water, matching the real lava plane's seams and brightening as Fire pulls ahead).
      vec3 moltenGlow(vec2 fp){
        vec2 q = fp * 0.09; float flow = uTime * 0.05;
        float f = fbm(q + vec2(0.0, flow)) * 0.6 + fbm(q * 2.3 - vec2(flow * 0.7, 0.0)) * 0.4;
        float vein = smoothstep(0.46, 0.40, abs(f - 0.5)); // TIGHT molten seams only (a broad glow greys out the blue)
        float hot = smoothstep(0.46, 1.0, uHeat);          // seams stay dark until Fire actually pulls PAST neutral
        float pulse = 0.7 + 0.3 * sin(uTime * 1.6 + f * 22.0);
        vec3 molten = mix(vec3(1.4, 0.35, 0.05), vec3(2.8, 1.2, 0.3), uHeat);
        return molten * vein * pulse * hot * (0.55 + pow(vein, 3.0));
      }
      // Animated CAUSTIC web (cool refracted-sunlight light). Squared so only the focused ridges read as crisp bright
      // lines on the dark blue water (a broad caustic glow marbles the surface cream under the scene's warm grade).
      vec3 causticCol(vec2 fp){
        float ca = caustic(fp * 0.08, uTime);
        ca = ca * ca * ca * 2.1;                    // cube it so the web is crisp bright lines, dark blue between
        return vec3(0.40, 0.64, 0.98) * ca;
      }
      // height field (swell + ripples) and its analytic gradient -> crisp normals independent of mesh density
      void waves(vec2 p, out float h, out vec2 grad){
        h = 0.0; grad = vec2(0.0);
        // d (direction), par = (freq, speed, amp)
        vec2 defs[5]; vec3 par[5];
        defs[0]=vec2( 1.0,  0.0); par[0]=vec3(0.12, 0.8, 0.42);
        defs[1]=vec2( 0.30, 0.95);par[1]=vec3(0.16, 0.7, 0.30);
        defs[2]=vec2(-0.60, 0.80);par[2]=vec3(0.27, 1.05,0.16);
        defs[3]=vec2( 0.90,-0.30);par[3]=vec3(0.52, 1.5, 0.08);
        defs[4]=vec2( 0.15, 1.00);par[4]=vec3(0.95, 2.1, 0.045);
        for(int i=0;i<5;i++){
          vec2 d = normalize(defs[i]); float wv=par[i].x, sp=par[i].y, a=par[i].z;
          float ph = dot(d,p)*wv + uTime*sp;
          h += sin(ph)*a;
          grad += d*(wv*a*cos(ph));
        }
      }
      void main(){
        float h; vec2 grad; waves(vW.xz, h, grad);
        vec3 N = normalize(vec3(-grad.x * 2.3, 1.0, -grad.y * 2.3));
        vec3 V = normalize(cameraPosition - vW);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        // SATURATED cool sky reflection (not near-white) so the blue survives the scene's warm grade & reads as water
        vec3 r = reflect(-V, N); float ry = clamp(r.y, 0.0, 1.0);
        vec3 skyRefl = mix(vec3(0.32, 0.55, 0.80), vec3(0.08, 0.30, 0.62), ry); // saturated horizon -> deep zenith blue
        // WATER BODY: a DEEP, saturated blue sea (absorption tint), darkest in the troughs rising to teal on wave
        // faces. Kept dark + very low red so it reads as BLUE water through the scene's warm filmic grade; the lava
        // glow and the bright caustic lines are added UP through it.
        vec3 body = mix(vec3(0.004, 0.045, 0.125), vec3(0.015, 0.21, 0.37), smoothstep(-0.5, 0.6, h));
        if (uQ > 0.5) {
          // REFRACTION: bend the view ray into the water (Snell, eta = air/water) and march it to the lava plane;
          // the wave normal warps where it lands, so the molten glow + caustics beneath wobble like real refraction.
          vec3 refr = refract(-V, N, 0.752);
          vec3 fp3 = (refr.y < -0.02) ? (vW + refr * ((uLavaY - vW.y) / refr.y)) : vW; // floor hit (or straight down)
          float depth = clamp((vW.y - uLavaY) * 0.05, 0.0, 1.0);                        // how much blue water is in front
          float through = (1.0 - 0.7 * depth);                                          // shallower lava shows through more
          body += moltenGlow(fp3.xz) * through;                                         // lava glows UP through the sea
          body += causticCol(fp3.xz) * (0.6 + 0.4 * through);                           // caustics on the refracted floor
        } else {
          // low/phone fallback: NO refraction march and NO 5-iteration caustic (both gated off for cost). The lava
          // glow still reads straight down, and a cheap 2-sine shimmer stands in for caustics so it still sparkles.
          body += moltenGlow(vW.xz) * 0.7;
          float shim = 0.5 + 0.5 * sin(vW.x * 0.6 + uTime) * sin(vW.z * 0.6 - uTime * 0.8);
          body += vec3(0.18, 0.26, 0.34) * shim * 0.4;
        }
        // reflection blended in moderately (not a full mirror) so the refraction + caustics stay visible through it
        vec3 col = mix(body, skyRefl, fres * 0.4 + 0.05);
        // sun glints that sparkle on the ripple crests
        vec3 Rs = reflect(-normalize(uSun), N);
        float spec = pow(max(dot(V, Rs), 0.0), 150.0);
        col += vec3(1.0, 0.95, 0.82) * spec * 2.2;
        // foam: on the highest crests + a soft ring hugging the glass island's footprint
        float crest = smoothstep(0.38, 0.64, h);
        float ex = abs(vW.x) - ${(GLASS_W / 2).toFixed(2)}, ez = abs(vW.z) - ${(GLASS_L / 2).toFixed(2)};
        float edge = max(ex, ez);
        float shore = smoothstep(1.8, 0.0, max(edge, 0.0)) * step(0.0, edge);
        float foam = clamp(crest * 0.55 + shore * (0.5 + 0.45 * sin(vW.x * 3.0 + vW.z * 3.0 - uTime * 2.0)), 0.0, 1.0);
        col = mix(col, vec3(0.92, 0.97, 1.0), foam * 0.8);
        // thin the water where the lava is hot so the molten glow rises through; opaque + blue when it's cold
        float alpha = clamp(mix(0.9, 0.72, uHeat) + fres * 0.08 + foam * 0.3, 0.5, 0.98);
        // distance haze: only the FAR horizon melts into the sky colour (pushed back so the play area stays clear blue)
        float fog = smoothstep(210.0, 470.0, length(cameraPosition - vW));
        col = mix(col, uHorizon, fog);
        // output LINEAR; the composer's OutputPass applies tone-map + sRGB once (adding the in-shader includes
        // here double-processed the colour and washed the sea out to cream, so they are deliberately omitted)
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.y = WATER_Y; m.renderOrder = 1;
  return { mesh: m, mat };
}

// ---------------- the volcanic lava layer beneath the water ----------------
// An emissive flowing-crust shader. position.y and uHeat are driven in update() by the fire/water advantage,
// so the lava visibly RISES + glows hotter when Fire is ahead and SINKS + dims when Water is ahead.
function makeLava(detail) {
  const hi = detail >= 0.6 ? 1 : 0; // caustics on the crust only on high/medium
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uHeat: { value: 0.5 }, uQ: { value: hi } },
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uHeat, uQ; varying vec2 vW;
      ${NOISE_GLSL}
      ${CAUSTIC_GLSL}
      void main(){
        vec2 q = vW * 0.09;
        float flow = uTime * 0.05;
        float f = fbm(q + vec2(0.0, flow)) * 0.6 + fbm(q * 2.3 - vec2(flow * 0.7, 0.0)) * 0.4;
        float vein = smoothstep(0.5, 0.38, abs(f - 0.5));            // molten seams between cooled crust
        float hot = smoothstep(0.32, 1.0, uHeat);                    // seams only really light up as Fire pulls ahead
        float pulse = 0.7 + 0.3 * sin(uTime * 1.6 + f * 22.0);
        // mostly DARK basalt crust (so the sea stays cool when neutral/Water-ahead), lit by orange seams
        vec3 crust = vec3(0.018, 0.008, 0.006) + vec3(0.05, 0.018, 0.012) * uHeat;
        vec3 molten = mix(vec3(1.3, 0.32, 0.05), vec3(2.3, 1.05, 0.28), uHeat);
        vec3 col = crust + molten * (vein * (0.18 + 0.82 * hot) * pulse);
        col += molten * pow(vein, 3.0) * hot * 0.6;                  // white-hot cores for the bloom to grab
        // CAUSTICS on the sea floor itself: faint caustic light where the water is thin/cool, so the floor seen
        // directly (beyond the water edge, or through thin water) carries the same dancing web as the refracted view.
        if (uQ > 0.5) {
          float ca = caustic(vW * 0.08, uTime);
          col += vec3(0.45, 0.55, 0.7) * ca * (0.35 + 0.4 * (1.0 - hot));
        }
        // output LINEAR; the composer's OutputPass does tone-map + sRGB once (no in-shader includes = no double grade)
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SEA, SEA).rotateX(-Math.PI / 2), mat);
  m.position.y = LAVA_MID; m.renderOrder = -2;
  return { mesh: m, mat };
}

// ---------------- volumetric-style SCENE FIRE (THREE.Fire-inspired flame billboards) ----------------
// Adapts the THREE.Fire volumetric-flame look (ray-marched simplex-noise flames) into a cheaper, camera-facing
// flame BILLBOARD whose mask is a scrolled-noise procedural flame (no texture file — the flame is computed in the
// shader so assets ship inline). One shared material is used for every flame; each flame's world position seeds
// its noise so they all flicker independently. Additive + emissive so the bloom pass gives them a real glow.
// detail gates the extra turbulence octave (uQ) to high/medium; low still animates, just smoother/cheaper.
let _fireMat = null;
function fireMaterial(detail) {
  if (_fireMat) return _fireMat;
  const hi = detail >= 0.6 ? 1 : 0;
  _fireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uQ: { value: hi } },
    // billboard: the plane is sized in its geometry (bottom at y=0); we rebuild it in world space facing the
    // camera around the vertical axis so flames always face us and rise straight up (no per-frame JS needed).
    vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vBase;
      void main(){
        vUv = uv;
        vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vBase = base;
        vec3 look = cameraPosition - base; look.y = 0.0; look = normalize(look);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), look));
        vec3 wp = base + right * position.x + vec3(0.0, 1.0, 0.0) * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uTime, uQ; varying vec2 vUv; varying vec3 vBase;
      ${NOISE_GLSL}
      void main(){
        vec2 uv = vUv;
        float seed = dot(vBase.xz, vec2(0.17, 0.23));
        // scroll noise upward for rising flame turbulence; a second finer octave on hi tier
        float n = fbm(vec2(uv.x * 2.2, uv.y * 2.4 - uTime * 1.7) + seed);
        float n2 = uQ > 0.5 ? fbm(vec2(uv.x * 5.0 + 4.0, uv.y * 4.2 - uTime * 2.6) + seed) : 0.5;
        float warp = (n - 0.5) * 0.4 + (n2 - 0.5) * 0.2 * uQ;
        // flame body: distance from the (warped) centre line, tapering from a wide base to a point
        float cx = uv.x - 0.5 + warp;
        float width = mix(0.46, 0.05, uv.y);
        float body = smoothstep(width, width * 0.15, abs(cx));
        // vertical envelope: licks of flame whose tips flicker in height; fade in off the ground
        float top = 0.72 + 0.26 * n;
        float vprof = smoothstep(top, top - 0.55, uv.y) * smoothstep(0.0, 0.06, uv.y);
        float f = clamp(body * vprof * (0.6 + 0.7 * n), 0.0, 1.0);
        if (f < 0.015) discard;
        // colour ramp: deep red edge -> orange -> white-hot yellow core (values >1 so the bloom grabs the core)
        vec3 col = mix(vec3(0.75, 0.06, 0.015), vec3(1.7, 0.6, 0.08), smoothstep(0.08, 0.45, f));
        col = mix(col, vec3(2.6, 1.8, 0.75), smoothstep(0.5, 0.92, f));
        gl_FragColor = vec4(col * f, f);
      }`,
  });
  return _fireMat;
}
// A single flame billboard of width w / height h with its base pivot at (x,y,z). jitter gives a little lean.
function flame(x, y, z, w, h, mat) {
  const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.frustumCulled = false; m.renderOrder = 5;
  return m;
}

// ---------------- the clean glass play platform (units stand/move on its top face at y = 0) ----------------
// Mostly-clear so you read the water + lava below, with a bright fresnel sheen and a slim two-tone edge
// (fire on +z, water on -z) that frames the island and keeps the Fire/Water sides legible. Kept deliberately
// clean — no busy surface texture — so the game stays easy to read and ability FX on the glass pop.
function glassIsland(G) {
  // deliberately low-sheen so the sea + lava below read clearly through it: a faint cool tint with only a
  // light edge-on fresnel glint (a strong clearcoat mirror washed the blue water out to pale grey at the
  // grazing fixed camera). The glowing rim is what frames it as a solid glass platform.
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xcdeefb, metalness: 0.0, roughness: 0.2,
    transparent: true, opacity: 0.1,
    clearcoat: 0.35, clearcoatRoughness: 0.2, ior: 1.3, reflectivity: 0.12,
    envMapIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false,
  });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(GLASS_W, GLASS_THICK, GLASS_L), mat);
  slab.position.set(0, GLASS_TOP - GLASS_THICK / 2, 0);
  slab.receiveShadow = true; slab.renderOrder = 2;

  // slim glowing rim just above the top face: fire-orange on the +z half, water-cyan on the -z half.
  const y = GLASS_TOP + 0.03, hw = GLASS_W / 2, hl = GLASS_L / 2, t = 0.16;
  for (const sx of [-1, 1]) {
    G.add(GEO.box, FIRE.lava, M4(sx * hw, y, hl / 2, [t, 0.08, hl]), { boost: GLOW * 0.7 });     // +z long edge (fire)
    G.add(GEO.box, WATER.crystal, M4(sx * hw, y, -hl / 2, [t, 0.08, hl]), { boost: GLOW * 0.7 }); // -z long edge (water)
  }
  G.add(GEO.box, FIRE.lava, M4(0, y, hl, [GLASS_W, 0.08, t]), { boost: GLOW * 0.7 });              // +z end cap (fire)
  G.add(GEO.box, WATER.crystal, M4(0, y, -hl, [GLASS_W, 0.08, t]), { boost: GLOW * 0.7 });         // -z end cap (water)
  G.add(GEO.box, 0xEFF6FF, M4(0, y + 0.01, 0, [GLASS_W, 0.07, 0.18]), { boost: GLOW * 0.5 });      // bright neutral clash line
  return slab;
}

// The old solid basalt/seabed terrain is gone — the glass island now floats in open water, so the background
// set pieces (volcanoes, icebergs) rise straight out of the sea at the water line.
function terrainHeightApprox() { return WATER_Y; }

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
  // FIRE WARSHIP (naval redesign): a big wooden battleship at the +z end, broadside facing the battle (-z).
  const z0 = BZ + 0.6;
  const wood = 0x5A3A22, woodD = 0x331F12, trim = FIRE.obsid, dark = FIRE.rockD, sail = FIRE.lava, hot = FIRE.lavaHot;
  const st = { jitter: 0.05, cell: 0.4 };
  const HL = 24, HW = 6.6;                                 // hull length (x) and width (z)
  // hull body + darker keel + pointed bow & stern
  B.add(GEO.rbox, wood, M4(0, 1.5, z0, [HL, 3.0, HW]), st);
  B.add(GEO.rbox, woodD, M4(0, 0.6, z0, [HL + 0.6, 1.4, HW + 0.4]), st);
  for (const sx of [-1, 1]) B.add(GEO.wedge, wood, M4(sx * (HL / 2 + 1.0), 1.5, z0, [3.2, 2.8, HW], [0, sx > 0 ? 0 : Math.PI, 0]), st);
  // gunwale rails + deck planking
  for (const sz of [-1, 1]) B.add(GEO.box, trim, M4(0, 3.05, z0 + sz * HW / 2, [HL, 0.35, 0.35]));
  B.add(GEO.box, 0x6b5033, M4(0, 3.2, z0, [HL - 1.6, 0.3, HW - 1.0]));
  // raised stern castle (back of the ship)
  B.add(GEO.rbox, wood, M4(HL / 2 - 2.8, 4.5, z0, [4.2, 2.8, HW - 0.5]), st);
  B.add(GEO.rbox, woodD, M4(HL / 2 - 2.8, 6.1, z0, [3.6, 1.0, HW - 1.2]), st);
  // cannons poking out the battle side (-z)
  for (let i = -3; i <= 3; i++) B.add(GEO.barrel, dark, M4(i * 3, 2.5, z0 - HW / 2 - 0.3, [0.3, 0.3, 1.6], [Math.PI / 2, 0, 0]));
  // masts + glowing red sails + pennants
  for (const [mx, mh] of [[-6.5, 10], [0, 12.5], [6, 10]]) {
    B.add(GEO.cyl, woodD, M4(mx, 3.2 + mh / 2, z0, [0.32, mh, 0.32]));
    B.add(GEO.box, woodD, M4(mx, 3.2 + mh * 0.72, z0, [5.2, 0.2, 0.2]));
    G.add(GEO.box, sail, M4(mx, 3.2 + mh * 0.48, z0, [4.6, mh * 0.5, 0.12]), { boost: GLOW * 0.22 });
    G.add(GEO.box, hot, M4(mx + 0.6, 3.2 + mh + 0.5, z0, [1.2, 0.55, 0.05]), { boost: GLOW * 0.5 });
  }
  // glowing lava waterline trim (fire theme)
  for (const sz of [-1, 1]) G.add(GEO.box, sail, M4(0, 0.75, z0 + sz * (HW / 2 + 0.05), [HL, 0.14, 0.08]), { boost: GLOW * 0.55 });
  // lava braziers on deck = fire gout points
  const gouts = [];
  for (const gx of [-8, -1, 7]) { G.add(GEO.cyl, trim, M4(gx, 3.6, z0, [0.55, 0.9, 0.55]), { boost: GLOW * 0.4 }); gouts.push([gx, 4.2, z0]); }
  // turret: magma catapult amidships (drives the simulation — unchanged interface)
  const turret = new THREE.Group(); turret.position.set(0, 3.6, z0 - 1.0);
  const tb = new Baker(), tg = new Baker();
  tb.add(GEO.rbox, trim, M4(0, 0.25, 0, [0.6, 0.5, 1.6]), { jitter: 0.1 });
  tb.add(GEO.box, dark, M4(0, 0.45, 0.6, [2.2, 0.18, 0.18]));
  tg.add(GEO.sphereLo, hot, M4(0, 0.6, 0.95, 0.3), { boost: GLOW });
  const tm = new THREE.Mesh(tb.geometry(), toon(0xffffff, 0.2, { vertexColors: true })); tm.castShadow = true;
  turret.add(tm, new THREE.Mesh(tg.geometry(), glowMat(0xffffff, { vertexColors: true })));
  const cracks = crackMeshes(z0, true);
  void S;
  return { turret, gouts, cracks };
}

// ---------------- the coral/ice citadel (Water base, -z) ----------------
function buildCitadel(B, G, S) {
  // WATER WARSHIP (naval redesign): a big ice/crystal battleship at the -z end, broadside facing the battle (+z).
  const z0 = -BZ - 0.4;
  const hull = WATER.iceD, hullL = WATER.ice, trim = WATER.crystal, sail = 0x4FB8E6, deckC = 0x9FD3F5;
  const st = { jitter: 0.04, cell: 0.4 };
  const HL = 24, HW = 6.6;
  B.add(GEO.rbox, hull, M4(0, 1.5, z0, [HL, 3.0, HW]), st);
  S.add(GEO.rbox, hullL, M4(0, 1.7, z0, [HL - 1.0, 2.2, HW - 0.8]));
  B.add(GEO.rbox, hull, M4(0, 0.6, z0, [HL + 0.6, 1.4, HW + 0.4]), st);
  for (const sx of [-1, 1]) B.add(GEO.wedge, hull, M4(sx * (HL / 2 + 1.0), 1.5, z0, [3.2, 2.8, HW], [0, sx > 0 ? 0 : Math.PI, 0]), st);
  for (const sz of [-1, 1]) G.add(GEO.box, trim, M4(0, 3.05, z0 + sz * HW / 2, [HL, 0.14, 0.14]), { boost: GLOW * 0.7 });
  B.add(GEO.box, deckC, M4(0, 3.2, z0, [HL - 1.6, 0.3, HW - 1.0]));
  B.add(GEO.rbox, hull, M4(-(HL / 2 - 2.8), 4.5, z0, [4.2, 2.8, HW - 0.5]), st);
  S.add(GEO.rbox, hullL, M4(-(HL / 2 - 2.8), 6.1, z0, [3.6, 1.0, HW - 1.2]));
  for (let i = -3; i <= 3; i++) B.add(GEO.barrel, hull, M4(i * 3, 2.5, z0 + HW / 2 + 0.3, [0.3, 0.3, 1.6], [Math.PI / 2, 0, 0]));
  for (const [mx, mh] of [[-6, 10], [0, 12.5], [6.5, 10]]) {
    B.add(GEO.cyl, hull, M4(mx, 3.2 + mh / 2, z0, [0.32, mh, 0.32]));
    B.add(GEO.box, hull, M4(mx, 3.2 + mh * 0.72, z0, [5.2, 0.2, 0.2]));
    G.add(GEO.box, sail, M4(mx, 3.2 + mh * 0.48, z0, [4.6, mh * 0.5, 0.12]), { boost: GLOW * 0.2 });
    G.add(GEO.box, trim, M4(mx + 0.6, 3.2 + mh + 0.5, z0, [1.2, 0.55, 0.05]), { boost: GLOW * 0.5 });
  }
  for (const sz of [-1, 1]) G.add(GEO.box, trim, M4(0, 0.75, z0 + sz * (HW / 2 + 0.05), [HL, 0.14, 0.08]), { boost: GLOW * 0.5 });
  const falls = [], rings = [];
  // frozen figurehead orb at the bow (kept as `core` so scene.add stays compatible)
  const core = new THREE.Mesh(GEO.sphere, glowMat(0xCFF4FF)); core.position.set(-(HL / 2 + 1.2), 2.6, z0);
  const coreHalo = new THREE.Mesh(GEO.sphere, additive(WATER.crystal, 0.25, 1.5)); coreHalo.scale.setScalar(1.8); core.add(coreHalo);
  // turret: water cannon amidships (drives the simulation — unchanged interface)
  const turret = new THREE.Group(); turret.position.set(0, 3.6, z0 + 1.0);
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
function buildVolcano(B, G, x, z, fireMat) {
  const y = terrainHeightApprox(x);
  B.add(GEO.cone, FIRE.rockD, M4(x, y + 6, z, [16, 13, 16]), { jitter: 0.18, cell: 1.0 });
  B.add(GEO.cone, FIRE.obsid, M4(x, y + 11.5, z, [7, 4, 7]), { jitter: 0.15, cell: 0.6 });
  const crater = new THREE.Group(); crater.position.set(x, y + 13, z);
  const gb = new Baker();
  gb.add(GEO.cyl, FIRE.lavaHot, M4(0, 0, 0, [3.2, 0.6, 3.2]), { boost: GLOW });
  crater.add(new THREE.Mesh(gb.geometry(), glowMat(0xffffff, { vertexColors: true })));
  // lava running down a flank
  G.add(GEO.box, FIRE.lava, M4(x + 2, y + 6, z + 3, [0.6, 0.2, 10], [0.5, 0.3, 0]), { boost: GLOW * 0.7 });
  // REAL rising flames erupting from the crater (a tall core flame + two smaller licks at the rim)
  const flames = [
    flame(x, y + 12.8, z, 11, 15, fireMat),
    flame(x - 2.2, y + 12.9, z + 0.6, 5, 8, fireMat),
    flame(x + 2.4, y + 12.9, z - 0.5, 5.5, 9, fireMat),
  ];
  return { crater, flames };
}
function buildIceberg(B, G, x, z) {
  const y = WATER_Y - 0.6;
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
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vec3(0.86, 0.9, 0.95), a * vA * 0.15); }`,
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
  const B = new Baker(), G = new Baker(), S = new Baker();
  // sun direction must match look.js's key light (34, 40, 30) so the water's sun glints land believably.
  const sunDir = new THREE.Vector3(34, 40, 30).normalize();
  const lava = makeLava(detail);           // glowing volcanic layer at the bottom (+ caustics on high/medium)
  const water = makeWater(detail, sunDir); // realistic refractive moving sea above it
  // FLOOR REMOVED (naval redesign): no glass platform — units/ships sit on the open realistic sea. Rim not baked.
  scene.add(lava.mesh, water.mesh);
  const fireMat = fireMaterial(detail);    // shared volumetric-style flame material for all scene fire

  buildWalls(B, G, S);
  buildCover(B, G, S, cover);
  const fort = buildFortress(B, G, S);
  const citadel = buildCitadel(B, G, S);
  // Volcanoes + icebergs pulled IN closer than before so the glass island reads smaller and the sea + volcanoes
  // dominate the frame (the founder wanted a smaller-looking platform; the play bounds themselves are fixed).
  const v1 = buildVolcano(B, G, -31, 28, fireMat);
  const v2 = buildVolcano(B, G, 33, 48, fireMat);
  const volcano = v1.crater;
  buildIceberg(B, G, -29, -32);
  buildIceberg(B, G, 31, -44);

  const add = (baker, mat, shadow = true) => { if (baker.empty) return; const m = new THREE.Mesh(baker.geometry(), mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); };
  add(B, toon(0xffffff, 0.16, { vertexColors: true }));
  add(S, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92 }));
  add(G, glowMat(0xffffff, { vertexColors: true }), false);
  scene.add(volcano, v2.crater, ...citadel.falls, ...citadel.rings, citadel.core);
  for (const f of v1.flames) scene.add(f);
  for (const f of v2.flames) scene.add(f);
  for (const c of fort.cracks) scene.add(c);
  for (const c of citadel.cracks) scene.add(c);

  // contact shadows ground the big static set pieces (bases + cover) — one instanced mesh, so it's a single
  // draw call rather than one per piece, keeping us inside the draw-call budget.
  const staticShadows = [[0, BZ + 0.6, 26, 0.05], [0, -BZ - 0.4, 26, 0.05]];
  for (const c of cover) staticShadows.push([c.x, c.z, c.r * 3.4, 0.045]);
  const shMesh = new THREE.InstancedMesh(SHADOW_PLANE, contactShadowMat(0.8), staticShadows.length);
  shMesh.renderOrder = 1; shMesh.frustumCulled = false;
  const _sm = new THREE.Matrix4();
  staticShadows.forEach(([x, z, r, y], i) => { _sm.makeScale(r, 1, r); _sm.setPosition(x, y, z); shMesh.setMatrixAt(i, _sm); });
  shMesh.instanceMatrix.needsUpdate = true; scene.add(shMesh);

  // fire erupting from the fortress: real rising flame billboards at each tower top + the gate (THREE.Fire-style),
  // replacing the old flat additive cones. Their bases sit a touch below the gout point so the flame rises through it.
  for (const [x, y, z] of fort.gouts) scene.add(flame(x, y - 1.6, z, 3.4, 6.5, fireMat));
  // fire-side lava-surface flames: a ring of small flames licking up off the molten moat around the fortress base,
  // so the Fire side's lava reads as actually burning rather than just glowing.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, rr = 10.6;
    scene.add(flame(Math.cos(a) * rr, 0.4, (BZ + 0.6) + Math.sin(a) * rr * 0.85, 2.4 + (i % 3) * 0.5, 3.6 + (i % 2) * 1.2, fireMat));
  }
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

  let t = 0, lavaY = LAVA_MID, lavaHeat = 0.5;
  return {
    bases,
    update(dt, game, turretAims) {
      t += dt; TIME.value = t;
      // Lava level + heat track who's winning. fireAdvantage in [-1, 1]: +1 = Fire base much healthier
      // (lava RISES toward the surface and glows hot), -1 = Water ahead (lava SINKS and dims). Both full = neutral.
      let targetY = LAVA_MID, targetHeat = 0.5;
      if (game && game.bases) {
        const fb = game.bases.human, wb = game.bases.ai;
        const fFrac = fb ? fb.hp / (fb.max || 1) : 1, wFrac = wb ? wb.hp / (wb.max || 1) : 1;
        const fireAdvantage = Math.max(-1, Math.min(1, fFrac - wFrac));
        targetY = LAVA_MID + fireAdvantage * LAVA_AMP;
        targetHeat = Math.max(0, Math.min(1, 0.5 + fireAdvantage * 0.5));
      }
      const ease = Math.min(1, dt * 1.1);     // smooth, cinematic rise/fall — no popping
      lavaY += (targetY - lavaY) * ease; lavaHeat += (targetHeat - lavaHeat) * ease;
      lava.mesh.position.y = lavaY; lava.mat.uniforms.uHeat.value = lavaHeat;
      // feed the lava heat to the water so it thins (molten glow rises through) when Fire leads and stays a
      // bright opaque blue (hiding the cold dark lava) when Water leads. Waves + flames animate off shared TIME.
      water.mat.uniforms.uHeat.value = lavaHeat;
      water.mat.uniforms.uLavaY.value = lavaY; // refraction marches to where the lava plane actually sits now
      volcano.children[0] && (volcano.rotation.y = t * 0.1);
      // (the water warship has no spinning ice rings; guard so the frame never throws)
      if (citadel.rings[0]) { citadel.rings[0].rotation.x = Math.sin(t * 0.6) * 0.3; citadel.rings[0].rotation.z = t * 0.6; }
      if (citadel.rings[1]) { citadel.rings[1].rotation.x = t * 0.9; citadel.rings[1].rotation.z = Math.cos(t) * 0.3; }
      if (citadel.core) citadel.core.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
      // (scene flames animate entirely in their shader off TIME — no per-frame JS, so they cost nothing here)
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
