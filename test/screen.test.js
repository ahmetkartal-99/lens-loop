// Unit test of the screen finder's geometry, extracted from index.html: the bright rectangle of a laptop screen in
// a small grey copy of the frame — its corners however it is turned or foreshortened, whether it runs into the
// frame's edge, several bright pieces taken together — the square-to-quad map used to straighten it, and the tile
// plan for small print. Run: node test/screen.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  let screenWhy = ', '  const lookCanvas = ');
const { screenQuad, homography, mapUV, tilePlan, screenWhyOf } = new Function(code + '; return { screenQuad, homography, mapUV, tilePlan, screenWhyOf: () => screenWhy };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

const W = 192, H = 144;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// a frame: a dim room (with grain) and bright quadrilaterals drawn into it
const frame = (quads, bg) => {
  const lum = new Uint8Array(W * H);
  for (let i = 0; i < lum.length; i++) lum[i] = Math.max(0, Math.min(255, (bg == null ? 35 : bg) + Math.round(rnd() * 18)));
  const inside = (q, x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c < 0) s |= 1; else if (c > 0) s |= 2; } return s !== 3; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const q of quads) if (inside(q.pts, x + 0.5, y + 0.5)) lum[y * W + x] = Math.max(0, Math.min(255, (q.v || 215) + Math.round(rnd() * 25)));
  return lum;
};
const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;

