// Sound: glass only, synthesised with WebAudio (no audio files). Off by default; the choice is
// remembered in localStorage. A strike is a sharp crack, a fast crackle as the fracture runs, and a
// faint high shimmer. A restore is a low, soft swell. A piece coming loose is a small dry tick, and
// one landing on the floor is a short glass tinkle. At the end, a quiet surf of filtered noise.

const STORAGE_KEY = 'mirror-room:sound';

export class Sound {
  constructor() {
    this.context = null;
    this.noise = null;
    this.surfNodes = null;
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

  /** A piece coming out of its frame: a small, dry tick. */
  loosen() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.burst(t, 0.018, 'bandpass', 1400 + Math.random() * 600, 0.09);
    this.burst(t + 0.006, 0.006, 'highpass', 3500, 0.05);
  }

  /** A piece landing on the floor: a soft contact, then a few bright, tiny pings skittering away. */
  land(size = 0.5) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const level = 0.35 + 0.65 * size;
    this.burst(t, 0.02, 'highpass', 2600, 0.14 * level);
    for (let i = 0; i < 5; i++) {
      this.burst(t + 0.01 + Math.pow(Math.random(), 1.5) * 0.18, 0.004 + Math.random() * 0.005,
        'bandpass', 4000 + Math.random() * 5000, (0.04 + Math.random() * 0.06) * level);
    }
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t + Math.random() * 0.09;
      osc.frequency.value = 3800 + Math.random() * 5200;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.014 * level, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08 + Math.random() * 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    }
  }

  /** The ocean behind the mirror: low filtered noise that swells and falls slowly, kept quiet. */
  surf() {
    const ctx = this.ready();
    if (!ctx || this.surfNodes) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 3);
    // A slow swell, roughly one wave every eight seconds.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.12;
    depth.gain.value = 0.03;
    lfo.connect(depth).connect(gain.gain);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    lfo.start(t);
    this.surfNodes = { source, lfo, gain };
  }

  stopSurf() {
    if (!this.surfNodes) return;
    const { source, lfo, gain } = this.surfNodes;
    const t = this.context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0, t, 0.2);
    source.stop(t + 1);
    lfo.stop(t + 1);
    this.surfNodes = null;
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
