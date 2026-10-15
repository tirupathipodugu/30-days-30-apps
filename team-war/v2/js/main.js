// Human vs AI 2.0 — wires the simulation to rendering, effects, sound and UI.
import * as THREE from 'three';
import { Game, COVER } from './sim.js';
import { TEAMS, KINDS, other, MAX_WAVE, UPG, SHOP, ULT_LEVEL, SYNERGIES, TWISTS, fwd, baseZ } from './config.js';
import { buildWorld } from './world.js';
import { Entities } from './entities.js';
import { Hero } from './hero.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI, BOSS_NAMES } from './ui.js';
import { makeBot, botPick } from './bot.js';
import * as meta from './meta.js';
import { createLook, fixedCamera } from './look.js';
import { Net, serverUrl, cleanName } from './net.js'; // multiplayer

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const coarse = matchMedia('(pointer: coarse)').matches;
const lowEnd = coarse || (navigator.hardwareConcurrency || 8) <= 4;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: lowEnd, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 2, 420);
// lighting, sky, tone mapping, post-processing and quality tiers live in look.js
const look = createLook(renderer, scene, camera, lowEnd);
let maxPR = Math.min(window.devicePixelRatio || 1, look.maxPR);
let pixelRatio = maxPR;
renderer.setPixelRatio(pixelRatio);

const world = buildWorld(scene, renderer, COVER, look.detail);
const entities = new Entities(scene);
entities.prewarm(['human', 'ai']);
const fx = new FX(scene, camera, document.getElementById('nums'), lowEnd);
const audio = new Audio();
const ui = new UI(audio);
const input = new Input(canvas, { move: document.getElementById('stickMove'), aim: document.getElementById('stickAim') });
input.enabled = true;

// ---------- state ----------
let profile = meta.loadProfile();
let mode = 'menu'; // menu | play | upgrade | paused | end
let game = null, demo = null, team = profile.lastTeam || 'human';
let heroView = null, heroKey = '';
let trail = meta.trailFor(profile, team);
let hitstop = 0, slowT = 0, slowMax = 1, endT = 0, simTime = 0, realTime = 0;
let demoBot = makeBot(0.75);
let testBot = null;
let online = null; // multiplayer: { team } while in a live match (see the "online multiplayer" section)
let lastShotT = -1, lastHitT = -1, lastBaseToast = -10, flankToastWave = 0;
const camTarget = new THREE.Vector3(0, 0, 20), camPos = new THREE.Vector3(0, 30, 40);
let camYaw = 0, camYawCur = 0;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1), hitPt = new THREE.Vector3(), ndc = new THREE.Vector2();
const turretAims = { human: null, ai: null };
let aimPoint = null;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  look.resize();
  frameCamera();
}
addEventListener('resize', resize); resize();

function setHeroView(t, skin) {
  const key = t + ':' + JSON.stringify(skin);
  if (heroKey === key && heroView) return;
  if (heroView) heroView.dispose(scene);
  heroView = new Hero(scene, t, skin);
  heroKey = key;
}

// ---------- runs ----------
function newDemo() {
  const t = Math.random() < 0.5 ? 'human' : 'ai';
  demo = new Game({ team: t, seed: (Math.random() * 1e9) | 0, perks: { ult: true } });
  demo.wave = 1 + ((Math.random() * 3) | 0);
  if (demo.wave > 1) { demo.units = []; demo.startWave(); for (let i = 0; i < demo.wave + 1; i++) demo.applyUpgrade(['multi', 'rate', 'pierce', 'dmg'][i % 4]); }
  setHeroView(t, null);
}
function startRun(t, opts = {}) {
  audio.unlock();
  team = t;
  profile = meta.loadProfile();
  profile.lastTeam = t; meta.saveProfile(profile);
  const perks = meta.perksFor(profile);
  const daily = opts.daily ? meta.dailyState(profile) : null;
  const seed = daily ? daily.seed : (Math.random() * 1e9) | 0;
  game = new Game({ team: t, seed, mod: daily ? daily.mod.id : null, perks });
  game.isDaily = !!(daily && !daily.played && !opts.practice);
  game.dailyMod = daily ? daily.mod : null;
  game.practice = !!opts.practice;
  setHeroView(t, meta.skinFor(profile, t));
  trail = meta.trailFor(profile, t);
  fx.clear(); ui.clearTransient(); ui.setTeam(t, perks.ult); input.reset();
  audio.team = t; audio.setMusic(true, 1);
  hitstop = 0; slowT = 0; endT = 0; simTime = 0; flankToastWave = 0;
  mode = 'play'; ui.show(null);
  ui.roster(null, 0, net.status === 'offline' ? 'offline' : 'solo');
  snapCamera();
  handleEvents(game, false); // headstart / intro events
  const scored = game.isDaily;
  if (daily) setTimeout(() => ui.toast(`Daily: ${daily.mod.name} — ${daily.mod.desc}${scored ? '' : ' (practice)'}`, 'syn'), 400);
  if (perks.ult && !profile.seenUlt) { profile.seenUlt = true; meta.saveProfile(profile); setTimeout(() => ui.toast(`Ultimate unlocked: ${TEAMS[t].abilities.r.name} (R)`, 'syn'), 1200); }
}
function toMenu() {
  if (online) leaveOnline();
  mode = 'menu'; game = null; endT = 0;
  profile = meta.loadProfile();
  ui.renderMenu(profile, meta.dailyState(profile));
  ui.show('menu'); ui.clearTransient(); fx.clear();
  audio.setMusic(true, 0);
  newDemo();
}
function pause(on) {
  if (on && mode === 'play') {
    mode = 'paused'; ui.renderBuild(online ? net.view : game, document.getElementById('pauseBuild')); ui.show('pause'); input.reset(); audio.setMusic(false);
  } else if (!on && mode === 'paused') { mode = 'play'; ui.show(null); audio.setMusic(true, (online ? net.view : game).boss ? 2 : 1); }
}
function pick(i) {
  if (mode !== 'upgrade' || !game) return;
  const id = game.offer && game.offer[i] && game.offer[i].id;
  if (!id || !game.choose(i)) return;
  mode = 'play'; ui.show(null); input.reset();
  audio.play('upgrade');
  const u = UPG[id];
  ui.toast(`${u.icon} ${u.name}`, '');
  handleEvents(game, false);
}

