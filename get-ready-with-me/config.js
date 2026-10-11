// Get Ready With Me: settings the founder fills in. Everything here is optional; the app works with it all empty.
export default {
  // Google Programmable Search Element engine IDs (cx). One per country, or one shared engine under `default`.
  // The search is always restricted to the selected Amazon store (as_sitesearch), whichever engine is used.
  searchEngines: {
    default: '',
    in: '', com: '', 'co.uk': '', ae: '', sa: '', de: '', fr: '', it: '', es: '', nl: '', ca: '', 'com.au': '', sg: '', 'co.jp': '',
  },

  // Optional CORS proxy for reading a pasted Amazon product page (see worker/). Example:
  // 'https://grwm-proxy.example.workers.dev/?url='   (the target URL is appended, encoded)
  proxyUrl: '',

  // Amazon Associates tag per country, e.g. in: 'yourtag-21'. Empty = no tag and no disclosure line.
  // Check the Associates Operating Agreement before turning these on.
  associateTags: {
    in: '', com: '', 'co.uk': '', ae: '', sa: '', de: '', fr: '', it: '', es: '', nl: '', ca: '', 'com.au': '', sg: '', 'co.jp': '',
  },

  // "Comment on the post on X" link shown for clothing. Point it at the exact Day N post later.
  postUrl: 'https://x.com/tirupathipodugu',
};
