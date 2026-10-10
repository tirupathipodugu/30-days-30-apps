// The quiet text interface: BPM and LIVE, beat counter, rate and sound, hover label, and auto-hide after 3 s.

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

export function createUi({ onRate, onSound }) {
  const bpmEl = $('bpm'), modeEl = $('mode'), dot = $('dot'), beatsEl = $('beats');
  const rateBtn = $('rate'), slider = $('slider'), soundBtn = $('sound'), tip = $('tip');
  let idleTimer = 0, shownBpm = -1, shownBeats = -1, shownLive = null, shownDot = -1, tipTimer = 0;

  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
  wake();

  rateBtn.addEventListener('click', () => {
    const open = slider.hidden;
    slider.hidden = !open;
    rateBtn.setAttribute('aria-expanded', String(open));
    if (open) slider.focus();
  });
  slider.addEventListener('input', () => onRate(Number(slider.value)));
  soundBtn.addEventListener('click', async () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    const applied = await onSound(on);
    soundBtn.setAttribute('aria-pressed', String(applied));
    soundBtn.textContent = applied ? 'Sound on' : 'Sound off';
  });

  return {
    update(bpm, beats, live, beat) {
      const b = Math.round(bpm);
      if (b !== shownBpm) { bpmEl.textContent = b; shownBpm = b; if (document.activeElement !== slider) slider.value = b; }
      if (beats !== shownBeats) { beatsEl.textContent = fmt.format(beats); shownBeats = beats; }
      if (live !== shownLive) { modeEl.textContent = live ? 'Live' : 'Manual'; modeEl.classList.toggle('live', live); shownLive = live; }
      const q = Math.round(beat * 20);   // only touch the DOM when the dot visibly changes
      if (q !== shownDot) {
        shownDot = q;
        dot.style.transform = `scale(${1 + 0.03 * q})`;
        dot.style.opacity = String(0.45 + 0.0275 * q);
      }
    },
    showTip(x, y, text, touch) {
      tip.textContent = text;
      tip.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y + 12)}px)`;
      tip.hidden = false;
      clearTimeout(tipTimer);
      if (touch) tipTimer = setTimeout(() => { tip.hidden = true; }, 1500);
    },
    hideTip() { clearTimeout(tipTimer); tip.hidden = true; },
    setCredit(text, href) {
      const c = $('credit');
      c.textContent = text;
      if (href) c.href = href; else c.removeAttribute('href');
    },
  };
}
