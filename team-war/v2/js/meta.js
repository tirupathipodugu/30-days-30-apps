// Progress saved on this device: level/XP, coins (Human) / parts (AI) — one wallet, named after your side —
// unlocks, best scores and the daily challenge. Every storage call is wrapped: private windows may block it.
import { SHOP, MODIFIERS, xpForLevel, ULT_LEVEL, TEAMS } from './config.js?v=1015.3030';

const KEY = 'hva2.profile';
const fresh = () => ({
  v: 1, xp: 0, level: 1, bank: 0, owned: [], equip: { skin_human: '', skin_ai: '', trail: '' },
  best: { human: 0, ai: 0 }, bestWave: { human: 0, ai: 0 }, bestCombo: 0, runs: 0, wins: { human: 0, ai: 0 },
  daily: { key: '', played: false, score: 0, wave: 0 }, lastTeam: '', seenUlt: false,
});

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return Object.assign(fresh(), JSON.parse(raw));
  } catch { return fresh(); }
}
export function saveProfile(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

export const currencyName = (team) => TEAMS[team || 'human'].currency;

export function perksFor(p) {
  return { headstart: p.owned.includes('headstart'), revive: p.owned.includes('revive'), ult: p.level >= ULT_LEVEL };
}
export function skinFor(p, team) {
  const id = p.equip['skin_' + team];
  const it = SHOP.find((s) => s.id === id);
  return it ? it.colors : null;
}
export function trailFor(p, team) {
  const it = SHOP.find((s) => s.id === p.equip.trail);
  if (it && it.color === -1) return { color: 0xffffff, prism: true };
  if (it) return { color: it.color, prism: false };
  return { color: team === 'human' ? 0xFFB070 : 0x7BFFEE, prism: false };
}
export function buy(p, id) {
  const it = SHOP.find((s) => s.id === id);
  if (!it || p.owned.includes(id) || p.bank < it.price) return false;
  p.bank -= it.price; p.owned.push(id);
  if (it.type === 'skin') p.equip['skin_' + it.team] = id;
  if (it.type === 'trail') p.equip.trail = id;
  saveProfile(p);
  return true;
}
export function equip(p, id) {
  const it = SHOP.find((s) => s.id === id);
  if (!it) return;
  const slot = it.type === 'skin' ? 'skin_' + it.team : 'trail';
  p.equip[slot] = p.equip[slot] === id ? '' : id;
  saveProfile(p);
}

// Rewards for a finished run. Returns what changed so the end screen can animate it.
export function rewardRun(p, r) {
  const earned = Math.round(Math.sqrt(Math.max(0, r.score)) * 0.9) + r.wave * 5 + (r.won ? 50 : 0) + r.bossKills * 10;
  const xp = Math.round(Math.sqrt(Math.max(0, r.score)) * 2.2) + r.wave * 15 + (r.won ? 120 : 0);
  const before = { level: p.level, xp: p.xp, best: p.best[r.team], bestWave: p.bestWave[r.team], bestCombo: p.bestCombo };
  p.bank += earned; p.runs++;
  if (r.won) p.wins[r.team]++;
  p.xp += xp;
  const levels = [];
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; levels.push(p.level); }
  const record = r.score > p.best[r.team];
  if (record) p.best[r.team] = r.score;
  p.bestWave[r.team] = Math.max(p.bestWave[r.team], r.wave);
  const comboRecord = r.bestCombo > p.bestCombo;
  if (comboRecord) p.bestCombo = r.bestCombo;
  let dailyRecord = false;
  if (r.daily) {
    const d = dailyInfo();
    p.daily = { key: d.key, played: true, score: r.score, wave: r.wave };
    dailyRecord = true;
  }
  p.lastTeam = r.team;
  saveProfile(p);
  return { earned, xp, before, levels, record, comboRecord, dailyRecord };
}

// ---------- daily challenge ----------
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function dailyInfo(now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const seed = hash('hva2-' + key);
  const mod = MODIFIERS[seed % MODIFIERS.length];
  const mid = new Date(now); mid.setHours(24, 0, 0, 0);
  return { key, seed, mod, msLeft: mid - now };
}
export function dailyState(p) {
  const d = dailyInfo();
  const played = p.daily.key === d.key && p.daily.played;
  return { ...d, played, score: played ? p.daily.score : 0, wave: played ? p.daily.wave : 0 };
}
