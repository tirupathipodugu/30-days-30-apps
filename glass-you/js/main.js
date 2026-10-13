// Glass You: MediaPipe's selfie segmenter finds the person in every camera frame; a WebGL2 shader
// draws them as glass (the room bends through them), stone, liquid gold, paper or pixels. The room
// behind the person is learned over time from the pixels where nobody is standing, so the glass has
// something real to refract. Everything runs on the device. No AI service, no keys, no uploads.

import { ImageSegmenter, FilesetResolver } from '../vendor/mediapipe/vision_bundle.js';

const $ = (id) => document.getElementById(id);
const WASM = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL = new URL('../vendor/mediapipe/selfie_segmenter.tflite', import.meta.url).href;
const VERSES = ['Glass', 'Stone', 'Liquid gold', 'Paper', 'Pixel'];

// ---------- WebGL ----------

const canvas = $('view');
const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
if (!gl) $('status').textContent = 'This browser can\'t draw the glass (WebGL2 is off).';

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Pass 1: learn the room. Where nobody stands, the plate slowly takes the live pixel and marks it
// as seen (alpha). Where the person stands and the room hasn't been seen yet, it borrows the nearest
// room pixels from the left and right of the body, so the glass looks clear from the first second.
const PLATE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uVideo, uMask, uPlate; uniform float uFirst;
vec3 borrow() {
  vec3 l = vec3(0.0), r = vec3(0.0); float fl = 0.0, fr = 0.0;
  for (int i = 1; i <= 40; i++) {
    float d = float(i) * 0.012;
    if (fl < 0.5 && texture(uMask, uv - vec2(d, 0.0)).r < 0.3) { l = texture(uVideo, uv - vec2(d + 0.01, 0.0)).rgb; fl = 1.0; }
    if (fr < 0.5 && texture(uMask, uv + vec2(d, 0.0)).r < 0.3) { r = texture(uVideo, uv + vec2(d + 0.01, 0.0)).rgb; fr = 1.0; }
  }
  if (fl + fr < 0.5) return texture(uVideo, uv).rgb * 0.6;
  return (l * fl + r * fr) / (fl + fr);
}
void main() {
  vec3 v = texture(uVideo, uv).rgb;
  float m = texture(uMask, uv).r;
  vec4 old = uFirst > 0.5 ? vec4(0.0) : texture(uPlate, uv);
  float learn = (1.0 - smoothstep(0.15, 0.4, m)) * 0.35;
  vec3 c = mix(old.rgb, v, learn);
  float seen = max(old.a, learn > 0.2 ? 1.0 : 0.0);
  if (seen < 0.5) c = mix(old.a > 0.0 ? old.rgb : borrow(), borrow(), 0.3);
  o = vec4(c, seen);
}`;

// Pass 2: draw the person in the current universe over the live room.
const DRAW = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uVideo, uMask, uPlate, uCrack;
uniform vec2 uScale, uOffset, uTexel;
uniform float uTime, uMode, uCrackAmt, uMirror;
uniform vec2 uLight;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
float mblur(vec2 v, float r) {
  float s = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture(uMask, v + vec2(i, j) * r).r;
  return s / 25.0;
}

void main() {
  // Screen to video coordinates (cover fit, mirrored like a selfie).
  vec2 v = (uv - 0.5) * uScale + 0.5 + uOffset;
  if (uMirror > 0.5) v.x = 1.0 - v.x;
  v.y = 1.0 - v.y;
  vec3 room = texture(uVideo, v).rgb;

  // Liquid gold melts a little: the outline drips and wobbles.
  vec2 mv = v;
  if (uMode > 1.5 && uMode < 2.5) mv += vec2(sin(v.y * 38.0 + uTime * 2.0) * 0.004, -abs(sin(v.x * 23.0 + uTime)) * 0.006);
  float m = smoothstep(0.35, 0.75, mblur(mv, 0.0035));
  if (m < 0.002) { o = vec4(room, 1.0); return; }

  // A soft height field from the mask gives the body volume: thick in the middle, thin at the edges.
  float r = 0.012;
  float h = mblur(mv, r);
  float hx = mblur(mv + vec2(uTexel.x * 6.0, 0.0), r) - mblur(mv - vec2(uTexel.x * 6.0, 0.0), r);
  float hy = mblur(mv + vec2(0.0, uTexel.y * 6.0), r) - mblur(mv - vec2(0.0, uTexel.y * 6.0), r);
  vec3 n = normalize(vec3(-hx * 6.0, -hy * 6.0, 0.35));
  vec3 L = normalize(vec3(uLight, 0.9));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 48.0);
  float rim = pow(1.0 - n.z, 1.6);

  // Fine detail from the person (eyes, mouth, hair), so it still looks like you.
  vec3 c0 = texture(uVideo, v).rgb;
  float lx = lum(texture(uVideo, v + vec2(uTexel.x, 0.0)).rgb) - lum(texture(uVideo, v - vec2(uTexel.x, 0.0)).rgb);
  float ly = lum(texture(uVideo, v + vec2(0.0, uTexel.y)).rgb) - lum(texture(uVideo, v - vec2(0.0, uTexel.y)).rgb);
  float edge = clamp(length(vec2(lx, ly)) * 5.0, 0.0, 1.0);
  float L0 = lum(c0);

  float crack = texture(uCrack, v).r * uCrackAmt;
  vec3 col;

  if (uMode < 0.5) {
    // Glass: the learned room seen through the body, bent by the surface, split slightly by colour.
    vec2 off = n.xy * (0.035 + 0.05 * h) + vec2(crack * 0.02);
    vec3 thru = vec3(texture(uPlate, v + off * 1.06).r, texture(uPlate, v + off).g, texture(uPlate, v + off * 0.94).b);
    col = thru * vec3(0.9, 0.97, 1.0) + vec3(0.75, 0.9, 1.0) * rim * 0.75 + spec * 1.2;
    col += vec3(0.85, 0.95, 1.0) * edge * 0.45 + vec3(0.6, 0.8, 1.0) * L0 * 0.08;
    col += vec3(1.0) * smoothstep(0.25, 0.9, crack) * 0.9;
  } else if (uMode < 1.5) {
    // Stone: grey rock with grain, lit by the same surface.
    float g = fbm(v * 22.0) * 0.6 + fbm(v * 90.0) * 0.4;
    col = vec3(0.56, 0.54, 0.5) * (0.35 + 0.75 * L0) * (0.75 + 0.45 * g) * (0.55 + 0.6 * diff);
    col -= vec3(0.25) * edge;
    col = mix(col, vec3(0.12), smoothstep(0.25, 0.9, crack));
  } else if (uMode < 2.5) {
    // Liquid gold: brightness mapped onto a gold ramp with a hot, moving highlight.
    vec3 lo = vec3(0.32, 0.18, 0.03), mid = vec3(0.86, 0.62, 0.18), hi = vec3(1.0, 0.93, 0.62);
    float t = clamp(L0 * 0.8 + diff * 0.45, 0.0, 1.0);
    col = t < 0.5 ? mix(lo, mid, t * 2.0) : mix(mid, hi, (t - 0.5) * 2.0);
    col += spec * 1.6 * vec3(1.0, 0.95, 0.75) + rim * 0.35 * vec3(1.0, 0.8, 0.4);
  } else if (uMode < 3.5) {
    // Paper: three flat tones, a pencil outline and diagonal folds.
    float tone = floor(clamp(L0 * 1.15, 0.0, 0.999) * 3.0) / 2.0;
    col = mix(vec3(0.72, 0.69, 0.62), vec3(0.98, 0.96, 0.9), tone);
    float fold = smoothstep(0.02, 0.0, abs(fract((v.x + v.y) * 4.0) - 0.5) - 0.48);
    col *= 1.0 - fold * 0.12 * (0.5 + 0.5 * sign(fract((v.x + v.y) * 2.0) - 0.5));
    col = mix(col, vec3(0.18, 0.17, 0.16), edge * 0.8);
  } else {
    // Pixel: you in big blocks with a small palette.
    float blocks = 64.0;
    vec2 q = (floor(v * blocks) + 0.5) / blocks;
    vec3 pc = texture(uVideo, q).rgb;
    col = floor(pc * 4.0 + 0.5) / 4.0;
    vec2 g = fract(v * blocks);
    col *= 0.85 + 0.15 * step(0.08, min(g.x, g.y));
  }

  o = vec4(mix(room, col, m), 1.0);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
function texture(filter = gl.LINEAR) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

let plateProg, drawProg, quad;
const tex = {};
let plates = [], fbos = [], plateW = 0, plateH = 0, plateIdx = 0, firstPlate = true;

function initGL() {
  plateProg = program(PLATE);
  drawProg = program(DRAW);
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  tex.video = texture();
  tex.mask = texture();
  tex.crack = texture();
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

function ensurePlates(w, h) {
  if (w === plateW && h === plateH) return;
  plateW = w; plateH = h; firstPlate = true;
  plates = [texture(), texture()];
  fbos = plates.map((t) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---------- cracks (drawn on a 2D canvas, in video coordinates) ----------

const crackCanvas = document.createElement('canvas');
crackCanvas.width = crackCanvas.height = 512;
const cc = crackCanvas.getContext('2d');
let crackAmt = 0, crackDirty = true;

function addCrack(x, y) {
  // 9 to 13 jagged cracks out from the tap, each splitting once or twice, plus a small ring.
  cc.strokeStyle = '#fff';
  cc.lineCap = 'round';
  const X = x * 512, Y = y * 512;
  const n = 9 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + Math.random() * 0.4, px = X, py = Y, len = 60 + Math.random() * 140;
    cc.lineWidth = 2.2;
    cc.beginPath(); cc.moveTo(px, py);
    for (let s = 0; s < 8; s++) {
      a += (Math.random() - 0.5) * 0.7;
      px += Math.cos(a) * len / 8; py += Math.sin(a) * len / 8;
      cc.lineTo(px, py);
      if (s === 3 && Math.random() < 0.6) { cc.moveTo(px, py); cc.lineTo(px + Math.cos(a + 0.8) * 30, py + Math.sin(a + 0.8) * 30); cc.moveTo(px, py); }
    }
    cc.stroke();
  }
  cc.lineWidth = 1.4;
  cc.beginPath(); cc.arc(X, Y, 14 + Math.random() * 10, 0, Math.PI * 2); cc.stroke();
  crackAmt = 1; crackDirty = true;
}

// ---------- camera, segmenter, loop ----------

const video = document.createElement('video');
video.playsInline = true; video.muted = true; video.loop = true;
let segmenter = null, mirror = true, mode = 0, maskBuf = null, lastStamp = 0, running = false;

async function makeSegmenter() {
  const error = console.error;
  console.error = (...a) => { if (!/^(INFO|W\d{4}|I\d{4})/.test(String(a[0]))) error(...a); };
  const files = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
  try { return await ImageSegmenter.createFromOptions(files, opts('GPU')); }
  catch { return await ImageSegmenter.createFromOptions(files, opts('CPU')); }
}

async function start(useCamera) {
  $('status').textContent = 'Getting ready…';
  try {
    if (useCamera) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream; mirror = true;
    } else {
      video.src = new URL('../assets/demo-portrait.mp4', import.meta.url).href; mirror = false;
    }
    try { await video.play(); }
    catch (err) {
      // A paused first frame is still usable (some browsers pause video-only media in background tabs).
      await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
    }
    if (!segmenter) segmenter = await makeSegmenter();
  } catch (err) {
    $('status').textContent = useCamera ? 'The camera didn\'t start. Allow it in your browser, or try the sample video.' : `Couldn't start (${err.message}).`;
    return;
  }
  $('start').hidden = true;
  startSound();
  if (!running) { running = true; requestAnimationFrame(frame); }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight;

  // Segment this frame.
  const stamp = Math.max(lastStamp + 1, Math.round(now));
  lastStamp = stamp;
  let mw = 0, mh = 0;
  try {
    const res = segmenter.segmentForVideo(video, stamp);
    const mask = res.confidenceMasks && res.confidenceMasks[0];
    if (mask) {
      mw = mask.width; mh = mask.height;
      const f = mask.getAsFloat32Array();
      if (!maskBuf || maskBuf.length !== f.length) maskBuf = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) maskBuf[i] = f[i] * 255;
      res.close && res.close();
    }
  } catch {}

  // Upload textures.
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.video);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  if (maskBuf && mw) {
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mw, mh, 0, gl.RED, gl.UNSIGNED_BYTE, maskBuf);
  }
  if (crackDirty) {
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.crack);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crackCanvas);
    crackDirty = false;
  }

  // Pass 1: update the learned room.
  const pw = Math.min(640, vw), ph = Math.round(pw * vh / vw);
  ensurePlates(pw, ph);
  const src = plates[plateIdx], dst = plateIdx ^ 1;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[dst]);
  gl.viewport(0, 0, pw, ph);
  gl.useProgram(plateProg.p);
  gl.uniform1i(plateProg.u.uVideo, 0); gl.uniform1i(plateProg.u.uMask, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(plateProg.u.uPlate, 2);
  gl.uniform1f(plateProg.u.uFirst, firstPlate ? 1 : 0);
  // The plate pass works in raw video coordinates, which the draw pass flips when it samples.
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  firstPlate = false;
  plateIdx = dst;

  // Pass 2: draw.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(drawProg.p);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, plates[plateIdx]);
  const u = drawProg.u;
  gl.uniform1i(u.uVideo, 0); gl.uniform1i(u.uMask, 1); gl.uniform1i(u.uPlate, 2); gl.uniform1i(u.uCrack, 3);
  const ca = canvas.width / canvas.height, va = vw / vh;
  const sx = ca > va ? 1 : ca / va, sy = ca > va ? va / ca : 1;
  gl.uniform2f(u.uScale, sx, sy);
  gl.uniform2f(u.uOffset, 0, 0);
  gl.uniform2f(u.uTexel, 1 / vw, 1 / vh);
  gl.uniform1f(u.uTime, now / 1000);
  gl.uniform1f(u.uMode, mode);
  gl.uniform1f(u.uMirror, mirror ? 1 : 0);
  crackAmt = Math.max(0, crackAmt - 1 / 60 / 5);   // cracks heal over about 5 seconds
  gl.uniform1f(u.uCrackAmt, crackAmt);
  if (crackAmt === 0 && !crackDirty && lastCrackClear !== true) { cc.clearRect(0, 0, 512, 512); crackDirty = true; lastCrackClear = true; }
  const t = now / 1000;
  gl.uniform2f(u.uLight, Math.sin(t * 0.7) * 0.6 + tiltX, Math.cos(t * 0.5) * 0.4 + 0.3 + tiltY);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
let lastCrackClear = true;

// Tilting the phone moves the light a little.
let tiltX = 0, tiltY = 0;
addEventListener('deviceorientation', (e) => { if (e.gamma != null) { tiltX = e.gamma / 90; tiltY = (e.beta - 45) / 90; } });

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);

