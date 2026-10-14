// A simple bot that plays the hero. Used for the menu demo, balance tests and the test hook.
// skill 0..1: aim jitter, reaction to boss slams and how well it uses abilities.
import { baseZ, fwd, KINDS } from './config.js';

export function makeBot(skill = 0.7, rand = Math.random) {
  const mem = { strafe: 1, strafeT: 0, jitter: 0, jitterT: 0, abilityT: 0, tgt: null, tgtT: 0, lane: (rand() - 0.5) * 18 };
  return function botInput(g, dt = 1 / 60) {
    const h = g.hero;
    const inp = { mx: 0, mz: 0, ax: 0, az: 0, fire: false, dash: false, q: false, e: false, r: false, aimDist: 9 };
    if (h.dead || g.phase === 'upgrade') return inp;
    const myBase = g.bases[g.team];
    const F = fwd(g.team);
    let tgt = null, best = 1e9, near = 0, nearest = 1e9;
    mem.tgtT -= dt;
    for (const u of g.units) {
      if (u.side !== g.foe || u.dead) continue;
      const d = Math.hypot(u.x - h.x, u.z - h.z);
      const toBase = Math.hypot(u.x - myBase.x, u.z - myBase.z);
      // prefer close enemies, and enemies close to our base
      const s = d + Math.min(toBase, 30) * 0.5 - (u.kind === 'shooter' ? 3 : 0) + (u.kind === 'boss' ? -4 : 0);
      if (d < 22 && s < best) { best = s; tgt = u; }
      if (d < 9) near++;
      if (d < nearest) nearest = d;
    }
    // multiplayer arena: enemy heroes are targets too (and the most important ones)
    if (g.heroes) for (const o of g.heroes) {
      if (o.side !== g.foe || o.dead) continue;
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      const s = d - 5;
      if (d < 22 && s < best) { best = s; tgt = o; }
      if (d < 9) near++;
      if (d < nearest) nearest = d;
    }
    // humans take a moment to switch targets
    if (mem.tgt && !mem.tgt.dead && mem.tgtT > 0 && Math.hypot(mem.tgt.x - h.x, mem.tgt.z - h.z) < 24) tgt = mem.tgt;
    else { mem.tgt = tgt; mem.tgtT = 0.15 + (1 - skill) * 0.5; }
    // aim
    mem.jitterT -= dt;
    if (mem.jitterT <= 0) { mem.jitterT = 0.25; mem.jitter = (rand() - 0.5) * 0.5 * (1 - skill); }
    if (tgt) {
      const d = Math.hypot(tgt.x - h.x, tgt.z - h.z);
      const lead = (d / 44) * skill;
      const tx = tgt.x + tgt.vx * lead, tz = tgt.z + tgt.vz * lead;
      const a = Math.atan2(tx - h.x, tz - h.z) + mem.jitter;
      inp.ax = Math.sin(a); inp.az = Math.cos(a); inp.fire = d < 24; inp.aimDist = d;
    } else { inp.ax = 0; inp.az = F; }

    // arena: with nothing to shoot, push up to the enemy base and shoot it from outside its turret range
    const eb = g.bases[g.foe];
    if (!tgt && g.arena) {
      const d = Math.hypot(eb.x - h.x, eb.z - h.z);
      const a = Math.atan2(eb.x - h.x, eb.z - h.z) + mem.jitter;
      inp.ax = Math.sin(a); inp.az = Math.cos(a); inp.fire = d < 20; inp.aimDist = d;
    }
    // movement: hold a line in front of our base, keep some distance from the closest enemy
    let gx = tgt ? tgt.x * 0.6 : 0;
    let gz = baseZ(g.team) + F * 12;
    if (g.arena && !tgt) { gx = mem.lane; gz = eb.z - F * 16.5; }
    if (tgt) {
      const keep = tgt.type === 'hero' ? 9 : tgt.kind === 'boss' ? 10 : KINDS[tgt.kind].ranged ? 8 : 7.5;
      const dx = h.x - tgt.x, dz = h.z - tgt.z, d = Math.hypot(dx, dz) || 1;
      gx = tgt.x + (dx / d) * keep; gz = tgt.z + (dz / d) * keep;
      // never wander too far from our base when enemies are around
      const lim = baseZ(g.team) + F * (g.arena ? 44 : 26);
      if ((gz - lim) * F > 0) gz = lim;
    }
    // arena: badly hurt, fall back towards our base (the turret covers us)
    if (g.arena && h.hp < h.max * 0.3) { gx = mem.lane * 0.5; gz = baseZ(g.team) + F * 8; }
    // pickups nearby are worth a detour
    for (const p of g.pickups) if (Math.hypot(p.x - h.x, p.z - h.z) < 9) { gx = p.x; gz = p.z; }
    let mx = gx - h.x, mz = gz - h.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.8) { mx /= ml; mz /= ml; } else { mx = 0; mz = 0; }
    mem.strafeT -= dt;
    if (mem.strafeT <= 0) { mem.strafeT = 0.8 + rand(); mem.strafe = rand() < 0.5 ? -1 : 1; }
    if (tgt) { mx += -inp.az * mem.strafe * 0.5; mz += inp.ax * mem.strafe * 0.5; }
    // dodge telegraphed slams and incoming orbs (skill-dependent)
    let danger = false;
    for (const s of g.slams) {
      if (s.side !== g.foe) continue;
      const dx = h.x - s.x, dz = h.z - s.z, d = Math.hypot(dx, dz) || 1;
      if (d < s.r + 1.2 && rand() < 0.35 + skill * 0.65) { mx = dx / d * 2; mz = dz / d * 2; danger = d < s.r && s.t < 0.5; }
    }
    if (rand() < skill - 0.3) for (const s of g.shots) {
      if (s.side !== g.foe) continue;
      const dx = h.x - s.x, dz = h.z - s.z, d = Math.hypot(dx, dz);
      if (d < 4 && dx * s.dx + dz * s.dz > 0) { mx += -s.dz * 0.8; mz += s.dx * 0.8; }
    }
    inp.mx = mx; inp.mz = mz;
    if ((danger || (h.hp < h.max * 0.35 && nearest < 2.5)) && h.dashCd <= 0) inp.dash = true;
    // abilities
    mem.abilityT -= dt;
    if (mem.abilityT <= 0) {
      mem.abilityT = 0.5;
      const bossNear = g.boss && Math.hypot(g.boss.x - h.x, g.boss.z - h.z) < 14;
      if ((near >= 4 || bossNear) && rand() < 0.25 + skill * 0.6) { inp.q = rand() < 0.7; inp.e = rand() < 0.7; inp.r = true; }
    }
    return inp;
  };
}

// Upgrade choice: the bot likes synergies, then damage and rate.
export function botPick(g, rand = Math.random) {
  if (!g.offer) return 0;
  const pref = ['multi', 'pierce', 'dmg', 'rate', 'boom', 'over', 'hp', 'leech', 'bounce', 'cdr', 'dashKill', 'speed', 'dashHit', 'repair', 'berserk', 'glass'];
  const base = g.bases[g.team];
  let bi = 0, bs = -1e9;
  g.offer.forEach((o, i) => {
    let s = 20 - pref.indexOf(o.id) + rand() * 4;
    if (o.synergy) s += 10;
    if (o.id === 'repair' && base.hp < base.max * 0.5) s += 25;
    if (s > bs) { bs = s; bi = i; }
  });
  return bi;
}
