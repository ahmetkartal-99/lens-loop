// Unit test of the live auto-zoom's decision (framingMove, extracted from index.html): from what the finder saw in
// the live picture, the zoom now and the lens's range, the one step to take — in while the screen is small, capped by
// the headroom of its nearest edge; out while it is cut off; back toward the chosen zoom once nothing has been in
// view for a while — and that a run of such steps settles on a fit without ever pushing the screen past the frame's
// edge. Run: node test/framing.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  const FRAME_FIT = ', '  let frameLoopTimer = ');
const { framingMove, FRAME_LOW, FRAME_HIGH, FRAME_STEP } = new Function(code + '; return { framingMove, FRAME_LOW, FRAME_HIGH, FRAME_STEP };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const near = (a, b, t) => Math.abs(a - b) <= (t || 0.02);
const caps = { min: 0.5, max: 10 };   // an iPhone's multi-lens camera as Safari reports it
// a screen in the frame: its box as fractions, with the finder's figures
const screen = (x0, y0, x1, y1, cut) => ({ found: true, cut: cut || [], widthFrac: x1 - x0, heightFrac: y1 - y0, boxFrac: [x0, y0, x1, y1] });
const none = { found: false, cut: [] };

// nothing to do
assert(framingMove(screen(0.3, 0.3, 0.7, 0.7), 2, null, 1, 0) === null, 'no zoom range: nothing to do');
assert(framingMove(none, 2, caps, 1, 2) === null, 'nothing in view for a moment: the lens stays');
assert(framingMove(none, 1, caps, 1, 20) === null, 'nothing in view for a while, at the chosen zoom already: stays');
assert(framingMove(screen(0.1, 0.1, 0.95, 0.9), 2, caps, 1, 0) === null, 'a screen filling 85 % of the frame: it fits, no move');
assert(framingMove(screen(0.3, 0.3, 0.7, 0.7), 10, caps, 1, 0) === null, 'a small screen at the top of the range: nothing more to do');

// back toward the chosen zoom, step by step, from either side
let m = framingMove(none, 2.53, caps, 1, 5);
assert(m && m.why === 'back' && near(m.zoom, 1.9), 'nothing in view for five looks, zoomed in: a step back out (' + JSON.stringify(m) + ')');
m = framingMove(none, 1.1, caps, 1, 5);
assert(m && m.why === 'back' && m.zoom === 1, '… the last step lands on the chosen zoom exactly');
m = framingMove(none, 0.5, caps, 1, 5);
assert(m && m.why === 'back' && near(m.zoom, 0.665), 'zoomed out for a cut-off screen that is gone: a step back in (' + JSON.stringify(m) + ')');

// out while cut off; at the widest, nothing the zoom can do
m = framingMove(screen(0, 0.1, 0.8, 0.9, ['left']), 2, caps, 1, 0);
assert(m && m.why === 'out' && near(m.zoom, 1.44), 'cut off on the left at 2×: a step out (' + JSON.stringify(m) + ')');
m = framingMove(screen(0, 0.1, 0.8, 0.9, ['left']), 0.6, caps, 1, 0);
assert(m && m.why === 'out' && m.zoom === 0.5, '… never past the widest');
m = framingMove(screen(0, 0.1, 0.8, 0.9, ['left']), 0.5, caps, 1, 0);
assert(m && m.why === 'widest' && m.zoom === null, 'cut off at the widest: the zoom can do nothing more (another lens, or the phone moves)');

// in while small: the largest step, or the fit, whichever is less — and never past the nearest edge
m = framingMove(screen(0.35, 0.32, 0.65, 0.68), 1, caps, 1, 0);
assert(m && m.why === 'in' && near(m.zoom, FRAME_STEP), 'a screen 36 % of the frame, centred: the largest step in (' + JSON.stringify(m) + ')');
m = framingMove(screen(0.2, 0.22, 0.8, 0.78), 1.6, caps, 1, 0);
assert(m && m.why === 'in' && near(m.zoom, 1.6 * 0.9 / 0.6), 'a screen 60 % of the frame: the step that lands it on 90 % (' + JSON.stringify(m) + ')');
m = framingMove(screen(0.6, 0.3, 0.9, 0.7), 1, caps, 1, 0);
assert(m && m.why === 'in' && near(m.zoom, 0.475 / 0.4, 0.01), 'a small screen off to the right: the step is capped by its headroom to the right edge (' + JSON.stringify(m) + ')');
assert(framingMove(screen(0.55, 0.2, 0.98, 0.8), 1, caps, 1, 0) === null, 'a small screen already at the right edge: no step in (it would be cut off)');
m = framingMove(screen(0.01, 0.01, 0.99, 0.99), 2, caps, 1, 0);
assert(m && m.why === 'room' && near(m.zoom, 1.8), 'a screen filling the frame to its edges, not cut: a touch out for some room (' + JSON.stringify(m) + ')');
assert(framingMove(screen(0.01, 0.01, 0.99, 0.99), 0.5, caps, 1, 0) === null, '… but not past the widest');

// a run of steps settles on a fit, from anywhere in the frame, without the screen ever leaving it
let worst = 0, longest = 0, unfit = 0;
let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
for (let trial = 0; trial < 400; trial++) {
  // a screen somewhere in the frame, small or large, its centre anywhere
  const w = 0.12 + rnd() * 0.8, h = w * (0.5 + rnd() * 0.3);
  if (h > 0.98) continue;
  const cx = w / 2 + rnd() * (1 - w), cy = h / 2 + rnd() * (1 - h);
  let box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], zoom = 1, steps = 0, last = null;
  for (; steps < 8; steps++) {
    const sc = screen(box[0], box[1], box[2], box[3]);
    const mv = framingMove(sc, zoom, caps, 1, 0);
    if (!mv || mv.zoom == null) { last = mv; break; }
    const f = mv.zoom / zoom; zoom = mv.zoom;
    box = [0.5 + (box[0] - 0.5) * f, 0.5 + (box[1] - 0.5) * f, 0.5 + (box[2] - 0.5) * f, 0.5 + (box[3] - 0.5) * f];
    worst = Math.max(worst, -box[0], -box[1], box[2] - 1, box[3] - 1);
  }
  longest = Math.max(longest, steps);
  const fill = Math.max(box[2] - box[0], box[3] - box[1]);
  // settled: in the band, or as close to an edge as the step allows (a screen off to one side cannot fill the frame)
  const atEdge = Math.min(box[0], box[1], 1 - box[2], 1 - box[3]) < 0.06;
  if (!(fill >= FRAME_LOW && fill <= FRAME_HIGH) && !atEdge && zoom < caps.max - 0.02) unfit++;
}
assert(worst <= 0, 'no step ever pushes the screen past the frame\'s edge (worst overshoot ' + worst.toFixed(3) + ')');
assert(longest <= 6, 'every run settles within six steps (longest ' + longest + ')');
assert(unfit === 0, 'every run ends on a fit, or at an edge (' + unfit + ' did not)');
console.log(process.exitCode ? 'FRAMING FAILED' : 'ALL TESTS PASSED');
