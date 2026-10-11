// The interface: rate readout with a live ECG trace, sound, help, the info panel, the tour card, the arrest
// message, the hover label and the loading bar. The controls stay visible; nothing fades on idle.

import { DISCLAIMER } from './heart-facts.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createUi({ onRate, onSound, onFlyTo, onClosePanel, onTour, onCutaway, onReset, onRestart }) {
  const bpmEl = $('bpm'), modeEl = $('mode'), beatsEl = $('beats');
  const rateBtn = $('rate'), ratebox = $('ratebox'), slider = $('slider'), rateOut = $('rateOut');
  const soundBtn = $('sound'), soundLabel = $('soundLabel'), tip = $('tip');
  const panel = $('panel'), panelTitle = $('panelTitle'), panelBody = $('panelBody'), flyBtn = $('flyTo');
  const tourcard = $('tourcard');
  let shownBpm = -1, shownBeats = -1, shownMode = '', tipTimer = 0, panelLive = null;

  // Rate: the readout opens a slider for the resting rate.
  rateBtn.addEventListener('click', () => {
    const open = ratebox.hidden;
    ratebox.hidden = !open;
    rateBtn.setAttribute('aria-expanded', String(open));
    if (open) slider.focus();
  });
  slider.addEventListener('input', () => { rateOut.textContent = slider.value; onRate(Number(slider.value)); });
  addEventListener('pointerdown', (e) => {
    if (!ratebox.hidden && !ratebox.contains(e.target) && !rateBtn.contains(e.target)) { ratebox.hidden = true; rateBtn.setAttribute('aria-expanded', 'false'); }
  });

  // Sound is on by default; browsers only let it start after the first gesture, which main.js listens for.
  const setSoundLabel = (on) => {
    soundBtn.setAttribute('aria-pressed', String(on));
    soundLabel.textContent = on ? 'Sound on' : 'Sound off';
  };
  soundBtn.addEventListener('click', async () => {
    const want = soundBtn.getAttribute('aria-pressed') !== 'true';
    setSoundLabel(want);
    setSoundLabel(await onSound(want));
  });

  const guide = $('guide');
  $('help').addEventListener('click', () => guide.showModal());
  $('panelClose').addEventListener('click', () => onClosePanel());
  flyBtn.addEventListener('click', () => onFlyTo());
  $('cutaway').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    onCutaway(on);
  });
  $('tour').addEventListener('click', () => onTour('start'));
  $('tourNext').addEventListener('click', () => onTour('next'));
  $('tourBack').addEventListener('click', () => onTour('back'));
  $('tourEnd').addEventListener('click', () => onTour('end'));
  $('reset').addEventListener('click', () => onReset());
  $('restart').addEventListener('click', () => onRestart());

  // The ECG trace: a scrolling line drawn from the cardiac cycle (flat when the heart stops).
  const ecg = $('ecg'), ectx = ecg.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  ecg.width = 64 * dpr; ecg.height = 22 * dpr;
  const trace = new Float32Array(64);
  let traceHead = 0, traceAcc = 0, slot = 0;
  const drawEcg = (dt, v) => {
    traceAcc += dt;
    if (Math.abs(v) > Math.abs(slot)) slot = v;   // keep the peak, so a narrow QRS is never skipped
    let moved = false;
    while (traceAcc > 1 / 40) { traceAcc -= 1 / 40; trace[traceHead] = slot; traceHead = (traceHead + 1) % trace.length; moved = true; slot = v; }
    if (!moved) return;
    ectx.clearRect(0, 0, ecg.width, ecg.height);
    ectx.lineWidth = 1.4 * dpr;
    ectx.lineJoin = 'round';
    ectx.strokeStyle = '#ff7a6b';
    ectx.beginPath();
    for (let i = 0; i < trace.length; i++) {
      const y = ecg.height * (0.62 - 0.5 * trace[(traceHead + i) % trace.length]);
      const x = (i / (trace.length - 1)) * ecg.width;
      if (i) ectx.lineTo(x, y); else ectx.moveTo(x, y);
    }
    ectx.stroke();
  };

  return {
    setSoundLabel,
    update(dt, bpm, beats, mode, ecgValue) {
      const b = mode === 'stopped' ? '0' : String(Math.round(bpm));
      if (b !== shownBpm) { bpmEl.textContent = b; shownBpm = b; }
      if (beats !== shownBeats) { beatsEl.textContent = fmt.format(beats); shownBeats = beats; }
      if (mode !== shownMode) {
        modeEl.textContent = { rest: 'Rest', live: 'Live', strain: 'Racing', failing: 'Failing', stopped: 'Stopped' }[mode];
        modeEl.className = 'mode ' + mode;
        shownMode = mode;
      }
      drawEcg(dt, ecgValue);
      if (panelLive) panelLive();
    },
    setRest(bpm) { if (document.activeElement !== slider) { slider.value = bpm; rateOut.textContent = bpm; } },
    showTip(x, y, text, touch) {
      tip.textContent = text;
      const w = tip.offsetWidth || 120;
      const tx = Math.min(innerWidth - w - 8, x + 14), ty = Math.max(8, y - 40);
      tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
      tip.hidden = false;
      clearTimeout(tipTimer);
      if (touch) tipTimer = setTimeout(() => { tip.hidden = true; }, 1600);
    },
    hideTip() { clearTimeout(tipTimer); tip.hidden = true; },

    /** Fill and open the panel. info: { name, does, facts, from, to, surprise, note }; live() returns extra HTML. */
    openPanel(info, { fly = true, live = null } = {}) {
      panelTitle.textContent = info.name;
      let html = `<p>${esc(info.does)}</p>`;
      if (live) html += '<div class="live" id="panelLive"></div>';
      if (info.facts?.length) html += `<h3>Key facts</h3><dl>${info.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
      if (info.from || info.to) html += `<h3>Blood flow</h3><div class="flow">${info.from ? `<div><span>Receives from</span><br>${esc(info.from)}</div>` : ''}${info.to ? `<div><span>Sends to</span><br>${esc(info.to)}</div>` : ''}</div>`;
      if (info.surprise) html += `<h3>Surprising fact</h3><p class="surprise">${esc(info.surprise)}</p>`;
      if (info.note) html += `<p class="note">${esc(info.note)}</p>`;
      panelBody.innerHTML = html;
      panelBody.scrollTop = 0;
      flyBtn.hidden = !fly;
      panelLive = null;
      if (live) {
        const el = $('panelLive');
        let last = '';
        panelLive = () => { const h = live(); if (h !== last) { el.innerHTML = h; last = h; } };
        panelLive();
      }
      panel.hidden = false;
      document.body.classList.add('sheet-open');
    },
    closePanel() {
      panel.hidden = true;
      panelLive = null;
      document.body.classList.remove('sheet-open');
    },
    panelOpen: () => !panel.hidden,
    /** The height the bottom sheet covers (0 when the panel is a side panel or closed). */
    sheetCover() {
      if (!panel.hidden) {
        const r = panel.getBoundingClientRect();
        return r.left < 4 && r.bottom >= innerHeight - 2 ? r.height : 0;
      }
      // On a portrait phone the tour card sits low too: keep the heart above it.
      if (!tourcard.hidden && innerWidth <= 720 && innerHeight > innerWidth) return innerHeight - tourcard.getBoundingClientRect().top;
      return 0;
    },

    showTour(i, n, stop) {
      $('tourStep').textContent = `Stop ${i + 1} of ${n}`;
      $('tourTitle').textContent = stop.title;
      $('tourText').textContent = stop.text;
      $('tourBack').disabled = i === 0;
      $('tourNext').querySelector('span').textContent = i === n - 1 ? 'Finish' : 'Next';
      tourcard.hidden = false;
    },
    hideTour() { tourcard.hidden = true; },

    showArrest(title, text, careTitle = '', care = []) {
      $('arrestTitle').textContent = title;
      $('arrestText').textContent = text;
      $('careTitle').textContent = careTitle;
      $('careList').replaceChildren(...care.map((tip) => {
        const li = document.createElement('li');
        li.textContent = tip;
        return li;
      }));
      $('care').hidden = !care.length;
      $('arrest').hidden = false;
      $('restart').focus({ preventScroll: true });
    },
    hideArrest() { $('arrest').hidden = true; },

    setCutaway(on) { $('cutaway').setAttribute('aria-pressed', String(on)); },
    setCredit(text, href) {
      const c = $('credit');
      c.textContent = text;
      c.href = href;
    },
    progress(f) {
      const el = $('loading');
      if (f < 0) { el.classList.add('indeterminate'); $('loadPct').textContent = ''; return; }
      el.classList.remove('indeterminate');
      $('loadBar').style.width = `${Math.round(f * 100)}%`;
      $('loadPct').textContent = `${Math.round(f * 100)}%`;
    },
    loaded() { const el = $('loading'); el.classList.add('done'); setTimeout(() => { el.hidden = true; }, 700); },
    loadFailed() { $('loading').querySelector('p').textContent = 'The heart could not load. Please reload the page.'; },
    disclaimer: DISCLAIMER,
  };
}
