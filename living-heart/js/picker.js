// Finding the part under the pointer: a raycast against the parts at rest, skipping whatever the cutaway or
// the camera's clipping sphere has cut away. A click on a cut wall face is the myocardium itself.
// Each part's triangles are grouped into small boxes (sorted along a Morton curve) so a ray only tests the
// few hundred triangles near it, which keeps hover smooth on phones.

import * as THREE from 'three';
import { WALL_PARTS } from './heart.js';

const CHUNK = 192;

function morton(x, y, z) {
  const spread = (v) => {
    v = (v | (v << 16)) & 0x030000ff;
    v = (v | (v << 8)) & 0x0300f00f;
    v = (v | (v << 4)) & 0x030c30c3;
    return (v | (v << 2)) & 0x09249249;
  };
  return spread(x) | (spread(y) << 1) | (spread(z) << 2);
}

function buildChunks(geometry) {
  const pos = geometry.attributes.position.array, idx = geometry.index.array;
  const n = idx.length / 3;
  geometry.computeBoundingBox();
  const b = geometry.boundingBox, size = b.getSize(new THREE.Vector3());
  const codes = new Uint32Array(n), order = new Uint32Array(n);
  for (let t = 0; t < n; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k] * 3; cx += pos[v]; cy += pos[v + 1]; cz += pos[v + 2]; }
    const q = (c, lo, s) => Math.min(1023, Math.max(0, Math.floor(((c / 3 - lo) / (s || 1)) * 1023)));
    codes[t] = morton(q(cx, b.min.x, size.x), q(cy, b.min.y, size.y), q(cz, b.min.z, size.z));
    order[t] = t;
  }
  order.sort((a, c) => codes[a] - codes[c]);
  const chunks = [];
  for (let s = 0; s < n; s += CHUNK) {
    const tris = order.slice(s, Math.min(n, s + CHUNK));
    const box = new THREE.Box3();
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k] * 3; box.expandByPoint(new THREE.Vector3(pos[v], pos[v + 1], pos[v + 2])); }
    chunks.push({ box, tris });
  }
  return chunks;
}

export class PartPicker {
  constructor(camera, heart) {
    this.camera = camera;
    this.parts = [...heart.parts.values()].map((p) => ({ id: p.id, mesh: p.mesh, chunks: buildChunks(p.mesh.geometry) }));
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.local = new THREE.Ray();
    this.inv = new THREE.Matrix4();
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.hit = new THREE.Vector3(); this.n = new THREE.Vector3();
  }

  /** Returns { id, point } or null. cut: { plane (world) | null, clipR, camPos } */
  pick(x, y, cut) {
    this.ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const world = this.ray.ray;
    const hits = [];
    for (const part of this.parts) {
      const m = part.mesh;
      this.inv.copy(m.matrixWorld).invert();
      this.local.copy(world).applyMatrix4(this.inv);
      const pos = m.geometry.attributes.position.array, idx = m.geometry.index.array;
      for (const ch of part.chunks) {
        if (!this.local.intersectsBox(ch.box)) continue;
        for (const t of ch.tris) {
          const ia = idx[t * 3] * 3, ib = idx[t * 3 + 1] * 3, ic = idx[t * 3 + 2] * 3;
          this.a.set(pos[ia], pos[ia + 1], pos[ia + 2]);
          this.b.set(pos[ib], pos[ib + 1], pos[ib + 2]);
          this.c.set(pos[ic], pos[ic + 1], pos[ic + 2]);
          if (!this.local.intersectTriangle(this.a, this.b, this.c, false, this.hit)) continue;
          const point = this.hit.clone().applyMatrix4(m.matrixWorld);
          const d = point.distanceTo(world.origin);
          // Which side was hit: a back face of a wall is the cut surface of the muscle.
          this.n.subVectors(this.c, this.b).cross(this.a.clone().sub(this.b)).transformDirection(m.matrixWorld);
          hits.push({ id: part.id, point, d, back: this.n.dot(world.direction) > 0 });
        }
      }
    }
    hits.sort((p, q) => p.d - q.d);
    for (const h of hits) {
      if (cut.plane && cut.plane.distanceToPoint(h.point) < 0) continue;
      if (cut.clipR > 0 && h.point.distanceTo(cut.camPos) < cut.clipR) continue;
      if (WALL_PARTS.has(h.id) && h.back && (cut.plane || cut.clipR > 0)) return { id: 'myocardium', point: h.point, wall: h.id };
      return { id: h.id, point: h.point };
    }
    return null;
  }
}
