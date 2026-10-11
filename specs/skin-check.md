# Skin Check (spec v1, approved to build)

**Hook:** A 10-second skin scan from your camera. It tells you what it sees and builds a routine for your goals. Nothing leaves your phone.

**URL:** https://tirupathipodugu.github.io/ideas/skin-check/
**Folder:** `skin-check/`
**AI:** none paid. The face is tracked with MediaPipe Face Landmarker, which runs free in the browser. The measurements are classic image analysis.

---

## 1. The experience

1. **Landing:** "SKIN CHECK" and "A 10-second scan. A routine that fits you." There's one button, **Start scan**, plus two lines:
   - "Your camera never leaves this device."
   - "A cosmetic check, not a medical diagnosis."
2. **Light check, before scanning:** live guidance with ticks.
   - "Face a window or soft light", measured by brightness and evenness across the face.
   - "Too dark", "Light from one side", "No harsh shadows".
   - "Remove makeup and glasses if you can".
   - "Hold the phone at arm's length", measured from face size.
   - Scanning starts only when all the ticks are green.
3. **Scan, about 8–10 s:**
   - A soft guide asks the user to look straight, then turn slightly left, then slightly right.
   - A sweep animation shows regions lighting up as each is measured: forehead, T-zone, cheeks, under-eyes, smile lines and chin.
   - It averages many frames, so the result is stable.
4. **Results, "Your skin today":** a card per measure, each with:
   - a 0–100 score or level (low / some / noticeable)
   - a mini face map highlighting where it was seen
   - one plain sentence
   - a small (i) explaining how it's measured

   The measures:
   - **Redness:** cheeks, nose and chin. Shows the a\* value relative to the user's own forehead baseline.
   - **Shine / oil:** T-zone vs cheeks. Specular highlight area and intensity.
   - **Even tone / dark spots:** local L\* deviations, plus spot count and size on the cheeks and forehead.
   - **Dark circles:** under-eye L\* vs the cheek, as a ΔL\*.
   - **Fine lines:** forehead, crow's feet and nasolabial. Oriented ridge/edge energy (a Gabor/Sobel response) at fine scale, normalised by face size.
   - **Texture:** high-frequency roughness on the cheeks. Labelled "rough estimate".
   - **Overall:** no single "skin score" that judges a person. A summary sentence of the top 2 things to focus on.
5. **Your goals and you:** chips for the inputs.
   - **Goals:** even tone & fade dark spots · fewer fine lines · less oil & shine · calm redness · hydration & glow · brighter under-eyes · smaller-looking pores.
   - **Skin type:** oily / dry / combination / normal / sensitive. The scan pre-selects one and the user can change it.
   - **About you:** age band, budget (basic / mid / premium), and "Pregnant or breastfeeding?", which excludes retinoids and other unsafe ingredients.
6. **Your routine, morning and night:**
   - **Built from proven ingredients, not brands:** gentle cleanser; SPF 30+ every morning (always included); vitamin C; niacinamide; azelaic acid; retinol / retinal (night); ceramide moisturiser; hyaluronic acid; salicylic acid (BHA) for oil.
   - **Each step shows:** what it's for, how to start (e.g. "retinol: 2–3 nights a week for the first month"), and what not to mix it with (e.g. not the same night as strong acids).
   - **Budget** changes the suggested product type and texture, not the science.
   - **Expectations:** "Give it 8–12 weeks."
7. **Progress:**
   - **Save this scan** stores the numbers (not the photo) on the device, in localStorage.
   - Weekly re-scans show trends, e.g. "redness down 18% since 4 weeks ago", with a "same light as last time" reminder.
   - **Delete my data** is one tap.
8. **Share card:** "My skin check" shows the top 3 measures and the routine summary, without the face unless the user chooses to include it. "Skin Check · @tirupathipodugu".
9. **Sound** is on by default after the first tap: a soft scan sweep and a chime when results are ready. The Sound on/off toggle stays clearly visible.

## 2. Rules

- **No diagnosis, ever.** It doesn't name conditions such as acne, rosacea, melasma or eczema.
- **Medical escalation:**
  - Strong, widespread redness, or many dark spots, shows: "If this is new, painful or spreading, see a dermatologist."
  - It always carries a mole note: "Any mole that changes in size, shape or colour: see a doctor."
- **No "fairness" or lightening.**
  - The tone goal is "even tone & fade dark spots".
  - The app never says "fair", "white" or "lighter skin".
  - It never suggests mercury creams, high-strength hydroquinone without a doctor, or steroid creams.
  - A small note says why: "Skin-lightening creams sold online can contain mercury or steroids. Avoid them."
- **Language:** neutral and kind. "Some redness", never "bad skin". Every result also says something positive the scan saw.
- **Privacy:** no upload. Only the numbers are stored, and only if the user saves them.
- **Controls:** clearly visible and labelled, with 14px+ text and 48px targets. Mobile first. Sound on by default.

## 3. Build items

| # | Item | Done when |
|---|---|---|
| 1 | Scaffold `skin-check/`, landing page, camera start, demo mode (`?demo=1` with a licensed portrait clip), vendored MediaPipe (no CDN) | Opens on phone and desktop |
| 2 | Light-check gate (brightness, evenness, distance, face straight) | Ticks respond live; the scan starts only when they're good |
| 3 | Region masks from landmarks, plus a multi-frame averaging pipeline in a worker or WebGL | Stable values (±5) across repeated scans in the same light |
| 4 | Measures: redness, shine, even tone / spots, dark circles, fine lines, texture, all calibrated against the user's own baseline regions | Each gives sensible values on the demo clip and varies when the light changes |
| 5 | Results UI: cards, face maps, (i) explanations, positive notes, escalation notes | Readable on 360px |
| 6 | Goals and profile inputs, plus a routine engine (rules table in `js/routine-rules.js` with sources) | Correct exclusions (pregnancy, sensitive skin, clashes) |
| 7 | Progress: save numbers, trends, delete; share card; sound | Works offline on device |
| 8 | Copy, disclaimers, README with sources (AAD, British Association of Dermatologists, peer-reviewed reviews on niacinamide, retinoids, azelaic acid, vitamin C) | Every rule in section 2 is met |
| 9 | Phone checks (390×844, 360×800), push, add to the ideas list (not the gallery until it's shared) | Live at /ideas/skin-check/ |
