# Day 2: Living Heart

A human heart beats at the centre of the page, and every beat pushes blood out through glass threads to every edge.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-02-living-heart/ (start at any rate with `?bpm=120`)

Drag the heart to turn it. Hover a thread to see how long the pulse takes to reach that point. **Rate** sets the heart rate, and **Sound** plays a synthesised lub-dub. With reduced motion turned on, the beat is gentler and each pulse brightens the whole network instead of travelling.

## Feeding it a live heart rate (WHOOP bridge)

The page reads the heart rate from one function, `window.setHeartRate(bpm)`. It clamps to 30–220, returns the value it applied, and switches the readout to **LIVE** for 10 s after each call. A new rate starts from the next beat and eases in over three beats.

The page's Content Security Policy only allows connections to its own origin, so the bridge pushes the rate into the tab rather than the page pulling it:

```js
// From a Playwright or Puppeteer script that has the Living Heart tab open as `page`:
await page.evaluate((bpm) => window.setHeartRate(bpm), latestBpmFromWhoop);

// Or by hand, in the browser console on the Living Heart tab:
setHeartRate(84);
```

Call it whenever WHOOP reports a new value, once a second is plenty.

## How it works

- **The beat.** A cardiac cycle runs from the rate. Systole shortens much less than diastole as the rate rises, the atria squeeze just before the ventricles, and the ventricles squeeze, shorten toward the apex and twist, then recoil. A vertex shader moves every point of the heart by its own weights, and recomputes normals so the lighting stays correct ([cycle.js](js/cycle.js), [heart.js](js/heart.js), [heart-material.js](js/heart-material.js)).
- **A wet heart.** A clearcoat physical material gives the wet film, with a soft red glow on the shadow side and a red rim standing in for light scattering through tissue. The room is lit by a warm key light and two cool rim lights, all generated in code.
- **Threads.** Six trunks grow from the great vessels. A space-colonisation tree branches from them across the whole page, and long curl-noise wanderers tangle through it. A fixed seed gives the same tangle on every visit ([threads.js](js/threads.js)).
- **Blood.** Every thread is one merged mesh of camera-facing glass ribbons. Each beat writes one time into a small ring buffer, and the shader moves a red front along each thread by its distance from the heart, so there is no per-beat work on the CPU ([thread-mesh.js](js/thread-mesh.js)).
- **Light and fast.** three.js r170 is vendored, so nothing loads from a CDN. Phones get fewer threads and no bloom, and the page drops to that tier on its own if the frame rate falls.

Add `?tier=low` or `?tier=high` to pin a quality tier.

## The heart model

The page shows the glTF named in [`assets/manifest.json`](assets/manifest.json). While `"model"` is `null`, it shows a procedural anatomical heart that was sculpted from signed distance fields in [procedural-heart.js](js/procedural-heart.js) and baked to `assets/heart-procedural.bin` by [tools/bake-heart.mjs](tools/bake-heart.mjs). That heart has ventricles with an apex, atria and auricles, an aortic arch with its three branches, a pulmonary trunk, both venae cavae and four pulmonary veins, fat in the grooves and raised coronary vessels.

To use the photoreal Sketchfab model, no code changes are needed:

1. Download "Realistic Human Heart" by neshallads from Sketchfab as glTF (Download 3D Model → glTF; it needs a Sketchfab login).
2. Unzip it and convert it from the folder that has `scene.gltf`:
   ```
   npx @gltf-transform/cli optimize scene.gltf heart.glb --compress quantize --texture-compress webp --texture-size 2048 --simplify false
   ```
3. Put `heart.glb` in `assets/` and set `assets/manifest.json` to:
   ```json
   {
     "model": "heart.glb",
     "credit": { "text": "Heart model: neshallads, CC BY 4.0", "href": "https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089" },
     "landmarks": null
   }
   ```
   With `"landmarks": null`, the apex and vessel cuts are estimated from the mesh. Hand-placed landmarks (the same fields as `assets/heart-procedural.json`) can go there later for a tighter fit.
4. Add the attribution below to this README.

## Credits

- three.js r170, MIT licence ([vendor/three/LICENSE](vendor/three/LICENSE)).
- The current heart is procedural and built in code for this page.
- When the Sketchfab model is in use, its attribution is: "Realistic Human Heart" (https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089) by neshallads (https://sketchfab.com/neshallads), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: recompressed, re-shaded, animated.

A visualisation, not a medical device.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
