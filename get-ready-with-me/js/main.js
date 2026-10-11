// Get Ready With Me: wires the Find panel (search, link, photo, samples) to the live try-on stage.
// Everything runs in this page. Photos are read on a canvas here; nothing is uploaded anywhere.

import config from '../config.js';
import { STORES, parseLink, buyUrl, searchUrl, storeHost } from './amazon.js';
import { classify, KIND, LABEL } from './classify.js';
import { CATALOG, FILTERS } from './catalog.js';
import { loadImage, makeCutout } from './cutout.js';
import { Stage } from './tryon.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const sound = new Sound();
const stage = new Stage($('stage'));
let tld = pickStore();
let current = null;       // the product being worn: { title, category, asin, tld, pageUrl, query, thumb, img }
let pending = null;       // a pasted product link still waiting for its photo
let asking = null;        // a photo waiting for "What is it?"
let stream = null;
let facing = 'user';

// ---------- store ----------
function pickStore() {
  const saved = store.get('grwm:store');
  if (saved && STORES.some((s) => s[0] === saved)) return saved;
  const region = (navigator.languages || [navigator.language]).map((l) => (l.split('-')[1] || '').toUpperCase()).find(Boolean);
  return { IN: 'in', US: 'com', GB: 'co.uk', AE: 'ae', SA: 'sa', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', NL: 'nl', CA: 'ca', AU: 'com.au', SG: 'sg', JP: 'co.jp' }[region] || 'in';
}
const tagFor = (t) => (config.associateTags || {})[t] || '';

function initStore() {
  const sel = $('store');
  for (const [value, name, host] of STORES) sel.add(new Option(`${host} · ${name}`, value));
  sel.value = tld;
  sel.addEventListener('change', () => {
    const before = cxFor(tld);
    tld = sel.value;
    store.set('grwm:store', tld);
    sound.play('tick');
    if (cxFor(tld) !== before && before) { location.reload(); return; }
    renderSearch();
    updateProduct();
  });
}

// ---------- messages ----------
function say(html, tone = '') {
  const m = $('message');
  m.className = 'message ' + tone;
  m.innerHTML = html;
  m.hidden = !html;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showClothing(show) {
  $('clothing').hidden = !show;
  if (show) {
    $('post-link').href = config.postUrl || 'https://x.com/tirupathipodugu';
    say('');
    $('ask').hidden = true;
    sound.play('soft');
    $('clothing').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ---------- search ----------
const cxFor = (t) => (config.searchEngines || {})[t] || (config.searchEngines || {}).default || '';
let cseLoaded = false;
let cseCount = 0;

function renderSearch() {
  const cx = cxFor(tld);
  $('cse-wrap').hidden = !cx;
  $('search-form').hidden = !!cx;
  $('search-note').hidden = !!cx;
  if (!cx) return;
  const draw = () => {
    const box = $('cse');
    box.replaceChildren();
    const div = document.createElement('div');
    box.append(div);
    window.google.search.cse.element.render({
      div, tag: 'search', gname: 'grwm' + ++cseCount,
      attributes: { as_sitesearch: storeHost(tld).replace('www.', ''), enableImageSearch: true, defaultToImageSearch: true, linkTarget: '_blank', safeSearch: 'active' },
    });
  };
  if (cseLoaded) { draw(); return; }
  const starting = (gname, query) => { showClothing(classify(query) === 'clothing'); return query; };
  window.__gcse = {
    parsetags: 'explicit',
    initializationCallback: () => { cseLoaded = true; draw(); },
    searchCallbacks: { web: { starting }, image: { starting } },
  };
  const s = document.createElement('script');
  s.src = 'https://cse.google.com/cse.js?cx=' + encodeURIComponent(cx);
  s.async = true;
  s.onerror = () => { $('cse-wrap').hidden = true; $('search-form').hidden = false; $('search-note').hidden = false; };
  document.head.append(s);
}

// Clicking a result in the search widget: capture the image and the product page, and try it on.
function initSearchPicks() {
  $('cse').addEventListener('click', (e) => {
    const result = e.target.closest('.gsc-imageResult, .gsc-webResult, .gsc-result');
    if (!result) return;
    const imgs = [...result.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'));
    const links = [...result.querySelectorAll('a[href]')].map((a) => a.getAttribute('data-ctorig') || a.href);
    const page = links.find((h) => /amazon\./.test(h)) || links[0] || '';
    const title = (result.querySelector('.gs-title')?.textContent || imgs[0]?.alt || '').trim();
    if (!imgs.length && !page) return;
    e.preventDefault();
    e.stopPropagation();
    const parsed = page ? parseLink(page) : null;
    const meta = { title: title || parsed?.words || 'Amazon product', words: parsed?.words, asin: parsed?.asin, tld: parsed?.tld || tld, pageUrl: page };
    const best = imgs.find((i) => /media-amazon|ssl-images-amazon/.test(i.src)) || imgs.sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
    if (best) tryProduct(meta, best.src);
    else useProductLink(page);
  }, true);
}

function initSearchForm() {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('search-text').value.trim();
    if (!q) return;
    if (classify(q) === 'clothing') { showClothing(true); return; }
    showClothing(false);
    sound.play('tick');
    window.open(searchUrl(tld, q, tagFor(tld)), '_blank', 'noopener');
  });
}

// ---------- links ----------
async function viaProxy(url) {
  if (!config.proxyUrl) return null;
  const r = await fetch(config.proxyUrl + encodeURIComponent(url));
  if (!r.ok) throw new Error('proxy ' + r.status);
  return r;
}

async function useProductLink(text) {
  const link = parseLink(text);
  if (!link) { say("That doesn't look like a link. Copy the whole address from Amazon and paste it here.", 'warn'); return; }
  if (link.kind === 'image') {
    const meta = pending || { title: 'Your Amazon product' };
    tryProduct({ ...meta }, link.url);
    return;
  }
  if (link.kind === 'short') {
    if (!config.proxyUrl) { say('Short links (amzn.in, amzn.to, a.co) can\'t be opened from here. Open it, then copy the full address from the address bar.', 'warn'); return; }
    try { const r = await viaProxy(link.url); return useProductLink(r.headers.get('x-final-url') || r.url); } catch { say('That short link could not be opened. Paste the full address instead.', 'warn'); return; }
  }
  if (link.kind !== 'product') { say('Paste a link to an Amazon product page (it has /dp/ in it), or the address of its photo.', 'warn'); return; }
  pending = { title: link.words || `Amazon product ${link.asin}`, words: link.words, asin: link.asin, tld: link.tld, pageUrl: link.url };
  if (classify(link.words) === 'clothing') { showClothing(true); return; }
  showClothing(false);
  if (config.proxyUrl) {
    try {
      say('Reading the product page…');
      const html = await (await viaProxy(link.url)).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = doc.querySelector('#productTitle')?.textContent.trim() || doc.querySelector('meta[property="og:title"]')?.content || pending.title;
      const crumbs = [...doc.querySelectorAll('#wayfinding-breadcrumbs_feature_div a')].map((a) => a.textContent.trim()).join(' ');
      const land = doc.querySelector('#landingImage, #imgTagWrapperId img');
      let image = land?.getAttribute('data-old-hires');
      if (!image && land?.getAttribute('data-a-dynamic-image')) {
        const sizes = JSON.parse(land.getAttribute('data-a-dynamic-image'));
        image = Object.entries(sizes).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0]?.[0];
      }
      image ||= land?.getAttribute('src') || doc.querySelector('meta[property="og:image"]')?.content;
      pending.title = title;
      pending.category = classify(crumbs, title) || null;
      if (image) { say(''); tryProduct({ ...pending }, image); return; }
    } catch { /* fall through to asking for the photo */ }
  }
  say(`Found <b>${esc(pending.title)}</b>. Now add its photo: on Amazon, right-click the main product photo, choose <b>Copy image address</b> and paste it here, or save it and drop it below.`);
}

// ---------- trying a product on ----------
async function loadForCanvas(src) {
  if (src instanceof Blob) return loadImage(src);
  try { return await loadImage(src); } catch {
    if (config.proxyUrl) return loadImage(config.proxyUrl + encodeURIComponent(src));
    throw new Error('cors');
  }
}

async function tryProduct(meta, src, img) {
  const category = meta.category || classify(meta.title, meta.words, meta.fileName);
  if (category === 'clothing') { showClothing(true); return; }
  showClothing(false);
  if (!category || !KIND[category]) {
    asking = { meta, src, img };
    showAsk();
    return;
  }
  $('ask').hidden = true;
  try { img ||= await loadForCanvas(src); } catch {
    say("This site doesn't let other pages read its photos. Save the photo to your device and drop it here instead.", 'warn');
    return;
  }
  let cut;
  try { cut = makeCutout(img, KIND[category], category); } catch {
    say("Couldn't find the product in that photo. Try the main photo on a white background.", 'warn');
    return;
  }
  say(cut.plainBackground ? '' : 'This photo has a busy background, so the cut-out may be rough. The main photo on white works best.', cut.plainBackground ? '' : 'warn');
  current = { ...meta, category, img, src, thumb: src instanceof Blob ? img.src : src };
  pending = null;
  stage.setProduct(cut);
  sound.play('pick');
  updateProduct();
  showTab('try');
}

function showAsk() {
  const box = $('ask-chips');
  box.replaceChildren();
  for (const [cat, label] of Object.entries(LABEL)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.addEventListener('click', () => {
      const a = asking; asking = null;
      $('ask').hidden = true;
      tryProduct({ ...a.meta, category: cat }, a.src, a.img);
    });
    box.append(b);
  }
  $('ask').hidden = false;
  say('Which of these is it? Pick one so it sits in the right place.');
}

function updateProduct() {
  $('product').hidden = !current;
  if (!current) return;
  $('product-thumb').src = current.thumb;
  $('product-title').textContent = current.title;
  const sel = $('product-kind');
  if (!sel.options.length) for (const [v, l] of Object.entries(LABEL)) sel.add(new Option(l, v));
  sel.value = current.category;
  const linked = current.asin || current.pageUrl;
  const t = current.tld && linked ? current.tld : tld;
  $('buy').href = buyUrl(current, tld, tagFor(t));
  $('buy-label').textContent = linked ? 'Buy on Amazon' : 'Shop similar on Amazon';
  $('disclosure').hidden = !tagFor(t);
  for (const b of document.querySelectorAll('#catalog button')) b.setAttribute('aria-current', String(b.dataset.file === current.file));
}

// ---------- samples ----------
function initCatalog() {
  const list = $('catalog');
  for (const item of CATALOG) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.file = item.file;
    b.dataset.category = item.category;
    b.innerHTML = `<img src="assets/catalog/${item.file}" alt="" loading="lazy" width="112" height="112"><span>${esc(item.title)}</span>`;
    b.addEventListener('click', () => tryProduct({ ...item }, `assets/catalog/${item.file}`));
    li.append(b);
    list.append(li);
  }
  const box = $('filters');
  for (const [key, label, cats] of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.setAttribute('aria-pressed', String(key === 'all'));
    b.addEventListener('click', () => {
      for (const c of box.children) c.setAttribute('aria-pressed', String(c === b));
      for (const li of list.children) li.hidden = !!cats && !cats.includes(li.firstChild.dataset.category);
      sound.play('tick');
    });
    box.append(b);
  }
}

// ---------- photo input ----------
function useFile(file) {
  if (!file || !file.type.startsWith('image/')) { say('That file is not a photo.', 'warn'); return; }
  const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  const meta = pending ? { ...pending } : { title: name || 'Your photo', fileName: name };
  tryProduct(meta, file);
}

function initInputs() {
  $('link-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('link-text').value; if (v.trim()) useProductLink(v); });
  $('file').addEventListener('change', (e) => { useFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  const over = (on) => (e) => { e.preventDefault(); drop.classList.toggle('over', on); };
  drop.addEventListener('dragover', over(true));
  drop.addEventListener('dragleave', over(false));
  drop.addEventListener('drop', (e) => {
    over(false)(e);
    const file = e.dataTransfer.files[0];
    if (file) { useFile(file); return; }
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri) useProductLink(uri.split('\n')[0]);
  });
  // Pasting a photo or a link anywhere on the page
  document.addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea')) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { useFile(file); return; }
    const text = e.clipboardData?.getData('text');
    if (text && /^https?:/.test(text.trim())) useProductLink(text);
  });
  $('product-kind').addEventListener('change', (e) => {
    if (current) tryProduct({ ...current, category: e.target.value }, current.src, current.img);
  });
}

// ---------- camera ----------
const PROBLEMS = {
  NotAllowedError: "Camera is blocked. Allow it in your browser's address bar, then try again, or use a photo of you.",
  NotFoundError: 'No camera found. Connect one, or use a photo of you instead.',
  NotReadableError: 'Your camera is busy in another app. Close it there, then try again.',
  insecure: 'The camera only works on a secure (https) page.',
};

async function startCamera() {
  $('camera-error').hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return cameraFailed({ name: 'insecure' });
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) { return cameraFailed(e); }
  const video = $('video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  stage.setSource(video, facing === 'user');
  $('start').hidden = true;
  $('camera-off').hidden = false;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  $('flip').hidden = cams.length < 2;
}

function cameraFailed(e) {
  const p = $('camera-error');
  p.textContent = PROBLEMS[e?.name] || PROBLEMS.NotFoundError;
  p.hidden = false;
}

function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
}

