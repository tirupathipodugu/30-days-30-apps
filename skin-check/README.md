# Skin Check

A 10-second skin scan from your camera. It tells you what it sees and builds a routine for your goals. Nothing leaves your phone.

**Live:** https://tirupathipodugu.github.io/ideas/skin-check/

A cosmetic check, not a medical diagnosis. It never names skin conditions.

## The flow

1. **Landing.** One button, Start scan. "Your camera never leaves this device." "A cosmetic check, not a medical diagnosis."
2. **Light check.** Live ticks for face in view, light level, even light, distance and looking straight. The scan only starts when every tick is green (a 3-second countdown, or tap Start now).
3. **Scan, 9 seconds.** Look straight, then slightly left, then slightly right. The regions light up as they're measured: forehead, T-zone, cheeks, under-eyes, smile lines, chin. The clock pauses if your face leaves the frame.
4. **Results, "Your skin today".** Six cards, each with a 0–100 score and a level (low / some / noticeable), a mini face map, one plain sentence and an (i) that explains how it's measured. Instead of an overall score, there's a summary of the top two things to focus on, plus something positive the scan saw.
5. **Your goals and you.** Goals, skin type (pre-selected from the scan, and you can change it), age, budget, and "Pregnant or breastfeeding?".
6. **Your routine.** Morning and night, built from ingredients, not brands. Each step says what it's for, how to start and what not to mix it with.
7. **Progress.** Save this scan stores the numbers (never the photo) in this browser's localStorage. Trends compare with the scan nearest to 4 weeks earlier. Delete my data removes everything in one tap.
8. **Share card.** "My skin check": the top 3 measures and the routine summary. Your face appears only if you turn on Include my photo.
9. **Sound** is on by default and starts at your first tap: a soft sweep while scanning, and a chime when results are ready. The Sound on/off button is always visible.

## How each measure is computed

Every frame, MediaPipe Face Landmarker finds 478 points on the face. The face is cropped and scaled to a fixed width of 360 px, so every measure is normalised by face size. Region polygons are built from the landmarks: forehead, nose, cheeks, under-eyes, eye corners, smile lines and chin. A Web Worker converts the pixels to CIELAB (sRGB D65, then linear, then XYZ, then L\*a\*b\*). In each region it drops hair, brows and deep shadow (far darker than the region) and specular highlights (far brighter and less colourful).

The camera's white balance and exposure are unknown, so **every measure is relative to your own baseline regions in the same frame**:

| Measure | Raw value | Baseline |
|---|---|---|
| Redness | The part of each region's (a\*, b\*) that lies off the forehead's hue line, toward red: `(a·b_ref − b·a_ref) / C_ref`, in a\* units. Also the share of skin pixels more than 3.5 units toward red. | Your forehead |
| Shine / oil | Fraction of the T-zone and cheeks that is specular: L\* above the region median + max(9, 2.2·MAD), with chroma below 0.85× the median. Also the highlights' strength. | Each region's own median |
| Even tone & dark spots | Blotchiness is the robust SD of the local mean L\* (radius 0.13× eye distance) after a quadratic surface fit removes the light's fall-off across the region. Spots are compact clusters darker than the local mean by max(3.5, 2.6·SD), between about 1.5 mm and 1 cm across, and not long and thin (which would be hairs). | The local surroundings |
| Dark circles | ΔL\* = upper cheek (same side) − under-eye band. | Your own cheek |
| Fine lines | High-pass L\*, then Sobel gradients. The energy across the expected line direction (forehead: horizontal lines; eye corners: lines running out from the eye; smile lines: along the nose-to-mouth line), minus the energy along it. Isotropic noise cancels. | Orientation, not brightness |
| Texture (rough estimate) | Robust SD of the high-pass L\* on cheek skin, with spots and highlights left out. | — |