// 1. a screen seen square on
{
  const pts = [[40, 30], [150, 30], [150, 110], [40, 110]];
  const r = screenQuad(frame([{ pts }]), W, H);
  assert(r && near(r.quad[0], [40, 30], 1) && near(r.quad[1], [149, 30], 1) && near(r.quad[2], [149, 109], 1) && near(r.quad[3], [40, 109], 1), 'square on: the four corners (' + JSON.stringify(r && r.quad) + ')');
  assert(r && r.fill > 0.9 && r.fill < 1.1 && !r.cut.length && !r.scattered, 'square on: a clean rectangle, nothing cut (fill ' + (r && r.fill.toFixed(2)) + ')');
  assert(r && Math.abs(r.coverage - (110 * 80) / (W * H)) < 0.01, 'square on: coverage ' + (r && r.coverage.toFixed(3)));
}
// 2. a screen seen from the side (foreshortened: the far edge shorter) and a little turned
{
  const pts = [[30, 20], [160, 38], [158, 112], [34, 128]];
  const r = screenQuad(frame([{ pts }]), W, H);
  assert(r && near(r.quad[0], [30, 20], 2) && near(r.quad[1], [159, 38], 2) && near(r.quad[2], [157, 111], 2) && near(r.quad[3], [34, 127], 2), 'from the side: the four corners (' + JSON.stringify(r && r.quad) + ')');
  assert(r && r.fill > 0.9 && r.fill < 1.1 && !r.cut.length, 'from the side: a clean quadrilateral, nothing cut');
  // the map from the straightened picture back to the frame: the corners land on the corners, the centre inside
  const M = homography(pts);
  assert(near(mapUV(M, 0, 0), pts[0], 1e-6) && near(mapUV(M, 1, 0), pts[1], 1e-6) && near(mapUV(M, 1, 1), pts[2], 1e-6) && near(mapUV(M, 0, 1), pts[3], 1e-6), 'homography: the unit square\'s corners map onto the quadrilateral\'s');
  const c = mapUV(M, 0.5, 0.5);
  assert(c[0] > 80 && c[0] < 110 && c[1] > 60 && c[1] < 90, 'homography: the centre maps inside (' + c.map((v) => v.toFixed(1)) + ')');
  const top = mapUV(M, 0.5, 0); assert(Math.abs(top[1] - 29) < 2, 'homography: the top edge\'s middle lies on the top edge (' + top.map((v) => v.toFixed(1)) + ')');
}
// 3. the screen runs out of the frame on the right: cut, so no answer goes out and the zoom goes out
{
  const pts = [[60, 20], [230, 20], [230, 120], [60, 120]];
  const r = screenQuad(frame([{ pts }]), W, H);
  assert(r && r.cut.join() === 'right', 'cut off on the right (' + JSON.stringify(r && r.cut) + ')');
  const pts2 = [[-20, -10], [120, -10], [120, 90], [-20, 90]];
  const r2 = screenQuad(frame([{ pts: pts2 }]), W, H);
  assert(r2 && r2.cut.includes('left') && r2.cut.includes('top') && !r2.cut.includes('right'), 'cut off at the top and the left (' + JSON.stringify(r2 && r2.cut) + ')');
}
// 4. nothing to crop: a bright lamp (small), the whole frame bright (a page filling it), an empty dark room
{
  assert(screenQuad(frame([{ pts: [[10, 10], [22, 10], [22, 22], [10, 22]] }]), W, H) === null, 'a small lamp is not a screen');
  assert(screenQuad(frame([], 200), W, H) === null, 'the whole frame bright: nothing to crop');
  assert(screenQuad(frame([]), W, H) === null, 'a dark room: nothing');
  // frames all of one shade (a test camera's, a camera that delivers nothing): told apart by what they are
  assert(screenQuad(new Uint8Array(W * H).fill(60), W, H) === null && /nothing much brighter/.test(screenWhyOf()), 'a frame all of one grey: nothing to crop, nothing more (' + screenWhyOf() + ')');
  assert(screenQuad(new Uint8Array(W * H).fill(0), W, H) === null && /frame is black/.test(screenWhyOf()), 'a frame all black: the camera shows nothing (' + screenWhyOf() + ')');
  assert(screenQuad(new Uint8Array(W * H).fill(200), W, H) === null && /fills the view/.test(screenWhyOf()), 'a frame all of one bright shade: the screen fills the view (' + screenWhyOf() + ')');
  assert(screenQuad(frame([], 200), W, H) === null && /fills the view/.test(screenWhyOf()), 'a bright frame with grain: the screen fills the view (' + screenWhyOf() + ')');
}
// 5. bright content in pieces (a dark-themed page with two white boxes): taken together, the box around both
{
  const r = screenQuad(frame([{ pts: [[20, 20], [90, 20], [90, 70], [20, 70]] }, { pts: [[110, 60], [170, 60], [170, 120], [110, 120]] }]), W, H);
  assert(r && r.scattered && r.union[0] === 20 && r.union[1] === 20 && r.union[2] === 169 && r.union[3] === 119, 'two bright pieces: scattered, the union box around both (' + JSON.stringify(r && r.union) + ')');
  assert(r && !r.cut.length, 'two bright pieces: a piece at no edge, nothing cut');
}
// 6. the brightest thing wins: a lamp beside the screen does not become the screen, nor does it count as a cut
{
  const r = screenQuad(frame([{ pts: [[40, 30], [150, 30], [150, 110], [40, 110]] }, { pts: [[0, 0], [14, 0], [14, 30], [0, 30]], v: 250 }]), W, H);
  assert(r && near(r.quad[0], [40, 30], 1) && r.scattered && !r.cut.length, 'a lamp at the frame\'s edge: the screen is the screen, nothing cut (' + JSON.stringify(r && r.cut) + ')');
  assert(r && r.otherFrac < 0.25, 'a lamp is small beside the screen (otherFrac ' + (r && r.otherFrac.toFixed(2)) + '): the screen is still straightened, the lamp left out');
  const two = screenQuad(frame([{ pts: [[20, 20], [90, 20], [90, 70], [20, 70]] }, { pts: [[110, 60], [170, 60], [170, 120], [110, 120]] }]), W, H);
  assert(two && two.otherFrac >= 0.25, 'two boxes of a size (otherFrac ' + (two && two.otherFrac.toFixed(2)) + '): taken together, the box around both');
}
// 6b. two shades of a dark desk (a lighter band on the floor) are not a screen: a screen is bright and far brighter than the room
{
  const lum = frame([]);
  for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = 48 + Math.round(rnd() * 6);
  assert(screenQuad(lum, W, H) === null, 'a lighter band of desk is not a screen');
  const dim = frame([{ pts: [[40, 30], [150, 30], [150, 110], [40, 110]], v: 70 }]);
  assert(screenQuad(dim, W, H) === null, 'a faintly lighter rectangle (lum ~80 in a room of ~44) is not a screen either');
}
// 6c. the room as it is: the screen is chosen for its SHAPE, not for being the largest bright thing
{
  // a bright window at the top right, bigger than the screen and running off the frame: the screen is the screen
  const win = frame([{ pts: [[20, 40], [110, 40], [110, 110], [20, 110]], v: 225 }, { pts: [[120, -10], [230, -10], [230, 70], [120, 70]], v: 240 }]);
  const r = screenQuad(win, W, H);
  assert(r && near(r.quad[0], [20, 40], 1) && near(r.quad[2], [109, 109], 1) && !r.cut.length, 'a window behind the laptop, bigger and cut off: the screen is chosen (' + JSON.stringify(r && r.quad) + ')');
  // a lamp (round) beside a FAR screen (a quarter of the width): the screen alone, straightened — not a box around both
  const lum = frame([{ pts: [[80, 60], [128, 60], [128, 92], [80, 92]], v: 230 }]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x - 170) / 14, dy = (y - 24) / 18; if (dx * dx + dy * dy <= 1) lum[y * W + x] = 250; }
  const far = screenQuad(lum, W, H);
  assert(far && near(far.quad[0], [80, 60], 1) && near(far.quad[2], [127, 91], 1) && !far.merged && far.coverage < 0.07, 'a lamp beside a far screen: the screen alone, a quarter of the width (' + JSON.stringify(far && far.quad) + ')');
  // a lit room: the floor dark, the desk and the walls mid-bright, the screen brightest — the first split lumps the
  // desk, the walls and the screen into one blob off the frame's edges; the second, higher split finds the screen
  const lit = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lit[y * W + x] = (y < 100 ? 165 : y < 125 ? 150 : 40) + Math.round(rnd() * 14);
  for (let y = 30; y < 95; y++) for (let x = 50; x < 140; x++) lit[y * W + x] = 238 + Math.round(rnd() * 10);
  const litR = screenQuad(lit, W, H);
  assert(litR && near(litR.quad[0], [50, 30], 1) && near(litR.quad[2], [139, 94], 1) && !litR.cut.length && litR.fill > 0.9, 'a lit room (desk and walls mid-bright): the screen found at the higher split (' + JSON.stringify(litR && { quad: litR.quad, cut: litR.cut, thr: litR.thr }) + ')');
  // a page split by a dark bar (the blue divider of a two-panel question): two rectangles, one screen — its corners
  const split = frame([{ pts: [[40, 30], [94, 30], [94, 110], [40, 110]] }, { pts: [[98, 30], [150, 30], [150, 110], [98, 110]] }]);
  const sp = screenQuad(split, W, H);
  assert(sp && near(sp.quad[0], [40, 30], 1) && near(sp.quad[1], [149, 30], 1) && near(sp.quad[2], [149, 109], 1) && !sp.merged && sp.fill > 0.9, 'a screen split by a dark bar: one screen, its four corners (' + JSON.stringify(sp && sp.quad) + ', merged ' + (sp && sp.merged) + ')');
  // a screen at a STEEP angle: an LCD dims hard off-axis, so its face runs from dark at the far side (dimmer than the
  // room) to blown-out at the near side, a black bezel around it — the WHOLE screen, found at a low split
  const steep = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) steep[y * W + x] = 70 + Math.round(rnd() * 16);         // the room: brighter than the screen's far side
  for (let y = 24; y < 124; y++) for (let x = 30; x < 166; x++) steep[y * W + x] = 14 + Math.round(rnd() * 6);    // the bezel
  for (let y = 28; y < 120; y++) for (let x = 34; x < 162; x++) steep[y * W + x] = Math.min(255, Math.round(44 + (x - 34) / 127 * 200) + Math.round(rnd() * 8));   // 44 at the far edge → 244 at the near edge
  const st = screenQuad(steep, W, H);
  assert(st && near(st.quad[0], [34, 28], 1) && near(st.quad[1], [161, 28], 1) && near(st.quad[2], [161, 119], 1) && near(st.quad[3], [34, 119], 1) && !st.cut.length, 'a screen at a steep angle, dark at the far side: the whole of it (' + JSON.stringify(st && { quad: st.quad, thr: st.thr, coverage: +st.coverage.toFixed(3) }) + ')');
  assert(st && st.coverage > 0.41, 'all of its face, not just the bright near part (coverage ' + (st && st.coverage.toFixed(3)) + ', the screen is 0.426 of the frame)');
  // 6d. a page LARGER than the view (the phone close to the screen, looking up at it): it runs off the right, the top
  // and the bottom, its face brighter toward the near side, with a blown-out patch — the patch is a clean rectangle
  // at a higher split, but it is a piece of the same surface, not a screen: the cut-off page stays the answer
  const over = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) over[y * W + x] = x < 38 ? 28 + Math.round(rnd() * 14) : Math.min(255, Math.round(180 + 55 * Math.sin(Math.PI * (x - 38) / 154)) + Math.round(rnd() * 8));   // the dark room at the left; the page from x = 38 on, 180 at its far side, brightest in the middle, dimmer again at the grazing right edge
  for (let y = 40; y < 110; y++) for (let x = 115; x < 160; x++) over[y * W + x] = 251 + Math.round(rnd() * 4);   // the blown-out patch, a clean rectangle at the highest split
  const ov = screenQuad(over, W, H);
  assert(ov && ov.cut.length >= 3 && ov.coverage > 0.7, 'a page larger than the view, with a blown-out patch: the cut-off page, not the patch (' + JSON.stringify(ov && { cut: ov.cut, coverage: +ov.coverage.toFixed(2), thr: ov.thr, clean: ov.clean }) + ')');
  // … while a screen inside a lit room (bezel and desk round it, both darker) is still found at the higher split (6c above)
  // the reason, when nothing is found
  screenQuad(frame([]), W, H);
  assert(/brighter than the room|bright/.test(screenWhyOf()), 'the diagnostics say why nothing was found (' + screenWhyOf() + ')');
}
// 7. the tile plan: closer tiles only when the picture holds more than one carries, 2×2 at most, overlapping
{
  assert(tilePlan(1500, 900).length === 0 && tilePlan(1800, 1100).length === 0, 'no tiles for a picture one image carries');
  const t = tilePlan(3072, 1728);
  assert(t.length === 4 && t.every((x) => x.cols === 2 && x.rows === 2), '3072×1728: four tiles (' + t.length + ')');
  const right = t.find((x) => x.c === 1 && x.r === 0), left = t.find((x) => x.c === 0 && x.r === 0);
  assert(left.x === 0 && Math.round(left.x + left.w) > Math.round(right.x) && Math.round(right.x + right.w) === 3072, 'tiles overlap on the seam and reach the far edge');
  const tall = tilePlan(1200, 2400);
  assert(tall.length === 2 && tall.every((x) => x.cols === 1 && x.rows === 2), 'a tall picture: two tiles, one above the other');
  const wide = tilePlan(4000, 1000);
  assert(wide.length === 2 && wide.every((x) => x.cols === 2 && x.rows === 1), 'a wide picture: two tiles side by side');
}
console.log(process.exitCode ? 'SCREEN FAILED' : 'ALL TESTS PASSED');
