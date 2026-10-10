# Day 1: Mirror Room

One mirror. Tap it and it breaks. Keep tapping.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/ (no camera? add `?demo=1`)

Your camera opens as a full-screen mirror. Every tap cracks a piece in two, and every shard keeps showing its own part of you, slightly off, like real broken glass. Drag across it and it ripples like water. Everything runs in your browser and nothing is uploaded.

Keys: **B** break all · **0** reassemble · **T** time · **R** record · **↑↑↓↓** encore · **Tab / arrows / Enter** break pieces from the keyboard.

## How it works

- **Camera → texture.** `getUserMedia` feeds a hidden `<video>`. Each new frame (`requestVideoFrameCallback`) is uploaded to one WebGL2 texture, cover-fitted to the screen and flipped like a mirror ([camera.js](js/camera.js), [mirror-renderer.js](js/mirror-renderer.js)).
- **The split tree.** The mirror is a binary split tree of rectangles. Each leaf is a piece with a `home` rectangle (which part of the picture it shows) and a small random misalignment of shift, tilt and brightness. A tap replaces one leaf with two children, cut across its longer side through the tap point ([pieces.js](js/pieces.js)).
- **One draw call.** All pieces are drawn by one full-screen shader. Piece data lives in a float texture, and a 64×64 grid lists which pieces touch each cell, so each pixel tests only a few pieces before sampling the camera at its piece's home position ([mirror-renderer.js](js/mirror-renderer.js)).
- **Ripple sim.** A height-field wave simulation runs on the GPU at quarter resolution, ping-ponging two half-float textures. It bends where the glass reflects from, and it switches off 4 s after you stop touching ([ripple.js](js/ripple.js)).
- **Time buffer.** With Time on, the last 3 s of frames are kept in a GPU texture array (20 fps, under 40 MB). Pieces farther from the first piece show older frames ([time-buffer.js](js/time-buffer.js)).
- **No libraries and no build step.** It's plain HTML, CSS and ES modules. Sounds are synthesised with WebAudio, and clips are recorded from the canvas with MediaRecorder.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
