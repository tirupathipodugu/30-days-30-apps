// Renderer: one full-screen WebGL2 shader draws everything. For each pixel it works out where light
// from the background would have come from after bending around the hole (gravitational lensing),
// pulls the whole picture inward as the hole swallows it, then adds the event horizon, the photon
// ring, the glowing disk of gas and your bubble.

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D uSrc;
uniform float uHasSrc;
uniform vec2 uRes;       // canvas size, device pixels
uniform vec2 uScale;     // cover-fit: uv = p / uRes * uScale + uOffset
uniform vec2 uOffset;
uniform float uMirror;   // 1 = flip the source like a mirror (camera)
uniform vec2 uHole;      // device pixels, origin top-left
uniform float uRs;       // event horizon radius, device pixels
uniform float uSuck;     // 0 = untouched, 1 = everything swallowed
uniform float uTime;
uniform vec2 uPlayer;
uniform float uPR;       // bubble radius
uniform float uFace;     // 1 = show the camera face crop inside the bubble
uniform vec4 uFaceRect;  // camera uv rect for the face: x, y, w, h
uniform vec2 uStretch;   // spaghettification: direction * amount
uniform vec2 uThrust;    // thrust direction * strength (0..1)
uniform float uFlash;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Deep space for anything outside the picture: faint nebula and stars.
vec3 space(vec2 q) {
  vec2 s = q / uRes.y;
  vec3 c = vec3(0.012, 0.012, 0.02);
  c += vec3(0.10, 0.04, 0.12) * noise(s * 2.5) * noise(s * 5.0 + 3.0);
  vec2 cell = floor(q / 3.0);
  float h = hash(cell);
  if (h > 0.996) c += vec3(0.9, 0.9, 1.0) * (h - 0.996) * 250.0;
  return c;
}

