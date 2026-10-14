// Human vs AI 2.0 — the page side of multiplayer. Connects to the game server (a Cloudflare Durable Object
// running js/match.js), sends only inputs, and turns snapshots into a game-like view for the renderer:
// other heroes and minions are drawn ~100 ms in the past (smooth interpolation), the player's own hero is
// predicted locally from its inputs and corrected by the server (so controls feel instant).
import { ARENA, HERO, KINDS, baseZ, fwd, other } from './config.js';
import { COVER } from './sim.js';
import { SIDE_OF, KIND_LIST, PICK_LIST, SLAM_KINDS, BOSS_STATES, MATCH, cleanName } from './match.js';

export const DEFAULT_SERVER = 'wss://human-vs-ai.tirupathi-podugu.workers.dev';
// ?server=local -> a wrangler dev server on this machine, ?server=off -> always offline. Nothing else is accepted.
export function serverUrl() {
  let q = null;
  try { q = new URLSearchParams(location.search).get('server'); } catch (e) {}
  if (q === 'local') return 'ws://127.0.0.1:8787';
  if (q === 'off') return '';
  return DEFAULT_SERVER;
}
export { cleanName };

const MAX_ROOM = 20, CONNECT_MS = 5000, INTERP = 0.1, SEND_MS = 50;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; }

