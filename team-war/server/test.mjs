// End-to-end test of the game server. Start it first: npx wrangler dev --local   (then: node test.mjs [ws://127.0.0.1:8787])
// Uses Node's built-in WebSocket (Node 22+).
const BASE = process.argv[2] || 'ws://127.0.0.1:8787';
let room = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

function client(n) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/room/${n}`);
    const c = { ws, msgs: [], snaps: [], hi: null, full: false, closed: false, events: [] };
    c.send = (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
    c.last = () => c.snaps[c.snaps.length - 1];
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      c.msgs.push(d);
      if (d.t === 'hi') { c.hi = d.id; resolve(c); }
      if (d.t === 'full') { c.full = true; resolve(c); }
      if (d.t === 's') { c.snaps.push(d); for (const ev of d.e) c.events.push(ev); if (c.snaps.length > 400) c.snaps.shift(); }
    };
    ws.onclose = () => { c.closed = true; resolve(c); };
    ws.onerror = (e) => reject(new Error('socket error ' + (e.message || '')));
  });
}
async function until(fn, ms, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return !!fn();
}
const rosterOf = (c) => { for (let i = c.snaps.length - 1; i >= 0; i--) if (c.snaps[i].r) return c.snaps[i].r; return []; };

// 0. plain HTTP answers and bad paths are refused
{
  const http = BASE.replace(/^ws/, 'http');
  const r1 = await fetch(http + '/'); ok(r1.status === 200, 'GET / answers 200');
  const r2 = await fetch(http + '/room/1'); ok(r2.status === 426, 'GET /room/1 without upgrade -> 426 (got ' + r2.status + ')');
  const r3 = await fetch(http + '/room/99'); ok(r3.status === 404, 'room 99 does not exist -> 404 (got ' + r3.status + ')');
}

// 1. two players on opposite teams, snapshots, aim + send
room = 2;
const a = await client(room), b = await client(room);
ok(a.hi && b.hi && a.hi !== b.hi, `both got hi with distinct ids (${a.hi}, ${b.hi})`);
a.send({ t: 'join', name: 'Alice<script>!!', team: 'human' });
b.send({ t: 'join', name: 'Bob', team: 'ai' });
await until(() => rosterOf(a).length === 2 && rosterOf(b).length === 2, 3000);
const r = rosterOf(a);
ok(r.length === 2, 'roster lists both players: ' + JSON.stringify(r));
ok(r.some((p) => p[1] === 'Alicescript' && p[2] === 'human'), 'name is cleaned and team is human');
ok(r.some((p) => p[1] === 'Bob' && p[2] === 'ai'), 'Bob is on team AI');
{
  const n0 = a.snaps.length; await sleep(1000); const rate = a.snaps.length - n0;
  ok(rate >= 7 && rate <= 13, `about 10 snapshots a second (got ${rate})`);
  const s = a.last();
  ok(s.n === 2 && s.tw.length === 2 && Array.isArray(s.m) && Array.isArray(s.b) && s.ph === 'play', 'snapshot shape: n=2, towers, fighters, bullets, phase play');
  ok(s.m.length > 0, `fighters are walking (${s.m.length})`);
}
// aim and shoot at the middle: bullets with Alice's id appear in hit events
a.send({ t: 'a', d: 1, u: 700, v: 450 });
await until(() => a.last().b.some((x) => x[4] === 0), 2000);
ok(a.last().b.some((x) => x[4] === 0), 'Alice holding fire -> Team Human bullets in snapshots');
a.send({ t: 'send' });
await until(() => a.events.some((e) => e[0] === 'g' && e[2] === a.hi), 2000);
ok(a.events.some((e) => e[0] === 'g' && e[2] === a.hi), 'Alice sent fighters (g event with her id)');
await until(() => rosterOf(a).some((p) => p[0] === a.hi && p[4] === 3), 2500);
ok(rosterOf(a).some((p) => p[0] === a.hi && p[4] === 3), 'roster shows Alice sent 3');
// send again immediately: cooldown blocks it
const g0 = a.events.filter((e) => e[0] === 'g' && e[2] === a.hi).length;
a.send({ t: 'send' }); await sleep(600);
ok(a.events.filter((e) => e[0] === 'g' && e[2] === a.hi).length === g0, 'second send within 3.5 s cooldown is ignored');
await until(() => a.events.some((e) => e[0] === 'h' && e[4] === a.hi), 5000);
ok(a.events.some((e) => e[0] === 'h' && e[4] === a.hi), "Alice's bullets hit fighters (h events with her id)");
// switch team
b.send({ t: 'team', team: 'human' });
await until(() => rosterOf(a).some((p) => p[0] === b.hi && p[2] === 'human'), 2500);
ok(rosterOf(a).some((p) => p[0] === b.hi && p[2] === 'human'), 'Bob switched to Team Human');
b.send({ t: 'team', team: 'ai' });

// 2. bad input is clamped or ignored, server keeps running
a.send({ t: 'a', d: 1, u: 1e9, v: -1e9 });
a.send({ t: 'a', d: 1, u: 'NaN', v: null });
a.send('not json');
a.send(JSON.stringify({ t: 'join', name: 'x'.repeat(2000), team: 'ai' }));  // over 512 bytes: dropped
a.send({ t: 'team', team: 'robots' });                                      // unknown team -> human
a.send([1, 2, 3]);
a.send({ t: 'a', d: 1, u: 1e9, v: -1e9 });
await sleep(400);
{
  // bullets aimed at a clamped point (1600, 0) fly up and to the right: du > 0, dv < 0
  const human = a.last().b.filter((x) => x[4] === 0 && x[0] < 400);
  ok(human.length > 0 && human.every((x) => Math.hypot(x[2], x[3]) <= 1151 && x[2] > 0 && x[3] < 0), 'out-of-range aim is clamped to the field (bullet speed still 1150, heading to the corner)');
  await until(() => rosterOf(a).some((p) => p[0] === a.hi && p[2] === 'human'), 1500);
  ok(rosterOf(a).find((p) => p[0] === a.hi)?.[2] === 'human', "oversized join was dropped and unknown team 'robots' became human");
  ok(rosterOf(a).find((p) => p[0] === a.hi)?.[1] === 'Alicescript', 'name unchanged by the dropped oversized message');
}
a.send({ t: 'a', d: 0, u: 800, v: 450 });

// 3. rate limit: a flood of 150 sends in one go is mostly ignored, 250 gets the socket closed
{
  const c = await client(room);
  c.send({ t: 'join', name: 'Flood', team: 'ai' });
  await sleep(300);
  for (let i = 0; i < 150; i++) c.send({ t: 'team', team: i % 2 ? 'ai' : 'human' });
  await sleep(300);
  ok(!c.closed, 'socket survives 150 messages in a second (extra ones ignored)');
  await sleep(1100);
  for (let i = 0; i < 250; i++) c.send({ t: 'a', d: 0, u: 1, v: 1 });
  await until(() => c.closed, 2000);
  ok(c.closed, 'socket sending 250 messages in a second is closed');
  await until(() => !rosterOf(a).some((p) => p[0] === c.hi), 2500);
  ok(!rosterOf(a).some((p) => p[0] === c.hi), 'kicked socket is removed from the roster');
}

// 4. disconnect handling
b.ws.close();
await until(() => a.last().n === 1 && rosterOf(a).length === 1, 3000);
ok(a.last().n === 1, 'after Bob leaves, online count is 1');
ok(rosterOf(a).length === 1 && rosterOf(a)[0][0] === a.hi, 'Bob removed from the roster');

// 5. a round ends and the next one starts by itself. Alice (human) stands still, Team AI is all bots and attacks.
{
  const t0 = Date.now();
  const ended = await until(() => a.last().ph === 'break', 100000, 200);
  const s = a.last();
  ok(ended, `round ended after ${((Date.now() - t0) / 1000).toFixed(1)} s: result ${JSON.stringify(s.res)}, wins ${JSON.stringify(s.w)}`);
  ok(a.events.some((e) => e[0] === 'e'), 'end-of-round event sent');
  const restarted = await until(() => a.last().ph === 'play' && a.last().tm < 2, 12000, 100);
  ok(restarted, 'next round started by itself after the break; towers full: ' + JSON.stringify(a.last().tw));
  ok(a.last().w[0] + a.last().w[1] >= (s.res.win ? 1 : 0), 'wins kept across rounds: ' + JSON.stringify(a.last().w));
}
a.ws.close();

// 6. room cap: 40 sockets fit, the 41st is told the room is full
{
  room = 3;
  const many = [];
  for (let i = 0; i < 40; i++) many.push(await client(room));
  ok(many.every((c) => c.hi), '40 players connected to one room');
  const extra = await client(room);
  ok(extra.full, '41st player gets {t:"full"}');
  await until(() => extra.closed, 2000);
  ok(extra.closed, 'and its socket is closed');
  const other = await client(room + 1);
  ok(!!other.hi, 'next room still accepts players');
  other.ws.close();
  many[0].ws.close();
  await sleep(500);
  const again = await client(room);
  ok(!!again.hi, 'after one leaves, a new player fits in the room again');
  for (const c of many) c.ws.close();
  again.ws.close();
}

// 7. empty room resets: a newcomer gets a fresh round
{
  await sleep(500);
  const c = await client(2);
  await until(() => c.snaps.length > 0, 2000);
  ok(c.snaps[0].tm < 1 && c.snaps[0].w[0] + c.snaps[0].w[1] === 0, 'empty room was cleared: newcomer starts a fresh round (t=' + c.snaps[0].tm + ')');
  c.ws.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
