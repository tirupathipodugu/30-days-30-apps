// Fire vs Water — all tunable game data in one place. No three.js here (the simulation must run anywhere).
// NOTE: the internal team keys stay 'human' (Fire) and 'ai' (Water) — multiplayer, net and server all key
// off these strings. Only the DISPLAY fields below (name/short/base/hero/abilities/colour) are themed.

export const TEAMS = {
  human: {
    id: 'human', name: 'Team Fire', short: 'Fire', color: 0xFF5A1E, dark: 0xA8280A, css: '#FF5A1E', cssDark: '#A8280A',
    base: 'Fortress', hero: 'Ember', currency: 'embers', abilities: {
      q: { name: 'Flame Wall', desc: 'Raise a wall of fire that blocks shots and burns anything that crosses', cd: 11 },
      e: { name: 'Fire Rally', desc: 'Call 5 fire spirits; all allies move faster and hit twice as hard', cd: 17 },
      r: { name: 'Meteor', desc: 'Three molten meteors crash down where you aim', cd: 22 },
    },
  },
  ai: {
    id: 'ai', name: 'Team Water', short: 'Water', color: 0x27A8E0, dark: 0x0C5E90, css: '#27A8E0', cssDark: '#0C5E90',
    base: 'Citadel', hero: 'Tide', currency: 'pearls', abilities: {
      q: { name: 'Ice Wall', desc: 'A line of freezing water that chills and damages anything crossing it', cd: 10 },
      e: { name: 'Water Spirits', desc: 'Three homing water spirits hunt enemies, then burst on impact', cd: 17 },
      r: { name: 'Tidal Wave', desc: 'A surge that stuns and blasts everything near you', cd: 22 },
    },
  },
};
export const other = (t) => (t === 'human' ? 'ai' : 'human');

export const ARENA = { halfW: 17, halfL: 34, baseZ: 30, baseR: 4.6 };
// Human base sits at +z, AI base at -z. "fwd" is the z direction a team marches in.
export const baseZ = (team) => (team === 'human' ? ARENA.baseZ : -ARENA.baseZ);
export const fwd = (team) => (team === 'human' ? -1 : 1);

export const MAX_WAVE = 10;
export const BOSS_WAVES = [3, 6, 9, 10];

export const HERO = {
  hp: 100, speed: 8.6, rate: 6.2, dmg: 11, shotSpeed: 44, shotLife: 0.52, r: 0.6,
  dashDist: 6.8, dashTime: 0.15, dashCd: 1.9, dashInv: 0.32, revives: 2, respawn: 2.6,
};

// Minion kinds. hp/dmg get multiplied by the wave scaling.
export const KINDS = {
  grunt:   { hp: 30,  speed: 3.9, r: 0.6,  dmg: 10, atk: 1.0, reach: 0.45, mass: 1,   score: 10, aggro: 10 },
  runner:  { hp: 14,  speed: 7.4, r: 0.45, dmg: 6,  atk: 0.65, reach: 0.4, mass: 0.6, score: 12, aggro: 13 },
  brute:   { hp: 150, speed: 2.4, r: 1.05, dmg: 20, atk: 1.5, reach: 0.6, mass: 4,   score: 40, aggro: 8, kb: 10 },
  shooter: { hp: 26,  speed: 3.3, r: 0.6,  dmg: 9,  atk: 1.4, reach: 0.4, mass: 1,   score: 20, aggro: 16, ranged: true, keep: 11, shotSpeed: 15 },
  boss:    { hp: 1100, speed: 2.0, r: 2.1, dmg: 26, atk: 1.6, reach: 1.0, mass: 30,  score: 400, aggro: 26 },
  ally:    { hp: 38,  speed: 3.9, r: 0.6,  dmg: 9,  atk: 0.9, reach: 0.45, mass: 1,  score: 0,  aggro: 8 },
};

// rarity: c = common, r = rare, e = epic
export const RARITY = { c: { name: 'Common', css: '#B9C2C9' }, r: { name: 'Rare', css: '#4DA3FF' }, e: { name: 'Epic', css: '#C86BFF' } };