export class Net {
  constructor(url) {
    this.url = url;
    this.status = url ? 'connecting' : 'offline'; // connecting | online | offline
    this.room = 1; this.ws = null; this.id = null; this.ok = false;
    this.roster = null; this.players = 0;
    this.joined = false; this.want = null; this.hero = null; // want: {name, team} while the player wants to be in a match
    this.handlers = {};
    this.events = [];
    this.view = new NetView();
    this.lastSend = 0; this.seq = 0; this.sent = { mx: 0, mz: 0, a: 0, f: 0 };
    this.retryT = null;
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, d) { const f = this.handlers[name]; if (f) f(d); }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }

  // quiet: a background retry while offline (the menu keeps saying "Offline" until it works)
  connect(room = 1, quiet = false) {
    if (!this.url) { this.setStatus('offline'); return; }
    this.close();
    this.room = room; this.ok = false;
    if (this.status !== 'online' && !quiet) this.setStatus('connecting');
    let sock;
    try { sock = new WebSocket(this.url.replace(/\/+$/, '') + '/v2/room/' + room); } catch (e) { this.fail(); return; }
    this.ws = sock;
    const timer = setTimeout(() => { if (this.ws === sock && !this.ok) this.fail(); }, CONNECT_MS);
    // a tiny ping every 20 s keeps the room's allowance fresh, like v1
    const ping = setInterval(() => { if (sock.readyState === 1) sock.send('{"t":"p"}'); else if (sock.readyState > 1) clearInterval(ping); }, 20000);
    sock.onmessage = (ev) => {
      if (this.ws !== sock) return;
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d || typeof d !== 'object') return;
      if (d.t === 'hi') {
        this.ok = true; this.id = d.id; clearTimeout(timer);
        this.setStatus('online');
        if (this.want) this.send({ t: 'join', name: this.want.name, team: this.want.team });
      } else if (d.t === 'full') {
        clearTimeout(timer);
        if (room < MAX_ROOM) this.connect(room + 1, quiet); else this.fail();
      } else if (d.t === 'joined') {
        this.joined = true; this.hero = d.hero;
        this.emit('joined', d);
      } else if (d.t === 'afk') {
        this.joined = false; this.want = null; this.emit('afk');
      } else if (d.t === 'r') {
        this.roster = d; this.players = d.n;
        this.view.names(d);
        this.emit('roster', d);
      } else if (d.t === 's') {
        if (!this.joined) return;
        this.view.snapshot(d, performance.now() / 1000);
        for (const e of d.e) this.events.push(e);
        if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
      }
    };
    sock.onclose = () => {
      clearTimeout(timer);
      if (this.ws !== sock) return;
      this.ws = null;
      const was = this.ok; this.ok = false; this.joined = false;
      if (!was) { this.fail(); return; }
      // lost the server mid-way: try again (rejoins automatically if the player was in a match)
      this.setStatus('connecting');
      this.emit('lost');
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.connect(this.room), 1500);
    };
  }
  fail() { this.close(); this.setStatus('offline'); }
  close() { if (this.ws) { const s = this.ws; this.ws = null; try { s.close(); } catch (e) {} } this.ok = false; this.joined = false; }
  send(m) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(m)); } catch (e) {} } }
  join(name, team) {
    this.want = { name: cleanName(name), team };
    this.view.reset(team);
    this.events.length = 0;
    this.send({ t: 'join', name: this.want.name, team });
  }
  leave() {
    this.want = null;
    if (this.joined) this.send({ t: 'leave' });
    this.joined = false; this.hero = null;
    this.view.reset(null);
    this.events.length = 0;
  }
  pick(i) { this.send({ t: 'pick', i }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // Called every frame while playing online. inp: the same intent object the solo game gets.
  update(dt, inp) {
    const now = performance.now();
    const a = Math.atan2(inp.ax || 0, inp.az || 0);
    const edge = inp.dash || inp.q || inp.e || inp.r;
    const mx = Math.round(clamp(inp.mx || 0, -1, 1) * 100) / 100, mz = Math.round(clamp(inp.mz || 0, -1, 1) * 100) / 100;
    const f = inp.fire ? 1 : 0;
    const changed = mx !== this.sent.mx || mz !== this.sent.mz || f !== this.sent.f || Math.abs(a - this.sent.a) > 0.03;
    if (this.joined && (edge || (changed && now - this.lastSend > 33) || now - this.lastSend > SEND_MS * 4)) {
      this.seq++;
      const m = { t: 'i', s: this.seq, mx, mz, a: Math.round(a * 100) / 100, f, ad: Math.round(clamp(inp.aimDist || 9, 4, 15) * 10) / 10 };
      if (inp.dash) m.d = 1; if (inp.q) m.q = 1; if (inp.e) m.e = 1; if (inp.r) m.r = 1;
      this.send(m);
      this.lastSend = now; this.sent = { mx, mz, a, f };
    }
    this.view.frame(dt, now / 1000, { seq: this.seq, mx: this.sent.mx, mz: this.sent.mz, dash: !!inp.dash, aim: (inp.ax || inp.az) ? a : null });
  }
}

// ---------- the view: looks like a solo Game to the renderer, HUD and bot ----------
export class NetView {
  constructor() { this.reset(null); this.nameOf = new Map(); }
  reset(team) {
    this.online = true; this.team = team || 'human'; this.foe = other(this.team);
    this.snaps = []; this.offset = null; this.mn = 0; this.meId = 0; this.me = null;
    this.t = 0; this.T = 0; this.phase = 'fight'; this.ended = false; this.endT = 0;
    this.unitMap = new Map(); this.heroMap = new Map(); this.droneMap = new Map();
    this.units = []; this.heroes = []; this.shots = []; this.slams = []; this.walls = []; this.fires = []; this.drones = []; this.pickups = [];
    this.bases = { human: { type: 'base', side: 'human', x: 0, z: baseZ('human'), r: ARENA.baseR, hp: MATCH.baseHp, max: MATCH.baseHp, shield: false, hitT: 0 },
      ai: { type: 'base', side: 'ai', x: 0, z: baseZ('ai'), r: ARENA.baseR, hp: MATCH.baseHp, max: MATCH.baseHp, shield: false, hitT: 0 } };
    this.hero = this.blankHero(this.team);
    this.pred = null; this.hist = []; this.corr = { x: 0, z: 0 };
    this.boss = null; this.bossWarnT = 0; this.twist = null; this.rally = 0; this.frenzy = 0;
    this.up = {}; this.syn = {}; this.picked = []; this.mod = null;
    this.wave = 1; this.score = 0; this.combo = 0; this.comboT = 0; this.mult = 1; this.streak = 0; this.streakT = 0;
    this.waveTotal = 1; this.waveDone = 0; this.kills = 0; this.offer = null; this.offerT = 0; this.nextBoss = -1;
    this.lastSnapAt = 0;
  }
  blankHero(side) {
    return { type: 'hero', id: 0, side, name: '', x: 0, z: baseZ(side) + fwd(side) * 9, vx: 0, vz: 0, r: HERO.r, aim: side === 'human' ? Math.PI : 0,
      aimX: 0, aimZ: fwd(side), hp: 100, max: 100, dead: true, respawnT: 0, dashT: 0, dashCd: 0, inv: 0, hurtT: 0, recoil: 0,
      revives: 0, cd: { q: 0, e: 0, r: 0 }, cdMax: { q: 1, e: 1, r: 1 }, level: 1, moving: 0 };
  }
  // the solo HUD calls these
  nextBossIn() { return -1; }
  dashCd() { return this.me ? this.me.dcm : HERO.dashCd; }
  ultUnlocked() { return true; }

  names(r) { for (const p of r.p) this.nameOf.set(p[0], { name: p[1], bot: !!p[6], level: p[5] }); }

  snapshot(s, now) {
    if (s.mn !== this.mn) { this.snaps = []; this.offset = null; this.mn = s.mn; this.unitMap.clear(); this.heroMap.clear(); this.pred = null; this.hist = []; }
    const sample = s.T - now;
    if (this.offset === null || Math.abs(sample - this.offset) > 1) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample > this.offset ? 0.3 : 0.05);
    s.at = now;
    s.um = new Map(s.u.map((a) => [a[0], a]));
    s.hm = new Map(s.h.map((a) => [a[0], a]));
    this.snaps.push(s);
    while (this.snaps.length > 20) this.snaps.shift();
    this.lastSnapAt = now;
    if (s.me) this.reconcile(s.me);
  }

  // ---- own hero: client-side prediction + server reconciliation ----
  reconcile(me) {
    const firstTime = !this.me || this.me.id !== me.id;
    this.me = me; this.meId = me.id;
    if (me.side !== this.team) { this.team = me.side; this.foe = other(me.side); }
    this.hist = this.hist.filter((f) => f.seq > me.ack);
    const p = { x: me.x, z: me.z, vx: me.vx, vz: me.vz, dashT: me.dT, dashX: me.dX, dashZ: me.dZ, dashCd: me.dc };
    for (const f of this.hist) this.stepPred(p, f, me.sp);
    if (this.pred && !firstTime) {
      // keep what is on screen where it was and fade the difference out over a few frames
      const ox = this.pred.x + this.corr.x - p.x, oz = this.pred.z + this.corr.z - p.z;
      if (Math.hypot(ox, oz) < 4) { this.corr.x = ox; this.corr.z = oz; } else { this.corr.x = this.corr.z = 0; }
    }
    this.pred = p;
  }
  stepPred(p, f, speed) {
    const dt = f.dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    let mx = f.mx, mz = f.mz;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (f.dash && p.dashCd <= 0 && p.dashT <= 0) {
      let dx = mx, dz = mz;
      if (Math.hypot(dx, dz) < 0.2 && f.aim !== null) { dx = Math.sin(f.aim); dz = Math.cos(f.aim); }
      const l = Math.hypot(dx, dz) || 1;
      p.dashX = dx / l; p.dashZ = dz / l; p.dashT = HERO.dashTime; p.dashCd = this.me ? this.me.dcm : HERO.dashCd;
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      const sp = HERO.dashDist / HERO.dashTime;
      p.vx = p.dashX * sp; p.vz = p.dashZ * sp;
      if (p.dashT <= 0) { p.vx *= 0.25; p.vz *= 0.25; }
    } else {
      const k = Math.min(1, dt * 14);
      p.vx += (mx * speed - p.vx) * k; p.vz += (mz * speed - p.vz) * k;
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    // same pushes as the server: cover, bases, enemy shield walls, arena edge
    const r = HERO.r;
    for (const c of COVER) {
      const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr; }
    }
    for (const k of ['human', 'ai']) {
      const b = this.bases[k], dx = p.x - b.x, dz = p.z - b.z, rr = r + b.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; p.x = b.x + (dx / d) * rr; p.z = b.z + (dz / d) * rr; }
    }
    for (const w of this.walls) {
      if (w.side === this.team) continue;
      const tx = -w.nz, tz = w.nx, px = p.x - w.x, pz = p.z - w.z;
      const along = px * tx + pz * tz, across = px * w.nx + pz * w.nz;
      if (Math.abs(along) < w.half + r * 0.5 && Math.abs(across) < r + 0.35) {
        const s = across >= 0 ? 1 : -1, push = s * (r + 0.35) - across;
        p.x += w.nx * push; p.z += w.nz * push; p.vx *= 0.5; p.vz *= 0.5;
      }
    }
    p.x = clamp(p.x, -(ARENA.halfW - r), ARENA.halfW - r); p.z = clamp(p.z, -(ARENA.halfL - r), ARENA.halfL - r);
  }

  // ---- every frame: interpolate everything to (server time - 100 ms), advance the prediction ----
  frame(dt, now, inp) {
    const S = this.snaps;
    if (!S.length) return;
    const latest = S[S.length - 1];
    const rt = now + this.offset - INTERP;
    let s0 = S[0], s1 = latest;
    for (let i = S.length - 1; i > 0; i--) { if (S[i - 1].T <= rt) { s0 = S[i - 1]; s1 = S[i]; break; } }
    const span = s1.T - s0.T;
    const k = span > 1e-4 ? clamp((rt - s0.T) / span, 0, 1) : 1;
    const prevT = this.t;
    this.t = lerp(s0.T, s1.T, k);
    const fdt = Math.max(0, Math.min(0.1, this.t - prevT)) || dt;
    this.T = latest.T;
    this.ended = latest.ph === 1; this.endT = latest.eT;
    this.twist = latest.tw || null;
    this.nextBoss = latest.nb;
    // bases
    const b = latest.b;
    Object.assign(this.bases.human, { hp: b[0], max: b[1], shield: !!(b[4] & 1) });
    Object.assign(this.bases.ai, { hp: b[2], max: b[3], shield: !!(b[4] & 2) });
    for (const kk of ['human', 'ai']) this.bases[kk].hitT = Math.max(0, this.bases[kk].hitT - dt);
    this.rally = latest.ra[this.team === 'human' ? 0 : 1];
    // minions
    const seen = new Set();
    this.units.length = 0;
    this.boss = null;
    for (const a1 of s1.u) {
      const id = a1[0], a0 = s0.um.get(id) || a1;
      let u = this.unitMap.get(id);
      const side = SIDE_OF(a1[1]), kind = KIND_LIST[a1[2]];
      if (!u) {
        u = { type: 'unit', id, side, kind, ally: side === this.team, x: a1[3], z: a1[4], vx: 0, vz: 0, face: a1[5], hp: 100, max: 100,
          r: KINDS[kind].r, elite: false, stun: 0, swing: 0, hitT: 0, born: this.snaps.length > 2 ? this.t : -10, walk: Math.random() * 6, state: 'walk', stateT: 0, leap: null, dead: false };
        this.unitMap.set(id, u);
      }
      seen.add(id);
      const x = lerp(a0[3], a1[3], k), z = lerp(a0[4], a1[4], k);
      const vx = (x - u.x) / Math.max(fdt, 1e-3), vz = (z - u.z) / Math.max(fdt, 1e-3);
      u.vx += (clamp(vx, -20, 20) - u.vx) * 0.3; u.vz += (clamp(vz, -20, 20) - u.vz) * 0.3;
      u.x = x; u.z = z; u.face = lerpAngle(a0[5], a1[5], k);
      u.hp = a1[6]; u.ally = side === this.team;
      const fl = a1[7];
      u.elite = !!(fl & 1); u.stun = fl & 2 ? 0.2 : 0;
      if (fl & 4 && u.swing < 0.3) u.swing = 1;
      u.swing = Math.max(0, u.swing - dt * 3.5); u.hitT = Math.max(0, u.hitT - dt);
      u.r = KINDS[kind].r * (u.elite ? 1.3 : 1);
      u.walk += Math.hypot(u.vx, u.vz) * dt;
      if (kind === 'boss') {
        u.state = BOSS_STATES[a1[8]] || 'walk'; u.stateT = Math.max(0, a1[9] - (rt - s1.T));
        u.leap = u.state === 'leap' ? { t: 1.25 } : null;
        if (side === this.foe) this.boss = u;
        u.max = 100;
      }
      this.units.push(u);
    }
    for (const id of this.unitMap.keys()) if (!seen.has(id)) this.unitMap.delete(id);
    // heroes
    this.heroes.length = 0;
    const hseen = new Set();
    for (const a1 of s1.h) {
      const id = a1[0], a0 = s0.hm.get(id) || a1;
      let h = this.heroMap.get(id);
      const side = SIDE_OF(a1[1]);
      if (!h) { h = this.blankHero(side); h.id = id; this.heroMap.set(id, h); }
      hseen.add(id);
      const fl = a1[7];
      h.side = side; h.hp = a1[5]; h.max = a1[6]; h.level = a1[8]; h.respawnT = a1[9];
      h.dead = !!(fl & 1); h.dashT = fl & 2 ? 0.1 : 0; h.inv = fl & 4 ? 0.5 : 0; h.hurtT = fl & 8 ? 0.2 : Math.max(0, h.hurtT - dt);
      h.frenzy = fl & 16 ? 1 : 0;
      if (fl & 32) h.recoil = 1; else h.recoil = Math.max(0, h.recoil - dt * 8);
      const nm = this.nameOf.get(id);
      h.name = nm ? nm.name : ''; h.bot = nm ? nm.bot : false;
      if (id === this.meId) { this.ownHero(h, a1, dt, inp); }
      else {
        h.x = lerp(a0[2], a1[2], k); h.z = lerp(a0[3], a1[3], k); h.aim = lerpAngle(a0[4], a1[4], k);
        h.vx = lerp(a0[10], a1[10], k); h.vz = lerp(a0[11], a1[11], k);
        h.aimX = Math.sin(h.aim); h.aimZ = Math.cos(h.aim);
      }
      this.heroes.push(h);
    }
    for (const id of this.heroMap.keys()) if (!hseen.has(id)) this.heroMap.delete(id);
    if (!this.heroMap.has(this.meId) && (!this.hero || this.hero.id !== 0)) this.hero = this.blankHero(this.team);
    // projectiles, drawn at the same moment as everything else
    const ds = rt - s1.T;
    this.shots.length = 0;
    for (const a of s1.s) {
      const fl = a[5], spd = a[6], tt = Math.max(-0.1, Math.min(0.15, ds));
      this.shots.push({ x: a[0] + a[2] * spd * tt, z: a[1] + a[3] * spd * tt, dx: a[2], dz: a[3], side: SIDE_OF(a[4]),
        orb: !!(fl & 1), big: !!(fl & 2), drone: !!(fl & 8), crit: !!(fl & 16), r: fl & 1 ? 0.4 : fl & 2 ? 0.55 : 0.28,
        src: fl & 4 ? 'turret' : a[7] && a[7] === this.meId ? 'hero' : a[7] ? 'other' : 'unit' });
    }
    this.slams = latest.sl.map((a) => ({ x: a[0], z: a[1], r: a[2], t: Math.max(0.001, a[3] - (now + this.offset - latest.T)), max: a[4], side: SIDE_OF(a[5]), kind: SLAM_KINDS[a[6]] }));
    this.walls = latest.w.map((a) => ({ x: a[0], z: a[1], nx: a[2], nz: a[3], t: a[4], max: a[5], side: SIDE_OF(a[6]), half: 3.8 }));
    this.fires = latest.f.map((a) => ({ x0: a[0], z0: a[1], x1: a[2], z1: a[3], w: a[4], t: a[5], max: a[6], side: SIDE_OF(a[7]) }));
    this.drones = s1.d.map((a) => { const o = (s0.d || []).find((b2) => b2[0] === a[0]) || a; return { id: a[0], x: lerp(o[1], a[1], k), z: lerp(o[2], a[2], k), vx: a[3], vz: a[4], dive: a[5] ? {} : null, side: SIDE_OF(a[6]) }; });
    this.pickups = latest.p.map((a) => ({ id: a[0], kind: PICK_LIST[a[1]], x: a[2], z: a[3], t: a[4] }));
    // HUD fields from the private part of the snapshot
    const me = this.me;
    if (me) {
      this.score = me.sc; this.combo = me.cb; this.comboT = me.cbT; this.mult = me.mu; this.streak = me.qs; this.streakT = me.qsT;
      this.frenzy = me.fr; this.picked = me.pk; this.kills = me.k;
      this.up = {}; for (const id of me.pk) this.up[id] = (this.up[id] || 0) + 1;
      this.syn = {}; for (const id of me.syn) this.syn[id] = true;
      this.wave = me.lv; this.waveTotal = me.xn; this.waveDone = me.xp;
      this.offer = me.o ? me.o.map((o) => ({ id: o[0], level: o[1], synergy: o[2] || null })) : null;
      this.offerT = Math.max(0, me.oT - (now - this.lastSnapAt));
    }
  }
  ownHero(h, a1, dt, inp) {
    this.hero = h;
    const me = this.me;
    h.dashCd = me.dc; h.cd = { q: me.cd[0], e: me.cd[1], r: me.cd[2] }; h.cdMax = { q: me.cm[0], e: me.cm[1], r: me.cm[2] };
    if (h.dead || !this.pred) {
      h.x = a1[2]; h.z = a1[3]; h.vx = h.vz = 0; this.hist = [];
      if (!h.dead) this.pred = { x: h.x, z: h.z, vx: 0, vz: 0, dashT: 0, dashX: 0, dashZ: 0, dashCd: me.dc };
      this.corr.x = this.corr.z = 0;
    } else {
      const f = { seq: inp.seq, mx: inp.mx, mz: inp.mz, dash: inp.dash, aim: inp.aim, dt: Math.min(dt, 0.05) };
      this.hist.push(f);
      if (this.hist.length > 120) this.hist.shift();
      this.stepPred(this.pred, f, me.sp);
      const decay = Math.exp(-dt * 12);
      this.corr.x *= decay; this.corr.z *= decay;
      h.x = this.pred.x + this.corr.x; h.z = this.pred.z + this.corr.z; h.vx = this.pred.vx; h.vz = this.pred.vz;
      h.dashT = this.pred.dashT > 0 ? this.pred.dashT : h.dashT;
    }
    if (inp.aim !== null && !h.dead) h.aim = inp.aim; else h.aim = a1[4];
    h.aimX = Math.sin(h.aim); h.aimZ = Math.cos(h.aim);
    h.moving = Math.hypot(h.vx, h.vz);
  }
}
