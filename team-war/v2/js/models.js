// Minion models as part lists (see gfx.js bakeModel). Every model faces +z, feet at y = 0.
// Chunky, friendly proportions: big heads and hands, short legs, faces with blinking eyes.
// Team Human: warm cloth, wood and steel with orange. Team AI: white shells, teal panels and glowing eyes.
// Each kind carries an accent colour so it reads instantly: runner = yellow, brute = red, shooter = violet, boss = gold.

const PI = Math.PI;
export const PAL = {
  hTeam: 0xE8743B, hDark: 0xA84A17, skin: 0xF4C79E, cloth: 0x5A4232, leather: 0x4A3122, steel: 0xC9D1D9, wood: 0x9A6233,
  cream: 0xFFF1D6, hair: 0x5A3820, cheek: 0xF3967F,
  aTeam: 0x17A398, aDark: 0x0C6E66, metal: 0xEEF2F5, gun: 0x3A4753, black: 0x1A2229, aGlow: 0x7BFFEE,
  yellow: 0xFFD23F, red: 0xE04848, violet: 0x9B5DE5, gold: 0xFFC83D, white: 0xffffff, ink: 0x1B1512,
};
const P = PAL;
const L = (g, c, p, s, extra = {}) => ({ g, c, p, s, ...extra });

// a pair of cartoon eyes (black ovals with a glint) that blink together
function eyes(y, z, dx, size = 1) {
  const p = [0, y, z];
  return [
    L('sphereLo', P.ink, p, [0.1 * size, 0.15 * size, 0.06], { a: 'blink', o: [-dx, 0, 0] }),
    L('sphereLo', P.ink, p, [0.1 * size, 0.15 * size, 0.06], { a: 'blink', o: [dx, 0, 0] }),
    L('sphereLo', P.white, p, [0.04 * size, 0.045 * size, 0.03], { a: 'blink', o: [-dx + 0.025 * size, 0.04 * size, 0.028] }),
    L('sphereLo', P.white, p, [0.04 * size, 0.045 * size, 0.03], { a: 'blink', o: [dx + 0.025 * size, 0.04 * size, 0.028] }),
  ];
}
function cheeks(y, z, dx, s = 1) {
  return [
    L('sphereLo', P.cheek, [-dx, y, z], [0.11 * s, 0.06 * s, 0.04]),
    L('sphereLo', P.cheek, [dx, y, z], [0.11 * s, 0.06 * s, 0.04]),
  ];
}
// glowing robot eyes (they blink too)
function botEyes(y, z, dx, w = 0.12, h = 0.16, col = P.aGlow) {
  const p = [0, y, z];
  return [
    L('rboxS', col, p, [w, h, 0.05], { a: 'blink', o: [-dx, 0, 0], glow: true }),
    L('rboxS', col, p, [w, h, 0.05], { a: 'blink', o: [dx, 0, 0], glow: true }),
  ];
}
function legs(x, y, len, w, col, boot, bootS, foot = 'sphere') {
  return [
    L('capLimb', col, [-x, y, 0], [w, len, w * 1.1], { a: 'legL' }),
    L('capLimb', col, [x, y, 0], [w, len, w * 1.1], { a: 'legR' }),
    L(foot, boot, [-x, y, 0], bootS, { a: 'legL', o: [0, -len - 0.02, bootS[2] * 0.18] }),
    L(foot, boot, [x, y, 0], bootS, { a: 'legR', o: [0, -len - 0.02, bootS[2] * 0.18] }),
  ];
}

