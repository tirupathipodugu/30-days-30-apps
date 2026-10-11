# Day 2: Living Heart

A real, beating human heart you can fly inside: a heart study centre. Tap any part to learn what it does, follow the blood through the heart one stop at a time, or block the glass threads around it and watch the heart fight to keep up.

**Live:** https://tirupathipodugu.github.io/30-days-30-apps/day-02-living-heart/ (start at any resting rate with `?bpm=120`)

For learning, not medical advice.

## Controls

| | Keyboard | Mouse | Touch |
|---|---|---|---|
| Rotate | `←` `→` | drag | one-finger drag, or the arrow buttons |
| Tilt | `↑` `↓` | drag | one-finger drag, or the arrow buttons |
| Zoom (keep going to fly inside) | `+` `−`, `W` `S`, `Shift`+`↑` `↓` | wheel | pinch, or the `+` `−` buttons |
| Learn about a part | | click it (hover shows its name) | tap it |
| Close the panel or end the tour | `Esc` | | |

- **Fly to** in the info panel takes the camera to the part: inside its chamber for valves, chambers, the septum and the AV node, outside for the rest.
- **Cutaway** slices the heart open along a frontal plane. A click on a cut face shows the myocardium.
- **Tour** follows the blood: vena cava → right atrium → tricuspid valve → right ventricle → pulmonary valve → pulmonary arteries → the lungs → pulmonary veins → left atrium → mitral valve → left ventricle → aortic valve → aorta.
- **Reset view** goes back to the start. **?** opens a short guide.
- **Sound** is on by default and starts with your first tap, click or key press (browsers allow nothing sooner).
- The BPM readout opens a slider for the resting rate.

### Blocking the threads

The glass threads stand in for the arteries leaving the heart. Click a thread to put a clot on it: pulses stop at the clot and pile up behind it, and everything past it drains to grey glass. Click the clot to clear it. Six thick trunks leave the heart; a clot on a trunk shuts its whole network.

As more of the circulation is blocked the heart compensates: the rate climbs (72 → about 110 → 150 → 180+), each beat is harder, the heart dilates as it fills and turns dusky, and the open threads carry faster, stronger pulses. When 85% of the flow along the six trunks is blocked, the heart beats frantically and irregularly for a few seconds, bulges once more and stops. The readout flatlines (with a quiet tone if sound is on), and **Restart heart** clears every clot and restarts it with one strong beat that eases back to the resting rate. This is a simplified picture, explained in the panel.

## Feeding it a live heart rate (WHOOP bridge)

The page reads the resting heart rate from one function, `window.setHeartRate(bpm)`. It clamps to 30–220, returns the value it applied, and switches the readout to **LIVE** for 10 s after each call. A new rate starts from the next beat and eases in. Blocked threads still push the rate above it.

The page's Content Security Policy only allows connections to its own origin, so the bridge pushes the rate into the tab:

```js
// From a Playwright or Puppeteer script that has the Living Heart tab open as `page`:
await page.evaluate((bpm) => window.setHeartRate(bpm), latestBpmFromWhoop);

// Or by hand, in the browser console on the Living Heart tab:
setHeartRate(84);
```

## The heart model

The heart is built from **BodyParts3D**, a segmented anatomical dataset from the Database Center for Life Science (DBCLS), Japan, with one mesh per structure and Foundational Model of Anatomy (FMA) IDs. It downloads without a login from https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html (`partof_BP3D_4.0_obj_99.zip`).

[tools/bake-anatomy.mjs](tools/bake-anatomy.mjs) turns it into `assets/heart-anatomy.glb` (20 named meshes, about 240k triangles) and `assets/heart-anatomy.json` (landmarks for the beat, the threads and the camera):

- **From the dataset:** both atrial walls, the tricuspid, mitral, aortic and pulmonary valves (leaflets, cusps and chordae), the papillary muscles, the right and left coronary arteries, the cardiac veins and coronary sinus, the aorta with its arch and the stumps of its branches, the pulmonary trunk and arteries, both venae cavae and the four pulmonary veins.
- **Derived here:** BodyParts3D ships the ventricles only as blood-pool casts, with no ventricular muscle. The ventricular walls and the interventricular septum are grown from those casts with distance fields: 8 mm around the left ventricle and 3 mm around the right, which is exactly where the dataset's own coronary arteries sit (a median 9 mm and 3 mm off the casts), thinning to nothing at the valve openings. The walls are split into left ventricle, right ventricle and septum by which cavity they wrap.
- **Marked, not modelled:** the SA and AV nodes are not in the dataset. They are shown as small marked regions at their textbook positions (the SA node where the superior vena cava meets the right atrium, the AV node in the floor of the right atrium near the coronary sinus opening), and their panels say so.
- **Tissue:** each part gets a wet, clearcoated tissue material with a warm subsurface-like glow, fine muscle grain, epicardial fat along the coronary vessels, a glossier lining inside the chambers, and darker raw muscle on cut faces. Arteries lean faintly red and veins faintly blue, as a study aid only.

