// Sound: on by default, starting with the first tap (browsers allow nothing before that). A soft
// whoosh of filtered air follows the slider (louder and brighter the faster it moves) and a gentle
// two-partial chime rings as it passes each milestone. All synthesised with WebAudio.

const KEY = 'macro-mirror:sound';

export class Sound {
  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { this.enabled = true; }
    this.unlocked = false;
    this.ctx = null;
    this.whooshGain = null;
    this.whooshFilter = null;
    this.level = 0;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ready();
  }

  setEnabled(on) {
    this.enabled = on;
    this.unlocked = true;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: fine for this visit */ }
    if (on) this.ready();
    else if (this.whooshGain) this.whooshGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  ready() {
    if (!this.enabled || !this.unlocked) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      // A constant bed of filtered noise; the slider only opens its gain.
      const length = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b = 0;
      for (let i = 0; i < length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); data[i] = b * 6; }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      this.whooshFilter = this.ctx.createBiquadFilter();
      this.whooshFilter.type = 'bandpass';
      this.whooshFilter.frequency.value = 500;
      this.whooshFilter.Q.value = 0.8;
      this.whooshGain = this.ctx.createGain();
      this.whooshGain.gain.value = 0;
      src.connect(this.whooshFilter).connect(this.whooshGain).connect(this.ctx.destination);
      src.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { if (this.enabled && this.unlocked) this.ctx?.resume(); }

  /** Slider speed in stops per second. */
  whoosh(speed) {
    const ctx = this.ready();
    if (!ctx) return;
    const v = Math.min(1, Math.abs(speed) / 6);
    const t = ctx.currentTime;
    this.whooshGain.gain.setTargetAtTime(0.22 * v, t, 0.06);
    this.whooshFilter.frequency.setTargetAtTime(380 + 1400 * v, t, 0.08);
  }

  /** A soft bell for a milestone; later milestones sit a little lower. */
  chime(index) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = [0, 784, 740, 659, 587, 523, 440][index] || 523;
    for (const [mult, level, decay] of [[1, 0.06, 1.4], [2.76, 0.014, 0.6], [5.4, 0.006, 0.3]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * mult;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }

  /** A soft shutter for the share card. */
  shutter() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(500, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}
