// Mirror renderer: draws every piece of glass in a single full-screen draw call.
// Piece data lives in a float texture (one texel per piece per row). A 64x64 grid of cells lists
// which pieces may cover each cell, so every pixel only tests a handful of pieces. Each pixel finds
// its piece, then samples the camera at the piece's home position plus its small shard misalignment.

import { FULLSCREEN_VERTEX, createProgram, createTexture, bindTexture, setSampling } from './gl-utils.js';
import { MAX_PIECES, GPU_ROWS } from './pieces.js';
import { HISTORY_FPS, HISTORY_LAYERS } from './time-buffer.js';

const GRID = 64;                     // cells per side of the lookup grid
const LIST_SIDE = 256;               // the flat list of piece ids is stored as a 256x256 texture
const LIST_CAPACITY = LIST_SIDE * LIST_SIDE;
const CELL_MARGIN = 6;               // px: pieces wobble and slide a little past their home
const MAX_LAG_S = 3;
const LAG_STEP_S = 0.1;

const MIRROR_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2DArray;

in vec2 vStage;
out vec4 outColor;

uniform vec2 uStage;
uniform sampler2D uCamera;
uniform vec4 uCover;               // stage px -> camera uv, cover-fitted and flipped like a mirror
uniform sampler2D uPieces;         // ${MAX_PIECES} x ${GPU_ROWS}: rect / look / crack, see pieces.js
uniform usampler2D uCells;         // ${GRID} x ${GRID}: (first, count) into uList
uniform usampler2D uList;          // piece ids, ${LIST_SIDE} per row
uniform float uCrackStrength;

uniform bool uTimeOn;
uniform sampler2DArray uHistory;
uniform int uHistoryHead;
uniform int uHistoryFilled;
uniform vec2 uFirstCenter;
uniform float uLagStepPx;

uniform bool uRippleOn;
uniform sampler2D uRipple;
uniform vec2 uRippleTexel;
uniform vec3 uPointerGlow;         // x, y, strength: the reduced-motion stand-in for ripples

uniform float uGlint;              // 0..1 sweep after reassembly, outside that range = off
uniform vec4 uRing;                // x, y, radius, strength
uniform sampler2D uTag;
uniform vec4 uTagRect;             // x0, y0, x1, y1 in stage px; zero size = hidden

const vec3 BACKGROUND = vec3(7.0, 7.0, 11.0) / 255.0;

int findPiece(vec2 p) {
  ivec2 cell = clamp(ivec2(p / uStage * float(${GRID})), ivec2(0), ivec2(${GRID - 1}));
  uvec2 range = texelFetch(uCells, cell, 0).rg;
  for (uint i = 0u; i < 32u; i++) {
    if (i >= range.y) break;
    uint k = range.x + i;
    int id = int(texelFetch(uList, ivec2(k % ${LIST_SIDE}u, k / ${LIST_SIDE}u), 0).r);
    vec4 r = texelFetch(uPieces, ivec2(id, 0), 0);
    if (p.x >= r.x && p.y >= r.y && p.x < r.z && p.y < r.w) return id;
  }
  return -1;
}

// Live camera, or a past frame from the time buffer for pieces far from the first piece.
vec3 reflection(vec2 src, vec2 pieceCenter) {
  if (uTimeOn) {
    int lag = int(distance(pieceCenter, uFirstCenter) / uLagStepPx) * ${Math.round(LAG_STEP_S * HISTORY_FPS)};
    lag = min(lag, uHistoryFilled - 1);
    if (lag > 0) {
      int layer = (uHistoryHead - 1 - lag + ${HISTORY_LAYERS}) % ${HISTORY_LAYERS};
      return texture(uHistory, vec3(src.x / uStage.x, 1.0 - src.y / uStage.y, float(layer))).rgb;
    }
  }
  return texture(uCamera, src * uCover.xy + uCover.zw).rgb;
}

// 1 px bright line along each side that is a crack; the newest crack is revealed outward from its origin.
float crackLine(vec2 p, vec4 r, vec4 crack) {
  float line = 0.0;
  vec4 dist = vec4(p.x - r.x, p.y - r.y, r.z - p.x, r.w - p.y);
  bvec4 inner = bvec4(r.x > 0.5, r.y > 0.5, r.z < uStage.x - 0.5, r.w < uStage.y - 0.5);
  for (int e = 0; e < 4; e++) {
    if (!inner[e] || dist[e] >= 1.0) continue;
    if (e == int(crack.w) && distance(p, crack.xy) > crack.z) continue;
    line = 1.0;
  }
  return line;
}

