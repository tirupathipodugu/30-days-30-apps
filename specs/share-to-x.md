# Share to X (spec v1, approved 12 Oct)

**Goal:** every app ends with one tap that puts the visitor's result under that day's post on X. The replies pile up under the Day post and push it, and people compare results there.

## How it works

- **Post on X** opens X's composer as a **reply to the app's Day N post**, pre-filled with the visitor's result and the app link, e.g. "I brought him back with CPR. 86% of my pushes were on the beat. ❤️ tirupathipodugu.github.io/ideas/living-heart/".
- Before the Day post exists (the app isn't in `apps.json` yet, or has no `tweet` id), the same button opens a normal new post instead.
- **Images:** X doesn't let a web page attach an image to a post. Where an app makes an image, a separate **Save image** button hands it over: the share sheet on phones, a download on computers. The visitor attaches it to the reply.
- The tweet id lives in `apps.json` as `"tweet": "<status id>"`. The 09:30 posting job adds it right after the Day post goes live.

## Shared code

`shared/share-x.js` (one ES module for every app):
- `postOnX({ path, text })` opens `https://x.com/intent/post?text=…&in_reply_to=…`. `apps.json` is fetched when the module loads, so the click opens X straight away and popup blockers don't stop it.
- `saveImage(blob, name, title)` opens the share sheet when the device supports sharing files, and downloads the image otherwise.

## Per app

| App | Where | Post text | Image |
|---|---|---|---|
| Mirror Room | the ending card | "I broke the mirror into N pieces. 🪞" | Save image: a still of the ending (the existing photo sheet) |
| Living Heart | the CPR "saved" card | "I brought him back with CPR. X% of my pushes were on the beat. ❤️" | none |
| Skin Check | the share card view | "My 10-second skin scan: <the summary>" | the existing Share button (the card image) |
| Macro Mirror | the "Your future" result dialog | "My plate: about +N kcal/day over what I burn. Saw my face 5 years from now. 😬" | Save image / Share (the 3-panel card) |
| Get Ready With Me | the photo/clip sheet | "Tried it on with my camera before buying. 👗" | Save / Share (the photo or clip) |

## Rules

- Buttons are clearly labelled, at least 48px, and come after the main action (restart / try again), never instead of it.
- The text is only the visitor's own result. It never includes their photo or face unless they choose to attach it.
- Every app reuses the same module. New score apps get the button from day one.
