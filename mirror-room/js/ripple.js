// Water ripple: a height-field wave simulation on the GPU at quarter resolution.
// Two RGBA16F textures ping-pong: red is the height now, green the height one step ago.
// It runs at a fixed 60 steps a second (at most 3 per frame) and stops 4 s after the last input,
// so an idle mirror costs nothing.

import { FULLSCREEN_VERTEX, createProgram, createTexture, createFramebuffer, bindTexture } from './gl-utils.js';

const DAMPING = 0.978;
const STEP_MS = 1000 / 60;
const MAX_STEPS = 3;
const IDLE_MS = 4000;
const MAX_DROPS = 4;
const MAX_SIDE = 256;

const STEP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec4 uDrops[${MAX_DROPS}];   // x, y (uv, y up), radius (uv of height), strength
uniform int uDropCount;
out vec4 outState;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 here = texture(uState, uv).rg;
  float neighbours = texture(uState, uv + vec2(uTexel.x, 0.0)).r
                   + texture(uState, uv - vec2(uTexel.x, 0.0)).r
                   + texture(uState, uv + vec2(0.0, uTexel.y)).r
                   + texture(uState, uv - vec2(0.0, uTexel.y)).r;
  float height = (neighbours * 0.5 - here.g) * ${DAMPING};
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec4 drop = uDrops[i];
    vec2 d = (uv - drop.xy) * vec2(uAspect, 1.0);
    float r = length(d) / drop.z;
    if (r < 1.0) height += drop.w * (0.5 + 0.5 * cos(3.14159265 * r));
  }
  outState = vec4(height, here.r, 0.0, 1.0);
}`;

export class Ripple {
  constructor(gl) {
    this.gl = gl;
    // Rendering into half floats needs this extension; without it the mirror simply has no ripple.
    this.supported = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.active = false;
    this.lastInput = -Infinity;
    this.lastStep = 0;
    this.drops = new Float32Array(MAX_DROPS * 4);
    this.dropCount = 0;
    this.textures = [];
    this.framebuffers = [];
    this.current = 0;
    this.width = 0;
    this.height = 0;
    this.stageWidth = 1;
    this.stageHeight = 1;
    if (this.supported) this.step = createProgram(gl, FULLSCREEN_VERTEX, STEP_FRAGMENT);
  }

  /** Size the simulation to a quarter of the stage, long side at most 256 texels. */
  resize(stageWidth, stageHeight) {
    this.stageWidth = stageWidth;
    this.stageHeight = stageHeight;
    if (!this.supported) return;
    const scale = Math.min(0.25, MAX_SIDE / Math.max(stageWidth, stageHeight));
    const width = Math.max(1, Math.round(stageWidth * scale));
    const height = Math.max(1, Math.round(stageHeight * scale));
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    for (const f of this.framebuffers) gl.deleteFramebuffer(f);
    this.textures = [0, 1].map(() => createTexture(gl, { width, height, internalFormat: gl.RGBA16F, linear: true }));
    this.framebuffers = this.textures.map((t) => createFramebuffer(gl, t));
    this.width = width;
    this.height = height;
    this.active = false;
  }

  /** Disturb the water at a stage point. `strength` ~0.15–0.3 for a moving pointer, ~0.3 for a strike. */
  touch(x, y, strength, radiusPx, now) {
    if (!this.supported) return;
    if (!this.active) {
      this.clear();
      this.active = true;
      this.lastStep = now;
    }
    this.lastInput = now;
    if (this.dropCount === MAX_DROPS) return;
    const k = this.dropCount++ * 4;
    this.drops[k] = x / this.stageWidth;
    this.drops[k + 1] = 1 - y / this.stageHeight;
    this.drops[k + 2] = radiusPx / this.stageHeight;
    this.drops[k + 3] = strength;
  }

  clear() {
    const gl = this.gl;
    for (const f of this.framebuffers) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Advance the waves. Call once per frame before drawing the mirror. */
  update(now) {
    if (!this.active) return;
    if (now - this.lastInput > IDLE_MS) {
      this.active = false;
      return;
    }
    const steps = Math.min(MAX_STEPS, Math.floor((now - this.lastStep) / STEP_MS));
    if (steps === 0) return;
    this.lastStep = steps === MAX_STEPS ? now : this.lastStep + steps * STEP_MS;

    const gl = this.gl;
    const { program, u } = this.step;
    gl.useProgram(program);
    gl.viewport(0, 0, this.width, this.height);
    gl.uniform2f(u.uStage, this.width, this.height);
    gl.uniform2f(u.uTexel, 1 / this.width, 1 / this.height);
    gl.uniform1f(u.uAspect, this.stageWidth / this.stageHeight);
    gl.uniform4fv(u.uDrops, this.drops);
    for (let i = 0; i < steps; i++) {
      gl.uniform1i(u.uDropCount, i === 0 ? this.dropCount : 0);
      bindTexture(gl, 0, gl.TEXTURE_2D, this.textures[this.current], u.uState);
      this.current = 1 - this.current;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.current]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dropCount = 0;
  }

  /** The texture holding the latest heights. */
  get texture() {
    return this.textures[this.current];
  }
}
