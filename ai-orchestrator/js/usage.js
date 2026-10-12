// Usage: how many answers each provider gave today, and which ones are resting after hitting a free
// limit. Stored in this browser only. A rest lasts until the provider's retry time, or 10 minutes
// for a per-minute limit, or until tomorrow if it keeps failing.

const DAY = () => new Date().toISOString().slice(0, 10);
const KEY = 'orch-usage';

function load() {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) || '{}');
    return u.day === DAY() ? u : { day: DAY(), count: {}, rest: {}, strikes: {} };
  } catch {
    return { day: DAY(), count: {}, rest: {}, strikes: {} };
  }
}
function save(u) { try { localStorage.setItem(KEY, JSON.stringify(u)); } catch {} }

export function countAnswer(id) {
  const u = load();
  u.count[id] = (u.count[id] || 0) + 1;
  u.strikes[id] = 0;
  save(u);
}

/** A provider hit a limit: rest it. Repeated limits today rest it longer. */
export function rest(id, seconds) {
  const u = load();
  u.strikes[id] = (u.strikes[id] || 0) + 1;
  const secs = seconds || (u.strikes[id] >= 3 ? 6 * 3600 : 600);
  u.rest[id] = Date.now() + secs * 1000;
  save(u);
}

export function isResting(id) {
  const until = load().rest[id];
  return Boolean(until && until > Date.now());
}

export function restingFor(id) {
  const until = load().rest[id];
  return until && until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
}

export function countToday(id) { return load().count[id] || 0; }
