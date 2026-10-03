// End-to-end smoke test: the real page in headless Chromium with a fake camera, a fake dictation engine and a
// fake Claude endpoint; checks the request bodies the page builds and the retry after failures.
// Needs playwright (npm i -D playwright). Run: node test/session.e2e.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
// a slowly brightening flat picture: every frame differs from the last one sent, nothing in it looks like a cached one
const Y4M = path.join(os.tmpdir(), 'lensloop-drift.y4m');
if (!fs.existsSync(Y4M)) {
  const W = 320, H = 240, FPS = 2, parts = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F' + FPS + ':1 Ip A1:1 C420jpeg\n')];
  for (let i = 0; i < FPS * 85; i++) { parts.push(Buffer.from('FRAME\n'), Buffer.alloc(W * H, Math.floor(3 * i / FPS) % 256), Buffer.alloc(W * H / 4, 128), Buffer.alloc(W * H / 4, 128)); }
  fs.writeFileSync(Y4M, Buffer.concat(parts));
}
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const sse = (text) => {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 900 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) +
    ev('message_stop', { type: 'message_stop' });
};
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] });
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  await ctx.addInitScript(() => {
    // settings: short interval, keep the key, no audio file saving (MediaRecorder on a fake device is beside the point)
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 4 }));
    // a dictation engine that "hears" a long sentence every 100 ms for the first five seconds, then goes quiet
    let n = 0, t0 = 0;
    class FakeSR {
      constructor() { this.continuous = false; this.interimResults = true; this._t = null; }
      start() {
        const self = this;
        if (!t0) t0 = Date.now();
        this._t = setInterval(() => {
          if (Date.now() - t0 > 5000) return;
          n++;
          const text = `Sentence ${n} of the session: the toll keeper takes a memory at the river crossing and the ferry waits for nobody, the gulls hold the far bank and the lamps go out one by one.`;
          const results = []; results.push([{ transcript: text }]); results[0].isFinal = true;
          self.onresult && self.onresult({ resultIndex: 0, results });
        }, 100);
      }
      stop() { clearInterval(this._t); this.onend && this.onend(); }
      abort() { this.stop(); }
    }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  });
  const bodies = [], at = [];
  let fail = 0, started = 0;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    bodies.push(body); at.push(Date.now() - started);
    if (fail > 0) { fail--; await route.fulfill({ status: 529, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Overloaded' } }) }); return; }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('ANSWER: The toll keeper takes a memory\nSTORYLINE: Current session\n\nThat is what the session says so far, in request ' + bodies.length + '.') });
  });
  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  started = Date.now();
  await page.click('#startBtn');
  // let the loop run: frames every 5 s (the fake camera's pattern moves, so frames are "new"), dictation streaming
  await page.waitForTimeout(30000);
  const nReq = bodies.length;
  console.log('requests so far:', nReq);
  // now make the API fail twice (transient) and watch the retry
  fail = 2;
  await page.waitForTimeout(16000);
  const status = await page.textContent('#statusText');
  console.log('status after failures:', status);
  const transcriptWords = await page.evaluate(() => (document.querySelector('#liveStrip') || {}).textContent);
  console.log('live strip:', (transcriptWords || '').slice(0, 160));
  if (await page.isVisible('#readerClose')) { try { await page.click('#readerClose', { timeout: 3000 }); } catch (e) {} }
  await page.click('#startBtn');   // stop
  await page.waitForTimeout(2500);
  await browser.close(); server.close();

  // ---- checks ----
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  if (logs.length) console.log('console:', logs.slice(0, 8).join('\n  '));
  assert(nReq >= 3, 'the camera loop sent several frames (' + nReq + ')');
  const last = bodies[nReq - 1];
  const sys = last.system;
  assert(Array.isArray(sys) && sys.length >= 3, 'system is an array of blocks (' + sys.length + ')');
  const intro = sys.findIndex((b) => /^CURRENT SESSION — still being recorded/.test(b.text));
  assert(intro > 0, 'live intro block present at ' + intro);
  const tail = sys[sys.length - 1].text;
  assert(/\[\d+:\d\d into the session at this request, \d+ words so far\]/.test(tail), 'tail carries the time/word line');
  assert(!sys[sys.length - 1].cache_control, 'tail is not cache-marked');
  const marked = sys.map((b, i) => b.cache_control ? i : -1).filter((i) => i >= 0);
  assert(marked.length === 1 && marked[0] === sys.length - 2, 'exactly one live cache mark, on the last frozen block (marks at ' + marked.join(',') + ')');
  const frozenTexts = sys.slice(intro + 1, sys.length - 1).map((b) => b.text);
  assert(frozenTexts.length >= 1 && frozenTexts.filter((t) => /^Sentence \d+ of the session/.test(t)).every((t) => t.length >= 4000), 'frozen transcript chunks are >= 4000 chars (' + frozenTexts.map((t) => t.length).join(',') + ')');
  const visuals = sys.filter((b) => /VISUAL NOTES/.test(b.text)).length;
  assert(visuals >= 1 || /VISUAL NOTES/.test(tail), 'visual notes from earlier answers are in the prompt');
  // stability of frozen chunks across requests
  const prev = bodies[nReq - 2].system;
  const prevFrozen = prev.slice(prev.findIndex((b) => /^CURRENT SESSION/.test(b.text)) + 1, prev.length - 1).map((b) => b.text).filter((t) => /^Sentence/.test(t));
  const nowFrozen = frozenTexts.filter((t) => /^Sentence/.test(t));
  assert(prevFrozen.every((t, i) => nowFrozen[i] === t), 'frozen chunks of the previous request are a byte-identical prefix of this one');
  // retry: after two 529s there must have been more requests than the failures
  assert(bodies.length > nReq + 2, 'frames were sent again after the failures (' + (bodies.length - nReq) + ' more requests)');
  // while the dictation ran (first 5 s) and for quietSec after, no camera text was generated
  const during = at.filter((t) => t > 800 && t < 8500).length;
  assert(during === 0, 'no camera request while speaking or in the quiet spell after (' + during + ' in that window; requests at ' + at.map((t) => Math.round(t / 100) / 10).join(', ') + ' s)');
  assert(at.filter((t) => t >= 8500).length >= 2, 'camera requests resumed after the quiet spell');
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
