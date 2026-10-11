// WebGL2 renderer: the camera frame drawn untouched as a background, then a dense mesh patch over the
// face that is displaced by a smooth radial-basis field from the landmarks (the tissue moves), re-lit
// from a height field of the new volume, softened, flushed or greyed where it should be. Last, thin
// ribbons along anatomical lines (creases, folds, wrinkles, under-chin shadow) are multiplied in. The
// ribbons go through the same displacement, so everything stays stuck to the skin it belongs to.

const MAX_ANCHORS = 72;
const GRID_X = 96;
const GRID_Y = 132;

const DISPLACE = /* glsl */`
uniform int u_count;
uniform vec4 u_anc[${MAX_ANCHORS}];   // x, y (source px), 1/sigma^2, height (px)
uniform vec4 u_dsp[${MAX_ANCHORS}];   // dx, dy (px), 1/sigmaH^2, unused
uniform float u_amount;               // 0..1 master fade (face found / lost)

// Normalised radial-basis displacement: near dense anchors it takes their weighted average (so
// features held at zero stay rigid); far from every anchor it falls to zero (the background).
vec2 displace(vec2 p, out vec2 grad) {
  vec2 d = vec2(0.0);
  float w = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < ${MAX_ANCHORS}; i++) {
    if (i >= u_count) break;
    vec2 r = p - u_anc[i].xy;
    float r2 = dot(r, r);
    float k = exp(-r2 * u_anc[i].z);
    d += k * u_dsp[i].xy;
    w += k;
    float h = u_anc[i].w;
    if (h != 0.0) grad += -2.0 * u_dsp[i].z * r * h * exp(-r2 * u_dsp[i].z);
  }
  grad *= u_amount;
  // A smooth max(w, 1): a hard max leaves a kink in the field, which shows as a crease in the skin.
  float n = 0.5 * (w + 1.0 + sqrt((w - 1.0) * (w - 1.0) + 0.25));
  return d / n * u_amount;
}
`;

const MAP = /* glsl */`
uniform vec4 u_map;       // offset x, y and drawn size w, h of the video in canvas px
uniform float u_mirror;
vec2 toUV(vec2 p) {
  vec2 uv = (p - u_map.xy) / u_map.zw;
  uv.x = mix(uv.x, 1.0 - uv.x, u_mirror);
  return uv;
}
`;

