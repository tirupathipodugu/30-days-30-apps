// Human vs AI 2.0 — the live multiplayer match. Pure data + rules (no DOM, no three.js), so the Cloudflare
// game server (server/room-v2.js) runs exactly this file; the page renders the snapshots it sends.
// Real Team Human heroes fight real Team AI heroes (PvP) while both sides' minion waves march (PvE).
// Bot heroes fill a side that has fewer players. A match ends when a base falls or after 8 minutes.
import { ARENA, HERO, KINDS, UPGRADES, UPG, SYNERGIES, PICKUPS, STREAKS, TWISTS, baseZ, fwd, other, ABILITY_PICKS } from './config.js?v=1015.2125';
import { COVER, mulberry32, segCircle, segSeg } from './sim.js?v=1015.2125';
import { makeBot, botPick } from './bot.js?v=1015.2125';

export const MATCH = {
  dur: 480, showEnd: 8, respawn: 4, maxPerSide: 6, maxPlayers: 12, offerTime: 10,
  waveEvery: 24, bossAt: [180, 360], pvp: 0.5, baseHp: 3500, unitCap: 34,
};
export const SIDES = ['human', 'ai'];
export const KIND_LIST = ['grunt', 'runner', 'shooter', 'brute', 'boss'];
export const PICK_LIST = ['heal', 'frenzy', 'reset', 'abil_q', 'abil_e', 'abil_r'];
export const SLAM_KINDS = ['slam', 'leap', 'boulder'];
export const BOSS_STATES = ['walk', 'wind', 'leap', 'recover'];
const BOT_NAMES = ['Nova', 'Pixel', 'Echo', 'Blaze', 'Volt', 'Rook', 'Juno', 'Sable', 'Orbit', 'Flint', 'Kite', 'Zed', 'Ember', 'Quill'];
const HERO_STREAKS = [[2, 'is on a double!'], [3, 'is on a rampage!'], [5, 'is unstoppable!'], [7, 'is godlike!'], [10, 'is legendary!']];
const XP = { grunt: 3, runner: 4, shooter: 5, brute: 12, boss: 100 };
export const xpNeed = (lvl) => 40 + 30 * lvl;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const len = (x, z) => Math.sqrt(x * x + z * z);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const ROUND = ['x', 'z', 'tx', 'tz', 'dx', 'dz', 'dmg', 'r', 'a'];

// Same rule as v1: letters, digits, space, _ and -, at most 14 characters.
export function cleanName(s) {
  const n = String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return n || 'Player' + String(100 + ((Math.random() * 900) | 0));
}

