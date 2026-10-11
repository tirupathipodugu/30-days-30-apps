# Day 1: Mirror Room

A mirror you can break.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/ (no camera? add `?demo=1`)

Your camera opens as a full-screen silvered mirror. Tap the glass and it cracks like a real struck mirror: jagged radial cracks, rough concentric rings, a crushed and chipped centre. Every shard still shows you, tipped a fraction of a degree in its frame, so the reflection no longer lines up. Everything runs in your browser and nothing is uploaded.

Behind the mirror is a lake at dusk. Knock pieces out and it shows through the holes they leave, and its sound (lapping water, distant gulls) rises as more of it is revealed.

- **Tap** intact glass, or a big piece (3% of the mirror or more), and it cracks.
- **Tap a small broken piece** and it comes out of the frame. It falls, tumbles and tips away from the light, still reflecting you, and splinters with a small glass tinkle when it hits the floor. Its outline stays behind as a hole, with a thin bevel where the cut glass edge catches the light.
- **Press and drag** across broken glass to sweep out every piece you pass over, whatever its size.
- **Shoot it.** A small figure stands on the floor in front of the mirror with a compact gun, and a faint laser dot shows where it's aimed. A shot follows the same rules as a tap: it cracks glass or knocks a small piece out. Each shot has a muzzle flash, a tracer, a short recoil and a brass shell that pings on the floor. Hold fire for four shots a second.
  - Keyboard: **← →** walk · **↑ ↓** aim higher or lower · **Space** or **Enter** fire.
  - Phones: walk with the pad under your left thumb, aim and **Fire** under your right (hold to repeat; you can walk and fire at once). The gun also aims at wherever you last touched the glass.
- **Shatter** brings the whole mirror down, slowly: cracks spread across it, then pieces drop a few at a time, top first and faster and faster, until it's gone (about 10 s). **Restore** stops it and brings everything back, any time before the end.
- **The end.** Once less than 3% of the glass is left, the last slivers fall on their own, the lake fills the screen and a message fades in. Its **restart** button reloads the page.

Sound is on by default and starts with your first tap, click or key press (browsers don't allow it before that). **Sound on / Sound off** turns it off, and the choice is remembered. With reduced motion, pieces fade where they were instead of falling. The controls sit on frosted pills with icons and labels, and stay visible.

Keys: **← → ↑ ↓** walk and aim · **Space** fire · **B** shatter · **0** restore · **T** time · **R** record. Triple-tap the title for the encore.

## How it works

- **Camera → texture.** `getUserMedia` feeds a hidden `<video>`. Each new frame (`requestVideoFrameCallback`) is uploaded to one WebGL2 texture, cover-fitted to the screen and flipped like a mirror ([camera.js](js/camera.js)).
- **Fracture.** An impact sends 7–12 jagged radial cracks out from the point, then 2–4 rough rings, two tight crushed rings and a few branches. Each crack is traced through the shard it starts in and stops at the first crack or edge it meets, so new cracks end at old ones ([fracture.js](js/fracture.js)).
- **Shards are polygons.** The glass is a list of polygons, and each crack splits the one it crosses in two. Each new shard gets a tiny facet tilt that shifts, twists and re-lights its piece of the reflection, more strongly near the impact. The crushed centre frosts over or chips out, showing the scene behind ([shards.js](js/shards.js), [geometry.js](js/geometry.js)).
- **Shards and cracks.** All shards are triangulated into one vertex buffer and drawn together, with the silvered look (cool tint, vignette, Fresnel edges, dust) and a specular glint from a pointer light that each facet catches at its own angle. Then every crack is drawn as a thin quad that refracts the image across the break with slight RGB separation and draws a bright hairline ([mirror-renderer.js](js/mirror-renderer.js)).
- **Ripple sim.** A height-field wave simulation runs on the GPU at quarter resolution, ping-ponging two half-float textures, and switches off when idle ([ripple.js](js/ripple.js)).
- **Falling pieces.** A piece that leaves the frame is copied out of the glass mesh and animated on the CPU: gravity, a nudge away from your finger, spin, and a tilt faked by squashing it across a random axis. As it tips, its reflection swings and dims, a sliver of green glass edge and a soft shadow show, and past 90° you see the painted back. Up to 24 fall at once; any more fade out. All of them go to the GPU as one dynamic buffer and one draw call ([debris.js](js/debris.js)).
- **The scene behind.** A muted, inline, looping video (with a poster frame in case autoplay is blocked) is uploaded to a texture whenever a hole is open, and drawn cover-fitted behind the glass. Holes simply don't draw, and a stencil keeps cracks on the remaining glass so none float over the lake. Rims are built from every glass edge that has a hole on its other side. When only holes change, only the rims are rebuilt ([mirror-renderer.js](js/mirror-renderer.js)).
- **The shooter.** It's drawn with a few shaded shapes on a 2D canvas over the glass: back view, dark jacket, a cool rim light from the mirror, breathing and weapon sway at rest, and the gun shouldered on the right and foreshortened toward the target. Recordings and photos draw both canvases onto one ([shooter.js](js/shooter.js)).
- **Time buffer.** With Time on, the last 3 s of frames are kept in a GPU texture array (20 fps, under 40 MB). Shards farther from the first impact show older frames ([time-buffer.js](js/time-buffer.js)).

**Lake footage and sound:** [After Sunset on the Sandbar at the Mouth of Mission Creek](https://commons.wikimedia.org/wiki/File:After_Sunset_on_the_Sandbar_at_the_Mouth_of_Mission_Creek.webm) by Extemporalist on Wikimedia Commons, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no attribution needed). The picture is cut to a 16 s loop with a 2 s crossfade at the seam (720p H.264, no audio track: [assets/lake.mp4](assets/lake.mp4), poster [assets/lake-poster.jpg](assets/lake-poster.jpg)). The clip's own sound of lapping water and gulls is cut the same way into [assets/lake-ambience.m4a](assets/lake-ambience.m4a).

No libraries and no build step. It's plain HTML, CSS and ES modules. Glass and gun sounds are synthesised with WebAudio, and clips are recorded from the canvas with MediaRecorder.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
