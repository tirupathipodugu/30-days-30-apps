// Sound: every sound is synthesised with WebAudio, no audio files. Off by default; the choice is
// remembered in localStorage. Glass tinks, a heartbeat thump for the encore, a whoosh on reassemble.

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
      const length = this.context.sampleRate;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  /** A glass tink. `pitch` 0 is a low tink; each +1 is a semitone higher. `delay` is in seconds. */
  tink(pitch = 0, delay = 0) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const base = 1800 * Math.pow(2, pitch / 12);
    // A bell-like pair of partials plus a tiny burst of bright noise for the crack.
    for (const [ratio, level, decay] of [[1, 0.12, 0.35], [2.76, 0.05, 0.18]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = base * ratio;
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + decay);
    }
    this.noiseBurst(t, 0.04, 6000, 0.08);
  }

  /** The encore's heartbeat: two low thumps. */
  thump() {
    const ctx = this.ready();
    if (!ctx) return;
    for (const [offset, level] of [[0, 0.6], [0.18, 0.4]]) {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  }

  /** A soft rising whoosh as the pieces slide home. */
  whoosh(duration = 0.6) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    source.stop(t + duration);
  }

  noiseBurst(t, duration, frequency, level) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    source.stop(t + duration);
  }
}