void main() {
  vec2 p = vStage;
  vec3 color = BACKGROUND;

  // Water: bend where the glass reflects from and add a highlight on the wave slopes.
  vec2 bend = vec2(0.0);
  float shine = 0.0;
  if (uRippleOn) {
    vec2 uv = vec2(p.x / uStage.x, 1.0 - p.y / uStage.y);
    float l = texture(uRipple, uv - vec2(uRippleTexel.x, 0.0)).r;
    float r = texture(uRipple, uv + vec2(uRippleTexel.x, 0.0)).r;
    float up = texture(uRipple, uv + vec2(0.0, uRippleTexel.y)).r;
    float down = texture(uRipple, uv - vec2(0.0, uRippleTexel.y)).r;
    vec2 slope = vec2(r - l, up - down);
    bend = slope * 18.0;
    float s = clamp(dot(slope, vec2(-0.6, -0.8)) * 5.0, 0.0, 1.0);
    shine = s * s * 0.4;
  }

  int id = findPiece(p);
  if (id >= 0) {
    vec4 rect = texelFetch(uPieces, ivec2(id, 0), 0);
    vec4 look = texelFetch(uPieces, ivec2(id, 1), 0);
    vec4 crack = texelFetch(uPieces, ivec2(id, 2), 0);
    vec2 center = (rect.xy + rect.zw) * 0.5;
    vec2 d = p - center;
    float c = cos(look.z), s = sin(look.z);
    vec2 src = center + vec2(c * d.x - s * d.y, s * d.x + c * d.y) - look.xy + bend;
    color = reflection(src, center) * look.w + shine;
    color = mix(color, vec3(1.0), 0.6 * uCrackStrength * crackLine(p, rect, crack));
  }

  if (uPointerGlow.z > 0.0) {
    vec2 g = (p - uPointerGlow.xy) / 110.0;
    color += 0.09 * uPointerGlow.z * exp(-dot(g, g));
  }
  if (uGlint > 0.0 && uGlint < 1.0) {
    float along = (p.x + p.y) / (uStage.x + uStage.y);
    float band = (along - (uGlint * 1.5 - 0.25)) * 9.0;
    color += 0.3 * exp(-band * band);
  }
  if (uRing.w > 0.0) {
    float ring = (distance(p, uRing.xy) - uRing.z) / 14.0;
    color += uRing.w * exp(-ring * ring) * vec3(0.85, 0.97, 1.0);
  }
  if (p.x >= uTagRect.x && p.y >= uTagRect.y && p.x < uTagRect.z && p.y < uTagRect.w) {
    vec4 tag = texture(uTag, (p - uTagRect.xy) / (uTagRect.zw - uTagRect.xy));
    color = mix(color, tag.rgb, tag.a);
  }
  outColor = vec4(color, 1.0);
}`;

export class MirrorRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.canvas = canvas;
    this.draw = createProgram(gl, FULLSCREEN_VERTEX, MIRROR_FRAGMENT);

    this.pieceData = new Float32Array(MAX_PIECES * GPU_ROWS * 4);
    this.pieceTexture = createTexture(gl, { width: MAX_PIECES, height: GPU_ROWS, internalFormat: gl.RGBA32F });
    this.cellData = new Uint16Array(GRID * GRID * 2);
    this.cellTexture = createTexture(gl, { width: GRID, height: GRID, internalFormat: gl.RG16UI });
    this.listData = new Uint16Array(LIST_CAPACITY);
    this.listTexture = createTexture(gl, { width: LIST_SIDE, height: LIST_SIDE, internalFormat: gl.R16UI });
    this.indexedVersion = -1;

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

  /** Cover-fit the camera to the stage once and flip it horizontally, as a stage px -> uv transform. */
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
    const font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 32;
    canvas.height = 46;
    ctx.font = font;
    ctx.fillStyle = 'rgba(7, 7, 11, 0.6)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 23);
    ctx.fill();
    ctx.fillStyle = '#F2F3F7';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16, canvas.height / 2 + 1);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tagTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.tagWidth = canvas.width / 2;      // drawn at half size, so it stays crisp on 2x screens
    this.tagHeight = canvas.height / 2;
  }

  /** Rebuild the 64x64 "which pieces cover this cell" index. Only needed when pieces are added or removed. */
  rebuildIndex(mirror) {
    const cells = this.cellData;
    const list = this.listData;
    const cellW = mirror.width / GRID;
    const cellH = mirror.height / GRID;
    const span = (p) => [
      Math.max(0, Math.floor((p.x - CELL_MARGIN) / cellW)),
      Math.max(0, Math.floor((p.y - CELL_MARGIN) / cellH)),
      Math.min(GRID - 1, Math.floor((p.x + p.w + CELL_MARGIN) / cellW)),
      Math.min(GRID - 1, Math.floor((p.y + p.h + CELL_MARGIN) / cellH)),
    ];
    // Pass 1: count pieces per cell. Pass 2: turn counts into start offsets. Pass 3: fill the list.
    // Pieces are at least 28 px, so even 512 of them fill well under the list's 65,536 slots.
    cells.fill(0);
    const spans = mirror.pieces.map(span);
    for (const [x0, y0, x1, y1] of spans) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[(y * GRID + x) * 2 + 1]++;
    }
    let start = 0;
    for (let c = 0; c < GRID * GRID; c++) {
      cells[c * 2] = start;
      start += cells[c * 2 + 1];
      cells[c * 2 + 1] = 0;
    }
    spans.forEach(([x0, y0, x1, y1], id) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const c = (y * GRID + x) * 2;
          list[cells[c] + cells[c + 1]++] = id;
        }
      }
    });

    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID, GRID, gl.RG_INTEGER, gl.UNSIGNED_SHORT, cells);
    const rows = Math.max(1, Math.ceil(start / LIST_SIDE));
    gl.bindTexture(gl.TEXTURE_2D, this.listTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LIST_SIDE, rows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, list, 0);
    this.indexedVersion = mirror.version;
  }

  /**
   * Draw one frame. `state` carries everything that changes per frame:
   * mirror, now, ripple, timeBuffer, timeOn, pointerGlow [x, y, strength], glint, ring [x, y, r, a], tagOn.
   */
  render(state) {
    const { mirror, now, ripple, timeBuffer } = state;
    const gl = this.gl;
    if (mirror.version !== this.indexedVersion) this.rebuildIndex(mirror);

    mirror.writeGpuData(now, this.pieceData);
    gl.bindTexture(gl.TEXTURE_2D, this.pieceTexture);
    for (let row = 0; row < GPU_ROWS; row++) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, mirror.count, 1, gl.RGBA, gl.FLOAT,
        this.pieceData, row * MAX_PIECES * 4);
    }

    if (state.timeOn) timeBuffer.record(now, this.cameraTexture, this.cover, this.stageWidth, this.stageHeight);

    const { program, u } = this.draw;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.uniform2f(u.uStage, this.stageWidth, this.stageHeight);
    gl.uniform4fv(u.uCover, this.cover);
    gl.uniform1f(u.uCrackStrength, mirror.crackStrength(now));
    bindTexture(gl, 0, gl.TEXTURE_2D, this.cameraTexture, u.uCamera);
    bindTexture(gl, 1, gl.TEXTURE_2D, this.pieceTexture, u.uPieces);
    bindTexture(gl, 2, gl.TEXTURE_2D, this.cellTexture, u.uCells);
    bindTexture(gl, 3, gl.TEXTURE_2D, this.listTexture, u.uList);

    const timeOn = state.timeOn && timeBuffer.filled > 1;
    gl.uniform1i(u.uTimeOn, timeOn ? 1 : 0);
    bindTexture(gl, 4, gl.TEXTURE_2D_ARRAY, timeOn ? timeBuffer.texture : this.emptyHistory, u.uHistory);
    gl.uniform1i(u.uHistoryHead, timeBuffer.head);
    gl.uniform1i(u.uHistoryFilled, timeBuffer.filled);
    const first = mirror.pieces[0];
    const firstX = first.x + first.w / 2;
    const firstY = first.y + first.h / 2;
    const farthest = Math.hypot(Math.max(firstX, mirror.width - firstX), Math.max(firstY, mirror.height - firstY));
    gl.uniform2f(u.uFirstCenter, firstX, firstY);
    gl.uniform1f(u.uLagStepPx, Math.max(1, farthest / (MAX_LAG_S / LAG_STEP_S)));

    gl.uniform1i(u.uRippleOn, ripple.active ? 1 : 0);
    bindTexture(gl, 5, gl.TEXTURE_2D, ripple.active ? ripple.texture : this.cameraTexture, u.uRipple);
    gl.uniform2f(u.uRippleTexel, 1 / Math.max(1, ripple.width), 1 / Math.max(1, ripple.height));
    gl.uniform3fv(u.uPointerGlow, state.pointerGlow);

    gl.uniform1f(u.uGlint, state.glint);
    gl.uniform4fv(u.uRing, state.ring);
    bindTexture(gl, 6, gl.TEXTURE_2D, this.tagTexture, u.uTag);
    if (state.tagOn && this.tagWidth) {
      const x1 = this.stageWidth - 12;
      const y1 = this.stageHeight - 12;
      gl.uniform4f(u.uTagRect, x1 - this.tagWidth, y1 - this.tagHeight, x1, y1);
    } else {
      gl.uniform4f(u.uTagRect, 0, 0, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