// ---------- input -> sim intent ----------
function screenToWorld(x, y) { // screen dir (x right, y up) -> world xz, using camera yaw
  const s = Math.sin(camYawCur), c = Math.cos(camYawCur);
  return { x: c * x - s * y, z: -s * x - c * y };
}
// Momentum on the *input* vector (not the physics): a snappy ease-in so the hero leaves the mark the
// instant you push, and a slightly softer ease-out so it carries a little weight when you let go.
// This smooths the intent before it reaches the sim, so solo, net prediction and the server all agree.
let mvRampX = 0, mvRampZ = 0, lastRampT = -1;
function rampMove(mv, dead) {
  const dt = lastRampT < 0 ? 0 : Math.min(0.05, Math.max(0, realTime - lastRampT));
  lastRampT = realTime;
  if (dead) { mvRampX = mvRampZ = 0; return { x: 0, y: 0 }; }
  const target = Math.hypot(mv.x, mv.y), cur = Math.hypot(mvRampX, mvRampZ);
  const rate = target > cur + 1e-4 ? 24 : 11; // ~0.06 s to full, ~0.13 s to coast down
  const k = Math.min(1, dt * rate);
  mvRampX += (mv.x - mvRampX) * k; mvRampZ += (mv.y - mvRampZ) * k;
  if (Math.abs(mvRampX) < 1e-3) mvRampX = 0;
  if (Math.abs(mvRampZ) < 1e-3) mvRampZ = 0;
  return { x: mvRampX, y: mvRampZ };
}
function nearestFoe(g, x, z, range, dirX, dirZ, cone) {
  let best = null, bd = range;
  for (const u of g.units) {
    if (u.side !== g.foe) continue;
    const dx = u.x - x, dz = u.z - z, d = Math.hypot(dx, dz);
    if (d > bd) continue;
    if (cone && (dx * dirX + dz * dirZ) / (d || 1) < Math.cos(cone)) continue;
    best = u; bd = d;
  }
  return best;
}
function buildInput(g) {
  const h = g.hero;
  const a = input.aim();
  const out = { mx: 0, mz: 0, ax: 0, az: 0, fire: false, aimDist: 9 };
  aimPoint = null;
  const AUTO_AIM_RANGE = 26;
  // ---- MOVEMENT: on desktop the MOUSE moves the hero (walk toward the cursor); touch/gamepad use the stick ----
  if (!input.touchMode && a.kind === 'mouse') {
    ndc.set((a.sx / innerWidth) * 2 - 1, -(a.sy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hitPt)) {
      const dx = hitPt.x - h.x, dz = hitPt.z - h.z, d = Math.hypot(dx, dz) || 1, DEAD = 1.4;
      if (d > DEAD) { const sp = Math.min(1, (d - DEAD) / 3); out.mx = dx / d * sp; out.mz = dz / d * sp; }
      aimPoint = { x: hitPt.x, z: hitPt.z };   // marker shows where the hero is heading
    }
  } else {
    const mv = rampMove(input.moveVec(), h.dead);
    const m = screenToWorld(mv.x, mv.y);
    out.mx = m.x; out.mz = m.z;
  }
  // ---- AUTO-AIM: shooting is automatic — always lock onto the NEAREST living enemy in range ----
  const f = nearestFoe(g, h.x, h.z, AUTO_AIM_RANGE);
  if (f) { out.ax = f.x - h.x; out.az = f.z - h.z; out.aimDist = Math.hypot(out.ax, out.az); out.fire = true; }
  else { out.ax = h.aimX; out.az = h.aimZ; out.fire = false; }   // no enemy in range: hold facing, hold fire
  const e = input.takeEdges();
  out.dash = e.dash; out.q = e.q; out.e = e.e; out.r = e.r;
  if (testBot) {
    const b = testBot(g, 1 / 60);
    if (g.phase === 'upgrade') return b;
    return b;
  }
  if (window.__forceInput) Object.assign(out, window.__forceInput);
  return out;
}

// ---------- events -> juice ----------
// elemental debris: Fire bursts into embers & ash, Water into droplets & foam
const DEBRIS = {
  human: [0xFF5A1E, 0xFF9A3A, 0x2A1A16, 0xFFC24D, 0x7A2A10],
  ai: [0x27A8E0, 0xCFEFFF, 0x0C5E90, 0x7FE0FF, 0x145A7E],
};
const KIND_ACCENT = { runner: 0xFFD23F, brute: 0xFF5A3A, shooter: 0x8FE0FF, boss: 0xFFC83D, grunt: null };
const SPARK = { human: 0xFFB060, ai: 0xBFF4FF };

