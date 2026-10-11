# Get Ready With Me (GRWM) — v1 spec

A static web page (GitHub Pages, `/ideas/get-ready-with-me/`) for trying accessories on live, on your own webcam,
before buying them on Amazon. Plain HTML, CSS and ES modules, no build step, like the sibling apps. Nothing is uploaded:
the camera, photos and clips stay in the browser.

## Layout
- **Desktop:** two panels side by side. Left, **Find**: country, search, paste a link, drop a photo, sample catalogue.
  Right, **Try on**: the live camera with the product on you, plus Snap, Record 6 s and Buy on Amazon.
- **Phone:** the same two panels as tabs (Find / Try on). Picking a product jumps to Try on.
- Premium near-black design, labelled controls, 14px+ text, generous targets. Subtle synthesised sounds, on by
  default after the first gesture, with a clear **Sound on / Sound off** toggle that is remembered.

## Finding a product
| # | Source | Works without keys? |
|---|--------|---------------------|
| a | Google Programmable Search Element restricted to the selected Amazon store (cx per country in `config.js`). Clicking an image result captures its image URL and page URL. | No: shows "Search not set up yet" and offers "Search on Amazon in a new tab" instead |
| b | Paste an Amazon product link (ASIN, title words and country read from the URL), or drop / upload a product photo | Yes. A linked product's photo loads only through the optional proxy; otherwise the page asks for the photo |
| c | Built-in catalogue of 20 accessories, rendered by us as product-style images on white | Yes |

**Country selector** (amazon.in, .com, .co.uk, .ae, .sa, .de, .fr, .it, .es, .nl, .ca, .com.au, .sg, .co.jp) sets the
search restriction and the Buy domain, and is remembered.

**Category rules** (keywords in the search text, title, URL slug or file name): glasses, sunglasses, cap/hat, earrings,
watch, bracelet. **Clothing** (shirt, t-shirt, pants, jeans, dress, kurta, jacket, ...) shows: "Shirts and pants are
coming soon 👕👖 Want them sooner? Comment on the post on X and tell us what you want to try on." with the link from
`config.postUrl`. Unknown items ask the visitor to choose the category.

## Live try-on
- MediaPipe Tasks Vision, vendored (wasm + models in `vendor/`, no CDN): face landmarker for glasses, caps, hats,
  earrings; hand landmarker for watches and bracelets.
- **Cut-out:** white-key flood fill from the border with feathered edges; enclosed white areas in glasses become
  clear lenses.
- **Anchors from the mask:** lens centres, bridge and hinges for glasses (thin temple arms trimmed off); brim line for
  caps and hats; each earring's hook (the pair is split into two pieces); case and strap for watches.
- **Every frame:** glasses are drawn as two halves warped from hinge to bridge, so the far side foreshortens as the
  head turns; the near temple arm appears and the far one stays hidden behind the head; a soft contact shadow sits
  under the frame. Earrings hang with gravity and a little swing and hide behind the head on the far side. Watches
  follow the forearm with the strap fading where it wraps round the wrist. Size and height nudges for fit.
- No camera? Use a photo of yourself instead.

## Output and buying
- **Snap** a photo, **Record 6 s** (MediaRecorder), then Save or Share from a sheet.
- **Buy on Amazon** opens `amazon.<country>/dp/<ASIN>` (or the search page for catalogue items) in a new tab, with the
  Associates tag for that country from `config.js` (empty by default). When a tag is set the disclosure "As an Amazon
  Associate, GRWM earns from qualifying purchases." is shown under the button.

## Config (`config.js`)
`searchEngines` (cx per country), `proxyUrl` (optional CORS proxy; the Cloudflare Worker in `/worker` is included but
not deployed), `associateTags` (per country), `postUrl`.

## Compliance notes
- The Associates Operating Agreement may restrict links in some contexts; tags are empty until the founder checks.
- Only the page or image the visitor picks is read, through the proxy; nothing is crawled.

## Out of scope for v1
Clothes try-on (message only), necklaces, rings, shoes; the Windows app.
