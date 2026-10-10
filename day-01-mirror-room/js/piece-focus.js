// Keyboard access to the pieces. The glass is one canvas, so each piece also gets an invisible
// <button> laid over it, in reading order. Tab visits pieces, Enter or Space breaks the focused one,
// and the arrow keys move to the nearest piece in that direction.

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export class PieceFocus {
  /** `onBreak(piece)` is called when a piece is broken from the keyboard. */
  constructor(layer, mirror, onBreak) {
    this.layer = layer;
    this.mirror = mirror;
    this.onBreak = onBreak;
    this.buttons = [];
    this.pieceOf = new WeakMap();
    this.syncedVersion = -1;
    this.pendingFocus = null;
    layer.addEventListener('keydown', (event) => this.onKey(event));
  }

  /** Lay one button over each piece, in reading order. Cheap to call every frame; it only works on change. */
  sync() {
    const mirror = this.mirror;
    if (mirror.version === this.syncedVersion) return;
    this.syncedVersion = mirror.version;

    const focusedPiece = this.pieceOf.get(document.activeElement);
    const hadFocus = this.layer.contains(document.activeElement);
    const order = mirror.readingOrder();
    while (this.buttons.length < order.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'piece';
      this.buttons.push(button);
    }
    order.forEach((piece, i) => {
      const button = this.buttons[i];
      this.pieceOf.set(button, piece);
      button.setAttribute('aria-label', `Mirror piece ${i + 1} of ${order.length}`);
      button.style.left = `${piece.x}px`;
      button.style.top = `${piece.y}px`;
      button.style.width = `${piece.w}px`;
      button.style.height = `${piece.h}px`;
    });
    this.layer.replaceChildren(...this.buttons.slice(0, order.length));

    // Keep focus on the same piece, or on the first half of it if it just broke.
    if (hadFocus) {
      const target = order.includes(focusedPiece) ? focusedPiece : this.pendingFocus;
      this.buttons[Math.max(0, order.indexOf(target))].focus({ preventScroll: true });
    }
    this.pendingFocus = null;
  }

  onKey(event) {
    const piece = this.pieceOf.get(event.target);
    if (!piece) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const index = this.mirror.pieces.indexOf(piece);
      this.onBreak(index);
      // After a split the focused piece's slot holds its first half.
      this.pendingFocus = this.mirror.pieces[index];
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    const next = this.nearest(piece, arrow[0], arrow[1]);
    if (next) {
      const button = this.buttons.find((b) => this.pieceOf.get(b) === next && b.isConnected);
      button?.focus({ preventScroll: true });
    }
  }

  /** The closest piece whose centre lies in the given direction, favouring pieces straight ahead. */
  nearest(from, dx, dy) {
    let best = null;
    let bestScore = Infinity;
    for (const p of this.mirror.pieces) {
      const ax = p.cx - from.cx;
      const ay = p.cy - from.cy;
      const ahead = ax * dx + ay * dy;
      if (p === from || ahead <= 1) continue;
      const aside = Math.abs(ax * dy - ay * dx);
      const score = ahead + aside * 2;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
}
