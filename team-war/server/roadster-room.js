// Roadster Thruster Yard rooms (/roadster/room/N): a plain relay. Each player simulates their own car and sends its
// state ~15 times a second; the room keeps the latest state per player and sends everyone the full list ~15 times a second.
//   server -> player: {t:'hi', id}, {t:'full'}, {t:'all', list:[state...]}
//   player -> server: {t:'st', n, c, p:[x,y,z], q:[x,y,z,w], b, r, s, w, k}
const MAX_PLAYERS = 12;
const SEND_MS = 66;
const MAX_MSG_BYTES = 400;
const MSG_PER_SEC = 30;
const KICK_PER_SEC = 150;

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const arr = (v, n) => (Array.isArray(v) && v.length === n ? v.map((x) => Math.round(num(x) * 10000) / 10000) : new Array(n).fill(0));
function clean(d, id) {
  return {
    t: 'st', id, n: String(d.n || 'Driver').slice(0, 14), c: clamp(num(d.c) | 0, 0, 7),
    p: arr(d.p, 3).map((x) => clamp(x, -2000, 2000)), q: arr(d.q, 4), b: clamp(num(d.b), 0, 1), r: d.r ? 1 : 0,
    s: clamp(num(d.s), -1, 1), w: num(d.w) % 1000, k: clamp(num(d.k) | 0, -1e7, 1e7),
  };
}

export class RoadsterRoom {
  constructor(state) {
    this.state = state;
    this.socks = new Map();   // id -> { ws, n, t0, st }
    this.loop = null;
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
    const id = 'r' + (++this.seq) + Math.random().toString(36).slice(2, 6);
    const info = { ws, n: 0, t0: Date.now(), st: null };
    this.socks.set(id, info);
    ws.send(JSON.stringify({ t: 'hi', id }));
    ws.addEventListener('message', (ev) => this.onMessage(id, info, ev.data));
    const gone = () => this.drop(id);
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
    if (!this.loop) this.loop = setInterval(() => this.tick(), SEND_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(id, info, data) {
    if (!this.socks.has(id)) return;
    const now = Date.now();
    if (now - info.t0 > 1000) { info.t0 = now; info.n = 0; }
    if (++info.n > KICK_PER_SEC) { try { info.ws.close(1008, 'too many messages'); } catch (e) {} this.drop(id); return; }
    if (info.n > MSG_PER_SEC || typeof data !== 'string' || data.length > MAX_MSG_BYTES) return;
    let d;
    try { d = JSON.parse(data); } catch (e) { return; }
    if (d && d.t === 'st') info.st = clean(d, id);
  }

  drop(id) {
    if (!this.socks.delete(id)) return;
    if (!this.socks.size && this.loop) { clearInterval(this.loop); this.loop = null; }
  }

  tick() {
    const list = [];
    for (const info of this.socks.values()) if (info.st) list.push(info.st);
    const msg = JSON.stringify({ t: 'all', list, on: this.socks.size });
    for (const [id, info] of this.socks) { try { info.ws.send(msg); } catch (e) { this.drop(id); } }
  }
}