// ---------------- Team Human ----------------
function humanGrunt(team = P.hTeam) {
  return {
    scale: 1, lean: 0.1, stride: 2.2, parts: [
      ...legs(0.14, 0.48, 0.36, 0.2, P.cloth, P.leather, [0.24, 0.16, 0.32]),
      L('cap', team, [0, 0.8, 0], [0.64, 0.62, 0.52], { eliteC: true }),
      L('taper', P.cream, [0, 0.58, 0], [0.64, 0.14, 0.54]),
      L('cyl', P.leather, [0, 0.66, 0], [0.62, 0.08, 0.52]),
      L('rboxS', P.gold, [0, 0.66, 0.26], [0.12, 0.09, 0.04]),
      L('sphere', P.skin, [0, 1.38, 0.02], [0.72, 0.68, 0.68]),
      L('hemi', P.steel, [0, 1.47, 0], [0.8, 0.66, 0.78]),
      L('cyl', P.steel, [0, 1.48, 0], [0.82, 0.05, 0.8]),
      L('sphere', team, [0, 1.86, -0.06], [0.12, 0.28, 0.42], { eliteC: true }),
      L('sphereLo', P.skin, [0, 1.3, 0.36], [0.09, 0.08, 0.08]),
      ...eyes(1.37, 0.33, 0.13),
      ...cheeks(1.27, 0.3, 0.2),
      L('capLimb', team, [-0.38, 1.02, 0], [0.17, 0.36, 0.17], { a: 'armL' }),
      L('capLimb', team, [0.38, 1.02, 0], [0.17, 0.36, 0.17], { a: 'armR' }),
      L('sphere', P.skin, [-0.38, 1.02, 0], [0.19, 0.19, 0.19], { a: 'armL', o: [0, -0.42, 0] }),
      L('sphere', P.skin, [0.38, 1.02, 0], [0.19, 0.19, 0.19], { a: 'armR', o: [0, -0.42, 0] }),
      L('box', P.steel, [0.38, 1.02, 0], [0.05, 0.1, 0.62], { a: 'armR', o: [0, -0.44, 0.4] }),
      L('box', P.gold, [0.38, 1.02, 0], [0.24, 0.05, 0.06], { a: 'armR', o: [0, -0.44, 0.1] }),
      L('disk', team, [-0.38, 1.02, 0], [0.52, 1.8, 0.52], { a: 'armL', o: [-0.11, -0.26, 0.08], r: [0, 0, PI / 2], eliteC: true }),
      L('disk', P.cream, [-0.38, 1.02, 0], [0.3, 2.2, 0.3], { a: 'armL', o: [-0.12, -0.26, 0.08], r: [0, 0, PI / 2] }),
      L('cloth', P.cream, [0.06, 1.12, -0.2], [0.16, 0.42, 0.04], { a: 'cape' }),
    ],
  };
}
function humanRunner() {
  return {
    scale: 0.92, lean: 0.34, stride: 1.9, parts: [
      ...legs(0.12, 0.46, 0.34, 0.17, P.cloth, P.leather, [0.2, 0.14, 0.3]),
      L('cap', P.hTeam, [0, 0.76, 0], [0.52, 0.54, 0.42], { eliteC: true }),
      L('cyl', P.yellow, [0, 0.64, 0], [0.5, 0.08, 0.42]),
      L('sphere', P.skin, [0, 1.28, 0.03], [0.66, 0.64, 0.64]),
      L('hemi', P.hair, [0, 1.34, -0.02], [0.7, 0.62, 0.7]),
      L('sphere', P.hair, [0.1, 1.6, 0.18], [0.22, 0.14, 0.24], { r: [0.4, 0, -0.3] }),
      L('cyl', P.yellow, [0, 1.42, 0], [0.7, 0.09, 0.68]),
      ...eyes(1.27, 0.33, 0.12, 0.95),
      ...cheeks(1.18, 0.3, 0.19, 0.9),
      L('capLimb', P.hTeam, [-0.31, 0.95, 0], [0.13, 0.32, 0.13], { a: 'armL' }),
      L('capLimb', P.hTeam, [0.31, 0.95, 0], [0.13, 0.32, 0.13], { a: 'armR' }),
      L('sphere', P.skin, [-0.31, 0.95, 0], [0.15, 0.15, 0.15], { a: 'armL', o: [0, -0.37, 0] }),
      L('sphere', P.skin, [0.31, 0.95, 0], [0.15, 0.15, 0.15], { a: 'armR', o: [0, -0.37, 0] }),
      L('wedge', P.steel, [-0.31, 0.95, 0], [0.07, 0.34, 0.07], { a: 'armL', o: [0, -0.4, 0.2], r: [PI / 2, 0, 0] }),
      L('wedge', P.steel, [0.31, 0.95, 0], [0.07, 0.34, 0.07], { a: 'armR', o: [0, -0.4, 0.2], r: [PI / 2, 0, 0] }),
      L('cloth', P.yellow, [0, 1.42, -0.32], [0.08, 0.46, 0.03], { a: 'cape', o: [-0.07, 0, 0] }),
      L('cloth', P.yellow, [0, 1.42, -0.32], [0.08, 0.38, 0.03], { a: 'cape', o: [0.07, 0, 0] }),
    ],
  };
}
function humanBrute() {
  return {
    scale: 1, lean: 0.06, stride: 3.2, parts: [
      ...legs(0.38, 0.86, 0.66, 0.4, P.cloth, P.steel, [0.5, 0.3, 0.64]),
      L('cap', P.hTeam, [0, 1.56, 0], [1.42, 1.18, 1.02], { eliteC: true }),
      L('rbox', P.steel, [0, 1.66, 0.3], [1.0, 0.82, 0.42]),
      L('sphere', P.gold, [0, 1.7, 0.52], [0.22, 0.22, 0.08]),
      L('cyl', P.leather, [0, 1.06, 0], [1.32, 0.22, 1.0]),
      L('sphere', P.skin, [0, 2.36, 0.15], [0.74, 0.7, 0.7]),
      L('rbox', P.steel, [0, 2.48, 0.12], [0.86, 0.6, 0.82]),
      L('box', P.ink, [0, 2.4, 0.53], [0.56, 0.08, 0.02]),
      ...botEyes(2.4, 0.54, 0.13, 0.1, 0.06, 0xFFC27A),
      L('cone', P.red, [-0.4, 2.86, 0.12], [0.16, 0.44, 0.16], { r: [0, 0, 0.6] }),
      L('cone', P.red, [0.4, 2.86, 0.12], [0.16, 0.44, 0.16], { r: [0, 0, -0.6] }),
      L('sphere', P.steel, [-0.84, 2.02, 0], [0.66, 0.54, 0.66]),
      L('sphere', P.steel, [0.84, 2.02, 0], [0.66, 0.54, 0.66]),
      L('capLimb', P.skin, [-0.86, 1.92, 0], [0.38, 0.92, 0.38], { a: 'armL' }),
      L('capLimb', P.skin, [0.86, 1.92, 0], [0.38, 0.92, 0.38], { a: 'armR' }),
      L('sphere', P.skin, [-0.86, 1.92, 0], [0.46, 0.46, 0.46], { a: 'armL', o: [0, -0.98, 0] }),
      L('sphere', P.skin, [0.86, 1.92, 0], [0.46, 0.46, 0.46], { a: 'armR', o: [0, -0.98, 0] }),
      L('cyl', P.wood, [0.86, 1.92, 0], [0.11, 1.3, 0.11], { a: 'armR', o: [0, -0.98, 0.5], r: [PI / 2, 0, 0] }),
      L('rbox', P.steel, [0.86, 1.92, 0], [0.62, 0.56, 0.9], { a: 'armR', o: [0, -0.98, 1.15] }),
      L('box', P.red, [0.86, 1.92, 0], [0.64, 0.14, 0.92], { a: 'armR', o: [0, -0.98, 1.15] }),
      L('cloth', P.red, [0, 2.22, -0.48], [1.2, 1.6, 0.07], { a: 'cape' }),
    ],
  };
}
function humanShooter() {
  return {
    scale: 1, lean: 0.08, stride: 2.2, parts: [
      ...legs(0.14, 0.48, 0.36, 0.19, P.cloth, P.leather, [0.23, 0.15, 0.32]),
      L('cap', P.hTeam, [0, 0.8, 0], [0.6, 0.6, 0.48], { eliteC: true }),
      L('cyl', P.leather, [0, 0.66, 0], [0.6, 0.08, 0.5]),
      L('sphere', P.skin, [0, 1.36, 0.03], [0.7, 0.66, 0.66]),
      L('sphere', P.violet, [0, 1.42, -0.05], [0.8, 0.76, 0.76]),
      L('cone', P.violet, [0, 1.62, -0.36], [0.3, 0.5, 0.3], { r: [-1.9, 0, 0] }),
      L('sphere', P.hair, [0, 1.6, 0.18], [0.5, 0.16, 0.34]),
      ...eyes(1.34, 0.35, 0.12),
      ...cheeks(1.25, 0.31, 0.19),
      L('capLimb', P.hTeam, [-0.34, 1.04, 0], [0.16, 0.36, 0.16], { a: 'aim' }),
      L('capLimb', P.hTeam, [0.34, 1.04, 0], [0.16, 0.36, 0.16], { a: 'aim' }),
      L('box', P.wood, [0, 1.0, 0], [0.1, 0.12, 0.78], { a: 'gun', o: [0, 0, 0.5] }),
      L('box', P.wood, [0, 1.0, 0], [0.92, 0.07, 0.08], { a: 'gun', o: [0, 0.04, 0.86], r: [0, 0, 0] }),
      L('box', P.violet, [0, 1.0, 0], [0.07, 0.07, 0.24], { a: 'gun', o: [0, 0.07, 0.96], glow: true }),
      L('cloth', P.violet, [0, 1.16, -0.24], [0.56, 0.72, 0.05], { a: 'cape' }),
    ],
  };
}
function humanBoss() {
  return {
    scale: 1, lean: 0.05, stride: 5, parts: [
      ...legs(0.78, 1.7, 1.42, 0.86, P.steel, P.hDark, [1.0, 0.5, 1.3]),
      L('cap', P.hTeam, [0, 2.95, 0], [2.7, 2.05, 1.85]),
      L('rbox', P.steel, [0, 3.05, 0.6], [1.95, 1.45, 0.62]),
      L('sphere', P.gold, [0, 3.1, 0.92], [0.55, 0.55, 0.14]),
      L('cyl', P.leather, [0, 2.06, 0], [2.6, 0.4, 1.75]),
      L('sphere', P.steel, [-1.62, 3.78, 0], [1.2, 1.0, 1.2]),
      L('sphere', P.steel, [1.62, 3.78, 0], [1.2, 1.0, 1.2]),
      L('cone', P.gold, [-1.86, 4.3, 0], [0.3, 0.7, 0.3], { r: [0, 0, 0.4] }),
      L('cone', P.gold, [1.86, 4.3, 0], [0.3, 0.7, 0.3], { r: [0, 0, -0.4] }),
      L('rbox', P.steel, [0, 4.42, 0.2], [1.2, 1.15, 1.15]),
      L('box', P.ink, [0, 4.42, 0.78], [0.86, 0.16, 0.02]),
      ...botEyes(4.42, 0.8, 0.22, 0.2, 0.11, 0xFFB070),
      L('cyl', P.gold, [0, 5.06, 0.2], [1.0, 0.24, 1.0]),
      L('cone', P.gold, [-0.34, 5.36, 0.2], [0.24, 0.5, 0.24]),
      L('cone', P.gold, [0, 5.46, 0.2], [0.28, 0.66, 0.28]),
      L('cone', P.gold, [0.34, 5.36, 0.2], [0.24, 0.5, 0.24]),
      L('sphere', P.red, [0, 5.3, 0.62], [0.16, 0.16, 0.1], { glow: true }),
      L('capLimb', P.steel, [-1.7, 3.66, 0], [0.74, 1.8, 0.74], { a: 'armL' }),
      L('capLimb', P.steel, [1.7, 3.66, 0], [0.74, 1.8, 0.74], { a: 'armR' }),
      L('cyl', P.wood, [1.7, 3.66, 0], [0.22, 2.6, 0.22], { a: 'armR', o: [0, -1.88, 0.95], r: [PI / 2, 0, 0] }),
      L('rbox', P.steel, [1.7, 3.66, 0], [1.35, 1.1, 1.75], { a: 'armR', o: [0, -1.88, 2.2] }),
      L('box', P.hTeam, [1.7, 3.66, 0], [1.38, 0.3, 1.78], { a: 'armR', o: [0, -1.88, 2.2] }),
      L('sphere', P.skin, [-1.7, 3.66, 0], [0.7, 0.7, 0.7], { a: 'armL', o: [0, -1.9, 0] }),
      L('cloth', P.gold, [0, 4.0, -0.95], [2.3, 3.3, 0.1], { a: 'cape' }),
    ],
  };
}

