// Sound: small synthesised cues (WebAudio, no files). On by default; browsers only allow audio after the first
// tap, click or key press, so the context starts then. Turning it off is remembered.

const KEY = 'grwm:sound';

export class Sound {
  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { this.enabled = true; }
    this.ctx = null;
  }

  unlock() {
    if (this.ctx || !this.enabled) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;   // wait for the first gesture
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch {}
    if (this.enabled) { this.unlock(); this.ctx?.resume(); this.play('tick'); } else this.ctx?.suspend();
    return this.enabled;
  }

  tone(freq, start, dur, gain, type = 'sine') {
    const c = this.ctx, t = c.currentTime + start;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(start, dur, gain, freq) {
    const c = this.ctx, t = c.currentTime + start;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = gain;
    s.connect(f).connect(g).connect(c.destination);
    s.start(t);
  }

  /** tick: a choice; pick: a product put on; shutter: a photo; rec / stop: recording; soft: a notice. */
  play(name) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    switch (name) {
      case 'tick': this.tone(1800, 0, 0.05, 0.03, 'triangle'); break;
      case 'pick': this.tone(660, 0, 0.18, 0.045); this.tone(990, 0.07, 0.26, 0.035); break;
      case 'shutter': this.noise(0, 0.05, 0.18, 3200); this.noise(0.07, 0.06, 0.12, 2200); break;
      case 'rec': this.tone(880, 0, 0.14, 0.04); break;
      case 'stop': this.tone(880, 0, 0.1, 0.035); this.tone(660, 0.1, 0.18, 0.035); break;
      case 'soft': this.tone(520, 0, 0.22, 0.03); break;
    }
  }
}
