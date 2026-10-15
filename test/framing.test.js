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

// a screen LARGER than the view is framed by its PRINT: the text whole in view — the lens stays, or closes in where
// the headroom allows; the text running to an edge — one step out, then another look; at the widest, nothing more
const inkAt = (x0, y0, x1, y1, edge) => ({ box: [x0, y0, x1, y1], w: x1 - x0, h: y1 - y0, edge: edge || [] });
const big = screen(0, 0, 1, 1, ['every side']);
assert(framingMove(big, 1, caps, 1, 0, inkAt(0.03, 0.1, 0.3, 0.5)) === null, 'the screen fills the view, the question whole at the far left: the lens STAYS (closing in would push it out) — the close-up reads it');
m = framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0.35, 0.35, 0.65, 0.65), { strong: true }));
assert(m && m.why === 'in' && near(m.zoom, 1.44), 'the screen fills the view, a block of print near the centre: a step in on the print, with room to spare (' + JSON.stringify(m) + ')');
assert(framingMove(big, 1, caps, 1, 0, inkAt(0.35, 0.35, 0.65, 0.65)) === null, 'a speck of print near the centre: kept in view, not closed in on');
assert(framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0.05, 0.3, 0.3, 0.6), { strong: true })) === null, 'a block of print off at the left: not closed in on (it would be pushed out)');
assert(framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0.35, 0.35, 0.65, 0.65), { strong: true, noIn: true })) === null, 'right after a step out from the print: no step in');
m = framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0, 0.1, 0.5, 0.7, ['left']), { strong: true }));
assert(m && m.why === 'text' && near(m.zoom, 0.72), 'a LARGE block of print running off the left edge: ONE step out, not straight to the widest (' + JSON.stringify(m) + ')');
m = framingMove(big, 0.5, caps, 1, 0, Object.assign(inkAt(0, 0.1, 0.5, 0.7, ['left']), { strong: true }));
assert(m && m.why === 'widest' && m.zoom === null, '… and at the widest, nothing more the zoom can do');
assert(framingMove(big, 1, caps, 1, 0, inkAt(0, 0.1, 0.5, 0.7, ['left'])) === null, 'the same extent of print that is no block (a line, specks): read as it is, no step out');
assert(framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0.1, 0, 0.3, 0.3, ['top']), { strong: true })) === null, 'a SMALL block at the top edge (a question in the corner, its page header above): the lens stays — a step out would only shrink it, the close-up reads it');
assert(framingMove(big, 1, caps, 1, 0, inkAt(0.4, 0.4, 0.55, 0.5)) === null, 'a line of print (not a block) whole in view: the lens stays, it does not go out to look for more');
m = framingMove(big, 1, caps, 1, 0, Object.assign(inkAt(0.15, 0.3, 0.4, 0.6), { strong: true }));
assert(m && m.why === 'in' && near(m.zoom, 1.221, 0.01), 'a block off to the left with some headroom: closed in on as far as the headroom allows, a little short of it (' + JSON.stringify(m) + ')');
m = framingMove(screen(0, 0.1, 0.8, 0.9, ['left']), 2, caps, 1, 0, null);
assert(m && m.why === 'out' && near(m.zoom, 1.44), 'cut off with no print found: out as before (' + JSON.stringify(m) + ')');
assert(framingMove(big, 1, caps, 1, 0, inkAt(0.1, 0.1, 0.9, 0.9)) === null, 'the print filling the view already: nothing to do');

// the SWEEP for print: a screen larger than the view, nothing in view at the widest — a step in toward the chosen
// zoom when one is due, a wait between steps, nothing past the chosen zoom; without a sweep, out as before
const blank = screen(0, 0, 1, 1, ['every side']);
m = framingMove(blank, 0.5, caps, 1, 0, null, 'step');
assert(m && m.why === 'seek' && near(m.zoom, 0.6), 'a sweep step from the widest: a fifth closer (' + JSON.stringify(m) + ')');
assert(framingMove(blank, 0.6, caps, 1, 0, null, 'hold') === null, 'between sweep steps: the lens waits (no step out either)');
m = framingMove(blank, 0.9, caps, 1, 0, null, 'step');
assert(m && m.why === 'seek' && m.zoom === 1, 'the last sweep step lands on the chosen zoom exactly');
assert(framingMove(blank, 1, caps, 1, 0, null, 'step') === null, 'at the chosen zoom the sweep has nowhere further to go');
m = framingMove(blank, 1, caps, 1, 0, null, null);
assert(m && m.why === 'out' && near(m.zoom, 0.72), 'no sweep: out, to find the print (' + JSON.stringify(m) + ')');
m = framingMove(blank, 0.6, caps, 1, 0, Object.assign(inkAt(0.35, 0.35, 0.65, 0.65), { strong: true }), 'step');
assert(m && m.why === 'in', 'a block found during a sweep: the framing takes over (' + JSON.stringify(m) + ')');
m = framingMove(blank, 0.5, caps, 1, 0, inkAt(0.4, 0, 0.8, 0.1, ['top']), 'step');
assert(m && m.why === 'seek' && near(m.zoom, 0.6), 'a line of print at the top edge (the browser\'s tab bar) does not stop a sweep: the step goes on (' + JSON.stringify(m) + ')');
m = framingMove(blank, 0.6, caps, 1, 0, inkAt(0.4, 0.4, 0.55, 0.5), 'step');
assert(m && m.why === 'seek', '… nor a speck whole in view (' + JSON.stringify(m) + ')');

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