// ---------------- Team AI ----------------
function aiGrunt(team = P.aTeam) {
  return {
    scale: 1, lean: 0.08, stride: 2.2, parts: [
      ...legs(0.15, 0.48, 0.34, 0.15, P.gun, P.black, [0.24, 0.12, 0.32], 'rboxS'),
      L('rbox', P.metal, [0, 0.82, 0], [0.66, 0.58, 0.5]),
      L('rboxS', team, [0, 0.84, 0.21], [0.44, 0.34, 0.12], { eliteC: true }),
      L('sphereLo', P.aGlow, [0, 0.87, 0.28], [0.1, 0.1, 0.04], { glow: true }),
      L('cylLo', P.gun, [0, 1.1, 0], [0.18, 0.14, 0.18]),
      L('rbox', P.metal, [0, 1.4, 0], [0.8, 0.64, 0.64]),
      L('rboxS', P.black, [0, 1.38, 0.24], [0.62, 0.46, 0.18]),
      ...botEyes(1.4, 0.335, 0.13),
      L('cyl', team, [-0.42, 1.4, 0], [0.22, 0.08, 0.22], { r: [0, 0, PI / 2], eliteC: true }),
      L('cyl', team, [0.42, 1.4, 0], [0.22, 0.08, 0.22], { r: [0, 0, PI / 2], eliteC: true }),
      L('cylLo', P.gun, [0.14, 1.82, 0], [0.04, 0.26, 0.04]),
      L('sphereLo', P.aGlow, [0.14, 1.98, 0], [0.11, 0.11, 0.11], { glow: true }),
      L('capLimb', P.gun, [-0.42, 1.0, 0], [0.12, 0.34, 0.12], { a: 'armL' }),
      L('capLimb', P.gun, [0.42, 1.0, 0], [0.12, 0.34, 0.12], { a: 'armR' }),
      L('rboxS', team, [-0.42, 1.0, 0], [0.22, 0.2, 0.22], { a: 'armL', o: [0, -0.4, 0] }),
      L('rboxS', team, [0.42, 1.0, 0], [0.22, 0.2, 0.22], { a: 'armR', o: [0, -0.4, 0] }),
    ],
  };
}
function aiRunner() {
  return {
    scale: 1, lean: 0.22, stride: 2.8, parts: [
      L('wheel', P.black, [0, 0.42, 0], [0.42, 0.84, 0.84], { a: 'wheel' }),
      L('wheel', P.yellow, [0, 0.42, 0], [0.46, 0.5, 0.5], { a: 'wheel' }),
      L('box', P.gun, [0, 0.42, 0], [0.48, 0.1, 0.9], { a: 'wheel' }),
      L('sphere', P.aTeam, [0, 1.0, -0.02], [0.74, 0.66, 0.74], { eliteC: true }),
      L('hemi', P.metal, [0, 1.06, -0.02], [0.76, 0.5, 0.76]),
      L('cyl', P.black, [0, 1.0, 0.04], [0.7, 0.2, 0.7]),
      L('sphereLo', P.aGlow, [0, 1.0, 0.36], [0.24, 0.16, 0.06], { a: 'blink', glow: true }),
      L('box', P.yellow, [-0.33, 1.16, -0.24], [0.06, 0.28, 0.34], { r: [0.5, 0, 0] }),
      L('box', P.yellow, [0.33, 1.16, -0.24], [0.06, 0.28, 0.34], { r: [0.5, 0, 0] }),
      L('cylLo', P.gun, [0, 1.48, -0.2], [0.04, 0.3, 0.04], { r: [-0.5, 0, 0] }),
      L('sphereLo', P.yellow, [0, 1.6, -0.28], [0.1, 0.1, 0.1], { glow: true }),
    ],
  };
}
function aiBrute() {
  return {
    scale: 1, lean: 0.05, stride: 3.2, parts: [
      ...legs(0.42, 0.88, 0.66, 0.42, P.gun, P.black, [0.56, 0.24, 0.72], 'rbox'),
      L('rbox', P.aTeam, [0, 1.66, 0], [1.56, 1.16, 1.06], { eliteC: true }),
      L('rbox', P.metal, [0, 1.72, 0.42], [1.1, 0.8, 0.3]),
      L('box', P.red, [0, 1.92, 0.58], [0.8, 0.08, 0.02], { glow: true }),
      L('box', P.red, [0, 1.56, 0.58], [0.8, 0.08, 0.02], { glow: true }),
      L('rbox', P.metal, [0, 2.4, 0.14], [0.72, 0.52, 0.6]),
      L('rboxS', P.black, [0, 2.38, 0.36], [0.56, 0.24, 0.12]),
      ...botEyes(2.38, 0.43, 0.12, 0.12, 0.08, 0xFF5A5A),
      L('rbox', P.gun, [-1.0, 2.12, 0], [0.66, 0.56, 0.76]),
      L('rbox', P.gun, [1.0, 2.12, 0], [0.66, 0.56, 0.76]),
      L('capLimb', P.metal, [-1.0, 1.98, 0], [0.36, 0.78, 0.36], { a: 'armL' }),
      L('capLimb', P.metal, [1.0, 1.98, 0], [0.36, 0.78, 0.36], { a: 'armR' }),
      L('rbox', P.aTeam, [-1.0, 1.98, 0], [0.7, 0.62, 0.7], { a: 'armL', o: [0, -1.0, 0], eliteC: true }),
      L('rbox', P.aTeam, [1.0, 1.98, 0], [0.7, 0.62, 0.7], { a: 'armR', o: [0, -1.0, 0], eliteC: true }),
      L('cyl', P.gun, [-0.44, 2.46, -0.48], [0.18, 0.7, 0.18]),
      L('cyl', P.gun, [0.44, 2.46, -0.48], [0.18, 0.7, 0.18]),
      L('cyl', 0xFF8A4D, [-0.44, 2.83, -0.48], [0.12, 0.04, 0.12], { glow: true }),
      L('cyl', 0xFF8A4D, [0.44, 2.83, -0.48], [0.12, 0.04, 0.12], { glow: true }),
    ],
  };
}
function aiShooter() {
  return {
    scale: 1, lean: 0.12, stride: 3, hover: true, parts: [
      L('cone', P.gun, [0, 0.72, 0], [0.56, 0.44, 0.56], { r: [PI, 0, 0] }),
      L('cone', P.violet, [0, 0.42, 0], [0.4, 0.5, 0.4], { a: 'thrust', r: [PI, 0, 0], o: [0, -0.1, 0], glow: true }),
      L('sphere', P.metal, [0, 1.2, 0], [0.9, 0.82, 0.9]),
      L('cyl', P.aTeam, [0, 1.2, 0], [0.94, 0.26, 0.94], { eliteC: true }),
      L('torus', P.gun, [0, 1.2, 0], [0.98, 0.9, 0.98]),
      L('rboxS', P.black, [0, 1.36, 0.3], [0.5, 0.3, 0.22]),
      ...botEyes(1.38, 0.42, 0.1, 0.1, 0.12, P.violet),
      L('barrel', P.gun, [0, 1.12, 0.3], [0.17, 0.17, 0.62], { a: 'gun' }),
      L('barrel', P.violet, [0, 1.12, 0.3], [0.2, 0.2, 0.1], { a: 'gun', o: [0, 0, 0.62], glow: true }),
      L('box', P.violet, [-0.5, 1.28, -0.1], [0.06, 0.3, 0.42]),
      L('box', P.violet, [0.5, 1.28, -0.1], [0.06, 0.3, 0.42]),
    ],
  };
}
function aiBoss() {
  return {
    scale: 1, lean: 0.04, stride: 5, parts: [
      ...legs(0.86, 1.72, 1.4, 0.92, P.gun, P.black, [1.15, 0.45, 1.4], 'rbox'),
      L('rbox', P.aTeam, [0, 3.0, 0], [2.95, 1.95, 2.1]),
      L('rbox', P.metal, [0, 3.0, 0.8], [2.1, 1.4, 0.6]),
      L('sphere', P.aGlow, [0, 3.0, 1.12], [0.9, 0.9, 0.3], { glow: true }),
      L('torus', P.gold, [0, 3.0, 1.12], [1.05, 1.05, 1.05], { r: [PI / 2, 0, 0] }),
      L('rbox', P.black, [0, 3.25, -1.25], [2.2, 1.7, 0.6]),
      L('box', P.aGlow, [0, 3.65, -1.56], [1.8, 0.08, 0.02], { glow: true }),
      L('box', P.aGlow, [0, 3.25, -1.56], [1.8, 0.08, 0.02], { glow: true }),
      L('box', P.aGlow, [0, 2.85, -1.56], [1.8, 0.08, 0.02], { glow: true }),
      L('rbox', P.metal, [0, 4.3, 0.3], [1.45, 0.95, 1.2]),
      L('rboxS', P.black, [0, 4.28, 0.78], [1.15, 0.55, 0.3]),
      ...botEyes(4.3, 0.93, 0.24, 0.24, 0.2),
      L('torus', P.gold, [0, 5.1, 0.3], [1.1, 1.1, 1.1], { a: 'spin', glow: true }),
      L('rbox', P.gun, [-1.82, 3.75, 0], [1.15, 0.95, 1.35]),
      L('rbox', P.gun, [1.82, 3.75, 0], [1.15, 0.95, 1.35]),
      L('capLimb', P.metal, [-1.82, 3.55, 0], [0.72, 1.7, 0.72], { a: 'armL' }),
      L('capLimb', P.metal, [1.82, 3.55, 0], [0.72, 1.7, 0.72], { a: 'armR' }),
      L('rbox', P.aTeam, [-1.82, 3.55, 0], [1.3, 1.15, 1.3], { a: 'armL', o: [0, -2.05, 0] }),
      L('rbox', P.aTeam, [1.82, 3.55, 0], [1.3, 1.15, 1.3], { a: 'armR', o: [0, -2.05, 0] }),
      L('box', P.gold, [-1.82, 3.55, 0], [1.33, 0.25, 1.33], { a: 'armL', o: [0, -2.05, 0] }),
      L('box', P.gold, [1.82, 3.55, 0], [1.33, 0.25, 1.33], { a: 'armR', o: [0, -2.05, 0] }),
    ],
  };
}

export function minionModel(team, kind) {
  if (team === 'human') {
    return { grunt: humanGrunt, runner: humanRunner, brute: humanBrute, shooter: humanShooter, boss: humanBoss }[kind]();
  }
  return { grunt: aiGrunt, runner: aiRunner, brute: aiBrute, shooter: aiShooter, boss: aiBoss }[kind]();
}