function handleEvents(g, quiet) {
  const ev = g.events;
  for (let i = 0; i < ev.length; i++) onEvent(g, ev[i], quiet);
  ev.length = 0;
}
function sfx(quiet, name, o) { if (!quiet) audio.play(name, o); }
function onEvent(g, e, quiet) {
  const me = g.team;
  switch (e.type) {
    case 'shot': {
      const col = trail.prism ? 0xffffff : trail.color;
      if (heroView) {
        fx.muzzle(heroView.muzzle, col);
        fx.dirBurst(heroView.muzzle.x, heroView.muzzle.y, heroView.muzzle.z, Math.sin(e.a), Math.cos(e.a), e.big ? 8 : 2, col, 9, 0.5, 0.12, 0.09);
      }
      if (!quiet) { fx.shake(e.big ? 0.22 : 0.035); lastShotT = realTime; }
      sfx(quiet, 'shot', { big: e.big });
      break;
    }
    case 'hit': {
      const enemy = e.side === g.foe;
      const col = SPARK[e.side];
      fx.dirBurst(e.x, 1.1, e.z, e.dx || 0, e.dz || 0, e.crit ? 7 : 4, col, 8, 0.8, 0.25, 0.12);
      if (e.byHero && !quiet) {
        fx.number(e.x, 2.2, e.z, Math.round(e.dmg), e.crit ? 'crit' : e.dmg > 40 ? 'big' : '');
        lastHitT = realTime;
        sfx(quiet, 'hit', { crit: e.crit });
        if (e.crit) fx.shake(0.04);
      } else if (!enemy && !quiet && e.dmg > 8) fx.number(e.x, 2, e.z, Math.round(e.dmg), 'ally', 0.5);
      break;
    }
    case 'kill': {
      const big = e.kind === 'brute' || e.kind === 'boss' || e.elite;
      const s = e.r / 0.6;
      const deb = DEBRIS[e.side].slice();
      if (KIND_ACCENT[e.kind]) deb.push(KIND_ACCENT[e.kind]);
      if (e.elite) deb.push(0xFFC83D, 0xFFC83D);
      fx.chunks(e.x, 0.8 * s, e.z, Math.round((lowEnd ? 6 : 9) * Math.min(3, s)), deb, 5 + s * 2, 0.2 * Math.min(2.2, s), e.dx || 0, e.dz || 0);
      fx.puff(e.x, 0.6 * s, e.z, Math.round(4 + s * 2), e.side === 'ai' ? 0x59656F : 0xD8C9AE, 0.7 * Math.min(2.5, s), 2.5, 0.6);
      fx.burst(e.x, 1, e.z, Math.round(8 + s * 4), SPARK[e.side], 9 + s * 2, 0.4, 0.16);
      if (e.side === 'ai') fx.glowDot(e.x, 1, e.z, 0, 2, 0, 0.25, 1.6 * s, 0x7BFFEE);
      if (big) {
        fx.ring(e.x, e.z, 0.5, 3 * s, 0.45, e.elite ? 0xFFC83D : 0xffffff);
        fx.light(e.x, 2, e.z, e.elite ? 0xFFC83D : 0xFFA060, 30);
        if (!quiet) { fx.shake(e.kind === 'boss' ? 0.9 : 0.3); hitstop = Math.max(hitstop, e.kind === 'boss' ? 0.16 : 0.05); }
      }
      if (e.byHero && !quiet && e.pts && (big || g.mult >= 3)) fx.number(e.x, 3, e.z, '+' + e.pts, 'pts', 0.9);
      if (e.side === g.foe) sfx(quiet, big ? 'bigKill' : 'kill', { combo: g.combo });
      if (e.kind === 'boss' && !quiet) {
        ui.banner(`${e.side === 'ai' ? 'Tidal Colossus' : 'Magma Colossus'} down!`, `+${e.pts} points`, '#FFC83D');
        for (let k = 1; k <= 5; k++) setTimeout(() => { fx.burst(e.x + (Math.random() - 0.5) * 4, 2, e.z + (Math.random() - 0.5) * 4, 20, 0xFFC83D, 14, 0.6, 0.25); fx.ring(e.x, e.z, 1, 6 + k, 0.5, 0xFFE0A0); audio.play('boom'); }, k * 140);
        audio.setMusic(true, 1);
      }
      if (e.last && !quiet) { slowT = slowMax = 1.1; ui.slowmo(true); }
      break;
    }
    case 'dash':
      fx.ring(e.x, e.z, 0.4, 2.2, 0.3, SPARK[me]);
      fx.puff(e.x, 0.3, e.z, 4, 0xE6DCCB, 0.5, 2, 0.4, 0.5);
      sfx(quiet, 'dash');
      break;
    case 'heroHurt':
      if (!quiet) {
        fx.shake(0.18 + Math.min(0.3, e.dmg * 0.012)); ui.heroHurt(e.dmg);
        fx.number(e.x, 2.6, e.z, '-' + Math.round(e.dmg), 'hurt', 0.7);
        if (e.dmg >= 18) hitstop = Math.max(hitstop, 0.04);
      }
      fx.burst(e.x, 1.2, e.z, 6, 0xFF4D4D, 7, 0.3, 0.14);
      sfx(quiet, 'hurt');
      break;
    case 'baseHit':
      fx.burst(e.x + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, e.z + fwd(e.side) * 2, 4, SPARK[e.side], 6, 0.4, 0.15);
      if (!quiet) {
        ui.baseHit(e.side === me);
        if (e.side === me) {
          sfx(quiet, 'baseHit');
          if (realTime - lastBaseToast > 7) { lastBaseToast = realTime; ui.toast(`⚠ Your ${TEAMS[me].base.toLowerCase()} is under attack!`, 'bad'); }
        }
      }
      break;
    case 'shieldHit':
      break;
    case 'ability': {
      const col = SPARK[me];
      if (e.name === 'wall') { fx.ring(e.x, e.z, 0.5, 4.5, 0.4, 0xFFB070); fx.puff(e.x, 0.3, e.z, 8, 0xD8C9AE, 0.8, 4, 0.6, 0.6); fx.shake(0.2); }
      if (e.name === 'rally') { fx.ring(e.x, e.z, 0.5, 9, 0.6, 0xFFC83D); fx.burst(e.x, 1, e.z, 30, 0xFFC83D, 10, 0.6, 0.2, 2); if (!quiet) ui.toast('Rally! Allies hit twice as hard', 'good'); }
      if (e.name === 'catapult') { fx.ring(e.x, e.z, 0.5, 3, 0.4, 0xFFB070); }
      if (e.name === 'firewall') { fx.shake(0.15); }
      if (e.name === 'drones') { fx.burst(e.x, 1.6, e.z, 16, 0x7BFFEE, 6, 0.4, 0.14, 0); }
      if (e.name === 'emp') {
        fx.ring(e.x, e.z, 0.5, 9, 0.5, 0x7BFFEE, 0.3, 1); fx.ring(e.x, e.z, 0.5, 7, 0.35, 0xffffff, 0.5, 1);
        for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; fx.glowDot(e.x, 1, e.z, Math.cos(a) * 22, 0, Math.sin(a) * 22, 0.35, 0.5, 0x7BFFEE, 0, 3); }
        fx.light(e.x, 2, e.z, 0x7BFFEE, 60); fx.shake(0.5); hitstop = Math.max(hitstop, 0.05);
      }
      sfx(quiet, e.name);
      if (heroView && e.k) ui.ab[e.k] && ui.ab[e.k].el.classList.remove('ready');
      break;
    }
    case 'telegraph': sfx(quiet, 'telegraph'); break;
    case 'slam': {
      const foe = e.side === g.foe;
      const boulder = e.kind === 'boulder';
      fx.ring(e.x, e.z, 0.5, e.r * 1.35, 0.5, foe ? 0xFFD0B0 : 0xFFE0A0, 0.15, 1);
      fx.puff(e.x, 0.4, e.z, boulder ? 10 : 18, 0xD8C9AE, 1.1, 7, 0.8, 0.8);
      fx.chunks(e.x, 0.4, e.z, boulder ? 12 : 16, boulder ? [0x9C9282, 0x7A705F, 0xB0A898] : [0xC9B48A, 0x8E8473, 0x6B5F50], 7, 0.3);
      fx.light(e.x, 2, e.z, 0xFFB060, boulder ? 30 : 50);
      if (!quiet) { fx.shake(boulder ? 0.35 : 0.75); hitstop = Math.max(hitstop, boulder ? 0.03 : 0.07); }
      sfx(quiet, boulder ? 'boom' : 'slam');
      break;
    }
    case 'boom': {
      const col = e.kind === 'emp' ? 0x7BFFEE : e.kind === 'chain' ? 0xFF9A3D : e.kind === 'drone' ? 0x7BFFEE : 0xFFB04D;
      if (e.kind !== 'emp') {
        fx.ring(e.x, e.z, 0.3, e.r * 1.2, 0.35, col);
        fx.burst(e.x, 1, e.z, 14, col, 10, 0.35, 0.2, 6);
        fx.glowDot(e.x, 1, e.z, 0, 1, 0, 0.22, e.r * 1.3, col);
        fx.puff(e.x, 0.6, e.z, 4, 0x6A6460, 0.8, 3, 0.5);
        fx.light(e.x, 2, e.z, col, 22);
        if (!quiet) fx.shake(0.12);
        sfx(quiet, 'boom');
      }
      break;
    }
    case 'bossSpawn':
      if (!quiet) { ui.banner('BOSS', g.foe === 'ai' ? 'The Tidal Colossus rises' : 'The Magma Colossus rises', '#FF5A5A'); fx.shake(0.6); audio.setMusic(true, 2); }
      fx.ring(e.x, e.z, 1, 10, 0.8, 0xFF5A5A); fx.puff(e.x, 0.5, e.z, 16, 0x8A8070, 1.4, 6, 0.9);
      sfx(quiet, 'bossSpawn');
      break;
    case 'bossWarn': sfx(quiet, 'warn'); break;
    case 'waveIntro':
      if (!quiet) {
        const boss = e.boss;
        const tw = e.twist && TWISTS[e.twist];
        const sub = e.wave === MAX_WAVE ? 'Final wave. Everything they have.' : boss ? 'Boss wave' : tw ? `★ ${tw.name}: ${tw.desc}` : e.wave === 1 ? `Defend your ${TEAMS[me].base.toLowerCase()}. Clear the wave.` : `${g.waveTotal} enemies incoming`;
        ui.banner(`WAVE ${e.wave}`, sub, e.wave === MAX_WAVE || boss ? '#FF7A6B' : tw ? '#FFC83D' : '#fff');
      }
      break;
    case 'waveStart': sfx(quiet, 'waveStart'); break;
    case 'waveClear':
      if (!quiet) {
        setTimeout(() => ui.banner(e.breach ? 'BASE BREACHED!' : 'WAVE CLEAR', `+${e.bonus} bonus${e.breach ? ' (x2)' : ''}`, '#FFC83D'), e.breach ? 0 : 450);
        audio.setMusic(true, 1);
      }
      sfx(quiet, 'waveClear');
      break;
    case 'offer':
      if (quiet) { const i = botPick(g); g.choose(i); handleEvents(g, true); }
      else { mode = 'upgrade'; ui.showUpgrade(g, pick); input.reset(); }
      break;
    case 'upgrade': break;
    case 'synergy':
      if (!quiet) { ui.toast(`SYNERGY! ${e.name}: ${e.desc}`, 'syn'); ui.callout(e.name + '!', '#FFC83D'); }
      sfx(quiet, 'synergy');
      break;
    case 'headstart':
      if (!quiet) setTimeout(() => ui.toast(`Head start: ${UPG[e.id].icon} ${UPG[e.id].name}`, 'good'), 900);
      break;
    case 'streak':
      if (!quiet) { ui.callout(e.name); if (e.n >= 5) fx.shake(0.1); }
      sfx(quiet, 'streak', { n: e.n });
      break;
    case 'multUp': if (!quiet) ui.multPulse(); sfx(quiet, 'multUp', { mult: e.mult }); break;
    case 'comboLost': break;
    case 'drop': fx.ring(e.x, e.z, 0.3, 2, 0.4, 0xffffff); sfx(quiet, 'drop'); break;
    case 'pickup': {
      const names = { heal: '+35% HP', frenzy: 'FRENZY! Double fire rate', reset: 'OVERDRIVE! Cooldowns reset' };
      fx.burst(e.x, 1, e.z, 20, e.kind === 'heal' ? 0x56D364 : e.kind === 'frenzy' ? 0xFFC83D : 0x6FA8FF, 8, 0.5, 0.16, 0);
      fx.ring(e.x, e.z, 0.4, 3, 0.4, 0xffffff);
      if (!quiet) { ui.toast(names[e.kind], 'good'); if (e.kind === 'heal') fx.number(e.x, 2.5, e.z, '+HP', 'heal'); }
      sfx(quiet, 'pickup');
      break;
    }
    case 'heroDown':
      fx.burst(e.x, 1, e.z, 40, SPARK[me], 14, 0.7, 0.22);
      fx.chunks(e.x, 1, e.z, 14, DEBRIS[me], 8, 0.25);
      fx.puff(e.x, 0.6, e.z, 10, 0x9A9088, 1, 4, 0.8);
      fx.ring(e.x, e.z, 0.5, 6, 0.6, 0xFF5A5A);
      if (!quiet) {
        fx.shake(0.8); slowT = slowMax = 1.0; ui.slowmo(true);
        if (!e.final) ui.toast(`You're down! Back in ${Math.round(2.6)}s · ${g.hero.revives} revive${g.hero.revives === 1 ? '' : 's'} left`, 'bad');
      }
      sfx(quiet, 'heroDown');
      break;
    case 'heroRespawn':
      fx.ring(e.x, e.z, 0.3, 3, 0.5, SPARK[me]); fx.burst(e.x, 1, e.z, 24, SPARK[me], 6, 0.6, 0.16, -4);
      sfx(quiet, 'respawn');
      break;
    case 'breach': {
      for (let k = 0; k < 6; k++) setTimeout(() => {
        const x = e.x + (Math.random() - 0.5) * 8, z = e.z + (Math.random() - 0.5) * 6;
        fx.burst(x, 3 + Math.random() * 5, z, 24, 0xFFB04D, 14, 0.6, 0.25); fx.puff(x, 3, z, 6, 0x6A6460, 1.6, 4, 1.2);
        fx.ring(e.x, e.z, 2, 14, 0.6, 0xFFE0A0);
      }, k * 120);
      fx.chunks(e.x, 4, e.z, 30, DEBRIS[e.side], 10, 0.4);
      fx.light(e.x, 6, e.z, 0xFFB060, 80);
      if (!quiet) { fx.shake(1); slowT = slowMax = 1.4; ui.slowmo(true); }
      sfx(quiet, 'breach');
      break;
    }
    case 'spark': fx.burst(e.x, 1.1, e.z, 3, e.cover ? 0xFFF0D0 : SPARK[e.side], 5, 0.25, 0.1); break;
    case 'block': fx.burst(e.x, 1.1, e.z, 6, 0xFFE0B0, 6, 0.3, 0.12); sfx(quiet, 'block'); break;
    case 'bounce': fx.burst(e.x, 1.1, e.z, 4, 0xffffff, 6, 0.2, 0.1); break;
    case 'turret':
      turretAims[e.side] = { x: e.tx, z: e.tz };
      fx.burst(e.x, 6, e.z, 3, SPARK[e.side], 4, 0.2, 0.12, 0);
      if (e.side === me) sfx(quiet, 'turret');
      break;
    case 'enemyShot': fx.glowDot(e.x, 1.3, e.z, 0, 0.5, 0, 0.15, 0.8, 0xFF2E7E); sfx(quiet, 'enemyShot'); break;
    case 'droneShot': fx.glowDot(e.x, 1.8, e.z, 0, 0, 0, 0.08, 0.5, 0x7BFFEE); break;
    case 'burst': fx.ring(e.x, e.z, 1, 5, 0.4, 0xFF2E7E); sfx(quiet, 'telegraph'); break;
    case 'flank':
      fx.puff(e.x, 0.8, e.z, 5, 0xCFC3AE, 0.8, 2, 0.5);
      if (!quiet && flankToastWave !== g.wave) { flankToastWave = g.wave; ui.toast('⚠ Flankers over the side wall!', 'bad'); }
      break;
    case 'dropIn':
      fx.ring(e.x, e.z, 0.3, 2.4, 0.4, e.side === 'ai' ? 0x6FFFEA : 0xFFB070);
      fx.burst(e.x, 0.5, e.z, 10, e.side === 'ai' ? 0x6FFFEA : 0xFFC890, 6, 0.4, 0.14, -3);
      if (e.side === 'ai') fx.glowDot(e.x, 2, e.z, 0, 0, 0, 0.3, 2.2, 0x6FFFEA); else fx.puff(e.x, 0.4, e.z, 4, 0xD8C9AE, 0.8, 2.5, 0.5);
      break;
    case 'hunt': if (!quiet) ui.toast(`${e.n} left — they're coming for you!`, ''); break;
    case 'lose': case 'win':
      if (!quiet) {
        endT = 1.8; slowT = slowMax = 1.6; ui.slowmo(true);
        audio.play(e.type); audio.setMusic(false);
        if (e.type === 'win') fx.fireworks(14);
        if (e.type === 'lose' && e.reason === 'base') {
          const b = g.bases[me];
          for (let k = 0; k < 6; k++) setTimeout(() => { fx.burst(b.x + (Math.random() - 0.5) * 8, 4, b.z, 24, 0xFFB04D, 12, 0.6, 0.25); fx.puff(b.x, 4, b.z, 6, 0x555050, 2, 4, 1.4); audio.play('boom'); }, k * 150);
          fx.shake(1);
        }
      }
      break;
  }
}

