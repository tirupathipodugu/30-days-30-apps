# Day 2: Living Heart (spec, v1)

**Hook:** A real human heart beats in the middle of the page, and every beat pushes blood through glass threads that cover the whole screen.

**URL:** https://tirupathipodugu.github.io/ideas/living-heart/
**Folder:** `living-heart/` (index.html, style.css, js/*.js, vendor/, assets/)
**Tech:**
- three.js **r170** (`three@0.170.0`), vendored as ES modules into `vendor/three/`. Copy `build/three.module.js`, plus `GLTFLoader`, `RoomEnvironment`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `ShaderPass`, `OutputPass` and their imports from `examples/jsm/`. Use an import map, and nothing loads from a CDN.
- No build step, no backend, and a CSP of `default-src 'self'`. Because of that CSP there are no Draco/meshopt WASM decoders (see §2).
- Heart rate input comes only from `window.setHeartRate(bpm)`, `?bpm=` and the slider. There is no Bluetooth or WHOOP code. The founder feeds the WHOOP data himself.

---

## 1. The experience

1. **Open.** Near-black page `#050507`. The threads are already there, faintly drifting. Over about 1.2 s the heart fades up in the centre and starts beating at 72 BPM (or `?bpm=`).
2. **The heart.** A photoreal, wet, anatomical heart, **small**: about 24% of the viewport height on desktop (clamped 160–260 px tall), and about 38% of the width on a portrait phone. The threads are the scale; the heart is the small living source at the centre. It beats with a real cardiac cycle: the atria squeeze, then the ventricles squeeze and twist, then everything relaxes (§3).
3. **The threads.** Fine, transparent, glassy threads grow out of the great vessels and tangle across the **entire** page, edge to edge. They cross, loop and overlap in depth. Some run behind the heart and some pass in front of it. They sway very slowly, as if they are floating.
4. **The blood.** At each ventricular ejection, a red glow leaves the heart and travels down every thread to the page edges. Threads further from the heart light up later. Each thread swells slightly as the glow passes, then fades back to glass.
5. **Heart rate drives everything.** Beat timing, pulse speed and the sound all follow the BPM.
6. **Interaction:**
   - **Drag** rotates the heart up to ±25° (yaw) and ±12° (pitch), and it springs back when released.
   - **Hovering a thread** brightens it and shows its delay in tiny type next to the cursor, e.g. `+184 ms`.
   - A counter at the bottom left: `BEATS SINCE YOU ARRIVED  1,204`.
   - A **Sound** toggle (off by default) plays a synthesised lub-dub (§6).
7. **Reduced motion** (`prefers-reduced-motion: reduce`):
   - The beat amplitude drops to 40%.
   - There is no thread sway, camera drift or swelling.
   - Instead of travelling, each pulse gently brightens the whole network.

## 2. Heart model (decided)

**Primary: "Realistic Human Heart" by neshallads (Sketchfab), CC BY 4.0**
- Link: https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089
- I verified the licence on the page and through the Sketchfab API (`license.slug = "by"`, CC BY 4.0, commercial use allowed). It has 654k views and 1.6k likes.
- Mesh: 22.6k triangles and 11.3k vertices, 1 material and 4 PBR textures (base colour, normal, roughness, metalness). It was sculpted in ZBrush and textured in Substance.
- Look: wet sheen, epicardial fat along the grooves, painted coronary vessels, and an aorta, pulmonary trunk and venae cavae stumps. This is the most photoreal freely licensed heart I found.
- Download: Sketchfab requires a login. The founder (or the builder with a `SKETCHFAB_TOKEN`) uses **Download 3D Model → glTF**. The source archive size is only visible when logged in. Expect ≤ 30 MB with textures up to 4K.
- Converting it (offline, with Node; the result is committed as `assets/heart.glb`):
  ```
  npx @gltf-transform/cli optimize scene.gltf heart.glb \
    --compress quantize --texture-compress webp --texture-size 2048 --simplify false
  ```
  Target ≤ 4 MB (`KHR_mesh_quantization` + WebP, both decoded natively by GLTFLoader without WASM). Drop the metalness map, because tissue is not metal.
- **Attribution.** It goes in `living-heart/README.md` and as a tiny footer line ("Heart model: neshallads, CC BY 4.0", linked):
  > "Realistic Human Heart" (https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089) by neshallads (https://sketchfab.com/neshallads), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: recompressed, re-shaded, animated.

**Fallback: "Anatomically Correct Human Heart" by Pigcraft (@s8819296), CC BY 4.0**
- Link: https://sketchfab.com/3d-models/anatomically-correct-human-heart-54fa880728d14c11afff78be8721620a
- Mesh: 1.0M triangles and 4 textures. Its anatomy is more complete, with muscle striations and coronary branches, but it uses textbook red/blue colouring.
- If used, add `--simplify --simplify-ratio 0.06` (about 60k triangles). Ignore its base colour and use the procedural tint in §4, keeping only its normal map.

**Rejected:**
- BodyParts3D (CC BY-SA 2.1 JP): untextured segmentation meshes with a ShareAlike licence.
- NIH 3D hearts: print-oriented STL/X3D files with no textures.
- Smithsonian 3D: no human heart.
- CU Anschutz and Visible Heart Lab scans: real specimens but non-commercial (NC) licences.

**Landmarks.** The builder opens the model once and writes `assets/landmarks.json` in model space with:
- `apex`
- `avPlane` (a point and a normal on the AV groove)
- `aorta`, `pulmonaryTrunk`, `svc`, `ivc`, `pulmonaryVeins[4]` (vessel cut centres and directions)
- `septumDir`

Everything below is computed from these.

## 3. The beat

**Timing per beat** (RR = 60/BPM s). Systole shortens much less than diastole as heart rate rises:

| Phase | Formula | Notes |
|---|---|---|
| Ventricular systole `Ts` | `0.40·√RR`, clamped to 0.20–0.42 s | 0.37 s at 72 BPM, 0.23 s at 180 BPM |
| Diastole `Td` | `RR − Ts` | 0.47 s at 72 BPM, 0.10 s at 180 BPM |
| Atrial systole `Ta` | `min(0.10, 0.45·Td)` | Ends 0.04 s (AV delay) before ventricular systole starts |
| Isovolumic contraction | the first 0.05·(Ts/0.37) of systole | Shape firms up and the base twists, almost no volume change |
| Ejection | the rest of systole | The **pulse emit time** `tBeat` is the start of ejection |
| Isovolumic relaxation | the first 0.07 s of diastole | Untwist recoil |
| Rapid filling | the next 40% of diastole | Then diastasis, then atrial systole |

**Applying BPM changes.** A new BPM never changes the current beat. It takes effect from the next beat, and the period eases toward the target over 3 beats.

**Curves.** `js/cycle.js` outputs per frame `{atria, vent, twist, phase}`, each 0–1.
- Contraction uses an ease-in-out cubic.
- Relaxation uses an exponential recoil with τ = 0.08 s.
- Rapid filling has a slight 4% overshoot.

**Deformation.** This is a vertex shader (`onBeforeCompile` on the material) with per-vertex weights computed once at load and stored as attributes:
- `h` is the height along the apex→base axis, 0 at the apex and 1 at the AV plane.
- `wV` (ventricle) is 1 below the AV plane, with `smoothstep` across ±6% of the heart height.
- `wA` (atria) is 1 above the AV plane. It falls to 0 within 1.2 vessel radii of each vessel cut, so the vessels stay rigid.

**Motion** (amplitudes at full contraction):
- **Ventricles:**
  - Radial inward displacement is 7% of the local radius from the long axis.
  - The base descends toward the apex by 9% of the heart length (AV-plane descent).
  - The apex moves only 1.5%, plus a 0.6° forward "apex tap" at the start of ejection.
- **Torsion:**
  - The rotation about the long axis is `twist · (−4° at the base … +10° at the apex)`, linear in `h`, giving 14° of net twist.
  - It peaks at the end of ejection and untwists in isovolumic relaxation.
- **Atria:**
  - −10% volume during atrial systole.
  - They balloon +6% during ventricular systole as they fill (they are pulled by the AV-plane descent).
- **Great vessels:** a 2% radial swell in the aorta and pulmonary trunk at ejection, delayed 30 ms.
- **Normals:** recompute normals in the shader by displacing two neighbour tangent points with the same function, so the lighting stays correct.

## 4. Material, light, camera

**Material.** `MeshPhysicalMaterial` with the model's base colour, normal and roughness maps:
- `roughness` × 0.75, `clearcoat 1.0`, `clearcoatRoughness 0.07` (the wet film), `ior 1.4`, `specularIntensity 0.6`.
- `sheen 0.35`, `sheenColor #ff6b5e`, `sheenRoughness 0.45`.
- **No `transmission`** (it is expensive and wrong for opaque muscle). Subsurface scattering is approximated in `onBeforeCompile`:
  - wrap diffuse (wrap 0.45) tinted `#8a0d16` for light bleeding into the shadow side
  - a red Fresnel rim `#c4242c` × 0.25
- During ejection the ventricles darken by 6% and get 8% glossier (stretched, blood squeezed). The atria do the same during atrial systole.
- **Fallback model only:** a procedural tint where myocardium is `#5e0d12`, and epicardial fat `#d8b089` is laid along the AV and interventricular grooves (noise-broken bands from the landmarks).

**Lighting** (medical studio, everything generated in code):
- Environment: `RoomEnvironment` → `PMREMGenerator`, `envMapIntensity 0.35`.
- Key: a warm white `DirectionalLight` (`#fff1e6`, intensity 3.2) from the upper left and front.
- Rims: two cool `SpotLight`s behind (`#a9c8ff` at 6, and `#ffd9d0` at 3) that separate the silhouette from black.
- No shadows. Tone mapping `AgXToneMapping`, exposure 1.0, sRGB output.

**Camera.** `PerspectiveCamera`, fov 30°, slightly below and looking up 4° (heroic). It has a slow 0.05 Hz drift of ±1.5°, which is off under reduced motion.

**Post-processing** (one composer):
- Desktop: `UnrealBloomPass` at half resolution (strength 0.55, radius 0.6, threshold 0.82), which only the blood glow and speculars cross.
- One final `ShaderPass` with:
  - vignette (0.35, smooth)
  - animated film grain (0.035 amplitude, luminance-weighted)
  - 0.6 px chromatic fringe at the edges
- **Depth of field is faked rather than post-processed.** The heart's focal plane is sharp. Threads get wider and fainter with distance from it, which is free.

## 5. Threads (`js/threads.js`)

**Generation.** Use a seeded RNG (seed `20261011`) so the same tangle appears every visit. The network is generated in a slab volume: the full frustum width and height at the heart's depth × 1.15, and depth ±0.6 heart-heights. Thread ends run 5% past every edge.
- **Trunks.** 6 roots at the vessel landmarks (aorta, pulmonary trunk, SVC, IVC and 2 pulmonary veins). Each runs along its vessel direction, then curves outward.
- **Space colonisation** from the trunks toward attractors scattered uniformly through the slab:
  - influence 0.35, kill 0.04, step 0.025 (× heart height)
  - This gives the branching, vascular structure.
- **Wanderers.** Long threads that start on a random existing branch node and walk with curl noise (frequency 1.4, step 0.02) plus a weak outward bias. They loop and cross until they leave the page. These create the "tangled thread" look and must cross each other a lot.
- **Sampling.** Each path is smoothed with Catmull-Rom and resampled every 0.01. Arc length `s` is accumulated **from the heart**: a branch inherits its parent's `s` at the branch point.

**Counts and widths:**

| | Desktop | Phone / low tier |
|---|---|---|
| Attractors | 1,800 | 700 |
| Wanderers | 140 | 60 |
| Max vertices | ~80k | ~25k |
| Width at trunk | 3.0 px | 2.4 px |
| Width at tips | 0.6 px | 0.7 px |
| Wanderer width | 0.8–1.4 px | 0.9–1.5 px |

Widths are CSS px and multiplied by the DPR. Width tapers with branch generation.

**Rendering.**
- **Geometry.** One merged geometry of camera-facing ribbons (expanded in the vertex shader from centreline + tangent, `Line2`-style). Attributes: `position`, `tangent`, `side` (−1/+1), `s`, `width`, `seed`.
- **Draw calls.** Two: the threads behind the heart's centre depth draw before the heart, and the threads in front draw after it. Both use additive blending with depthWrite off, so no sorting is needed.
- **Glass look.**
  - Treat `side` as a fake cylinder normal: `n = side`, and Fresnel `f = pow(abs(side), 3)`.
  - The core alpha is 0.05, the edges 0.22 × `f`, and the colour is a cool glass `#cfe3ee`.
  - Add a thin specular streak at `side ≈ 0.55` that slides along the thread with the sway.
- **Depth.** Alpha × (1 − 0.6·depthFromFocus) and width × (1 + 1.5·depthFromFocus) give the fake DoF and the layered look.
- **Sway.** A vertex offset `0.004·sin(t·0.3 + seed + s·2)` along the thread's normal. It is amplitude-weighted by distance from the root, so the threads stay attached at the heart.

## 6. Blood pulse, hover, sound

**Pulse** (all in the thread shader, zero CPU cost per beat):
- Uniforms: `uTime` and `uBeats` (a vec4 of the last 4 `tBeat` times, a ring buffer written once per beat).
- Speed `v` is 1.1 page-heights per second, so the farthest edge is reached in about 0.6 s. That is roughly the delay of a real pulse wave from the heart to the feet.
- For each beat `b`: `x = s − v·(uTime − b)`, then `g = exp(−(x/0.06)²) · exp(−s/2.2)`. The glow is attenuated by distance.
- Behind the front, add a 0.25-strength trailing tail that decays over 0.15 s (the blood "filling" the thread).
- **Colour.** Mix the glass colour toward a blood core `#b3001b`, with a hot highlight `#ff3b30` at `g > 0.7`. Alpha rises to 0.85 at the core.
- **Swelling.** Width × (1 + 0.45·g).
- There is no return flow in v1. Decided: it muddies the read.

**Hover.**
- Keep a CPU-side 32×32 screen grid of projected samples, rebuilt only when the window resizes or the drift moves more than 4 px.
- The nearest sample within 8 px is the hit.
- Show `+NNN ms` in 10 px monospace at 55% white, offset 12 px from the cursor, where the value is the delay `s/v`. That thread's alpha × 2.
- Hover is desktop only. On touch, a tap shows the label for 1.5 s.

**Sound** (WebAudio, synthesised, off by default):
- **S1 ("lub")** at the start of ventricular systole (mitral/tricuspid closure): 110 ms of noise plus a sine at 45 Hz, through a lowpass at 140 Hz, with a fast attack and 90 ms decay.
- **S2 ("dub")** at the end of ejection (aortic/pulmonary closure): 70 ms, 65 Hz plus noise, lowpass at 220 Hz, 0.7× the gain of S1.
- Volume is gentle. There is no sound under reduced motion unless the visitor turns it on.

## 7. Look, copy and layout

Same restrained style as Day 1, but darker and quieter.

- **Background.** `#050507`, `100dvh` full-screen canvas, no scroll at any width from 320 px.
- **Top left.**
  - `LIVING HEART`: system-ui, weight 300, 13 px, letter-spacing .3em, uppercase, 80% white.
  - Under it, 11 px at 45% white: "blood through glass threads, at the speed of a heart".
- **Top right.** `72 BPM` in 11 px tabular monospace.
  - A small pulsing dot beats with the heart.
  - The word `LIVE` appears after `setHeartRate` has been called in the last 10 s; otherwise it says `MANUAL`.
- **Bottom right** (faint text controls, 40% white, 100% on hover):
  - `RATE`, which reveals a 120 px hairline slider (40–200)
  - `SOUND ON/OFF`
- **Bottom left.** The beats counter.
- **Auto-hide.** All the text fades to 0 after 3 s without the pointer moving, and comes back on any move or tap.
- **Footer** (bottom centre, 10 px, 35% white): `Day 2 / 30 · @tirupathipodugu` (links to x.com/tirupathipodugu) · `← all apps` (`../`) · `Heart model: neshallads, CC BY 4.0`.
- **The honest line** above the footer, 10 px, 30% white: "A visualisation, not a medical device."
- **Naming.** The copy says **threads** or **vessels**. Never "nerves".

## 8. API, performance, structure

**Heart rate input**
- `window.setHeartRate(bpm)`: clamps to 30–220 and returns the applied value. It applies from the next beat, as in §3.
- `?bpm=NN` sets the starting BPM. The default is 72. The slider calls the same function.

**Quality tiers**
- The **low** tier is used if `(pointer: coarse)`, or the viewport is narrower than 768 px, or `hardwareConcurrency ≤ 4`. Low means:
  - phone thread counts
  - no bloom (the glow comes from additive blending alone)
  - DPR capped at 1.5
  - heart textures downsampled to 1024 at load via canvas
- **High** has DPR capped at 2.
- **Auto-downgrade.** If the fps stays under 45 for 2 s on high, switch to low. If it stays under 28 on low, halve the wanderers.

**Targets**
- ≥ 50 fps on a laptop and ≥ 30 fps on a mid phone (iPhone 12 / Pixel 6a).
- Threads appear within 300 ms and the heart is visible within 2 s on 4G.
- No allocation inside the render loop.

**Files:** `js/main.js` (setup, loop, tiers), `cycle.js`, `heart.js` (load, weights, material), `threads.js` (generate, geometry, shader), `post.js`, `ui.js`, `sound.js`. Each file gets a one-line comment at the top saying what it does.

**`living-heart/README.md`:**
- what it is and the live link
- how to call `setHeartRate` from the WHOOP bridge
- five bullets on how it works
- the full CC BY attribution

## 9. Check, then ship

- **No test suite** (the founder's decision). The builder serves it locally (`python -m http.server 8000`), opens `?bpm=120` once in headless Chromium, and checks that there are no console errors and the canvas isn't blank. Then the builder pushes. The founder tests on the Pages link.
- `apps.json` entry:
  `{"day":2,"name":"Living Heart","hook":"A real heart beats at the centre of the page and pumps blood through glass threads to every edge.","path":"living-heart/"}`
- An OG image: a 1200×630 still with a pulse caught halfway out.
- X post draft (personal account, with the video):
  ```
  day 2 of 30: this web page beats with my real heart, live from my whoop

  every beat pushes blood out through glass threads to the edges of the screen

  https://tirupathipodugu.github.io/ideas/living-heart/
  ```
- **Demo video (12–15 s)**, a screen recording with a small `BPM` overlay plus a phone-camera inset of the founder:
  1. 0–3 s: a slow push-in on the heart at about 62 BPM, with the first pulse running out to the edges.
  2. 3–6 s: hover a far thread to show `+412 ms`, then cut.
  3. 6–11 s: something stressful (a cold plunge, a sprint upstairs, or reading a scary email). The BPM climbs past 120, the beats tighten, and the threads flood with pulses.
  4. 11–15 s: he breathes out, the BPM drops, and it ends on a calm beat. Text: "day 2 / 30".

## Open questions

1. Which stressful moment for the demo video: a cold shower, a sprint up the stairs, or something on-screen like a horror clip?
2. Should the live link default to **your** recorded WHOOP rate (a looping 5-minute trace baked into the page), or to a plain 72 BPM until someone calls `setHeartRate`?
