// The cardiac cycle: beat timing from the heart rate and per-frame atria, ventricle and twist curves.

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const TAU = 0.08;        // relaxation time constant, seconds
const AV_DELAY = 0.04;   // atrial systole ends this long before ventricular systole

/** Systole shortens much less than diastole as the rate rises. */
export function beatTiming(rr) {
  const ts = Math.min(0.42, Math.max(0.2, 0.4 * Math.sqrt(rr)));
  const td = rr - ts;
  const ta = Math.min(0.1, 0.45 * td);
  const iso = 0.05 * (ts / 0.37);
  return { rr, ts, td, ta, iso };
}

export class Cycle {
  constructor(bpm, now) {
    this.target = 60 / bpm;
    this.rr = this.target;
    this.stepsLeft = 0;
    this.start = now;              // start of the current beat
    this.timing = beatTiming(this.rr);
    this.beats = 0;
    this.out = { atria: 0, vent: 0, twist: 0, phase: 0, eject: 0 };
    this.events = { newBeat: false, s2: false, ejectAt: 0 };
    this.s2Done = false;
  }

  /** A new rate never changes the current beat; the period eases to it over the next 3 beats. */
  setBpm(bpm) {
    this.target = 60 / bpm;
    this.stepsLeft = 3;
  }

  get bpm() { return 60 / this.rr; }

  update(now) {
    const ev = this.events;
    ev.newBeat = false; ev.s2 = false;
    while (now - this.start >= this.rr) {
      this.start += this.rr;
      if (this.stepsLeft > 0) {
        this.rr += (this.target - this.rr) / this.stepsLeft;
        this.stepsLeft--;
      }
      if (now - this.start > 2) this.start = now;   // after a hidden tab, resume cleanly
      this.timing = beatTiming(this.rr);
      this.beats++;
      this.s2Done = false;
      ev.newBeat = true;
    }
    const { ts, td, ta, iso, rr } = this.timing;
    const t = now - this.start;
    ev.ejectAt = this.start + iso;
    const o = this.out;
    o.phase = t / rr;

    // Ventricles: firm up in isovolumic contraction, squeeze through ejection, recoil, then overfill a touch.
    let vent, twist;
    if (t < iso) {
      vent = 0.1 * easeInOut(t / iso);
      twist = 0.15 * easeInOut(t / iso);
    } else if (t < ts) {
      const k = easeInOut((t - iso) / (ts - iso));
      vent = 0.1 + 0.9 * k;
      twist = 0.15 + 0.85 * k;
    } else {
      const d = t - ts;
      vent = Math.exp(-d / TAU);
      twist = Math.exp(-d / (TAU * 0.5));
      // Rapid filling (the 40% of diastole after isovolumic relaxation) overshoots by 4%.
      const f = clamp01((d - 0.07) / Math.max(0.02, 0.4 * td));
      vent -= 0.04 * Math.sin(Math.PI * f);
      if (!this.s2Done) { this.s2Done = true; ev.s2 = true; }
    }

    // Atria: squeeze just before ventricular systole, ending AV_DELAY before it.
    const aEnd = rr - AV_DELAY, aStart = aEnd - ta;
    let atria = 0;
    if (t >= aStart && t < aEnd) {
      const k = (t - aStart) / ta;
      atria = k < 0.6 ? easeInOut(k / 0.6) : 1 - easeInOut((k - 0.6) / 0.4) * 0.7;
    } else if (t >= aEnd) {
      atria = 0.3 * Math.exp(-(t - aEnd) / TAU);
    } else if (t < 0.12) {
      atria = 0.3 * Math.exp(-(t + AV_DELAY) / TAU);
    }

    o.vent = vent;
    o.twist = clamp01(twist);
    o.atria = clamp01(atria);
    o.eject = t >= iso && t < ts ? Math.sin(Math.PI * (t - iso) / (ts - iso)) : 0;
    return o;
  }
}
