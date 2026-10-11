// Turns a signed distance function into a smooth mesh with surface nets, sampling finely only near the surface.

export function meshSdf(sdf, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = sampleNarrowBand(sdf, min, cell, nx, ny, nz);
  const at = (i, j, k) => field[i + nx * (j + ny * k)];

  // One vertex per cell that the surface crosses, placed at the mean of its edge crossings.
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    cellIndex[i + (nx - 1) * (j + (ny - 1) * k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }

  // Snap every vertex onto the true surface and take its normal from the field gradient.
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.35;
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2];
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it < 3; it++) {
      const d = sdf(x, y, z);
      gx = sdf(x + e, y, z) - sdf(x - e, y, z);
      gy = sdf(x, y + e, z) - sdf(x, y - e, z);
      gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const len = Math.hypot(gx, gy, gz) || 1;
      gx /= len; gy /= len; gz /= len;
      if (it < 2) {
        const step = Math.max(-cell * 0.5, Math.min(cell * 0.5, d));
        x -= gx * step; y -= gy * step; z -= gz * step;
      }
    }
    positions[v] = x; positions[v + 1] = y; positions[v + 2] = z;
    normals[v] = gx; normals[v + 1] = gy; normals[v + 2] = gz;
  }

  // One quad for every grid edge with a sign change, joining the four cells around it.
  const index = [];
  const cid = (i, j, k) => cellIndex[i + (nx - 1) * (j + (ny - 1) * k)];
  const dims = [nx, ny, nz];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const p = [0, 0, 0];
    for (p[2] = 0; p[2] < nz; p[2]++) for (p[1] = 0; p[1] < ny; p[1]++) for (p[0] = 0; p[0] < nx; p[0]++) {
      if (p[axis] >= dims[axis] - 1 || p[u] === 0 || p[w] === 0 || p[u] >= dims[u] - 1 || p[w] >= dims[w] - 1) continue;
      const a = at(p[0], p[1], p[2]);
      const q = [p[0], p[1], p[2]];
      q[axis]++;
      const b = at(q[0], q[1], q[2]);
      if ((a < 0) === (b < 0)) continue;
      const c = (du, dw) => { const r = [p[0], p[1], p[2]]; r[u] -= du; r[w] -= dw; return cid(r[0], r[1], r[2]); };
      const c00 = c(1, 1), c10 = c(0, 1), c11 = c(0, 0), c01 = c(1, 0);
      if (c00 < 0 || c10 < 0 || c11 < 0 || c01 < 0) continue;
      if (a < 0) index.push(c00, c10, c11, c00, c11, c01);
      else index.push(c00, c11, c10, c00, c01, c11);
    }
  }
  return { positions, normals, index: new Uint32Array(index) };
}

// Coarse pass everywhere, exact values only where the coarse field says the surface is near.
function sampleNarrowBand(sdf, min, cell, nx, ny, nz) {
  const S = 4;
  const cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    coarse[i + cx * (j + cy * k)] = sdf(min[0] + i * S * cell, min[1] + j * S * cell, min[2] + k * S * cell);
  }
  const band = S * cell * 1.9;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const I = Math.min(Math.floor(i / S), cx - 2), J = Math.min(Math.floor(j / S), cy - 2), K = Math.min(Math.floor(k / S), cz - 2);
    const fx = i / S - I, fy = j / S - J, fz = k / S - K;
    let near = false, v = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const d = coarse[(I + ox) + cx * ((J + oy) + cy * (K + oz))];
      if (Math.abs(d) < band) near = true;
      v += d * (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
    }
    field[i + nx * (j + ny * k)] = near ? sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell) : v;
  }
  return field;
}
