// End-to-end test of the Human vs AI 2.0 rooms (/v2/room/N). Uses Node's built-in WebSocket (Node 22+).
// Start the server with the test switch first (it lets the test fast-forward the match clock):
//   npx wrangler dev --local --var V2_TEST:1
//   node test-v2.mjs [ws://127.0.0.1:8787]
// Against the deployed server (no test switch there) the checks that need it are skipped and rooms 18-20 are used:
//   node test-v2.mjs wss://human-vs-ai.tirupathi-podugu.workers.dev
const BASE = process.argv[2] || 'ws://127.0.0.1:8787';
const LIVE = !/127\.0\.0\.1|localhost/.test(BASE);
const R = LIVE ? { a: 18, cap: 19, flood: 20, prop: 17 } : { a: 2, cap: 5, flood: 6, prop: 7 };
const sideTotals = (r) => { const h = r.p.filter((p) => p[2] === 0), a = r.p.filter((p) => p[2] === 1); return { h: h.length, a: a.length, hb: h.filter((p) => p[6]).length, ab: a.filter((p) => p[6]).length }; };
const skip = (msg) => console.log('SKIP ' + msg + ' (needs the local test switch)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else fails++; };

function client(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/v2/room/${room}`);
    const c = { ws, snaps: [], rosters: [], events: [], hi: null, full: 0, afk: false, closed: false, joined: null, seq: 0 };
    c.send = (m) => { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
    c.last = () => c.snaps[c.snaps.length - 1];
    c.me = () => (c.last() || {}).me;
    c.roster = () => c.rosters[c.rosters.length - 1];
    c.hero = (id) => { const s = c.last(); return s && s.h.find((h) => h[0] === id); };
    c.input = (o) => c.send({ t: 'i', s: ++c.seq, mx: 0, mz: 0, a: 0, f: 0, ...o });
    c.dbg = (o) => c.send({ t: 'dbg', ...o });
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.t === 'hi') { c.hi = d.id; resolve(c); }
      else if (d.t === 'full') { c.full++; resolve(c); }
      else if (d.t === 'joined') c.joined = d;
      else if (d.t === 'afk') c.afk = true;
      else if (d.t === 'r') c.rosters.push(d);
      else if (d.t === 's') { c.snaps.push(d); for (const ev of d.e) c.events.push(ev); if (c.snaps.length > 300) c.snaps.shift(); }
    };
    ws.onclose = () => { c.closed = true; resolve(c); };
    ws.onerror = (e) => reject(new Error('socket error ' + (e.message || '')));
  });
}
async function until(fn, ms, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return !!fn();
}
const close = (...cs) => { for (const c of cs) try { c.ws.close(); } catch (e) {} };

// 0. HTTP: v2 route exists, v1 still answers
{
  const http = BASE.replace(/^ws/, 'http');
  const r1 = await fetch(http + '/v2/room/1'); ok(r1.status === 426, 'GET /v2/room/1 without upgrade -> 426 (got ' + r1.status + ')');
  const r2 = await fetch(http + '/v2/room/21'); ok(r2.status === 404, '/v2/room/21 does not exist -> 404 (got ' + r2.status + ')');
  const r3 = await fetch(http + '/room/1'); ok(r3.status === 426, 'v1 /room/1 still routed (426)');
}

// 1. spectators get the roster; two players join opposite teams; names are cleaned; no bots (1 v 1)
const A = await client(R.a), B = await client(R.a);
ok(A.hi && B.hi && A.hi !== B.hi, 'both got hi with distinct ids');
await until(() => A.rosters.length > 0, 2000);
ok(A.rosters.length > 0 && A.snaps.length === 0, 'before joining: roster yes, snapshots no (spectator)');
A.send({ t: 'join', name: 'Asha<script>!!', team: 'human' });
B.send({ t: 'join', name: 'Ravi', team: 'ai' });
await until(() => A.me() && B.me(), 3000);
ok(A.me() && A.me().side === 'human' && B.me() && B.me().side === 'ai', 'joined opposite teams (me.side human / ai)');
await until(() => { const r = A.roster(); return r && r.p.length === 2; }, 3000);
{
  const r = A.roster();
  ok(r.n === 2, 'roster counts 2 real players (n=' + r.n + ')');
  ok(r.p.some((p) => p[1] === 'Ashascript' && p[2] === 0), 'name is cleaned (Ashascript) and on Team Human');
  ok(r.p.some((p) => p[1] === 'Ravi' && p[2] === 1), 'Ravi is on Team AI');
  const bots = r.p.filter((p) => p[6] === 1);
  ok(bots.length === 0 && r.p.length === 2, 'one real player each side = 1 v 1, no bots added: ' + r.p.map((p) => p[1]).join(', '));
  const n0 = A.snaps.length; await sleep(1000); const rate = A.snaps.length - n0;
  ok(rate >= 11 && rate <= 19, `about 15 snapshots a second (got ${rate})`);
  const s = A.last();
  ok(Array.isArray(s.h) && s.h.length === 2 && Array.isArray(s.u) && s.b.length === 7 && typeof s.T === 'number', 'snapshot shape: 2 heroes, units, bases, time');
  ok(A.events.some((e) => e.type === 'join' && e.name === 'Ravi' && e.side === 'ai'), 'join event for the feed: "Ravi joined Team AI"');
  ok(JSON.stringify(s).length < 12000, 'snapshot stays small (' + JSON.stringify(s).length + ' bytes)');
}

// 1b. proportional bot fill: both sides always have equal totals; bots scale with real players;
// a real joining the thin side drops a bot (works on the live server too — no test switch needed)
{
  const P = [];
  for (let i = 0; i < 3; i++) { P.push(await client(R.prop)); P[i].send({ t: 'join', name: 'Hum' + i, team: 'human' }); await sleep(120); }
  await until(() => { const r = P[0].roster(); return r && sideTotals(r).a === 3; }, 4000);
  let t = sideTotals(P[0].roster());
  ok(t.h === 3 && t.a === 3 && t.hb === 0 && t.ab === 3, `3 humans one side -> 3 bots fill the other (H ${t.h}/${t.hb}b, A ${t.a}/${t.ab}b)`);
  ok(t.h === t.a, 'both teams have equal total fighters');
  const D = await client(R.prop); D.send({ t: 'join', name: 'Deet', team: 'ai' });
  await until(() => { const r = P[0].roster(); return r && sideTotals(r).ab === 2; }, 4000);
  t = sideTotals(P[0].roster());
  ok(t.a === 3 && t.ab === 2 && t.h === 3, `a 4th real joins the thin side -> one bot drops (A now ${t.a - t.ab} real + ${t.ab} bots)`);
  ok(t.h === t.a && P[0].roster().n === 4, 'totals stay equal (3 v 3) with 4 real players; real players preferred over bots');
  close(...P, D);
  await sleep(400);
  const S = await client(R.prop); S.send({ t: 'join', name: 'Lone', team: 'human' });
  await until(() => { const r = S.roster(); return r && sideTotals(r).a === 2; }, 4000);
  t = sideTotals(S.roster());
  ok(t.h === 2 && t.a === 2 && t.hb === 1 && t.ab === 2, `solo player: padded to 2 v 2 (1 ally bot + a matched enemy side), not a swarm (${t.hb + t.ab} bots total)`);
  close(S);
}

// 2. calm the arena (no waves, no bots), then movement, clamping and firing
if (!LIVE) {
  A.dbg({ cmd: 'calm' });
  await until(() => A.roster() && A.roster().p.length === 2 && A.last().u.length === 0, 3000);
  ok(A.roster().p.length === 2 && A.last().u.length === 0, 'test switch: bots and minions cleared');
}
A.dbg({ cmd: 'place', x: 0, z: 0 }); B.dbg({ cmd: 'place', x: 0, z: 12 });
await sleep(200);
{
  const a0 = A.me();
  for (let i = 0; i < 20; i++) { A.input({ mx: 100, mz: 0, a: Math.PI / 2 }); await sleep(50); }
  await sleep(150);
  const a1 = A.me();
  const moved = a1.x - a0.x;
  ok(moved > 4, `input moves the hero (+x by ${moved.toFixed(1)})`);
  ok(moved < 8.6 * 1.25 * 1.3, `move vector is clamped to length 1 (moved ${moved.toFixed(1)} in ~1.15 s)`);
  ok(a1.ack === A.seq, `server acks the last input sequence (${a1.ack})`);
  A.input({ mx: 0, mz: 0, a: 1e9 });
  await sleep(150);
  ok(Number.isFinite(A.hero(A.me().id)[4]), 'absurd aim angle is clamped (aim stays finite)');
  // oversized messages are dropped
  const before = A.me().x;
  A.send(JSON.stringify({ t: 'i', s: ++A.seq, mx: 1, mz: 0, a: 0, pad: 'x'.repeat(400) }));
  await sleep(400);
  ok(Math.abs(A.me().x - before) < 0.3, 'oversized message ignored (hero did not move)');
}

// 3. PvP: Asha shoots Ravi until he goes down; kill credit; respawn after 4 s
if (LIVE) skip('sections 3-5: PvP kill, level-up cards, match end');
else {
  A.dbg({ cmd: 'place', x: 0, z: 0 }); B.dbg({ cmd: 'place', x: 0, z: 9 });
  A.events.length = 0;
  const ravi = B.me().id, asha = A.me().id;
  let down = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 9000 && !down) {
    A.input({ a: 0, f: 1 }); B.input({ a: Math.PI });
    B.dbg({ cmd: 'place', x: 0, z: 9 });
    await sleep(50);
    down = A.events.some((e) => e.type === 'heroKill' && e.id === ravi);
  }
  A.input({ f: 0 });
  ok(A.events.some((e) => e.type === 'shot' && e.id === asha), 'fire input makes shots (shot events with Asha\'s hero id)');
  ok(A.events.some((e) => e.type === 'heroHurt' && e.id === ravi && e.by === asha), 'Ravi is hurt by Asha (PvP damage)');
  const kill = A.events.find((e) => e.type === 'heroKill' && e.id === ravi);
  ok(!!kill && kill.k === asha && kill.kn === 'Ashascript' && kill.name === 'Ravi', 'kill credited: "Ashascript took down Ravi"');
  await until(() => { const r = A.roster(); return r && r.p.find((p) => p[0] === asha)[3] === 1; }, 2000);
  const ra = A.roster().p;
  ok(ra.find((p) => p[0] === asha)[3] === 1 && ra.find((p) => p[0] === ravi)[4] === 1, 'roster: Asha 1 kill, Ravi 1 death');
  const h = A.hero(ravi);
  ok(h && (h[7] & 1) === 1 && h[9] > 3, `Ravi is down with a respawn timer (${h && h[9]} s)`);
  const tDown = Date.now();
  await until(() => B.events.some((e) => e.type === 'heroRespawn' && e.id === ravi), 6000);
  const took = (Date.now() - tDown) / 1000;
  ok(B.events.some((e) => e.type === 'heroRespawn' && e.id === ravi) && took > 2.5 && took < 5, `Ravi respawned about 4 s later (${took.toFixed(1)} s after we saw him down)`);
  ok(A.me().xp > 0 || A.me().lv > 1, 'Asha earned XP for the kill');
}

// 4. level-up cards: offer, pick with a message, auto-pick after 10 s, game never pauses
if (!LIVE) {
  const lv0 = A.me().lv;
  A.dbg({ cmd: 'xp', v: 400 });
  await until(() => A.me().o, 2000);
  const me = A.me();
  ok(me.lv > lv0 && Array.isArray(me.o) && me.o.length === 3, `level-up offers 3 cards (level ${me.lv}, cards ${me.o && me.o.map((o) => o[0]).join(',')})`);
  ok(me.pend >= 1, `more level-ups are queued (${me.pend})`);
  const T0 = A.last().T;
  const choice = me.o[1][0];
  A.send({ t: 'pick', i: 1 });
  await until(() => A.me().pk.includes(choice), 2000);
  ok(A.me().pk.includes(choice), 'pick 2 applied: ' + choice);
  ok(A.last().T > T0, 'match clock keeps running while cards are shown (no pause)');
  A.send({ t: 'pick', i: 7 });
  await sleep(200);
  ok(A.me().pk.length === 1, 'invalid card index ignored');
  const n = A.me().pk.length;
  const ok2 = await until(() => A.me().pk.length > n, 12500, 200);
  ok(ok2, 'an unpicked offer auto-picks after 10 s');
}

// 5. match end by base, scoreboard, then a new match starts by itself
if (!LIVE) {
  A.events.length = 0;
  A.dbg({ cmd: 'base', side: 'ai', v: 5 });
  A.dbg({ cmd: 'place', x: 0, z: -18 });
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && !A.events.some((e) => e.type === 'matchEnd')) { A.input({ a: Math.PI, f: 1 }); A.dbg({ cmd: 'place', x: 0, z: -18 }); await sleep(60); }
  A.input({ f: 0 });
  const end = A.events.find((e) => e.type === 'matchEnd');
  ok(!!end && end.winner === 'human' && end.reason === 'base', 'shooting the server tower down ends the match: Team Human wins');
  ok(end && end.mvp && end.board.length >= 2 && end.board[0][1], 'scoreboard + MVP sent (' + (end && end.mvp && end.mvp.name) + ')');
  ok(A.last().ph === 1, 'phase is "end" while the scoreboard shows');
  const mn = A.last().mn;
  await until(() => A.last().ph === 0 && A.last().mn === mn + 1, 10000, 100);
  ok(A.last().ph === 0 && A.last().mn === mn + 1 && A.last().T < 2, 'about 8 s later a new match starts by itself (match ' + A.last().mn + ')');
  ok(A.events.some((e) => e.type === 'matchStart'), 'matchStart event');
  ok(A.me() && A.me().lv === 1 && A.me().k === 0, 'progress resets for the new match (level 1, 0 kills)');
  // time limit
  A.events.length = 0;
  A.dbg({ cmd: 'time', v: 479.5 });
  await until(() => A.events.some((e) => e.type === 'matchEnd'), 3000);
  const e2 = A.events.find((e) => e.type === 'matchEnd');
  ok(!!e2 && e2.reason === 'time', 'the 8-minute limit ends a match (winner: ' + (e2 && e2.winner) + ')');
}

// 6. leave + rejoin on the other side, then the empty room resets
{
  B.send({ t: 'leave' });
  await until(() => A.events.some((e) => e.type === 'leave' && e.name === 'Ravi'), 3000);
  ok(A.events.some((e) => e.type === 'leave' && e.name === 'Ravi'), 'leave event for the feed');
  A.dbg({ cmd: 'bots', v: 2 });
  await until(() => A.roster() && A.roster().p.filter((p) => p[6]).length === 3, 3000);
  ok(A.roster().p.filter((p) => p[6]).length === 3, 'bots refill to 2 v 2 after Ravi left (3 bots + Asha)');
  close(A, B);
  await sleep(500);
  const C = await client(R.a);
  await until(() => C.rosters.length > 0, 2000);
  ok(C.roster().n === 0 && C.roster().p.length === 0, 'empty room was reset (no players, no match)');
  C.send({ t: 'join', name: 'Mira', team: 'ai' });
  await until(() => C.me(), 3000);
  ok(C.me() && C.last().mn === 1 && C.last().T < 3, 'next player starts a fresh match 1');
  close(C);
}

// 7. room cap: 12 players can join, the 13th is told the room is full
{
  const cs = [];
  for (let i = 0; i < 13; i++) cs.push(await client(R.cap));
  for (let i = 0; i < 13; i++) { cs[i].send({ t: 'join', name: 'P' + i, team: i % 2 ? 'ai' : 'human' }); await sleep(30); }
  await until(() => cs[12].full > 0 && cs.slice(0, 12).every((c) => c.me()), 4000);
  ok(cs.slice(0, 12).every((c) => c.me()), `12 players joined room ${R.cap}`);
  ok(cs[12].full > 0 && !cs[12].me(), 'the 13th gets {t:"full"} (the page then tries the next room)');
  const r = cs[0].roster();
  ok(r.n === 12 && r.p.length === 12 && r.p.filter((p) => p[2] === 0).length === 6 && !r.p.some((p) => p[6]), '6 v 6 real players, no bots needed');
  close(...cs);
}

// 8. floods are cut off
{
  const F = await client(R.flood);
  F.send({ t: 'join', name: 'Flood', team: 'human' });
  await until(() => F.me(), 3000);
  for (let i = 0; i < 400; i++) F.send({ t: 'i', s: i, mx: 1, mz: 0, a: 0 });
  await until(() => F.closed, 3000);
  ok(F.closed, 'a client sending 400 messages at once is disconnected');
  const G = await client(R.flood);
  await until(() => G.rosters.length, 2000);
  ok(G.roster().n === 0, 'the flooder was removed from the match');
  close(G);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
