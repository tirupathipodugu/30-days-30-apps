// World life: a sky that fades from deep blue to a pale horizon, a square sun, flat blocky clouds that
// drift overhead, leaves that sway a little, water that ripples and glow blocks that flicker softly.

import * as THREE from 'three';

export function createLife(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // Sky dome: a big sphere with a vertical gradient. It follows the camera so it never gets closer.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3b7fd8) }, horizon: { value: new THREE.Color(0xbcdcf6) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(t, 0.8)), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), skyMat);
  sky.renderOrder = -2;
  group.add(sky);

  // Square sun.
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false, depthWrite: false }));
  sun.renderOrder = -1;
  group.add(sun);
  const sunDir = new THREE.Vector3(0.55, 0.62, -0.56).normalize();

  // Clouds: flat white slabs on a grid, shaped by simple value noise, drifting slowly.
  const cloudGeo = new THREE.BoxGeometry(6, 1.6, 6);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false });
  const cells = [];
  const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const N = 44;
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) if (noise(i / 4, k / 4) > 0.62) cells.push([i, k]);
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cells.length);
  clouds.frustumCulled = false;
  group.add(clouds);
  let cloudY = 60, cloudShift = 0;
  const m4 = new THREE.Matrix4();

  // Animated materials get a small shader tweak once.
  const time = { value: 0 };
  function sway(mat) {
    if (mat.userData.sway) return;
    mat.userData.sway = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float w = sin(uTime * 1.7 + ip.x * 0.6 + ip.z * 0.4) * 0.05 + sin(uTime * 2.9 + ip.y) * 0.02;
          transformed.x += w * (position.y + 0.5);
          transformed.z += w * 0.6 * (position.y + 0.5);
        #endif`);
    };
    mat.needsUpdate = true;
  }

  function setWorld(bounds, skyColor) {
    cloudY = bounds.max.y + 26;
    if (skyColor) {
      skyMat.uniforms.horizon.value.copy(skyColor).lerp(new THREE.Color(1, 1, 1), 0.35);
      skyMat.uniforms.top.value.copy(skyColor).multiplyScalar(0.75);
    }
  }

  function update(dt, camera, pool) {
    time.value += dt;
    sky.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 500);
    sun.lookAt(camera.position);
    cloudShift = (cloudShift + dt * 1.2) % 6;
    const half = (N * 6) / 2;
    cells.forEach(([i, k], n) => {
      let x = i * 6 - half + cloudShift + camera.position.x - (camera.position.x % 6);
      const z = k * 6 - half + camera.position.z - (camera.position.z % 6);
      m4.makeTranslation(x, cloudY, z);
      clouds.setMatrixAt(n, m4);
    });
    clouds.instanceMatrix.needsUpdate = true;
    for (const m of Object.values(pool)) {
      const type = m.userData.type;
      const mat = Array.isArray(m.material) ? m.material[2] : m.material;
      if (type === 'leaves') sway(mat);
      if (type === 'water' && mat.map) { mat.map.offset.x = (time.value * 0.04) % 1; mat.map.offset.y = Math.sin(time.value * 0.7) * 0.03; }
      if (type === 'glow') mat.emissiveIntensity = 0.9 + Math.sin(time.value * 2.3) * 0.08 + Math.sin(time.value * 7.1) * 0.04;
    }
  }

  return { update, setWorld, group };
}

/** Corner shading: a block covered from above, or boxed in by neighbours, is a little darker. */
export function shadeByNeighbours(blocks) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const set = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  for (const b of blocks) {
    let s = 1;
    if (set.has(key(b.x, b.y + 1, b.z))) s *= 0.8;
    let sides = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (set.has(key(b.x + dx, b.y + 1, b.z + dz))) sides++;
    s *= 1 - sides * 0.035;
    b.color = b.color.map((v) => v * s);
  }
}
