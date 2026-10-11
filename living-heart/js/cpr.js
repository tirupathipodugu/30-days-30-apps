// CPR practice: check, call, push to the beat until the AED arrives, then the shock. It owns its own card, the
// press pad over the heart, the metronome and the scorecard; main.js moves the heart and the threads.

import { CPR } from './cpr-facts.js';

const $ = (id) => document.getElementById(id);
const BEAT = 60 / 110;          // the metronome: 110 a minute, the middle of the 100–120 range
const FILL = 0.07;              // seconds of press to reach full depth on the cue (a quick tap gets there)
const RECOIL = 0.14;            // seconds for the chest to come back up on the cue
const SET = 30;
const AED_GOOD = 60;            // about two sets of good pushes bring the AED...
const AED_ACTIVE = 80;          // ...or about 80 s of steady pushing, so nobody gets stuck

export class CprCoach {
  constructor({ sound, now, reduced, coarse, onCompress, onShock, onExit, onTryAgain, onDone }) {
    Object.assign(this, { sound, now, reduced, coarse, onCompress, onShock, onExit, onTryAgain, onDone });
    this.active = false;
    this.step = '';
    this.depth = 0;
    this.card = $('cpr');
    this.pad = $('cprPad');
    this.fillText();
    this.bind();
  }

  // ---- Text: all of it comes from cpr-facts.js ----
  fillText() {
    const c = CPR.compress, a = CPR.aed, s = CPR.saved;
    const set = (id, text) => { $(id).textContent = text; };
    set('giveCprLabel', CPR.arrestButton);
    set('cprPromptText', CPR.prompt);
    set('cprPromptButton', CPR.promptButton);
    set('cprExitLabel', CPR.exit);
    set('cprDisclaimer', CPR.disclaimer);
    set('cprHow', c.how);
    set('depthLabel', c.depthLabel);
    set('depthMark', c.depthMark);
    set('pushLabel', c.push);
    set('countLabel', c.count);
    set('rateLabel', c.rateLabel);
    set('cprExplain', c.explain);
    set('aedLabel', c.aedLabel);
    set('cprNote', c.note);
    set('padLabel1', a.padsLabel1);
    set('padLabel2', a.padsLabel2);
    set('padsOnLabel', a.padsButton);
    set('shockLabel', a.shock);
    set('scoreTitle', s.scoreTitle);
    set('learnTitle', s.learnTitle);
    set('cprCourse', s.course);
    set('cprAgainLabel', s.tryAgain);
    set('cprCloseLabel', s.done);
    $('learnList').replaceChildren(...s.points.map((p) => { const li = document.createElement('li'); li.textContent = p; return li; }));
  }

