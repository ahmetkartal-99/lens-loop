// Unit test of the text close-up's geometry (inkBoxOf, extracted from index.html): where the print sits in a bright
// picture — found by LOCAL contrast, so print on the dim far side of a screen seen from an angle counts; the biggest
// cluster of inked cells, so a cursor or a speck off on its own does not; none when the print spreads over the
// picture, or there is no page. Run: node test/ink.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const { inkBoxOf } = new Function(pick('  function inkBoxOf(', '  // A frame for Claude: ') + '; return { inkBoxOf };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const W = 480, H = 360;
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// a picture: a flat page of the given shade (with grain), text as lines of dark strokes inside a box, in picture pixels
const page = (shade) => { const lum = new Uint8Array(W * H); for (let i = 0; i < lum.length; i++) lum[i] = Math.max(0, Math.min(255, shade + Math.round(rnd() * 10))); return lum; };
const text = (lum, x0, y0, x1, y1, darkness) => { for (let y = y0; y < y1; y += 6) for (let yy = y; yy < Math.min(y1, y + 2); yy++) for (let x = x0; x < x1; x++) if ((x >> 2) % 3 !== 2) lum[yy * W + x] = Math.max(0, lum[yy * W + x] - darkness); };
const dot = (lum, x, y, r, v) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) lum[yy * W + xx] = v; };

// 1. a question block at the top left of a bright page, a cursor far off to the right: the block, not a box to the cursor
{
  const lum = page(200); text(lum, 20, 30, 150, 140, 120); dot(lum, 400, 150, 4, 40);
  const b = inkBoxOf(lum, W, H, W * 4, H * 4);
  assert(b && b.x <= 20 * 4 && b.y <= 30 * 4 && b.x + b.w >= 150 * 4 && b.y + b.h >= 140 * 4, 'the question block is boxed (' + JSON.stringify(b) + ')');
  assert(b && b.x + b.w < 300 * 4, '… and the cursor off to the right is left out of it');
  assert(b && !b.edge.length, '… the print whole in view: no edge');
}
// 2. the same block on the DIM far side of a screen seen from an angle (grey 100, the text barely darker): still found
{
  const lum = page(100); text(lum, 20, 30, 150, 140, 45);
  const b = inkBoxOf(lum, W, H, W, H);
  assert(b && b.x <= 20 && b.x + b.w >= 150 && b.y + b.h >= 140, 'print on a dim grey ground is found by its own contrast (' + JSON.stringify(b) + ')');
}
// 3. print running to the picture's edge: said so
{
  const lum = page(200); text(lum, 0, 30, 120, 140, 120);
  const b = inkBoxOf(lum, W, H, W, H);
  assert(b && b.edge.includes('left') && !b.edge.includes('right'), 'print running to the left edge: edge = left (' + JSON.stringify(b && b.edge) + ')');
}
// 4. print all over the page: no close-up (the tiles cover it); no page at all: none
{
  const lum = page(200); text(lum, 10, 10, 470, 350, 120);
  assert(inkBoxOf(lum, W, H, W, H) === null, 'print over the whole page: no close-up');
  assert(inkBoxOf(page(20), W, H, W, H) === null, 'a dark frame: no close-up');
  assert(inkBoxOf(page(200), W, H, W, H) === null, 'a blank page: no close-up');
}
// 5. a dark room beside the page is not print (dark all over, no page-like ground)
{
  const lum = page(200); for (let y = 0; y < H; y++) for (let x = 0; x < 150; x++) lum[y * W + x] = 30 + Math.round(rnd() * 25); text(lum, 200, 60, 330, 160, 120);
  const b = inkBoxOf(lum, W, H, W, H);
  assert(b && b.x >= 150 && b.x <= 200 && b.x + b.w >= 330, 'the print on the page, not the room\'s grain (' + JSON.stringify(b) + ')');
}
// 6. bars and stripes are not print: horizontal stripes, vertical bars, a checkerboard (blocks of colour) — none of them
{
  const stripes = page(220); for (let y = 0; y < H; y += 60) for (let yy = y + 30; yy < Math.min(H, y + 60); yy++) for (let x = 0; x < W; x++) stripes[yy * W + x] = 30;
  assert(inkBoxOf(stripes, W, H, W, H) === null, 'horizontal stripes: no close-up');
  const bars = page(220); for (let x = 0; x < W; x += 60) for (let xx = x + 30; xx < Math.min(W, x + 60); xx++) for (let y = 0; y < H; y++) bars[y * W + xx] = 30;
  assert(inkBoxOf(bars, W, H, W, H) === null, 'vertical bars: no close-up');
  const board = page(200); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x / 24 | 0) + (y / 24 | 0)) % 2) board[y * W + x] = 60;
  assert(inkBoxOf(board, W, H, W, H) === null, 'a checkerboard: no close-up');
  // … while a block of print beside a thick rule line is still the print alone
  const ruled = page(220); text(ruled, 40, 40, 200, 150, 120); for (let y = 200; y < 212; y++) for (let x = 0; x < W; x++) ruled[y * W + x] = 30;
  const rb = inkBoxOf(ruled, W, H, W, H);
  assert(rb && rb.y + rb.h <= 200 && rb.x + rb.w >= 200 && rb.x <= 40, 'print above a thick rule: the print alone (' + JSON.stringify(rb) + ')');
}
console.log(process.exitCode ? 'INK FAILED' : 'ALL TESTS PASSED');
