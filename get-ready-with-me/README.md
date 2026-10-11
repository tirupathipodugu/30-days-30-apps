# Get Ready With Me

Try it on before you buy it. Sunglasses, glasses, caps, hats, earrings, watches and bracelets from Amazon, live on
your own camera.

**Live:** https://tirupathipodugu.github.io/ideas/get-ready-with-me/

Find a product on the left, see it on you on the right. Everything runs in your browser and nothing is uploaded: the
camera, your photos and your clips stay on your device.

- **Find a product**
  - **Search Amazon.** A Google search box limited to the Amazon store you picked. Tap a photo in the results to try it on. Until the search engine is set up, the box opens Amazon search in a new tab instead.
  - **Paste a link.** Paste an Amazon product link, or the product photo's address (on Amazon, right-click the main photo and choose *Copy image address*). Amazon's photo server allows this, so a pasted photo address works straight away.
  - **Drop a photo.** Drop or choose a saved product photo. Plain white backgrounds, like Amazon's main photos, give the cleanest cut-out.
  - **Samples.** Twenty built-in accessories, so you can try it with no setup.
  - **Store.** amazon.in, .com, .co.uk, .ae, .sa, .de, .fr, .it, .es, .nl, .ca, .com.au, .sg or .co.jp. It sets the search and the Buy link, and is remembered.
- **Try it on.** Start the camera, or use a photo of yourself if you have no camera. **Size** and **Height** fine-tune the fit, and **Worn as** fixes a wrongly detected type.
- **Snap photo** or **Record 6 s**, then Save or Share. **Buy on Amazon** opens the product in your chosen store; for samples it searches for similar items.
- **Clothes** (shirts, t-shirts, pants, jeans, dresses, kurtas, jackets and so on) aren't supported yet. Searching for or picking one shows a "coming soon" note with a link to the post on X.

Sound is on by default and starts with your first tap or key press. **Sound on / Sound off** turns it off, and the choice is remembered. On phones the two panels become tabs: *1 · Find a product* and *2 · Try it on*.

## Setup (config.js)

| Setting | What it does | Default |
|---|---|---|
| `searchEngines` | Google Programmable Search Engine IDs (cx): one per country, or one shared `default`. Create an engine at programmablesearchengine.google.com with image search on and the Amazon sites added. The page always limits results to the chosen store. | empty: "Search on Amazon" opens a new tab |
| `proxyUrl` | Optional CORS proxy, so a pasted *product link* shows its photo straight away. The Cloudflare Worker is in [worker/proxy.js](worker/proxy.js) but isn't deployed. | empty: the app asks for the photo address |
| `associateTags` | Amazon Associates tag per country. When a tag is set, the line "As an Amazon Associate, GRWM earns from qualifying purchases." shows under Buy. | empty: no tag |
| `postUrl` | The "post on X" link in the clothes note. | https://x.com/tirupathipodugu |

**Before turning on tags:** the Amazon Associates Operating Agreement has rules about where and how Special Links may
appear. Check with Amazon before you set a tag. The app only reads the single page or photo a visitor picks, and only
through the proxy. It never crawls.

## How it works

- **Tracking.** MediaPipe Tasks Vision runs in the page. The wasm and the models are in [vendor/mediapipe](vendor/mediapipe), so nothing loads from a CDN. The face landmarker (478 points) anchors glasses, caps, hats and earrings. The hand landmarker (21 points) anchors watches and bracelets. Each loads the first time it's needed, on the GPU where the browser allows it.
- **Cut-out** ([js/cutout.js](js/cutout.js)).
  - The background colour is the median of the photo's border.
  - A flood fill from the border removes the background. Edge pixels get a soft alpha from their colour distance and are de-fringed, so no white halo is left.
  - Enclosed pockets of background colour become clear lenses in glasses and holes in hoops and bracelets.
- **Anchor points, found from the mask.**
  - Glasses: hinges, lens centres and the bridge (the thinnest middle column). Temple arms photographed side-on are trimmed off.
  - Caps and hats: the brim line.
  - Earrings: the pair is split into two pieces, each hung from its hook. A stud is worn on the lobe itself.
  - Watches: the case is the widest band of rows.
- **Every frame** ([js/tryon.js](js/tryon.js)).
  - Glasses are drawn as two halves, each warped from hinge to bridge onto the face, so the far half narrows as you turn your head. The near temple arm fades in toward the ear, the far one stays hidden behind the head, and a soft contact shadow sits under the frame.
  - Earrings hang with gravity and a damped swing, and the far one hides as you turn.
  - Watches follow the forearm, with the strap fading where it wraps round the wrist.
  - Movement is smoothed more when you're still and less when you move, so fast turns don't lag.
- **One canvas** shows the camera and the product together, so Snap and Record capture exactly what's on screen (MediaRecorder: mp4 where the browser can, else webm).
- **Classification** ([js/classify.js](js/classify.js)) uses keyword rules on the search text, title, link slug or file name. If they don't match, the page asks what the item is.

**Samples** are our own product-style renders, drawn by [tools/make-catalog.mjs](tools/make-catalog.mjs). No Amazon or third-party photos are in the repo.

No build step. It's plain HTML, CSS and ES modules. UI sounds are synthesised with WebAudio.

**Licences.** MediaPipe Tasks Vision and its models: Apache 2.0 (see [vendor/mediapipe/NOTICE](vendor/mediapipe/NOTICE)).

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
