// Human vs AI 2.0 — the game simulation. Pure data + rules: no DOM, no three.js, seeded randomness.
// The renderer reads the state; effects and sounds react to `game.events`, which the caller drains every frame.
// World axes: x = across the field, z = along it. Team Human's base is at +z, Team AI's at -z.

import {
  ARENA, HERO, KINDS, UPGRADES, UPG, SYNERGIES, PICKUPS, STREAKS, MAX_WAVE,
  baseZ, fwd, other, waveCounts, waveScale, bossWave, TWISTS, TEAMS, ABILITY_PICKS, ABILITY_KEY,
} from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const len = (x, z) => Math.sqrt(x * x + z * z);

// Returns the parameter t (0..1) where segment p0->p1 first comes within r of (cx,cz), or -1.
export function segCircle(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((cx - x0) * dx + (cz - z0) * dz) / l2, 0, 1);
  const px = x0 + dx * t - cx, pz = z0 + dz * t - cz;
  return px * px + pz * pz <= r * r ? t : -1;
}
export function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Symmetric cover: each piece is mirrored through the centre so neither side has an advantage.
const COVER_HALF = [
  { x: -9.5, z: 12.5, r: 1.5, k: 'rock' },
  { x: 10.5, z: 8.5, r: 1.25, k: 'crate' },
  { x: -3.2, z: 4.2, r: 1.05, k: 'crate' },
  { x: 5.5, z: 17.5, r: 1.3, k: 'rock' },
  { x: -13.5, z: 21, r: 1.2, k: 'rock' },
];
export const COVER = [...COVER_HALF, ...COVER_HALF.map((c) => ({ ...c, x: -c.x, z: -c.z }))];

export class Game {
  constructor({ team = 'human', seed = 1, mod = null, perks = {} } = {}) {
    this.team = team; this.foe = other(team); this.mod = mod; this.perks = perks; this.seed = seed;
    this.rand = mulberry32(seed);
    this.t = 0; this.events = []; this.nid = 1;
    this.wave = 1; this.phase = 'intro'; this.phaseT = 0.6; this.waveT = 0;
    this.score = 0; this.kills = 0; this.heroKills = 0;
    this.combo = 0; this.comboT = 0; this.mult = 1; this.bestCombo = 0;
    this.streak = 0; this.streakT = 0; this.bestStreak = 0;
    this.up = {}; for (const u of UPGRADES) this.up[u.id] = 0;
    this.syn = {}; this.picked = [];
    this.speedMul = mod === 'speed' ? 1.6 : 1;
    this.dmgMul = mod === 'glass' ? 2 : 1;
    this.bases = { human: this.makeBase('human'), ai: this.makeBase('ai') };
    this.hero = this.makeHero();
    this.units = []; this.shots = []; this.walls = []; this.fires = []; this.drones = [];
    this.slams = []; this.pickups = []; this.booms = [];
    this.cover = COVER.map((c) => ({ ...c }));
    this.queue = []; this.allyT = 0.3; this.rally = 0; this.frenzy = 0;
    this.abilT = 6; this.note = null; this._noteId = 0; this.lastInp = {}; // ability-pickup spawn timer + "what fired" note
    this.offer = null; this.result = null; this.boss = null; this.bossWarnT = 0;
    this.waveTotal = 0; this.waveDone = 0; this.shotCount = 0;
    this.stats = { shots: 0, dashes: 0, abilities: 0, pickups: 0, dmgTaken: 0, breaches: 0, waveTimes: [], bossKills: 0 };
    this.startWave(true);
    if (perks.headstart) {
      const pool = UPGRADES.filter((u) => u.r === 'r');
      const u = pool[(this.rand() * pool.length) | 0];
      this.applyUpgrade(u.id);
      this.emit('headstart', { id: u.id });
    }
  }

  emit(type, data) { this.events.push(Object.assign({ type }, data)); }
  // ---------- factories ----------
  makeBase(team) {
    return { type: 'base', side: team, x: 0, z: baseZ(team), r: ARENA.baseR, hp: 1000, max: 1000, fireT: 1, hitT: 0, shield: false };
  }
  makeHero() {
    const z = baseZ(this.team) + fwd(this.team) * 9;
    const h = {
      type: 'hero', side: this.team, x: 0, z, vx: 0, vz: 0, r: HERO.r, hp: 1, max: 1,
      aim: this.team === 'human' ? Math.PI : 0, aimX: 0, aimZ: fwd(this.team), fireT: 0, recoil: 0,
      dashT: 0, dashCd: 0, dashX: 0, dashZ: 0, dashHits: null, inv: 0, hurtT: 0, dead: false, respawnT: 0,
      revives: HERO.revives + (this.perks.revive ? 1 : 0), cd: { q: 0, e: 0, r: 0 }, cdMax: { q: 1, e: 1, r: 1 },
      moving: 0, walk: 0,
    };
    this.hero = h; h.max = h.hp = this.heroMax();
    return h;
  }
  spawnUnit(side, kind, x, z, opts = {}) {
    const k = KINDS[kind === 'grunt' && side === this.team ? 'ally' : kind];
    const sc = side === this.foe ? waveScale(this.wave) : { hp: 1 + 0.08 * (this.wave - 1), dmg: 1 + 0.05 * (this.wave - 1) };
    let hpMul = sc.hp;
    if (side === this.foe && (this.mod === 'swarm')) hpMul *= 0.5;
    if (side === this.foe && (this.mod === 'brutes') && kind === 'brute') hpMul *= 0.6;
    let hp = k.hp * hpMul;
    if (kind === 'boss') hp = KINDS.boss.hp * (1 + 0.45 * this.bossIndex()) * (this.wave === MAX_WAVE ? 1.25 : 1);
    const u = {
      type: 'unit', id: this.nid++, side, kind, ally: side === this.team,
      x, z, r: k.r, hp, max: hp, speed: k.speed * (0.92 + this.rand() * 0.16), dmg: k.dmg * sc.dmg,
      atk: k.atk, atkT: this.rand() * k.atk, reach: k.reach, mass: k.mass, aggro: k.aggro,
      kx: 0, kz: 0, vx: 0, vz: 0, face: side === 'human' ? Math.PI : 0, tgt: null, thinkT: this.rand() * 0.2,
      laneX: clamp(x + (this.rand() - 0.5) * 6, -13, 13), wob: this.rand() * 6.28,
      swing: 0, hitT: 0, stun: 0, elite: false, born: this.t, walk: this.rand() * 6, shootT: 0,
      state: 'walk', stateT: 0, bossT: 2.4, burstT: 4, alt: 0, leap: null,
    };
    if (side === this.foe && this.twist === 'haste') u.speed *= 1.3;
    if (opts.elite) {
      u.elite = true; u.hp *= 3; u.max *= 3; u.r *= 1.3; u.mass *= 2; u.dmg *= 1.3;
    }
    this.units.push(u);
    if (kind === 'boss') { this.boss = u; this.bases[side].shield = true; this.emit('bossSpawn', { x, z }); }
    return u;
  }
  bossIndex() { let n = 0; for (let w = 1; w < this.wave; w++) if (bossWave(w, this.mod)) n++; return n; }