const BG_VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const BG_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
${MAP}
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = toUV(p);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.02, 0.02, 0.024, 1.0); return; }
  // Soft edges where a letterboxed clip meets the dark.
  // (only on edges that sit inside the canvas)
  float fade = 1.0;
  if (u_map.x > 1.0) fade *= smoothstep(0.0, 28.0, min(p.x - u_map.x, u_map.x + u_map.z - p.x));
  if (u_map.y > 1.0) fade *= smoothstep(0.0, 28.0, p.y - u_map.y);
  if (u_map.y + u_map.w < u_res.y - 1.0) fade *= smoothstep(0.0, 28.0, u_map.y + u_map.w - p.y);
  o = vec4(mix(vec3(0.02, 0.02, 0.024), texture(u_tex, uv).rgb, fade), 1.0);
}`;

const PATCH_VS = `#version 300 es
precision highp float;
in vec2 a_grid;
uniform vec4 u_rect;
uniform vec2 u_res;
${DISPLACE}
${MAP}
out vec2 v_uv;
out vec2 v_src;
out vec2 v_grad;
void main() {
  vec2 p = u_rect.xy + a_grid * u_rect.zw;
  vec2 grad;
  vec2 d = displace(p, grad);
  float e = min(min(a_grid.x, 1.0 - a_grid.x), min(a_grid.y, 1.0 - a_grid.y));
  float fe = smoothstep(0.0, 0.1, e);
  vec2 q = p + d * fe;
  gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
  v_uv = toUV(p);
  v_src = p;
  v_grad = grad * fe;
}`;

const PATCH_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_up;          // face up, unit, canvas px (y down)
uniform vec2 u_across;      // face left->right (cheek A -> cheek B), unit
uniform vec2 u_cheekA, u_cheekB, u_brow;   // uvs to sample skin and light from
uniform float u_shade;
uniform vec4 u_face;        // centre x, y, radius across, radius down (px)
uniform float u_soft;       // puffiness: a slight softening of skin texture
uniform float u_age;        // fine ageing texture and a touch of dullness
uniform float u_scale;      // face width in px
uniform vec4 u_grey[4];     // x, y, 1/r^2, amount
uniform vec4 u_red[3];
uniform float u_amount;
uniform vec4 u_map;
uniform vec2 u_res;
in vec2 v_uv;
in vec2 v_src;
in vec2 v_grad;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  vec2 rel = v_src - u_face.xy;
  vec2 loc = vec2(dot(rel, u_across) / u_face.z, -dot(rel, u_up) / u_face.w);
  float face = smoothstep(1.0, 0.72, length(loc));

  vec3 skinA = texture(u_tex, u_cheekA).rgb;
  vec3 skinB = texture(u_tex, u_cheekB).rgb;
  vec3 skin = (skinA + skinB + texture(u_tex, u_brow).rgb) / 3.0;
  float skinL = luma(skin);

  // Puffiness: skin texture softens a little as it fills out.
  if (u_soft > 0.001) {
    vec2 t = u_texel * 1.25;
    vec3 b = (texture(u_tex, v_uv + vec2(t.x, 0)).rgb + texture(u_tex, v_uv - vec2(t.x, 0)).rgb +
              texture(u_tex, v_uv + vec2(0, t.y)).rgb + texture(u_tex, v_uv - vec2(0, t.y)).rgb) * 0.25;
    c = mix(c, b, u_soft * face);
  }

  // Greying at the temples: only hair-like pixels (darker than the skin, not skin-coloured), in
  // salt-and-pepper strands that run with the head.
  float greyAmt = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 r = v_src - u_grey[i].xy;
    greyAmt += u_grey[i].w * exp(-dot(r, r) * u_grey[i].z);
  }
  if (greyAmt > 0.002) {
    float L = luma(c);
    vec3 chroma = c - L, skinChroma = skin - skinL;
    float hairness = smoothstep(0.03, 0.2, skinL - L) * (1.0 - 0.6 * exp(-dot(chroma - skinChroma, chroma - skinChroma) * 600.0));
    vec2 hp = vec2(dot(v_src, u_across), dot(v_src, u_up)) / u_scale;
    float strands = smoothstep(0.3, 0.8, noise(vec2(hp.x * 90.0, hp.y * 30.0)) * 0.6 + noise(hp * 35.0) * 0.4);
    float m = clamp(greyAmt, 0.0, 1.0) * hairness * (0.3 + 0.7 * strands);
    vec3 grey = vec3(0.4 + 0.5 * L) * vec3(0.97, 0.98, 1.0);
    c = mix(c, grey, m);
  }

  // A little flush on cheeks and nose (only with heavy alcohol or sugar).
  float red = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 r = v_src - u_red[i].xy;
    red += u_red[i].w * exp(-dot(r, r) * u_red[i].z);
  }
  c *= vec3(1.0 + 0.05 * red, 1.0 - 0.025 * red, 1.0 - 0.03 * red);

  // Re-light the new volume: the light comes from above (tilted toward the brighter cheek), so the
  // top of new fullness catches it and the underside falls into shadow. Skin shadows go warmer.
  float lA = luma(skinA), lB = luma(skinB);
  float side = clamp((lB - lA) / (lA + lB + 0.05) * 2.5, -0.6, 0.6);
  vec2 light = normalize(u_up + u_across * side);
  float s = clamp(1.0 - u_shade * dot(v_grad, light), 0.55, 1.25);
  vec3 shadeRGB = s < 1.0 ? pow(vec3(s), vec3(0.85, 1.05, 1.15)) : vec3(s);
  c *= shadeRGB;

  // Time: skin gets a touch duller and less even.
  if (u_age > 0.001) {
    vec2 fp = vec2(dot(v_src, u_across), dot(v_src, u_up)) / u_scale;
    float n = noise(fp * 90.0) * 0.6 + noise(fp * 210.0) * 0.4 - 0.5;
    float a = u_age * face * u_amount;
    float L = luma(c);
    c = mix(c, vec3(L), 0.04 * a);
    c *= 1.0 + n * 0.03 * a;
  }
  // The same soft letterbox edge as the background, so the patch never shows as a rectangle.
  vec2 p = v_src;
  float fade = 1.0;
  if (u_map.x > 1.0) fade *= smoothstep(0.0, 28.0, min(p.x - u_map.x, u_map.x + u_map.z - p.x));
  if (u_map.y > 1.0) fade *= smoothstep(0.0, 28.0, p.y - u_map.y);
  if (u_map.y + u_map.w < u_res.y - 1.0) fade *= smoothstep(0.0, 28.0, u_map.y + u_map.w - p.y);
  o = vec4(mix(vec3(0.02, 0.02, 0.024), c, fade), 1.0);
}`;