// ---------- input ----------

function screenToVideo(clientX, clientY) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const ca = innerWidth / innerHeight, va = vw / vh;
  const sx = ca > va ? 1 : ca / va, sy = ca > va ? va / ca : 1;
  let x = (clientX / innerWidth - 0.5) * sx + 0.5;
  const y = (clientY / innerHeight - 0.5) * sy + 0.5;
  if (mirror) x = 1 - x;
  return { x, y };
}

function setMode(m) {
  mode = (m + VERSES.length) % VERSES.length;
  $('verse').textContent = `Universe ${mode + 1} of ${VERSES.length} · ${VERSES[mode]}`;
  whoosh();
}

let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; downT = performance.now(); });
canvas.addEventListener('pointerup', (e) => {
  const dx = e.clientX - downX, dy = e.clientY - downY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { setMode(mode + (dx < 0 ? 1 : -1)); return; }
  if (Math.hypot(dx, dy) < 12 && performance.now() - downT < 500) {
    const p = screenToVideo(e.clientX, e.clientY);
    addCrack(p.x, p.y);
    lastCrackClear = false;
    crackSound();
    $('hint').style.opacity = 0;
  }
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') setMode(mode + 1);
  if (e.key === 'ArrowLeft') setMode(mode - 1);
  if (e.key === ' ') { const p = screenToVideo(innerWidth / 2, innerHeight * 0.45); addCrack(p.x, p.y); lastCrackClear = false; crackSound(); }
});
$('next').addEventListener('click', () => setMode(mode + 1));
$('prev').addEventListener('click', () => setMode(mode - 1));
$('cam').addEventListener('click', () => start(true));
$('demo').addEventListener('click', () => start(false));

