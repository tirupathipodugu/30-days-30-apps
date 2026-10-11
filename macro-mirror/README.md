# Macro Mirror

See where your plate is taking you.

**Live:** https://tirupathipodugu.github.io/ideas/macro-mirror/ (no camera? add `?demo=1`)

Tell it what you eat on a typical day, then drag the timeline. Your own live face changes in the mirror over 1 month, 1 year, 5 and 10 years. You can blink, talk and turn your head, and the change stays on your face. Everything runs in your browser. Your camera never leaves the device, and nothing is uploaded or stored.

- **Your day on a plate.** Tap food cards to add them, with a +/− count for each: sugary drink, coffee with sugar and cream, fries, pizza, burger, chocolate, biscuits, rice plate, roti or bread, fruit, salad, protein shake, nuts, beer or wine, and a late-night snack. Pick your activity level. Age band, sex, height, weight and smoking are optional and only used to estimate what you burn. A live readout shows roughly how far over or under you are each day.
- **The timeline.** Today · 1 month · 6 months · 1 year · 3 years · 5 years · 10 years, with a light caption and the numbers at each stop ("about +6 kg after 1 year at this rate").
- **Two futures.** **This plate** or **Better plate**, which swaps the two or three heaviest treats for lighter ones (the sugary drink for water, fries for a side salad) and stops once the day is in balance. **Split** shows both on your live face, divided down the middle of your nose, with the better plate on the left.
- **Hold: real you** shows the real you for as long as you hold it.
- **Save my future** makes a share card of Today | 5 years on this plate | 5 years on the better plate, with the numbers. From there you can also record a 6 s clip of the slider sweeping from today to 10 years, or a **Guess-my-plate** clip that hides your plate so friends can guess it.
- **Sound** is on by default and starts with your first tap: a soft whoosh follows the slider and a gentle chime marks each milestone. **Sound on / Sound off** turns it off, and the choice is remembered.

It's for adults 18+, and it shows both directions in neutral words ("fuller", "leaner").

## How the numbers work

An illustration from a simple energy-balance model, not a prediction or medical advice.

- **What you burn** is the Mifflin–St Jeor estimate of resting energy times an activity factor (1.2, 1.375, 1.55 or 1.725). Without your details it assumes 30–44, 170 cm, 72 kg and some walking.
- **Weight change** is a simplified form of Hall's dynamic model. In the long run it is about 1 kg for every 24 kcal a day of surplus, and about half of it shows in the first year: `kg(t) = (surplus / 24) × (1 − 0.5^(t / 365 days))`. Source: Hall KD et al., "Quantification of the effect of energy imbalance on bodyweight", *The Lancet* 378(9793), 2011.
- The face stops changing beyond **+15 kg** and never goes leaner than **−8 kg**, whatever the numbers say.
- **Time** ages everyone a little. Fine lines come in from about 5 years and a little faster with alcohol, sugar or smoking, and grey starts at the temples at 10 years.

## How the face changes

- **Tracking.** MediaPipe Face Landmarker finds 478 landmarks on one face in each new video frame. The landmarks are lightly smoothed with a One Euro filter, then the same frame is drawn with them, so the change never lags behind the face ([tracker.js](js/tracker.js)).
- **A 3D frame from the face itself.** The face's width, its up direction and its depth axis come from the landmarks' own 3D positions. Tissue moves out from the face's own centre and down along its own vertical, then is projected back onto the picture. So a fuller cheek on a turned head still bulges past the silhouette on the far side, and the near side moves less ([face-rig.js](js/face-rig.js)).
- **The warp.** The camera frame is drawn untouched as the background. Over the face, a dense mesh (96 × 132 cells, from the forehead to the neck) is moved by a smooth radial-basis displacement field. About 70 anchors sit on the landmarks: the eyes, brows, nose, mouth and forehead are held still; the lower cheeks, jaw corners, jowls, chin, under-chin and neck move by amounts taken from how real faces fill out. The field is normalised with a smooth maximum, so features stay rigid and it falls to nothing a short way outside the face, which keeps the background still. The patch's border is feathered to zero as well ([renderer.js](js/renderer.js)).
- **Re-lighting.** The new volume is also a height field (cheeks, jowls, a second chin). Its slope is lit from above, tilted toward whichever cheek is brighter in your room, so the top of new fullness catches the light and its underside falls into shadow. Shadows on skin go slightly warmer, as real ones do.
- **Creases and lines.** Ambient-occlusion bands and soft folds are drawn as ribbons along anatomical lines: under the new jawline, the second-chin crease, the nasolabial folds and marionette lines, forehead lines, crow's feet and the under-eye groove and bag. Each ribbon goes through the same displacement as the skin under it, so it stays stuck to the face, and each one is a multiply blend with a soft lit lip on one side. That darkens every skin tone in proportion and keeps the skin's own texture. The fine lines are broken up and vary in width along their length.
- **Skin.** Fullness softens the skin texture slightly. Heavy alcohol or sugar adds a faint flush on the cheeks and nose. With time the skin gets a touch duller and less even.
- **Greying.** At 10 years, hair-like pixels at the temples (darker than your skin and not skin-coloured) go grey in salt-and-pepper strands that move with your head. This uses colour rather than a hair segmentation model, to keep the download small and the frame rate up.

## Demo clip

`?demo=1` swaps the camera for a short clip: [Man Speak Bali Aga Balinese dialect](https://commons.wikimedia.org/wiki/File:Man_Speak_Bali_Aga_Balinese_dialect.webm) by ÆleexBali on Wikimedia Commons, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication). It's cut to 18 s from 0:14, with no sound, as 720×1280 H.264 ([assets/demo-portrait.mp4](assets/demo-portrait.mp4)).

## Third-party code and models

- **MediaPipe Tasks Vision** 1.0.1 (`@mediapipe/tasks-vision` from npm): the JavaScript bundle and WebAssembly files in [vendor/mediapipe](vendor/mediapipe). Copyright Google LLC, [Apache License 2.0](vendor/mediapipe/LICENSE). The ES module `vision_bundle.mjs` is saved as `vision_bundle.js` so every static host serves it as JavaScript, and is otherwise unchanged.
- **Face Landmarker model** ([assets/face_landmarker.task](assets/face_landmarker.task), float16 v1) from Google's MediaPipe model storage, Apache License 2.0. See the [MediaPipe Face Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).

Nothing loads from a CDN at runtime. Apart from the vendored MediaPipe files it's plain HTML, CSS and ES modules, with no build step. Sounds are synthesised with WebAudio, and clips are recorded from the canvas with MediaRecorder.

Debug views: `?debug=1` draws the tracked landmarks and `?debug=2` numbers them.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
