// Amazon helpers: the stores we support, reading a pasted link, and building Buy and search links.
// Nothing here fetches Amazon; a product page is only read through the optional proxy (see main.js).

export const STORES = [
  ['in', 'India', 'amazon.in'],
  ['com', 'United States', 'amazon.com'],
  ['co.uk', 'United Kingdom', 'amazon.co.uk'],
  ['ae', 'UAE', 'amazon.ae'],
  ['sa', 'Saudi Arabia', 'amazon.sa'],
  ['de', 'Germany', 'amazon.de'],
  ['fr', 'France', 'amazon.fr'],
  ['it', 'Italy', 'amazon.it'],
  ['es', 'Spain', 'amazon.es'],
  ['nl', 'Netherlands', 'amazon.nl'],
  ['ca', 'Canada', 'amazon.ca'],
  ['com.au', 'Australia', 'amazon.com.au'],
  ['sg', 'Singapore', 'amazon.sg'],
  ['co.jp', 'Japan', 'amazon.co.jp'],
];
const TLDS = STORES.map((s) => s[0]);

export const storeHost = (tld) => `www.amazon.${tld}`;

/** Read a pasted link. Returns { kind: 'product'|'image'|'short'|'other', tld, asin, words, url } or null. */
export function parseLink(text) {
  let url;
  try { url = new URL(text.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)media-amazon\.com$|ssl-images-amazon\.com$/.test(host) || /\.(jpe?g|png|webp|avif)$/i.test(url.pathname)) {
    return { kind: 'image', url: url.href };
  }
  if (/^(amzn\.(to|in|eu|asia)|a\.co)$/.test(host)) return { kind: 'short', url: url.href };
  const m = host.match(/(?:^|\.)amazon\.([a-z.]+)$/);
  if (!m || !TLDS.includes(m[1])) return { kind: 'other', url: url.href };
  const asin = (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i) || [])[1];
  // Product URLs usually carry the title as a slug before /dp/: /Ray-Ban-Aviator-Sunglasses/dp/B0...
  const slug = (url.pathname.split(/\/(?:dp|gp)\//)[0] || '').split('/').filter(Boolean).pop() || '';
  const words = decodeURIComponent(slug).replace(/[-_+]+/g, ' ').trim();
  return { kind: asin ? 'product' : 'other', tld: m[1], asin: asin && asin.toUpperCase(), words, url: url.href };
}

function withTag(url, tag) {
  if (!tag) return url;
  const u = new URL(url);
  u.searchParams.set('tag', tag);
  return u.href;
}

/** The Buy link for a product in the chosen store. */
export function buyUrl(product, tld, tag) {
  if (product.asin) return withTag(`https://${storeHost(product.tld || tld)}/dp/${product.asin}`, tag);
  if (product.pageUrl && parseLink(product.pageUrl)?.kind === 'product') return withTag(product.pageUrl, tag);
  return searchUrl(tld, product.query || product.title, tag);
}

export function searchUrl(tld, query, tag) {
  return withTag(`https://${storeHost(tld)}/s?k=${encodeURIComponent(query || '')}`, tag);
}