// ---------- recording: a 6 s clip that sweeps through every universe ----------

$('record').addEventListener('click', () => {
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') { $('record').textContent = 'Not supported here'; return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(canvas.captureStream(30), type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: rec.mimeType });
    const a = $('save');
    a.href = URL.createObjectURL(blob);
    a.download = `glass-you.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    $('record').classList.remove('on');
    $('record').textContent = 'Record 6 s';
  };
  rec.start();
  $('record').classList.add('on');
  $('record').textContent = 'Recording…';
  const start = mode;
  VERSES.forEach((_, i) => setTimeout(() => setMode(start + i), i * 1200));
  setTimeout(() => rec.stop(), 6000);
});

// ---------- sound: a glass tink on cracks, a soft whoosh between universes ----------

let ac = null, soundOn = true;
try { soundOn = localStorage.getItem('glass-you-sound') !== 'off'; } catch {}
$('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
function startSound() { if (!ac && soundOn) try { ac = new AudioContext(); } catch {} }
function crackSound() {
  if (!ac || !soundOn) return;
  const t = ac.currentTime;
  for (const f of [2600, 3900, 5200]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f * (0.95 + Math.random() * 0.1);
    g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.6);
  }
  const n = ac.createBuffer(1, ac.sampleRate * 0.12, ac.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = n; g.gain.value = 0.25; s.connect(g).connect(ac.destination); s.start(t);
}
function whoosh() {
  if (!ac || !soundOn) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.35);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.42);
}
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
  try { localStorage.setItem('glass-you-sound', soundOn ? 'on' : 'off'); } catch {}
  startSound();
});

// ---------- boot ----------

if (gl) { initGL(); resize(); }
if (new URLSearchParams(location.search).has('demo')) start(false);
if (location.search.includes('test')) window.__gy = { setMode, addCrack: (x, y) => { addCrack(x, y); lastCrackClear = false; }, video, frame, gl, get mode() { return mode; }, get maskFrac() { if (!maskBuf) return 0; let c = 0; for (let i = 0; i < maskBuf.length; i += 7) c += maskBuf[i] > 128; return c / (maskBuf.length / 7); } };
