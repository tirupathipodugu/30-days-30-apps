// Time buffer: the last 3 s of mirror frames kept on the GPU, for the Time toggle.
// A texture array used as a ring: 20 frames a second, 60 layers, sized to stay under 40 MB.
// Each layer stores the mirror image already fitted to the stage, so pieces sample it by stage position.

import { FULLSCREEN_VERTEX, createProgram, setSampling, bindTexture } from './gl-utils.js';

export const HISTORY_FPS = 20;
export const HISTORY_LAYERS = 60;               // 3 s
const BUDGET_BYTES = 40 * 1024 * 1024;
const FRAME_MS = 1000 / HISTORY_FPS;

const CAPTURE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCamera;
uniform vec4 uCover;
in vec2 vStage;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uCamera, vStage * uCover.xy + uCover.zw).rgb, 1.0);
}`;

export class TimeBuffer {
  constructor(gl) {
    this.gl = gl;
    this.capture = createProgram(gl, FULLSCREEN_VERTEX, CAPTURE_FRAGMENT);
    this.texture = null;
    this.framebuffer = gl.createFramebuffer();
    this.width = 0;
    this.height = 0;
    this.head = 0;                              // next layer to write
    this.filled = 0;                            // layers holding real frames
    this.lastCapture = -Infinity;
  }

  /** Allocate (or re-allocate) layers matching the stage's shape. Only called while Time is on. */
  allocate(stageWidth, stageHeight) {
    const area = BUDGET_BYTES / (HISTORY_LAYERS * 4);
    const aspect = stageWidth / stageHeight;
    const height = Math.min(Math.floor(Math.sqrt(area / aspect)), Math.ceil(stageHeight));
    const width = Math.min(Math.floor(height * aspect), Math.ceil(stageWidth));
    this.filled = 0;
    if (this.texture && width === this.width && height === this.height) return;
    const gl = this.gl;
    this.release();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, HISTORY_LAYERS);
    setSampling(gl, gl.TEXTURE_2D_ARRAY, true);
    this.width = width;
    this.height = height;
  }

  release() {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = null;
    this.width = 0;
    this.height = 0;
    this.filled = 0;
  }

  /** Copy the current mirror image into the ring, at most 20 times a second. */
  record(now, cameraTexture, cover, stageWidth, stageHeight) {
    if (!this.texture || now - this.lastCapture < FRAME_MS) return;
    this.lastCapture = now;
    const gl = this.gl;
    const { program, u } = this.capture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, 0, this.head);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    gl.uniform2f(u.uStage, stageWidth, stageHeight);
    gl.uniform4fv(u.uCover, cover);
    bindTexture(gl, 0, gl.TEXTURE_2D, cameraTexture, u.uCamera);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.head = (this.head + 1) % HISTORY_LAYERS;
    this.filled = Math.min(this.filled + 1, HISTORY_LAYERS);
  }
}
