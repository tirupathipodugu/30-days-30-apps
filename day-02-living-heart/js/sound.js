// Synthesised heart sounds with WebAudio: S1 ("lub") at valve closure as systole starts, S2 ("dub") as ejection ends.

export class HeartSound {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  async setOn(on) {
    this.on = false;
    if (on && !this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx) await (on ? this.ctx.resume() : this.ctx.suspend()).catch(() => {});
    this.on = on && this.ctx?.state === 'running';
    if (!this.on && this.flat) this.flat = null;
    return this.on;
  }

  /** A quiet monitor tone for a stopped heart: it holds for a few seconds, then fades out by itself. */
  flatline(on) {
    if (this.flat) {
      const { osc, env } = this.flat, t = this.ctx.currentTime;
      env.gain.cancelScheduledValues(t);
      env.gain.setTargetAtTime(0.0001, t, 0.08);
      osc.stop(t + 0.5);
      this.flat = null;
    }
    if (!on || !this.on || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
    env.gain.setValueAtTime(0.035, t + 3.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + 5.1);
    this.flat = { osc, env };
    osc.onended = () => { if (this.flat?.osc === osc) this.flat = null; };
  }

  get ready() { return this.on && this.ctx?.state === 'running'; }

  // CPR practice: the metronome, a soft thud for each push, the AED's beeps, its charging whine and the shock.
  tick() { this.tone(1320, 0.035, 0.09, 'triangle'); }
  push() { this.thump(0.08, 55, 170, 0.06, 0.55); }
  beep(freq = 980, dur = 0.12) { this.tone(freq, dur, 0.06, 'sine'); }

  tone(freq, dur, gain, type) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** The rising whine of an AED charging; it holds quietly until shock() or chargeStop(). */
  charge() {
    this.chargeStop();
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(2400, t + 1.6);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.03, t + 0.2);
    osc.connect(env).connect(this.master);
    osc.start(t);
    this.charging = { osc, env };
  }
  chargeStop() {
    if (!this.charging) return;
    const { osc, env } = this.charging, t = this.ctx.currentTime;
    env.gain.cancelScheduledValues(t);
    env.gain.setTargetAtTime(0.0001, t, 0.03);
    osc.stop(t + 0.2);
    this.charging = null;
  }
  /** The shock: a sharp crack of noise over a deep thump. */
  shock() {
    this.chargeStop();
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource(), env = ctx.createGain(), hp = ctx.createBiquadFilter();
    src.buffer = this.noise;
    hp.type = 'highpass'; hp.frequency.value = 900;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(hp).connect(env).connect(this.master);
    src.start(t); src.stop(t + 0.2);
    this.thump(0.18, 38, 120, 0.22, 1.4);
  }

  lub(strength = 1) { this.thump(0.11, 45, 140, 0.09, Math.min(1.6, strength)); }
  dub() { this.thump(0.07, 65, 220, 0.055, 0.7); }

  // A short burst of noise plus a low sine, through a lowpass, with a fast attack and quick decay.
  thump(duration, freq, cutoff, decay, gain) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.008 + decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.9;
    lp.connect(env).connect(this.master);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * 1.15, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + duration);
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.9;
    osc.connect(oscGain).connect(lp);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.35;   // mostly the low sine: a soft thud, not a click
    src.connect(nGain).connect(lp);
    osc.start(t); src.start(t);
    osc.stop(t + duration + 0.05); src.stop(t + duration + 0.05);
  }
}