**Averaging.** Each scan keeps every accepted frame: face found, yaw within 32°, pitch within 24°, and less than 12% clipped pixels. A cheek or under-eye turned away (under 55% of the other side's area) is skipped for that frame. Each raw value is the **median across frames**, then mapped to 0–100 on a fixed scale (see `SCALE` in [js/measures.js](js/measures.js)). The results page shows the frame-to-frame wobble.

**The light check** (in [js/main.js](js/main.js) `updateLight`):

- **Light level.** The 90th percentile of L\* in the eye openings (the whites of the eyes, so the check doesn't depend on skin tone) must be at least 40, the face L\* at least 18, and clipped pixels under 5%.
- **Even light.** The inner halves of the two cheeks must be within 11 L\* of each other, and each cheek's 10–90% L\* spread under 30.
- **Distance.** The face must be 28–90% of the frame's short side and at least 170 px wide.
- **Straight.** Yaw within 14°, pitch within 18°, roll within 12°, from the face transformation matrix.

Each tick is a majority vote over the last 8 frames.

### Stability and what's unreliable

These were headless checks on a public-domain test clip (no longer shipped) (12–41 frames per scan in headless Chrome; a phone typically processes several times more):

- **Repeat scans in the same light** (four scans of the same clip at two different start times) gave tone 29–34, texture 51–55, fine lines 0–3, shine 0–5, and redness and dark circles 0. That's within ±5. A second clip (another volunteer) gave tone 15/16 and texture 38/38.
- **The values change with the light.** Darkening the frame by 30% moved tone from 30 to 21 and texture from 52 to 25. That's why the gate exists and the progress page says "same light as last time".
- **Redness responds to colour.** A simulated red flush on the cheeks moved redness from 0 to 47 on that clip. On deeper skin tones the shift in a\* is smaller, so a low score there is less certain. The (i) says so.
- **Texture is a rough estimate.** Phone cameras denoise, sharpen and compress, so it varies by device. It only becomes a "focus" when it's clearly noticeable.
- **Fine lines** need resolution. A face that is far away or softly focused reads smoother than it is.
- **Dark circles** depend on light from above: overhead light adds shadow and front light hides it.
- **Shine** needs a direct light to produce highlights. In diffuse light, oily skin can read low.
- **Auto-exposure and white balance** aren't locked (browsers, especially iOS Safari, rarely allow it). Measures are relative within a frame to limit this.

## Rules it follows

- **No diagnosis.** It doesn't name conditions (acne, rosacea, melasma, eczema). It talks about "redness", "uneven tone", "spots" and "lines".
- **Escalation.** Strong, widespread redness (score 70+ and 35%+ of the skin) or 15+ spots shows: "If this is new, painful or spreading, see a dermatologist." Every result carries "Any mole that changes in size, shape or colour: see a doctor."
- **No lightening.** The tone goal is "even tone & fade dark spots". It never says "fair", "white" or "lighter skin", and never suggests mercury creams, steroid creams or high-strength hydroquinone without a doctor. The routine page notes: "Skin-lightening creams sold online can contain mercury or steroids. Avoid them."
- **Kind language.** "Some redness", never "bad skin". Each card and the summary say something positive the scan saw.
- **Privacy.** No upload. The camera image is analysed in memory. Only the numbers are stored, and only when you tap Save this scan.

## The routine engine

The rules table and engine are in [js/routine-rules.js](js/routine-rules.js):

- **Ingredients:** gentle cleanser, SPF 30+ (always, every morning), vitamin C, niacinamide, azelaic acid, retinol / retinal (night), ceramide moisturiser, hyaluronic acid and salicylic acid (BHA).
- **Pregnant or breastfeeding:** no retinoids and no leave-on salicylic acid. Azelaic acid is the swap, considered suitable in pregnancy.
- **Under 18:** no retinoid.
- **Sensitive skin:** at most 2 actives, gentler forms and slower starts (retinoid once a week, then twice; azelaic acid 2–3 nights a week). One new product about every four weeks, fragrance-free, patch test.
- **Clashes:** a retinoid and BHA, a retinoid and azelaic acid (while starting), and BHA and azelaic acid go on alternating Night A / Night B. Vitamin C stays in the morning and acids at night.
- **Budget** changes the product type and texture only, never which ingredients.
- **Expectations:** "Give it 8–12 weeks".

### Sources

- American Academy of Dermatology:
  - How to select a sunscreen (broad spectrum, SPF 30+, daily): https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen
  - Retinoids and starting slowly, dark spots (sunscreen first; azelaic acid, vitamin C, retinoids, niacinamide), and sensitive-skin care. AAD public guidance at https://www.aad.org/public
- British Association of Dermatologists: patient information and warnings on skin-lightening products (mercury, steroids, unlicensed hydroquinone). https://www.bad.org.uk/patient-information-leaflets
- Bozzo P, Chua-Gocheco A, Einarson A. Safety of skin care products during pregnancy. *Can Fam Physician* 2011;57:665–7.
- Bissett DL et al. Niacinamide: a B vitamin that improves aging facial skin appearance. *Dermatol Surg* 2005;31:860–5.
- Hakozaki T et al. The effect of niacinamide on reducing cutaneous pigmentation and suppression of melanosome transfer. *Br J Dermatol* 2002;147:20–31.
- Draelos ZD et al. The effect of 2% niacinamide on facial sebum production. *J Cosmet Laser Ther* 2006;8:96–101.
- Mukherjee S et al. Retinoids in the treatment of skin aging: an overview of clinical efficacy and safety. *Clin Interv Aging* 2006;1:327–48.
- Kong R et al. A comparative study of the effects of retinol and retinoic acid on histological, molecular, and clinical properties of human skin. *J Cosmet Dermatol* 2016;15:49–57.
- Schulte BC et al. Azelaic acid: evidence-based update on mechanism of action and clinical application. *J Drugs Dermatol* 2015;14:964–8.
- Telang PS. Vitamin C in dermatology. *Indian Dermatol Online J* 2013;4:143–6.
- Pullar JM, Carr AC, Vissers MCM. The roles of vitamin C in skin health. *Nutrients* 2017;9:866.
- Arif T. Salicylic acid as a peeling agent: a comprehensive review. *Clin Cosmet Investig Dermatol* 2015;8:455–61.
- Pavicic T et al. Efficacy of cream-based novel formulations of hyaluronic acid of different molecular weights in anti-wrinkle treatment. *J Drugs Dermatol* 2011;10:990–1000.
- Hughes MCB et al. Sunscreen and prevention of skin aging: a randomized trial. *Ann Intern Med* 2013;158:781–90.
- Takiwaki H. Measurement of skin color: practical application and theoretical considerations. *J Med Invest* 1998;44:121–6. (CIELAB a\* as a redness measure.)

## Credits and licences

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision` 0.10.35 from npm), Apache License 2.0, © Google LLC. It's vendored in [vendor/mediapipe/](vendor/mediapipe/): `vision_bundle.js` (the package's `vision_bundle.mjs`, renamed so any static server serves it as JavaScript, with the source-map comment removed) and the SIMD and no-SIMD WASM files. The licence text is in [vendor/mediapipe/LICENSE](vendor/mediapipe/LICENSE).
- **Face Landmarker model** (`face_landmarker.task`, float16 v1, from `storage.googleapis.com/mediapipe-models`), Apache License 2.0 per the MediaPipe Face Landmarker model card. It's vendored in `vendor/mediapipe/`. Nothing loads from a CDN at runtime.

No build step. It's plain HTML, CSS and ES modules. Sounds are synthesised with WebAudio.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