  bind() {
    $('cprNext').addEventListener('click', () => this.go(this.step === 'check' ? 'call' : 'compress'));
    $('cprExit').addEventListener('click', () => { this.close(); this.onExit(); });
    $('padsOn').addEventListener('click', () => this.analyse());
    $('shockBtn').addEventListener('click', () => this.shock());
    $('cprAgain').addEventListener('click', () => this.onTryAgain());
    $('cprClose').addEventListener('click', () => { this.close(); this.onDone(); });

    // Pushing: the pad over the heart and the Push button press on pointerdown and let go on pointerup.
    for (const el of [this.pad, $('pushBtn')]) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
        this.press();
      });
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(end, () => this.release());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // The Push button's own click (from Enter or Space while focused) is handled by the key listener below.
    $('pushBtn').addEventListener('click', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (this.step !== 'compress' || (e.key !== ' ' && e.key !== 'Enter')) return;
      const f = document.activeElement;
      if (f && f.tagName === 'BUTTON' && f.id !== 'pushBtn') return;   // Enter on another button still presses it
      e.preventDefault();
      if (!e.repeat) this.press();
    }, true);
    addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') this.release(); }, true);
    addEventListener('blur', () => this.release());
  }

  // ---- The flow ----
  /** Begin at the check. collapseAt: when the heart stopped (for the time to the first push). */
  start(collapseAt) {
    this.active = true;
    this.collapseAt = collapseAt;
    this.pressed = false;
    this.depth = 0;
    this.presses = [];       // every push time
    this.rates = [];         // the rate at each push that had one
    this.good = 0;
    this.activeTime = 0;
    this.setNo = 1;
    this.inSet = 0;
    this.lastTick = -1;
    this.lastPress = -Infinity;
    this.cue = '';
    this.zone = undefined;
    this.rate = 0;
    $('cprNudge').hidden = true;
    $('aedFill').style.transform = 'scaleX(0)';
    this.card.hidden = false;
    document.body.classList.add('cpr-on');
    $('cprPrompt').hidden = true;
    this.go('check');
  }

  close() {
    this.active = false;
    this.step = '';
    this.pressed = false;
    this.card.hidden = true;
    this.pad.hidden = true;
    $('flash').hidden = true;
    this.sound.chargeStop();
    clearTimeout(this.timer);
    document.body.classList.remove('cpr-on');
  }

  go(step) {
    this.step = step;
    clearTimeout(this.timer);
    const t = this.now();
    $('cprIntro').hidden = !(step === 'check' || step === 'call');
    $('cprPushStep').hidden = step !== 'compress';
    $('cprAedStep').hidden = step !== 'aed';
    $('cprDone').hidden = step !== 'saved';
    $('cprExit').hidden = step === 'saved';
    this.card.querySelector('.cpr-head').hidden = step === 'saved';
    this.pad.hidden = step !== 'compress';
    this.card.dataset.step = step;
    const info = { check: CPR.check, call: CPR.call, compress: CPR.compress, aed: CPR.aed, saved: { step: '', title: CPR.saved.title } }[step];
    $('cprStep').textContent = info.step;
    $('cprStep').hidden = !info.step;
    $('cprTitle').textContent = info.title;
    if (step === 'check' || step === 'call') {
      $('artCheck').style.display = step === 'check' ? '' : 'none';
      $('artCall').style.display = step === 'call' ? '' : 'none';
      $('cprText').textContent = info.text;
      $('cprNextLabel').textContent = info.button;
      $('cprNext').focus({ preventScroll: true });
    } else if (step === 'compress') {
      this.stepAt = t;
      $('cprInput').textContent = this.coarse.matches ? CPR.compress.inputTouch : CPR.compress.inputMouse;
      this.setCue(CPR.compress.beat);
      this.drawCount();
      $('pushBtn').focus({ preventScroll: true });
    } else if (step === 'aed') {
      this.pressed = false;
      this.depth = 0;
      $('aedStatus').textContent = CPR.aed.pads;
      $('padsOn').hidden = false;
      $('shockBtn').hidden = true;
      this.card.classList.remove('analysing');
      this.sound.beep(880, 0.15);
      $('padsOn').focus({ preventScroll: true });
    } else if (step === 'saved') {
      this.drawScore();
      $('cprAgain').focus({ preventScroll: true });
    }
  }

  analyse() {
    $('padsOn').hidden = true;
    $('aedStatus').textContent = CPR.aed.analysing;
    this.card.classList.add('analysing');
    let n = 0;
    const beep = () => { this.sound.beep(740, 0.09); if (++n < 4) this.timer = setTimeout(beep, 650); };
    beep();
    this.timer = setTimeout(() => this.advise(), 2800);
  }

  advise() {
    this.card.classList.remove('analysing');
    $('aedStatus').textContent = `${CPR.aed.advised} ${CPR.aed.charging}`;
    const btn = $('shockBtn');
    btn.hidden = false;
    btn.disabled = true;
    this.sound.charge();
    this.timer = setTimeout(() => {
      $('aedStatus').textContent = CPR.aed.advised;
      btn.disabled = false;
      btn.classList.add('ready');
      btn.focus({ preventScroll: true });
    }, 1700);
  }

  shock() {
    const btn = $('shockBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.remove('ready');
    this.sound.shock();
    // A white flash, or a gentle fade when the visitor prefers less motion (the CSS picks which).
    const flash = $('flash');
    flash.hidden = true;
    void flash.offsetWidth;
    flash.hidden = false;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { flash.hidden = true; }, 1400);
    $('aedStatus').textContent = CPR.aed.shocked;
    this.onShock();
    this.timer = setTimeout(() => this.go('saved'), 1600);
  }

  // ---- Pushing ----
  press() {
    if (this.step !== 'compress' || this.pressed) return;
    const t = this.now();
    this.pressed = true;
    this.pressAt = t;
    const prev = this.lastPress;
    this.presses.push(t);
    this.lastPress = t;
    // The rate: from the last few gaps, so one uneven push doesn't swing it.
    if (t - prev < 2) {
      const recent = this.presses.slice(-4);
      const rate = 60 * (recent.length - 1) / (recent[recent.length - 1] - recent[0]);
      this.rate = rate;
      this.rates.push(rate);
      if (rate >= 100 && rate <= 120) this.good++;
    }
    this.inSet++;
    if (this.inSet > SET) { this.inSet = 1; this.setNo++; }
    this.drawCount();
    this.setCue(CPR.compress.depthHold);
    this.sound.push();
    // A short buzz per push on phones (browsers only allow it once the page has been touched).
    try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(28); } catch { /* not supported */ }
    $('pushBtn').classList.add('down');
    this.onCompress(t);
  }

  release() {
    if (!this.pressed) return;
    this.pressed = false;
    $('pushBtn').classList.remove('down');
    if (this.step !== 'compress') return;
    const held = this.now() - this.pressAt;
    if (this.inSet === SET) this.setCue(CPR.compress.setDone(this.setNo));
    else if (held < FILL * 0.6) this.setCue(CPR.compress.depthShallow);
    else this.setCue(CPR.compress.depthRelease);
  }

  setCue(text) {
    if (text === this.cue) return;
    this.cue = text;
    $('cprCue').textContent = text;
  }

  drawCount() {
    $('countN').textContent = String(this.inSet);
    $('countSet').textContent = CPR.compress.set(this.setNo);
  }

  /** Called every frame by main.js. */
  update(t, dt) {
    if (!this.active) return;
    // The chest: down while held, back up on release.
    const goal = this.pressed ? 1 : 0;
    this.depth += (goal ? 1 / FILL : -1 / RECOIL) * dt;
    this.depth = Math.min(1, Math.max(0, this.depth));
    if (this.step !== 'compress') return;

    // The metronome: a tick on the beat, and a ring on the Push button that flashes with it.
    const sinceStep = t - this.stepAt;
    const beatNo = Math.floor(sinceStep / BEAT);
    if (beatNo !== this.lastTick) { this.lastTick = beatNo; this.sound.tick(); }
    const ph = (sinceStep % BEAT) / BEAT;
    $('pushRing').style.opacity = (Math.exp(-ph * 5) * 0.9).toFixed(3);
    $('depthFill').style.transform = `scaleY(${this.depth.toFixed(3)})`;

    if (this.pressed && t - this.pressAt > 0.8) this.setCue(CPR.compress.depthLong);

    // The rate meter: 60–160 a minute across the track; nothing shown once pushing pauses.
    const live = t - this.lastPress < 2 && this.rates.length > 0;
    const zone = !live ? 'idle' : this.rate < 100 ? 'slow' : this.rate > 120 ? 'fast' : 'good';
    if (zone !== this.zone || (live && Math.round(this.rate) !== this.shownRate)) {
      this.zone = zone;
      this.shownRate = live ? Math.round(this.rate) : -1;
      $('rateValue').textContent = live ? `${this.shownRate}${CPR.compress.rateUnit}` : '—';
      $('rateZone').textContent = live ? CPR.compress[zone] : CPR.compress.rateIdle;
      $('cprPushStep').dataset.zone = zone;
      const x = live ? Math.min(1, Math.max(0, (this.rate - 60) / 100)) : 0;
      $('rateDot').style.left = `${(x * 100).toFixed(1)}%`;
    }

    // Steady pushing brings the AED.
    if (t - this.lastPress < 1.2) this.activeTime += dt;
    const progress = Math.min(1, Math.max(this.good / AED_GOOD, this.activeTime / AED_ACTIVE));
    $('aedFill').style.transform = `scaleX(${progress.toFixed(3)})`;
    if (progress >= 1 && !this.pressed) { this.go('aed'); return; }

    // A gentle nudge after a pause, or when pushes have been too few for a while. Never a fail.
    const gap = t - (this.presses.length ? this.lastPress : this.stepAt);
    const recent = this.presses.filter((p) => t - p < 20).length;
    const nudge = gap > 4 || (sinceStep > 20 && recent < 25);
    $('cprNudge').hidden = !nudge;
    if (nudge) $('cprNudge').textContent = CPR.compress.keepGoing;
  }

  drawScore() {
    const s = CPR.saved;
    const avg = this.rates.length ? this.rates.reduce((a, b) => a + b, 0) / this.rates.length : 0;
    const inRange = this.rates.length ? Math.min(100, Math.round(100 * this.good / this.rates.length)) : 0;
    const first = this.presses.length ? Math.max(0, this.presses[0] - this.collapseAt) : 0;
    const rows = [
      [s.avgRate, avg ? `${Math.round(avg)}/min` : '—'],
      [s.inRange, `${inRange}%`],
      [s.firstPush, `${first.toFixed(first < 10 ? 1 : 0)} s`],
      [s.pushes, String(this.presses.length)],
    ];
    $('score').replaceChildren(...rows.flatMap(([k, v]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      div.append(dd, dt);
      return [div];
    }));
  }

  /** The small "Start CPR" prompt while the heart is dying. */
  setPrompt(show) {
    const el = $('cprPrompt');
    if (el.hidden === !show) return;
    el.hidden = !show;
  }
}
