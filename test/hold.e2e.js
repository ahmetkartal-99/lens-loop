// Needs playwright. Run: node test/hold.e2e.js
// An answer on screen is KEPT: a verdict (a multiple-choice letter) stays at least ANSWER_HOLD_MS (10 s) however the
// picture moves meanwhile — no capture, no quick look, no request — and a reply that is no answer (the model saying
// "nothing to read", or titling a blurred frame "Out-of-focus, washed-out pale blur") never replaces it: the panel
// keeps the verdict, its meta line comes back, the status says the answer is kept, and the request that brought it
// carried the verdict on screen for consistency. A different question, once the hold is over, is answered at once.
// The real page runs with a camera this test controls (a canvas showing a bright page of "text", the question
// block moved about to stand for the hand or the zoom moving) and a fake Claude endpoint.
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
    // the camera: a bright page filling the frame, a block of "text" lines (a question with its options) somewhere on
    // it — q1 at the top left, q1b the same block moved to the right (the hand, the zoom), q2 a different, longer
    // block lower down on a greyer page, q2b that one moved
    window.__scene = 'q1';
    const W = 1280, H = 720;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      const q2 = /^q2/.test(s), moved = /b$/.test(s);
      g.fillStyle = q2 ? '#d8d8d2' : '#ececea'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1a1a1a';
      const x0 = moved ? 620 : 60, y0 = q2 ? 300 : 70, lines = q2 ? 11 : 6;
      for (let i = 0; i < lines; i++) { const y = y0 + i * 30, len = 300 + ((i * 7) % 5) * 50; for (let x = x0; x < x0 + len; x += 34) g.fillRect(x, y, 22, 10); }
    };
    draw(); setInterval(draw, 100);
    const vstream = cv.captureStream(10);
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'main', label: 'Back Camera' }];
    md.getUserMedia = async (c) => {
      const tracks = [];
      if (!c || c.video) for (const t0 of vstream.getVideoTracks()) { const t = t0.clone(); t.getCapabilities = () => ({ deviceId: 'main' }); t.getSettings = () => ({ deviceId: 'main', width: W, height: H }); tracks.push(t); }
      if (c && c.audio) { const ac = new AudioContext(); tracks.push(...ac.createMediaStreamDestination().stream.getAudioTracks()); }
      return new MediaStream(tracks);
    };
  });
  let scene = 'q1';
  const main = [], looks = [];
  const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const ut = textOf(body.messages[0].content);
    if (/haiku/.test(body.model)) {
      looks.push(scene);
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: /SAME or DIFFERENT/.test(ut) ? 'DIFFERENT' : 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    main.push({ scene, at: Date.now(), text: ut });
    const n = main.length;
    const text = n === 1 ? 'ANSWER: B) 42\n\nFrom the second line.'
      : n === 2 ? 'ANSWER: Out-of-focus, washed-out pale blur — no legible text\n\nThe frame is blurred.'   // the model titling a blurred frame instead of saying nothing to read
      : n === 3 ? 'ANSWER: C) 7\n\nBecause of the third line.'
      : 'ANSWER: nothing to read\n\nAn empty desk.';
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(text) });
  });
  const go = async (s) => { scene = s; await page.evaluate((v) => { window.__scene = v; }, s); };
  const status = () => page.evaluate(() => (document.getElementById('statusText') || {}).textContent || '');
  const meta = () => page.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  const key = () => page.evaluate(() => (document.querySelector('#answerBody .verdict-key') || {}).textContent || '');
  const panel = () => page.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');

  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  const t0 = Date.now();
  await page.click('#startBtn');
  await page.waitForTimeout(3000);
  assert(main.length === 1 && main[0].scene === 'q1' && (await key()) === 'B', '1. the question: answered, the verdict B in the panel (' + main.length + ' requests, key ' + await key() + ')');
  const metaB = await meta();
  assert(/F-0001/.test(metaB) && /tok/.test(metaB), '1. the meta line of the answer (' + metaB + ')');

  // 2. the picture moves while the answer is fresh: nothing happens for the length of the hold
  await go('q1b');
  const looks1 = looks.length;
  await page.waitForTimeout(6000);   // 9 s after the answer
  assert(main.length === 1 && looks.length === looks1, '2. the block moved 3 s after the answer: no request and no quick look within the hold (' + main.length + ' requests, ' + (looks.length - looks1) + ' looks)');
  assert((await key()) === 'B', '2. the verdict is still on screen');
  assert(/Answered F-0001 · next in \d+s/.test(await status()), '2. the status: answered, the next look counting down (' + await status() + ')');

  // 3. the hold over: the moved picture is looked at — a quick look (alike by the numbers), then the request; the
  // reply only describes a blurred frame, so the verdict stays, its meta line comes back, the status says so
  await page.waitForTimeout(6000);   // 15 s after the answer
  assert(main.length === 2 && main[1].scene === 'q1b', '3. once the hold was over, the moved picture was sent (' + main.map((m) => m.scene).join() + ')');
  assert(main[1].at - main[0].at >= 10000, '3. … not before ten seconds had passed (' + Math.round((main[1].at - main[0].at) / 100) / 10 + ' s after the first)');
  assert(/For consistency: the answer on the user's screen at this moment, from a frame taken a little earlier, is "B\) 42"/.test(main[1].text) && /If this frame shows the SAME question, give that same answer/.test(main[1].text), '3. the request carried the verdict on screen, for consistency');
  assert((await key()) === 'B' && !/washed-out/.test(await panel()), '3. a reply that only describes the blur: the verdict B stays in the panel (' + (await panel()).slice(0, 60) + ')');
  assert((await meta()) === metaB, '3. the meta line of the answer is back (' + await meta() + ')');
  assert(/F-0002: nothing to read · keeping the answer/.test(await status()), '3. the status says the answer is kept (' + await status() + ')');
  await page.waitForTimeout(4000);
  assert(main.length === 2, '3. the blurred picture, still in view, is not sent again (' + main.length + ' requests)');

  // 4. a different question: answered at once (the blur started no hold), its verdict C up; moved within the hold:
  // nothing; after the hold: looked at, and the model's "nothing to read" keeps C
  await go('q2');
  await page.waitForTimeout(3000);
  assert(main.length === 3 && main[2].scene === 'q2' && (await key()) === 'C', '4. a different question: answered at once, the verdict C in the panel (' + main.map((m) => m.scene).join() + ', key ' + await key() + ')');
  await go('q2b');
  await page.waitForTimeout(6000);
  assert(main.length === 3 && (await key()) === 'C', '4. moved within the hold: no request, C stays (' + main.length + ' requests)');
  await page.waitForTimeout(7000);
  assert(main.length === 4 && main[3].scene === 'q2b' && main[3].at - main[2].at >= 10000, '4. after the hold the moved picture was sent (' + main.map((m) => m.scene).join() + ', ' + (main[3] ? Math.round((main[3].at - main[2].at) / 100) / 10 : '?') + ' s after C)');
  assert((await key()) === 'C' && !/nothing to read|empty desk/i.test(await panel()), '4. "nothing to read": the verdict C stays in the panel');
  assert(/F-0004: nothing to read · keeping the answer/.test(await status()), '4. the status says so (' + await status() + ')');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('timeline (s after start):', main.map((m) => m.scene + '@' + Math.round((m.at - t0) / 100) / 10).join(', '), '· looks:', looks.join(','));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'HOLD FAILED' : 'HOLD PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