vec3 source(vec2 q) {
  vec2 uv = q / uRes * uScale + uOffset;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || uHasSrc < 0.5) return space(q);
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  return texture(uSrc, uv).rgb;
}

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = p - uHole;
  float r = max(length(d), 1e-3);
  vec2 dir = d / r;
  float rs = uRs;

  // Lensing: a point mass bends light so the image at radius r came from r - E²/r.
  // Inside the Einstein radius E that goes negative, which draws the mirrored inner image.
  float E = 1.7 * rs;
  float rl = r - E * E / r;
  // Swallowing: sample from further out (the picture shrinks into the hole) and twist it.
  float reach = mix(1.0, 9.0, uSuck * uSuck);
  float swirl = (0.5 + 5.0 * uSuck) * rs / r + uSuck * 1.5;
  vec2 q = uHole + rot(dir, swirl) * rl * reach;
  vec3 col = source(q);

  // Light climbing out of the well loses energy: darker and redder close in.
  float near = 1.0 - smoothstep(rs, rs * 4.5, r);
  col *= mix(vec3(1.0), vec3(0.85, 0.45, 0.3), near);
  col *= 1.0 - 0.55 * near;

  // The disk of hot gas, seen at a tilt, spinning; the side moving toward you is brighter.
  vec2 dd = rot(d, -0.32);
  vec2 de = vec2(dd.x, dd.y * 3.4);
  float rho = length(de) / rs;
  float ang = atan(de.y, de.x);
  float band = smoothstep(1.55, 2.0, rho) * (1.0 - smoothstep(2.5, 3.8, rho));
  float swirlN = noise(vec2(ang * 3.0 - uTime * 2.2, rho * 3.0)) * 0.6 + 0.4;
  float doppler = 1.0 + 0.7 * cos(ang);
  vec3 gas = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.75), smoothstep(2.4, 1.7, rho)) * band * swirlN * doppler;
  bool front = dd.y > 0.0;   // the near half of the disk passes in front of the hole

  if (r < rs) {
    col = vec3(0.0);
    if (front) col += gas * 1.3;
  } else {
    col += gas * 1.1;
    col += vec3(1.0, 0.86, 0.62) * exp(-pow((r - 1.5 * rs) / (0.07 * rs), 2.0)) * 0.9; // photon ring
    col += vec3(1.0, 0.55, 0.25) * 0.22 * exp(-(r - rs) / (1.2 * rs));                  // halo
  }

  // Your bubble, stretched toward the hole when it gets you.
  vec2 pd = p - uPlayer;
  float sAmt = length(uStretch);
  if (sAmt > 0.001) {
    vec2 sd = uStretch / sAmt;
    float along = dot(pd, sd), across = dot(pd, vec2(-sd.y, sd.x));
    pd = sd * along / (1.0 + sAmt * 4.0) + vec2(-sd.y, sd.x) * across * (1.0 + sAmt * 1.5);
  }
  float pr = length(pd) / uPR;
  // Thrust flame behind you.
  float tl = length(uThrust);
  if (tl > 0.01) {
    vec2 back = -uThrust / tl;
    vec2 fp = (p - uPlayer) / uPR;
    float along = dot(fp, back), across = abs(dot(fp, vec2(-back.y, back.x)));
    float flame = smoothstep(0.9, 1.1, along) * (1.0 - smoothstep(1.0, 2.6 + 0.4 * sin(uTime * 40.0), along)) * (1.0 - smoothstep(0.0, 0.55 * (2.6 - along) * 0.5, across));
    col += vec3(0.45, 0.9, 1.0) * flame * tl * 1.4;
  }
  if (pr < 1.0) {
    vec3 inner;
    if (uFace > 0.5) {
      vec2 fuv = uFaceRect.xy + (pd / uPR * 0.5 + 0.5) * uFaceRect.zw;
      fuv.x = 1.0 - fuv.x;
      inner = texture(uSrc, fuv).rgb;
    } else {
      inner = mix(vec3(0.85, 0.98, 1.0), vec3(0.25, 0.6, 1.0), pr);
    }
    col = inner;
    col += vec3(0.5, 0.95, 1.0) * smoothstep(0.78, 1.0, pr) * 0.9;   // rim
  } else {
    col += vec3(0.4, 0.9, 1.0) * 0.35 * exp(-(pr - 1.0) * 4.0);      // glow
  }

  // Vignette and the flash when the universe comes back.
  vec2 v = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.35 * dot(v, v);
  col += uFlash;
  outColor = vec4(col, 1.0);
}`;

export class Warp {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.canvas = canvas;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(prog, i).name;
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.uSrc, 0);
    this.srcW = 1;
    this.srcH = 1;
    this.hasSrc = false;
  }

  /** Upload a frame from a video, image or canvas. */
  upload(el) {
    const w = el.videoWidth || el.naturalWidth || el.width;
    const h = el.videoHeight || el.naturalHeight || el.height;
    if (!w || !h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    this.srcW = w;
    this.srcH = h;
    this.hasSrc = true;
  }

  resize(cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  /** Draw one frame. s holds CSS-pixel positions; they are scaled to device pixels here. */
  draw(s) {
    const gl = this.gl, u = this.u, k = this.dpr;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    // Cover-fit the source to the screen.
    const screenA = W / H, srcA = this.srcW / this.srcH;
    let sx = 1, sy = 1;
    if (srcA > screenA) sx = screenA / srcA; else sy = srcA / screenA;
    gl.uniform2f(u.uRes, W, H);
    gl.uniform2f(u.uScale, sx, sy);
    gl.uniform2f(u.uOffset, (1 - sx) / 2, (1 - sy) / 2);
    gl.uniform1f(u.uHasSrc, this.hasSrc ? 1 : 0);
    gl.uniform1f(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(u.uHole, s.hole.x * k, s.hole.y * k);
    gl.uniform1f(u.uRs, s.rs * k);
    gl.uniform1f(u.uSuck, s.suck);
    gl.uniform1f(u.uTime, s.time);
    gl.uniform2f(u.uPlayer, s.x * k, s.y * k);
    gl.uniform1f(u.uPR, s.radius * k * s.bubbleScale);
    gl.uniform1f(u.uFace, s.face ? 1 : 0);
    // Face crop: a square around the middle of the camera picture, a little above centre.
    const fh = 0.62, fw = fh * (this.srcH / this.srcW);
    gl.uniform4f(u.uFaceRect, 0.5 - fw / 2, 0.42 - fh / 2, fw, fh);
    gl.uniform2f(u.uStretch, s.stretch.x, s.stretch.y);
    gl.uniform2f(u.uThrust, s.thrust.x, s.thrust.y);
    gl.uniform1f(u.uFlash, s.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
