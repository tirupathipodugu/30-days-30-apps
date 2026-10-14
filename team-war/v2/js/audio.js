// All sound is synthesised with Web Audio: no files. Starts on the first user gesture.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export class Audio {
  constructor() {
    this.ctx = null; this.muted = store.get('hva2.mute', '0') === '1';
    this.last = {}; this.music = { on: false, step: 0, next: 0, intensity: 0, bar: 0 };
    this.team = 'human';
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.2; this.mus.connect(this.master);
    const len = c.sampleRate * 1.0;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.schedule(), 30);
  }
  setMuted(m) {
    this.muted = m; store.set('hva2.mute', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
  suspend(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }
  throttle(name, ms) {
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < ms) return true;
    this.last[name] = now; return false;
  }
  // ---------- primitives ----------
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.3, at = 0, attack = 0.004, out = this.sfx, curve = 'exp' }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur) : o.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  noise({ dur = 0.2, vol = 0.3, type = 'lowpass', f0 = 2000, f1 = f0, q = 1, at = 0, attack = 0.003, out = this.sfx }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  // ---------- game sounds ----------
  play(name, o = {}) {
    if (!this.ctx || this.muted) return;
    const r = 1 + (Math.random() - 0.5) * 0.12;
    switch (name) {
      case 'shot':
        if (this.throttle('shot', 40)) return;
        if (this.team === 'human') {
          this.noise({ dur: 0.07, vol: 0.32, type: 'bandpass', f0: 2600 * r, f1: 700, q: 1.2 });
          this.tone({ type: 'square', f0: 240 * r, f1: 80, dur: 0.08, vol: 0.12 });
        } else {
          this.tone({ type: 'sawtooth', f0: 1500 * r, f1: 260, dur: 0.09, vol: 0.13 });
          this.tone({ type: 'sine', f0: 900 * r, f1: 180, dur: 0.1, vol: 0.14 });
        }
        if (o.big) this.tone({ type: 'square', f0: 120, f1: 40, dur: 0.25, vol: 0.25 });
        break;
      case 'hit':
        if (this.throttle('hit', 30)) return;
        this.tone({ type: 'triangle', f0: (o.crit ? 1300 : 700) * r, f1: 260, dur: 0.05, vol: o.crit ? 0.22 : 0.14 });
        this.noise({ dur: 0.04, vol: 0.12, type: 'highpass', f0: 3000 });
        break;
      case 'kill':
        if (this.throttle('kill', 35)) return;
        this.noise({ dur: 0.16, vol: 0.3, type: 'lowpass', f0: 1800 * r, f1: 200 });
        this.tone({ type: 'square', f0: 330 * r * (1 + Math.min(o.combo || 0, 30) * 0.015), f1: 90, dur: 0.12, vol: 0.12 });
        break;
      case 'bigKill':
        this.noise({ dur: 0.45, vol: 0.45, type: 'lowpass', f0: 900, f1: 60 });
        this.tone({ type: 'sine', f0: 140, f1: 35, dur: 0.45, vol: 0.5 });
        break;
      case 'dash':
        this.noise({ dur: 0.2, vol: 0.3, type: 'bandpass', f0: 500, f1: 2600, q: 2 });
        this.tone({ type: 'sine', f0: 300, f1: 700, dur: 0.15, vol: 0.1 });
        break;
      case 'hurt':
        if (this.throttle('hurt', 90)) return;
        this.tone({ type: 'square', f0: 220, f1: 90, dur: 0.16, vol: 0.2 });
        this.noise({ dur: 0.12, vol: 0.25, type: 'lowpass', f0: 1200, f1: 300 });
        break;
      case 'baseHit':
        if (this.throttle('baseHit', 160)) return;
        this.tone({ type: 'sine', f0: 110, f1: 50, dur: 0.22, vol: 0.32 });
        this.noise({ dur: 0.12, vol: 0.15, type: 'lowpass', f0: 600 });
        break;
      case 'enemyShot':
        if (this.throttle('eshot', 60)) return;
        this.tone({ type: 'sine', f0: 520 * r, f1: 900, dur: 0.12, vol: 0.06 });
        break;
      case 'turret':
        if (this.throttle('turret', 120)) return;
        this.tone({ type: 'square', f0: 600, f1: 200, dur: 0.06, vol: 0.05 });
        break;
      case 'wall':
        this.tone({ type: 'square', f0: 110, f1: 220, dur: 0.35, vol: 0.2 });
        this.tone({ type: 'triangle', f0: 660, f1: 640, dur: 0.6, vol: 0.12, at: 0.05 });
        this.noise({ dur: 0.3, vol: 0.2, type: 'lowpass', f0: 800, f1: 200 });
        break;
      case 'rally':
        [0, 0.12, 0.24].forEach((at, i) => this.tone({ type: 'sawtooth', f0: [262, 330, 392][i], dur: 0.5, vol: 0.12, at, attack: 0.02 }));
        this.tone({ type: 'sawtooth', f0: 523, dur: 0.7, vol: 0.12, at: 0.36, attack: 0.02 });
        break;
      case 'catapult':
        this.noise({ dur: 0.4, vol: 0.25, type: 'bandpass', f0: 300, f1: 1200, q: 1.5 });
        this.tone({ type: 'triangle', f0: 200, f1: 80, dur: 0.3, vol: 0.2 });
        break;
      case 'firewall':
        this.noise({ dur: 0.8, vol: 0.35, type: 'lowpass', f0: 3000, f1: 400 });
        this.tone({ type: 'sawtooth', f0: 80, f1: 160, dur: 0.6, vol: 0.15 });
        break;
      case 'drones':
        [0, 0.08, 0.16].forEach((at, i) => this.tone({ type: 'square', f0: 700 + i * 250, f1: 1400 + i * 300, dur: 0.1, vol: 0.08, at }));
        break;
      case 'emp':
        this.tone({ type: 'sine', f0: 1200, f1: 60, dur: 0.6, vol: 0.4 });
        this.noise({ dur: 0.5, vol: 0.35, type: 'bandpass', f0: 4000, f1: 200, q: 0.8 });
        break;
      case 'boom':
        if (this.throttle('boom', 50)) return;
        this.noise({ dur: 0.35, vol: 0.35, type: 'lowpass', f0: 1400, f1: 80 });
        this.tone({ type: 'sine', f0: 120, f1: 40, dur: 0.3, vol: 0.3 });
        break;
      case 'telegraph':
        this.tone({ type: 'square', f0: 330, f1: 660, dur: 0.25, vol: 0.12 });
        this.tone({ type: 'square', f0: 330, f1: 660, dur: 0.25, vol: 0.12, at: 0.3 });
        break;
      case 'slam':
        this.tone({ type: 'sine', f0: 140, f1: 30, dur: 0.7, vol: 0.7 });
        this.noise({ dur: 0.6, vol: 0.5, type: 'lowpass', f0: 1000, f1: 50 });
        break;
      case 'bossSpawn':
        this.tone({ type: 'sawtooth', f0: 55, f1: 55, dur: 1.4, vol: 0.3, attack: 0.2 });
        this.tone({ type: 'sawtooth', f0: 82, f1: 78, dur: 1.4, vol: 0.2, attack: 0.2 });
        this.noise({ dur: 1.2, vol: 0.2, type: 'lowpass', f0: 300, f1: 60 });
        break;
      case 'warn':
        this.tone({ type: 'square', f0: 880, dur: 0.1, vol: 0.12 });
        this.tone({ type: 'square', f0: 660, dur: 0.1, vol: 0.12, at: 0.14 });
        break;
      case 'waveStart':
        this.tone({ type: 'sawtooth', f0: 196, dur: 0.25, vol: 0.14, attack: 0.02 });
        this.tone({ type: 'sawtooth', f0: 294, dur: 0.45, vol: 0.14, at: 0.2, attack: 0.02 });
        break;
      case 'waveClear':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.18, at: i * 0.08 }));
        break;
      case 'upgrade':
        [880, 1320, 1760].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.4, vol: 0.16, at: i * 0.06 }));
        break;
      case 'synergy':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.25, vol: 0.08, at: i * 0.07 }));
        break;
      case 'streak':
        this.tone({ type: 'square', f0: 440 + (o.n || 2) * 40, f1: 880 + (o.n || 2) * 60, dur: 0.18, vol: 0.12 });
        break;
      case 'multUp':
        this.tone({ type: 'triangle', f0: 600 + (o.mult || 2) * 100, f1: 1200 + (o.mult || 2) * 150, dur: 0.12, vol: 0.12 });
        break;
      case 'pickup':
        [660, 990].forEach((f, i) => this.tone({ type: 'sine', f0: f, f1: f * 1.5, dur: 0.15, vol: 0.18, at: i * 0.06 }));
        break;
      case 'drop':
        this.tone({ type: 'triangle', f0: 1200, f1: 1800, dur: 0.12, vol: 0.08 });
        break;
      case 'heroDown':
        this.tone({ type: 'sawtooth', f0: 400, f1: 60, dur: 0.8, vol: 0.25 });
        this.noise({ dur: 0.5, vol: 0.3, type: 'lowpass', f0: 1500, f1: 100 });
        break;
      case 'respawn':
        this.tone({ type: 'sine', f0: 300, f1: 1200, dur: 0.4, vol: 0.18 });
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.2, at: i * 0.12 }));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.45, vol: 0.2, at: i * 0.18 }));
        break;
      case 'click':
        this.tone({ type: 'triangle', f0: 900, f1: 1200, dur: 0.05, vol: 0.12 });
        break;
      case 'coin':
        this.tone({ type: 'square', f0: 988, dur: 0.06, vol: 0.06 }); this.tone({ type: 'square', f0: 1319, dur: 0.12, vol: 0.06, at: 0.06 });
        break;
      case 'level':
        [523, 784, 1047, 1568].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.2, vol: 0.09, at: i * 0.09 }));
        break;
      case 'block':
        if (this.throttle('block', 50)) return;
        this.tone({ type: 'triangle', f0: 1800, f1: 900, dur: 0.06, vol: 0.1 });
        break;
      case 'breach':
        this.tone({ type: 'sine', f0: 90, f1: 25, dur: 1.2, vol: 0.7 });
        this.noise({ dur: 1.1, vol: 0.5, type: 'lowpass', f0: 2000, f1: 60 });
        break;
    }
  }

  // ---------- music: a small step sequencer ----------
  // intensity 0 = menu (pads + arp), 1 = fight (drums + bass), 2 = boss (busier, darker)
  setMusic(on, intensity = 1) { this.music.on = on; this.music.intensity = intensity; }
  schedule() {
    const c = this.ctx, M = this.music;
    if (!c || c.state !== 'running') return;
    const bpm = M.intensity >= 2 ? 132 : 118, step = 60 / bpm / 4;
    if (M.next < c.currentTime) M.next = c.currentTime + 0.05;
    while (M.next < c.currentTime + 0.12) {
      if (M.on) this.playStep(M.step, M.next, M.intensity, step);
      M.next += step; M.step = (M.step + 1) % 64;
    }
  }
  playStep(s, t, I, step) {
    const out = this.mus, c = this.ctx;
    const prog = I >= 2 ? [[45, 52, 57], [44, 51, 56], [41, 48, 53], [43, 50, 55]] : [[45, 52, 57], [41, 48, 53], [48, 55, 60], [43, 50, 55]];
    const chord = prog[Math.floor(s / 16) % 4];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const at = t - c.currentTime;
    const b = s % 16;
    if (I >= 1) {
      if (b % 4 === 0) { this.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.22, vol: 0.9, at, out }); }
      if (b === 4 || b === 12) this.noise({ dur: 0.14, vol: 0.32, type: 'highpass', f0: 1600, at, out });
      if (b % 2 === 0 || I >= 2) this.noise({ dur: 0.035, vol: b % 4 === 2 ? 0.16 : 0.08, type: 'highpass', f0: 7000, at, out });
      if (b % 2 === 0) this.tone({ type: 'sawtooth', f0: hz(chord[0] - 12 + (b === 14 ? 7 : 0)), dur: step * 1.8, vol: 0.22, at, out, attack: 0.005 });
    } else if (b === 0) {
      for (const n of chord) this.tone({ type: 'triangle', f0: hz(n), dur: step * 15, vol: 0.06, at, out, attack: 0.3 });
    }
    // arpeggio
    const arp = [0, 1, 2, 1, 2, 0, 2, 1];
    if (b % 2 === 0 || I >= 2) {
      const n = chord[arp[(s >> (I >= 2 ? 0 : 1)) % 8]] + 12 + (b >= 8 && I >= 1 ? 12 : 0);
      this.tone({ type: I >= 2 ? 'square' : 'triangle', f0: hz(n), dur: step * 0.9, vol: I >= 1 ? 0.07 : 0.06, at, out });
    }
  }
}