// ambient emitters: firewalls, frenzy, damaged bases, elites, pickups
let ambT = 0;
function ambient(g, dt) {
  ambT += dt;
  for (const f of g.fires) {
    for (let k = 0; k < (lowEnd ? 2 : 4); k++) {
      const t = Math.random();
      const x = f.x0 + (f.x1 - f.x0) * t + (Math.random() - 0.5) * f.w * 1.6, z = f.z0 + (f.z1 - f.z0) * t + (Math.random() - 0.5) * f.w * 1.6;
      fx.glowDot(x, 0.2, z, 0, 2 + Math.random() * 2.5, 0, 0.5, 0.35 + Math.random() * 0.3, Math.random() < 0.3 ? 0xffffff : 0x6FD8FF, 1, 1.4);
    }
  }
  if (ambT < 0.05) return;
  ambT = 0;
  const h = g.hero;
  // elemental trail: embers drift off the Fire hero, droplets off the Water hero while moving
  if (!h.dead && (h.vx * h.vx + h.vz * h.vz) > 4) {
    if (g.team === 'human') fx.glowDot(h.x + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, h.z + (Math.random() - 0.5) * 0.6, 0, 1.4 + Math.random(), 0, 0.5, 0.18, Math.random() < 0.5 ? 0xFF6A1E : 0xFFB040, -1, 1);
    else fx.glowDot(h.x + (Math.random() - 0.5) * 0.6, 0.4, h.z + (Math.random() - 0.5) * 0.6, 0, 0.4, 0, 0.5, 0.14, 0x7FE0FF, 4, 2);
  }
  if (g.frenzy > 0 && !h.dead) fx.glowDot(h.x + (Math.random() - 0.5), 1 + Math.random(), h.z + (Math.random() - 0.5), 0, 2, 0, 0.4, 0.25, 0xFFC83D);
  if (g.rally > 0) for (const u of g.units) if (u.ally && Math.random() < 0.15) fx.glowDot(u.x, 1.8, u.z, 0, 1.5, 0, 0.4, 0.2, 0xFFC83D);
  for (const k of ['human', 'ai']) {
    const b = g.bases[k], dmg = 1 - b.hp / b.max;
    if (dmg > 0.4 && Math.random() < dmg) fx.puff(b.x + (Math.random() - 0.5) * 6, 4 + Math.random() * 4, b.z, 1, 0x4A4646, 1.4, 0.5, 1.6, 2);
    if (dmg > 0.65 && Math.random() < dmg * 0.6) fx.glowDot(b.x + (Math.random() - 0.5) * 5, 3 + Math.random() * 3, b.z, 0, 3, 0, 0.5, 0.5, k === 'human' ? 0xFF8A3D : 0x9FE0FF);
  }
  for (const u of g.units) if (u.elite && Math.random() < 0.4) fx.glowDot(u.x + (Math.random() - 0.5), 0.5 + Math.random() * 1.5, u.z + (Math.random() - 0.5), 0, 1.5, 0, 0.5, 0.18, 0xFFC83D);
  for (const p of g.pickups) if (Math.random() < 0.5) fx.glowDot(p.x + (Math.random() - 0.5), 0.3, p.z + (Math.random() - 0.5), 0, 2.5, 0, 0.6, 0.15, 0xffffff);
}

