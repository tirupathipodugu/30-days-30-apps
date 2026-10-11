// Sound: synthesised with WebAudio, plus one recorded ambience loop. On by default (browsers only let
// it start after the first tap, click or key press, see unlock); turning it off is remembered. A strike is a sharp crack, a fast crackle as the fracture runs, and a
// faint high shimmer. A restore is a low, soft swell. A piece coming loose is a small dry tick, and
// one landing on the floor is a short glass tinkle. The shooter's shots are soft thumps and its shells
// ping on the floor. Behind the glass, a recorded lakeside ambience fades up as more of it shows.

const STORAGE_KEY = 'mirror-room:sound';
const AMBIENCE_URL = 'assets/lake-ambience.m4a';
const AMBIENCE_MAX = 0.55;             // gain at the ending, when the whole scene is open

export class Sound {
  constructor() {
    this.context = null;
    this.noise = null;
    this.ambienceGain = null;
    this.ambienceLevel = 0;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      this.enabled = true;
    }
    this.unlocked = false;             // set by the first user gesture
  }

  /** The first gesture: from now on the audio context may start. Call it from inside the gesture. */
  unlock() {
    if (this.unlocked) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;   // e.g. a touch still held down
    this.unlocked = true;
    this.ready();
  }

  /** Tab hidden or shown again. */
  suspend() {
    this.context?.suspend();
  }

  resume() {
    if (this.enabled && this.context) this.context.resume();
  }

  /** Turn sound on or off (from a click, so it also unlocks audio). */
  setEnabled(on) {
    this.enabled = on;
    this.unlocked = true;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Private browsing can refuse storage; the toggle still works for this visit.
    }
    if (on) this.ambience(this.ambienceLevel);
    else this.quiet();
  }

  /** Create the audio context lazily, on the first gesture with sound on. */
  ready() {
    if (!this.enabled || !this.unlocked) return null;
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

  /** A gunshot, kept soft: a low thump, a short burst of filtered air and a little room behind it. */
  shot() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.26, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
    this.burst(t, 0.07, 'lowpass', 2000, 0.2);
    this.burst(t + 0.01, 0.16, 'bandpass', 700, 0.05);
    this.burst(t, 0.006, 'highpass', 4500, 0.04);
  }

  /** A spent shell hitting the floor: two tiny bright pings. */
  shell(size = 0.5) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t + i * (0.05 + Math.random() * 0.05);
      osc.frequency.value = 5600 + Math.random() * 2400;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime((0.006 + 0.008 * size) / (i + 1), at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.15);
    }
    this.burst(t, 0.004, 'bandpass', 6500, 0.025 + 0.02 * size);
  }

  /**
   * The world behind the mirror: a recorded loop of lapping water and gulls. `level` 0..1 follows how
   * much of it the broken glass reveals; it only plays with sound on, and fades gently between levels.
   */
  ambience(level) {
    this.ambienceLevel = level;
    const ctx = this.ready();
    if (!ctx) return;
    if (!this.ambienceGain) {
      this.ambienceGain = ctx.createGain();
      this.ambienceGain.gain.value = 0;
      this.ambienceGain.connect(ctx.destination);
      fetch(AMBIENCE_URL)
        .then((response) => response.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(this.ambienceGain);
          source.start();
        })
        .catch(() => {});              // no ambience is fine; everything else still sounds
    }
    this.ambienceGain.gain.setTargetAtTime(AMBIENCE_MAX * level, ctx.currentTime, 0.6);
  }

  /** Silence the ambience (sound turned off). */
  quiet() {
    if (this.ambienceGain) this.ambienceGain.gain.setTargetAtTime(0, this.context.currentTime, 0.2);
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
