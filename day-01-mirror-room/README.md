# Day 1: Mirror Room

A mirror you can break.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/ (no camera? add `?demo=1`)

Your camera opens as a full-screen silvered mirror. Tap the glass and it cracks like a real struck mirror: jagged radial cracks, rough concentric rings, a crushed and chipped centre. Every shard still shows you, tipped a fraction of a degree in its frame, so the reflection no longer lines up. Everything runs in your browser and nothing is uploaded.

Keys: **B** shatter · **0** restore · **T** time · **R** record · **Tab**, then the arrows and **Enter**, strike from the keyboard · **↑↑↓↓** encore.

## How it works

- **Camera → texture.** `getUserMedia` feeds a hidden `<video>`. Each new frame (`requestVideoFrameCallback`) is uploaded to one WebGL2 texture, cover-fitted to the screen and flipped like a mirror ([camera.js](js/camera.js)).
- **Fracture.** An impact sends 7–12 jagged radial cracks out from the point, then 2–4 rough rings, two tight crushed rings and a few branches. Each crack is traced through the shard it starts in and stops at the first crack or edge it meets, so new cracks end at old ones ([fracture.js](js/fracture.js)).
- **Shards are polygons.** The glass is a list of polygons, and each crack splits the one it crosses in two. Each new shard gets a tiny facet tilt that shifts, twists and re-lights its piece of the reflection, more strongly near the impact. The crushed centre frosts over or chips out to the dark backing ([shards.js](js/shards.js), [geometry.js](js/geometry.js)).
- **Two draw calls.** All shards are triangulated into one vertex buffer and drawn together, with the silvered look (cool tint, vignette, Fresnel edges, dust) and a specular glint from a pointer light that each facet catches at its own angle. Then every crack is drawn as a thin quad that refracts the image across the break with slight RGB separation and draws a bright hairline ([mirror-renderer.js](js/mirror-renderer.js)).
- **Ripple sim.** A height-field wave simulation runs on the GPU at quarter resolution, ping-ponging two half-float textures, and switches off when idle ([ripple.js](js/ripple.js)).
- **Time buffer.** With Time on, the last 3 s of frames are kept in a GPU texture array (20 fps, under 40 MB). Shards farther from the first impact show older frames ([time-buffer.js](js/time-buffer.js)).

No libraries and no build step. It's plain HTML, CSS and ES modules. Glass sounds are synthesised with WebAudio, and clips are recorded from the canvas with MediaRecorder.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