const RIB_VS = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_info;          // across -1..1, along 0..1, arclength / face width, seed
in vec2 a_style;         // kind, intensity
uniform vec2 u_res;
${DISPLACE}
out vec4 v_info;
out vec2 v_style;
void main() {
  vec2 grad;
  vec2 q = a_pos + displace(a_pos, grad);
  gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
  v_info = a_info;
  v_style = a_style;
}`;

const RIB_FS = `#version 300 es
precision highp float;
uniform float u_amount;
in vec4 v_info;
in vec2 v_style;
out vec4 o;
float hash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float g2(float x, float w) { return exp(-(x * x) / (w * w)); }
void main() {
  float a = v_info.x, t = v_info.y, len = v_info.z, seed = v_info.w;
  int kind = int(v_style.x + 0.5);
  float k = v_style.y * u_amount;
  float taper = pow(max(0.0, sin(3.14159 * clamp(t, 0.0, 1.0))), 0.7);
  float dark = 0.0, light = 0.0;
  if (kind == 0) {            // fine line: a shallow groove with a soft lit lip above it, uneven along its length
    float wob = (noise(len * 30.0 + seed) - 0.5) * 0.3;
    float aa = a - wob;
    float brk = smoothstep(0.12, 0.55, noise(len * 9.0 + seed * 7.0) * 0.8 + noise(len * 30.0 + seed) * 0.2);
    float thick = 0.75 + 0.5 * noise(len * 6.0 + seed * 3.0);
    dark = g2(aa - 0.05, 0.3 * thick) * brk;
    light = 0.6 * g2(aa + 0.6, 0.35) * brk;
  } else if (kind == 1) {     // fold: a soft valley, shadow on the far side, the full side lit
    float n = 0.9 + 0.2 * noise(len * 4.0 + seed);
    dark = (a > 0.0 ? g2(a - 0.05, 0.6) : g2(a - 0.05, 0.4)) * n;
    light = 0.35 * g2(a + 0.6, 0.45) * n;
  } else if (kind == 2) {     // ambient occlusion band: broad, soft
    dark = g2(a, 0.62);
  } else {                    // soft highlight (puffiness catching the light)
    light = g2(a, 0.6);
  }
  dark *= k * taper;
  light *= k * taper;
  vec3 f = vec3(1.0) - dark * vec3(0.82, 1.0, 1.1) + light * 0.55;
  o = vec4(clamp(f * 0.5, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 5).join('\n'));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw Object.assign(new Error('WebGL2 unavailable'), { name: 'WebGL' });
    this.gl = gl;
    this.flags = {};          // for checking one layer at a time
    this.canvas = canvas;
    this.bg = program(gl, BG_VS, BG_FS);
    this.patch = program(gl, PATCH_VS, PATCH_FS);
    this.rib = program(gl, RIB_VS, RIB_FS);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // The face patch: a grid of GRID_X x GRID_Y cells in 0..1.
    const verts = [];
    for (let y = 0; y <= GRID_Y; y++) for (let x = 0; x <= GRID_X; x++) verts.push(x / GRID_X, y / GRID_Y);
    const idx = [];
    const row = GRID_X + 1;
    for (let y = 0; y < GRID_Y; y++) for (let x = 0; x < GRID_X; x++) {
      const i = y * row + x;
      idx.push(i, i + 1, i + row, i + 1, i + row + 1, i + row);
    }
    this.gridBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.gridIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    this.gridCount = idx.length;

    this.ribBuf = gl.createBuffer();

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.texW = 1;
    this.texH = 1;
    this.anc = new Float32Array(MAX_ANCHORS * 4);
    this.dsp = new Float32Array(MAX_ANCHORS * 4);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  upload(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.texW = source.videoWidth || source.width;
    this.texH = source.videoHeight || source.height;
  }

  /** view: { map: [x, y, w, h], mirror }. passes: [{ rig, scissor: [x0, x1] | null }] */
  draw(view, passes) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    gl.useProgram(this.bg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.bg.u.u_tex, 0);
    gl.uniform2f(this.bg.u.u_res, W, H);
    gl.uniform4fv(this.bg.u.u_map, view.map);
    gl.uniform1f(this.bg.u.u_mirror, view.mirror ? 1 : 0);
    this.drawQuad(this.bg.p);

    for (const pass of passes) {
      const rig = pass.rig;
      if (!rig || rig.amount <= 0.001) continue;
      if (pass.scissor) {
        gl.enable(gl.SCISSOR_TEST);
        const x0 = Math.max(0, Math.floor(pass.scissor[0])), x1 = Math.min(W, Math.ceil(pass.scissor[1]));
        gl.scissor(x0, 0, Math.max(0, x1 - x0), H);
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }
      if (!this.flags.noPatch) this.drawPatch(view, rig, W, H);
      if (!this.flags.noRibbons) this.drawRibbons(rig, W, H);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  setDisplace(prog, rig) {
    const gl = this.gl;
    const n = Math.min(MAX_ANCHORS, rig.anchors.length);
    this.anc.fill(0);
    this.dsp.fill(0);
    for (let i = 0; i < n; i++) {
      const a = rig.anchors[i];
      this.anc.set([a.x, a.y, 1 / (a.sig * a.sig), a.h || 0], i * 4);
      this.dsp.set([a.dx, a.dy, 1 / Math.pow(a.sigH || a.sig, 2), 0], i * 4);
    }
    gl.uniform1i(prog.u.u_count, n);
    gl.uniform4fv(prog.u.u_anc, this.anc);
    gl.uniform4fv(prog.u.u_dsp, this.dsp);
    gl.uniform1f(prog.u.u_amount, rig.amount);
  }

  drawPatch(view, rig, W, H) {
    const gl = this.gl;
    const P = this.patch;
    gl.useProgram(P.p);
    gl.disable(gl.BLEND);
    gl.uniform1i(P.u.u_tex, 0);
    gl.uniform2f(P.u.u_res, W, H);
    gl.uniform4fv(P.u.u_map, view.map);
    gl.uniform1f(P.u.u_mirror, view.mirror ? 1 : 0);
    gl.uniform4fv(P.u.u_rect, rig.rect);
    gl.uniform2f(P.u.u_texel, 1 / this.texW, 1 / this.texH);
    gl.uniform2fv(P.u.u_up, rig.up);
    gl.uniform2fv(P.u.u_across, rig.across);
    gl.uniform2fv(P.u.u_cheekA, rig.uvCheekA);
    gl.uniform2fv(P.u.u_cheekB, rig.uvCheekB);
    gl.uniform2fv(P.u.u_brow, rig.uvBrow);
    gl.uniform1f(P.u.u_shade, rig.shade);
    gl.uniform4fv(P.u.u_face, rig.face);
    gl.uniform1f(P.u.u_soft, rig.soft * rig.amount);
    gl.uniform1f(P.u.u_age, rig.ageTex);
    gl.uniform1f(P.u.u_scale, rig.s);
    gl.uniform4fv(P.u.u_grey, rig.grey);
    gl.uniform4fv(P.u.u_red, rig.red);
    this.setDisplace(P, rig);

    const loc = gl.getAttribLocation(P.p, 'a_grid');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIdx);
    gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_INT, 0);
    gl.disableVertexAttribArray(loc);
  }

  drawRibbons(rig, W, H) {
    if (!rig.ribbons || !rig.ribbons.length) return;
    const gl = this.gl;
    const R = this.rib;
    gl.useProgram(R.p);
    gl.uniform2f(R.u.u_res, W, H);
    this.setDisplace(R, rig);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rig.ribbons, gl.STREAM_DRAW);
    const stride = 8 * 4;
    const lp = gl.getAttribLocation(R.p, 'a_pos');
    const li = gl.getAttribLocation(R.p, 'a_info');
    const ls = gl.getAttribLocation(R.p, 'a_style');
    gl.enableVertexAttribArray(lp);
    gl.enableVertexAttribArray(li);
    gl.enableVertexAttribArray(ls);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(li, 4, gl.FLOAT, false, stride, 8);
    gl.vertexAttribPointer(ls, 2, gl.FLOAT, false, stride, 24);
    // 2x multiply: output 0.5 leaves the pixel as it is, darker darkens, lighter lightens.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
    gl.drawArrays(gl.TRIANGLES, 0, rig.ribbons.length / 8);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(lp);
    gl.disableVertexAttribArray(li);
    gl.disableVertexAttribArray(ls);
  }

  drawQuad(p) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }
}
