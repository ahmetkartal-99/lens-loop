// Needs playwright. Run: node test/screen.e2e.js
// The laptop screen in the frame, whatever the angle: every capture finds it, straightens it at the sensor's
// resolution and sends that as an overview plus closer tiles; a screen small in the frame is zoomed in on (the small
// capture dropped, the zoomed one taken a moment later); a screen with an edge outside the frame is not answered —
// the zoom goes out, then the wide lens is tried — and the meta line says how the picture was taken. The real page
// runs with a camera this test controls (a 2560×1440 canvas drawing a bright screen on a dark desk, scaled by the
// zoom the page asks for) whose tracks report a zoom range, and a fake Claude endpoint.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const sse = (text) => {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 900 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } }) +
    ev('message_stop', { type: 'message_stop' });
};
const textOf = (content) => content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
// the size of a JPEG from its bytes (the SOF marker)
function jpegSize(b64) {
  const b = Buffer.from(b64, 'base64');
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
    // the camera: a dark desk with a bright screen drawn as a quadrilateral, scaled about the frame's centre by the
    // zoom the page asks for (and by a half on the "ultra wide" lens), with dark lines of "text" inside it
    window.__scene = 'desk'; window.__zoom = 1; window.__device = 'main'; window.__zoomCalls = [];
    const W = 2560, H = 1440;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const QUADS = {
      small: [[896, 464], [1664, 464], [1664, 976], [896, 976]],                 // 3:2, 30% of the width
      angled: [[300, 150], [2200, 250], [2180, 1330], [320, 1400]],             // seen from the side, most of the frame
      cut: [[900, 200], [3000, 200], [3000, 1300], [900, 1300]],                // runs out of the frame on the right
    };
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      g.fillStyle = '#232326'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#303034'; g.fillRect(0, 1200, W, 240);
      if (!QUADS[s]) return;
      const k = (window.__zoom || 1) * (window.__device === 'wide' ? 0.5 : 1);
      const q = QUADS[s].map(([x, y]) => [1280 + (x - 1280) * k, 720 + (y - 720) * k]);
      g.fillStyle = '#f6f6f3'; g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fill();
      // lines of text, laid on the quadrilateral (bilinear in its unit square)
      const at = (u, v) => { const x = (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0]); const y = (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1]); return [x, y]; };
      g.fillStyle = '#1a1a1a';
      for (let v = 0.12; v < 0.9; v += 0.07) { const len = 0.35 + ((v * 100) % 50) / 100; const a = at(0.08, v), b = at(0.08 + len, v), c = at(0.08 + len, v + 0.02), d = at(0.08, v + 0.02); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); }
    };
    draw(); setInterval(draw, 100);
    const vstream = cv.captureStream(10);
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'main', label: 'Back Camera' }, { kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }, { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' }];
    md.getUserMedia = async (c) => {
      const tracks = [];
      if (!c || c.video) {
        const want = c && c.video && c.video.deviceId && c.video.deviceId.exact; if (want) window.__device = want;
        for (const t0 of vstream.getVideoTracks()) {
          const t = t0.clone();
          t.getCapabilities = () => ({ zoom: { min: 1, max: 5, step: 0.1 }, deviceId: window.__device });
          t.getSettings = () => ({ zoom: window.__zoom, deviceId: window.__device, width: 2560, height: 1440 });
          t.applyConstraints = async (cc) => { const z = (cc.advanced && cc.advanced[0] && cc.advanced[0].zoom) || cc.zoom; if (typeof z === 'number') { window.__zoom = z; window.__zoomCalls.push(Math.round(z * 100) / 100); } };
          tracks.push(t);
        }
      }
      if (c && c.audio) { const ac = new AudioContext(); tracks.push(...ac.createMediaStreamDestination().stream.getAudioTracks()); }
      return new MediaStream(tracks);
    };
  });
  let scene = 'desk';
  const main = [];
  const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) {
      const ut = textOf(body.messages[0].content);
      const answer = /SAME or DIFFERENT/.test(ut) ? 'DIFFERENT' : scene === 'desk' ? 'NONE' : 'CHOICE';
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    main.push({ scene, body, zoom: await page.evaluate(() => window.__zoom), at: Date.now() });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(scene === 'desk' ? 'ANSWER: An empty desk\n\nNothing to read.' : 'ANSWER: B) 42\n\nFrom the second line.') });
  });
  const status = () => page.evaluate(() => (document.getElementById('statusText') || {}).textContent || '');
  const meta = () => page.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  const go = async (s) => { scene = s; await page.evaluate((v) => { window.__scene = v; }, s); };
  const zoomCalls = () => page.evaluate(() => window.__zoomCalls.slice());
  // the CURRENT frame's pictures (earlier frames ride along ahead of it): the overview, then its closer tiles
  const imagesOf = (body) => {
    const c = body.messages[0].content;
    let i = c.findIndex((b) => b.type === 'text' && /^(CURRENT FRAME \(|The frame \()/.test(b.text));
    if (i < 0) return c.filter((b) => b.type === 'image').map((b) => jpegSize(b.source.data));
    const out = [];
    for (i = i + 1; i < c.length; i++) { const b = c[i]; if (b.type === 'image') out.push(jpegSize(b.source.data)); else if (!/closer tiles/.test(b.text)) break; }
    return out;
  };
  const labelsOf = (body) => body.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text);

  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  await page.click('#startBtn');
  await page.waitForTimeout(6000);
  assert(main.length === 1 && main[0].scene === 'desk', '0. the desk: answered as it is (' + main.map((m) => m.scene).join() + ')');
  const d0 = imagesOf(main[0].body)[0];
  assert(d0 && d0.w === 1568 && d0.h === 882, '0. nothing screen-like: the whole frame goes (' + JSON.stringify(d0) + ')');
  assert((await zoomCalls()).length === 0, '0. no zoom for a desk');

  // 1. a screen small in the frame: zoomed in on first — the small capture is dropped, the zoomed one answered
  await go('small');
  await page.waitForTimeout(9000);
  let zc = await zoomCalls();
  assert(zc.length >= 1 && zc[0] === 2, '1. zoomed in (×2 for a screen 30% of the frame wide) (' + zc.join() + ')');
  assert(main.length === 2 && main[1].scene === 'small' && main[1].zoom === 2, '1. the answer came from the zoomed capture, not the small one (' + main.map((m) => m.scene + '@' + m.zoom).join() + ')');
  let im = imagesOf(main[1].body);
  assert(im[0] && Math.abs(im[0].w / im[0].h - 1.5) < 0.06 && im[0].w >= 1400 && im[0].w <= 1568, '1. the picture is the screen itself — 3:2, at the pixels the sensor has (' + JSON.stringify(im[0]) + ')');
  assert(/screen (straightened|cropped) · 2×/.test(await meta()), '1. the meta line says how the picture was taken (' + await meta() + ')');

  // 2. the screen seen from the side, most of the frame: straightened and sent with closer tiles; the zoom goes back
  await go('angled');
  await page.waitForTimeout(12000);
  const ang = main.filter((m) => m.scene === 'angled');
  assert(ang.length >= 1, '2. the angled screen was answered (' + main.map((m) => m.scene + '@' + m.zoom).join() + ')');
  const last = ang[ang.length - 1];
  im = imagesOf(last.body);
  assert(im[0] && Math.abs(im[0].w / im[0].h - 1.52) < 0.08, '2. the overview is the straightened screen (its own 3:2-ish shape, not the frame\'s 16:9) (' + JSON.stringify(im[0]) + ')');
  assert(im.length === 3 && im.slice(1).every((t) => t.w >= 1000 && t.w <= 1568), '2. two closer tiles ride along (' + JSON.stringify(im) + ')');
  assert(labelsOf(last.body).some((t) => /The same picture in 2 closer tiles \(overlapping; left to right, then top to bottom\)/.test(t)), '2. the tiles are labelled');
  assert(/screen straightened · 2 tiles/.test(await meta()) || /screen cropped · 2 tiles/.test(await meta()), '2. the meta line: straightened, two tiles (' + await meta() + ')');

  // 3. an edge of the screen outside the frame: not answered; the zoom is already at its widest, so the wide lens
  await page.evaluate(() => { window.__zoom = 1; });
  const before3 = main.length;
  await go('cut');
  await page.waitForTimeout(4000);
  assert(main.length === before3 || main[main.length - 1].scene !== 'cut' || (await page.evaluate(() => window.__device)) === 'wide', '3. a cut-off screen is not answered as it is');
  await page.waitForTimeout(8000);
  assert((await page.evaluate(() => window.__device)) === 'wide', '3. the wide lens was switched to (' + await page.evaluate(() => window.__device) + ')');
  const cut = main.filter((m) => m.scene === 'cut');
  assert(cut.length >= 1, '3. once the whole screen fits, it is answered (' + main.map((m) => m.scene).join() + ')');
  const cm = cut.length ? imagesOf(cut[cut.length - 1].body)[0] : null;
  assert(cm && Math.abs(cm.w / cm.h - 2100 / 1100) < 0.1, '3. … as the screen itself, whole (' + JSON.stringify(cm) + ')');

  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('zoom calls:', (await zoomCalls()).join(', '));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'SCREEN E2E FAILED' : 'SCREEN E2E PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
