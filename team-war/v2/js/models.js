// Minion models as part lists (see gfx.js partMatrix). Every model faces +z, feet at y = 0.
// Team Human: warm cloth, wood and steel with orange. Team AI: metal and teal with glowing visors.
// Each kind carries an accent colour so it reads instantly: runner = yellow, brute = red, shooter = violet, boss = gold.

const PI = Math.PI;
export const PAL = {
  hTeam: 0xE8743B, hDark: 0xA84A17, skin: 0xF0C08A, cloth: 0x5E4430, leather: 0x46301F, steel: 0xC3CAD2, wood: 0x8E5B2E,
  aTeam: 0x17A398, aDark: 0x0C6E66, metal: 0xD7DFE5, gun: 0x37444F, black: 0x1C242B, aGlow: 0x7BFFEE,
  yellow: 0xFFD23F, red: 0xE04848, violet: 0x9B5DE5, gold: 0xFFC83D, white: 0xffffff,
};
const P = PAL;
const L = (g, c, p, s, extra = {}) => ({ g, c, p, s, ...extra });

// ---------------- Team Human ----------------
function humanGrunt(team = P.hTeam) {
  return {
    scale: 1, lean: 0.12, stride: 2.4, parts: [
      L('limb', P.cloth, [-0.15, 0.62, 0], [0.22, 0.6, 0.24], { a: 'legL' }),
      L('limb', P.cloth, [0.15, 0.62, 0], [0.22, 0.6, 0.24], { a: 'legR' }),
      L('box', P.leather, [-0.15, 0.62, 0], [0.26, 0.13, 0.34], { a: 'legL', o: [0, -0.56, 0.05] }),
      L('box', P.leather, [0.15, 0.62, 0], [0.26, 0.13, 0.34], { a: 'legR', o: [0, -0.56, 0.05] }),
      L('cap', team, [0, 0.98, 0], [0.66, 0.66, 0.46], { eliteC: true }),
      L('box', P.leather, [0, 0.74, 0], [0.68, 0.11, 0.48]),
      L('sphere', P.skin, [0, 1.5, 0], [0.48, 0.48, 0.48]),
      L('hemi', P.steel, [0, 1.56, 0], [0.55, 0.45, 0.55]),
      L('box', 0x222222, [-0.1, 1.5, 0.22], [0.07, 0.09, 0.04]),
      L('box', 0x222222, [0.1, 1.5, 0.22], [0.07, 0.09, 0.04]),
      L('capLimb', team, [-0.43, 1.2, 0], [0.18, 0.5, 0.18], { a: 'armL' }),
      L('capLimb', team, [0.43, 1.2, 0], [0.18, 0.5, 0.18], { a: 'armR' }),
      L('sphere', P.skin, [0.43, 1.2, 0], [0.17, 0.17, 0.17], { a: 'armR', o: [0, -0.52, 0] }),
      L('box', P.steel, [0.43, 1.2, 0], [0.07, 0.08, 0.72], { a: 'armR', o: [0, -0.55, 0.32] }),
      L('disk', P.hDark, [-0.43, 1.2, 0], [0.55, 1.4, 0.55], { a: 'armL', o: [-0.1, -0.32, 0.08], r: [0, 0, PI / 2] }),
    ],
  };
}
function humanRunner() {
  return {
    scale: 0.88, lean: 0.38, stride: 2.0, parts: [
      L('limb', P.cloth, [-0.13, 0.6, 0], [0.18, 0.58, 0.2], { a: 'legL' }),
      L('limb', P.cloth, [0.13, 0.6, 0], [0.18, 0.58, 0.2], { a: 'legR' }),
      L('box', P.leather, [-0.13, 0.6, 0], [0.22, 0.12, 0.3], { a: 'legL', o: [0, -0.55, 0.05] }),
      L('box', P.leather, [0.13, 0.6, 0], [0.22, 0.12, 0.3], { a: 'legR', o: [0, -0.55, 0.05] }),
      L('cap', P.hTeam, [0, 0.95, 0], [0.52, 0.58, 0.38], { eliteC: true }),
      L('box', P.yellow, [0, 1.2, 0], [0.54, 0.13, 0.42]),
      L('box', P.yellow, [0, 1.22, -0.18], [0.12, 0.08, 0.42], { a: 'flap', o: [0, 0, -0.18] }),
      L('sphere', P.skin, [0, 1.43, 0.02], [0.42, 0.42, 0.42]),
      L('hemi', P.hDark, [0, 1.46, -0.02], [0.5, 0.5, 0.52]),
      L('capLimb', P.hTeam, [-0.34, 1.12, 0], [0.14, 0.44, 0.14], { a: 'armL' }),
      L('capLimb', P.hTeam, [0.34, 1.12, 0], [0.14, 0.44, 0.14], { a: 'armR' }),
      L('wedge', P.steel, [-0.34, 1.12, 0], [0.08, 0.36, 0.08], { a: 'armL', o: [0, -0.62, 0.12], r: [PI / 2, 0, 0] }),
      L('wedge', P.steel, [0.34, 1.12, 0], [0.08, 0.36, 0.08], { a: 'armR', o: [0, -0.62, 0.12], r: [PI / 2, 0, 0] }),
    ],
  };
}
function humanBrute() {
  return {
    scale: 1, lean: 0.08, stride: 3.2, parts: [
      L('limb', P.cloth, [-0.36, 0.85, 0], [0.42, 0.82, 0.44], { a: 'legL' }),
      L('limb', P.cloth, [0.36, 0.85, 0], [0.42, 0.82, 0.44], { a: 'legR' }),
      L('box', P.steel, [-0.36, 0.85, 0], [0.48, 0.2, 0.58], { a: 'legL', o: [0, -0.76, 0.06] }),
      L('box', P.steel, [0.36, 0.85, 0], [0.48, 0.2, 0.58], { a: 'legR', o: [0, -0.76, 0.06] }),
      L('cap', P.hTeam, [0, 1.48, 0], [1.35, 1.05, 0.95], { eliteC: true }),
      L('box', P.steel, [0, 1.55, 0.33], [0.95, 0.72, 0.32]),
      L('box', P.leather, [0, 1.02, 0], [1.3, 0.2, 0.9]),
      L('box', P.red, [0, 1.95, -0.48], [1.15, 1.25, 0.07], { o: [0, -0.6, 0], a: 'flap' }),
      L('sphere', P.skin, [0, 2.18, 0.12], [0.62, 0.62, 0.62]),
      L('box', P.steel, [0, 2.33, 0.12], [0.74, 0.46, 0.72]),
      L('box', 0x1a1a1a, [0, 2.22, 0.49], [0.5, 0.08, 0.02]),
      L('cone', P.red, [-0.4, 2.62, 0.12], [0.16, 0.42, 0.16], { r: [0, 0, 0.6] }),
      L('cone', P.red, [0.4, 2.62, 0.12], [0.16, 0.42, 0.16], { r: [0, 0, -0.6] }),
      L('sphere', P.steel, [-0.8, 1.9, 0], [0.6, 0.5, 0.6]),
      L('sphere', P.steel, [0.8, 1.9, 0], [0.6, 0.5, 0.6]),
      L('capLimb', P.skin, [-0.82, 1.82, 0], [0.36, 0.95, 0.36], { a: 'armL' }),
      L('capLimb', P.skin, [0.82, 1.82, 0], [0.36, 0.95, 0.36], { a: 'armR' }),
      L('cyl', P.wood, [0.82, 1.82, 0], [0.11, 1.3, 0.11], { a: 'armR', o: [0, -0.95, 0.5], r: [PI / 2, 0, 0] }),
      L('box', P.steel, [0.82, 1.82, 0], [0.6, 0.5, 0.85], { a: 'armR', o: [0, -0.95, 1.15] }),
      L('box', P.red, [0.82, 1.82, 0], [0.62, 0.14, 0.87], { a: 'armR', o: [0, -0.95, 1.15] }),
    ],
  };
}
function humanShooter() {
  return {
    scale: 1, lean: 0.1, stride: 2.4, parts: [
      L('limb', P.cloth, [-0.15, 0.62, 0], [0.22, 0.6, 0.24], { a: 'legL' }),
      L('limb', P.cloth, [0.15, 0.62, 0], [0.22, 0.6, 0.24], { a: 'legR' }),
      L('box', P.leather, [-0.15, 0.62, 0], [0.26, 0.13, 0.34], { a: 'legL', o: [0, -0.56, 0.05] }),
      L('box', P.leather, [0.15, 0.62, 0], [0.26, 0.13, 0.34], { a: 'legR', o: [0, -0.56, 0.05] }),
      L('cap', P.hTeam, [0, 0.98, 0], [0.62, 0.66, 0.44], { eliteC: true }),
      L('box', P.violet, [0, 1.15, -0.25], [0.66, 0.95, 0.08]),
      L('sphere', P.skin, [0, 1.48, 0.02], [0.46, 0.46, 0.46]),
      L('hemi', P.violet, [0, 1.5, -0.02], [0.56, 0.6, 0.58]),
      L('box', 0x222222, [-0.09, 1.48, 0.23], [0.06, 0.08, 0.04]),
      L('box', 0x222222, [0.09, 1.48, 0.23], [0.06, 0.08, 0.04]),
      L('capLimb', P.hTeam, [-0.4, 1.22, 0], [0.17, 0.48, 0.17], { a: 'aim' }),
      L('capLimb', P.hTeam, [0.4, 1.22, 0], [0.17, 0.48, 0.17], { a: 'aim' }),
      L('box', P.wood, [0, 1.12, 0.45], [0.12, 0.12, 0.8], { a: 'gun' }),
      L('box', P.wood, [0, 1.16, 0.82], [0.95, 0.07, 0.08], { a: 'gun' }),
      L('box', P.violet, [0, 1.19, 0.86], [0.08, 0.08, 0.2], { a: 'gun', glow: true }),
    ],
  };
}
function humanBoss() {
  return {
    scale: 1, lean: 0.06, stride: 5, parts: [
      L('limb', P.steel, [-0.75, 1.65, 0], [0.82, 1.6, 0.85], { a: 'legL' }),
      L('limb', P.steel, [0.75, 1.65, 0], [0.82, 1.6, 0.85], { a: 'legR' }),
      L('box', P.hDark, [-0.75, 1.65, 0], [0.95, 0.35, 1.15], { a: 'legL', o: [0, -1.48, 0.12] }),
      L('box', P.hDark, [0.75, 1.65, 0], [0.95, 0.35, 1.15], { a: 'legR', o: [0, -1.48, 0.12] }),
      L('cap', P.hTeam, [0, 2.85, 0], [2.6, 1.95, 1.75]),
      L('box', P.steel, [0, 2.95, 0.62], [1.85, 1.35, 0.55]),
      L('box', P.gold, [0, 2.95, 0.9], [0.5, 0.5, 0.06]),
      L('box', P.leather, [0, 1.98, 0], [2.5, 0.38, 1.65]),
      L('sphere', P.steel, [-1.55, 3.65, 0], [1.15, 0.95, 1.15]),
      L('sphere', P.steel, [1.55, 3.65, 0], [1.15, 0.95, 1.15]),
      L('cone', P.gold, [-1.8, 4.15, 0], [0.3, 0.7, 0.3], { r: [0, 0, 0.4] }),
      L('cone', P.gold, [1.8, 4.15, 0], [0.3, 0.7, 0.3], { r: [0, 0, -0.4] }),
      L('box', P.steel, [0, 4.15, 0.2], [1.05, 1.05, 1.05]),
      L('box', 0xFFB070, [0, 4.2, 0.73], [0.75, 0.13, 0.03], { glow: true }),
      L('cone', P.gold, [-0.32, 4.85, 0.2], [0.24, 0.5, 0.24]),
      L('cone', P.gold, [0, 4.95, 0.2], [0.28, 0.65, 0.28]),
      L('cone', P.gold, [0.32, 4.85, 0.2], [0.24, 0.5, 0.24]),
      L('capLimb', P.steel, [-1.65, 3.55, 0], [0.72, 1.8, 0.72], { a: 'armL' }),
      L('capLimb', P.steel, [1.65, 3.55, 0], [0.72, 1.8, 0.72], { a: 'armR' }),
      L('cyl', P.wood, [1.65, 3.55, 0], [0.22, 2.6, 0.22], { a: 'armR', o: [0, -1.85, 0.95], r: [PI / 2, 0, 0] }),
      L('box', P.steel, [1.65, 3.55, 0], [1.3, 1.05, 1.7], { a: 'armR', o: [0, -1.85, 2.2] }),
      L('box', P.hTeam, [1.65, 3.55, 0], [1.33, 0.3, 1.73], { a: 'armR', o: [0, -1.85, 2.2] }),
      L('sphere', P.skin, [-1.65, 3.55, 0], [0.6, 0.6, 0.6], { a: 'armL', o: [0, -1.85, 0] }),
    ],
  };
}