// ---------- camera (owned by the look pass: see look.js fixedCamera) ----------
// The camera is completely still: one framing per team and screen shape that shows the whole arena.
// No follow, no lead, no shake, no zoom. Input directions use the same fixed yaw.
var camKey = ''; // var: resize() runs before this line on boot
function frameCamera() {
  const t = online ? net.view.team : mode === 'menu' ? 'human' : ((game || demo) ? (game || demo).team : 'human');
  const key = t + ':' + innerWidth + 'x' + innerHeight;
  if (key === camKey) return;
  camKey = key;
  const r = fixedCamera(camera, t, innerWidth, innerHeight);
  look.fitFog();
  camYaw = camYawCur = r.yaw;
}
function snapCamera() { frameCamera(); }
function updateCamera() { frameCamera(); }

// ---------- off-screen enemy arrows ----------
const arrowsEl = document.getElementById('arrows');
const arrows = Array.from({ length: 8 }, () => { const d = document.createElement('div'); d.className = 'arw'; arrowsEl.appendChild(d); return d; });
const _p = new THREE.Vector3();
function updateArrows(g) {
  let n = 0;
  if (mode === 'play') {
    const h = g.hero, W = innerWidth, H = innerHeight, m = 26;
    const list = g.units.filter((u) => u.side === g.foe).map((u) => ({ u, d: Math.hypot(u.x - h.x, u.z - h.z) }))
      .filter((o) => o.d < 30 || o.u.kind === 'boss' || o.u.elite).sort((a, b) => (b.u.kind === 'boss') - (a.u.kind === 'boss') || a.d - b.d);
    for (const { u } of list) {
      if (n >= arrows.length) break;
      _p.set(u.x, 1, u.z).project(camera);
      let sx = (_p.x * 0.5 + 0.5) * W, sy = (-_p.y * 0.5 + 0.5) * H;
      if (_p.z > 1) { sx = W - sx; sy = H - sy; }
      if (sx > 0 && sx < W && sy > 0 && sy < H && _p.z < 1) continue;
      const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
      const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-3), (H / 2 - m) / Math.abs(dy || 1e-3));
      const a = arrows[n++];
      a.className = 'arw on' + (u.kind === 'boss' ? ' boss' : u.elite ? ' elite' : '');
      a.style.transform = `translate(${(cx + dx * k).toFixed(0)}px, ${(cy + dy * k).toFixed(0)}px) rotate(${Math.atan2(dx, -dy).toFixed(2)}rad)`;
    }
  }
  for (let i = n; i < arrows.length; i++) if (arrows[i].className !== 'arw') arrows[i].className = 'arw';
}

// ---------- online multiplayer (net.js talks to the game server, which runs match.js) ----------
// Server first; if it does not answer within 5 s the team buttons start the solo run against bots instead.
const net = new Net(serverUrl());
const remote = new Map(); // hero id -> Hero view for every other hero in the match
let pendingPlay = null;
const NAME_KEY = 'hva2-name';
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tagName = (name, side) => `<b style="color:${TEAMS[side].css}">${escHtml(name)}</b>`;
const teamName = (side) => tagName('Team ' + TEAMS[side].short, side);
function savedName() { try { return localStorage.getItem(NAME_KEY) || localStorage.getItem('hva-name') || ''; } catch (e) { return ''; } }

