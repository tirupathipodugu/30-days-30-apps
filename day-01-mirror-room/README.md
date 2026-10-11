# Day 1: Mirror Room

A mirror you can break.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/ (no camera? add `?demo=1`)

Your camera opens as a full-screen silvered mirror. Tap the glass and it cracks like a real struck mirror: jagged radial cracks, rough concentric rings, a crushed and chipped centre. Every shard still shows you, tipped a fraction of a degree in its frame, so the reflection no longer lines up. Everything runs in your browser and nothing is uploaded.

Behind the mirror is the sea. Knock pieces out and the ocean shows through the holes they leave.

- **Tap** intact glass, or a big piece (3% of the mirror or more), and it cracks.
- **Tap a small broken piece** and it comes out of the frame. It falls, tumbles and tips away from the light, still reflecting you, and splinters with a small glass tinkle when it hits the floor. Its outline stays behind as a hole, with a thin bevel where the cut glass edge catches the light.
- **Press and drag** across broken glass to sweep out every piece you pass over, whatever its size.
- **Shatter** cracks the glass in several places and drops a few small pieces. **Restore** brings everything back, holes included, until the very end.
- **The end.** Once less than 3% of the glass is left, the last slivers fall on their own, the whole ocean fills the screen and a message fades in. Its **restart** button reloads the page. Shatter, then a few sweeps, gets you there in under a minute.

With reduced motion, pieces fade out where they were instead of falling. The controls sit on frosted pills with icons and labels, and stay visible.

Keys: **B** shatter · **0** restore · **T** time · **R** record · **Tab**, then the arrows and **Enter**, strike from the keyboard · **↑↑↓↓** encore.

## How it works

- **Camera → texture.** `getUserMedia` feeds a hidden `<video>`. Each new frame (`requestVideoFrameCallback`) is uploaded to one WebGL2 texture, cover-fitted to the screen and flipped like a mirror ([camera.js](js/camera.js)).
- **Fracture.** An impact sends 7–12 jagged radial cracks out from the point, then 2–4 rough rings, two tight crushed rings and a few branches. Each crack is traced through the shard it starts in and stops at the first crack or edge it meets, so new cracks end at old ones ([fracture.js](js/fracture.js)).
- **Shards are polygons.** The glass is a list of polygons, and each crack splits the one it crosses in two. Each new shard gets a tiny facet tilt that shifts, twists and re-lights its piece of the reflection, more strongly near the impact. The crushed centre frosts over or chips out, showing the ocean behind ([shards.js](js/shards.js), [geometry.js](js/geometry.js)).
- **Shards and cracks.** All shards are triangulated into one vertex buffer and drawn together, with the silvered look (cool tint, vignette, Fresnel edges, dust) and a specular glint from a pointer light that each facet catches at its own angle. Then every crack is drawn as a thin quad that refracts the image across the break with slight RGB separation and draws a bright hairline ([mirror-renderer.js](js/mirror-renderer.js)).
- **Ripple sim.** A height-field wave simulation runs on the GPU at quarter resolution, ping-ponging two half-float textures, and switches off when idle ([ripple.js](js/ripple.js)).
- **Falling pieces.** A piece that leaves the frame is copied out of the glass mesh and animated on the CPU: gravity, a nudge away from your finger, spin, and a tilt faked by squashing it across a random axis. As it tips, its reflection swings and dims, a sliver of green glass edge and a soft shadow show, and past 90° you see the painted back. Up to 24 fall at once; any more fade out. All of them go to the GPU as one dynamic buffer and one draw call ([debris.js](js/debris.js)).
- **The ocean.** A muted, inline, looping video is uploaded to a texture whenever a hole is open, and drawn cover-fitted behind the glass. Holes simply don't draw, and a stencil keeps cracks on the remaining glass so none float over the sea. Rims are built from every glass edge that has a hole on its other side ([mirror-renderer.js](js/mirror-renderer.js)).
- **Time buffer.** With Time on, the last 3 s of frames are kept in a GPU texture array (20 fps, under 40 MB). Shards farther from the first impact show older frames ([time-buffer.js](js/time-buffer.js)).

**Ocean footage:** [Ocean surface waves](https://commons.wikimedia.org/wiki/File:Ocean_surface_waves.ogv) by Mostafameraji on Wikimedia Commons, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no attribution needed). Cut to a 12 s loop with a crossfade at the seam, 720p H.264, no audio ([assets/ocean.mp4](assets/ocean.mp4)).

No libraries and no build step. It's plain HTML, CSS and ES modules. Glass sounds are synthesised with WebAudio, and clips are recorded from the canvas with MediaRecorder.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
