// Blocking the threads: where each block sits, what it shuts off downstream, the clot markers, and how much of
// the circulation is cut off (the load the heart has to fight).

import * as THREE from 'three';

const CLOT_VERT = /* glsl */`
uniform float uTime, uPx;
varying vec3 vN;
varying float vBeat;
void main() {
  vN = normalize(normalMatrix * normal);
  // A slow throb, like pressure pushing against it.
  float throb = 1.0 + 0.08 * sin(uTime * 6.0);
  vec4 mv = modelViewMatrix * vec4(position * throb, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const CLOT_FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float ndl = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.5);
  float spec = pow(max(dot(reflect(-normalize(vec3(-0.4, 0.6, 0.7)), n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  vec3 col = vec3(0.2, 0.015, 0.02) * (0.4 + 0.9 * ndl) + vec3(0.85, 0.16, 0.14) * rim + vec3(0.9, 0.75, 0.7) * spec * 0.6;
  gl_FragColor = vec4(col, uOpacity);
}`;

export class Blockage {
  constructor(scene) {
    this.scene = scene;
    this.blocks = [];   // { path, s, pos: Vector3, mesh }
    this.paths = null;
    this.load = 0;
    this.listeners = [];
    this.clotGeo = new THREE.SphereGeometry(1, 20, 14);
    this.clotGeo.scale(1.25, 0.85, 0.85);   // a little elongated, along the thread
    this.clotMat = new THREE.ShaderMaterial({
      vertexShader: CLOT_VERT, fragmentShader: CLOT_FRAG,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true, depthTest: false,
    });
  }

  onChange(fn) { this.listeners.push(fn); }

  /** New threads (after a resize): old blocks cannot be mapped onto new paths, so they are cleared. */
  setThreads(threads) {
    const had = this.blocks.length > 0;
    this.clear(false);
    this.threads = threads;
    this.paths = threads.paths;
    const n = this.paths.length;
    this.len = new Float32Array(n);
    this.sEnd = new Float32Array(n);
    this.rootLen = new Float32Array(8);
    for (const p of this.paths) {
      let l = 0;
      for (let i = 1; i < p.pts.length; i++) l += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1], p.pts[i][2] - p.pts[i - 1][2]);
      this.len[p.id] = l;
      this.sEnd[p.id] = p.s0 + l;
      this.rootLen[p.root] += l;
    }
    this.apply(had);
  }

  /** The clot nearest a screen point, if any (within r px). */
  clotAt(x, y, project, r) {
    let best = null, bd = r * r;
    for (const b of this.blocks) {
      const p = project(b.pos);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  add(pathId, s, pos, sizeWorld) {
    const mesh = new THREE.Mesh(this.clotGeo, this.clotMat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(sizeWorld);
    // Line the clot up with its thread.
    const p = this.paths[pathId];
    let best = 0, bd = Infinity;
    for (let i = 0; i < p.pts.length; i++) {
      const d = (p.pts[i][0] - pos.x) ** 2 + (p.pts[i][1] - pos.y) ** 2 + (p.pts[i][2] - pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const a = p.pts[Math.max(0, best - 1)], b = p.pts[Math.min(p.pts.length - 1, best + 1)];
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (dir.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    this.blocks.push({ path: pathId, s, pos: pos.clone(), mesh });
    this.apply(true);
  }

  remove(block) {
    this.scene.remove(block.mesh);
    this.blocks = this.blocks.filter((b) => b !== block);
    this.apply(true);
  }

  clear(notify = true) {
    for (const b of this.blocks) this.scene.remove(b.mesh);
    this.blocks = [];
    if (this.paths) this.apply(notify);
  }

  setClotSize(sizeWorld) { for (const b of this.blocks) b.mesh.scale.setScalar(sizeWorld); }

  /** Work out where flow stops on every path, write it to the shader, and recompute the load. */
  apply(notify) {
    const n = this.paths.length;
    const eff = new Float32Array(n).fill(1e6);
    const rootShut = new Uint8Array(8);
    for (const b of this.blocks) {
      eff[b.path] = Math.min(eff[b.path], b.s);
      // A block on a main trunk shuts that trunk's whole network.
      if (this.paths[b.path].trunk) rootShut[this.paths[b.path].root] = 1;
    }
    // Parents come before their children: a branch that leaves past a block gets nothing at all.
    for (const p of this.paths) {
      if (rootShut[p.root] && !p.trunk) eff[p.id] = Math.min(eff[p.id], p.s0);
      if (p.parent >= 0 && eff[p.parent] <= p.s0) eff[p.id] = Math.min(eff[p.id], p.s0);
    }
    const tex = this.threads.material.uniforms.uBlockTex.value;
    tex.image.data.fill(1e6);
    tex.image.data.set(eff);
    tex.needsUpdate = true;
    // Load: per trunk, the share of its thread length past a block (all of it once the trunk itself is blocked);
    // the heart feels the mean over the six trunks.
    const cut = new Float32Array(8);
    for (const p of this.paths) {
      const blocked = Math.min(this.len[p.id], Math.max(0, this.sEnd[p.id] - Math.max(eff[p.id], p.s0)));
      cut[p.root] += blocked;
    }
    let sum = 0, roots = 0;
    for (let r = 0; r < 8; r++) if (this.rootLen[r] > 0) { sum += rootShut[r] ? 1 : cut[r] / this.rootLen[r]; roots++; }
    this.load = roots ? sum / roots : 0;
    if (notify) for (const fn of this.listeners) fn(this.load);
  }

  update(t, fade) {
    this.clotMat.uniforms.uTime.value = t;
    this.clotMat.uniforms.uOpacity.value = fade;
  }
}
