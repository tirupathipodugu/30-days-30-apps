# Day 1: Mirror Room (spec, v4: short)

**Hook:** One mirror. Tap it and it breaks. Keep tapping.

**URL:** https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/
**Folder:** `day-01-mirror-room/` (index.html, style.css, js/*.js)
**Tech:**
- Plain, readable HTML, CSS and JS ES modules, hand-written WebGL2, no libraries, no build step.
- No network requests: a CSP of `default-src 'self'`.
- The camera never leaves the device. Nothing is stored except `localStorage` preferences.

---

## 1. The experience

1. **Landing.** Dark room, silver "Mirror Room" title, and an **Open the mirrors** button. Under it: "Your camera stays on this device. Nothing is uploaded." Plus a "No camera? Watch the demo" link (`?demo=1`).
2. **One mirror.** The camera opens into a single full-screen mirror of you (flipped, like a real mirror). A hint pulses: **"Tap the mirror to break it."**
3. **Tap to break.** Tapping a piece cracks it in two:
   - The crack runs across the piece's **longer side**, through the tap point, clamped to 30–70% so both halves are usable.
   - **Each piece keeps showing exactly the part of the picture it showed before.** The image stays continuous, like a real broken mirror, with only cracks and gaps between pieces.
   - Animation, about 350 ms:
     1. A white hairline crack draws out from the tap point (120 ms).
     2. The two halves slide apart to open a 4 px gap, overshoot slightly and settle.
     3. The image moves with each half.
   - Feedback: a glass "tink" sound (if sound is on), `navigator.vibrate(8)`, and a small water ripple at the tap point.
4. **Any number of pieces.** Keep tapping any piece to break it further.
   - **Minimum piece:** 28 CSS px on the short side. Tapping a smaller piece makes it wobble instead of breaking.
   - **Cap:** 512 pieces.
   - **Counter:** a pill in the corner shows "**12 mirrors**" and pops (scales 1.15 → 1) on every break.
5. **Real broken-mirror look.** Every piece gets a tiny random misalignment of its reflection, fixed per piece:
   - a uv shift of up to ±3 px
   - a tilt of up to ±0.6°
   - a brightness difference of ±4%
   - a thin bright edge along its cracks

   It is subtle but visible, like real shards.
6. **Break all** (button, key **B**, or double-tap on the glass): every piece splits at once, so 1 → 2 → 4 → 8 → … → 128 takes a few taps. Pieces split along their own longer side at 50%. The cracks run in a quick wave from the centre outwards (≈ 400 ms total), with a rising tink per wave.
7. **Reassemble** (button or key **0**): all the pieces slide home in 600 ms, the cracks fade out and it's one clean mirror again, finished with a soft glint.
8. **Water ripple.** The glass ripples like water wherever the mouse moves (desktop) or a finger drags (phone). Ripples flow across all the pieces as one sheet. Taps make a bigger splash.
9. **Time toggle** (button **Time**, key **T**): each piece shows the picture from slightly in the past, lagging 0.1 s for every step of distance from the first piece, up to 3 s. Move and the motion ripples through the shards. Turn around and the far pieces show the back of your head. Toggle it off to return to all-live.
10. **Encore** (↑↑↓↓, or triple-tap the title): an automatic showcase plays from one mirror: 1 → 2 → 4 → 8 → 64 → 128, each split faster than the last, ending in a heartbeat "thump" and a light ring. Then it reassembles. This is the screen-recording moment.
11. **Rec 6s:** records the canvas for 6 s (MediaRecorder: mp4 where supported, else webm). It opens a sheet with **Share** (Web Share, which lets iPhone save to Photos), **Save video** and **Close**. If recording isn't supported, it saves a photo instead. The clip shows a small corner tag: "Mirror Room · Day 1 of 30 · @tirupathipodugu".
12. **Sound:** off by default, with a speaker toggle. All sounds are synthesised with WebAudio: tinks, the thump, and a whoosh on reassemble.
13. **Footer:** "Day 1 of 30 Days, 30 Apps by @tirupathipodugu" (links to x.com/tirupathipodugu) · "← All apps" (links to `../`).

## 2. Layout

- **Full-screen stage** with a thin top bar: the title on the left; **Rec**, **Sound** and **Turn camera off** on the right.
- **Bottom dock:** **Break all** · the counter · **Time** · **Reassemble**.
- **Gutters and sizing:** 16 px side gutters, no horizontal scroll from 320 px wide, and `100dvh`. Phone portrait is the primary layout.
- **Colours:**
  - background `#07070B`
  - glass buttons `rgba(255,255,255,.07)` with a 1px `rgba(255,255,255,.14)` border
  - text `#F2F3F7`
  - accents `#7CF5FF` (focus) and `#FF3B5C` (record)
- **Fonts:** system font for UI, title in a silver gradient.

## 3. How it's built

- **Camera:** `getUserMedia({video:{facingMode:'user', width:{ideal:1280}, height:{ideal:720}}, audio:false})` into a hidden `<video playsinline muted>`, uploaded to a texture each new frame (`requestVideoFrameCallback`).
- **Mirror image:** the camera is cover-fitted to the stage once and flipped horizontally. Each piece samples this one stage image at its own original position, which is what keeps the picture continuous.
- **Pieces:** a binary split tree of rectangles in stage coordinates. Each leaf has: `rect` (current position), `home` (original position, which decides what it shows), and a `jitter` (uv shift, tilt, brightness) used for the shard look. Breaking replaces one leaf with two children.
- **One draw call for all pieces:**
  - Upload the leaf data to a float texture (512 × 2 texels).
  - Keep a 64×64 "which pieces cover this cell" index texture, rebuilt on every break.
  - Each fragment finds its piece through the index, then samples the camera at `home + jitter`.
  - Gaps and cracks are drawn as `#07070B` with a 1 px bright edge.
- **Ripple:** a GPU height-field wave simulation at ¼ resolution (long side ≤ 256 px), ping-pong RGBA16F textures, damping 0.978, at most 3 steps per frame. It stops 4 s after the last input, so it costs nothing when idle. The displacement bends the sample uv, and a specular highlight is added.
- **Time toggle:** a GPU ring buffer of the last 3 s of camera frames (a texture array, 20 fps, ≤ 40 MB on phones). Each piece picks its frame by distance from the first piece.
- **Reduced motion:** splits and reassembly are instant fades, there's no ripple (a static highlight under the pointer instead), and the encore shows stills.
- **Errors**, each a friendly screen with **Try again** / **Watch the demo**:
  - camera blocked: "Camera is blocked. Allow it in your browser's address bar, then try again."
  - no camera
  - camera busy
  - not https
  - no WebGL2

## 4. Keyboard and accessibility

- Tab focuses pieces in reading order. **Enter/Space** breaks the focused piece and the arrow keys move between pieces.
- Other keys: **B** break all · **0** reassemble · **T** time · **R** record · **↑↑↓↓** encore.
- Visible focus rings everywhere.
- A live region announces "12 mirrors" and "Reassembled".
- `prefers-reduced-motion` is respected.

## 5. Performance targets

- ≥ 30 fps on a mid phone (iPhone 12 / Pixel 6a) with 128 pieces and ripples active.
- ≥ 55 fps on a laptop.
- First mirror on screen ≤ 600 ms after permission is granted.
- No memory allocation inside the render loop.

## 6. Code in the public repo

- No test suite. The founder decided this: people use it and read the code.
- Before pushing, the builder opens it once locally (`python -m http.server 8000`, `?demo=1`) only to make sure the page loads and a tap breaks the mirror. That's all.
- The code is meant to be read and shared. Write small, clearly named modules with a short comment at the top of each file saying what it does. No dead code, no debug-only features.
- Add `day-01-mirror-room/README.md`: what it is, the live link, and how it works in 5–6 bullets (camera → texture, the split tree, one draw call, ripple sim, time buffer).

## 7. Ship

- Add to `apps.json`: `{"day":1,"name":"Mirror Room","hook":"One mirror. Tap it and it breaks. Keep tapping.","path":"day-01-mirror-room/"}`
- An OG image of a 128-piece broken mirror.
- X post draft (personal account, attach the demo video):

```
day 1 of 30 days, 30 apps: mirror room

one mirror. tap it and it breaks. keep tapping

every shard still shows you, slightly off, like real broken glass. drag your finger and it ripples like water

runs in your browser, nothing uploaded

https://tirupathipodugu.github.io/30-days-30-apps/day-01-mirror-room/
```

- **Demo video (12 s):**
  1. One mirror, hold still.
  2. Tap, tap, tap: it breaks into pieces.
  3. Break all to 128.
  4. Drag a finger: ripples.
  5. Turn on Time, turn around: the back of your head appears in the far shards.
  6. Reassemble.

## Open questions

1. Keep the "@tirupathipodugu" corner tag on recorded clips? (Default: on.)
2. Will you be the face in the demo video?
