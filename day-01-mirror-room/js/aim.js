// Keyboard aiming. The glass is one canvas, so an invisible button covers it: Tab to it, move a thin
// reticle with the arrow keys (Shift moves further) and press Enter or Space to strike the glass there.

const STEP = 24;

export class Aim {
  /** `onStrike(x, y)` is called with stage coordinates. */
  constructor(button, reticle, onStrike) {
    this.button = button;
    this.reticle = reticle;
    this.onStrike = onStrike;
    this.x = -1;
    this.y = -1;
    button.addEventListener('focus', () => {
      if (this.x < 0) this.center();
    });
    button.addEventListener('keydown', (event) => this.onKey(event));
    // A click on the button only happens from the keyboard (it ignores the pointer).
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this.onStrike(this.x, this.y);
    });
  }

  center() {
    this.moveTo(this.button.clientWidth / 2, this.button.clientHeight / 2);
  }

  moveTo(x, y) {
    this.x = Math.min(Math.max(x, 0), this.button.clientWidth);
    this.y = Math.min(Math.max(y, 0), this.button.clientHeight);
    this.reticle.style.transform = `translate(${this.x}px, ${this.y}px)`;
  }

  onKey(event) {
    const step = event.shiftKey ? STEP * 3 : STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    this.moveTo(this.x + move[0], this.y + move[1]);
  }
}
