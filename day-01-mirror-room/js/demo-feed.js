// Demo feed: an animated canvas that stands in for the camera (?demo=1), so anyone can try the mirror.
// It draws a simple figure swaying in a room, with a sweeping clock so the Time toggle is easy to see.
// It has the same shape as the camera source: { element, width, height, takeFrame(), stop() }.

const WIDTH = 1280;
const HEIGHT = 720;
const HUES = Array.from({ length: 48 }, (_, i) => `hsl(${i * 7.5}, 70%, 55%)`);

export function createDemoFeed() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const wall = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  wall.addColorStop(0, '#1d2340');
  wall.addColorStop(0.7, '#2b2f55');
  wall.addColorStop(1, '#3a2c3f');
  const start = performance.now();

  function draw(t) {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Coloured tiles along the back wall, cycling slowly.
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = HUES[(i * 3 + Math.floor(t * 4)) % HUES.length];
      ctx.globalAlpha = 0.35;
      ctx.fillRect(i * 80 + 6, 560, 68, 160);
    }
    ctx.globalAlpha = 1;

    // A clock with a sweeping hand: with Time on, far pieces show it a few seconds behind.
    const cx = WIDTH / 2, cy = 115;
    ctx.fillStyle = '#f2f3f7';
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#07070b';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    const a = t * Math.PI / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(a) * 62, cy - Math.cos(a) * 62);
    ctx.stroke();

    // The figure: sways side to side and nods.
    const x = WIDTH / 2 + Math.sin(t * 0.7) * 150;
    const y = 360 + Math.sin(t * 1.4) * 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.9) * 0.12);
    ctx.fillStyle = '#ff3b5c';
    ctx.beginPath();
    ctx.ellipse(0, 330, 230, 190, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#e9b48f';
    ctx.fillRect(-45, 100, 90, 70);
    ctx.beginPath();
    ctx.ellipse(0, 0, 120, 145, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1a14';
    ctx.beginPath();
    ctx.ellipse(0, -70, 128, 88, 0, Math.PI, 0);
    ctx.fill();
    const blink = (t % 4) < 0.15 ? 0.15 : 1;
    ctx.beginPath();
    ctx.ellipse(-44, -5, 13, 16 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(44, -5, 13, 16 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1a14';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 45, 42, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // Label written backwards, so it reads correctly once the mirror flips it.
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(242, 243, 247, 0.85)';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEMO', -WIDTH / 2, 545);
    ctx.restore();
  }

  return {
    element: canvas,
    width: WIDTH,
    height: HEIGHT,
    takeFrame() {
      draw((performance.now() - start) / 1000);
      return true;
    },
    stop() {},
  };
}