  // ---------- derived hero stats ----------
  heroDmg() { return HERO.dmg * (1 + 0.22 * this.up.dmg) * (this.up.glass ? 1.7 : 1) * this.dmgMul; }
  heroRate() {
    const h = this.hero;
    return HERO.rate * (1 + 0.18 * this.up.rate) * (this.frenzy > 0 ? 1.8 : 1)
      * (this.up.berserk && h.hp < h.max / 2 ? 1.6 : 1) * (this.rally > 0 && this.team === 'human' ? 1.25 : 1);
  }
  heroMax() { return Math.round((HERO.hp + (this.team === 'human' ? 15 : 0) + 30 * this.up.hp - (this.up.berserk ? 15 : 0)) * (this.up.glass ? 0.6 : 1)); }
  heroSpeed() { return HERO.speed * (1 + 0.12 * this.up.speed) * this.speedMul; }
  pierce() { return this.up.pierce + (this.syn.storm ? 1 : 0); }
  multi() { return 1 + this.up.multi + (this.syn.storm ? 1 : 0); }
  dashCd() { return HERO.dashCd * (this.syn.blink ? 0.5 : 1); }
  cdMul() { return Math.max(0.4, 1 - 0.2 * this.up.cdr); }
  ultUnlocked() { return !!this.perks.ult; }