function play(t) {
  audio.unlock();
  if (net.status === 'online') joinOnline(t);
  else if (net.status === 'connecting') { pendingPlay = t; ui.mpStatus('connecting'); }
  else startRun(t);
}
function joinOnline(t) {
  const name = cleanName(ui.mpName() || savedName());
  try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
  if (ui.mp) ui.mp.inp.value = name;
  team = t;
  profile = meta.loadProfile(); profile.lastTeam = t; meta.saveProfile(profile);
  game = null; online = { team: t };
  net.join(name, t);
  setHeroView(t, meta.skinFor(profile, t)); trail = meta.trailFor(profile, t);
  fx.clear(); ui.clearTransient(); ui.setTeam(t, true); input.reset();
  ui.setOnline(true); ui.roster(net.roster, 0, net.status);
  audio.team = t; audio.setMusic(true, 1);
  slowT = 0; endT = 0; simTime = 0;
  mode = 'play'; ui.show(null);
  document.getElementById('restartBtn').classList.add('hidden');
  camKey = ''; frameCamera();
  ui.banner('LIVE MATCH', `You are ${name} on Team ${TEAMS[t].short}. Destroy their ${TEAMS[other(t)].base.toLowerCase()}!`, TEAMS[t].css);
}
function leaveOnline() {
  net.leave(); online = null;
  for (const v of remote.values()) v.dispose(scene);
  remote.clear();
  ui.setOnline(false);
  document.getElementById('restartBtn').classList.remove('hidden');
  camKey = '';
}
net.on('status', (s) => {
  ui.mpStatus(s, net.players, net.room);
  if (pendingPlay && s !== 'connecting') { const t = pendingPlay; pendingPlay = null; if (mode === 'menu') play(t); }
  if (s === 'offline' && online) { toMenu(); ui.toast('Lost the game server. Play a solo run, or try again in a moment.', 'bad'); }
});
net.on('roster', (r) => { ui.mpStatus(net.status, r.n, net.room); });
net.on('joined', (d) => {
  if (!online || d.side === online.team) return;
  // that team was full: the server put us on the other side
  online.team = team = d.side;
  setHeroView(d.side, meta.skinFor(profile, d.side)); trail = meta.trailFor(profile, d.side);
  ui.setTeam(d.side, true); audio.team = d.side; camKey = ''; frameCamera();
  ui.toast(`Team ${TEAMS[other(d.side)].short} is full, so you joined Team ${TEAMS[d.side].short}.`, 'syn');
});
net.on('afk', () => { if (online) { toMenu(); ui.toast('You were idle for a while, so you left the match.', ''); } });

function onlineStep(rdt) {
  const v = net.view;
  if (slowT > 0) { slowT = 0; ui.slowmo(false); } // the match never slows down for one player
  const h = v.hero;
  const inp = mode === 'play' && h && h.id && !h.dead ? buildInput(v) : { mx: 0, mz: 0, ax: h ? h.aimX : 0, az: h ? h.aimZ : 1, fire: false };
  net.update(rdt, inp);
  onNetEvents(v);
  ambient(v, rdt);
}
function onNetEvents(v) {
  const me = v.meId;
  const near = (x, z) => Math.hypot(x - v.hero.x, z - v.hero.z) < 20;
  for (const e of net.drainEvents()) {
    const mine = !!me && e.id === me;
    switch (e.type) {
      case 'shot': {
        if (mine) { onEvent(v, e, false); break; }
        const rv = remote.get(e.id), hh = v.heroMap.get(e.id);
        if (rv && hh && !hh.dead) fx.muzzle(rv.muzzle, SPARK[hh.side]);
        break;
      }
      case 'hit': {
        const u = v.unitMap.get(e.id); if (u) u.hitT = 0.11;
        e.byHero = !!me && e.by === me;
        onEvent(v, e, !e.byHero);
        break;
      }
      case 'kill':
        e.byHero = !!me && e.by === me; e.last = false;
        onEvent(v, e, e.kind === 'boss' || (!e.byHero && !near(e.x, e.z)));
        break;
      case 'heroHurt':
        if (mine) onEvent(v, { type: 'heroHurt', x: e.x, z: e.z, dmg: e.dmg }, false);
        else {
          const hh = v.heroMap.get(e.id);
          fx.burst(e.x, 1.2, e.z, 5, hh ? SPARK[hh.side] : 0xFF4D4D, 7, 0.3, 0.14);
          if (me && e.by === me) { fx.number(e.x, 2.8, e.z, Math.round(e.dmg), 'big'); lastHitT = realTime; audio.play('hit', { crit: false }); }
        }
        break;
      case 'heroKill': {
        const killer = e.k ? tagName(e.kn, other(e.side)) : null;
        ui.feed(killer ? `${killer} took down ${tagName(e.name, e.side)}${e.shut ? ` · ended a ${e.shut} streak` : ''}` : `${tagName(e.name, e.side)} was taken down`);
        fx.burst(e.x, 1, e.z, 36, SPARK[e.side], 14, 0.7, 0.22);
        fx.chunks(e.x, 1, e.z, 12, DEBRIS[e.side], 8, 0.25);
        fx.ring(e.x, e.z, 0.5, 6, 0.6, 0xFF5A5A);
        if (mine) {
          ui.banner('TAKEN DOWN', `by ${e.kn || 'the enemy'} · respawn in 4`, '#FF7A6B');
          ui.heroHurt(40); audio.play('heroDown');
        } else if (me && e.k === me) {
          ui.callout(`You took down ${e.name}!`, '#FFC83D'); audio.play('bigKill');
        } else if (near(e.x, e.z)) audio.play('kill');
        break;
      }
      case 'heroRespawn': onEvent(v, e, !mine); break;
      case 'dash': if (mine || near(e.x, e.z)) onEvent(v, e, !mine); break;
      case 'ability': {
        const hh = v.heroMap.get(e.id);
        if (mine) onEvent(v, e, false);
        else onEvent(v, { ...e, k: null }, !(hh && hh.side === v.team && near(e.x, e.z)));
        break;
      }
      case 'slam': case 'boom': case 'telegraph': case 'burst': case 'block': case 'drop':
        onEvent(v, e, !near(e.x, e.z));
        break;
      case 'bossSpawn':
        if (e.side === v.foe) onEvent(v, e, false);
        else { fx.ring(e.x, e.z, 1, 10, 0.8, 0xFFC83D); ui.toast(`Your ${BOSS_NAMES[e.side]} joins the fight!`, 'good'); }
        ui.feed(`${teamName(e.side)}'s ${BOSS_NAMES[e.side]} entered the arena`);
        break;
      case 'bossWarn': ui.toast('⚠ Both bosses join in 5 seconds!', 'bad'); audio.play('warn'); break;
      case 'bossDown':
        ui.banner(`${BOSS_NAMES[e.side]} down!`, e.name ? `by ${e.name}` : '', '#FFC83D');
        ui.feed(e.name ? `${tagName(e.name, other(e.side))} took down the ${BOSS_NAMES[e.side]}` : `The ${BOSS_NAMES[e.side]} fell`);
        audio.setMusic(true, 1);
        break;
      case 'baseHit': {
        const b = v.bases[e.side]; if (b) b.hitT = 0.2;
        onEvent(v, e, false);
        break;
      }
      case 'baseMile':
        ui.feed(`${teamName(other(e.side))} hit the ${TEAMS[e.side].base} · ${e.pct}% left`);
        if (e.side === v.team) ui.toast(`⚠ Your ${TEAMS[e.side].base.toLowerCase()} is down to ${e.pct}%!`, 'bad');
        break;
      case 'breach': onEvent(v, e, true); ui.feed(`${teamName(other(e.side))} destroyed the ${TEAMS[e.side].base}!`); break;
      case 'turret': onEvent(v, e, e.side !== v.team); break;
      case 'pickup': onEvent(v, e, !mine); break;
      case 'synergy': if (mine) onEvent(v, e, false); break;
      case 'levelUp': {
        const hh = v.heroMap.get(e.id);
        if (hh && !hh.dead) fx.ring(hh.x, hh.z, 0.4, 3, 0.5, 0xFFC83D);
        if (mine) { ui.callout(`LEVEL ${e.level}!`, '#FFC83D'); }
        break;
      }
      case 'upgrade': if (mine) { const u = UPG[e.up]; if (u) ui.toast(`${u.icon} ${u.name}`, ''); audio.play('upgrade'); } break;
      case 'streak': if (mine) onEvent(v, { type: 'streak', n: e.n, name: e.name }, false); break;
      case 'pstreak':
        ui.feed(`${tagName(e.name, e.side)} ${escHtml(e.label)}`);
        ui.callout(mine ? `You ${e.label.replace(/^is /, 'are ')}` : `${e.name} ${e.label}`, TEAMS[e.side].css);
        audio.play('streak', { n: e.n });
        break;
      case 'twist': { const tw = TWISTS[e.twist]; if (tw) ui.toast(`★ ${tw.name}: ${tw.desc}`, 'syn'); break; }
      case 'join': ui.feed(`${tagName(e.name, e.side)} joined ${teamName(e.side)}`); break;
      case 'switch': ui.feed(`${tagName(e.name, e.side)} switched to ${teamName(e.side)}`); break;
      case 'leave': ui.feed(`${tagName(e.name, e.side)} left the match`); break;
      case 'matchEnd':
        ui.cardBar(null); ui.showBoard(e, me, v.team);
        audio.play(e.winner === v.team ? 'win' : 'lose'); audio.setMusic(false);
        break;
      case 'matchStart':
        ui.hideBoard(); fx.clear(); audio.setMusic(true, 1);
        ui.banner('NEW MATCH', `Destroy the ${TEAMS[v.foe].base.toLowerCase()} · 8 minutes`, '#fff');
        break;
    }
  }
}
const _tag = new THREE.Vector3();
function onlineViews(dt) {
  const v = net.view, seen = new Set();
  for (const h of v.heroes) {
    if (h.id === v.meId) continue;
    let rv = remote.get(h.id);
    if (!rv || rv.team !== h.side) { if (rv) rv.dispose(scene); rv = new Hero(scene, h.side, null); remote.set(h.id, rv); }
    rv.update(h, dt, realTime);
    seen.add(h.id);
  }
  for (const [id, rv] of remote) if (!seen.has(id)) { rv.dispose(scene); remote.delete(id); }
  // floating name tags above every hero
  const tags = [], W = innerWidth, H = innerHeight;
  if (mode !== 'menu') for (const h of v.heroes) {
    if (h.dead) continue;
    _tag.set(h.x, 3.6, h.z).project(camera);
    if (_tag.z > 1 || _tag.x < -1.1 || _tag.x > 1.1 || _tag.y < -1.1 || _tag.y > 1.1) continue;
    tags.push({ id: h.id, name: h.name || '…', side: h.side, sx: (_tag.x * 0.5 + 0.5) * W, sy: (-_tag.y * 0.5 + 0.5) * H, me: h.id === v.meId, hp: h.hp / (h.max || 1), dead: h.dead, lvl: h.level });
  }
  ui.nameTags(tags);
  ui.roster(net.roster, v.meId, net.status);
  ui.cardBar(v.ended ? null : v.offer, v.offerT, (i) => net.pick(i));
}