To rebuild it:

```
node tools/bake-anatomy.mjs <folder with the partof_BP3D_4.0_obj_99 OBJ files> heart-anatomy.raw.glb
npx @gltf-transform/cli quantize heart-anatomy.raw.glb assets/heart-anatomy.glb --quantize-position 14 --quantize-normal 10
```

Quantisation (`KHR_mesh_quantization`, decoded natively by three.js with no WASM, which the page's CSP would block) keeps it at about 3.8 MB. The page shows a progress bar while it loads.

## How it works

- **The beat.** A cardiac cycle runs from the rate: systole shortens much less than diastole as the rate rises, the atria squeeze just before the ventricles, and the ventricles squeeze, shorten toward the apex and twist, then recoil. A vertex shader moves every part with one continuous field of rest position, so the separate meshes never open seams, and recomputes normals so the lighting stays right ([cycle.js](js/cycle.js), [heart.js](js/heart.js), [heart-material.js](js/heart-material.js)).
- **The study camera** orbits, tilts and zooms with eased motion. Zooming past the target carries the camera forward into the heart; close in, the near plane tightens, the lens widens and a small clipping sphere around the camera cuts away the wall it is passing through ([camera-rig.js](js/camera-rig.js)). Parts are picked with a raycast over Morton-sorted triangle boxes ([picker.js](js/picker.js)).
- **Threads.** Six trunks leave the great vessels and run unbranched until they clear the heart. A space-colonisation tree branches from them across the page, and curl-noise wanderers tangle through it. The number of threads scales with the screen's area, so a wide desktop is as full as a phone ([threads.js](js/threads.js)). They are drawn with their own fixed page camera, so they stay put while you study the heart, and fade back while you are close in.
- **Blood and clots.** Every thread is one merged mesh of camera-facing glass ribbons. Each beat writes one time into a ring buffer, and the shader moves a red front along each thread. A small float texture holds, for every thread, where flow stops; the shader stops pulses there, piles pressure up behind the clot and greys out everything past it ([thread-mesh.js](js/thread-mesh.js), [blockage.js](js/blockage.js)).
- **Facts** live in one file, [js/heart-facts.js](js/heart-facts.js), so they are easy to review.
- **Light and fast.** three.js r170 is vendored, so nothing loads from a CDN. Phones get no bloom, and the page drops to that tier by itself if the frame rate falls. Add `?tier=low` or `?tier=high` to pin a tier.

## Sources for the facts

Values are typical resting adult values, rounded, from standard references:

- Betts, J. G. et al. *Anatomy and Physiology* (2nd ed.), OpenStax, 2022, chapters 19 (The Cardiovascular System: The Heart) and 20 (Blood Vessels and Circulation). CC BY 4.0. https://openstax.org/details/books/anatomy-and-physiology-2e
- Hall, J. E. & Hall, M. E. *Guyton and Hall Textbook of Medical Physiology* (14th ed.), 2020: cardiac cycle pressures, oxygen extraction, coronary blood flow.
- StatPearls (NCBI Bookshelf): Anatomy, Thorax, Heart; Physiology, Cardiac Cycle; Tricuspid Valve; Mitral Valve; Sinoatrial Node; Atrioventricular Node. https://www.ncbi.nlm.nih.gov/books/
- Bergmann, O. et al. "Evidence for cardiomyocyte renewal in humans", *Science* 324 (2009): heart muscle renewal of about 1% a year in young adults.
- Haïssaguerre, M. et al. "Spontaneous initiation of atrial fibrillation by ectopic beats originating in the pulmonary veins", *NEJM* 339 (1998).

## Credits

- Heart model: **BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan** (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Changes: selected the heart's structures, cropped the great vessels, derived the ventricular walls, septum and conduction-node markers, merged and recompressed the meshes. Under the ShareAlike terms, `assets/heart-anatomy.glb` and `assets/heart-anatomy.json` are shared under CC BY-SA 2.1 JP.
- three.js r170, MIT licence ([vendor/three/LICENSE](vendor/three/LICENSE)).

For learning, not medical advice.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
