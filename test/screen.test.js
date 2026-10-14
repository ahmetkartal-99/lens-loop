// Unit test of the screen finder's geometry, extracted from index.html: the bright rectangle of a laptop screen in
// a small grey copy of the frame — its corners however it is turned or foreshortened, whether it runs into the
// frame's edge, several bright pieces taken together — the square-to-quad map used to straighten it, and the tile
// plan for small print. Run: node test/screen.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  function screenQuad(', '  const lookCanvas = ');
const { screenQuad, homography, mapUV, tilePlan } = new Function(code + '; return { screenQuad, homography, mapUV, tilePlan };')();
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
