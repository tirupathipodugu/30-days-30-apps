# Macro Mirror (spec v1, approved to build)

**Hook:** Tell it what you eat every day. Drag the slider. Watch *your own face* change over 1 month, 1 year and 10 years.

**URL:** https://tirupathipodugu.github.io/ideas/macro-mirror/
**Folder:** `macro-mirror/`

**The bar (founder):** "make it fun and realistic. it has to be real like a person actually changing."

---

## 1. The experience

1. **Landing:** "MACRO MIRROR" and "See where your plate is taking you." There's one button, **Open the mirror**, and a line: "Your camera never leaves this device."
2. **Live mirror:** your camera fills the screen, un-flipped option off by default, and it tracks your face in real time.
3. **Your day on a plate:** a bottom sheet with food cards you tap to add, each with a +/- count:
   - sugary drink (can)
   - coffee with sugar and cream
   - fries
   - pizza slice
   - burger
   - chocolate bar
   - biscuits
   - rice plate
   - roti or bread
   - fruit
   - salad
   - protein shake
   - nuts (handful)
   - beer or wine
   - late-night snack

   **Activity** is a 4-step chip: desk all day / some walking / active / very active.
   **About you** is optional: age band, sex, rough height and weight. These are used only to estimate maintenance calories and are never stored. Sensible defaults apply if skipped.

   A live readout shows "About **+420 kcal/day** over what you burn", or under.
4. **The timeline slider:** Today · 1 month · 6 months · 1 year · 3 years · 5 years · 10 years.
   - Dragging it changes your **live** face in real time. You can blink, talk and turn your head, and the change stays locked to your face.
   - A small caption shows the numbers: "about +6 kg after 1 year at this rate".
5. **Two futures:** a toggle switches between **This plate** and **Better plate**. Better plate auto-swaps the 2–3 worst items for lighter ones, such as the sugary drink for water and fries for salad. **Split view** shows both futures side by side on your live face.
6. **Share card:** **Save my future** captures Today | 5 years (this plate) | 5 years (better plate) as one image with the numbers and "Macro Mirror · @tirupathipodugu". You can also do a 6 s screen-record of the slider sweep.
7. **Sound** is on by default after the first tap: a soft whoosh tied to the slider and a gentle chime at each milestone. The **Sound on/off** toggle stays clearly visible.

## 2. Making it look real (the core)

All of this runs in the browser with no paid AI: **MediaPipe Face Landmarker** (478 landmarks plus blendshapes and the face transform matrix) at 30 fps, plus a WebGL face-mesh warp.

- **Weight gain:** the face widens and softens where real faces do.
  - **Cheeks:** fuller cheeks and buccal fat.
  - **Jaw and chin:** the jawline rounds off, jowls form at the jaw corners, a soft double chin with a shading crease appears under the jaw, and the neck thickens.
  - **Eyes:** slightly smaller-looking eyes from fuller lids.
  - **Skin:** subtle puffiness. A small redness shift appears only for heavy alcohol or sugar.
  - **Lighting:** shading is relit to match. Add ambient-occlusion shadows under new volume, such as below the chin and in the jowl creases, so it doesn't look like a flat stretch.
- **Weight loss:** the reverse, capped. The cheekbones and jawline sharpen and the face slims a little.
- **Time itself:** the person gets older too, slowly and honestly. At 5–10 years add faint forehead lines, crow's feet, nasolabial folds and slight under-eye bags. These are blended texture layers aligned to the face mesh, scaled by years and stronger with poor diet, smoking or alcohol.
  - **Optional greying at temples:** MediaPipe's multiclass selfie segmenter gives a hair mask. Greying starts at 10 years.
- **Locked to the face:** the warp is driven by landmarks every frame, using a smooth radial-basis displacement over the mesh plus the jaw/neck region below it. It follows head turns and expressions. Edges blend into the background with a feathered mask, so there's no wobbling background.
- **The model behind the numbers:** Hall's dynamic weight model (simplified).
  - Long-run change is about **1 kg per 24 kcal/day** of surplus (about 100 kJ/day per kg).
  - About half of it shows within the first year.
  - Formula: `kg(t) = (surplus/24) * (1 - 0.5^(t/365 days))`.
  - Weight maps to visible face change with caps: about ±15 kg maximum effect, and change beyond that isn't drawn further.
- **Honesty:** the caption says "An illustration from a simple energy-balance model, not a prediction or medical advice." It shows the assumptions behind a small (i).

## 3. Fun

- **"Guess my plate" mode:** set a hidden plate, record a 6 s slider sweep and share it. Friends guess.
- **Milestone captions** with a light tone, never mocking. For example: "1 year: your jeans have noticed." and "Better plate, 1 year: same you, more energy."
- **A hold-to-compare button** shows the real you while held.

## 4. Rules

- **Health framing:**
  - Neutral words: never "fat", "ugly" or "bad". Say "fuller" and "leaner".
  - The **better** version always shows first when you switch.
  - Show both directions.
  - No weight-loss extremes: the lean cap is about −8 kg of effect.
  - 18+ note on the landing page.
  - Your own face only: one face is tracked, and other faces are left untouched.
- **Privacy:** nothing is uploaded or stored. The share card is created on-device.
- **Controls:** clearly visible and labelled, with 14px+ text, 48px touch targets, frosted dark bars and safe-area insets. **Mobile first.**

## 5. Build items

| # | Item | Done when |
|---|---|---|
| 1 | Scaffold `macro-mirror/`, landing page, camera start, permission errors, demo fallback (`?demo=1` with a bundled CC0 portrait video) | Opens on phone and desktop; camera or demo shows |
| 2 | Face Landmarker integration, vendored with the WASM and model in the repo (no CDN at runtime) | 30 fps tracking on a mid-range phone; landmarks stable |
| 3 | WebGL face-mesh warp: weight-gain and weight-loss displacement fields with feathered blending, locked to the face | Slider changes the live face smoothly with no jitter or background wobble |
| 4 | Realism layers: AO shading for chin/jowls, puffiness, ageing texture layers (lines, folds, bags), optional hair greying | Side-by-side at 0 / 5 / 10 years looks like the same person, believably older or heavier |
| 5 | Plate UI: food cards, activity, optional profile, live kcal readout, Hall model | Numbers match the formula; UI readable on a 360px screen |
| 6 | Timeline slider, This plate / Better plate toggle, split view, hold-to-compare | All work live on the camera feed |
| 7 | Share card (Today / 5 y this / 5 y better) and 6 s record; sound on by default | The image saves on iPhone and Android; audio starts on the first tap |
| 8 | Copy, captions, disclaimers, README (sources: Hall et al. 2011 Lancet; MediaPipe licence) | Health-framing rules all met |
| 9 | Phone checks (390×844, 360×800, landscape), push, add to the ideas list (not to the gallery until it's shared) | Live at /ideas/macro-mirror/ |
