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
  const initCamera = () => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
    // the camera: a dark desk with a bright screen drawn as a quadrilateral, scaled about the frame's centre by the
    // zoom the page asks for (and by a half on the "ultra wide" lens), with dark lines of "text" inside it
    window.__scene = 'desk'; window.__zoom = 1; window.__device = 'main'; window.__zoomCalls = []; window.__zoomStuck = localStorage.getItem('zoomStuck') === '1';
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
      if (s === 'blank' || s === 'corner') {   // the screen filling the view at EVERY zoom (the camera close, to one side): a blank page, or one with a question block at the top left that the zoom scales about the middle — tiny at the widest, a block at 0.7×
        g.fillStyle = '#ececea'; g.fillRect(0, 0, W, H);
        if (s === 'corner') { const k = window.__zoom || 1; g.fillStyle = '#1a1a1a'; for (let y = 120; y < 240; y += 30) { const len = 160 + ((y / 30) % 3) * 20; for (let x = 110; x < 110 + len; x += 38) g.fillRect(1280 + (x - 1280) * k, 720 + (y - 720) * k, 24 * k, 9 * k); } }
        return;
      }
      if (s === 'filled') {   // the screen filling the whole view (the phone close, or far off to one side): a page with a question block at the top left
        g.fillStyle = '#ececea'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#1a1a1a';
        for (let y = 120; y < 520; y += 40) { const len = 380 + ((y / 40) % 3) * 90; for (let x = 110; x < 110 + len; x += 46) g.fillRect(x, y, 30, 12); }   // lines of "words"

        g.fillRect(2300, 900, 14, 22);   // a cursor far off
        return;
      }
      if (!QUADS[s]) return;
      const k = (window.__zoom || 1) * (window.__device === 'wide' ? 0.5 : 1);
      const q = QUADS[s].map(([x, y]) => [1280 + (x - 1280) * k, 720 + (y - 720) * k]);
      g.fillStyle = '#f6f6f3'; g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.fill();
      // lines of text, laid on the quadrilateral (bilinear in its unit square)
      const at = (u, v) => { const x = (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0]); const y = (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1]); return [x, y]; };
      g.fillStyle = '#1a1a1a';
      // lines of "words": at a 2560-px frame, 38 × 11 px with 25-px gaps — strokes, not bars, at the ink detector's 800-px scale (a 63 × 22 px dash fills a 16-px cell from end to end and is rightly no print)
      for (let v = 0.12; v < 0.9; v += 0.05) { const len = 0.35 + ((v * 100) % 50) / 100; for (let u = 0.08; u < 0.08 + len; u += 0.03) { const a = at(u, v), b = at(u + 0.018, v), c = at(u + 0.018, v + 0.01), d = at(u, v + 0.01); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill(); } }
    };
    draw(); setInterval(draw, 100);
    const vstream = cv.captureStream(10);
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    const triple = localStorage.getItem('lensTriple') === '1';   // a phone with a multi-lens device too (one zoom range across its lenses)
    const noWide = localStorage.getItem('noWide') === '1';   // a phone with no wider lens to turn to
    md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'main', label: 'Back Camera' }].concat(noWide ? [] : [{ kind: 'videoinput', deviceId: 'wide', label: 'Back Ultra Wide Camera' }], [{ kind: 'videoinput', deviceId: 'front', label: 'Front Camera' }], triple ? [{ kind: 'videoinput', deviceId: 'triple', label: 'Back Triple Camera' }] : []);
    md.getUserMedia = async (c) => {
      const tracks = [];
      if (!c || c.video) {
        const want = c && c.video && c.video.deviceId && c.video.deviceId.exact; if (want) window.__device = want;
        for (const t0 of vstream.getVideoTracks()) {
          const t = t0.clone();
          t.getCapabilities = () => ({ zoom: { min: localStorage.getItem('wideRange') === '1' ? 0.5 : 1, max: window.__device === 'triple' ? 15 : localStorage.getItem('wideRange') === '1' ? 10 : 5, step: 0.1 }, deviceId: window.__device });
          t.getSettings = () => ({ zoom: window.__zoom, deviceId: window.__device, width: 2560, height: 1440 });
          t.applyConstraints = async (cc) => { const z = (cc.advanced && cc.advanced[0] && cc.advanced[0].zoom) || cc.zoom; if (typeof z === 'number') { window.__zoomCalls.push(Math.round(z * 100) / 100); if (!window.__zoomStuck) window.__zoom = z; } };   // a stuck lens: the call is accepted, nothing moves
          tracks.push(t);
        }
      }
      if (c && c.audio) { const ac = new AudioContext(); tracks.push(...ac.createMediaStreamDestination().stream.getAudioTracks()); }
      return new MediaStream(tracks);
    };
  };
  await ctx.addInitScript(initCamera);
  let scene = 'desk', looks = 0;
  const main = [];
  const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) {
      looks++;
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

  // 1. a screen small in the frame: the live loop zooms in on it step by step within a second or two (the largest
  // step, then the one that lands on the fit), the capture is taken as the lens settles — the small capture is
  // dropped, the zoomed one answered — and the viewfinder shows the outline and the zoom
  const smallAt = Date.now();
  await go('small');
  await page.waitForTimeout(9000);
  let zc = await zoomCalls();
  assert(zc.length >= 2 && Math.abs(zc[0] - 1.6) < 0.02 && zc[zc.length - 1] > 2.2 && zc[zc.length - 1] < 2.8, '1. zoomed in step by step, ×1.6 then onto the fit (' + zc.join() + ')');
  assert(main.length === 2 && main[1].scene === 'small' && main[1].zoom > 2.2, '1. the answer came from the zoomed capture, not the small one (' + main.map((m) => m.scene + '@' + m.zoom).join() + ')');
  assert(main[1].at - smallAt < 5000, '1. … within seconds of the screen appearing, as the lens settled, not at the next tick (' + Math.round((main[1].at - smallAt) / 100) / 10 + ' s after it appeared)');
  let im = imagesOf(main[1].body);
  assert(im[0] && Math.abs(im[0].w / im[0].h - 1.5) < 0.06 && im[0].w >= 1400 && im[0].w <= 1568, '1. the picture is the screen itself — 3:2, at the pixels the sensor has (' + JSON.stringify(im[0]) + ')');
  assert(/screen (straightened|cropped) · (\d tiles · )?(text close-up · )?2\.\d×/.test(await meta()), '1. the meta line says how the picture was taken (' + await meta() + ')');
  const live = await page.evaluate(() => document.getElementById('zoomLive').textContent);
  assert(/^2\.\d× · screen fits$/.test(live), '1. the readout on the viewfinder: the zoom, and that the screen fits (' + live + ')');
  const outline = await page.evaluate(() => { const c = document.getElementById('vfOverlay'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let green = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 1] > 150 && d[i] < 120) green++; return green; });
  assert(outline > 50, '1. a green outline is drawn round the screen (' + outline + ' px)');
  // the lens moved for this answer: that must not leave the "same picture" skip switched off — a still screen costs
  // no further look and no further answer over the next ticks
  const looks1 = looks, main1 = main.length;
  await page.waitForTimeout(11000);
  assert(looks === looks1 && main.length === main1, '1. the same screen, still, over the next 11 s: no quick look, no answer (' + (looks - looks1) + ' looks, ' + (main.length - main1) + ' answers)');
  // back to the desk: after a few captures with nothing screen-like the lens returns to 1× — and that move, whose
  // capture ends in a memory hit (the desk was answered before), must not leave the skip off either
  await go('desk');
  await page.waitForTimeout(24000);   // two captures with nothing screen-like (10 s apart), then the move
  assert((await zoomCalls()).slice(-1)[0] === 1, '1b. the desk: the lens went back to 1× (' + (await zoomCalls()).join() + ')');
  assert(main.filter((m) => m.scene === 'desk').length === 1, '1b. the desk is answered from memory, not again (' + main.map((m) => m.scene).join() + ')');
  const d1b = imagesOf(main[0].body);
  assert(d1b.length === 1, '1b. a desk goes as one picture, no closer tiles (' + d1b.length + ' images)');

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
  await browser.close();

  // 4. a lens that reports a zoom range but ignores every zoom change (seen on some phones): the small screen must
  // still be answered — after two moves that moved nothing the auto-zoom gives up for the session — not waited on
  // for ever with "Zooming in on the screen"
  const b4 = await chromium.launch();
  const ctx4 = await b4.newContext({ viewport: { width: 420, height: 860 } });
  await ctx4.addInitScript(() => { localStorage.setItem('zoomStuck', '1'); });
  await ctx4.addInitScript(initCamera);
  const p4 = await ctx4.newPage();
  const errors4 = []; p4.on('pageerror', (e) => errors4.push(String(e)));
  scene = 'small';
  const main4 = [];
  await p4.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    main4.push({ at: Date.now(), zoom: await p4.evaluate(() => window.__zoom), body });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: B) 42\n\nFrom the second line.') });
  });
  await p4.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p4.evaluate(() => { window.__scene = 'small'; });
  await p4.waitForTimeout(800);
  await p4.click('#startBtn');
  await p4.waitForTimeout(16000);
  const zc4 = await p4.evaluate(() => window.__zoomCalls.slice());
  assert(zc4.length >= 2 && zc4.length <= 4, '4. a stuck lens: a move or two tried, then left alone (' + zc4.join() + ')');
  assert(main4.length >= 1 && main4[0].zoom === 1, '4. the small screen was answered all the same, at the zoom the camera has (' + main4.length + ' answers)');
  const im4 = main4.length ? imagesOf(main4[0].body)[0] : null;
  assert(im4 && Math.abs(im4.w / im4.h - 1.5) < 0.08 && im4.w < 1000, '4. … as the straightened screen, small as the camera has it (' + JSON.stringify(im4) + ')');
  assert(errors4.length === 0, '4. no page errors' + (errors4.length ? ': ' + errors4.join(' | ') : ''));
  await b4.close();

  // 5. a zoom move must not switch the "same picture" skip off for good. A role card on the screen: its briefing is
  // locked; the desk then brings the lens back to 1×, and that capture ends in "keeping the briefing" — no request.
  // From then on the still desk must cost nothing: no quick look on any later tick.
  const b5 = await chromium.launch();
  const ctx5 = await b5.newContext({ viewport: { width: 420, height: 860 } });
  await ctx5.addInitScript(initCamera);
  const p5 = await ctx5.newPage();
  const errors5 = []; p5.on('pageerror', (e) => errors5.push(String(e)));
  let scene5 = 'small', looks5 = 0; const main5 = [];
  await p5.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) {
      looks5++;
      const ut = textOf(body.messages[0].content);
      const answer = /SAME or DIFFERENT/.test(ut) ? 'DIFFERENT' : scene5 === 'small' ? (/Answer about the SECOND photo/.test(ut) ? 'SAME' : 'CARD | Patient | Medical ward in a hospital | Explain that you are very worried about going home') : 'NONE';
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    main5.push({ scene: scene5, zoom: await p5.evaluate(() => window.__zoom) });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: Worried about going home\nROLE: Patient\n\n**Setting:** Medical ward.\n**Your role:** the doctor.\n**Background:** Admitted with pneumonia.\n**Tasks:**\n- Explain that you are worried\n- Ask what to look out for\n\n*Say "I\'m ready" to begin — I will be the Patient.*') });
  });
  await p5.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p5.evaluate(() => { window.__scene = 'small'; });
  await p5.waitForTimeout(800);
  await p5.click('#startBtn');
  await p5.waitForTimeout(9000);
  assert(main5.length === 1 && main5[0].zoom > 2.2 && /I will be the Patient/.test(await p5.evaluate(() => document.getElementById('answerBody').textContent)), '5. the role card on the screen: zoomed in on, its briefing locked (' + JSON.stringify(main5) + ')');
  scene5 = 'desk'; await p5.evaluate(() => { window.__scene = 'desk'; });
  await p5.waitForTimeout(26000);   // two screen-less captures, the move back to 1×, the capture after it ("keeping the briefing")
  assert((await p5.evaluate(() => window.__zoomCalls.slice(-1)[0])) === 1, '5. the desk: the lens went back to 1× (' + (await p5.evaluate(() => window.__zoomCalls.join())) + ')');
  assert(/I will be the Patient/.test(await p5.evaluate(() => document.getElementById('answerBody').textContent)), '5. the briefing is still on screen');
  const looks5b = looks5, main5b = main5.length;
  await p5.waitForTimeout(21000);
  assert(looks5 === looks5b && main5.length === main5b, '5. the still desk over the next 21 s: no quick look, no request (' + (looks5 - looks5b) + ' looks, ' + (main5.length - main5b) + ' requests)');
  assert(errors5.length === 0, '5. no page errors' + (errors5.length ? ': ' + errors5.join(' | ') : ''));
  await b5.close();

  // 6. a phone with a multi-lens device ("Back Triple Camera", zoom 1–15×): "Back camera (auto)" takes it, so the
  // auto-zoom has the whole range; the picker still says auto; the diagnostics show the lens and the range
  const b6 = await chromium.launch();
  const ctx6 = await b6.newContext({ viewport: { width: 420, height: 860 } });
  await ctx6.addInitScript(() => { localStorage.setItem('lensTriple', '1'); });
  await ctx6.addInitScript(initCamera);
  const p6 = await ctx6.newPage();
  const errors6 = []; p6.on('pageerror', (e) => errors6.push(String(e)));
  await p6.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'NONE' }], usage: {} }) });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: An empty desk\n\nNothing to read.') });
  });
  await p6.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p6.waitForTimeout(800);
  await p6.click('#startBtn');
  await p6.waitForTimeout(4000);
  assert((await p6.evaluate(() => window.__device)) === 'triple', '6. the multi-lens device was taken for the session (' + await p6.evaluate(() => window.__device) + ')');
  assert((await p6.evaluate(() => document.getElementById('facing').value)) === 'environment', '6. the camera picker still says auto');
  await p6.click('#settingsBtn'); await p6.waitForTimeout(300);
  const diag = await p6.evaluate(() => document.getElementById('diagBox').value);
  assert(/zoom range: 1× – 15×/.test(diag) && /no screen: /.test(diag), '6. the diagnostics: the range across the lenses, and why the desk is no screen (' + diag.split('\n').slice(0, 2).join(' | ') + ' … ' + (diag.split('\n').find((l) => /no screen/.test(l)) || '') + ')');
  assert(errors6.length === 0, '6. no page errors' + (errors6.length ? ': ' + errors6.join(' | ') : ''));
  await b6.close();

  // 7. with Drive connected, every analysed capture goes up as the camera saw it, into a "Captures" folder inside
  // Lens Loop, named with the zoom and what was decided, the finder's verdict in its description — so the framing
  // can be checked from anywhere. A small in-memory Drive stands in for Google's.
  const drv = new Map(); let seq = 0;
  drv.set('FOLDER', { id: 'FOLDER', name: 'Lens Loop', mimeType: 'application/vnd.google-apps.folder', parents: [], appProperties: {}, size: 0, description: '' });
  const okJson = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  const metaOf = (buf) => { const s = buf.toString('latin1'); const boundary = s.slice(2, s.indexOf('\r\n')); const segs = s.split('--' + boundary); return { meta: JSON.parse(Buffer.from(segs[1].slice(segs[1].indexOf('\r\n\r\n') + 4), 'latin1').toString('utf8')), size: segs[2].length - segs[2].indexOf('\r\n\r\n') - 4 }; };
  const driveRoute = async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const upload = u.pathname.startsWith('/upload/drive/v3/files');
    const id = decodeURIComponent((u.pathname.match(/\/files\/([^/]+)$/) || [])[1] || '');
    if (m === 'GET' && id) { const f = drv.get(id); return f ? okJson(route, { id: f.id, trashed: false }) : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 404, message: 'File not found: ' + id } }) }); }
    if (m === 'GET') {
      const q = u.searchParams.get('q') || '';
      const parent = (q.match(/'([^']+)' in parents/) || [])[1], name = (q.match(/name='([^']+)'/) || [])[1], kind = (q.match(/value='([^']+)'/) || [])[1];
      const listed = [...drv.values()].filter((f) => (!parent || f.parents.includes(parent)) && (!name || f.name === name) && (!kind || f.appProperties.lensloop === kind) && (!q.includes('folder') || f.mimeType === 'application/vnd.google-apps.folder'));
      return okJson(route, u.pathname.endsWith('/about') ? { user: {} } : { files: listed.map((f) => ({ id: f.id, name: f.name, appProperties: f.appProperties })) });
    }
    if (m === 'POST' && !upload) { const meta = JSON.parse(req.postData() || '{}'); const nid = 'DIR' + (++seq); drv.set(nid, Object.assign({ id: nid, parents: [], appProperties: {}, size: 0, description: '' }, meta)); return okJson(route, { id: nid }); }
    if (m === 'POST' && upload) { const { meta, size } = metaOf(req.postDataBuffer() || Buffer.alloc(0)); const nid = 'F' + (++seq); drv.set(nid, { id: nid, name: meta.name, parents: meta.parents || [], appProperties: meta.appProperties || {}, description: meta.description || '', size }); return okJson(route, { id: nid }); }
    if (m === 'PATCH') return okJson(route, { id });
    return route.fulfill({ status: 400, body: '{}' }).catch(() => {});
  };
  const b7 = await chromium.launch();
  const ctx7 = await b7.newContext({ viewport: { width: 420, height: 860 } });
  await ctx7.addInitScript(initCamera);
  await ctx7.addInitScript(() => {
    const s = JSON.parse(localStorage.getItem('lensloop.settings') || '{}');
    localStorage.setItem('lensloop.settings', JSON.stringify(Object.assign(s, { driveOn: true, driveRedirectOk: true, driveFolder: 'FOLDER', sessionListen: false })));
    localStorage.setItem('lensloop.drive', JSON.stringify({ token: 'AT', exp: Date.now() + 50 * 60 * 1000 }));
  });
  const p7 = await ctx7.newPage();
  const errors7 = []; p7.on('pageerror', (e) => errors7.push(String(e)));
  await p7.route('https://www.googleapis.com/**', driveRoute);
  await p7.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: B) 42\n\nFrom the second line.') });
  });
  await p7.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p7.evaluate(() => { window.__scene = 'small'; });
  await p7.waitForTimeout(800);
  await p7.click('#startBtn');
  await p7.waitForTimeout(9000);
  const capDir = [...drv.values()].find((f) => f.name === 'Captures' && f.mimeType === 'application/vnd.google-apps.folder');
  assert(capDir && capDir.parents.includes('FOLDER'), '7. a "Captures" folder was made inside Lens Loop');
  const caps = [...drv.values()].filter((f) => f.appProperties.lensloop === 'capture');
  assert(caps.length >= 1 && caps.every((f) => f.parents.includes(capDir && capDir.id)), '7. the captures went up into it (' + caps.length + ')');
  const sent = caps.find((f) => / · sent\.jpg$/.test(f.name));
  assert(sent && /^Capture \d\d\.\d\d\.\d\d( [AP]M)? · 2\.\d× · sent\.jpg$/.test(sent.name), '7. named with the time, the zoom and the decision (' + caps.map((f) => f.name).join(' | ') + ')');
  assert(sent && /finder: straightened \d+ % wide/.test(sent.description) && /decision: sent/.test(sent.description) && /zoom: 2\.\d× of 1× – 5×/.test(sent.description) && /frame: 2560×1440/.test(sent.description), '7. the description: the finder\'s verdict, the zoom range, the frame (' + (sent && sent.description) + ')');
  assert(sent && sent.size > 5000 && sent.size < 400000, '7. a small JPEG of the whole frame as the camera saw it (' + (sent && sent.size) + ' bytes)');
  assert(errors7.length === 0, '7. no page errors' + (errors7.length ? ': ' + errors7.join(' | ') : ''));
  await b7.close();

  // 8. a screen LARGER than the view from where the phone stands, the zoom at its widest and no wider lens to turn
  // to: the part in view is straightened and answered AT ONCE, the model told which edge lies outside, the meta line
  // says so, and a banner (not a blocker) says how the whole screen would fit
  const b8 = await chromium.launch();
  const ctx8 = await b8.newContext({ viewport: { width: 420, height: 860 } });
  await ctx8.addInitScript(() => { localStorage.setItem('noWide', '1'); });
  await ctx8.addInitScript(initCamera);
  const p8 = await ctx8.newPage();
  const errors8 = []; p8.on('pageerror', (e) => errors8.push(String(e)));
  const main8 = [];
  await p8.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    main8.push({ at: Date.now(), zoom: await p8.evaluate(() => window.__zoom), body });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: B) 42\n\nFrom the second line.') });
  });
  await p8.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p8.evaluate(() => { window.__scene = 'cut'; });
  await p8.waitForTimeout(800);
  const start8 = Date.now();
  await p8.click('#startBtn');
  await p8.waitForTimeout(7000);
  assert(main8.length >= 1 && main8[0].at - start8 < 6000, '8. the cut-off screen is answered at once, not after three captures (' + main8.length + ' answers, the first ' + Math.round((main8.length ? main8[0].at - start8 : 0) / 100) / 10 + ' s after Start)');
  assert((await p8.evaluate(() => window.__zoomCalls.slice())).length === 0 && main8.length && main8[0].zoom === 1, '8. the zoom stays at its widest (' + (await p8.evaluate(() => window.__zoomCalls.join())) + ')');
  const im8 = main8.length ? imagesOf(main8[0].body)[0] : null;
  assert(im8 && im8.w / im8.h > 1.3 && im8.w / im8.h < 1.7 && im8.w >= 1400, '8. the part in view goes straightened — its own shape, not the whole 16:9 frame (' + JSON.stringify(im8) + ')');
  assert(main8.length && labelsOf(main8[0].body).some((t) => /right edge of the screen may lie outside the photo/.test(t)), '8. the model is told the right edge lies outside');
  const meta8 = await p8.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  assert(/screen cut off on the right — the part in view straightened/.test(meta8), '8. the meta line says so (' + meta8 + ')');
  const banner8 = await p8.evaluate(() => { const b = document.getElementById('banner'); return b.hidden ? '' : b.textContent; });
  assert(/larger than the camera's view/.test(banner8) && /the whole screen fits/.test(banner8), '8. the banner says how the whole screen would fit, without blocking the answer (' + banner8 + ')');
  assert(errors8.length === 0, '8. no page errors' + (errors8.length ? ': ' + errors8.join(' | ') : ''));
  await b8.close();

  // 9. the screen FILLING the view, a question block at the top left (the phone far off to one side looking across
  // the screen, or close up): nothing is "found" to straighten, yet it is answered at once — as the screen it is,
  // with closer tiles, plus a CLOSE-UP of the text at the camera's own pixels; the lens stays put (the text is whole
  // in view: every step out would cost it pixels); the readout says so
  const b9 = await chromium.launch();
  const ctx9 = await b9.newContext({ viewport: { width: 420, height: 860 } });
  await ctx9.addInitScript(() => { localStorage.setItem('noWide', '1'); });
  await ctx9.addInitScript(initCamera);
  const p9 = await ctx9.newPage();
  const errors9 = []; p9.on('pageerror', (e) => errors9.push(String(e)));
  const main9 = [];
  await p9.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    main9.push({ at: Date.now(), zoom: await p9.evaluate(() => window.__zoom), body });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse('ANSWER: B) 42\n\nFrom the second line.') });
  });
  await p9.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p9.evaluate(() => { window.__scene = 'filled'; });
  await p9.waitForTimeout(800);
  const start9 = Date.now();
  await p9.click('#startBtn');
  await p9.waitForTimeout(7000);
  assert(main9.length >= 1 && main9[0].at - start9 < 6000, '9. the screen filling the view is answered at once (' + main9.length + ' answers)');
  assert((await p9.evaluate(() => window.__zoomCalls.slice())).length === 0, '9. the lens stays put: the text is whole in view (' + (await p9.evaluate(() => window.__zoomCalls.join())) + ')');
  const c9 = main9.length ? main9[0].body.messages[0].content : [];
  const imgs9 = c9.filter((b) => b.type === 'image').map((b) => jpegSize(b.source.data));
  const closeLabel = c9.findIndex((b) => b.type === 'text' && /close up/.test(b.text));
  assert(imgs9.length >= 4 && closeLabel > 0 && c9[closeLabel + 1] && c9[closeLabel + 1].type === 'image', '9. the whole frame, its closer tiles and the close-up of the text go (' + imgs9.length + ' images, close-up label at ' + closeLabel + ')');
  const cu = closeLabel > 0 && c9[closeLabel + 1] ? jpegSize(c9[closeLabel + 1].source.data) : null;
  assert(cu && cu.w >= 600 && cu.w <= 1568 && cu.w / cu.h > 1.2 && cu.w / cu.h < 2.2, '9. the close-up is the question block alone, not the whole page (' + JSON.stringify(cu) + ')');
  assert(c9.some((b) => b.type === 'text' && /larger than the photo/.test(b.text)), '9. the model is told the screen is larger than the photo');
  const meta9 = await p9.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  assert(/the screen fills the view — read as it is · \d tiles · text close-up/.test(meta9), '9. the meta line says so (' + meta9 + ')');
  const live9 = await p9.evaluate(() => document.getElementById('zoomLive').textContent);
  assert(/text off at the top left — point at it to zoom in/.test(live9), '9. the readout: the question block is off at the top left — where to aim, since the zoom works about the middle (' + live9 + ')');
  assert(errors9.length === 0, '9. no page errors' + (errors9.length ? ': ' + errors9.join(' | ') : ''));
  await b9.close();

  // 10. the SWEEP for print: a lens with a range like an iPhone's (0.5–10, the chosen zoom 1), the screen filling the
  // view with nothing on it — the lens goes out to the widest to find something; then a question block comes into
  // view at the top left, too small at 0.5× to count as a block: after a few looks the lens sweeps IN a step at a
  // time (0.6, 0.72) until the block counts, then the framing closes in on it as far as the corner allows and the
  // capture goes with the close-up of the block at the camera's own pixels, contrast evened
  const b10 = await chromium.launch();
  const ctx10 = await b10.newContext({ viewport: { width: 420, height: 860 } });
  await ctx10.addInitScript(() => { localStorage.setItem('noWide', '1'); localStorage.setItem('wideRange', '1'); });
  await ctx10.addInitScript(initCamera);
  const p10 = await ctx10.newPage();
  const errors10 = []; p10.on('pageerror', (e) => errors10.push(String(e)));
  const main10 = [];
  await p10.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    main10.push({ at: Date.now(), zoom: await p10.evaluate(() => window.__zoom), body, scene: await p10.evaluate(() => window.__scene) });
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(/close up/.test(textOf(body.messages[0].content)) ? 'ANSWER: B) 42\n\nFrom the close-up.' : 'ANSWER: nothing to read\n\nA blank page.') });
  });
  await p10.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p10.evaluate(() => { window.__scene = 'blank'; });
  await p10.waitForTimeout(800);
  await p10.click('#startBtn');
  await p10.waitForTimeout(1800);   // two steps out (0.72, 0.52) within the first second; the sweep for print would start two seconds after that
  let zc10 = await p10.evaluate(() => window.__zoomCalls.slice());
  assert(zc10.length >= 1 && Math.abs(zc10[zc10.length - 1] - 0.5) < 0.03, '10. a blank screen larger than the view: the lens went out to the widest (' + zc10.join() + ')');
  const outCalls = zc10.length;
  await p10.evaluate(() => { window.__scene = 'corner'; });
  await p10.waitForTimeout(12000);   // a few looks with the block too small to count, the sweep's steps 1.5 s apart, the settle, the capture
  zc10 = await p10.evaluate(() => window.__zoomCalls.slice());
  const sweep = zc10.slice(outCalls);
  assert(sweep.length >= 2 && sweep[0] > 0.58 && sweep[0] < 0.64 && sweep.every((z, i) => i === 0 || z > sweep[i - 1]), '10. a block too small at the widest: the lens swept in, a fifth closer, and from there only in (' + sweep.join() + ')');
  assert(sweep.length >= 2 && sweep[sweep.length - 1] > 0.8 && sweep[sweep.length - 1] < 1.0, '10. … the block counted, and the framing closed in on it as far as the corner allows (' + sweep.join() + ')');
  const last10 = main10.filter((m) => m.scene === 'corner').pop();
  assert(last10 && last10.zoom > 0.7, '10. the capture came after the sweep, at the closer zoom (' + (last10 ? last10.zoom : 'none') + ')');
  const c10 = last10 ? last10.body.messages[0].content : [];
  const closeLabel10 = c10.findIndex((b) => b.type === 'text' && /close up/.test(b.text) && /contrast evened/.test(b.text));
  assert(closeLabel10 > 0 && c10[closeLabel10 + 1] && c10[closeLabel10 + 1].type === 'image', '10. the close-up of the block, contrast evened, went with the frame (label at ' + closeLabel10 + ')');
  const cu10 = closeLabel10 > 0 && c10[closeLabel10 + 1] ? jpegSize(c10[closeLabel10 + 1].source.data) : null;
  assert(cu10 && cu10.w < 900 && cu10.h < 600, '10. … the block alone, small (' + JSON.stringify(cu10) + ')');
  assert(/^B/.test(await p10.evaluate(() => (document.querySelector('#answerBody .verdict-key') || {}).textContent || '')), '10. and the answer from it is on screen');
  assert(errors10.length === 0, '10. no page errors' + (errors10.length ? ': ' + errors10.join(' | ') : ''));
  await b10.close(); server.close();
  console.log(process.exitCode ? 'SCREEN E2E FAILED' : 'SCREEN E2E PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
