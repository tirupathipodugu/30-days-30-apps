// Progress: only the numbers (never a photo) are stored, on this device, and only when you
// choose "Save this scan". "Delete my data" removes everything in one tap.

import { MEASURES, NAMES } from './measures.js';

const KEY = 'skin-check:scans';
const PROFILE = 'skin-check:profile';

export function loadScans() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveScan(res, light) {
  const list = loadScans();
  const entry = { t: Date.now(), scores: {}, light: Math.round(light ?? NaN) };
  for (const k of MEASURES) entry.scores[k] = res.m[k].score;
  list.push(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-104)));
    return true;
  } catch {
    return false;
  }
}

export function saveProfile(p) {
  try { localStorage.setItem(PROFILE, JSON.stringify(p)); } catch { /* fine */ }
}
export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE) || 'null'); } catch { return null; }
}

export function deleteAll() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(PROFILE);
  } catch { /* nothing stored */ }
}

const DAY = 86400000;
function ago(ms) {
  const days = Math.round(ms / DAY);
  if (days < 1) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} weeks ago`;
}

/**
 * Trends: compare the latest scan with the one closest to 4 weeks earlier (or the first one).
 * Only changes beyond the measurement's own wobble (5 points) are reported as changes.
 */
export function trends(list) {
  if (list.length < 2) return null;
  const last = list[list.length - 1];
  const target = last.t - 28 * DAY;
  let base = list[0];
  for (const s of list.slice(0, -1)) if (Math.abs(s.t - target) < Math.abs(base.t - target)) base = s;
  const lines = [];
  for (const k of MEASURES) {
    const a = base.scores[k], b = last.scores[k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const diff = b - a;
    const name = NAMES[k].split(' ')[0].replace('/', '').toLowerCase();
    if (Math.abs(diff) < 5) { lines.push({ k, text: `${NAMES[k]}: steady since ${ago(last.t - base.t)}`, dir: 0 }); continue; }
    // Percentages from a small base exaggerate (12 → 0 is not "100% better"), so use points there.
    const pct = a >= 20 ? Math.round(Math.abs(diff) / a * 100) : null;
    const amount = pct !== null && pct <= 300 ? `${pct}%` : `${Math.abs(diff)} points`;
    lines.push({ k, text: `${NAMES[k]} ${diff < 0 ? 'down' : 'up'} ${amount} since ${ago(last.t - base.t)}`, dir: diff < 0 ? -1 : 1, name });
  }
  const lightNote = Number.isFinite(base.light) && Number.isFinite(last.light) && Math.abs(base.light - last.light) > 8
    ? `The light was ${last.light > base.light ? 'brighter' : 'dimmer'} this time than ${ago(last.t - base.t)}, so compare with care.`
    : null;
  return { lines, lightNote, since: base.t };
}

export function history(list) {
  return list.slice().reverse().map((s) => ({ date: new Date(s.t), scores: s.scores }));
}
