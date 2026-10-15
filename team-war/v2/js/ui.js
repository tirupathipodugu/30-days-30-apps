// DOM side of the game: HUD, banners, callouts, toasts and the menu / upgrade / pause / end / armory screens.
import { TEAMS, UPG, RARITY, STREAKS, MAX_WAVE, SHOP, SYNERGIES, TWISTS, xpForLevel, ULT_LEVEL, KINDS, other } from './config.js';
import { currencyName } from './meta.js';
import { MATCH } from './match.js';

const $ = (s) => document.querySelector(s);
const SHARE_URL = 'https://tirupathipodugu.github.io/ideas/team-war/v2/';
const ICONS = { human: { dash: '➜', q: '▥', e: '⚑', r: '☄' }, ai: { dash: '➜', q: '≋', e: '⟡', r: '◎' } };
const BOSS_NAMES = { human: 'Magma Colossus', ai: 'Tidal Colossus' };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const COIN = { human: '🔥', ai: '💧' };

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.el = {
      hpBar: $('#heroHp i'), hpGhost: $('#heroHp u'), hpWrap: $('#heroHp'), hpTxt: $('#hpTxt'), lives: $('#lives'),
      myBase: $('#myBase i'), foeBase: $('#foeBase i'), myBaseTxt: $('#myBaseTxt'), foeBaseTxt: $('#foeBaseTxt'),
      myBaseCard: $('#myBaseCard'), foeBaseCard: $('#foeBaseCard'),
      waveTxt: $('#waveTxt'), waveProg: $('#waveProg i'), score: $('#score'), comboBox: $('#comboBox'), mult: $('#mult'),
      comboBar: $('#comboBar i'), comboN: $('#comboN'), nextGoal: $('#nextGoal'), buffs: $('#buffs'),
      bossBar: $('#bossBar'), bossFill: $('#bossBar i'), bossName: $('#bossName'), bossTxt: $('#bossTxt'), bossWarn: $('#bossWarn'),
      banner: $('#banner'), callout: $('#callout'), toasts: $('#toasts'),
      vignette: $('#vignette'), hurt: $('#hurt'), slowmo: $('#slowmo'), lowhp: $('#lowhp'), crosshair: $('#crosshair'),
    };
    // Powers are on-screen buttons again (Dash + Q/E/R) with no cooldown — keep every .ab button so they all show.
    this.ab = {};
    for (const b of document.querySelectorAll('.ab')) this.ab[b.dataset.ab] = { el: b, cd: b.querySelector('.cd'), sec: b.querySelector('.sec'), ico: b.querySelector('.ico'), ready: true, lastSec: '' };
    this.cache = {};
    this.vig = 0; this.hurtV = 0;
    this.screens = ['menu', 'shop', 'upgrade', 'pause', 'end'];
    this.refreshMute();
    for (const b of document.querySelectorAll('.muteBtn')) b.addEventListener('click', () => { this.audio.unlock(); this.audio.setMuted(!this.audio.muted); this.refreshMute(); });
  }
  refreshMute() {
    const on = !this.audio.muted;
    const svg = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="#fff"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="#fff"/><path d="m16 9 6 6M22 9l-6 6"/></svg>';
    for (const b of document.querySelectorAll('.muteBtn')) { b.innerHTML = svg; b.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound'); b.setAttribute('aria-pressed', on ? 'false' : 'true'); }
  }
  show(id) {
    for (const s of this.screens) $('#' + s).classList.toggle('on', s === id);
    document.body.classList.toggle('playing', id === null || id === 'upgrade' || id === 'pause');
    $('#topBtns').classList.toggle('hidden', id !== null);
    if (id) {
      const f = $('#' + id + ' .btn.primary, #' + id + ' .up, #' + id + ' .team');
      if (f && !document.body.classList.contains('touch')) setTimeout(() => f.focus({ preventScroll: true }), 60);
    }
  }
  setTeam(team, ultUnlocked) {
    const T = TEAMS[team], F = TEAMS[other(team)];
    document.body.classList.toggle('team-ai', team === 'ai');
    document.documentElement.style.setProperty('--foe', F.css);
    $('#heroName').textContent = T.hero;
    $('#myBaseName').textContent = 'Your ' + T.base.toLowerCase();
    $('#foeBaseName').textContent = 'Enemy ' + F.base.toLowerCase();
    const ic = ICONS[team];
    for (const k of ['dash', 'q', 'e', 'r']) {
      const a = this.ab[k];
      if (!a) continue; // only Dash remains as a HUD button; Q/E/R are floor power-ups now
      a.ico.textContent = ic[k];
      const name = k === 'dash' ? 'Dash' : T.abilities[k].name;
      a.el.setAttribute('aria-label', name);
      a.el.title = k === 'dash' ? 'Dash (Space)' : `${name} (${k.toUpperCase()}): ${T.abilities[k].desc}`;
    }
    this.team = team; this.cache = {};
  }

  // ---------- HUD ----------
  set(key, el, prop, val) { if (this.cache[key] !== val) { this.cache[key] = val; el[prop] = val; } }
  style(key, el, prop, val) { if (this.cache[key] !== val) { this.cache[key] = val; el.style[prop] = val; } }
  hud(g, dt) {
    const h = g.hero, E = this.el;
    const hp = Math.max(0, h.hp) / h.max;
    this.style('hp', E.hpBar, 'width', (hp * 100).toFixed(1) + '%');
    this.style('hpg', E.hpGhost, 'width', (hp * 100).toFixed(1) + '%');
    this.set('hpt', E.hpTxt, 'textContent', h.dead ? 'DOWN' : `${Math.ceil(h.hp)}/${h.max}`);
    const low = !h.dead && hp < 0.3;
    if (this.cache.low !== low) { this.cache.low = low; E.hpWrap.classList.toggle('low', low); E.lowhp.classList.toggle('on', low); }
    const lv = h.revives;
    if (this.cache.lives !== lv) { this.cache.lives = lv; E.lives.innerHTML = '<span></span>'.repeat(lv) || ''; E.lives.title = lv + ' revives left'; }
    const mb = g.bases[g.team], fb = g.bases[g.foe];
    this.style('mb', E.myBase, 'width', (mb.hp / mb.max * 100).toFixed(1) + '%');
    this.style('fb', E.foeBase, 'width', (fb.hp / fb.max * 100).toFixed(1) + '%');
    this.set('mbt', E.myBaseTxt, 'textContent', fmt(mb.hp));
    this.set('fbt', E.foeBaseTxt, 'textContent', fb.shield ? 'SHIELDED' : fmt(fb.hp));
    if (g.online) { // multiplayer: match clock + your level (the bar below is your XP)
      const left = Math.max(0, MATCH.dur - g.T), mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
      this.set('wave', E.waveTxt, 'innerHTML', `${mm}:${ss} <small>· LV ${g.wave}</small>`);
    } else this.set('wave', E.waveTxt, 'innerHTML', `WAVE ${g.wave} <small>/ ${MAX_WAVE}</small>${g.mod ? ' <small>★</small>' : ''}`);
    const prog = g.waveTotal ? Math.min(1, g.waveDone / g.waveTotal) : 0;
    this.style('wp', E.waveProg, 'width', (prog * 100).toFixed(1) + '%');
    this.set('score', E.score, 'textContent', fmt(g.score));
    const comboOn = g.combo >= 3;
    if (this.cache.comboOn !== comboOn) { this.cache.comboOn = comboOn; E.comboBox.classList.toggle('on', comboOn); }
    this.set('mult', E.mult, 'textContent', 'x' + g.mult);
    this.style('cbar', E.comboBar, 'transform', `scaleX(${Math.max(0, g.comboT / 3.2).toFixed(3)})`);
    this.set('cn', E.comboN, 'textContent', g.combo + ' combo');
    // the next goal within reach
    let goal = '';
    const next = STREAKS.find(([n]) => n > g.streak);
    if (g.streak >= 1 && g.streakT > 0 && next) goal = `${next[1].replace('!', '')} at ${next[0]} quick kills (${g.streak}/${next[0]})`;
    else if (g.mult < 8 && g.combo > 0) goal = `x${g.mult + 1} multiplier in ${5 - (g.combo % 5)} kills`;
    else if (g.online) {
      const nb = g.nextBoss > 0 ? g.nextBoss - g.T : -1;
      if (nb > 0 && nb < 60) goal = `Bosses join in ${Math.ceil(nb)}s`;
      else if (g.offer) goal = 'Level up! Pick a card: 1 · 2 · 3';
    } else {
      const nb = g.nextBossIn();
      if (nb === 0 && !g.boss && g.phase !== 'clear') goal = 'Boss wave!';
      else if (nb > 0) goal = `Boss in ${nb} wave${nb > 1 ? 's' : ''}`;
    }
    this.set('goal', E.nextGoal, 'textContent', goal);
    // boss
    const boss = g.boss;
    if (!!boss !== this.cache.boss) {
      this.cache.boss = !!boss; E.bossBar.classList.toggle('on', !!boss);
      if (boss) E.bossName.textContent = (g.wave === MAX_WAVE && !g.online ? 'Overlord ' : '') + BOSS_NAMES[g.foe];
    }
    if (boss) { this.style('bf', E.bossFill, 'width', (boss.hp / boss.max * 100).toFixed(1) + '%'); this.set('bt', E.bossTxt, 'textContent', g.online ? Math.round(boss.hp) + '%' : fmt(boss.hp)); }
    const warn = g.bossWarnT > 0 ? Math.ceil(g.bossWarnT) : 0;
    if (this.cache.warn !== warn) { this.cache.warn = warn; E.bossWarn.classList.toggle('on', warn > 0); E.bossWarn.textContent = warn > 0 ? `⚠ BOSS IN ${warn}` : ''; }
    // buffs
    const buffs = [];
    if (g.twist && g.phase !== 'clear') buffs.push(['★ ' + TWISTS[g.twist].name.toUpperCase(), '#FFC83D']);
    if (g.frenzy > 0) buffs.push(['FRENZY ' + g.frenzy.toFixed(0) + 's', '#FFC83D']);
    if (g.rally > 0) buffs.push(['RALLY ' + g.rally.toFixed(0) + 's', '#FFB070']);
    if (g.up.berserk && h.hp < h.max / 2 && !h.dead) buffs.push(['BERSERK', '#FF5A5A']);
    for (const s of SYNERGIES) if (g.syn[s.id]) buffs.push([s.name.toUpperCase(), '#FFC83D']);
    if (h.dead) buffs.unshift([`RESPAWN IN ${Math.max(0, h.respawnT).toFixed(1)}s`, '#FF5A5A']);
    const bh = buffs.map(([t, c]) => `<span class="buff" style="--c:${c}">${t}</span>`).join('');
    this.set('buffs', E.buffs, 'innerHTML', bh);
    // abilities — only Dash is a HUD button now; Q/E/R fire from floor power-ups (see the "what fired" toast below)
    const cd = { dash: [h.dashCd, g.dashCd()] };
    for (const k in cd) {
      const a = this.ab[k];
      if (!a) continue;
      if (k === 'dash' && g.mod === 'nodash') { a.el.classList.add('locked'); continue; }
      const [c, m] = cd[k];
      const p = c > 0 ? Math.min(1, c / (m || 1)) : 0;
      this.style('abp' + k, a.cd, '--p', p.toFixed(3));
      a.cd.style.setProperty('--p', p.toFixed(3));
      const sec = c > 0.05 ? (c >= 1 ? Math.ceil(c) + '' : c.toFixed(1)) : '';
      if (a.lastSec !== sec) { a.lastSec = sec; a.sec.textContent = sec; }
      const ready = c <= 0;
      if (ready !== a.ready) { a.ready = ready; a.el.classList.toggle('ready', ready); if (ready) { a.el.classList.remove('flash'); void a.el.offsetWidth; a.el.classList.add('flash'); } }
    }
    // "what fired" note — the sim sets g.note when the hero grabs an ability power-up (e.g. "Flame Wall!")
    if (g.note && g.note.id !== this._abNote) { this._abNote = g.note.id; this.toast(g.note.text, 'good'); }
    // screen overlays
    this.vig = Math.max(0, this.vig - dt * 1.8); this.hurtV = Math.max(0, this.hurtV - dt * 2.5);
    E.vignette.style.opacity = this.vig.toFixed(2); E.hurt.style.opacity = this.hurtV.toFixed(2);
  }
  baseHit(mine) {
    if (mine) { this.vig = Math.min(0.9, this.vig + 0.35); this.flashCard(this.el.myBaseCard); }
    else this.flashCard(this.el.foeBaseCard);
  }
  flashCard(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  heroHurt(amount) { this.hurtV = Math.min(1, this.hurtV + 0.25 + amount * 0.02); }
  slowmo(on) { this.el.slowmo.style.opacity = on ? '1' : '0'; }
  multPulse() { const m = this.el.mult; m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse'); }
  crosshair(x, y, kick, hit) {
    const c = this.el.crosshair;
    c.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (this.cache.kick !== kick) { this.cache.kick = kick; c.classList.toggle('kick', kick); }
    if (this.cache.chit !== hit) { this.cache.chit = hit; c.classList.toggle('hit', hit); }
  }
  banner(title, sub = '', color = '#fff') {
    const b = this.el.banner;
    b.querySelector('h2').textContent = title; b.querySelector('h2').style.color = color;
    b.querySelector('p').textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.bannerAt = performance.now();
  }
  callout(text, color) {
    if (performance.now() - (this.bannerAt || 0) < 1700) return;
    const c = this.el.callout;
    c.textContent = text; c.style.color = color || '';
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  }
  toast(text, cls = '') {
    const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 2700);
  }
  clearTransient() {
    this.el.toasts.innerHTML = ''; this.el.banner.classList.remove('show'); this.el.callout.classList.remove('show');
    this.vig = this.hurtV = 0; this.cache = {}; this.slowmo(false);
  }

  // ---------- menu ----------
  renderMenu(p, daily) {
    $('#pLvl').textContent = p.level; $('#pLvl2').textContent = p.level;
    const need = xpForLevel(p.level);
    $('#pXp').textContent = `${fmt(p.xp)} / ${fmt(need)} XP`;
    $('#pXpBar').style.width = (p.xp / need * 100).toFixed(1) + '%';
    const team = p.lastTeam || 'human';
    $('#pBank').innerHTML = `${COIN[team]} <b>${fmt(p.bank)}</b> ${currencyName(team)}`;
    $('#bestH').textContent = p.best.human ? `Best ${fmt(p.best.human)} · W${p.bestWave.human}` : 'New';
    $('#bestA').textContent = p.best.ai ? `Best ${fmt(p.best.ai)} · W${p.bestWave.ai}` : 'New';
    $('#dailyT').textContent = `Daily Challenge: ${daily.mod.name}`;
    $('#dailyBtns').classList.toggle('hidden', daily.played);
    $('#dailyDone').classList.toggle('hidden', !daily.played);
    if (daily.played) {
      const hrs = Math.floor(daily.msLeft / 3600000), mins = Math.floor((daily.msLeft % 3600000) / 60000);
      $('#dailyD').textContent = `Today's best: ${fmt(daily.score)} (wave ${daily.wave}). New challenge in ${hrs}h ${mins}m.`;
    } else $('#dailyD').textContent = `${daily.mod.desc} One scored attempt per day.`;
  }
  renderShop(p, team, onAct) {
    $('#shopBank').innerHTML = `${COIN[team]} <b>${fmt(p.bank)}</b> ${currencyName(team)}`;
    const groups = [['Team Human skins', (s) => s.type === 'skin' && s.team === 'human'], ['Team AI skins', (s) => s.type === 'skin' && s.team === 'ai'],
      ['Shot trails', (s) => s.type === 'trail'], ['Perks', (s) => s.type === 'perk']];
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    let html = '';
    for (const [title, f] of groups) {
      html += `<div class="sec">${title}</div><div class="shopgrid">`;
      for (const it of SHOP.filter(f)) {
        const own = p.owned.includes(it.id);
        const eq = it.type === 'skin' ? p.equip['skin_' + it.team] === it.id : it.type === 'trail' ? p.equip.trail === it.id : own;
        let sw;
        if (it.type === 'skin') sw = `linear-gradient(135deg, ${hex(it.colors.main)} 55%, ${hex(it.colors.trim)} 55%)`;
        else if (it.type === 'trail') sw = it.color === -1 ? 'linear-gradient(90deg,#ff4d4d,#ffc83d,#6be07a,#4da3ff,#c86bff)' : `linear-gradient(90deg, transparent, ${hex(it.color)})`;
        else sw = it.id === 'revive' ? 'linear-gradient(135deg,#ff6b6b,#7a1f1f)' : 'linear-gradient(135deg,#4da3ff,#1f3f7a)';
        const desc = it.desc || (it.type === 'skin' ? `${TEAMS[it.team].hero} look` : 'Colour of your shots');
        let btn;
        if (!own) btn = `<button class="btn ${p.bank >= it.price ? 'gold' : ''}" data-buy="${it.id}" ${p.bank >= it.price ? '' : 'disabled'}>Unlock · ${it.price}</button>`;
        else if (it.type === 'perk') btn = `<button class="btn" disabled>Owned ✓</button>`;
        else btn = `<button class="btn" data-eq="${it.id}">${eq ? 'Equipped ✓' : 'Equip'}</button>`;
        html += `<div class="item panel ${eq && own ? 'eq' : ''}"><div class="sw" style="background:${sw}"></div><div class="in">${it.name}</div><div class="idesc">${desc}</div>${btn}</div>`;
      }
      html += '</div>';
    }
    html += `<div class="sec">Level rewards</div><div class="shopgrid"><div class="item panel ${p.level >= ULT_LEVEL ? 'eq' : ''}"><div class="sw" style="background:linear-gradient(135deg,#FFC83D,#E8743B,#17A398)"></div><div class="in">Ultimate ability (R)</div><div class="idesc">Catapult / EMP Pulse. Unlocks at level ${ULT_LEVEL}.</div><button class="btn" disabled>${p.level >= ULT_LEVEL ? 'Unlocked ✓' : 'Level ' + p.level + ' / ' + ULT_LEVEL}</button></div></div>`;
    const list = $('#shopList');
    list.innerHTML = html;
    list.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.buy) onAct('buy', b.dataset.buy);
      if (b.dataset.eq) onAct('equip', b.dataset.eq);
    };
  }

  // ---------- upgrades ----------
  showUpgrade(g, onPick, headline) {
    $('#upTitle').textContent = headline || `Wave ${g.wave} cleared!`;
    $('#upSub').textContent = g.wave + 1 === MAX_WAVE ? 'Final wave next. Choose well.' : `Pick one upgrade · Wave ${g.wave + 1} next${g.nextBossIn() === 1 ? ' (boss!)' : ''}`;
    const cards = $('#cards');
    cards.innerHTML = '';
    this.el.banner.classList.remove('show'); this.el.callout.classList.remove('show');
    const shownAt = performance.now();
    g.offer.forEach((o, i) => {
      const u = UPG[o.id], R = RARITY[u.r];
      const b = document.createElement('button');
      b.className = 'up ' + u.r; b.style.setProperty('--rc', R.css);
      const pips = u.max > 1 && u.max < 9 ? `<span class="pips">${Array.from({ length: u.max }, (_, k) => `<i class="${k < o.level + 1 ? 'on' : ''}"></i>`).join('')}</span>` : '';
      b.innerHTML = `<span class="k">${i + 1}</span><span class="ic">${u.icon}</span><span class="txt"><span class="rar">${R.name}${o.level ? ' · Lv ' + (o.level + 1) : ''}</span><span class="nm">${u.name}</span><span class="ds">${u.desc}</span>${o.synergy ? `<span><span class="syn">SYNERGY: ${o.synergy}</span></span>` : ''}${u.risky ? '<span><span class="risk">RISKY</span></span>' : ''}${pips}</span>`;
      b.addEventListener('click', () => { if (performance.now() - shownAt > 350) onPick(i); });
      cards.appendChild(b);
    });
    this.renderBuild(g, $('#build'));
    this.show('upgrade');
  }
  renderBuild(g, el) {
    const counts = {};
    for (const id of g.picked) counts[id] = (counts[id] || 0) + 1;
    el.innerHTML = Object.entries(counts).map(([id, n]) => { const u = UPG[id]; return `<span title="${u.name} x${n}" style="--rc:${RARITY[u.r].css}">${u.icon}</span>`; }).join('');
  }

  // ---------- end screen ----------
  showEnd(d) {
    const won = d.won;
    const t = $('#endTitle'); t.textContent = won ? 'Victory!' : 'Defeat'; t.className = won ? 'win' : 'lose';
    $('#endWhy').textContent = won ? `You held the line through all ${MAX_WAVE} waves${d.daily ? ' of today\'s challenge' : ''}.` : d.reason === 'base' ? `Your ${TEAMS[d.team].base.toLowerCase()} fell on wave ${d.wave}.` : `Your ${TEAMS[d.team].hero} went down for good on wave ${d.wave}.`;
    $('#sWave').textContent = d.wave; $('#sKills').textContent = fmt(d.kills); $('#sCombo').textContent = d.bestCombo;
    $('#sTime').textContent = `${Math.floor(d.time / 60)}:${String(Math.floor(d.time % 60)).padStart(2, '0')}`;
    $('#endBest').innerHTML = d.rw.record ? '<span class="newbest">NEW BEST!</span>' : `<small>BEST ${fmt(d.prevBest)}</small>`;
    // near misses + what to try next
    const notes = [];
    if (!won) {
      if (d.prevBestWave > d.wave) notes.push(`You were ${d.prevBestWave - d.wave} wave${d.prevBestWave - d.wave > 1 ? 's' : ''} from your best (wave ${d.prevBestWave}).`);
      else if (d.wave >= d.prevBestWave && d.prevBestWave > 0) notes.push(d.wave > d.prevBestWave ? `Furthest you've ever got: wave ${d.wave}!` : `You matched your best wave (${d.wave}).`);
      notes.push(`${MAX_WAVE - d.wave + 1} wave${MAX_WAVE - d.wave + 1 > 1 ? 's' : ''} from victory.`);
    }
    if (!d.rw.record && d.prevBest > 0 && d.score >= d.prevBest * 0.7) notes.push(`Only ${fmt(d.prevBest - d.score)} points short of your best score.`);
    notes.push(`Best combo: x${d.bestCombo}${d.rw.comboRecord ? ' (record!)' : ''}.`);
    notes.push(`<span class="tip">Try next: ${d.tip}</span>`);
    $('#endNotes').innerHTML = notes.map((n) => `<div>${n}</div>`).join('');
    // score count-up
    const sc = $('#endScore'); const t0 = performance.now();
    const tick = () => { const k = Math.min(1, (performance.now() - t0) / 900); sc.textContent = fmt(d.score * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
    sc.textContent = '0'; requestAnimationFrame(tick);
    setTimeout(() => { sc.textContent = fmt(d.score); }, 1000);
    // rewards + xp bar fill
    $('#rwBank').textContent = `+${d.rw.earned} ${currencyName(d.team)} · +${d.rw.xp} XP`;
    this.animateXp(d);
    const share = `I ${won ? 'beat all 10 waves' : 'reached wave ' + d.wave} as Team ${TEAMS[d.team].short} in Fire vs Water with ${fmt(d.score)} points${d.daily ? ' (daily challenge)' : ''}. Can you beat it?`;
    $('#shareBtn').href = `https://x.com/intent/tweet?text=${encodeURIComponent(share)}&url=${encodeURIComponent(SHARE_URL)}`;
    $('#switchBtn').textContent = `Play as ${TEAMS[other(d.team)].short}`;
    $('#againBtn').textContent = d.daily ? 'Play again (practice) ▶' : 'Play again ▶';
    this.show('end');
  }
  animateXp(d) {
    const bar = $('#rwXp'), lvl = $('#rwLvl'), txt = $('#rwXpTxt'), unl = $('#rwUnlock');
    let level = d.rw.before.level, xp = d.rw.before.xp, left = d.rw.xp;
    unl.textContent = d.nextUnlock || '';
    const step = () => {
      const need = xpForLevel(level);
      const add = Math.min(left, Math.max(4, need / 50));
      xp += add; left -= add;
      if (xp >= need) {
        xp -= need; level++;
        lvl.innerHTML = `<span class="lvlup">LEVEL ${level}!</span>`;
        this.audio.play('level');
        if (level === ULT_LEVEL) unl.textContent = 'Ultimate ability unlocked! Press R in battle.';
      } else if (!lvl.querySelector('.lvlup')) lvl.textContent = `Level ${level}`;
      bar.style.width = (xp / xpForLevel(level) * 100).toFixed(1) + '%';
      txt.textContent = `${fmt(xp)} / ${fmt(xpForLevel(level))} XP`;
      if (left > 0.5) this.xpTimer = setTimeout(step, 16);
    };
    clearTimeout(this.xpTimer);
    lvl.textContent = `Level ${level}`;
    bar.style.width = (xp / xpForLevel(level) * 100).toFixed(1) + '%';
    this.xpTimer = setTimeout(step, 700);
  }
}

export { BOSS_NAMES, KINDS };

// ---------- online (multiplayer): menu name + status, roster (bottom-right), feed (top-left), name tags,
// level-up cards that never pause, and the end-of-match scoreboard. Styles live here so index.html stays untouched.
const ESC = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_CSS = { human: '#E8743B', ai: '#17A398' };
const MP_CSS = `
#mpBar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
#mpBar label { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; color: var(--muted); flex: 1; min-width: 200px; }
#mpName { flex: 1; min-width: 0; height: 40px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.08); color: var(--ink);
  font: inherit; font-weight: 800; font-size: 16px; padding: 0 12px; user-select: text; -webkit-user-select: text; }
#mpName:focus { outline: 2px solid #fff; outline-offset: 1px; }
.mpDot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #8A939B; margin-right: 6px; vertical-align: 1px; flex: none; }
.mpDot.on { background: #6BE07A; box-shadow: 0 0 8px #6BE07A; } .mpDot.wait { background: #FFC83D; }
#mpStatus { display: inline-flex; align-items: center; }
#mpUi { position: fixed; inset: 0; pointer-events: none; display: none; z-index: 5; }
body.playing #mpUi { display: block; }
#mpRoster { position: absolute; right: calc(16px + var(--safe-r)); bottom: calc(16px + var(--safe-b)); width: 236px; pointer-events: auto;
  font-size: 13px; padding: 8px 10px 6px; border-radius: 12px; }
#mpRoster .hd { display: flex; align-items: center; gap: 4px; font-weight: 800; font-size: 13px; cursor: pointer; background: none; border: 0; padding: 2px 0 4px; width: 100%; text-align: left; color: var(--ink); }
#mpRoster .hd .car { margin-left: auto; color: var(--muted); font-size: 11px; }
#mpRoster .rows { display: flex; flex-direction: column; gap: 2px; max-height: 40vh; overflow: hidden; }
#mpRoster.closed .rows { display: none; }
#mpRoster .row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 7px; white-space: nowrap; }
#mpRoster .row.me { background: rgba(255,200,61,.18); outline: 1px solid rgba(255,200,61,.55); }
#mpRoster .row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
#mpRoster .row.bot .nm { color: var(--muted); font-weight: 600; }
#mpRoster .row .you { font-size: 10px; font-weight: 900; color: #1b1b1b; background: var(--gold); border-radius: 5px; padding: 1px 4px; }
#mpRoster .row .kd { font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 800; }
#mpRoster .row .kd small { color: var(--muted); font-weight: 600; }
#mpRoster .more { color: var(--muted); font-size: 12px; padding: 2px 6px; }
#mpFeed { position: absolute; left: calc(16px + var(--safe-l)); top: calc(104px + var(--safe-t)); display: flex; flex-direction: column; gap: 4px; width: min(60vw, 340px); }
#mpFeed div { font-size: 13px; font-weight: 700; padding: 4px 9px; border-radius: 8px; background: rgba(13,17,23,.66); width: fit-content; max-width: 100%;
  animation: mpIn .25s ease-out; transition: opacity .6s; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
#mpFeed div.old { opacity: 0; }
#mpFeed b { font-weight: 900; }
@keyframes mpIn { from { transform: translateX(-12px); opacity: 0; } }
body.online #toasts { top: calc(214px + var(--safe-t)); }
body.online.touch #toasts { top: calc(250px + var(--safe-t)); }
body.online #hintR { display: none; }
#mpTags { position: absolute; inset: 0; overflow: hidden; }
.mpTag { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; will-change: transform; }
.mpTag span { font-size: 12px; font-weight: 900; color: #fff; padding: 1px 6px; border-radius: 6px; background: rgba(0,0,0,.45); white-space: nowrap;
  border-bottom: 2px solid var(--tc); text-shadow: 0 1px 2px #000; }
.mpTag span em { font-style: normal; color: var(--tc); margin-right: 3px; font-size: 10px; }
.mpTag i { display: block; width: 44px; height: 4px; border-radius: 2px; background: rgba(0,0,0,.55); overflow: hidden; }
.mpTag i b { display: block; height: 100%; background: var(--tc); }
.mpTag.me span { background: rgba(255,200,61,.85); color: #1b1b1b; text-shadow: none; }
.mpTag.dead { opacity: .45; }
#mpCards { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(96px + var(--safe-b)); display: none; gap: 8px; pointer-events: auto; align-items: stretch; }
#mpCards.on { display: flex; }
#mpCards .lead { position: absolute; left: 0; right: 0; top: -22px; text-align: center; font-size: 13px; font-weight: 900; color: var(--gold); text-shadow: 0 1px 3px #000; }
#mpCards .tm { position: absolute; left: 0; bottom: -7px; height: 3px; background: var(--gold); border-radius: 2px; transition: width .2s linear; }
#mpCards button { width: 150px; padding: 8px 10px; border-radius: 12px; border: 2px solid var(--rc); background: rgba(13,17,23,.86); color: var(--ink);
  text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font: inherit; }
#mpCards button:hover { background: rgba(40,46,56,.95); }
#mpCards .k { font-size: 11px; font-weight: 900; color: var(--muted); }
#mpCards .nm { font-weight: 900; font-size: 14px; } #mpCards .ds { font-size: 11px; color: var(--muted); line-height: 1.25; }
#mpCards .syn { font-size: 10px; font-weight: 900; color: var(--gold); }
body.touch #mpCards { bottom: calc(10px + var(--safe-b)); }
body.touch #mpCards button { width: 112px; padding: 6px 8px; } body.touch #mpCards .ds { display: none; }
#mpBoard { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92vw, 520px); padding: 18px 20px; display: none; pointer-events: none; text-align: center; }
#mpBoard.on { display: block; }
#mpBoard h2 { margin: 0 0 4px; font-size: 34px; letter-spacing: .02em; }
#mpBoard .why { color: var(--muted); font-weight: 700; margin-bottom: 10px; }
#mpBoard .mvp { font-weight: 900; color: var(--gold); margin-bottom: 10px; font-size: 16px; }
#mpBoard table { width: 100%; border-collapse: collapse; font-size: 14px; }
#mpBoard td, #mpBoard th { padding: 4px 6px; text-align: right; white-space: nowrap; } #mpBoard th { color: var(--muted); font-size: 12px; }
#mpBoard td:nth-child(2), #mpBoard th:nth-child(2) { text-align: left; } #mpBoard tr.me td { background: rgba(255,200,61,.16); }
#mpBoard .next { margin-top: 10px; color: var(--muted); font-weight: 800; }
@media (pointer: coarse), (max-width: 720px) {
  #mpRoster { width: 190px; right: calc(8px + var(--safe-r)); bottom: calc(8px + var(--safe-b)); padding: 5px 8px 4px; font-size: 12px; }
  #mpRoster .rows { max-height: 140px; }
  #mpFeed { top: calc(118px + var(--safe-t)); } #mpFeed div { font-size: 12px; }
}
@media (max-width: 560px) { /* the HUD wraps to two rows here: feed and toasts go below it */
  #mpFeed { top: calc(192px + var(--safe-t)); width: min(56vw, 300px); }
  body.online #toasts, body.online.touch #toasts { top: calc(300px + var(--safe-t)); }
}
@media (max-height: 500px) and (orientation: landscape) { #mpRoster .rows { max-height: 118px; } #mpFeed { top: calc(70px + var(--safe-t)); width: min(44vw, 300px); } }
`;

Object.assign(UI.prototype, {
  mountOnline({ name, onName }) {
    if (this.mp) return;
    const st = document.createElement('style'); st.textContent = MP_CSS; document.head.appendChild(st);
    const bar = document.createElement('div');
    bar.id = 'mpBar'; bar.className = 'panel';
    bar.innerHTML = '<label for="mpName">Your name <input id="mpName" maxlength="14" autocomplete="nickname" spellcheck="false" placeholder="Player"></label><span class="chip" id="mpStatus"><i class="mpDot wait"></i>Connecting…</span>';
    const prof = $('#menu .profile');
    if (prof) prof.after(bar); else $('#menu .wrap').prepend(bar);
    const inp = bar.querySelector('#mpName');
    inp.value = name || '';
    inp.addEventListener('input', () => onName(inp.value));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
    const ui = document.createElement('div');
    ui.id = 'mpUi';
    ui.innerHTML = '<div id="mpTags" aria-hidden="true"></div><div id="mpFeed" aria-live="polite"></div><div id="mpCards" role="group" aria-label="Level up: pick an upgrade"></div>' +
      '<div id="mpBoard" class="panel" aria-live="polite"></div><div id="mpRoster" class="panel" aria-label="Players in this match"><button class="hd" type="button"></button><div class="rows"></div></div>';
    document.body.appendChild(ui);
    const roster = ui.querySelector('#mpRoster');
    if (matchMedia('(pointer: coarse)').matches || innerWidth <= 720) roster.classList.add('closed');
    roster.querySelector('.hd').addEventListener('pointerdown', (e) => e.stopPropagation());
    roster.querySelector('.hd').addEventListener('click', () => { roster.classList.toggle('closed'); this.mpRosterKey = ''; if (this.mpLast) this.roster(...this.mpLast); });
    this.mp = { bar, inp, ui, roster, hd: roster.querySelector('.hd'), rows: roster.querySelector('.rows'), feed: ui.querySelector('#mpFeed'),
      tags: ui.querySelector('#mpTags'), cards: ui.querySelector('#mpCards'), board: ui.querySelector('#mpBoard'), tagEls: new Map() };
  },
  mpName() { return this.mp ? this.mp.inp.value : ''; },
  setOnline(on) {
    document.body.classList.toggle('online', !!on);
    if (!on) { this.nameTags([]); this.cardBar(null); this.hideBoard(); if (this.mp) this.mp.feed.innerHTML = ''; }
  },
  // status: 'connecting' | 'online' | 'offline'
  mpStatus(status, players, room) {
    if (!this.mp) return;
    const el = $('#mpStatus');
    const txt = status === 'online' ? `Online · ${players} player${players === 1 ? '' : 's'} in room ${room}` : status === 'offline' ? 'Offline · bots' : 'Connecting…';
    el.innerHTML = `<i class="mpDot ${status === 'online' ? 'on' : status === 'offline' ? '' : 'wait'}"></i>${txt}`;
    el.title = status === 'offline' ? 'The game server did not answer, so you play a solo run against bots.' : '';
  },
  // r: roster message from the server (or null when offline). myId: your hero id.
  roster(r, myId, status) {
    if (!this.mp) return;
    this.mpLast = [r, myId, status];
    const open = !this.mp.roster.classList.contains('closed');
    let head, rows = '';
    if (status !== 'online' || !r) {
      const solo = status === 'offline' || status === 'solo';
      // Fake teammates on the Fire (human) side so a solo run looks populated. Fixed K/D so the roster doesn't flicker.
      const mates = solo ? [['Tirupathi', 7, 1], ['Andrew', 4, 2], ['Zhi', 3, 0]] : [];
      head = `<i class="mpDot ${solo ? 'on' : 'wait'}"></i>${solo ? (mates.length + 1) + ' playing' : 'Connecting…'}`;
      if (solo) {
        rows = '<div class="row me"><i class="mpDot" style="background:var(--team);box-shadow:none"></i><span class="nm">You</span><span class="you">YOU</span></div>';
        for (const [nm, k, d] of mates) rows += `<div class="row"><i class="mpDot" style="background:${TEAM_CSS.human};box-shadow:none"></i><span class="nm">${ESC(nm)}</span><span class="kd">${k}<small>/${d}</small></span></div>`;
      }
    } else {
      const list = r.p.slice().sort((a, b) => (b[0] === myId) - (a[0] === myId) || b[3] - a[3] || a[4] - b[4]);
      head = `<i class="mpDot on"></i>Online · ${r.n} player${r.n === 1 ? '' : 's'}`;
      const max = 7, shown = list.slice(0, max);
      for (const p of shown) {
        const side = p[2] === 0 ? 'human' : 'ai', me = p[0] === myId;
        rows += `<div class="row${me ? ' me' : ''}${p[6] ? ' bot' : ''}"><i class="mpDot" style="background:${TEAM_CSS[side]};box-shadow:none"></i><span class="nm">${ESC(p[1])}</span>${me ? '<span class="you">YOU</span>' : ''}<span class="kd">${p[3]}<small>/${p[4]}</small></span></div>`;
      }
      if (list.length > max) rows += `<div class="more">+${list.length - max} more</div>`;
    }
    const key = head + rows + open;
    if (key === this.mpRosterKey) return;
    this.mpRosterKey = key;
    this.mp.hd.innerHTML = head + `<span class="car">${open ? 'K/D ▾' : '▴'}</span>`;
    this.mp.hd.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.mp.rows.innerHTML = rows;
  },
  feed(html) {
    if (!this.mp) return;
    const d = document.createElement('div'); d.innerHTML = html;
    const f = this.mp.feed;
    f.appendChild(d);
    while (f.children.length > 5) f.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 6000);
    setTimeout(() => d.remove(), 6700);
  },
  // list: [{id, name, side, sx, sy, me, hp (0..1), dead, lvl}] in screen pixels
  nameTags(list) {
    if (!this.mp) return;
    const m = this.mp.tagEls, seen = new Set();
    for (const t of list) {
      let el = m.get(t.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'mpTag';
        el.innerHTML = '<span></span><i><b></b></i>';
        this.mp.tags.appendChild(el); m.set(t.id, el); el._k = '';
      }
      seen.add(t.id);
      const k = t.name + t.side + t.me + t.dead + t.lvl;
      if (el._k !== k) {
        el._k = k;
        el.className = 'mpTag' + (t.me ? ' me' : '') + (t.dead ? ' dead' : '');
        el.style.setProperty('--tc', TEAM_CSS[t.side]);
        el.firstChild.innerHTML = `<em>${t.lvl}</em>${ESC(t.me ? 'You' : t.name)}`;
      }
      const w = Math.round(Math.max(0, Math.min(1, t.hp)) * 100);
      if (el._w !== w) { el._w = w; el.lastChild.firstChild.style.width = w + '%'; }
      el.style.transform = `translate(${t.sx.toFixed(0)}px, ${t.sy.toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of m) if (!seen.has(id)) { el.remove(); m.delete(id); }
  },
  // offer: [{id, level, synergy}] or null. Never pauses: pick with 1/2/3 or a tap; auto-picks when time runs out.
  cardBar(offer, secs, onPick) {
    if (!this.mp) return;
    const c = this.mp.cards;
    const key = offer ? offer.map((o) => o.id + o.level).join(',') : '';
    if (key !== this.mpCardKey) {
      this.mpCardKey = key;
      c.classList.toggle('on', !!offer);
      c.innerHTML = '';
      if (offer) {
        const lead = document.createElement('div'); lead.className = 'lead'; lead.textContent = 'LEVEL UP! Pick one · 1 · 2 · 3'; c.appendChild(lead);
        offer.forEach((o, i) => {
          const u = UPG[o.id], R = RARITY[u.r];
          const b = document.createElement('button'); b.type = 'button'; b.style.setProperty('--rc', R.css);
          b.innerHTML = `<span class="k">${i + 1} · ${u.icon} ${R.name}${o.level ? ' · Lv ' + (o.level + 1) : ''}</span><span class="nm">${u.name}</span><span class="ds">${o.id === 'repair' ? 'Repair 20% of your base' : u.desc}</span>${o.synergy ? `<span class="syn">SYNERGY: ${ESC(o.synergy)}</span>` : ''}`;
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPick(i); });
          c.appendChild(b);
        });
        const tm = document.createElement('i'); tm.className = 'tm'; c.appendChild(tm);
        this.audio.play('level');
      }
    }
    if (offer) { const tm = c.querySelector('.tm'); if (tm) tm.style.width = (Math.max(0, Math.min(1, secs / MATCH.offerTime)) * 100).toFixed(1) + '%'; }
  },
  showBoard(e, myId, myTeam) {
    if (!this.mp) return;
    const won = e.winner === myTeam, draw = e.winner === 'draw';
    const title = draw ? 'Draw!' : won ? 'Victory!' : 'Defeat';
    const why = e.reason === 'base' ? `Team ${TEAMS[e.winner].short} destroyed the ${TEAMS[other(e.winner)].base.toLowerCase()}.`
      : draw ? 'Time is up and both bases are even.' : `Time is up. Team ${TEAMS[e.winner].short} kept more of its base.`;
    const rows = e.board.slice(0, 12).map((p) => `<tr class="${p[0] === myId ? 'me' : ''}"><td><i class="mpDot" style="background:${TEAM_CSS[p[2]]};box-shadow:none"></i></td><td>${ESC(p[1])}${p[0] === myId ? ' (you)' : ''}</td><td>${p[3]}</td><td>${p[4]}</td><td>${p[5]}</td><td>${p[6]}</td></tr>`).join('');
    this.mp.board.innerHTML = `<h2 style="color:${draw ? '#fff' : won ? 'var(--gold)' : '#FF7A6B'}">${title}</h2><div class="why">${why}</div>` +
      (e.mvp ? `<div class="mvp">★ MVP: ${ESC(e.mvp.name)} (Team ${TEAMS[e.mvp.side].short})</div>` : '') +
      `<table><tr><th></th><th>Player</th><th>Kills</th><th>Deaths</th><th>Lv</th><th>Score</th></tr>${rows}</table><div class="next" id="mpNext">Next match in ${e.next || 8}…</div>`;
    this.mp.board.classList.add('on');
    clearInterval(this.boardTimer);
    let n = e.next || 8;
    this.boardTimer = setInterval(() => { n--; const el = $('#mpNext'); if (el) el.textContent = n > 0 ? `Next match in ${n}…` : 'Starting…'; if (n <= 0) clearInterval(this.boardTimer); }, 1000);
  },
  hideBoard() { if (this.mp) { this.mp.board.classList.remove('on'); clearInterval(this.boardTimer); } },
});
