// Human vs AI game server: a Cloudflare Worker that hands each room to one Durable Object (GameRoom).
// The room runs the same rules as the page (../engine.js) and speaks the same messages as the PeerJS host:
//   server -> player: {t:'hi', id}, {t:'full'}, {t:'s', ...snapshot} about 10 times a second
//   player -> server: {t:'join', name, team}, {t:'team', name, team}, {t:'a', d, u, v}, {t:'send'}
import '../engine.js';
import { GameRoomV2 } from './room-v2.js';
export { GameRoomV2 };

const E = globalThis.HVAEngine;
const MAX_PLAYERS = 40;        // sockets per room; the 41st gets {t:'full'} and the page tries the next room
const MAX_ROOMS = 20;          // /room/1 .. /room/20
const TICK_MS = 33;            // ~30 simulation steps a second
const SNAP_EVERY = 0.1;        // seconds between snapshots
const MAX_MSG_BYTES = 512;     // inputs are tiny; anything bigger is dropped
const MSG_PER_SEC = 40;        // above this, messages are ignored for the rest of that second
const KICK_PER_SEC = 200;      // far above it, the socket is closed

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Human vs AI 2.0 (the 3D hero arena) has its own rooms: /v2/room/1 .. /v2/room/20
    const m2 = url.pathname.match(/^\/v2\/room\/(\d{1,3})\/?$/);
    if (m2) {
      const n = Number(m2[1]);
      if (n < 1 || n > MAX_ROOMS) return new Response('No such room', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.GAME_ROOM_V2.get(env.GAME_ROOM_V2.idFromName('v2-room-' + n)).fetch(request);
    }
    const m = url.pathname.match(/^\/room\/(\d{1,3})\/?$/);
    if (!m) {
      return new Response('Human vs AI game server. Connect a WebSocket to /room/1 (v1) or /v2/room/1 (2.0)', {
        status: url.pathname === '/' ? 200 : 404, headers: { 'content-type': 'text/plain' },
      });
    }
    const n = Number(m[1]);
    if (n < 1 || n > MAX_ROOMS) return new Response('No such room', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const id = env.GAME_ROOM.idFromName('room-' + n);
    return env.GAME_ROOM.get(id).fetch(request);
  },
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.socks = new Map();    // id -> { ws, n, t0 }
    this.world = null;
    this.loop = null;
    this.last = 0;
    this.snapT = 0;
    this.rosterT = 0;
    this.outEv = [];
    this.seq = 0;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0], ws = pair[1];
    ws.accept();
    if (this.socks.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'full' }));
      ws.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = 'p' + (++this.seq) + Math.random().toString(36).slice(2, 6);
    const info = { ws, n: 0, t0: Date.now(), bad: 0 };
    this.socks.set(id, info);
    if (!this.world) this.world = E.newWorld();
    ws.send(JSON.stringify({ t: 'hi', id }));
    ws.addEventListener('message', (ev) => this.onMessage(id, info, ev.data));
    const gone = () => this.drop(id);
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(id, info, data) {
    if (!this.socks.has(id)) return;
    const now = Date.now();
    if (now - info.t0 > 1000) { info.t0 = now; info.n = 0; }
    if (++info.n > KICK_PER_SEC) { try { info.ws.close(1008, 'too many messages'); } catch (e) {} this.drop(id); return; }
    if (info.n > MSG_PER_SEC) return;
    if (typeof data !== 'string' || data.length > MAX_MSG_BYTES) return;
    let d;
    try { d = JSON.parse(data); } catch (e) { return; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    E.applyInput(this.world, id, d);
  }

  drop(id) {
    if (!this.socks.delete(id)) return;
    if (this.world) delete this.world.players[id];
    if (!this.socks.size) this.stop();
  }

  start() {
    if (this.loop) return;
    this.last = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  // nobody left: stop ticking and forget the room, so an empty room costs nothing
  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.world = null;
    this.outEv = [];
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const w = this.world;
    if (!w || !dt) return;
    E.simulate(w, dt);
    for (const e of w.ev) this.outEv.push(e);
    w.ev.length = 0;
    if (this.outEv.length > 400) this.outEv.splice(0, this.outEv.length - 400);
    this.snapT += dt; this.rosterT += dt;
    if (this.snapT < SNAP_EVERY) return;
    this.snapT = Math.min(this.snapT - SNAP_EVERY, SNAP_EVERY);
    const withRoster = this.rosterT >= 1;
    if (withRoster) this.rosterT = 0;
    const msg = JSON.stringify(E.snapshot(w, this.outEv, this.socks.size, withRoster));
    this.outEv = [];
    for (const [id, info] of this.socks) {
      try { info.ws.send(msg); } catch (e) { this.drop(id); }
    }
  }
}
