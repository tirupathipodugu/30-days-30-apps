// DOM side of the game: HUD, banners, callouts, toasts and the menu / upgrade / pause / end / armory screens.
import { TEAMS, UPG, RARITY, STREAKS, MAX_WAVE, SHOP, SYNERGIES, TWISTS, xpForLevel, ULT_LEVEL, KINDS, other } from './config.js';
import { currencyName } from './meta.js';

const $ = (s) => document.querySelector(s);
const SHARE_URL = 'https://tirupathipodugu.github.io/ideas/team-war/v2/';
const ICONS = { human: { dash: '➜', q: '▥', e: '⚑', r: '☄' }, ai: { dash: '➜', q: '≋', e: '⟡', r: '◎' } };
const BOSS_NAMES = { human: 'Siege Giant', ai: 'Mainframe Titan' };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const COIN = { human: '🪙', ai: '⚙️' };

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
      a.ico.textContent = ic[k];
      const name = k === 'dash' ? 'Dash' : T.abilities[k].name;
      a.el.setAttribute('aria-label', name);
      a.el.title = k === 'dash' ? 'Dash (Space)' : `${name} (${k.toUpperCase()}): ${T.abilities[k].desc}`;
    }
    this.ab.r.el.classList.toggle('locked', !ultUnlocked);
    this.ab.r.el.querySelector('.key').textContent = ultUnlocked ? 'R' : 'LV ' + ULT_LEVEL;
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
    this.set('wave', E.waveTxt, 'innerHTML', `WAVE ${g.wave} <small>/ ${MAX_WAVE}</small>${g.mod ? ' <small>★</small>' : ''}`);
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
    else {
      const nb = g.nextBossIn();
      if (nb === 0 && !g.boss && g.phase !== 'clear') goal = 'Boss wave!';
      else if (nb > 0) goal = `Boss in ${nb} wave${nb > 1 ? 's' : ''}`;
    }
    this.set('goal', E.nextGoal, 'textContent', goal);
    // boss
    const boss = g.boss;
    if (!!boss !== this.cache.boss) {
      this.cache.boss = !!boss; E.bossBar.classList.toggle('on', !!boss);
      if (boss) E.bossName.textContent = (g.wave === MAX_WAVE ? 'Overlord ' : '') + BOSS_NAMES[g.foe];
    }
    if (boss) { this.style('bf', E.bossFill, 'width', (boss.hp / boss.max * 100).toFixed(1) + '%'); this.set('bt', E.bossTxt, 'textContent', fmt(boss.hp)); }
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
    // abilities
    const cd = { dash: [h.dashCd, g.dashCd()], q: [h.cd.q, h.cdMax.q], e: [h.cd.e, h.cdMax.e], r: [h.cd.r, h.cdMax.r] };
    for (const k in cd) {
      const a = this.ab[k];
      if (k === 'r' && !g.ultUnlocked()) continue;
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
    const share = `I ${won ? 'beat all 10 waves' : 'reached wave ' + d.wave} as Team ${TEAMS[d.team].short} in Human vs AI 2.0 with ${fmt(d.score)} points${d.daily ? ' (daily challenge)' : ''}. Can you beat it?`;
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