export const UPGRADES = [
  { id: 'rate',   r: 'c', max: 5, icon: '»', name: 'Quick Hands',  desc: '+18% fire rate' },
  { id: 'dmg',    r: 'c', max: 5, icon: '✦', name: 'Heavy Rounds', desc: '+22% shot damage' },
  { id: 'speed',  r: 'c', max: 3, icon: '➤', name: 'Fleet Foot',   desc: '+12% move speed' },
  { id: 'hp',     r: 'c', max: 4, icon: '♥', name: 'Fortify',      desc: '+30 max HP and a full heal' },
  { id: 'repair', r: 'c', max: 9, icon: '⌂', name: 'Repair Crew',  desc: 'Repair 40% of your base and +15% base HP' },
  { id: 'pierce', r: 'r', max: 3, icon: '↣', name: 'Piercing',     desc: 'Shots pass through +1 enemy' },
  { id: 'multi',  r: 'r', max: 3, icon: '⋔', name: 'Split Shot',   desc: '+1 shot per trigger pull' },
  { id: 'dashKill', r: 'r', max: 2, icon: '↯', name: 'Momentum',   desc: 'Every kill takes 0.45 s off your dash cooldown' },
  { id: 'dashHit', r: 'r', max: 2, icon: '⚔', name: 'Dash Strike', desc: 'Dashing through enemies deals 35 damage and knocks them away' },
  { id: 'cdr',    r: 'r', max: 3, icon: '◔', name: 'Focus',        desc: 'Abilities recharge 20% faster' },
  { id: 'leech',  r: 'r', max: 3, icon: '✚', name: 'Second Wind',  desc: 'Heal 2 HP per kill' },
  { id: 'bounce', r: 'r', max: 2, icon: '⤳', name: 'Ricochet',     desc: 'Shots bounce to a nearby enemy' },
  { id: 'glass',  r: 'e', max: 1, icon: '☄', name: 'Glass Cannon', desc: '+70% damage, but max HP is cut by 40%', risky: true },
  { id: 'boom',   r: 'e', max: 1, icon: '✺', name: 'Chain Reaction', desc: 'Enemies explode when they die, hurting others nearby' },
  { id: 'over',   r: 'e', max: 1, icon: '◉', name: 'Overcharge',   desc: 'Every 5th shot is a huge explosive round' },
  { id: 'berserk', r: 'e', max: 1, icon: '⚡', name: 'Berserk',     desc: '+60% fire rate while under half HP. Lose 15 max HP', risky: true },
];
export const UPG = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// Two owned upgrades that switch on a bonus together.
export const SYNERGIES = [
  { id: 'storm',   a: 'pierce', b: 'multi',   name: 'Bullet Storm',  desc: 'Wider spread, +1 pierce, +1 shot' },
  { id: 'blink',   a: 'dashKill', b: 'dashHit', name: 'Blink Blade', desc: 'Dash cooldown halved, Dash Strike deals double' },
  { id: 'vampire', a: 'leech', b: 'glass',    name: 'Vampire',       desc: 'Heal per kill is tripled' },
  { id: 'detonator', a: 'boom', b: 'over',    name: 'Detonator',     desc: 'Explosions are 60% bigger and hit harder' },
  { id: 'ricostorm', a: 'bounce', b: 'pierce', name: 'Pinball',      desc: 'Ricochets bounce one extra time' },
];

// Random drops from kills.
export const PICKUPS = {
  heal:   { name: 'Repair Kit', color: 0x56D364, life: 11 },
  frenzy: { name: 'Frenzy',     color: 0xFFC83D, life: 11, dur: 7 },
  reset:  { name: 'Overdrive',  color: 0x6FA8FF, life: 11 },
};

// Random twists that can hit a normal wave: a little surprise every run.
export const TWISTS = {
  goldrush: { name: 'Gold Rush', desc: 'Drops are 4x as common' },
  elites:   { name: 'Elite Squad', desc: 'Three golden elites, each drops loot' },
  haste:    { name: 'Haste', desc: 'Enemies move 30% faster' },
  bounty:   { name: 'Bounty', desc: 'Double points this wave' },
  horde:    { name: 'Horde', desc: 'A pack of extra runners' },
};