export class Match {
  constructor({ seed = 1 } = {}) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.events = [];
    this.players = new Map(); // pid -> { name, side } (survives match restarts)
    this.hid = 1; this.nid = 1; this.matchNo = 0;
    this.cfg = { bots: true, waves: true }; // tests can switch bots / waves off
    this.heroes = [];
    this.reset(true);
  }

  emit(type, data) {
    const e = Object.assign({ type }, data);
    for (const k of ROUND) if (typeof e[k] === 'number') e[k] = k === 'a' ? r2(e[k]) : r1(e[k]);
    this.events.push(e);
  }

  // ---------- match lifecycle ----------
  reset(first = false) {
    this.matchNo++;
    this.t = 0; this.phase = 'play'; this.endT = 0; this.result = null;
    this.bases = { human: this.makeBase('human'), ai: this.makeBase('ai') };
    this.units = []; this.shots = []; this.walls = []; this.fires = []; this.drones = [];
    this.slams = []; this.pickups = []; this.booms = []; this.queue = [];
    this.cover = COVER.map((c) => ({ ...c }));
    this.rally = { human: 0, ai: 0 };
    this.bosses = { human: null, ai: null }; this.bossNo = 0; this.bossWarned = 0;
    this.waveN = 0; this.nextWaveT = 3; this.twist = null; this.xpT = 0; this.abilT = 6;
    const old = this.heroes;
    this.heroes = [];
    for (const [pid, p] of this.players) this.heroes.push(this.makeHero(p.side, p.name, pid, false));
    void old;
    this.fillBots();
    this.dirty = true;
    if (!first) this.emit('matchStart', { n: this.matchNo });
  }
  makeBase(side) {
    return { type: 'base', side, x: 0, z: baseZ(side), r: ARENA.baseR, hp: MATCH.baseHp, max: MATCH.baseHp, fireT: 1, hitT: 0, shield: false, evT: 0, mile: 3 };
  }
  makeHero(side, name, pid, bot) {
    const h = {
      type: 'hero', id: this.hid++, pid: pid || null, bot: !!bot, name, side,
      x: 0, z: 0, vx: 0, vz: 0, r: HERO.r, hp: 1, max: 1,
      aim: side === 'human' ? Math.PI : 0, aimX: 0, aimZ: fwd(side), fireT: 0, recoil: 0,
      dashT: 0, dashCd: 0, dashX: 0, dashZ: 0, dashHits: null, inv: 2, hurtT: 0, dead: false, respawnT: 0,
      revives: 0, cd: { q: 0, e: 0, r: 0 }, cdMax: { q: 1, e: 1, r: 1 }, moving: 0, walk: 0,
      up: {}, syn: {}, picked: [], xp: 0, level: 1, pending: 0, offer: null, offerT: 0,
      kills: 0, deaths: 0, mk: 0, score: 0, streak: 0, frenzy: 0, shotCount: 0, lastBy: 0, lastByT: -99, dmg: 0,
      combo: 0, comboT: 0, mult: 1, qstreak: 0, qstreakT: 0,
      inp: { mx: 0, mz: 0, ax: 0, az: fwd(side), fire: false, aimDist: 9 }, edge: { dash: false, q: false, e: false, r: false }, ack: 0,
    };
    for (const u of UPGRADES) h.up[u.id] = 0;
    h.max = h.hp = this.heroMax(h);
    this.placeAtBase(h);
    if (bot) h.botFn = makeBot(0.5 + this.rand() * 0.35, this.rand);
    return h;
  }
  placeAtBase(h) {
    h.x = (this.rand() - 0.5) * 10; h.z = baseZ(h.side) + fwd(h.side) * (8.5 + this.rand() * 2); h.vx = h.vz = 0;
  }

  // ---------- players and bots ----------
  heroById(id) { for (const h of this.heroes) if (h.id === id) return h; return null; }
  heroOf(pid) { for (const h of this.heroes) if (h.pid === pid) return h; return null; }
  realCount(side) { let n = 0; for (const p of this.players.values()) if (!side || p.side === side) n++; return n; }
  heroesOf(side) { return this.heroes.filter((h) => h.side === side); }
  // Puts a real player into the match. Returns the hero, or null when the room is full.
  addPlayer(pid, name, team) {
    const prev = this.players.get(pid);
    if (!prev && this.realCount() >= MATCH.maxPlayers) return null;
    if (prev) this.removeHero(pid);
    this.players.delete(pid);
    let side = SIDES.includes(team) ? team : (this.realCount('human') <= this.realCount('ai') ? 'human' : 'ai');
    if (this.realCount(side) >= MATCH.maxPerSide) side = other(side);
    const nm = cleanName(name);
    this.players.set(pid, { name: nm, side });
    const h = this.makeHero(side, nm, pid, false);
    this.heroes.push(h);
    this.emit(prev && prev.side !== side ? 'switch' : 'join', { id: h.id, name: nm, side });
    this.fillBots();
    this.dirty = true;
    return h;
  }
  removeHero(pid) {
    const i = this.heroes.findIndex((h) => h.pid === pid);
    if (i >= 0) { const h = this.heroes[i]; this.heroes.splice(i, 1); this.forget(h); return h; }
    return null;
  }
  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.players.delete(pid);
    const h = this.removeHero(pid);
    this.emit('leave', { id: h ? h.id : 0, name: p.name, side: p.side });
    this.fillBots();
    this.dirty = true;
  }
  forget(h) { for (const d of this.drones) if (d.owner === h.id) d.t = Math.min(d.t, 0); }
  // Bots are proportional to the real players: both sides always end with the SAME total
  // (real + bots), equal to the larger side's real-player count, so no side is outnumbered.
  // Real players are preferred — a bot is dropped when a real joins the smaller side.
  // When only one person is on (the other side empty) each side is padded to 2, so you get one
  // ally and a matched enemy instead of standing alone; two real players on opposite sides play 1 v 1.
  botTarget() {
    if (!this.cfg.bots) return null; // tests: real players only
    const rh = this.realCount('human'), ra = this.realCount('ai');
    const maxReal = Math.max(rh, ra);
    if (maxReal === 0) return 0;
    const lonely = (rh === 0 || ra === 0) && maxReal <= 1; // one real player, no live opponent
    return Math.min(MATCH.maxPerSide, lonely ? 2 : maxReal);
  }
  fillBots() {
    const target = this.botTarget();
    for (const side of SIDES) {
      // real players are never dropped; bots only top the side up to the shared target
      const want = target === null ? this.realCount(side) : Math.max(target, this.realCount(side));
      let n = this.heroesOf(side).length;
      while (n < want) {
        const used = new Set(this.heroes.map((h) => h.name));
        const free = BOT_NAMES.filter((b) => !used.has('Bot · ' + b));
        const nm = 'Bot · ' + (free.length ? free[(this.rand() * free.length) | 0] : BOT_NAMES[n % BOT_NAMES.length]);
        this.heroes.push(this.makeHero(side, nm, null, true));
        n++; this.dirty = true;
      }
      while (n > want) {
        const bots = this.heroes.filter((h) => h.bot && h.side === side);
        if (!bots.length) break;
        const b = bots.find((x) => x.dead) || bots[bots.length - 1];
        this.heroes.splice(this.heroes.indexOf(b), 1); this.forget(b);
        n--; this.dirty = true;
      }
    }
  }
  // Clamp and store a player's input. Edges (dash / abilities) fire on the next step.
  input(pid, d) {
    const h = this.heroOf(pid);
    if (!h || !d) return;
    const num = (v, a, b, def = 0) => { v = Number(v); return Number.isFinite(v) ? clamp(v, a, b) : def; };
    let mx = num(d.mx, -1, 1), mz = num(d.mz, -1, 1);
    const ml = len(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const a = num(d.a, -10, 10, h.aim);
    h.inp = { mx, mz, ax: Math.sin(a), az: Math.cos(a), fire: !!d.f, aimDist: num(d.ad, 4, 15, 9) };
    if (d.d) h.edge.dash = true;
    if (d.q) h.edge.q = true;
    if (d.e) h.edge.e = true;
    if (d.r) h.edge.r = true;
    const s = Number(d.s);
    if (Number.isInteger(s) && s >= 0 && s < 2 ** 31) h.ack = s;
  }
  // Test-only controls. The server accepts them only when it runs with the V2_TEST variable (wrangler dev --var V2_TEST:1).
  debug(pid, d) {
    const h = this.heroOf(pid);
    const n = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
    if (d.cmd === 'time') this.t = n(d.v, this.t);
    else if (d.cmd === 'calm') { this.cfg.waves = false; this.cfg.bots = false; this.units = []; this.shots = []; this.queue = []; this.slams = []; this.fillBots(); }
    else if (d.cmd === 'bots') { this.cfg.bots = d.v === 0 ? false : true; this.fillBots(); }
    else if (d.cmd === 'base' && this.bases[d.side]) this.bases[d.side].hp = n(d.v, 1);
    else if (h && d.cmd === 'xp') this.gainXp(h, n(d.v));
    else if (h && d.cmd === 'place') { h.x = n(d.x); h.z = n(d.z); h.vx = h.vz = 0; h.inv = 0; }
  }
  pick(pid, i) {
    const h = this.heroOf(pid);
    i = Number(i);
    if (!h || !Number.isInteger(i)) return false;
    return this.choose(h, i);
  }

  // ---------- derived hero stats (same formulas as the solo game, per hero) ----------
  heroDmg(h) { return HERO.dmg * (1 + 0.22 * h.up.dmg) * (h.up.glass ? 1.7 : 1); }
  heroRate(h) { return HERO.rate * (1 + 0.18 * h.up.rate) * (h.frenzy > 0 ? 1.8 : 1) * (h.up.berserk && h.hp < h.max / 2 ? 1.6 : 1) * (this.rally[h.side] > 0 && h.side === 'human' ? 1.25 : 1); }
  heroMax(h) { return Math.round((HERO.hp + (h.side === 'human' ? 15 : 0) + 30 * h.up.hp - (h.up.berserk ? 15 : 0)) * (h.up.glass ? 0.6 : 1)); }
  heroSpeed(h) { return HERO.speed * (1 + 0.12 * h.up.speed); }
  pierce(h) { return h.up.pierce + (h.syn.storm ? 1 : 0); }
  multi(h) { return 1 + h.up.multi + (h.syn.storm ? 1 : 0); }
  dashCdOf(h) { return HERO.dashCd * (h.syn.blink ? 0.5 : 1); }
  cdMul(h) { return Math.max(0.4, 1 - 0.2 * h.up.cdr); }

  // ---------- upgrades (per hero, offered on level-up, never pausing the match) ----------
  gainXp(h, n) {
    if (!h || this.phase !== 'play') return;
    if (this.twist === 'bounty') n *= 2;
    h.xp += n;
    while (h.xp >= xpNeed(h.level)) {
      h.xp -= xpNeed(h.level); h.level++; h.pending++;
      if (!h.dead) h.hp = Math.min(h.max, h.hp + h.max * 0.2);
      this.emit('levelUp', { id: h.id, level: h.level });
      this.dirty = true;
    }
    if (!h.offer) this.nextOffer(h);
  }
  nextOffer(h) {
    if (h.offer || h.pending <= 0) return;
    h.pending--;
    h.offer = this.makeOffer(h); h.offerT = MATCH.offerTime;
    if (h.bot) this.choose(h, botPick(this.botView(h), this.rand));
  }
  makeOffer(h) {
    const owned = (u) => h.up[u.id] >= u.max;
    const epicP = 0.07 + 0.02 * h.level, rareP = 0.33;
    const offer = [];
    const take = (pool) => {
      const ok = pool.filter((u) => !owned(u) && !offer.some((o) => o.id === u.id));
      return ok.length ? ok[(this.rand() * ok.length) | 0] : null;
    };
    for (let s = 0; s < 3; s++) {
      const roll = this.rand();
      const r = roll < epicP ? 'e' : roll < epicP + rareP ? 'r' : 'c';
      const u = take(UPGRADES.filter((x) => x.r === r)) || take(UPGRADES);
      if (u) offer.push(u);
    }
    const synOpts = SYNERGIES.filter((s) => !h.syn[s.id] && (h.up[s.a] > 0) !== (h.up[s.b] > 0))
      .map((s) => (h.up[s.a] > 0 ? s.b : s.a)).filter((id) => !owned(UPG[id]) && !offer.some((o) => o.id === id));
    if (synOpts.length && this.rand() < 0.5) offer[offer.length - 1] = UPG[synOpts[(this.rand() * synOpts.length) | 0]];
    const mb = this.bases[h.side];
    if (mb.hp < mb.max * 0.45 && !offer.some((o) => o.id === 'repair') && !owned(UPG.repair)) offer[0] = UPG.repair;
    return offer.map((u) => ({ id: u.id, level: h.up[u.id], synergy: this.synergyFor(h, u.id) }));
  }
  synergyFor(h, id) {
    for (const s of SYNERGIES) {
      if (h.syn[s.id]) continue;
      if (s.a === id && h.up[s.b] > 0) return s.name;
      if (s.b === id && h.up[s.a] > 0) return s.name;
    }
    return null;
  }
  applyUpgrade(h, id) {
    h.up[id] = (h.up[id] || 0) + 1;
    h.picked.push(id);
    const oldMax = h.max;
    h.max = this.heroMax(h);
    if (id === 'hp') h.hp = h.max;
    else if (h.max > oldMax) h.hp += h.max - oldMax;
    h.hp = Math.min(h.hp, h.max);
    if (id === 'repair') { const b = this.bases[h.side]; b.hp = Math.min(b.max, b.hp + b.max * 0.2); } // PvP: heal only, no bigger base
    for (const s of SYNERGIES) {
      if (!h.syn[s.id] && h.up[s.a] > 0 && h.up[s.b] > 0) { h.syn[s.id] = true; this.emit('synergy', { id: h.id, syn: s.id, name: s.name, desc: s.desc }); }
    }
  }
  choose(h, i) {
    if (!h.offer || !h.offer[i]) return false;
    const id = h.offer[i].id;
    this.applyUpgrade(h, id);
    this.emit('upgrade', { id: h.id, up: id });
    h.offer = null;
    this.nextOffer(h);
    return true;
  }

  // ---------- main step ----------
  step(dt) {
    if (this.phase === 'end') {
      this.endT -= dt;
      if (this.endT <= 0) this.reset();
      return;
    }
    this.t += dt;
    if (this.t >= this.nextWaveT && this.cfg.waves) { this.spawnWaves(); this.nextWaveT += MATCH.waveEvery; }
    while (this.queue.length && this.queue[0].at <= this.t) {
      const q = this.queue.shift();
      if (this.units.filter((u) => u.side === q.side).length >= MATCH.unitCap) continue;
      const fz = baseZ(q.side), d = fwd(q.side);
      this.spawnUnit(q.side, q.kind, (this.rand() - 0.5) * 24, fz + d * (5.5 + this.rand() * 2), { elite: q.elite });
    }
    const nb = MATCH.bossAt[this.bossNo];
    if (nb !== undefined && this.cfg.waves) {
      if (this.bossWarned <= this.bossNo && this.t >= nb - 5) { this.bossWarned = this.bossNo + 1; this.emit('bossWarn', { n: this.bossNo }); }
      if (this.t >= nb) {
        for (const side of SIDES) {
          const u = this.spawnUnit(side, 'boss', 0, baseZ(side) + fwd(side) * 6.5);
          u.bossIdx = this.bossNo;
        }
        this.bossNo++;
      }
    }
    for (const s of SIDES) this.rally[s] = Math.max(0, this.rally[s] - dt);
    // Ability power-ups rain onto the floor over time; grabbing one unleashes that ability (no Q/E/R buttons).
    // More live heroes -> spawn more often, so each hero gets one every several seconds rather than a flood.
    if (this.cfg.waves) {
      this.abilT -= dt;
      if (this.abilT <= 0) {
        const alive = this.heroes.filter((h) => !h.dead).length || 1;
        this.abilT = Math.max(2.5, (7 + this.rand() * 4) / alive);
        this.spawnAbilityPickup();
      }
    }
    this.xpT += dt;
    const passive = this.xpT >= 1;
    if (passive) this.xpT -= 1;
    for (const h of this.heroes) {
      h.frenzy = Math.max(0, h.frenzy - dt);
      if (h.comboT > 0) { h.comboT -= dt; if (h.comboT <= 0) { h.combo = 0; h.mult = 1; } }
      if (h.qstreakT > 0) { h.qstreakT -= dt; if (h.qstreakT <= 0) h.qstreak = 0; }
      if (h.offer) { h.offerT -= dt; if (h.offerT <= 0) this.choose(h, botPick(this.botView(h), this.rand)); }
      if (h.bot) {
        const b = h.botFn(this.botView(h), dt);
        h.inp = b; h.edge.dash = b.dash; h.edge.q = b.q; h.edge.e = b.e; h.edge.r = b.r;
      }
      this.stepHero(h, dt);
      if (passive && !h.dead) this.gainXp(h, 1);
    }
    this.stepUnits(dt);
    this.stepBases(dt);
    this.stepAbilities(dt);
    this.stepShots(dt);
    this.stepSlams(dt);
    this.stepPickups(dt);
    const booms = this.booms; this.booms = [];
    for (const b of booms) this.explode(b.x, b.z, b.r, b.dmg, b.side, b.by, b.kb, b.kind);
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    for (const s of SIDES) {
      const bo = this.bosses[s];
      if (bo && bo.dead) { this.bosses[s] = null; this.bases[s].shield = false; }
    }
    if (this.phase === 'play' && this.t >= MATCH.dur) {
      const fh = this.bases.human.hp / this.bases.human.max, fa = this.bases.ai.hp / this.bases.ai.max;
      this.endMatch(Math.abs(fh - fa) < 0.01 ? 'draw' : fh > fa ? 'human' : 'ai', 'time');
    }
  }

  // The view a bot (or the auto-pick) sees: shaped like the solo game so js/bot.js works for both.
  botView(h) {
    const foe = other(h.side);
    return {
      hero: h, team: h.side, foe, units: this.units, heroes: this.heroes, bases: this.bases, pickups: this.pickups,
      slams: this.slams, shots: this.shots, boss: this.bosses[foe], phase: 'fight', offer: h.offer, arena: true,
    };
  }

  endMatch(winner, reason) {
    if (this.phase !== 'play') return;
    this.phase = 'end'; this.endT = MATCH.showEnd;
    const board = this.heroes.slice().sort((a, b) => b.score - a.score)
      .map((h) => [h.id, h.name, h.side, h.kills, h.deaths, h.level, Math.round(h.score), h.bot ? 1 : 0]);
    const mvp = board[0] || null;
    this.result = { winner, reason, board, mvp };
    this.shots = []; this.slams = []; this.booms = [];
    this.emit('matchEnd', { winner, reason, board, mvp: mvp ? { id: mvp[0], name: mvp[1], side: mvp[2] } : null, next: MATCH.showEnd });
  }

  // ---------- waves ----------
  spawnWaves() {
    const n = ++this.waveN;
    this.twist = null;
    if (n >= 3 && this.rand() < 0.35) {
      const keys = Object.keys(TWISTS);
      this.twist = keys[(this.rand() * keys.length) | 0];
      this.emit('twist', { twist: this.twist });
    }
    for (const side of SIDES) {
      const c = { grunt: 3 + (n >> 1), runner: 1 + Math.floor(n / 3), shooter: n >= 2 ? 1 + Math.floor(n / 4) : 0, brute: n >= 4 ? Math.floor((n - 1) / 3) : 0 };
      if (this.twist === 'horde') c.runner += 4;
      const list = [];
      for (const k of ['grunt', 'runner', 'shooter', 'brute']) for (let i = 0; i < c[k]; i++) list.push(k);
      const elites = this.twist === 'elites' ? 3 : n >= 3 ? 1 : 0;
      const eliteAt = new Set();
      for (let k = 0; k < elites; k++) eliteAt.add((this.rand() * list.length) | 0);
      list.forEach((kind, i) => this.queue.push({ side, kind, at: this.t + i * 0.35, elite: eliteAt.has(i) }));
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.emit('wave', { n, twist: this.twist });
  }
  unitScale() { const m = this.t / 60; return { hp: 1 + 0.22 * m + 0.04 * m * m, dmg: 1 + 0.1 * m }; }
  spawnUnit(side, kind, x, z, opts = {}) {
    const k = KINDS[kind];
    const sc = this.unitScale();
    let hp = k.hp * sc.hp;
    if (kind === 'boss') hp = KINDS.boss.hp * (1 + 0.5 * this.bossNo) * (1 + 0.3 * Math.max(0, this.heroesOf(other(side)).length - 1));
    const u = {
      type: 'unit', id: this.nid++, side, kind, ally: false,
      x, z, r: k.r, hp, max: hp, speed: k.speed * (0.92 + this.rand() * 0.16), dmg: k.dmg * sc.dmg,
      atk: k.atk, atkT: this.rand() * k.atk, reach: k.reach, mass: k.mass, aggro: k.aggro,
      kx: 0, kz: 0, vx: 0, vz: 0, face: side === 'human' ? Math.PI : 0, tgt: null, thinkT: this.rand() * 0.2,
      laneX: clamp(x + (this.rand() - 0.5) * 6, -13, 13), wob: this.rand() * 6.28,
      swing: 0, hitT: 0, stun: 0, elite: false, born: this.t, walk: this.rand() * 6,
      state: 'walk', stateT: 0, bossT: 2.4, burstT: 4, alt: 0, leap: null, bossIdx: 0,
    };
    if (this.twist === 'haste') u.speed *= 1.3;
    if (opts.elite) { u.elite = true; u.hp *= 3; u.max *= 3; u.r *= 1.3; u.mass *= 2; u.dmg *= 1.3; }
    this.units.push(u);
    if (kind === 'boss') { this.bosses[side] = u; this.bases[side].shield = true; this.emit('bossSpawn', { side, x, z }); }
    return u;
  }

  // ---------- heroes ----------
  stepHero(h, dt) {
    const inp = h.inp, edge = h.edge;
    h.edge = { dash: false, q: false, e: false, r: false };
    h.inv = Math.max(0, h.inv - dt); h.hurtT = Math.max(0, h.hurtT - dt); h.recoil = Math.max(0, h.recoil - dt * 8);
    h.dashCd = Math.max(0, h.dashCd - dt);
    for (const k of ['q', 'e', 'r']) h.cd[k] = Math.max(0, h.cd[k] - dt);
    if (h.dead) {
      h.respawnT -= dt;
      if (h.respawnT <= 0 && this.phase === 'play') {
        h.dead = false; h.hp = h.max; h.inv = 2.2;
        this.placeAtBase(h);
        this.emit('heroRespawn', { id: h.id, x: h.x, z: h.z });
      }
      return;
    }
    if (inp.ax || inp.az) { const l = len(inp.ax, inp.az) || 1; h.aimX = inp.ax / l; h.aimZ = inp.az / l; h.aim = Math.atan2(h.aimX, h.aimZ); }
    let mx = inp.mx || 0, mz = inp.mz || 0;
    const ml = len(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (edge.dash && h.dashCd <= 0 && h.dashT <= 0) {
      let dx = mx, dz = mz;
      if (len(dx, dz) < 0.2) { dx = h.aimX; dz = h.aimZ; }
      const l = len(dx, dz) || 1;
      h.dashX = dx / l; h.dashZ = dz / l; h.dashT = HERO.dashTime; h.dashCd = this.dashCdOf(h);
      h.inv = Math.max(h.inv, HERO.dashInv); h.dashHits = [];
      this.emit('dash', { id: h.id, x: h.x, z: h.z, dx: h.dashX, dz: h.dashZ });
    }
    if (h.dashT > 0) {
      h.dashT -= dt;
      const sp = HERO.dashDist / HERO.dashTime;
      h.vx = h.dashX * sp; h.vz = h.dashZ * sp;
      if (h.up.dashHit) {
        const dmg = 35 * (h.syn.blink ? 2 : 1) + 10 * (h.up.dashHit - 1);
        for (const u of this.units) {
          if (u.side === h.side || u.dead || h.dashHits.includes(u.id)) continue;
          if (len(u.x - h.x, u.z - h.z) < u.r + 1.2) { h.dashHits.push(u.id); this.hitUnit(u, dmg, h.dashX, h.dashZ, 14, h.id, false); }
        }
        for (const o of this.heroes) {
          if (o.side === h.side || o.dead || h.dashHits.includes('h' + o.id)) continue;
          if (len(o.x - h.x, o.z - h.z) < o.r + 1.2) { h.dashHits.push('h' + o.id); this.hurtHero(o, dmg, h.dashX, h.dashZ, 8, h.id); }
        }
      }
      if (h.dashT <= 0) { h.vx *= 0.25; h.vz *= 0.25; }
    } else {
      const sp = this.heroSpeed(h);
      const k = Math.min(1, dt * 14);
      h.vx += (mx * sp - h.vx) * k; h.vz += (mz * sp - h.vz) * k;
    }
    h.x += h.vx * dt; h.z += h.vz * dt;
    h.moving = len(h.vx, h.vz);
    h.fireT -= dt;
    if (inp.fire && h.fireT <= 0) {
      h.fireT = Math.max(h.fireT, -0.05) + 1 / this.heroRate(h);
      this.fireHero(h);
    }
    if (h.fireT < 0 && !inp.fire) h.fireT = 0;
    for (const k of ['q', 'e', 'r']) if (edge[k] && h.cd[k] <= 0) this.useAbility(h, k, inp);
    this.collide(h, 2, true);
  }
  fireHero(h) {
    const n = this.multi(h);
    const spread = h.syn.storm ? 0.17 : 0.11;
    h.shotCount++;
    const big = h.up.over && h.shotCount % 5 === 0;
    const dmg = this.heroDmg(h);
    for (let i = 0; i < n; i++) {
      const a = h.aim + (i - (n - 1) / 2) * spread;
      const dx = Math.sin(a), dz = Math.cos(a);
      const crit = this.rand() < 0.08;
      this.shots.push({
        x: h.x + dx * 0.9, z: h.z + dz * 0.9, dx, dz, spd: HERO.shotSpeed * (big ? 0.8 : 1), life: HERO.shotLife * (big ? 1.4 : 1),
        dmg: dmg * (crit ? 2 : 1) * (big ? 3 : 1), side: h.side, src: 'hero', owner: h.id, pierce: this.pierce(h) + (big ? 2 : 0), hits: [],
        r: big ? 0.55 : 0.28, crit, big, bounce: h.up.bounce + (h.up.bounce && h.syn.ricostorm ? 1 : 0),
      });
    }
    h.recoil = 1;
    this.emit('shot', { id: h.id, x: h.x, z: h.z, a: h.aim, big, n });
  }
  useAbility(h, k, inp) {
    const T = h.side;
    const cdBase = (T === 'ai' ? { q: 10, e: 17, r: 22 } : { q: 11, e: 17, r: 22 })[k];
    h.cd[k] = cdBase * this.cdMul(h); h.cdMax[k] = h.cd[k];
    const ax = h.aimX, az = h.aimZ;
    if (T === 'human' && k === 'q') {
      this.walls.push({ x: h.x + ax * 2.6, z: h.z + az * 2.6, nx: ax, nz: az, half: 3.8, t: 7, max: 7, side: T, owner: h.id });
      if (this.walls.length > 6) this.walls.shift();
      this.emit('ability', { id: h.id, k, name: 'wall', x: h.x + ax * 2.6, z: h.z + az * 2.6 });
    } else if (T === 'human' && k === 'e') {
      this.rally[T] = 9;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        this.spawnUnit(T, 'grunt', clamp(h.x + Math.cos(a) * 1.8, -16, 16), clamp(h.z + Math.sin(a) * 1.8, -33, 33));
      }
      this.emit('ability', { id: h.id, k, name: 'rally', x: h.x, z: h.z });
    } else if (T === 'human' && k === 'r') {
      const d = clamp(inp.aimDist || 9, 4, 15);
      const tx = h.x + ax * d, tz = h.z + az * d;
      for (let i = 0; i < 3; i++) {
        const a = this.rand() * 6.28, rr = i === 0 ? 0 : 2.6;
        this.slams.push({ x: tx + Math.cos(a) * rr, z: tz + Math.sin(a) * rr, r: 3.3, t: 0.75 + i * 0.18, max: 0.75 + i * 0.18, side: T, dmg: 55 + this.heroDmg(h) * 2, kb: 12, by: h.id, kind: 'boulder' });
      }
      this.emit('ability', { id: h.id, k, name: 'catapult', x: tx, z: tz });
    } else if (T === 'ai' && k === 'q') {
      const x0 = h.x + ax * 1.2, z0 = h.z + az * 1.2;
      this.fires.push({ x0, z0, x1: x0 + ax * 15, z1: z0 + az * 15, w: 1.35, t: 3.2, max: 3.2, tick: 0, side: T, owner: h.id, dmg: 6 + this.heroDmg(h) * 0.4 });
      if (this.fires.length > 6) this.fires.shift();
      this.emit('ability', { id: h.id, k, name: 'firewall', x: x0, z: z0, dx: ax, dz: az });
    } else if (T === 'ai' && k === 'e') {
      for (let i = 0; i < 3; i++) {
        const a = h.aim + (i - 1) * 1.2;
        this.drones.push({ x: h.x + Math.sin(a) * 1.5, z: h.z + Math.cos(a) * 1.5, vx: 0, vz: 0, t: 8, fireT: 0.3 + i * 0.1, side: T, dive: null, ang: a, id: this.nid++, owner: h.id });
      }
      this.emit('ability', { id: h.id, k, name: 'drones', x: h.x, z: h.z });
    } else if (T === 'ai' && k === 'r') {
      this.explode(h.x, h.z, 8, 45 + this.heroDmg(h) * 1.5, T, h.id, 13, 'emp', 2.2);
      this.emit('ability', { id: h.id, k, name: 'emp', x: h.x, z: h.z });
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
    for (const h of this.heroes) {
      if (h.side === u.side || h.dead) continue;
      const d = ((h.x - u.x) ** 2 + (h.z - u.z) ** 2) * 0.8;
      if (d < bd || (u.kind === 'boss' && d < u.aggro * u.aggro && (!best || best.type !== 'hero'))) { bd = d; best = h; }
    }
    const b = this.bases[other(u.side)];
    const db = len(b.x - u.x, b.z - u.z) - b.r;
    if (!best && db < u.aggro + 1) best = b;
    return best;
  }
  stepUnits(dt) {
    for (const u of this.units) {
      if (u.dead) continue;
      u.hitT = Math.max(0, u.hitT - dt); u.swing = Math.max(0, u.swing - dt * 3.5);
      u.atkT -= dt;
      const rallied = this.rally[u.side] > 0 && u.kind === 'grunt';
      const spMul = rallied ? 1.6 : 1;
      if (u.stun > 0) {
        u.stun -= dt;
        u.x += u.kx * dt; u.z += u.kz * dt;
        const kd = Math.exp(-7 * dt); u.kx *= kd; u.kz *= kd;
        this.collide(u, u.mass, false);
        continue;
      }
      u.thinkT -= dt;
      if (u.thinkT <= 0 || !u.tgt || u.tgt.dead || u.tgt.hp <= 0 || (u.tgt.type === 'hero' && !this.heroes.includes(u.tgt))) {
        u.thinkT = 0.22 + this.rand() * 0.1;
        u.tgt = this.findTarget(u);
      }
      const t = u.tgt;
      let gx, gz, d;
      const eb = this.bases[other(u.side)];
      if (t) { gx = t.x; gz = t.z; d = len(gx - u.x, gz - u.z); }
      else { gx = u.laneX + Math.sin(this.t * 0.7 + u.wob) * 2; gz = eb.z - fwd(u.side) * (eb.r + 1); d = len(gx - u.x, gz - u.z); }
      let mvx = 0, mvz = 0;
      const dx = (gx - u.x) / (d || 1), dz = (gz - u.z) / (d || 1);
      const tr = t ? t.r : 0;
      if (u.kind === 'boss') this.stepBoss(u, dt, t, d, dx, dz);
      else if (KINDS[u.kind].ranged && t) {
        const keep = KINDS.shooter.keep;
        const ownZ = baseZ(u.side), behind = (u.z - ownZ) * fwd(u.side) < 10;
        if (d < keep - 2.5 && t.type === 'hero' && !behind) { mvx = -dx; mvz = -dz; }
        else if (d > keep + 1) { mvx = dx; mvz = dz; }
        else { mvx = -dz * 0.45 * Math.sin(u.wob + this.t); mvz = dx * 0.45 * Math.sin(u.wob + this.t); }
        if (d < keep + 5 && u.atkT <= 0) {
          u.atkT = u.atk * (0.85 + this.rand() * 0.3); u.swing = 1;
          const lead = t.type === 'hero' ? 0.25 : 0;
          const tx = t.x + (t.vx || 0) * lead * d / KINDS.shooter.shotSpeed, tz = t.z + (t.vz || 0) * lead * d / KINDS.shooter.shotSpeed;
          const l = len(tx - u.x, tz - u.z) || 1;
          this.shots.push({ x: u.x, z: u.z, dx: (tx - u.x) / l, dz: (tz - u.z) / l, spd: KINDS.shooter.shotSpeed, life: 1.6, dmg: u.dmg, side: u.side, src: 'unit', owner: 0, pierce: 0, hits: [], r: 0.35, orb: true });
        }
      } else {
        const reach = u.r + tr + u.reach;
        if (t && d <= reach) {
          if (u.atkT <= 0) {
            u.atkT = u.atk; u.swing = 1;
            const dmg = u.dmg * (rallied ? 2 : 1) * (t.type === 'base' ? 0.6 : 1);
            if (t.type === 'hero') this.hurtHero(t, dmg, dx, dz, KINDS[u.kind].kb || 2.5, 0);
            else if (t.type === 'base') this.hurtBase(t, dmg, 0);
            else this.hitUnit(t, dmg, dx, dz, KINDS[u.kind].kb || 2.5, 0, false);
          }
        } else { mvx = dx; mvz = dz; }
      }
      const sp = u.speed * spMul;
      if (u.kind !== 'boss') { u.vx += (mvx * sp - u.vx) * Math.min(1, dt * 8); u.vz += (mvz * sp - u.vz) * Math.min(1, dt * 8); }
      u.x += (u.vx + u.kx) * dt; u.z += (u.vz + u.kz) * dt;
      const kd = Math.exp(-7 * dt); u.kx *= kd; u.kz *= kd;
      u.walk += len(u.vx, u.vz) * dt;
      const fa = t && (d < 6 || KINDS[u.kind].ranged) ? Math.atan2(dx, dz) : (len(u.vx, u.vz) > 0.3 ? Math.atan2(u.vx, u.vz) : u.face);
      let da = fa - u.face; while (da > Math.PI) da -= 6.2832; while (da < -Math.PI) da += 6.2832;
      u.face += da * Math.min(1, dt * 10);
      this.collide(u, u.mass, false);
    }
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
  }
  stepBoss(u, dt, t, d, dx, dz) {
    const late = u.bossIdx >= 1;
    if (u.state === 'walk') {
      u.vx += (dx * u.speed - u.vx) * Math.min(1, dt * 4); u.vz += (dz * u.speed - u.vz) * Math.min(1, dt * 4);
      if (t && d < u.r + t.r + 0.5) { u.vx *= 0.2; u.vz *= 0.2; }
      u.bossT -= dt;
      if (t && u.bossT <= 0 && d < 15) {
        u.alt++;
        const leap = late && u.alt % 2 === 0 && d > 5;
        u.vx = u.vz = 0;
        const dmg = u.dmg * (1 + 0.15 * u.bossIdx);
        if (leap) {
          const tx = clamp(t.x, -15, 15), tz = clamp(t.z, -32, 32);
          u.state = 'leap'; u.stateT = 1.25; u.leap = { x0: u.x, z0: u.z, x1: tx, z1: tz, t: 1.25 };
          this.slams.push({ x: tx, z: tz, r: 4.8, t: 1.25, max: 1.25, side: u.side, dmg, kb: 16, boss: u.id, by: 0, kind: 'leap' });
        } else {
          const reach = Math.min(d, 4.8);
          u.state = 'wind'; u.stateT = 1.05;
          this.slams.push({ x: u.x + dx * reach, z: u.z + dz * reach, r: 4.6, t: 1.05, max: 1.05, side: u.side, dmg, kb: 14, boss: u.id, by: 0, kind: 'slam' });
        }
        u.bossT = Math.max(2.4, 4.0 - 0.25 * u.bossIdx);
        this.emit('telegraph', { x: u.x, z: u.z, leap });
      }
      if (late) {
        u.burstT -= dt;
        if (u.burstT <= 0) {
          u.burstT = 5.5;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + this.t;
            this.shots.push({ x: u.x, z: u.z, dx: Math.sin(a), dz: Math.cos(a), spd: 11, life: 2.6, dmg: 9, side: u.side, src: 'unit', owner: 0, pierce: 0, hits: [], r: 0.45, orb: true });
          }
          this.emit('burst', { x: u.x, z: u.z });
        }
      }
    } else {
      u.stateT -= dt;
      if (u.state === 'leap' && u.leap) {
        const p = 1 - Math.max(0, u.stateT) / u.leap.t;
        const e = p < 0.35 ? 0 : (p - 0.35) / 0.65;
        u.x = u.leap.x0 + (u.leap.x1 - u.leap.x0) * e; u.z = u.leap.z0 + (u.leap.z1 - u.leap.z0) * e;
        u.vx = u.vz = 0;
      }
      if (u.stateT <= 0) {
        if (u.state === 'recover') { u.state = 'walk'; u.leap = null; }
        else { u.state = 'recover'; u.stateT = 0.7; u.swing = 1; }
      }
    }
  }
  collide(a, mass, isHero) {
    for (const c of this.cover) {
      const dx = a.x - c.x, dz = a.z - c.z, rr = a.r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; a.x = c.x + (dx / d) * rr; a.z = c.z + (dz / d) * rr; }
    }
    for (const k of SIDES) {
      const b = this.bases[k];
      const dx = a.x - b.x, dz = a.z - b.z, rr = a.r + b.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; a.x = b.x + (dx / d) * rr; a.z = b.z + (dz / d) * rr; }
    }
    for (const w of this.walls) {
      if (w.side === a.side) continue;
      const tx = -w.nz, tz = w.nx;
      const px = a.x - w.x, pz = a.z - w.z;
      const along = px * tx + pz * tz, across = px * w.nx + pz * w.nz;
      if (Math.abs(along) < w.half + a.r * 0.5 && Math.abs(across) < a.r + 0.35) {
        const s = across >= 0 ? 1 : -1, push = s * (a.r + 0.35) - across;
        a.x += w.nx * push; a.z += w.nz * push;
        a.vx *= 0.5; a.vz *= 0.5;
      }
    }
    if (isHero && a.dashT <= 0) {
      for (const u of this.units) {
        if (u.dead || u.side === a.side) continue;
        const dx = a.x - u.x, dz = a.z - u.z, rr = a.r + u.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), o = rr - d, w = u.mass / (u.mass + mass);
        a.x += (dx / d) * o * w; a.z += (dz / d) * o * w;
        u.x -= (dx / d) * o * (1 - w); u.z -= (dz / d) * o * (1 - w);
      }
    }
    const hw = ARENA.halfW - a.r, hl = ARENA.halfL - a.r;
    a.x = clamp(a.x, -hw, hw); a.z = clamp(a.z, -hl, hl);
  }

  // ---------- damage ----------
  hurtHero(h, dmg, dx, dz, kb, by) {
    if (h.dead || h.inv > 0 || this.phase !== 'play') return;
    if (by) {
      const a = this.heroById(by);
      if (a && a.side === h.side) return;
      dmg *= MATCH.pvp;
      h.lastBy = by; h.lastByT = this.t;
      if (a) a.dmg += dmg;
    }
    h.hp -= dmg; h.hurtT = 0.35; h.inv = 0.12;
    h.vx += dx * kb * 1.2; h.vz += dz * kb * 1.2;
    this.emit('heroHurt', { id: h.id, x: h.x, z: h.z, dmg, by: by || 0 });
    if (h.hp > 0) return;
    h.hp = 0; h.dead = true; h.dashT = 0; h.respawnT = MATCH.respawn; h.deaths++;
    const wasStreak = h.streak; h.streak = 0;
    const kid = by || (this.t - h.lastByT < 5 ? h.lastBy : 0);
    const k = kid ? this.heroById(kid) : null;
    if (k && k.side !== h.side) {
      k.kills++; k.streak++; k.score += 100 + 20 * h.level;
      this.gainXp(k, 30 + 5 * h.level);
    }
    this.emit('heroKill', { id: h.id, name: h.name, side: h.side, k: k ? k.id : 0, kn: k ? k.name : '', x: h.x, z: h.z, shut: wasStreak >= 3 ? wasStreak : 0 });
    if (k) for (const [n, label] of HERO_STREAKS) if (k.streak === n) this.emit('pstreak', { id: k.id, name: k.name, side: k.side, n, label });
    this.dirty = true;
  }
  hurtBase(b, dmg, by) {
    if (this.phase !== 'play') return;
    if (b.shield) { this.emit('shieldHit', { side: b.side }); return; }
    b.hp -= dmg; b.hitT = 0.2;
    if (by) { const h = this.heroById(by); if (h && h.side !== b.side) h.score += dmg * 0.2; }
    if (this.t - b.evT > 0.15) { b.evT = this.t; this.emit('baseHit', { side: b.side, dmg, x: b.x, z: b.z }); }
    const pct = b.hp / b.max;
    while (b.mile > 0 && pct <= b.mile * 0.25) { this.emit('baseMile', { side: b.side, pct: b.mile * 25 }); b.mile--; }
    if (b.hp <= 0) {
      b.hp = 0;
      const h = by ? this.heroById(by) : null;
      if (h && h.side !== b.side) h.score += 300; // the final blow is worth a lot
      this.emit('breach', { side: b.side, x: b.x, z: b.z, by: by || 0 });
      this.endMatch(other(b.side), 'base');
    }
  }
  hitUnit(u, dmg, dx, dz, kb, by, crit) {
    if (u.dead) return;
    u.hp -= dmg; u.hitT = 0.11;
    const m = u.kind === 'boss' ? 30 : u.mass;
    u.kx += (dx * kb) / m; u.kz += (dz * kb) / m;
    this.emit('hit', { x: u.x, z: u.z, dmg, crit, by: by || 0, kind: u.kind, side: u.side, dx, dz, id: u.id });
    if (u.hp <= 0) this.killUnit(u, by, dx, dz);
  }
  killUnit(u, by, dx, dz) {
    if (u.dead) return;
    u.dead = true; u.hp = 0;
    const h = by ? this.heroById(by) : null;
    let pts = 0;
    if (h && h.side !== u.side) {
      h.mk++;
      h.combo++; h.comboT = 3.2;
      h.mult = Math.min(8, 1 + Math.floor(h.combo / 5));
      h.qstreak = h.qstreakT > 0 ? h.qstreak + 1 : 1; h.qstreakT = 1.4;
      for (const [n, name] of STREAKS) if (h.qstreak === n) this.emit('streak', { id: h.id, n, name });
      if (!h.dead) {
        const heal = 2 * h.up.leech * (h.syn.vampire ? 3 : 1);
        if (heal) h.hp = Math.min(h.max, h.hp + heal);
        if (h.up.dashKill) h.dashCd = Math.max(0, h.dashCd - 0.45 * h.up.dashKill);
      }
      pts = Math.round(KINDS[u.kind].score * (u.elite ? 3 : 1) * h.mult * (this.twist === 'bounty' ? 2 : 1));
      h.score += pts;
      this.gainXp(h, XP[u.kind] * (u.elite ? 2 : 1));
      if (u.kind === 'boss') for (const o of this.heroes) if (o.side === h.side && o !== h) this.gainXp(o, 120);
      if (h.up.boom) {
        const big = h.syn.detonator ? 1.6 : 1;
        this.booms.push({ x: u.x, z: u.z, r: 2.4 * big, dmg: (10 + this.heroDmg(h) * 0.8) * big, side: h.side, by: h.id, kb: 8, kind: 'chain' });
      }
    }
    const chance = (u.elite ? 1 : u.kind === 'brute' ? 0.22 : u.kind === 'boss' ? 1 : 0.035) * (this.twist === 'goldrush' ? 4 : 1);
    if (this.rand() < chance && this.pickups.length < 10) this.dropPickup(u.x, u.z);
    if (u.kind === 'boss') this.emit('bossDown', { side: u.side, by: h ? h.id : 0, name: h ? h.name : '', x: u.x, z: u.z });
    this.emit('kill', { x: u.x, z: u.z, kind: u.kind, side: u.side, elite: u.elite, by: by || 0, dx, dz, pts, id: u.id, r: u.r });
  }
  dropPickup(x, z) {
    const r = this.rand();
    const kind = r < 0.45 ? 'heal' : r < 0.8 ? 'frenzy' : 'reset';
    this.pickups.push({ kind, x, z, t: PICKUPS[kind].life, id: this.nid++ });
    this.emit('drop', { kind, x, z });
  }
  // Spawn one ability power-up at a random floor spot, capped so the arena never floods with them.
  spawnAbilityPickup() {
    if (this.pickups.length >= 10) return;
    let onFloor = 0;
    for (const p of this.pickups) if (PICKUPS[p.kind].ability) onFloor++;
    if (onFloor >= 4) return; // a handful at most across the whole arena
    const kind = ABILITY_PICKS[(this.rand() * ABILITY_PICKS.length) | 0];
    const x = (this.rand() - 0.5) * 26, z = (this.rand() - 0.5) * 44;
    this.pickups.push({ kind, x, z, t: PICKUPS[kind].life, id: this.nid++ });
    this.emit('drop', { kind, x, z });
  }
  explode(x, z, r, dmg, side, by, kb, kind, stun = 0) {
    for (const u of this.units) {
      if (u.dead || u.side === side) continue;
      const dx = u.x - x, dz = u.z - z, d = len(dx, dz);
      if (d > r + u.r) continue;
      const f = 1 - 0.5 * Math.min(1, d / r);
      if (stun) u.stun = Math.max(u.stun, u.kind === 'boss' ? stun * 0.3 : stun);
      this.hitUnit(u, dmg * f, dx / (d || 1), dz / (d || 1), kb, by, false);
    }
    for (const h of this.heroes) {
      if (h.dead || h.side === side) continue;
      const d = len(h.x - x, h.z - z);
      if (d < r + h.r) this.hurtHero(h, dmg * (1 - 0.5 * Math.min(1, d / r)), (h.x - x) / (d || 1), (h.z - z) / (d || 1), kb * 0.6, by);
    }
    this.emit('boom', { x, z, r, kind, side });
  }

  // ---------- bases (each has a turret) ----------
  stepBases(dt) {
    for (const k of SIDES) {
      const b = this.bases[k];
      b.hitT = Math.max(0, b.hitT - dt);
      b.fireT -= dt;
      if (b.fireT > 0 || this.phase !== 'play') continue;
      let best = null, bd = 13 * 13;
      for (const u of this.units) {
        if (u.side === k || u.dead) continue;
        const d = (u.x - b.x) ** 2 + (u.z - b.z) ** 2;
        if (d < bd) { bd = d; best = u; }
      }
      if (!best) for (const h of this.heroes) {
        if (h.side === k || h.dead) continue;
        const d = (h.x - b.x) ** 2 + (h.z - b.z) ** 2;
        if (d < bd) { bd = d; best = h; }
      }
      if (!best) { b.fireT = 0.2; continue; }
      b.fireT = 0.6;
      const sx = b.x, sz = b.z + fwd(k) * 2.5;
      const l = len(best.x - sx, best.z - sz) || 1;
      this.shots.push({ x: sx, z: sz, dx: (best.x - sx) / l, dz: (best.z - sz) / l, spd: 30, life: 0.7, dmg: best.type === 'hero' ? 10 : 8, side: k, src: 'turret', owner: 0, pierce: 0, hits: [], r: 0.3 });
      this.emit('turret', { side: k, x: sx, z: sz, tx: best.x, tz: best.z });
    }
  }

  // ---------- abilities & drones ----------
  stepAbilities(dt) {
    for (const w of this.walls) w.t -= dt;
    if (this.walls.length) this.walls = this.walls.filter((w) => w.t > 0);
    for (const f of this.fires) {
      f.t -= dt; f.tick -= dt;
      if (f.tick > 0) continue;
      f.tick = 0.25;
      for (const u of this.units) {
        if (u.dead || u.side === f.side) continue;
        if (segCircle(f.x0, f.z0, f.x1, f.z1, u.x, u.z, f.w + u.r) >= 0) this.hitUnit(u, f.dmg, 0, 0, 0, f.owner, false);
      }
      for (const h of this.heroes) {
        if (h.dead || h.side === f.side) continue;
        if (segCircle(f.x0, f.z0, f.x1, f.z1, h.x, h.z, f.w + h.r) >= 0) this.hurtHero(h, f.dmg, 0, 0, 0, f.owner);
      }
    }
    if (this.fires.length) this.fires = this.fires.filter((f) => f.t > 0);
    for (const d of this.drones) {
      d.t -= dt;
      const owner = this.heroById(d.owner);
      let tgt = null, bd = 18 * 18;
      for (const u of this.units) {
        if (u.dead || u.side === d.side) continue;
        const dd = (u.x - d.x) ** 2 + (u.z - d.z) ** 2;
        if (dd < bd) { bd = dd; tgt = u; }
      }
      for (const h of this.heroes) {
        if (h.dead || h.side === d.side) continue;
        const dd = (h.x - d.x) ** 2 + (h.z - d.z) ** 2;
        if (dd < bd) { bd = dd; tgt = h; }
      }
      if ((d.t <= 0 || !owner) && !d.dive) d.dive = { t: 1.2, tgt };
      if (d.dive) {
        d.dive.t -= dt;
        const tg = d.dive.tgt && !d.dive.tgt.dead ? d.dive.tgt : tgt;
        if (tg) {
          const dx = tg.x - d.x, dz = tg.z - d.z, l = len(dx, dz) || 1;
          d.vx = (dx / l) * 24; d.vz = (dz / l) * 24;
          if (l < tg.r + 0.6) d.dive.t = 0;
        }
        d.x += d.vx * dt; d.z += d.vz * dt;
        if (d.dive.t <= 0) { d.dead = true; this.booms.push({ x: d.x, z: d.z, r: 3.2, dmg: 30 + (owner ? this.heroDmg(owner) : HERO.dmg) * 1.2, side: d.side, by: d.owner, kb: 10, kind: 'drone' }); }
        continue;
      }
      d.ang += dt * 2.2;
      let gx = owner.x + Math.sin(d.ang) * 2.2, gz = owner.z + Math.cos(d.ang) * 2.2;
      if (tgt) { const l = Math.sqrt(bd) || 1; gx = tgt.x - ((tgt.x - d.x) / l) * 5 + Math.sin(d.ang) * 1.5; gz = tgt.z - ((tgt.z - d.z) / l) * 5 + Math.cos(d.ang) * 1.5; }
      d.vx += ((gx - d.x) * 4 - d.vx) * Math.min(1, dt * 5); d.vz += ((gz - d.z) * 4 - d.vz) * Math.min(1, dt * 5);
      d.x += d.vx * dt; d.z += d.vz * dt;
      d.fireT -= dt;
      if (tgt && d.fireT <= 0 && bd < 14 * 14) {
        d.fireT = 0.32;
        const l = Math.sqrt(bd) || 1;
        this.shots.push({ x: d.x, z: d.z, dx: (tgt.x - d.x) / l, dz: (tgt.z - d.z) / l, spd: 40, life: 0.5, dmg: this.heroDmg(owner) * 0.6, side: d.side, src: 'hero', owner: d.owner, pierce: 0, hits: [], r: 0.25, drone: true });
      }
    }
    if (this.drones.length) this.drones = this.drones.filter((d) => !d.dead);
  }

  // ---------- projectiles ----------
  stepShots(dt) {
    const keep = [];
    for (const s of this.shots) {
      s.life -= dt;
      const x0 = s.x, z0 = s.z;
      const x1 = x0 + s.dx * s.spd * dt, z1 = z0 + s.dz * s.spd * dt;
      let dead = s.life <= 0;
      if (!dead) for (const w of this.walls) {
        if (w.side === s.side) continue;
        const tx = -w.nz, tz = w.nx;
        if (segSeg(x0, z0, x1, z1, w.x - tx * w.half, w.z - tz * w.half, w.x + tx * w.half, w.z + tz * w.half)) { dead = true; this.emit('block', { x: x1, z: z1 }); break; }
      }
      if (!dead) for (const f of this.fires) {
        if (f.side === s.side) continue;
        if (segCircle(f.x0, f.z0, f.x1, f.z1, x1, z1, f.w) >= 0) { dead = true; this.emit('block', { x: x1, z: z1 }); break; }
      }
      if (!dead) for (const c of this.cover) {
        if (segCircle(x0, z0, x1, z1, c.x, c.z, c.r + s.r * 0.5) >= 0) { dead = true; break; }
      }
      const by = s.src === 'hero' ? s.owner : 0;
      if (!dead) {
        for (const u of this.units) {
          if (u.dead || u.side === s.side || s.hits.includes(u.id)) continue;
          if (segCircle(x0, z0, x1, z1, u.x, u.z, u.r + s.r) < 0) continue;
          s.hits.push(u.id);
          this.hitUnit(u, s.dmg, s.dx, s.dz, s.big ? 10 : by ? 3.2 : 2, by, !!s.crit);
          if (s.big) this.booms.push({ x: u.x, z: u.z, r: 3, dmg: s.dmg * 0.5, side: s.side, by, kb: 10, kind: 'over' });
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
              break;
            }
          }
          if (s.pierce > 0) { s.pierce--; s.dmg *= 0.85; continue; }
          dead = true; break;
        }
      }
      if (!dead) {
        for (const h of this.heroes) {
          if (h.dead || h.side === s.side || h.inv > 0) continue;
          if (segCircle(x0, z0, x1, z1, h.x, h.z, h.r + s.r) < 0) continue;
          this.hurtHero(h, s.dmg, s.dx, s.dz, 3, by);
          if (s.big) this.booms.push({ x: h.x, z: h.z, r: 3, dmg: s.dmg * 0.4, side: s.side, by, kb: 10, kind: 'over' });
          dead = true; break;
        }
      }
      if (!dead) {
        const b = this.bases[other(s.side)];
        if (segCircle(x0, z0, x1, z1, b.x, b.z, b.r) >= 0) { this.hurtBase(b, s.dmg * (s.src === 'hero' ? 1 : 0.6), by); dead = true; }
      }
      if (!dead && (Math.abs(x1) > ARENA.halfW + 2 || Math.abs(z1) > ARENA.halfL + 2)) dead = true;
      if (!dead) {
        if (s.x === x0 && s.z === z0) { s.x = x1; s.z = z1; }
        keep.push(s);
      }
    }
    this.shots = keep;
  }
  stepSlams(dt) {
    for (const s of this.slams) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      if (s.boss && !this.units.some((u) => u.id === s.boss && !u.dead)) continue; // boss died mid wind-up
      for (const u of this.units) {
        if (u.dead || u.side === s.side) continue;
        const dx = u.x - s.x, dz = u.z - s.z, d = len(dx, dz);
        if (d < s.r + u.r * 0.5) this.hitUnit(u, s.dmg * (s.boss ? 0.6 : 1), dx / (d || 1), dz / (d || 1), s.kb, s.by, false);
      }
      for (const h of this.heroes) {
        if (h.dead || h.side === s.side) continue;
        const dx = h.x - s.x, dz = h.z - s.z, d = len(dx, dz);
        if (d < s.r + h.r * 0.3) this.hurtHero(h, s.dmg, dx / (d || 1), dz / (d || 1), s.kb, s.by);
      }
      const b = this.bases[other(s.side)];
      if (len(b.x - s.x, b.z - s.z) < s.r + b.r) this.hurtBase(b, s.dmg * 1.5, s.by);
      this.emit('slam', { x: s.x, z: s.z, r: s.r, kind: s.kind || 'slam', side: s.side });
    }
    if (this.slams.length) this.slams = this.slams.filter((s) => !s.done);
  }
  stepPickups(dt) {
    for (const p of this.pickups) {
      p.t -= dt;
      let near = null, nd = 3.2;
      for (const h of this.heroes) {
        if (h.dead) continue;
        const d = len(h.x - p.x, h.z - p.z);
        if (d < nd) { nd = d; near = h; }
      }
      if (!near) continue;
      const dx = near.x - p.x, dz = near.z - p.z;
      p.x += (dx / (nd || 1)) * dt * 12; p.z += (dz / (nd || 1)) * dt * 12;
      if (nd < 1.1) {
        p.t = 0;
        const ability = PICKUPS[p.kind].ability;
        if (ability) { this.useAbility(near, ability, near.inp); continue; } // fire it now; the 'ability' event drives visuals/sound
        if (p.kind === 'heal') near.hp = Math.min(near.max, near.hp + near.max * 0.35);
        else if (p.kind === 'frenzy') near.frenzy = PICKUPS.frenzy.dur;
        else { near.cd.q = near.cd.e = near.cd.r = 0; near.dashCd = 0; }
        this.emit('pickup', { id: near.id, kind: p.kind, x: p.x, z: p.z });
      }
    }
    if (this.pickups.length) this.pickups = this.pickups.filter((p) => p.t > 0);
  }
}

