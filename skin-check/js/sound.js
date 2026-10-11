// Sound: soft, synthesised with WebAudio. On by default; it can only start after the first tap,
// click or key press (browser rule, iOS included), and the Sound on/off choice is remembered.

const KEY = 'skin-check:sound';

export class Sound {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { this.enabled = true; }
    this.sweepNodes = null;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ready();
  }

  setEnabled(on) {
    this.enabled = on;
    this.unlocked = true;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
    if (!on) this.stopSweep();
    else this.ready();
  }

  ready() {
    if (!this.enabled || !this.unlocked) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { if (this.enabled) this.ctx?.resume(); }

  tone(freq, at, dur, gain, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + dur + 0.05);
  }

  /** A soft tick when a light check passes. */
  tick() {
    const ctx = this.ready(); if (!ctx) return;
    this.tone(1320, ctx.currentTime, 0.12, 0.08);
  }

  /** The scan: a slow, airy sweep for `seconds`. */
  startSweep(seconds) {
    const ctx = this.ready(); if (!ctx) return;
    this.stopSweep();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.6);
    g.gain.setValueAtTime(0.18, t + seconds - 0.8);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    // three gentle passes, one per pose
    const passes = 3;
    for (let k = 0; k < passes; k++) {
      const t0 = t + (seconds / passes) * k, t1 = t + (seconds / passes) * (k + 1);
      bp.frequency.setValueAtTime(380, t0);
      bp.frequency.exponentialRampToValueAtTime(2600, t1 - 0.05);
    }
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + seconds + 0.1);
    // a low pad under it
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 196;
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.05, t + 1); og.gain.linearRampToValueAtTime(0, t + seconds);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + seconds + 0.1);
    this.sweepNodes = [src, o, g, og];
  }

  stopSweep() {
    if (!this.sweepNodes || !this.ctx) { this.sweepNodes = null; return; }
    const [src, o, g, og] = this.sweepNodes;
    const t = this.ctx.currentTime;
    for (const gn of [g, og]) { gn.gain.cancelScheduledValues(t); gn.gain.setValueAtTime(gn.gain.value, t); gn.gain.linearRampToValueAtTime(0, t + 0.2); }
    try { src.stop(t + 0.25); o.stop(t + 0.25); } catch { /* already stopped */ }
    this.sweepNodes = null;
  }

  /** Results are ready: a soft two-note chime. */
  chime() {
    const ctx = this.ready(); if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    this.tone(784, t, 1.4, 0.12);
    this.tone(1175, t + 0.14, 1.6, 0.1);
    this.tone(1568, t + 0.14, 1.2, 0.03);
  }
}