// Daily challenge modifiers.
export const MODIFIERS = [
  { id: 'brutes', name: 'Heavyweights', desc: 'Only brutes and bosses. They have less HP.' },
  { id: 'speed',  name: 'Double Time',  desc: 'Everything moves 60% faster.' },
  { id: 'nodash', name: 'Grounded',     desc: 'No dash. Pure positioning.' },
  { id: 'swarm',  name: 'Swarm',        desc: 'Twice the enemies, half the HP.' },
  { id: 'glass',  name: 'Glass Arena',  desc: 'Everyone deals double damage. You too.' },
  { id: 'bosses', name: 'Boss Rush',    desc: 'A boss in every other wave.' },
];

export function bossWave(n, mod) {
  if (mod === 'bosses') return n % 2 === 0 || n === 3 || BOSS_WAVES.includes(n);
  return BOSS_WAVES.includes(n);
}

// What a wave sends at you. Returns counts; the sim shuffles them into spawn groups.
export function waveCounts(n, mod) {
  const c = {
    grunt: 8 + n * 3,
    runner: n === 1 ? 4 : 3 + Math.round(n * 2.5),
    shooter: n < 2 ? 0 : 1 + Math.round(n * 1.3),
    brute: n < 4 ? (n === 3 ? 1 : 0) : n - 2,
    boss: bossWave(n, mod) ? 1 : 0,
  };
  if (bossWave(n, mod)) { c.grunt -= 4; c.runner -= 2; }
  if (mod === 'brutes') { c.brute = 3 + n; c.grunt = c.runner = c.shooter = 0; }
  if (mod === 'swarm') { c.grunt *= 2; c.runner *= 2; c.shooter *= 2; c.brute *= 2; }
  for (const k in c) c[k] = Math.max(0, c[k]);
  return c;
}

export const waveScale = (n) => ({ hp: 1 + 0.3 * (n - 1) + 0.08 * (n - 1) ** 2, dmg: 1 + 0.15 * (n - 1) });

export const STREAKS = [[2, 'Double!'], [3, 'Triple!'], [5, 'Rampage!'], [8, 'Unstoppable!'], [12, 'Godlike!'], [20, 'Legendary!'], [30, 'Beyond Human!']];

// ---- Meta progression (saved on the device) ----
export const xpForLevel = (lvl) => 220 + lvl * 140; // xp needed to go from lvl to lvl+1
export const ULT_LEVEL = 5;

export const SHOP = [
  { id: 'skin_h1', type: 'skin', team: 'human', name: 'Forest Ranger', price: 120, colors: { main: 0x3F8F4E, trim: 0xE8C547 } },
  { id: 'skin_h2', type: 'skin', team: 'human', name: 'Royal Guard', price: 260, colors: { main: 0x6A3FB0, trim: 0xF2C14E } },
  { id: 'skin_h3', type: 'skin', team: 'human', name: 'Night Raider', price: 420, colors: { main: 0x24262E, trim: 0xE8743B } },
  { id: 'skin_a1', type: 'skin', team: 'ai', name: 'Chrome', price: 120, colors: { main: 0xD8DEE6, trim: 0x4DA3FF } },
  { id: 'skin_a2', type: 'skin', team: 'ai', name: 'Magma Core', price: 260, colors: { main: 0x2C2A33, trim: 0xFF6A2A } },
  { id: 'skin_a3', type: 'skin', team: 'ai', name: 'Ghost Protocol', price: 420, colors: { main: 0xF4F7FB, trim: 0xB46BFF } },
  { id: 'trail_ember', type: 'trail', name: 'Ember trail', price: 150, color: 0xFF7A2A },
  { id: 'trail_plasma', type: 'trail', name: 'Plasma trail', price: 220, color: 0x6FD8FF },
  { id: 'trail_venom', type: 'trail', name: 'Venom trail', price: 220, color: 0x8CFF5A },
  { id: 'trail_prism', type: 'trail', name: 'Prism trail', price: 500, color: -1 },
  { id: 'headstart', type: 'perk', name: 'Head Start', price: 300, desc: 'Start every run with one upgrade pick' },
  { id: 'revive', type: 'perk', name: 'Extra Life', price: 650, desc: '+1 revive every run' },
];
