// Sound: glass only, synthesised with WebAudio (no audio files). Off by default; the choice is
// remembered in localStorage. A strike is a sharp crack, a fast crackle as the fracture runs, and a
// faint high shimmer. A restore is a low, soft swell.

const STORAGE_KEY = 'mirror-room:sound';

export class Sound {
  constructor() {
    this.context = null;
    this.noise = null;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      this.enabled = false;
    }
  }

  /** Turn sound on or off. Must be called from a user gesture the first time, so audio can start. */
  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Private browsing can refuse storage; the toggle still works for this visit.
    }
    if (on) this.ready();
  }

  /** Create the audio context lazily, on the first gesture with sound on. */
  ready() {
    if (!this.enabled) return null;
    if (!this.context) {
      this.context = new AudioContext();
      const length = this.context.sampleRate * 2;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  /** Glass breaking. `force` 0..1 scales loudness (later impacts in a volley are a little softer). */
  crack(force = 1) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // The strike: a very short, bright transient.
    this.burst(t, 0.035, 'highpass', 1800, 0.55 * force);
    // The fracture running out: a scatter of tiny clicks over ~150 ms, thinning out.
    for (let i = 0; i < 14; i++) {
      const at = t + 0.004 + Math.pow(Math.random(), 1.8) * 0.16;
      this.burst(at, 0.004 + Math.random() * 0.006, 'bandpass', 3000 + Math.random() * 5000, (0.08 + Math.random() * 0.12) * force);
    }
    // Shimmer: a few faint, inharmonic high partials ringing off.
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t + 0.01 + Math.random() * 0.05;
      osc.frequency.value = 5200 + Math.random() * 4800;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.012 * force, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35 + Math.random() * 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.7);
    }
  }

  /** The restore: a low, soft swell of filtered air. */
  restore(duration = 1) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + duration * 0.7);
    filter.frequency.exponentialRampToValueAtTime(300, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration * 1.1);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    source.stop(t + duration * 1.1);
  }

  burst(t, duration, type, frequency, level) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t, Math.random() * 1.5);
    source.stop(t + duration + 0.01);
  }
}