// ---------------- Team AI ----------------
function aiGrunt(team = P.aTeam) {
  return {
    scale: 1, lean: 0.1, stride: 2.4, parts: [
      L('limb', P.gun, [-0.17, 0.62, 0], [0.2, 0.6, 0.22], { a: 'legL' }),
      L('limb', P.gun, [0.17, 0.62, 0], [0.2, 0.6, 0.22], { a: 'legR' }),
      L('box', P.black, [-0.17, 0.62, 0], [0.27, 0.11, 0.36], { a: 'legL', o: [0, -0.57, 0.06] }),
      L('box', P.black, [0.17, 0.62, 0], [0.27, 0.11, 0.36], { a: 'legR', o: [0, -0.57, 0.06] }),
      L('box', team, [0, 1.0, 0], [0.72, 0.62, 0.5], { eliteC: true }),
      L('box', P.metal, [0, 1.03, 0.24], [0.48, 0.36, 0.06]),
      L('box', P.aGlow, [0, 1.03, 0.28], [0.16, 0.16, 0.03], { glow: true }),
      L('box', P.metal, [0, 1.53, 0], [0.52, 0.4, 0.46], { a: 'head' }),
      L('box', P.aGlow, [0, 1.53, 0], [0.4, 0.11, 0.04], { a: 'head', o: [0, 0.02, 0.23], glow: true }),
      L('cyl', P.gun, [0.16, 1.53, 0], [0.04, 0.3, 0.04], { a: 'head', o: [0, 0.32, 0] }),
      L('sphere', P.aGlow, [0.16, 1.53, 0], [0.1, 0.1, 0.1], { a: 'head', o: [0, 0.48, 0], glow: true }),
      L('limb', P.gun, [-0.46, 1.22, 0], [0.16, 0.5, 0.16], { a: 'armL' }),
      L('limb', P.gun, [0.46, 1.22, 0], [0.16, 0.5, 0.16], { a: 'armR' }),
      L('box', team, [-0.46, 1.22, 0], [0.22, 0.16, 0.22], { a: 'armL', o: [0, -0.56, 0] }),
      L('box', team, [0.46, 1.22, 0], [0.22, 0.16, 0.22], { a: 'armR', o: [0, -0.56, 0] }),
    ],
  };
}
function aiRunner() {
  return {
    scale: 1, lean: 0.25, stride: 2.8, parts: [
      L('wheel', P.gun, [0, 0.45, 0], [0.5, 0.9, 0.9], { a: 'wheel' }),
      L('wheel', P.yellow, [0, 0.45, 0], [0.54, 0.62, 0.62], { a: 'wheel' }),
      L('box', P.black, [0, 0.45, 0], [0.56, 0.12, 0.96], { a: 'wheel' }),
      L('sphere', P.aTeam, [0, 0.98, -0.05], [0.58, 0.46, 0.58], { eliteC: true }),
      L('sphere', P.aGlow, [0, 1.02, 0.22], [0.24, 0.17, 0.12], { glow: true }),
      L('box', P.yellow, [-0.3, 1.08, -0.22], [0.06, 0.3, 0.34], { r: [0.4, 0, 0] }),
      L('box', P.yellow, [0.3, 1.08, -0.22], [0.06, 0.3, 0.34], { r: [0.4, 0, 0] }),
    ],
  };
}
function aiBrute() {
  return {
    scale: 1, lean: 0.06, stride: 3.2, parts: [
      L('limb', P.gun, [-0.4, 0.88, 0], [0.44, 0.85, 0.52], { a: 'legL' }),
      L('limb', P.gun, [0.4, 0.88, 0], [0.44, 0.85, 0.52], { a: 'legR' }),
      L('box', P.black, [-0.4, 0.88, 0], [0.55, 0.2, 0.7], { a: 'legL', o: [0, -0.78, 0.08] }),
      L('box', P.black, [0.4, 0.88, 0], [0.55, 0.2, 0.7], { a: 'legR', o: [0, -0.78, 0.08] }),
      L('box', P.aTeam, [0, 1.62, 0], [1.5, 1.1, 1.0], { eliteC: true }),
      L('box', P.red, [0, 1.75, 0.51], [1.2, 0.13, 0.03]),
      L('box', P.red, [0, 1.48, 0.51], [1.2, 0.13, 0.03]),
      L('box', P.metal, [0, 2.32, 0.12], [0.62, 0.42, 0.52]),
      L('box', 0xFF5A5A, [0, 2.34, 0.39], [0.44, 0.11, 0.04], { glow: true }),
      L('box', P.gun, [-0.98, 2.02, 0], [0.62, 0.52, 0.72]),
      L('box', P.gun, [0.98, 2.02, 0], [0.62, 0.52, 0.72]),
      L('limb', P.metal, [-0.98, 1.88, 0], [0.36, 0.8, 0.36], { a: 'armL' }),
      L('limb', P.metal, [0.98, 1.88, 0], [0.36, 0.8, 0.36], { a: 'armR' }),
      L('box', P.aTeam, [-0.98, 1.88, 0], [0.64, 0.55, 0.64], { a: 'armL', o: [0, -0.98, 0] }),
      L('box', P.aTeam, [0.98, 1.88, 0], [0.64, 0.55, 0.64], { a: 'armR', o: [0, -0.98, 0] }),
      L('cyl', P.gun, [-0.42, 2.35, -0.45], [0.16, 0.65, 0.16]),
      L('cyl', P.gun, [0.42, 2.35, -0.45], [0.16, 0.65, 0.16]),
    ],
  };
}
function aiShooter() {
  return {
    scale: 1, lean: 0.15, stride: 3, hover: true, parts: [
      L('cone', P.gun, [0, 0.72, 0], [0.62, 0.5, 0.62], { r: [PI, 0, 0] }),
      L('torus', P.violet, [0, 0.5, 0], [0.62, 0.62, 0.62], { a: 'spin', glow: true }),
      L('sphere', P.aTeam, [0, 1.18, 0], [0.82, 0.72, 0.82], { eliteC: true }),
      L('torus', P.gun, [0, 1.18, 0], [0.86, 0.86, 0.86]),
      L('barrel', P.gun, [0, 1.24, 0.2], [0.15, 0.15, 0.72], { a: 'gun' }),
      L('barrel', P.violet, [0, 1.24, 0.9], [0.2, 0.2, 0.12], { a: 'gun', glow: true }),
      L('sphere', P.aGlow, [0, 1.42, 0.3], [0.2, 0.17, 0.1], { glow: true }),
      L('box', P.violet, [-0.45, 1.25, -0.1], [0.06, 0.3, 0.4]),
      L('box', P.violet, [0.45, 1.25, -0.1], [0.06, 0.3, 0.4]),
    ],
  };
}
function aiBoss() {
  return {
    scale: 1, lean: 0.05, stride: 5, parts: [
      L('limb', P.gun, [-0.85, 1.7, 0], [0.9, 1.65, 1.0], { a: 'legL' }),
      L('limb', P.gun, [0.85, 1.7, 0], [0.9, 1.65, 1.0], { a: 'legR' }),
      L('box', P.black, [-0.85, 1.7, 0], [1.1, 0.35, 1.35], { a: 'legL', o: [0, -1.52, 0.15] }),
      L('box', P.black, [0.85, 1.7, 0], [1.1, 0.35, 1.35], { a: 'legR', o: [0, -1.52, 0.15] }),
      L('box', P.aTeam, [0, 2.95, 0], [2.85, 1.85, 2.0]),
      L('sphere', P.aGlow, [0, 2.95, 1.0], [0.85, 0.85, 0.3], { glow: true }),
      L('torus', P.gold, [0, 2.95, 1.02], [1.0, 1.0, 1.0], { r: [PI / 2, 0, 0] }),
      L('box', P.black, [0, 3.2, -1.25], [2.2, 1.7, 0.55]),
      L('box', P.aGlow, [0, 3.6, -1.53], [1.8, 0.08, 0.02], { glow: true }),
      L('box', P.aGlow, [0, 3.2, -1.53], [1.8, 0.08, 0.02], { glow: true }),
      L('box', P.aGlow, [0, 2.8, -1.53], [1.8, 0.08, 0.02], { glow: true }),
      L('box', P.metal, [0, 4.2, 0.3], [1.35, 0.85, 1.15]),
      L('box', P.aGlow, [0, 4.25, 0.88], [1.1, 0.18, 0.03], { glow: true }),
      L('torus', P.gold, [0, 5.0, 0.3], [1.1, 1.1, 1.1], { a: 'spin', glow: true }),
      L('box', P.gun, [-1.75, 3.65, 0], [1.1, 0.9, 1.3]),
      L('box', P.gun, [1.75, 3.65, 0], [1.1, 0.9, 1.3]),
      L('limb', P.metal, [-1.75, 3.45, 0], [0.7, 1.7, 0.7], { a: 'armL' }),
      L('limb', P.metal, [1.75, 3.45, 0], [0.7, 1.7, 0.7], { a: 'armR' }),
      L('box', P.aTeam, [-1.75, 3.45, 0], [1.25, 1.1, 1.25], { a: 'armL', o: [0, -2.0, 0] }),
      L('box', P.aTeam, [1.75, 3.45, 0], [1.25, 1.1, 1.25], { a: 'armR', o: [0, -2.0, 0] }),
      L('box', P.gold, [-1.75, 3.45, 0], [1.28, 0.25, 1.28], { a: 'armL', o: [0, -2.0, 0] }),
      L('box', P.gold, [1.75, 3.45, 0], [1.28, 0.25, 1.28], { a: 'armR', o: [0, -2.0, 0] }),
    ],
  };
}

export function minionModel(team, kind) {
  if (team === 'human') {
    return { grunt: humanGrunt, runner: humanRunner, brute: humanBrute, shooter: humanShooter, boss: humanBoss }[kind]();
  }
  return { grunt: aiGrunt, runner: aiRunner, brute: aiBrute, shooter: aiShooter, boss: aiBoss }[kind]();
}