// ---------- frame ----------
let frameMs = 16, adaptT = 0;
function frame(rdt, doRender = true) {
  rdt = Math.min(rdt, 1 / 20);
  realTime += rdt;
  input.pollPad();
  const g = online ? net.view : mode === 'menu' ? demo : game;
  if (!g) return;
  // time scale: hit-stop, then slow motion easing back to normal
  let ts = 1;
  hitstop = 0; // no hit-stop freezes: the screen stays calm
  if (slowT > 0) {
    slowT -= rdt;
    const k = slowT / slowMax;
    ts = k > 0.35 ? 0.25 : 0.25 + (1 - k / 0.35) * 0.75;
    if (slowT <= 0) ui.slowmo(false);
  }
  const dt = rdt * ts;
  if (online) onlineStep(rdt);
  else if (mode === 'play' || mode === 'menu') {
    const inp = mode === 'menu' ? demoBot(g, dt) : buildInput(g);
    let left = dt, first = true;
    while (left > 1e-6) {
      const s = Math.min(left, 1 / 60);
      g.step(s, inp);
      if (first) { inp.dash = inp.q = inp.e = inp.r = false; first = false; }
      left -= s;
    }
    simTime += dt;
    if (mode === 'menu') {
      if (g.phase === 'upgrade') { g.choose(botPick(g)); }
      handleEvents(g, true);
      if (g.phase === 'won' || g.phase === 'lost' || g.wave > 4) newDemo();
    } else handleEvents(g, false);
    if (mode !== 'menu') ambient(g, dt);
  }
  if (endT > 0) { endT -= rdt; if (endT <= 0) finishRun(); }
  // views
  const gv = online ? net.view : mode === 'menu' ? demo : game;
  if (heroView) heroView.update(gv.hero, dt, realTime);
  entities.update(gv, realTime, camera, mode === 'menu' ? meta.trailFor(profile, gv.team) : trail);
  world.update(rdt, gv, turretAims);
  fx.update(mode === 'paused' || mode === 'upgrade' ? 0 : dt, rdt);
  updateCamera(rdt, gv);
  updateArrows(gv);
  if (mode !== 'menu') {
    ui.hud(gv, rdt);
    if (!input.touchMode) ui.crosshair(input.mouse.x, input.mouse.y, realTime - lastShotT < 0.06, realTime - lastHitT < 0.1);
  }
  if (online) onlineViews(rdt);
  if (doRender) look.render();
}
function finishRun() {
  const g = game; if (!g) return;
  mode = 'end';
  profile = meta.loadProfile();
  const prevBest = profile.best[g.team], prevBestWave = profile.bestWave[g.team];
  const r = { team: g.team, score: g.score, wave: g.wave, won: g.phase === 'won', bestCombo: g.bestCombo, bossKills: g.stats.bossKills, daily: g.isDaily };
  const rw = meta.rewardRun(profile, r);
  // what to try next
  const usedAb = g.stats.abilities, minutes = Math.max(1, simTime / 60);
  let tip;
  if (r.won) tip = g.mod ? 'switch sides and beat it again.' : `the Daily Challenge, or win as Team ${TEAMS[other(g.team)].short}.`;
  else if (g.result.reason === 'base') tip = 'stay between the enemies and your base, and take Repair Crew when it shows up.';
  else if (g.slams.length || (g.boss && g.wave % 3 === 0)) tip = 'step out of red circles before they fill, or dash through them.';
  else if (usedAb / minutes < 2) tip = `use ${TEAMS[g.team].abilities.q.name} (Q) and ${TEAMS[g.team].abilities.e.name} (E) more — they recharge fast.`;
  else if (g.stats.dashes / minutes < 3) tip = 'dash (Space) through attacks — you can\'t be hurt mid-dash.';
  else if (!Object.keys(g.syn).length) tip = 'combine Piercing + Split Shot for the Bullet Storm synergy.';
  else tip = 'grab glowing drops — Frenzy doubles your fire rate.';
  const unowned = SHOP.filter((s) => !profile.owned.includes(s.id) && (s.type !== 'skin' || s.team === g.team)).sort((a, b) => a.price - b.price)[0];
  let nextUnlock = '';
  if (profile.level < ULT_LEVEL) nextUnlock = `Ultimate unlocks at level ${ULT_LEVEL}`;
  else if (unowned) nextUnlock = profile.bank >= unowned.price ? `You can unlock ${unowned.name} in the Armory!` : `${unowned.name}: ${unowned.price - profile.bank} more to unlock`;
  ui.showEnd({ ...r, kills: g.kills, time: simTime, reason: g.result.reason, prevBest, prevBestWave, rw, tip, nextUnlock, daily: g.isDaily });
  audio.setMusic(true, 0);
}

