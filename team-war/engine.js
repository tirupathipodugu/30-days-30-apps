// Human vs AI: the game rules. Shared by the page (offline / PeerJS host) and the game server (server/worker.js).
// Plain script: it puts everything on globalThis.HVAEngine, so it works from a <script> tag and from `import '../engine.js'`.
(function () {
  const U = 1600, V = 900;                 // world: u = along the lane, v = across
  const TEAMS = ['human', 'ai'];           // side 0 = Team Human (left, u=210), side 1 = Team AI (right, u=1390)
  const SIDE = { human: 0, ai: 1 };
  const SKINS = 5;
  const TYPES = [
    { r: 15, hp: 20, spd: 135, dmg: 18 },   // quick
    { r: 21, hp: 45, spd: 85, dmg: 35 },    // normal
    { r: 31, hp: 150, spd: 52, dmg: 90 },   // big
  ];
  const BREAK = 8, SEND_CD = 3.5;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const other = (t) => (t === 'human' ? 'ai' : 'human');

  function cleanName(s) {
    const n = String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
    return n || 'Player' + String(100 + ((Math.random() * 900) | 0));
  }
  function newWorld() {
    const w = {
      t: 0, dur: 90, phase: 'play', breakT: 0, result: null, nid: 1,
      towers: [
        { u: 210, v: 450, hp: 1000, max: 1000, shake: 0, team: 'human' },
        { u: 1390, v: 450, hp: 1000, max: 1000, shake: 0, team: 'ai' },
      ],
      mins: [], bullets: [], wins: { human: 0, ai: 0 }, players: {}, ev: [], teams: [],
    };
    resetRound(w);
    return w;
  }
  function resetRound(w) {
    w.t = 0; w.phase = 'play'; w.breakT = 0; w.result = null; w.mins = []; w.bullets = [];
    for (const t of w.towers) { t.hp = t.max; t.shake = 0; }
    w.teams = [{ spawnT: 1.2, fireT: 0.5 }, { spawnT: 1.2, fireT: 0.5 }];
    for (const p of Object.values(w.players)) { p.kills = 0; p.sent = 0; p.sendCd = 0; p.fireT = 0; }
  }
  function newPlayer(id, name, team) {
    return { id, name, team, kills: 0, sent: 0, sendCd: 0, fireT: 0, down: false, u: 800, v: 450 };
  }
  function spawn(w, side, kind) {
    const tw = w.towers[side], k = TYPES[kind];
    const dir = side === 0 ? 1 : -1;
    const m = {
      id: w.nid++, side, dir, kind, r: k.r, hp: k.hp, max: k.hp, spd: k.spd * (0.9 + Math.random() * 0.2), dmg: k.dmg,
      u: tw.u + dir * 80, base: 450 + (Math.random() - 0.5) * 560, v: 450,
      ph: Math.random() * 6.28, wf: 2 + Math.random() * 2, amp: 18 + Math.random() * 26,
      sk: (Math.random() * SKINS) | 0, hit: 0,
    };
    m.v = m.base;
    w.mins.push(m);
  }
  function waveKind(w) {
    const r = Math.random(), p = w.t / w.dur;
    if (r < 0.08 + p * 0.18) return 2;
    if (r < 0.45) return 0;
    return 1;
  }
  function fire(w, side, fu, fv, tu, tv, speed, dmg, own) {
    const a = Math.atan2(tv - fv, tu - fu);
    w.bullets.push({ u: fu, v: fv, du: Math.cos(a) * speed, dv: Math.sin(a) * speed, side, life: 1.4, dmg, own });
  }
  function nearest(w, side, u, v, range) {
    let best = null, bd = range * range;
    for (const m of w.mins) {
      if (m.side !== side) continue;
      const d = (m.u - u) ** 2 + (m.v - v) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function playerSend(w, p) {
    if (!p || w.phase !== 'play' || p.sendCd > 0) return;
    const side = SIDE[p.team];
    for (let i = 0; i < 3; i++) spawn(w, side, i === 2 ? 2 : 1);
    p.sent += 3; p.sendCd = SEND_CD;
    w.ev.push(['g', side, p.id, p.name]);
  }

  function simulate(w, dt) {
    if (w.phase === 'break') { w.breakT -= dt; if (w.breakT <= 0) resetRound(w); return; }
    w.t += dt;
    const players = Object.values(w.players);
    const count = [0, 0];
    for (const p of players) count[SIDE[p.team]]++;
    for (let s = 0; s < 2; s++) {
      const tw = w.towers[s], tm = w.teams[s], dir = s === 0 ? 1 : -1;
      // a team with people gets slow helper spawns; an empty team is all bots and sends waves that speed up
      tm.spawnT -= dt;
      if (tm.spawnT <= 0) {
        if (count[s]) { spawn(w, s, Math.random() < 0.3 ? 0 : 1); tm.spawnT = 2.2 + Math.random() * 1.4; }
        else { spawn(w, s, waveKind(w)); tm.spawnT = Math.max(0.3, 1.25 - w.t * 0.011) * (0.7 + Math.random() * 0.6); }
      }
      // bot shooters guard the tower (weak when people are defending it)
      tm.fireT -= dt;
      if (tm.fireT <= 0) {
        const tgt = nearest(w, 1 - s, tw.u, tw.v, count[s] ? 360 : 560);
        if (tgt) fire(w, s, tw.u + dir * 30, tw.v - 70, tgt.u, tgt.v, 900, count[s] ? 8 : 12, null);
        tm.fireT = count[s] ? 0.65 : Math.max(0.2, 0.3 - w.t * 0.001);
      }
    }
    // every player shoots from their own tower while holding
    for (const p of players) {
      p.sendCd = Math.max(0, p.sendCd - dt);
      const s = SIDE[p.team], tw = w.towers[s], dir = s === 0 ? 1 : -1;
      if (p.down) {
        p.fireT -= dt;
        while (p.fireT <= 0) { fire(w, s, tw.u + dir * 30, tw.v - 70, p.u, p.v, 1150, 10, p.id); p.fireT += 0.1; }
      } else p.fireT = 0;
    }
    // fighters walk, wobble and close in on the tower
    for (const m of w.mins) {
      m.u += m.dir * m.spd * dt;
      m.ph += dt * m.wf;
      const ts = m.side === 0 ? 1 : 0, target = w.towers[ts];
      const left = Math.abs(target.u - m.u) / 1180;
      m.base += (450 - m.base) * Math.min(1, dt * (1.6 - left * 1.3));
      m.v = m.base + Math.sin(m.ph) * m.amp * Math.min(1, left * 1.5);
      m.hit = Math.max(0, m.hit - dt);
      if ((m.dir > 0 && m.u >= target.u - 70) || (m.dir < 0 && m.u <= target.u + 70)) {
        target.hp = Math.max(0, target.hp - m.dmg);
        target.shake = 0.35;
        w.ev.push(['t', ts, Math.round(m.u), Math.round(m.v), m.dmg, m.side]);
        m.hp = 0;
      }
    }
    // fighters from both sides crash into each other
    for (let i = 0; i < w.mins.length; i++) {
      const a = w.mins[i]; if (a.hp <= 0) continue;
      for (let j = i + 1; j < w.mins.length; j++) {
        const b = w.mins[j]; if (b.hp <= 0 || a.side === b.side) continue;
        const rr = a.r + b.r;
        if ((a.u - b.u) ** 2 + (a.v - b.v) ** 2 < rr * rr) {
          const d = Math.min(a.hp, b.hp); a.hp -= d; b.hp -= d;
          w.ev.push(['c', Math.round((a.u + b.u) / 2), Math.round((a.v + b.v) / 2)]);
          if (a.hp <= 0) break;
        }
      }
    }
    // bullets
    for (const b of w.bullets) {
      b.u += b.du * dt; b.v += b.dv * dt; b.life -= dt;
      if (b.u < -50 || b.u > U + 50 || b.v < -50 || b.v > V + 50) b.life = 0;
      if (b.life <= 0) continue;
      for (const m of w.mins) {
        if (m.side === b.side || m.hp <= 0) continue;
        const rr = m.r + 7;
        if ((m.u - b.u) ** 2 + (m.v - b.v) ** 2 < rr * rr) {
          m.hp -= b.dmg; m.hit = 0.12; b.life = 0;
          if (m.hp <= 0) {
            const p = b.own && w.players[b.own];
            if (p) p.kills++;
            w.ev.push(['k', Math.round(m.u), Math.round(m.v), m.side]);
          }
          w.ev.push(['h', Math.round(m.u), Math.round(m.v - m.r - 10), b.dmg, b.own, m.hp <= 0 ? 1 : 0]);
          break;
        }
      }
    }
    w.bullets = w.bullets.filter((b) => b.life > 0);
    w.mins = w.mins.filter((m) => m.hp > 0);
    for (const t of w.towers) t.shake = Math.max(0, t.shake - dt);
    // round over? then a short break and the next round starts by itself
    const [h, a] = w.towers;
    if (h.hp <= 0 || a.hp <= 0 || w.t >= w.dur) {
      const ph = h.hp / h.max, pa = a.hp / a.max;
      const winner = ph > pa ? 'human' : pa > ph ? 'ai' : '';
      if (winner) w.wins[winner]++;
      w.result = { win: winner, why: (h.hp <= 0 || a.hp <= 0) ? 'ko' : 'time' };
      w.phase = 'break'; w.breakT = BREAK;
      for (const p of players) p.down = false;
      w.ev.push(['e', winner]);
    }
  }

  // one message from a remote player (PeerJS client or WebSocket). Everything is checked and clamped here.
  function applyInput(w, id, d) {
    if (!w || !d || typeof d !== 'object') return;
    const p = w.players[id];
    if (d.t === 'join' || d.t === 'team') {
      const team = d.team === 'ai' ? 'ai' : 'human';
      if (!p) w.players[id] = newPlayer(id, cleanName(d.name), team);
      else { p.team = team; p.down = false; if (d.t === 'join') p.name = cleanName(d.name); }
    } else if (!p) return;
    else if (d.t === 'a') {
      p.down = !!d.d && w.phase === 'play';
      const u = Number(d.u), v = Number(d.v);
      p.u = clamp(Number.isFinite(u) ? u : 800, 0, U); p.v = clamp(Number.isFinite(v) ? v : 450, 0, V);
    } else if (d.t === 'send') playerSend(w, p);
  }

  function rosterOf(w) { return Object.values(w.players).map((p) => [p.id, p.name, p.team, p.kills, p.sent]); }
  // the compact snapshot every viewer draws from (~10 per second)
  function snapshot(w, events, online, withRoster) {
    const s = {
      t: 's', tm: +w.t.toFixed(2), ph: w.phase, bk: +w.breakT.toFixed(1), res: w.result, n: online,
      w: [w.wins.human, w.wins.ai],
      tw: w.towers.map((t) => [Math.round(t.hp), +t.shake.toFixed(2)]),
      m: w.mins.map((m) => [m.id, m.side, m.kind, Math.round(m.u), Math.round(m.v), Math.round(m.hp), m.max, +m.ph.toFixed(2), m.sk, m.hit > 0 ? 1 : 0]),
      b: w.bullets.map((b) => [Math.round(b.u), Math.round(b.v), Math.round(b.du), Math.round(b.dv), b.side]),
      e: events.slice(-200),
    };
    if (withRoster) s.r = rosterOf(w);
    return s;
  }

  globalThis.HVAEngine = {
    U, V, TEAMS, SIDE, TYPES, BREAK, SEND_CD, clamp, other, cleanName, newWorld, resetRound, newPlayer,
    playerSend, simulate, applyInput, rosterOf, snapshot,
  };
})();
