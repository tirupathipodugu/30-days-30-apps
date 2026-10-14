// Human vs AI 2.0 game room: one Durable Object per room (/v2/room/1 .. /v2/room/20).
// It runs the same match rules as the page (../v2/js/match.js) about 30 times a second.
//   server -> page: {t:'hi', id, v:2}, {t:'full'}, {t:'afk'}, {t:'r', ...roster} about once a second (and on changes),
//                   {t:'s', ...snapshot, me, e:[events]} about 15 times a second to players who joined
//   page -> server: {t:'join', name, team}, {t:'leave'}, {t:'i', s, mx, mz, a, f, d, q, e, r, ad}, {t:'pick', i}, {t:'p'}
import { Match, MATCH, NET_EVENTS, encodeSnap, encodeMe, encodeRoster } from '../v2/js/match.js';

export const V2 = {
  MAX_SOCKETS: 24,       // people on the start screen count too; joined players are capped at MATCH.maxPlayers (12)
  TICK_MS: 33,           // ~30 simulation steps a second
  SNAP_EVERY: 2,         // a snapshot every 2nd tick: ~15 a second
  ROSTER_EVERY: 1,       // seconds
  MAX_MSG_BYTES: 300,    // inputs are tiny; anything bigger is dropped
  MSG_PER_SEC: 45,       // above this, messages are ignored for the rest of that second
  KICK_PER_SEC: 200,     // far above it, the socket is closed
  AFK_MS: 90000,         // a joined player who sends nothing for 90 s leaves the match (frees the slot)
};

export class GameRoomV2 {
  constructor(state, env) {
    this.state = state;
    this.socks = new Map(); // id -> { ws, n, t0, joined, lastIn }
    this.match = null;
    this.loop = null;
    this.last = 0; this.acc = 0; this.ticks = 0; this.rosterT = 0;
    this.outEv = [];
    this.seq = 0;
    this.test = !!(env && env.V2_TEST); // debug messages only when started with: wrangler dev --var V2_TEST:1
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0], ws = pair[1];
    ws.accept();
    if (this.socks.size >= V2.MAX_SOCKETS) {
      ws.send(JSON.stringify({ t: 'full' }));
      ws.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = 'p' + (++this.seq) + Math.random().toString(36).slice(2, 6);
    const info = { ws, n: 0, t0: Date.now(), joined: false, lastIn: Date.now() };
    this.socks.set(id, info);
    ws.send(JSON.stringify({ t: 'hi', id, v: 2, cap: MATCH.maxPlayers }));
    this.sendTo(info, this.roster());
    ws.addEventListener('message', (ev) => this.onMessage(id, info, ev.data));
    const gone = () => this.drop(id);
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  sendTo(info, obj) { try { info.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { /* closed */ } }
  roster() { return this.match ? encodeRoster(this.match) : { t: 'r', n: 0, mn: 0, p: [] }; }

  onMessage(id, info, data) {
    if (!this.socks.has(id)) return;
    const now = Date.now();
    if (now - info.t0 > 1000) { info.t0 = now; info.n = 0; }
    if (++info.n > V2.KICK_PER_SEC) { try { info.ws.close(1008, 'too many messages'); } catch (e) {} this.drop(id); return; }
    if (info.n > V2.MSG_PER_SEC) return;
    if (typeof data !== 'string' || data.length > V2.MAX_MSG_BYTES) return;
    let d;
    try { d = JSON.parse(data); } catch (e) { return; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    if (d.t === 'p') return;
    if (d.t === 'join') {
      if (!this.match) { this.match = new Match({ seed: (Math.random() * 1e9) | 0 }); this.outEv = []; }
      const h = this.match.addPlayer(id, d.name, d.team);
      if (!h) { this.sendTo(info, { t: 'full' }); return; }
      info.joined = true; info.lastIn = now;
      this.sendTo(info, { t: 'joined', hero: h.id, side: h.side });
      this.rosterT = V2.ROSTER_EVERY; // send the new roster on the next tick
      return;
    }
    if (!info.joined || !this.match) return;
    info.lastIn = now;
    if (d.t === 'i') this.match.input(id, d);
    else if (d.t === 'pick') this.match.pick(id, d.i);
    else if (d.t === 'leave') this.unjoin(id, info);
    else if (d.t === 'dbg' && this.test) this.match.debug(id, d);
  }

  unjoin(id, info) {
    if (!info.joined) return;
    info.joined = false;
    if (!this.match) return;
    this.match.removePlayer(id);
    // nobody playing any more: forget the match, the next player starts a fresh one
    if (this.match.realCount() === 0) { this.match = null; this.outEv = []; this.broadcast(JSON.stringify(this.roster())); }
  }

  drop(id) {
    const info = this.socks.get(id);
    if (!info) return;
    this.socks.delete(id);
    this.unjoin(id, info);
    if (!this.socks.size) this.stop();
  }

  start() {
    if (this.loop) return;
    this.last = Date.now(); this.acc = 0;
    this.loop = setInterval(() => this.tick(), V2.TICK_MS);
  }
  // nobody left: stop ticking and forget the room, so an empty room costs nothing
  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null; this.match = null; this.outEv = [];
  }
  broadcast(msg, joinedOnly = false) {
    for (const [id, info] of this.socks) {
      if (joinedOnly && !info.joined) continue;
      try { info.ws.send(msg); } catch (e) { this.drop(id); }
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    // AFK players leave the match
    for (const [id, info] of this.socks) {
      if (info.joined && now - info.lastIn > V2.AFK_MS) { this.unjoin(id, info); this.sendTo(info, { t: 'afk' }); }
    }
    const m = this.match;
    this.rosterT += dt;
    if (!m) {
      if (this.rosterT >= V2.ROSTER_EVERY * 3) { this.rosterT = 0; this.broadcast(JSON.stringify(this.roster())); }
      return;
    }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1 / 30 && steps < 3) { m.step(1 / 30); this.acc -= 1 / 30; steps++; }
    if (steps === 3) this.acc = 0;
    for (const e of m.events) if (NET_EVENTS.has(e.type)) this.outEv.push(e);
    m.events.length = 0;
    if (this.outEv.length > 300) this.outEv.splice(0, this.outEv.length - 300);
    if (this.rosterT >= V2.ROSTER_EVERY || (m.dirty && this.rosterT > 0.25)) {
      this.rosterT = 0; m.dirty = false;
      this.broadcast(JSON.stringify(this.roster()));
    }
    if (++this.ticks % V2.SNAP_EVERY) return;
    const common = JSON.stringify(encodeSnap(m));
    const ev = JSON.stringify(this.outEv);
    this.outEv = [];
    const body = common.slice(1, -1);
    for (const [id, info] of this.socks) {
      if (!info.joined) continue;
      const me = JSON.stringify(encodeMe(m, m.heroOf(id)));
      try { info.ws.send('{' + body + ',"e":' + ev + ',"me":' + me + '}'); } catch (e) { this.drop(id); }
    }
  }
}
