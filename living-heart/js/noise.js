// Seeded random numbers, 3D gradient noise, fbm and curl noise, shared by the heart and the threads.

export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fixed permutation table so the noise field is identical on every visit.
const PERM = new Uint8Array(512);
const GRAD = new Float32Array(256 * 3);
{
  const r = rng(91173);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    GRAD[i * 3] = Math.cos(a) * s; GRAD[i * 3 + 1] = Math.sin(a) * s; GRAD[i * 3 + 2] = z;
  }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function corner(ix, iy, iz, fx, fy, fz) {
  const g = PERM[PERM[PERM[ix & 255] + (iy & 255)] + (iz & 255)] * 3;
  return GRAD[g] * fx + GRAD[g + 1] * fy + GRAD[g + 2] * fz;
}

/** Perlin-style gradient noise, roughly in -1..1. */
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return 1.6 * l(
    l(l(corner(ix, iy, iz, fx, fy, fz), corner(ix + 1, iy, iz, fx - 1, fy, fz), u),
      l(corner(ix, iy + 1, iz, fx, fy - 1, fz), corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
    l(l(corner(ix, iy, iz + 1, fx, fy, fz - 1), corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u),
      l(corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v),
    w);
}

export function fbm3(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * f, y * f, z * f);
    f *= 2.03; amp *= 0.5;
  }
  return sum;
}

/** Divergence-free curl of a noise vector field, written into out. */
export function curl3(x, y, z, out) {
  const e = 0.01;
  const a = (px, py, pz) => noise3(px, py, pz);
  const b = (px, py, pz) => noise3(px + 31.4, py + 17.2, pz - 9.1);
  const c = (px, py, pz) => noise3(px - 23.7, py + 41.9, pz + 5.3);
  const dcdy = (c(x, y + e, z) - c(x, y - e, z)) / (2 * e);
  const dbdz = (b(x, y, z + e) - b(x, y, z - e)) / (2 * e);
  const dadz = (a(x, y, z + e) - a(x, y, z - e)) / (2 * e);
  const dcdx = (c(x + e, y, z) - c(x - e, y, z)) / (2 * e);
  const dbdx = (b(x + e, y, z) - b(x - e, y, z)) / (2 * e);
  const dady = (a(x, y + e, z) - a(x, y - e, z)) / (2 * e);
  out[0] = dcdy - dbdz; out[1] = dadz - dcdx; out[2] = dbdx - dady;
  return out;
}
