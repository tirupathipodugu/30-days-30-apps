// Sound, all synthesised with WebAudio: a low rumble that rises as you near the hole, a hiss while
// you thrust, a chord when you save the universe and a long fall when you don't.

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
  }

  /** Must be called from a click or key press: browsers only allow audio after one. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? 0.9 : 0;
    this.master.connect(ctx.destination);

    // Rumble: two detuned low saws through a low-pass filter.
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 140;
    this.rumbleOsc = [38, 41.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.rumbleFilter);
      o.start();
      return o;
    });
    this.rumbleFilter.connect(this.rumbleGain).connect(this.master);

    // Thrust: looping noise through a band-pass filter.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.8;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    noise.connect(band).connect(this.thrustGain).connect(this.master);
    noise.start();
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  /** closeness 0..1 (1 = at the horizon), thrusting true/false. Called every frame. */
  update(closeness, thrusting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rumbleGain.gain.setTargetAtTime(0.05 + 0.35 * closeness, t, 0.1);
    this.rumbleFilter.frequency.setTargetAtTime(110 + 260 * closeness, t, 0.1);
    this.rumbleOsc.forEach((o, i) => o.frequency.setTargetAtTime((i ? 41.5 : 38) * (1 + closeness * 0.6), t, 0.1));
    this.thrustGain.gain.setTargetAtTime(thrusting ? 0.12 : 0, t, 0.04);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rumbleGain.gain.setTargetAtTime(0, t, 0.3);
    this.thrustGain.gain.setTargetAtTime(0, t, 0.05);
  }

  /** A short click for every tap. */
  tap() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.09);
  }

  /** A thud when a falling piece hits you. */
  bump() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.18);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
  }

  /** Countdown beep: lower for 3 and 2, higher for 1. */
  tick(n) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = n === 1 ? 880 : 440;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.26);
  }

  win() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 1.8);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 1.9);
    });
  }

  lose() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 2.4);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 2.4);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.7);
  }
}