// ---------- wiring ----------
for (const b of document.querySelectorAll('.team')) b.addEventListener('click', () => play(b.dataset.team));
for (const b of document.querySelectorAll('[data-daily]')) b.addEventListener('click', () => startRun(b.dataset.daily, { daily: true }));
document.getElementById('shopBtn').addEventListener('click', () => { audio.unlock(); audio.play('click'); openShop(); });
document.getElementById('shopClose').addEventListener('click', () => { ui.renderMenu(profile, meta.dailyState(profile)); ui.show('menu'); });
function openShop() {
  profile = meta.loadProfile();
  ui.renderShop(profile, profile.lastTeam || 'human', (act, id) => {
    if (act === 'buy' && meta.buy(profile, id)) audio.play('coin');
    if (act === 'equip') { meta.equip(profile, id); audio.play('click'); }
    openShop();
  });
  ui.show('shop');
}
document.getElementById('pauseBtn').addEventListener('click', () => pause(true));
document.getElementById('resumeBtn').addEventListener('click', () => pause(false));
document.getElementById('restartBtn').addEventListener('click', () => startRun(team, { daily: !!(game && game.dailyMod), practice: true }));
document.getElementById('quitBtn').addEventListener('click', toMenu);
document.getElementById('againBtn').addEventListener('click', () => startRun(team, game && game.dailyMod ? { daily: true, practice: true } : {}));
document.getElementById('switchBtn').addEventListener('click', () => startRun(other(team)));
document.getElementById('menuBtn').addEventListener('click', toMenu);
for (const b of document.querySelectorAll('.ab')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.ab;
    if (k === 'dash') input.edge.dash = true; else input.edge[k] = true;
  });
}
input.on('key', (k) => {
  if (k === 'Escape' || k === 'KeyP') { if (mode === 'play') pause(true); else if (mode === 'paused') pause(false); }
  if (mode === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(k)) pick(+k.slice(-1) - 1);
  if (online && mode === 'play' && ['Digit1', 'Digit2', 'Digit3'].includes(k)) net.pick(+k.slice(-1) - 1); // level-up cards, no pause
  if (mode === 'end' && (k === 'Enter' || k === 'KeyR')) document.getElementById('againBtn').click();
  if (k === 'KeyM') { audio.unlock(); audio.setMuted(!audio.muted); ui.refreshMute(); }
});
addEventListener('pointerdown', () => audio.unlock(), { capture: true });
addEventListener('keydown', () => audio.unlock(), { capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (mode === 'play') pause(true); audio.suspend(true); }
  else audio.suspend(false);
});

// ---------- boot ----------
ui.mountOnline({ name: savedName(), onName: () => {} });
ui.mpStatus(net.status, 0, 1);
toMenu();
net.connect(1);
setInterval(() => { if (net.status === 'offline' && net.url && mode === 'menu') net.connect(1, true); }, 20000); // keep trying quietly
renderer.compile(scene, camera);
let last = performance.now();
function loop(now) {
  const rdt = (now - last) / 1000; last = now;
  const t0 = performance.now();
  frame(rdt);
  // adaptive resolution: keep 60 fps on weaker machines
  frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
  look.adapt(rdt, mode === 'play' && !document.hidden);
  if (maxPR > look.maxPR) { maxPR = look.maxPR; pixelRatio = Math.min(pixelRatio, maxPR); renderer.setPixelRatio(pixelRatio); resize(); }
  adaptT += rdt;
  if (adaptT > 2 && mode === 'play') {
    adaptT = 0;
    if (frameMs > 14 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    else if (frameMs < 6 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- test hook ----------
window.__game = {
  get game() { return game; }, get demo() { return demo; }, get mode() { return mode; },
  get state() { const g = game || demo; return g && { mode, phase: g.phase, wave: g.wave, score: g.score, hp: g.hero.hp, units: g.units.length, shots: g.shots.length, kills: g.kills, base: g.bases[g.team].hp, foeBase: g.bases[g.foe].hp, result: g.result }; },
  startRun, toMenu, pick, pause, play, net, get online() { return online; },
  step(dt = 1 / 60, n = 1, render = true) { for (let i = 0; i < n; i++) frame(dt, render && i === n - 1); return this.state; },
  render() { look.render(); }, look,
  setWave(n) { const g = game; g.wave = n; g.units = []; g.shots = []; g.queue = []; g.startWave(); g.phase = 'intro'; g.phaseT = 0.5; },
  giveUpgrade(id, n = 1) { for (let i = 0; i < n; i++) game.applyUpgrade(id); handleEvents(game, true); },
  bot(on, skill = 0.75) { testBot = on ? makeBot(skill) : null; },
  perf(n = 60) {
    const t0 = performance.now(); for (let i = 0; i < n; i++) frame(1 / 60, true);
    const gl = renderer.getContext(); gl.finish();
    return { msPerFrame: (performance.now() - t0) / n, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio() };
  },
  renderer, scene, camera, fx, ui, audio, input, meta,
  get profile() { return meta.loadProfile(); },
  setProfile(p) { meta.saveProfile(Object.assign(meta.loadProfile(), p)); profile = meta.loadProfile(); },
  // ---- controls / movement test helpers ----
  // inject screen-space intent: mv {x:right, y:up}, aim { kind:'dir', x, y, fire } (both go through the
  // real camera-relative pipeline), then step() frames and read heroState() to check on-screen movement.
  injectInput(mv, aim) { input.inject = { mv: mv || null, aim: aim || null }; },
  clearInput() { input.inject = null; },
  dashNow() { input.edge.dash = true; },
  heroState() {
    const g = online ? net.view : (game || demo); if (!g) return null;
    const h = g.hero, sp = new THREE.Vector3(h.x, 1, h.z).project(camera);
    return {
      x: h.x, z: h.z, vx: h.vx, vz: h.vz, speed: Math.hypot(h.vx, h.vz),
      aim: h.aim, aimX: h.aimX, aimZ: h.aimZ, dashT: h.dashT, dashCd: h.dashCd, inv: h.inv, dead: h.dead,
      heroYaw: heroView ? heroView.yaw : null, team: g.team, camYaw: camYawCur,
      screen: { x: (sp.x * 0.5 + 0.5) * innerWidth, y: (-sp.y * 0.5 + 0.5) * innerHeight },
    };
  },
};
