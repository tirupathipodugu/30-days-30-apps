// Mirror renderer: two draw calls per frame.
//   1. Shards: every shard polygon, triangulated into one vertex buffer. Each pixel samples the
//      camera at its own position, moved by its shard's misalignment, then gets the silvered-glass
//      look: cool tint, vignette, Fresnel edges, dust, and a specular glint from the pointer light
//      that each shard catches at its own angle.
//   2. Cracks: a thin quad along every crack segment. It refracts the reflection across the crack
//      with slight RGB separation, darkens the broken edge and draws a bright hairline.

import { createProgram, createTexture, bindTexture, setSampling } from './gl-utils.js';
import { MAX_SHARDS, GPU_ROWS, CRACK_MS } from './shards.js';
import { HISTORY_FPS, HISTORY_LAYERS } from './time-buffer.js';

const MAX_LAG_S = 3;
const LAG_STEP_S = 0.1;
const CRACK_HALF_WIDTH = 2.6;        // px each side of a crack: the hairline, its fringe and its shadow
const CRACK_FLOATS = 9;              // x, y, normal x, normal y, across, along, reach, born, seed

// The mirror image at a stage position: live camera or the time buffer, with a cool silver cast.
const REFLECTION_GLSL = `
uniform vec2 uStage;
uniform sampler2D uCamera;
uniform vec4 uCover;                 // stage px -> camera uv, cover-fitted and flipped like a mirror
uniform bool uTimeOn;
uniform highp sampler2DArray uHistory;
uniform int uHistoryHead;
uniform int uHistoryFilled;
uniform vec2 uFirstImpact;
uniform float uLagStepPx;

vec3 silver(vec3 c) {
  float grey = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(grey), c, 0.9);
  return c * vec3(0.93, 0.965, 1.0) + vec3(0.010, 0.012, 0.016);
}

vec3 reflection(vec2 src, vec2 shardCenter) {
  if (uTimeOn) {
    int lag = int(distance(shardCenter, uFirstImpact) / uLagStepPx) * ${Math.round(LAG_STEP_S * HISTORY_FPS)};
    lag = min(lag, uHistoryFilled - 1);
    if (lag > 0) {
      int layer = (uHistoryHead - 1 - lag + ${HISTORY_LAYERS}) % ${HISTORY_LAYERS};
      return silver(texture(uHistory, vec3(src.x / uStage.x, 1.0 - src.y / uStage.y, float(layer))).rgb);
    }
  }
  return silver(texture(uCamera, src * uCover.xy + uCover.zw).rgb);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

const SHARD_VERTEX = `#version 300 es
in vec2 aPosition;
in float aShard;
uniform vec2 uStage;
out vec2 vStage;
flat out int vShard;
void main() {
  vStage = aPosition;
  vShard = int(aShard);
  vec2 clip = aPosition / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const SHARD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vStage;
flat in int vShard;
out vec4 outColor;
${REFLECTION_GLSL}
uniform sampler2D uShards;           // ${MAX_SHARDS} x ${GPU_ROWS}, see Mirror.writeGpuData
uniform vec3 uLight;                 // pointer light position (stage px, height above the glass)
uniform float uTime;
uniform bool uRippleOn;
uniform sampler2D uRipple;
uniform vec2 uRippleTexel;
uniform float uGlint;                // 0..1 sweep after a restore
uniform sampler2D uTag;
uniform vec4 uTagRect;               // x0, y0, x1, y1 in stage px; zero size = hidden

void main() {
  vec2 p = vStage;
  vec4 look = texelFetch(uShards, ivec2(vShard, 0), 0);
  vec4 facet = texelFetch(uShards, ivec2(vShard, 1), 0);
  vec4 extra = texelFetch(uShards, ivec2(vShard, 2), 0);

  // Water ripple: bends where the glass reflects from.
  vec2 bend = vec2(0.0);
  float sheen = 0.0;
  if (uRippleOn) {
    vec2 uv = vec2(p.x / uStage.x, 1.0 - p.y / uStage.y);
    float l = texture(uRipple, uv - vec2(uRippleTexel.x, 0.0)).r;
    float r = texture(uRipple, uv + vec2(uRippleTexel.x, 0.0)).r;
    float u = texture(uRipple, uv + vec2(0.0, uRippleTexel.y)).r;
    float d = texture(uRipple, uv - vec2(0.0, uRippleTexel.y)).r;
    vec2 slope = vec2(r - l, u - d);
    bend = slope * 16.0;
    sheen = pow(clamp(dot(slope, vec2(-0.6, -0.8)) * 4.0, 0.0, 1.0), 2.0) * 0.25;
  }

  // The shard's own view: twisted about its centre and shifted, as if tipped in its frame.
  vec2 center = facet.xy;
  vec2 q = p - center;
  float c = cos(look.z), s = sin(look.z);
  vec2 src = center + vec2(c * q.x - s * q.y, s * q.x + c * q.y) - look.xy + bend;
  vec3 color = reflection(src, center) * look.w;
  color *= vec3(1.0 + extra.x, 1.0 + extra.x * 0.3, 1.0 - extra.x);

  // Crushed glass near the impact scatters light into a pale frost.
  if (extra.y > 0.0) {
    float sparkle = hash(floor(p * 1.5));
    color = mix(color, vec3(0.62, 0.66, 0.72) + sparkle * 0.25, extra.y);
  }

  // Specular glint: the pointer is a light above the glass; each facet reflects it at its own angle.
  vec3 toLight = normalize(vec3(uLight.xy - p, uLight.z));
  vec3 halfway = normalize(toLight + vec3(0.0, 0.0, 1.0));
  vec3 normal = normalize(vec3(-facet.z, -facet.w, 1.0));
  float spec = pow(max(dot(normal, halfway), 0.0), 900.0);
  color += vec3(0.95, 0.97, 1.0) * spec * 0.22 + sheen;

  // Silvered glass: a soft vignette, Fresnel brightening toward the edges, dust and fine grain.
  vec2 e = p / uStage - 0.5;
  float edge = length(e * vec2(uStage.x / uStage.y, 1.0)) / length(vec2(0.5 * uStage.x / uStage.y, 0.5));
  color *= mix(1.0, 0.72, smoothstep(0.35, 1.05, edge));
  color += vec3(0.75, 0.82, 0.9) * 0.05 * pow(edge, 4.0);
  float dust = step(0.9993, hash(floor(p))) * 0.10 + (hash(floor(p / 9.0)) - 0.5) * 0.012;
  color += dust + (hash(p + fract(uTime) * 61.0) - 0.5) * 0.022;

  // Chipped out: the dark painted backing of the mirror shows through.
  color = mix(vec3(0.035, 0.035, 0.042) + (hash(floor(p)) - 0.5) * 0.02, color, extra.z);

  if (uGlint > 0.0 && uGlint < 1.0) {
    float along = (p.x + p.y) / (uStage.x + uStage.y);
    float band = (along - (uGlint * 1.5 - 0.25)) * 7.0;
    color += 0.16 * exp(-band * band);
  }
  if (p.x >= uTagRect.x && p.y >= uTagRect.y && p.x < uTagRect.z && p.y < uTagRect.w) {
    vec4 tag = texture(uTag, (p - uTagRect.xy) / (uTagRect.zw - uTagRect.xy));
    color = mix(color, tag.rgb, tag.a);
  }
  outColor = vec4(color, 1.0);
}`;

const CRACK_VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aNormal;
in float aAcross;
in vec3 aTiming;                     // along (px from the impact), reach of that impact, born at (ms)
in float aSeed;
uniform vec2 uStage;
out vec2 vStage;
out vec2 vNormal;
out float vAcross;
out vec3 vTiming;
out float vSeed;
void main() {
  vStage = aPosition;
  vNormal = aNormal;
  vAcross = aAcross;
  vTiming = aTiming;
  vSeed = aSeed;
  vec2 clip = aPosition / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const CRACK_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vStage;
in vec2 vNormal;
in float vAcross;
in vec3 vTiming;
in float vSeed;
out vec4 outColor;
${REFLECTION_GLSL}
uniform float uNow;
uniform float uCrackMs;
uniform float uHeal;
uniform vec3 uLight;

void main() {
  // The crack front races out and eases off, like real fracture; a restore draws it back in.
  float t = uCrackMs > 0.0 ? clamp((uNow - vTiming.z) / uCrackMs, 0.0, 1.0) : 1.0;
  float front = 1.0 - pow(1.0 - t, 3.0);
  float along = vTiming.x / vTiming.y;
  if (along > front + 0.001 || along > 1.0 - uHeal + 0.001) discard;

  float x = vAcross * ${CRACK_HALF_WIDTH.toFixed(2)};          // px from the crack's centre line
  float shadow = exp(-x * x / 2.4);
  float core = exp(-x * x / 0.16);

  // Refraction: the broken edge bends the reflection, splitting it slightly into red and blue.
  vec2 bent = vStage + vNormal * sign(x) * 1.6 * shadow;
  vec3 refracted = vec3(
    reflection(bent + vNormal * 1.0, vStage).r,
    reflection(bent, vStage).g,
    reflection(bent - vNormal * 1.0, vStage).b);

  // Cracks catch the light when they face it, and shine brightest where the glass is chipped.
  vec2 toLight = normalize(uLight.xy - vStage + 0.001);
  float facing = pow(abs(dot(vNormal, toLight)), 3.0);
  float bright = (0.45 + 0.55 * vSeed) * (0.55 + 0.75 * facing) * (1.0 + 0.7 * exp(-vTiming.x / 30.0));
  float red = exp(-(x - 0.9) * (x - 0.9) / 0.3);
  float blue = exp(-(x + 0.9) * (x + 0.9) / 0.3);

  vec3 color = refracted * (1.0 - 0.45 * shadow)
             + vec3(1.0) * core * bright
             + (vec3(1.0, 0.45, 0.35) * red + vec3(0.35, 0.55, 1.0) * blue) * 0.22 * bright;
  outColor = vec4(color, clamp(shadow * 0.9 + core, 0.0, 1.0) * (1.0 - uHeal * 0.6));
}`;

export class MirrorRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.canvas = canvas;
    this.shardProgram = createProgram(gl, SHARD_VERTEX, SHARD_FRAGMENT);
    this.crackProgram = createProgram(gl, CRACK_VERTEX, CRACK_FRAGMENT);

    this.shardData = new Float32Array(MAX_SHARDS * GPU_ROWS * 4);
    this.shardTexture = createTexture(gl, { width: MAX_SHARDS, height: GPU_ROWS, internalFormat: gl.RGBA32F });
    this.meshVersion = -1;
    this.shardVertices = 0;
    this.crackVertices = 0;
    this.shardMesh = this.createMesh(this.shardProgram.program, [['aPosition', 2], ['aShard', 1]]);
    this.crackMesh = this.createMesh(this.crackProgram.program,
      [['aPosition', 2], ['aNormal', 2], ['aAcross', 1], ['aTiming', 3], ['aSeed', 1]]);

    this.cameraTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
    setSampling(gl, gl.TEXTURE_2D, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.cover = new Float32Array(4);
    this.sourceWidth = 0;
    this.sourceHeight = 0;

    this.tagTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tagTexture);
    setSampling(gl, gl.TEXTURE_2D, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.tagWidth = 0;
    this.tagHeight = 0;

    // A 1-layer placeholder so the history sampler is always valid, even before Time is used.
    this.emptyHistory = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emptyHistory);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    setSampling(gl, gl.TEXTURE_2D_ARRAY, false);

    this.stageWidth = 1;
    this.stageHeight = 1;
  }

  /** A vertex array with one interleaved float buffer, laid out as [name, size] attributes. */
  createMesh(program, layout) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = layout.reduce((sum, [, size]) => sum + size, 0) * 4;
    let offset = 0;
    for (const [name, size] of layout) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      offset += size * 4;
    }
    gl.bindVertexArray(null);
    return { vao, buffer };
  }

  /** Match the canvas to the stage size (in CSS px) at the device's pixel ratio, capped at 2. */
  resize(stageWidth, stageHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(stageWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(stageHeight * dpr));
    this.stageWidth = stageWidth;
    this.stageHeight = stageHeight;
    this.updateCover();
  }

  /** Upload the newest camera (or demo) frame. */
  uploadFrame(source, width, height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
      this.sourceWidth = width;
      this.sourceHeight = height;
      this.updateCover();
    }
  }

  /** Cover-fit the camera to the stage and flip it horizontally, as a stage px -> uv transform. */
  updateCover() {
    const w = this.sourceWidth || 1;
    const h = this.sourceHeight || 1;
    const scale = Math.max(this.stageWidth / w, this.stageHeight / h);
    const offsetX = (this.stageWidth - w * scale) / 2;
    const offsetY = (this.stageHeight - h * scale) / 2;
    this.cover[0] = -1 / (w * scale);
    this.cover[1] = 1 / (h * scale);
    this.cover[2] = 1 + offsetX / (w * scale);
    this.cover[3] = -offsetY / (h * scale);
  }

  /** Draw a small text label into a texture, shown in a corner of the picture (used on recordings). */
  setTag(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '300 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 8;
    canvas.height = 34;
    ctx.font = font;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, canvas.height / 2);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tagTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.tagWidth = canvas.width / 2;
    this.tagHeight = canvas.height / 2;
  }

  /** Rebuild both vertex buffers. Only needed when the glass breaks or is restored. */
  rebuildMeshes(mirror) {
    const gl = this.gl;
    const shards = mirror.buildMesh();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shardMesh.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, shards, gl.STATIC_DRAW);
    this.shardVertices = shards.length / 3;

    let segments = 0;
    for (const c of mirror.cracks) segments += c.points.length - 1;
    const data = new Float32Array(segments * 6 * CRACK_FLOATS);
    let k = 0;
    const vertex = (p, nx, ny, across, impact, seed) => {
      data[k++] = p.x + nx * across * CRACK_HALF_WIDTH;
      data[k++] = p.y + ny * across * CRACK_HALF_WIDTH;
      data[k++] = nx;
      data[k++] = ny;
      data[k++] = across;
      data[k++] = p.along;
      data[k++] = impact.reach;
      data[k++] = impact.at;
      data[k++] = seed;
    };
    for (const { points, impact } of mirror.cracks) {
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
        // Overlap neighbouring segments a little so kinks have no gaps.
        const tx = ((b.x - a.x) / length) * 0.6, ty = ((b.y - a.y) / length) * 0.6;
        const a2 = { x: a.x - tx, y: a.y - ty, along: a.along };
        const b2 = { x: b.x + tx, y: b.y + ty, along: b.along };
        const seed = Math.random();
        vertex(a2, nx, ny, -1, impact, seed);
        vertex(b2, nx, ny, -1, impact, seed);
        vertex(b2, nx, ny, 1, impact, seed);
        vertex(a2, nx, ny, -1, impact, seed);
        vertex(b2, nx, ny, 1, impact, seed);
        vertex(a2, nx, ny, 1, impact, seed);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.crackMesh.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.crackVertices = segments * 6;
    this.meshVersion = mirror.version;
  }

  /** Point a program at the shared reflection inputs (camera, time buffer). */
  bindReflection(u, state) {
    const gl = this.gl;
    const { mirror, timeBuffer } = state;
    gl.uniform2f(u.uStage, this.stageWidth, this.stageHeight);
    gl.uniform4fv(u.uCover, this.cover);
    bindTexture(gl, 0, gl.TEXTURE_2D, this.cameraTexture, u.uCamera);
    const timeOn = state.timeOn && timeBuffer.filled > 1;
    gl.uniform1i(u.uTimeOn, timeOn ? 1 : 0);
    bindTexture(gl, 1, gl.TEXTURE_2D_ARRAY, timeOn ? timeBuffer.texture : this.emptyHistory, u.uHistory);
    gl.uniform1i(u.uHistoryHead, timeBuffer.head);
    gl.uniform1i(u.uHistoryFilled, timeBuffer.filled);
    const first = mirror.impacts[0] || { x: mirror.width / 2, y: mirror.height / 2 };
    const farthest = Math.hypot(Math.max(first.x, mirror.width - first.x), Math.max(first.y, mirror.height - first.y));
    gl.uniform2f(u.uFirstImpact, first.x, first.y);
    gl.uniform1f(u.uLagStepPx, Math.max(1, farthest / (MAX_LAG_S / LAG_STEP_S)));
    gl.uniform3fv(u.uLight, state.light);
  }

  /**
   * Draw one frame. `state` carries everything that changes per frame:
   * mirror, now, ripple, timeBuffer, timeOn, light [x, y, height], glint, tagOn.
   */
  render(state) {
    const { mirror, now, ripple, timeBuffer } = state;
    const gl = this.gl;
    if (mirror.version !== this.meshVersion) this.rebuildMeshes(mirror);

    mirror.writeGpuData(now, this.shardData);
    gl.bindTexture(gl.TEXTURE_2D, this.shardTexture);
    for (let row = 0; row < GPU_ROWS; row++) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, mirror.shards.length, 1, gl.RGBA, gl.FLOAT,
        this.shardData, row * MAX_SHARDS * 4);
    }

    if (state.timeOn) timeBuffer.record(now, this.cameraTexture, this.cover, this.stageWidth, this.stageHeight);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.027, 0.027, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 1. Shards
    let { program, u } = this.shardProgram;
    gl.useProgram(program);
    this.bindReflection(u, state);
    bindTexture(gl, 2, gl.TEXTURE_2D, this.shardTexture, u.uShards);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1i(u.uRippleOn, ripple.active ? 1 : 0);
    bindTexture(gl, 3, gl.TEXTURE_2D, ripple.active ? ripple.texture : this.cameraTexture, u.uRipple);
    gl.uniform2f(u.uRippleTexel, 1 / Math.max(1, ripple.width), 1 / Math.max(1, ripple.height));
    gl.uniform1f(u.uGlint, state.glint);
    bindTexture(gl, 4, gl.TEXTURE_2D, this.tagTexture, u.uTag);
    if (state.tagOn && this.tagWidth) {
      const x1 = this.stageWidth - 14;
      const y1 = this.stageHeight - 14;
      gl.uniform4f(u.uTagRect, x1 - this.tagWidth, y1 - this.tagHeight, x1, y1);
    } else {
      gl.uniform4f(u.uTagRect, 0, 0, 0, 0);
    }
    gl.bindVertexArray(this.shardMesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.shardVertices);

    // 2. Cracks, blended over the glass
    if (this.crackVertices) {
      ({ program, u } = this.crackProgram);
      gl.useProgram(program);
      this.bindReflection(u, state);
      gl.uniform1f(u.uNow, now);
      gl.uniform1f(u.uCrackMs, mirror.reduced ? 0 : CRACK_MS);
      gl.uniform1f(u.uHeal, mirror.healProgress(now));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.crackMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.crackVertices);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