  // ---------- waves ----------
  startWave(opening = false) {
    const n = this.wave, c = waveCounts(n, this.mod);
    this.twist = null;
    if (!opening && n >= 2 && !c.boss && this.rand() < 0.45) {
      const keys = Object.keys(TWISTS);
      this.twist = keys[(this.rand() * keys.length) | 0];
      if (this.twist === 'horde') c.runner += 6 + n;
    }
    const list = [];
    for (const k of ['grunt', 'runner', 'shooter', 'brute']) for (let i = 0; i < c[k]; i++) list.push(k);
    for (let i = list.length - 1; i > 0; i--) { const j = (this.rand() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
    // one elite per wave from wave 2: tougher, gold, always drops a pickup
    const eliteAt = new Set();
    if (n >= 2 && list.length) for (let k = 0; k < (this.twist === 'elites' ? 3 : 1); k++) eliteAt.add((this.rand() * list.length) | 0);
    this.queue = [];
    let t = opening ? 1.2 : 0.4;
    const gap = Math.max(1.0, 2.3 - n * 0.13), size = 2 + Math.floor(n / 2.5);
    let i = 0;
    if (opening) {
      // Enemies are already on the field so the first kill comes within seconds.
      const fz = baseZ(this.foe), dir = fwd(this.foe);
      for (let j = 0; j < 6 && i < list.length; j++, i++) {
        this.spawnUnit(this.foe, list[i], -9 + j * 3.6 + (this.rand() - 0.5), fz + dir * (27 + this.rand() * 4));
      }
      const az = baseZ(this.team), ad = fwd(this.team);
      for (let j = 0; j < 3; j++) this.spawnUnit(this.team, 'grunt', -5 + j * 5, az + ad * (13 + this.rand() * 2));
      this.allyT = 3;
    }
    while (i < list.length) {
      const flank = n >= 2 && this.rand() < 0.18 + n * 0.03 ? (this.rand() < 0.5 ? -1 : 1) : 0;
      const drop = !opening && t < 3; // the first groups drop in at mid-field so a wave starts hot
      for (let g = 0; g < size && i < list.length; g++, i++) this.queue.push({ kind: list[i], at: t + g * 0.25, elite: eliteAt.has(i), flank, drop });
      t += gap * (0.8 + this.rand() * 0.4);
    }
    if (c.boss) this.queue.push({ kind: 'boss', at: Math.max(6, t * 0.35), elite: false });
    this.queue.sort((a, b) => a.at - b.at);
    this.waveTotal = list.length + c.boss; this.waveDone = opening ? 0 : 0;
    this.waveT = 0; this.boss = null;
    const fb = this.bases[this.foe];
    fb.max = 700 + 220 * n; fb.hp = fb.max; fb.shield = false;
    if (!opening) { this.phase = 'intro'; this.phaseT = 1.6; }
    this.emit('waveIntro', { wave: n, boss: c.boss > 0, twist: this.twist });
  }
  nextBossIn() { for (let w = this.wave; w <= MAX_WAVE; w++) if (bossWave(w, this.mod)) return w - this.wave; return -1; }

  // ---------- upgrades ----------
  makeOffer() {
    const owned = (u) => this.up[u.id] >= u.max;
    const epicP = 0.07 + 0.025 * this.wave, rareP = 0.33;
    const offer = [];
    const take = (pool) => {
      const ok = pool.filter((u) => !owned(u) && !offer.some((o) => o.id === u.id));
      return ok.length ? ok[(this.rand() * ok.length) | 0] : null;
    };
    for (let s = 0; s < 3; s++) {
      const roll = this.rand();
      const r = roll < epicP ? 'e' : roll < epicP + rareP ? 'r' : 'c';
      let u = take(UPGRADES.filter((x) => x.r === r)) || take(UPGRADES);
      if (u) offer.push(u);
    }
    // Often dangle an upgrade that completes a synergy: it is the most exciting choice.
    const synOpts = SYNERGIES.filter((s) => !this.syn[s.id] && (this.up[s.a] > 0) !== (this.up[s.b] > 0))
      .map((s) => (this.up[s.a] > 0 ? s.b : s.a)).filter((id) => !owned(UPG[id]) && !offer.some((o) => o.id === id));
    if (synOpts.length && this.rand() < 0.5) offer[offer.length - 1] = UPG[synOpts[(this.rand() * synOpts.length) | 0]];
    // Base in trouble? Make sure repairs are on the table.
    const mb = this.bases[this.team];
    if (mb.hp < mb.max * 0.45 && !offer.some((o) => o.id === 'repair')) offer[0] = UPG.repair;
    this.offer = offer.map((u) => ({ id: u.id, level: this.up[u.id], synergy: this.synergyFor(u.id) }));
    return this.offer;
  }
  synergyFor(id) {
    for (const s of SYNERGIES) {
      if (this.syn[s.id]) continue;
      if (s.a === id && this.up[s.b] > 0) return s.name;
      if (s.b === id && this.up[s.a] > 0) return s.name;
    }
    return null;
  }
  applyUpgrade(id) {
    const h = this.hero;
    this.up[id] = (this.up[id] || 0) + 1;
    this.picked.push(id);
    const oldMax = h.max;
    h.max = this.heroMax();
    if (id === 'hp') h.hp = h.max;
    else if (h.max > oldMax) h.hp += h.max - oldMax;
    h.hp = Math.min(h.hp, h.max);
    if (id === 'repair') { const b = this.bases[this.team]; b.max = Math.round(b.max * 1.15); b.hp = Math.min(b.max, b.hp + b.max * 0.4); }
    for (const s of SYNERGIES) {
      if (!this.syn[s.id] && this.up[s.a] > 0 && this.up[s.b] > 0) { this.syn[s.id] = true; this.emit('synergy', { id: s.id, name: s.name, desc: s.desc }); }
    }
  }
  choose(i) {
    if (this.phase !== 'upgrade' || !this.offer || !this.offer[i]) return false;
    const id = this.offer[i].id;
    this.applyUpgrade(id);
    this.emit('upgrade', { id });
    this.offer = null;
    this.wave++;
    this.startWave();
    return true;
  }

  // ---------- main step ----------
  step(dt, input = {}) {
    if (this.phase === 'won' || this.phase === 'lost' || this.phase === 'upgrade') return;
    this.t += dt;
    this.lastInp = input;
    const h = this.hero;

    if (this.phase === 'intro') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.phase = 'fight'; this.emit('waveStart', { wave: this.wave }); }
    } else if (this.phase === 'fight') {
      this.waveT += dt;
      while (this.queue.length && this.queue[0].at <= this.waveT) {
        const q = this.queue.shift();
        const fz = baseZ(this.foe), d = fwd(this.foe);
        if (q.flank) { // flankers climb in over the side walls, deep in the field
          const side = q.flank, z = fz + d * (24 + this.rand() * 16);
          const u = this.spawnUnit(this.foe, q.kind, side * (ARENA.halfW - 0.8), z, { elite: q.elite });
          u.laneX = side * 6;
          this.emit('flank', { x: u.x, z: u.z });
        } else if (q.drop) {
          const u = this.spawnUnit(this.foe, q.kind, (this.rand() - 0.5) * 22, fz + d * (22 + this.rand() * 6), { elite: q.elite });
          this.emit('dropIn', { x: u.x, z: u.z, side: u.side });
        } else {
          const x = q.kind === 'boss' ? 0 : (this.rand() - 0.5) * 24;
          this.spawnUnit(this.foe, q.kind, x, fz + d * (q.kind === 'boss' ? 6.5 : 5.5 + this.rand() * 2), { elite: q.elite });
        }
      }
      const bq = this.queue.find((q) => q.kind === 'boss');
      const warn = bq ? bq.at - this.waveT : 0;
      if (bq && warn < 3.2) { if (this.bossWarnT <= 0) this.emit('bossWarn', {}); this.bossWarnT = warn; } else this.bossWarnT = 0;
      if (!this.queue.length && !this.units.some((u) => u.side === this.foe)) this.clearWave(false);
    } else if (this.phase === 'clear') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.wave >= MAX_WAVE) { this.phase = 'won'; this.result = { won: true, reason: 'victory' }; this.emit('win', {}); }
        else { this.phase = 'upgrade'; this.makeOffer(); this.emit('offer', {}); }
      }
    }

    // timers
    this.rally = Math.max(0, this.rally - dt);
    this.frenzy = Math.max(0, this.frenzy - dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { if (this.mult > 1) this.emit('comboLost', { combo: this.combo }); this.combo = 0; this.mult = 1; } }
    if (this.streakT > 0) { this.streakT -= dt; if (this.streakT <= 0) this.streak = 0; }
    // Ability power-ups drop onto the floor over time — walking over one unleashes the ability (replaces the Q/E/R buttons).
    if (this.phase === 'fight' || this.phase === 'intro') {
      this.abilT -= dt;
      if (this.abilT <= 0) { this.abilT = 7 + this.rand() * 4; this.spawnAbilityPickup(); }
    }

    this.stepHero(dt, input);
    this.stepAllies(dt);
    this.stepUnits(dt);
    this.stepBases(dt);
    this.stepAbilities(dt);
    this.stepShots(dt);
    this.stepSlams(dt);
    this.stepPickups(dt);
    const booms = this.booms; this.booms = [];
    for (const b of booms) this.explode(b.x, b.z, b.r, b.dmg, b.side, b.byHero, b.kb, b.kind);
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.boss && this.boss.dead) { this.boss = null; this.bases[this.foe].shield = false; }
  }

  clearWave(breach) {
    if (this.phase !== 'fight') return;
    this.phase = 'clear'; this.phaseT = 1.5;
    this.queue = []; this.bossWarnT = 0;
    this.shots = this.shots.filter((s) => s.side === this.team);
    const h = this.hero;
    if (!h.dead) h.hp = Math.min(h.max, h.hp + h.max * 0.2);
    this.stats.waveTimes.push(Math.round(this.waveT));
    const bonus = Math.round((150 + 60 * this.wave) * (breach ? 2 : 1));
    this.score += bonus;
    this.emit('waveClear', { wave: this.wave, bonus, breach });
  }

  // ---------- hero ----------
  stepHero(dt, inp) {
    const h = this.hero;
    h.inv = Math.max(0, h.inv - dt); h.hurtT = Math.max(0, h.hurtT - dt); h.recoil = Math.max(0, h.recoil - dt * 8);
    h.dashCd = Math.max(0, h.dashCd - dt);
    for (const k of ['q', 'e', 'r']) h.cd[k] = Math.max(0, h.cd[k] - dt);
    if (h.dead) {
      h.respawnT -= dt;
      if (h.respawnT <= 0) {
        h.dead = false; h.hp = h.max; h.inv = 2.2;
        h.x = 0; h.z = baseZ(this.team) + fwd(this.team) * 9; h.vx = h.vz = 0;
        this.emit('heroRespawn', { x: h.x, z: h.z });
      }
      return;
    }
    // aim
    if (inp.ax || inp.az) { const l = len(inp.ax, inp.az) || 1; h.aimX = inp.ax / l; h.aimZ = inp.az / l; h.aim = Math.atan2(h.aimX, h.aimZ); }
    // move
    let mx = inp.mx || 0, mz = inp.mz || 0;
    const ml = len(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (inp.dash && h.dashCd <= 0 && h.dashT <= 0 && this.mod !== 'nodash') {
      let dx = mx, dz = mz;
      if (len(dx, dz) < 0.2) { dx = h.aimX; dz = h.aimZ; }
      const l = len(dx, dz) || 1;
      h.dashX = dx / l; h.dashZ = dz / l; h.dashT = HERO.dashTime; h.dashCd = this.dashCd();
      h.inv = Math.max(h.inv, HERO.dashInv); h.dashHits = [];
      this.stats.dashes++;
      this.emit('dash', { x: h.x, z: h.z, dx: h.dashX, dz: h.dashZ });
    }
    if (h.dashT > 0) {
      h.dashT -= dt;
      const sp = HERO.dashDist / HERO.dashTime;
      h.vx = h.dashX * sp; h.vz = h.dashZ * sp;
      if (this.up.dashHit) {
        for (const u of this.units) {
          if (u.side !== this.foe || u.dead || h.dashHits.includes(u.id)) continue;
          if (len(u.x - h.x, u.z - h.z) < u.r + 1.2) {
            h.dashHits.push(u.id);
            this.hitUnit(u, (35 * (this.syn.blink ? 2 : 1) + 10 * (this.up.dashHit - 1)) * this.dmgMul, h.dashX, h.dashZ, 14, true, false);
          }
        }
      }
      if (h.dashT <= 0) { h.vx *= 0.25; h.vz *= 0.25; }
    } else {
      const sp = this.heroSpeed();
      const k = Math.min(1, dt * 14);
      h.vx += (mx * sp - h.vx) * k; h.vz += (mz * sp - h.vz) * k;
    }
    h.x += h.vx * dt; h.z += h.vz * dt;
    h.moving = len(h.vx, h.vz);
    // shooting
    h.fireT -= dt;
    if (inp.fire && h.fireT <= 0) {
      h.fireT = Math.max(h.fireT, -0.05) + 1 / this.heroRate();
      this.fireHero();
    }
    if (h.fireT < 0 && !inp.fire) h.fireT = 0;
    // abilities
    const tdef = { q: inp.q, e: inp.e, r: inp.r };
    for (const k of ['q', 'e', 'r']) if (tdef[k] && h.cd[k] <= 0 && (k !== 'r' || this.ultUnlocked())) this.useAbility(k, inp);
    this.collide(h, 2, true);
  }
  fireHero() {
    const h = this.hero;
    const n = this.multi();
    const spread = this.syn.storm ? 0.17 : 0.11;
    this.shotCount++;
    const big = this.up.over && this.shotCount % 5 === 0;
    const dmg = this.heroDmg();
    for (let i = 0; i < n; i++) {
      const a = h.aim + (i - (n - 1) / 2) * spread;
      const dx = Math.sin(a), dz = Math.cos(a);
      const crit = this.rand() < 0.08;
      this.shots.push({
        x: h.x + dx * 0.9, z: h.z + dz * 0.9, dx, dz, spd: HERO.shotSpeed * (big ? 0.8 : 1), life: HERO.shotLife * (big ? 1.4 : 1),
        dmg: dmg * (crit ? 2 : 1) * (big ? 3 : 1), side: this.team, src: 'hero', pierce: this.pierce() + (big ? 2 : 0), hits: [],
        r: big ? 0.55 : 0.28, crit, big, bounce: this.up.bounce + (this.up.bounce && this.syn.ricostorm ? 1 : 0),
      });
    }
    h.recoil = 1;
    this.stats.shots++;
    this.emit('shot', { x: h.x, z: h.z, a: h.aim, big, n });
  }
  useAbility(k, inp) {
    const h = this.hero, T = this.team;
    const base = { q: 11, e: 17, r: 22 }[k];
    const cdBase = T === 'ai' ? { q: 10, e: 17, r: 22 }[k] : base;
    h.cd[k] = cdBase * this.cdMul(); h.cdMax[k] = h.cd[k];
    this.stats.abilities++;
    const ax = h.aimX, az = h.aimZ;
    if (T === 'human' && k === 'q') {
      this.walls.push({ x: h.x + ax * 2.6, z: h.z + az * 2.6, nx: ax, nz: az, half: 3.8, t: 7, max: 7, side: T });
      this.emit('ability', { k, name: 'wall', x: h.x + ax * 2.6, z: h.z + az * 2.6 });
    } else if (T === 'human' && k === 'e') {
      this.rally = 9;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        this.spawnUnit(T, 'grunt', clamp(h.x + Math.cos(a) * 1.8, -16, 16), clamp(h.z + Math.sin(a) * 1.8, -33, 33));
      }
      this.emit('ability', { k, name: 'rally', x: h.x, z: h.z });
    } else if (T === 'human' && k === 'r') {
      const d = clamp(inp.aimDist || 9, 4, 15);
      const tx = h.x + ax * d, tz = h.z + az * d;
      for (let i = 0; i < 3; i++) {
        const a = this.rand() * 6.28, rr = i === 0 ? 0 : 2.6;
        this.slams.push({ x: tx + Math.cos(a) * rr, z: tz + Math.sin(a) * rr, r: 3.3, t: 0.75 + i * 0.18, max: 0.75 + i * 0.18, side: T, dmg: 55 + this.heroDmg() * 2, kb: 12, byHero: true, kind: 'boulder' });
      }
      this.emit('ability', { k, name: 'catapult', x: tx, z: tz });
    } else if (T === 'ai' && k === 'q') {
      const x0 = h.x + ax * 1.2, z0 = h.z + az * 1.2;
      this.fires.push({ x0, z0, x1: x0 + ax * 15, z1: z0 + az * 15, w: 1.35, t: 3.2, max: 3.2, tick: 0, side: T });
      this.emit('ability', { k, name: 'firewall', x: x0, z: z0, dx: ax, dz: az });
    } else if (T === 'ai' && k === 'e') {
      for (let i = 0; i < 3; i++) {
        const a = h.aim + (i - 1) * 1.2;
        this.drones.push({ x: h.x + Math.sin(a) * 1.5, z: h.z + Math.cos(a) * 1.5, vx: 0, vz: 0, t: 8, fireT: 0.3 + i * 0.1, side: T, dive: null, ang: a, id: this.nid++ });
      }
      this.emit('ability', { k, name: 'drones', x: h.x, z: h.z });
    } else if (T === 'ai' && k === 'r') {
      this.explode(h.x, h.z, 8, 45 + this.heroDmg() * 1.5, T, true, 13, 'emp', 2.2);
      this.emit('ability', { k, name: 'emp', x: h.x, z: h.z });
    }
  }

  // ---------- allies (your side's minions) ----------
  stepAllies(dt) {
    if (this.phase !== 'fight' && this.phase !== 'intro') return;
    this.allyT -= dt;
    if (this.allyT <= 0) {
      this.allyT = 4.2;
      const cap = 10 + (this.rally > 0 ? 4 : 0);
      const n = this.units.filter((u) => u.side === this.team).length;
      const az = baseZ(this.team), d = fwd(this.team);
      for (let i = 0; i < 2 && n + i < cap; i++) this.spawnUnit(this.team, 'grunt', (this.rand() - 0.5) * 16, az + d * 6);
    }
  }

  // ---------- minions ----------
  findTarget(u) {
    let best = null, bd = u.aggro * u.aggro;
    for (const o of this.units) {
      if (o.side === u.side || o.dead) continue;
      const d = (o.x - u.x) ** 2 + (o.z - u.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    const h = this.hero;
    if (u.side === this.foe && !h.dead) {
      const d = ((h.x - u.x) ** 2 + (h.z - u.z) ** 2) * 0.7; // prefer the hero a little
      if (d < bd || (u.kind === 'boss' && d < u.aggro * u.aggro)) { bd = d; best = h; }
    }
    const b = this.bases[other(u.side)];
    const db = len(b.x - u.x, b.z - u.z) - b.r;
    if (!best && db < u.aggro + 1) best = b;
    return best;
  }
  stepUnits(dt) {
    const ar = ARENA;
    let foes = 0;
    for (const u of this.units) if (u.side === this.foe) foes++;
    const hunt = this.phase === 'fight' && !this.queue.length && foes <= 3 && this.waveT > 6;
    if (hunt && !this.hunting) { this.hunting = true; this.emit('hunt', { n: foes }); }
    if (!hunt) this.hunting = false;
    for (const u of this.units) {
      if (u.dead) continue;
      u.hitT = Math.max(0, u.hitT - dt); u.swing = Math.max(0, u.swing - dt * 3.5);
      u.atkT -= dt;
      const rallied = u.ally && this.rally > 0;
      const enraged = hunt && u.side === this.foe && u.kind !== 'boss';
      const spMul = this.speedMul * (rallied ? 1.6 : 1) * (enraged ? 1.5 : 1);
      if (u.stun > 0) {
        u.stun -= dt;
        u.x += u.kx * dt; u.z += u.kz * dt;
        const kd = Math.exp(-7 * dt); u.kx *= kd; u.kz *= kd;
        this.collide(u, u.mass, false);
        continue;
      }
      u.thinkT -= dt;
      if (u.thinkT <= 0 || !u.tgt || u.tgt.dead || u.tgt.hp <= 0) {
        u.thinkT = 0.22 + this.rand() * 0.1;
        u.tgt = enraged && !this.hero.dead ? this.hero : this.findTarget(u);
      }
      const t = u.tgt;
      let gx, gz, d = 1e9;
      const eb = this.bases[other(u.side)];
      if (t) { gx = t.x; gz = t.z; d = len(gx - u.x, gz - u.z); }
      else { // march down the field, weaving a little
        gx = u.laneX + Math.sin(this.t * 0.7 + u.wob) * 2; gz = eb.z - fwd(u.side) * (eb.r + 1);
        d = len(gx - u.x, gz - u.z);
      }
      let mvx = 0, mvz = 0;
      const dx = (gx - u.x) / (d || 1), dz = (gz - u.z) / (d || 1);
      const tr = t ? t.r : 0;
      if (u.kind === 'boss') { this.stepBoss(u, dt, t, d, dx, dz); }
      else if (KINDS[u.kind].ranged && t) {
        const keep = KINDS.shooter.keep;
        const ownZ = baseZ(u.side), behind = (u.z - ownZ) * fwd(u.side) < 10;
        if (d < keep - 2.5 && t.type === 'hero' && !enraged && !behind) { mvx = -dx; mvz = -dz; }
        else if (d > keep + 1 || enraged) { mvx = dx; mvz = dz; }
        else { mvx = -dz * 0.45 * Math.sin(u.wob + this.t); mvz = dx * 0.45 * Math.sin(u.wob + this.t); }
        if (d < keep + 5 && u.atkT <= 0) {
          u.atkT = u.atk * (0.85 + this.rand() * 0.3); u.swing = 1;
          const lead = t.type === 'hero' ? 0.25 : 0;
          const tx = t.x + (t.vx || 0) * lead * d / KINDS.shooter.shotSpeed, tz = t.z + (t.vz || 0) * lead * d / KINDS.shooter.shotSpeed;
          const l = len(tx - u.x, tz - u.z) || 1;
          this.shots.push({ x: u.x, z: u.z, dx: (tx - u.x) / l, dz: (tz - u.z) / l, spd: KINDS.shooter.shotSpeed * this.speedMul, life: 1.6, dmg: u.dmg * this.dmgMul, side: u.side, src: 'unit', pierce: 0, hits: [], r: 0.35, orb: true });
          this.emit('enemyShot', { x: u.x, z: u.z, side: u.side });
        }
      } else {
        const reach = u.r + tr + u.reach;
        if (t && d <= reach) {
          if (u.atkT <= 0) {
            u.atkT = u.atk; u.swing = 1;
            const dmg = u.dmg * (rallied ? 2 : 1) * this.dmgMul * (t.type === 'base' && u.ally ? 0.6 : 1);
            this.damage(t, dmg, dx, dz, KINDS[u.kind].kb || 2.5, u);
          }
        } else { mvx = dx; mvz = dz; }
      }
      const sp = u.speed * spMul;
      if (u.kind !== 'boss') {
        u.vx += (mvx * sp - u.vx) * Math.min(1, dt * 8); u.vz += (mvz * sp - u.vz) * Math.min(1, dt * 8);
      }
      u.x += (u.vx + u.kx) * dt; u.z += (u.vz + u.kz) * dt;
      const kd = Math.exp(-7 * dt); u.kx *= kd; u.kz *= kd;
      u.walk += len(u.vx, u.vz) * dt;
      const fa = t && (d < 6 || KINDS[u.kind].ranged) ? Math.atan2(dx, dz) : (len(u.vx, u.vz) > 0.3 ? Math.atan2(u.vx, u.vz) : u.face);
      let da = fa - u.face; while (da > Math.PI) da -= 6.2832; while (da < -Math.PI) da += 6.2832;
      u.face += da * Math.min(1, dt * 10);
      this.collide(u, u.mass, false);
    }
    // separation between minions
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        const dx = b.x - a.x, dz = b.z - a.z, rr = a.r + b.r;
        if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), o = (rr - d) / d;
        const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        a.x -= dx * o * wa * 0.5; a.z -= dz * o * wa * 0.5;
        b.x += dx * o * wb * 0.5; b.z += dz * o * wb * 0.5;
      }
    }
    void ar;
  }
  stepBoss(u, dt, t, d, dx, dz) {
    const lateBoss = this.wave >= 6;
    if (u.state === 'walk') {
      const sp = u.speed * this.speedMul;
      u.vx += (dx * sp - u.vx) * Math.min(1, dt * 4); u.vz += (dz * sp - u.vz) * Math.min(1, dt * 4);
      if (t && d < u.r + t.r + 0.5) { u.vx *= 0.2; u.vz *= 0.2; }
      u.bossT -= dt;
      if (t && u.bossT <= 0 && d < 15) {
        u.alt++;
        const leap = lateBoss && u.alt % 2 === 0 && d > 5;
        u.vx = u.vz = 0;
        const dmg = u.dmg * (1 + 0.15 * this.bossIndex()) * this.dmgMul;
        if (leap) {
          const tx = clamp(t.x, -15, 15), tz = clamp(t.z, -32, 32);
          u.state = 'leap'; u.stateT = 1.25; u.leap = { x0: u.x, z0: u.z, x1: tx, z1: tz, t: 1.25 };
          this.slams.push({ x: tx, z: tz, r: 4.8, t: 1.25, max: 1.25, side: u.side, dmg, kb: 16, owner: u.id, kind: 'leap' });
        } else {
          const reach = Math.min(d, 4.8);
          u.state = 'wind'; u.stateT = 1.05;
          this.slams.push({ x: u.x + dx * reach, z: u.z + dz * reach, r: 4.6, t: 1.05, max: 1.05, side: u.side, dmg, kb: 14, owner: u.id, kind: 'slam' });
        }
        u.bossT = Math.max(2.4, 4.0 - 0.25 * this.bossIndex());
        this.emit('telegraph', { x: u.x, z: u.z, leap });
      }
      if (lateBoss) {
        u.burstT -= dt;
        if (u.burstT <= 0) {
          u.burstT = this.wave === MAX_WAVE ? 4.2 : 5.5;
          const n = this.wave === MAX_WAVE ? 16 : 12;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + this.t;
            this.shots.push({ x: u.x, z: u.z, dx: Math.sin(a), dz: Math.cos(a), spd: 11 * this.speedMul, life: 2.6, dmg: 9 * this.dmgMul, side: u.side, src: 'unit', pierce: 0, hits: [], r: 0.45, orb: true });
          }
          this.emit('burst', { x: u.x, z: u.z });
        }
      }
    } else {
      u.stateT -= dt;
      if (u.state === 'leap' && u.leap) {
        const p = 1 - Math.max(0, u.stateT) / u.leap.t;
        const e = p < 0.35 ? 0 : (p - 0.35) / 0.65; // crouch, then fly
        u.x = u.leap.x0 + (u.leap.x1 - u.leap.x0) * e; u.z = u.leap.z0 + (u.leap.z1 - u.leap.z0) * e;
        u.vx = u.vz = 0;
      }
      if (u.stateT <= 0) {
        if (u.state === 'recover') { u.state = 'walk'; u.leap = null; }
        else { u.state = 'recover'; u.stateT = 0.7; u.swing = 1; }
      }
    }
  }

  // Push an actor out of cover, bases, walls and the arena edge.
  collide(a, mass, isHero) {
    for (const c of this.cover) {
      const dx = a.x - c.x, dz = a.z - c.z, rr = a.r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; a.x = c.x + (dx / d) * rr; a.z = c.z + (dz / d) * rr; }
    }
    for (const k of ['human', 'ai']) {
      const b = this.bases[k];
      const dx = a.x - b.x, dz = a.z - b.z, rr = a.r + b.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; a.x = b.x + (dx / d) * rr; a.z = b.z + (dz / d) * rr; }
    }
    if (!isHero && a.side === this.foe) {
      for (const w of this.walls) {
        const tx = -w.nz, tz = w.nx;
        const px = a.x - w.x, pz = a.z - w.z;
        const along = px * tx + pz * tz, across = px * w.nx + pz * w.nz;
        if (Math.abs(along) < w.half + a.r * 0.5 && Math.abs(across) < a.r + 0.35) {
          const s = across >= 0 ? 1 : -1, push = s * (a.r + 0.35) - across;
          a.x += w.nx * push; a.z += w.nz * push;
          a.vx *= 0.5; a.vz *= 0.5;
        }
      }
    }
    if (isHero) {
      for (const u of this.units) {
        if (u.dead || u.side !== this.foe) continue;
        const dx = a.x - u.x, dz = a.z - u.z, rr = a.r + u.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        if (a.dashT > 0) continue;
        const d = Math.sqrt(d2), o = rr - d, w = u.mass / (u.mass + mass);
        a.x += (dx / d) * o * w; a.z += (dz / d) * o * w;
        u.x -= (dx / d) * o * (1 - w); u.z -= (dz / d) * o * (1 - w);
      }
    }
    const hw = ARENA.halfW - a.r, hl = ARENA.halfL - a.r;
    a.x = clamp(a.x, -hw, hw); a.z = clamp(a.z, -hl, hl);
  }

  // ---------- damage ----------
  damage(t, dmg, dx, dz, kb, src) {
    if (t.type === 'hero') this.hurtHero(dmg, dx, dz, kb);
    else if (t.type === 'base') this.hurtBase(t, dmg);
    else if (t.type === 'unit') this.hitUnit(t, dmg, dx, dz, kb, false, false);
    void src;
  }
  hurtHero(dmg, dx, dz, kb) {
    const h = this.hero;
    if (h.dead || h.inv > 0 || this.phase === 'clear') return;
    h.hp -= dmg; h.hurtT = 0.35; h.inv = 0.18;
    h.vx += dx * kb * 1.2; h.vz += dz * kb * 1.2;
    this.stats.dmgTaken += dmg;
    this.emit('heroHurt', { x: h.x, z: h.z, dmg });
    if (h.hp <= 0) {
      h.hp = 0; h.dead = true; h.dashT = 0;
      if (h.revives <= 0) { this.lose('hero'); this.emit('heroDown', { x: h.x, z: h.z, final: true }); }
      else { h.revives--; h.respawnT = HERO.respawn; this.emit('heroDown', { x: h.x, z: h.z, final: false }); }
    }
  }
  hurtBase(b, dmg) {
    if (b.shield || this.phase === 'clear' || this.phase === 'won' || this.phase === 'lost') {
      if (b.shield) this.emit('shieldHit', { side: b.side });
      return;
    }
    b.hp -= dmg; b.hitT = 0.2;
    this.emit('baseHit', { side: b.side, dmg, x: b.x, z: b.z });
    if (b.hp <= 0) {
      b.hp = 0;
      if (b.side === this.team) this.lose('base');
      else this.breach();
    }
  }
  breach() {
    this.stats.breaches++;
    this.emit('breach', { side: this.foe, x: this.bases[this.foe].x, z: this.bases[this.foe].z });
    for (const u of this.units) if (u.side === this.foe && !u.dead) this.killUnit(u, true, 0, 0, true);
    this.queue = [];
    this.clearWave(true);
  }
  lose(reason) {
    if (this.phase === 'lost' || this.phase === 'won') return;
    this.phase = 'lost'; this.result = { won: false, reason };
    this.emit('lose', { reason });
  }
  hitUnit(u, dmg, dx, dz, kb, byHero, crit) {
    if (u.dead) return;
    u.hp -= dmg; u.hitT = 0.11;
    const m = u.kind === 'boss' ? 30 : u.mass;
    u.kx += (dx * kb) / m; u.kz += (dz * kb) / m;
    this.emit('hit', { x: u.x, z: u.z, dmg, crit, byHero, kind: u.kind, side: u.side, dx, dz, id: u.id });
    if (u.hp <= 0) this.killUnit(u, byHero, dx, dz, false);
  }
  killUnit(u, byHero, dx, dz, silent) {
    if (u.dead) return;
    u.dead = true; u.hp = 0;
    const foeUnit = u.side === this.foe;
    let pts = 0;
    if (foeUnit) {
      this.kills++; this.waveDone++;
      if (byHero) {
        this.heroKills++;
        this.combo++; this.comboT = 3.2;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        const nm = Math.min(8, 1 + Math.floor(this.combo / 5));
        if (nm > this.mult) this.emit('multUp', { mult: nm });
        this.mult = nm;
        this.streak = this.streakT > 0 ? this.streak + 1 : 1; this.streakT = 1.4;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        for (const [n, name] of STREAKS) if (this.streak === n) this.emit('streak', { n, name });
        const h = this.hero;
        if (!h.dead) {
          const heal = 2 * this.up.leech * (this.syn.vampire ? 3 : 1);
          if (heal) h.hp = Math.min(h.max, h.hp + heal);
          if (this.up.dashKill) h.dashCd = Math.max(0, h.dashCd - 0.45 * this.up.dashKill);
        }
      }
      pts = Math.round(KINDS[u.kind].score * (u.elite ? 3 : 1) * (byHero ? this.mult : 1) * (1 + 0.1 * (this.wave - 1)) * (this.twist === 'bounty' ? 2 : 1));
      this.score += pts;
      if (u.kind === 'boss') this.stats.bossKills++;
      // random drops keep every few seconds interesting
      const chance = (u.elite ? 1 : u.kind === 'brute' ? 0.22 : u.kind === 'boss' ? 1 : 0.035) * (this.twist === 'goldrush' ? 4 : 1);
      if (!silent && this.rand() < chance) this.dropPickup(u.x, u.z);
      if (this.up.boom && byHero && !silent) {
        const big = this.syn.detonator ? 1.6 : 1;
        this.booms.push({ x: u.x, z: u.z, r: 2.4 * big, dmg: (10 + this.heroDmg() * 0.8) * big, side: this.team, byHero: true, kb: 8, kind: 'chain' });
      }
    }
    const last = foeUnit && this.phase === 'fight' && !this.queue.length && !this.units.some((o) => o !== u && !o.dead && o.side === this.foe);
    this.emit('kill', { x: u.x, z: u.z, kind: u.kind, side: u.side, elite: u.elite, byHero, dx, dz, pts, last, silent, id: u.id, r: u.r });
  }
  dropPickup(x, z) {
    const r = this.rand();
    const kind = r < 0.45 ? 'heal' : r < 0.8 ? 'frenzy' : 'reset';
    this.pickups.push({ kind, x, z, t: PICKUPS[kind].life, id: this.nid++ });
    this.emit('drop', { kind, x, z });
  }
  // Spawn one ability power-up at a random floor spot. Capped so the arena never floods with them.
  spawnAbilityPickup() {
    let onFloor = 0;
    for (const p of this.pickups) if (PICKUPS[p.kind].ability) onFloor++;
    if (onFloor >= 2) return;
    const pool = ABILITY_PICKS.filter((k) => ABILITY_KEY[k] !== 'r' || this.ultUnlocked());
    const kind = pool[(this.rand() * pool.length) | 0];
    const x = (this.rand() - 0.5) * 26, z = (this.rand() - 0.5) * 44;
    this.pickups.push({ kind, x, z, t: PICKUPS[kind].life, id: this.nid++ });
    this.emit('drop', { kind, x, z });
  }
  // A hero grabbed an ability power-up: unleash that ability now (reusing the cast logic + 'ability' event) and note what fired.
  fireAbilityPickup(k) {
    const h = this.hero;
    if (h.dead) return;
    this.useAbility(k, this.lastInp || {});
    const ab = TEAMS[this.team].abilities[k];
    this.note = { id: ++this._noteId, text: (ab ? ab.name : 'Ability') + '!' };
  }
  explode(x, z, r, dmg, side, byHero, kb, kind, stun = 0) {
    for (const u of this.units) {
      if (u.dead || u.side === side) continue;
      const dx = u.x - x, dz = u.z - z, d = len(dx, dz);
      if (d > r + u.r) continue;
      const f = 1 - 0.5 * Math.min(1, d / r);
      if (stun) u.stun = Math.max(u.stun, u.kind === 'boss' ? stun * 0.3 : stun);
      this.hitUnit(u, dmg * f, dx / (d || 1), dz / (d || 1), kb, byHero, false);
    }
    if (side === this.foe) {
      const h = this.hero; const d = len(h.x - x, h.z - z);
      if (d < r + h.r) this.hurtHero(dmg, (h.x - x) / (d || 1), (h.z - z) / (d || 1), kb);
    }
    this.emit('boom', { x, z, r, kind, side });
  }

  // ---------- bases ----------
  stepBases(dt) {
    for (const k of ['human', 'ai']) {
      const b = this.bases[k];
      b.hitT = Math.max(0, b.hitT - dt);
      b.fireT -= dt;
      if (b.fireT > 0 || this.phase === 'clear') continue;
      const range = k === this.team ? 10 : 13;
      let best = null, bd = range * range;
      for (const u of this.units) {
        if (u.side === k || u.dead) continue;
        const d = (u.x - b.x) ** 2 + (u.z - b.z) ** 2;
        if (d < bd) { bd = d; best = u; }
      }
      const h = this.hero;
      if (!best && k === this.foe && !h.dead && (h.x - b.x) ** 2 + (h.z - b.z) ** 2 < bd) best = h;
      if (!best) { b.fireT = 0.2; continue; }
      b.fireT = k === this.team ? 0.8 : 0.6;
      const sx = b.x, sz = b.z + fwd(k) * 2.5;
      const l = len(best.x - sx, best.z - sz) || 1;
      this.shots.push({ x: sx, z: sz, dx: (best.x - sx) / l, dz: (best.z - sz) / l, spd: 30, life: 0.7, dmg: k === this.team ? 7 : 8 * this.dmgMul, side: k, src: 'turret', pierce: 0, hits: [], r: 0.3 });
      this.emit('turret', { side: k, x: sx, z: sz, tx: best.x, tz: best.z });
    }
  }

  // ---------- abilities & drones ----------
  stepAbilities(dt) {
    for (const w of this.walls) w.t -= dt;
    if (this.walls.length) this.walls = this.walls.filter((w) => w.t > 0);
    for (const f of this.fires) {
      f.t -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.25;
        const dmg = (6 + this.heroDmg() * 0.4);
        for (const u of this.units) {
          if (u.dead || u.side === f.side) continue;
          if (segCircle(f.x0, f.z0, f.x1, f.z1, u.x, u.z, f.w + u.r) >= 0) this.hitUnit(u, dmg, 0, 0, 0, true, false);
        }
      }
    }
    if (this.fires.length) this.fires = this.fires.filter((f) => f.t > 0);
    const h = this.hero;
    for (const d of this.drones) {
      d.t -= dt;
      let tgt = null, bd = 18 * 18;
      for (const u of this.units) {
        if (u.dead || u.side === d.side) continue;
        const dd = (u.x - d.x) ** 2 + (u.z - d.z) ** 2;
        if (dd < bd) { bd = dd; tgt = u; }
      }
      if (d.t <= 0 && !d.dive) d.dive = { t: 1.2, tgt: tgt ? tgt.id : -1 };
      if (d.dive) {
        d.dive.t -= dt;
        const tg = this.units.find((u) => u.id === d.dive.tgt && !u.dead) || tgt;
        if (tg) {
          const dx = tg.x - d.x, dz = tg.z - d.z, l = len(dx, dz) || 1;
          d.vx = (dx / l) * 24; d.vz = (dz / l) * 24;
          if (l < tg.r + 0.6) d.dive.t = 0;
        }
        d.x += d.vx * dt; d.z += d.vz * dt;
        if (d.dive.t <= 0) { d.dead = true; this.booms.push({ x: d.x, z: d.z, r: 3.2, dmg: 30 + this.heroDmg() * 1.2, side: d.side, byHero: true, kb: 10, kind: 'drone' }); }
        continue;
      }
      d.ang += dt * 2.2;
      let gx = h.x + Math.sin(d.ang) * 2.2, gz = h.z + Math.cos(d.ang) * 2.2;
      if (tgt) { const l = Math.sqrt(bd) || 1; gx = tgt.x - ((tgt.x - d.x) / l) * 5 + Math.sin(d.ang) * 1.5; gz = tgt.z - ((tgt.z - d.z) / l) * 5 + Math.cos(d.ang) * 1.5; }
      d.vx += ((gx - d.x) * 4 - d.vx) * Math.min(1, dt * 5); d.vz += ((gz - d.z) * 4 - d.vz) * Math.min(1, dt * 5);
      d.x += d.vx * dt; d.z += d.vz * dt;
      d.fireT -= dt;
      if (tgt && d.fireT <= 0 && bd < 14 * 14) {
        d.fireT = 0.32;
        const l = Math.sqrt(bd) || 1;
        this.shots.push({ x: d.x, z: d.z, dx: (tgt.x - d.x) / l, dz: (tgt.z - d.z) / l, spd: 40, life: 0.5, dmg: this.heroDmg() * 0.6, side: d.side, src: 'hero', pierce: 0, hits: [], r: 0.25, drone: true });
        this.emit('droneShot', { x: d.x, z: d.z });
      }
    }
    if (this.drones.length) this.drones = this.drones.filter((d) => !d.dead);
  }

  // ---------- projectiles ----------
  stepShots(dt) {
    const keep = [];
    const h = this.hero;
    for (const s of this.shots) {
      s.life -= dt;
      const x0 = s.x, z0 = s.z;
      const x1 = x0 + s.dx * s.spd * dt, z1 = z0 + s.dz * s.spd * dt;
      let dead = s.life <= 0;
      // shields and firewalls stop enemy shots
      if (!dead && s.side === this.foe) {
        for (const w of this.walls) {
          const tx = -w.nz, tz = w.nx;
          if (segSeg(x0, z0, x1, z1, w.x - tx * w.half, w.z - tz * w.half, w.x + tx * w.half, w.z + tz * w.half)) { dead = true; this.emit('block', { x: x1, z: z1 }); break; }
        }
        if (!dead) for (const f of this.fires) {
          if (segCircle(f.x0, f.z0, f.x1, f.z1, x1, z1, f.w) >= 0) { dead = true; this.emit('block', { x: x1, z: z1 }); break; }
        }
      }
      if (!dead) for (const c of this.cover) {
        if (segCircle(x0, z0, x1, z1, c.x, c.z, c.r + s.r * 0.5) >= 0) { dead = true; this.emit('spark', { x: x1, z: z1, side: s.side, cover: true }); break; }
      }
      if (!dead) {
        // units
        for (const u of this.units) {
          if (u.dead || u.side === s.side || s.hits.includes(u.id)) continue;
          if (segCircle(x0, z0, x1, z1, u.x, u.z, u.r + s.r) < 0) continue;
          s.hits.push(u.id);
          const byHero = s.src === 'hero';
          this.hitUnit(u, s.dmg, s.dx, s.dz, s.big ? 10 : byHero ? 3.2 : 2, byHero, !!s.crit);
          if (s.big) this.booms.push({ x: u.x, z: u.z, r: 3 * (this.syn.detonator ? 1.6 : 1), dmg: s.dmg * 0.5 * (this.syn.detonator ? 1.4 : 1), side: s.side, byHero, kb: 10, kind: 'over' });
          if (s.bounce > 0) {
            let nb = null, nd = 9 * 9;
            for (const o of this.units) {
              if (o.dead || o.side === s.side || s.hits.includes(o.id)) continue;
              const dd = (o.x - u.x) ** 2 + (o.z - u.z) ** 2;
              if (dd < nd) { nd = dd; nb = o; }
            }
            if (nb) {
              s.bounce--; const l = Math.sqrt(nd) || 1;
              s.x = u.x; s.z = u.z; s.dx = (nb.x - u.x) / l; s.dz = (nb.z - u.z) / l; s.life = Math.max(s.life, 0.35);
              this.emit('bounce', { x: u.x, z: u.z });
              break;
            }
          }
          if (s.pierce > 0) { s.pierce--; s.dmg *= 0.85; continue; }
          dead = true; break;
        }
      }
      if (!dead && s.side === this.foe && !h.dead && segCircle(x0, z0, x1, z1, h.x, h.z, h.r + s.r) >= 0) {
        if (h.inv <= 0) { this.hurtHero(s.dmg, s.dx, s.dz, 3); dead = true; }
      }
      if (!dead) {
        const b = this.bases[other(s.side)];
        if (segCircle(x0, z0, x1, z1, b.x, b.z, b.r) >= 0) {
          this.hurtBase(b, s.dmg * (s.src === 'hero' ? 1 : 0.6)); dead = true;
          this.emit('spark', { x: x1, z: z1, side: s.side, base: true });
        }
      }
      if (!dead && (Math.abs(x1) > ARENA.halfW + 2 || Math.abs(z1) > ARENA.halfL + 2)) dead = true;
      if (!dead && s.dx === s.dx) { // moved unless bounced this step
        if (s.x === x0 && s.z === z0) { s.x = x1; s.z = z1; }
        keep.push(s);
      }
    }
    this.shots = keep;
  }
  stepSlams(dt) {
    const h = this.hero;
    for (const s of this.slams) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      const owner = s.owner ? this.units.find((u) => u.id === s.owner) : null;
      if (s.owner && !owner) continue; // boss died mid wind-up
      for (const u of this.units) {
        if (u.dead || u.side === s.side) continue;
        const dx = u.x - s.x, dz = u.z - s.z, d = len(dx, dz);
        if (d < s.r + u.r * 0.5) this.hitUnit(u, s.dmg * (s.side === this.foe ? 0.6 : 1), dx / (d || 1), dz / (d || 1), s.kb, !!s.byHero, false);
      }
      if (s.side === this.foe && !h.dead) {
        const dx = h.x - s.x, dz = h.z - s.z, d = len(dx, dz);
        if (d < s.r + h.r * 0.3) this.hurtHero(s.dmg, dx / (d || 1), dz / (d || 1), s.kb);
      }
      const b = this.bases[other(s.side)];
      if (len(b.x - s.x, b.z - s.z) < s.r + b.r) this.hurtBase(b, s.dmg * 1.5);
      this.emit('slam', { x: s.x, z: s.z, r: s.r, kind: s.kind || 'slam', side: s.side });
    }
    if (this.slams.length) this.slams = this.slams.filter((s) => !s.done);
  }
  stepPickups(dt) {
    const h = this.hero;
    for (const p of this.pickups) {
      p.t -= dt;
      if (h.dead) continue;
      const dx = h.x - p.x, dz = h.z - p.z, d = len(dx, dz);
      if (d < 3.2) { p.x += (dx / (d || 1)) * dt * 12; p.z += (dz / (d || 1)) * dt * 12; }
      if (d < 1.1) {
        p.t = 0; p.got = true; this.stats.pickups++;
        const ability = PICKUPS[p.kind].ability;
        if (ability) { this.fireAbilityPickup(ability); continue; } // the 'ability' event drives visuals/sound; note drives the toast
        if (p.kind === 'heal') h.hp = Math.min(h.max, h.hp + h.max * 0.35);
        else if (p.kind === 'frenzy') this.frenzy = PICKUPS.frenzy.dur;
        else if (p.kind === 'reset') { h.cd.q = h.cd.e = h.cd.r = 0; h.dashCd = 0; }
        this.emit('pickup', { kind: p.kind, x: p.x, z: p.z });
      }
    }
    if (this.pickups.length) this.pickups = this.pickups.filter((p) => p.t > 0);
  }
}
