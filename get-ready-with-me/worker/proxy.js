// Get Ready With Me: optional CORS proxy (Cloudflare Worker). NOT deployed; the app works without it.
//
// It lets the page read the one Amazon product page or photo a visitor pasted, so a pasted product link can show
// its photo straight away. It only fetches Amazon store pages and Amazon/Google image hosts, one URL per request,
// never crawls, and caches nothing.
//
// Deploy (later): `npx wrangler deploy worker/proxy.js --name grwm-proxy`, set ALLOWED_ORIGIN to the site origin
// (e.g. https://tirupathipodugu.github.io), then put 'https://grwm-proxy.<account>.workers.dev/?url=' in
// config.js as proxyUrl.

const STORE = /^(www\.)?amazon\.(in|com|co\.uk|ae|sa|de|fr|it|es|nl|ca|com\.au|sg|co\.jp)$/;
const SHORT = /^(amzn\.(to|in|eu|asia)|a\.co)$/;
const IMAGES = /^(m\.media-amazon\.com|images-[a-z]{2}\.ssl-images-amazon\.com|encrypted-tbn\d\.gstatic\.com)$/;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://tirupathipodugu.github.io';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'x-final-url', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });

    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url')); } catch { return new Response('Missing ?url=', { status: 400, headers: cors }); }
    const host = target.hostname.toLowerCase();
    if (target.protocol !== 'https:' || !(STORE.test(host) || SHORT.test(host) || IMAGES.test(host))) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }

    const upstream = await fetch(target.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept-Language': 'en',
      },
    });
    // Redirects (short links) must still end on an allowed host
    const final = new URL(upstream.url);
    if (!(STORE.test(final.hostname) || IMAGES.test(final.hostname))) return new Response('Redirect not allowed', { status: 403, headers: cors });

    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!/^(text\/html|image\/)/.test(type)) return new Response('Type not allowed', { status: 415, headers: cors });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store', 'x-final-url': final.href },
    });
  },
};