function initCamera() {
  $('camera-on').addEventListener('click', () => { sound.play('tick'); startCamera(); });
  $('camera-off').addEventListener('click', () => {
    stopCamera();
    stage.setSource(null, true);
    $('start').hidden = false;
    $('camera-off').hidden = true;
    $('flip').hidden = true;
  });
  $('flip').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); });
  $('selfie').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopCamera();
    const img = await loadImage(f);
    stage.setSource(img, false);
    $('start').hidden = true;
    $('camera-off').hidden = false;
    $('camera-off').querySelector('span').textContent = 'Close photo';
  });
  stage.onStatus = (text) => { $('status').textContent = text; $('status').hidden = !text; };
  stage.start();
}

// ---------- snap, record, share ----------
const CLIP_TYPES = [['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm', 'webm']];

function readyToCapture() {
  if (!stage.source) { say('Start the camera first.', 'warn'); showTab('try'); return false; }
  return true;
}

function showSheet(blob, ext) {
  const isVideo = blob.type.startsWith('video/');
  const url = URL.createObjectURL(blob);
  const name = `get-ready-with-me.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  const media = document.createElement(isVideo ? 'video' : 'img');
  media.src = url;
  if (isVideo) Object.assign(media, { muted: true, loop: true, playsInline: true, autoplay: true });
  else media.alt = 'Your try-on photo';
  $('preview').replaceChildren(media);
  $('sheet-title').textContent = isVideo ? 'Your clip' : 'Your photo';
  $('save').href = url;
  $('save').download = name;
  $('save').textContent = isVideo ? 'Save video' : 'Save photo';
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $('share').hidden = !canShare;
  $('share').onclick = () => navigator.share({ files: [file], title: 'Get Ready With Me' }).catch(() => {});
  const sheet = $('sheet');
  sheet.addEventListener('close', () => { $('preview').replaceChildren(); URL.revokeObjectURL(url); }, { once: true });
  sheet.showModal();
}

function initCapture() {
  $('snap').addEventListener('click', () => {
    if (!readyToCapture()) return;
    sound.play('shutter');
    $('stage').toBlob((b) => b && showSheet(b, 'png'), 'image/png');
  });
  let recording = false;
  $('record').addEventListener('click', () => {
    if (recording || !readyToCapture()) return;
    const canvas = $('stage');
    const fmt = typeof MediaRecorder !== 'undefined' && canvas.captureStream ? CLIP_TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) : null;
    if (!fmt) { say("This browser can't record clips. Snap a photo instead.", 'warn'); return; }
    recording = true;
    const btn = $('record');
    btn.classList.add('recording');
    sound.play('rec');
    const s = canvas.captureStream(30);
    const rec = new MediaRecorder(s, { mimeType: fmt[0], videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      for (const t of s.getTracks()) t.stop();
      recording = false;
      btn.classList.remove('recording');
      $('record-label').textContent = 'Record 6 s';
      sound.play('stop');
      showSheet(new Blob(chunks, { type: fmt[0].split(';')[0] }), fmt[1]);
    };
    rec.start();
    let left = 6;
    $('record-label').textContent = `Recording… ${left}`;
    const timer = setInterval(() => {
      left--;
      if (left > 0) $('record-label').textContent = `Recording… ${left}`;
      else { clearInterval(timer); rec.stop(); }
    }, 1000);
  });
  $('close-sheet').addEventListener('click', () => $('sheet').close());
  for (const b of document.querySelectorAll('[data-adjust]')) {
    b.addEventListener('click', () => {
      const [what, dir] = b.dataset.adjust.split(':');
      if (what === 'size') stage.size = Math.min(1.7, Math.max(0.6, stage.size * (dir > 0 ? 1.06 : 1 / 1.06)));
      else stage.lift = Math.min(2, Math.max(-2, stage.lift + (dir > 0 ? 0.2 : -0.2)));
      sound.play('tick');
    });
  }
}

// ---------- tabs, sound ----------
function showTab(which) {
  $('find').classList.toggle('active', which === 'find');
  $('try').classList.toggle('active', which === 'try');
  $('tab-find').setAttribute('aria-selected', String(which === 'find'));
  $('tab-try').setAttribute('aria-selected', String(which === 'try'));
}

function initChrome() {
  $('tab-find').addEventListener('click', () => { sound.play('tick'); showTab('find'); });
  $('tab-try').addEventListener('click', () => { sound.play('tick'); showTab('try'); });
  showTab('find');
  const btn = $('sound');
  const paint = () => { btn.setAttribute('aria-pressed', String(sound.enabled)); $('sound-label').textContent = sound.enabled ? 'Sound on' : 'Sound off'; };
  btn.addEventListener('click', () => { sound.toggle(); paint(); });
  paint();
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

initChrome();
initStore();
initCatalog();
initInputs();
initSearchForm();
initSearchPicks();
initCamera();
initCapture();
renderSearch();

// Test hook for headless checks: ?sample=<file>&photo=<url> puts a sample on a still photo.
const params = new URLSearchParams(location.search);
if (params.get('photo')) loadImage(params.get('photo')).then((img) => { stage.setSource(img, false); $('start').hidden = true; });
if (params.get('sample')) { const item = CATALOG.find((c) => c.file.startsWith(params.get('sample'))); if (item) tryProduct({ ...item }, `assets/catalog/${item.file}`); }