// ---------- wire format (server -> page). Compact arrays, numbers rounded. ----------
const SI = (s) => (s === 'human' ? 0 : 1);
export const SIDE_OF = (i) => (i === 0 ? 'human' : 'ai');
// Events the page needs for effects, sound, the feed and callouts.
export const NET_EVENTS = new Set(['shot', 'hit', 'kill', 'heroHurt', 'heroKill', 'heroRespawn', 'dash', 'ability', 'slam', 'boom',
  'bossSpawn', 'bossWarn', 'bossDown', 'baseHit', 'baseMile', 'breach', 'turret', 'drop', 'pickup', 'synergy', 'levelUp', 'upgrade',
  'streak', 'pstreak', 'twist', 'wave', 'join', 'leave', 'switch', 'matchEnd', 'matchStart', 'block', 'telegraph', 'burst', 'shieldHit']);

export function encodeSnap(m) {
  const B = m.bases;
  return {
    t: 's', T: r2(m.t), ph: m.phase === 'end' ? 1 : 0, eT: r1(m.endT), mn: m.matchNo, tw: m.twist || 0,
    nb: MATCH.bossAt[m.bossNo] !== undefined ? MATCH.bossAt[m.bossNo] : -1,
    b: [Math.round(B.human.hp), B.human.max, Math.round(B.ai.hp), B.ai.max, (B.human.shield ? 1 : 0) | (B.ai.shield ? 2 : 0), r1(B.human.hitT), r1(B.ai.hitT)],
    ra: [r1(m.rally.human), r1(m.rally.ai)],
    h: m.heroes.map((h) => [h.id, SI(h.side), r1(h.x), r1(h.z), r2(h.aim), Math.ceil(h.hp), h.max,
      (h.dead ? 1 : 0) | (h.dashT > 0 ? 2 : 0) | (h.inv > 0.4 ? 4 : 0) | (h.hurtT > 0 ? 8 : 0) | (h.frenzy > 0 ? 16 : 0) | (h.recoil > 0.5 ? 32 : 0),
      h.level, r1(h.respawnT), r1(h.vx), r1(h.vz)]),
    u: m.units.map((u) => [u.id, SI(u.side), KIND_LIST.indexOf(u.kind), r1(u.x), r1(u.z), r2(u.face), Math.max(0, Math.round(u.hp / u.max * 100)),
      (u.elite ? 1 : 0) | (u.stun > 0 ? 2 : 0) | (u.swing > 0.6 ? 4 : 0), BOSS_STATES.indexOf(u.state), r2(u.stateT)]),
    s: m.shots.map((s) => [r1(s.x), r1(s.z), r2(s.dx), r2(s.dz), SI(s.side), (s.orb ? 1 : 0) | (s.big ? 2 : 0) | (s.src === 'turret' ? 4 : 0) | (s.drone ? 8 : 0) | (s.crit ? 16 : 0), Math.round(s.spd), s.owner || 0]),
    sl: m.slams.map((s) => [r1(s.x), r1(s.z), r1(s.r), r2(s.t), r2(s.max), SI(s.side), SLAM_KINDS.indexOf(s.kind)]),
    w: m.walls.map((w) => [r1(w.x), r1(w.z), r2(w.nx), r2(w.nz), r1(w.t), w.max, SI(w.side)]),
    f: m.fires.map((f) => [r1(f.x0), r1(f.z0), r1(f.x1), r1(f.z1), f.w, r1(f.t), f.max, SI(f.side)]),
    d: m.drones.map((d) => [d.id, r1(d.x), r1(d.z), r1(d.vx), r1(d.vz), d.dive ? 1 : 0, SI(d.side)]),
    p: m.pickups.map((p) => [p.id, PICK_LIST.indexOf(p.kind), r1(p.x), r1(p.z), r1(p.t)]),
  };
}
// The private part of a snapshot: only the player's own hero needs cooldowns, xp and the card offer.
export function encodeMe(m, h) {
  if (!h) return null;
  return {
    id: h.id, ack: h.ack, side: h.side, x: r2(h.x), z: r2(h.z), vx: r2(h.vx), vz: r2(h.vz), dT: r2(h.dashT), dX: r2(h.dashX), dZ: r2(h.dashZ),
    dc: r2(h.dashCd), dcm: r2(m.dashCdOf(h)), cd: [r2(h.cd.q), r2(h.cd.e), r2(h.cd.r)], cm: [r2(h.cdMax.q), r2(h.cdMax.e), r2(h.cdMax.r)],
    sp: r2(m.heroSpeed(h)), rate: r2(m.heroRate(h)), xp: Math.floor(h.xp), xn: xpNeed(h.level), lv: h.level, pend: h.pending,
    o: h.offer ? h.offer.map((o) => [o.id, o.level, o.synergy || '']) : 0, oT: r1(h.offerT),
    pk: h.picked, syn: Object.keys(h.syn), fr: r1(h.frenzy), k: h.kills, d: h.deaths, sc: Math.round(h.score),
    st: h.streak, cb: h.combo, cbT: r2(h.comboT), mu: h.mult, qs: h.qstreak, qsT: r2(h.qstreakT), ber: h.up.berserk ? 1 : 0,
  };
}
export function encodeRoster(m) {
  return {
    t: 'r', n: m.realCount(), mn: m.matchNo,
    p: m.heroes.map((h) => [h.id, h.name, SI(h.side), h.kills, h.deaths, h.level, h.bot ? 1 : 0, Math.round(h.score)]),
  };
}
