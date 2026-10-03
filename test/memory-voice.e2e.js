// Needs playwright. Run: node test/memory-voice.e2e.js
// Two things in the word-by-word panel: the highlight follows the voice (words spoken from the middle of the
// text move it there and pause the timer), and a picture seen before gets its text back from memory — here
// after a reload, from the storyline saved on the phone — with the source bracket, and no Claude request.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const Y4M = path.join(os.tmpdir(), 'lensloop-static.y4m');
if (!fs.existsSync(Y4M)) {   // one unchanging grey picture
  const W = 320, H = 240, parts = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F2:1 Ip A1:1 C420jpeg\n')];
  for (let i = 0; i < 20; i++) parts.push(Buffer.from('FRAME\n'), Buffer.alloc(W * H, 120), Buffer.alloc(W * H / 4, 128), Buffer.alloc(W * H / 4, 128));
  fs.writeFileSync(Y4M, Buffer.concat(parts));
}
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' });
  fs.createReadStream(p).pipe(res);
});
const ANSWER = 'ANSWER: The toll keeper takes a memory\nSTORYLINE: Current session\n\nEvery crossing costs one remembered day, chosen by the keeper and never by the traveller, which is why the ferry road is lined with people who cannot say why they came.';
const sse = (text) => { const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 1000 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }) + ev('message_stop', { type: 'message_stop' }); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, url = `http://127.0.0.1:${port}/index.html#key=sk-ant-test`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test', quietSec: 3 }));
    // a dictation engine that only speaks when the test tells it to (window.__say)
    class FakeSR {
      constructor() { this.continuous = false; this.interimResults = true; }
      start() { window.__say = (text, final) => { const results = [[{ transcript: text }]]; results[0].isFinal = !!final; this.onresult && this.onresult({ resultIndex: 0, results }); }; }
      stop() { this.onend && this.onend(); } abort() { this.stop(); }
    }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  });
  let requests = 0;
  const apiBody = (route) => { requests++; const b = JSON.parse(route.request().postData()); const isDigest = /Transcript of one recorded session/.test(JSON.stringify(b.messages)); return route.fulfill({ status: 200, contentType: isDigest ? 'application/json' : 'text/event-stream', body: isDigest ? JSON.stringify({ content: [{ type: 'text', text: 'TITLE: The toll keeper\nSUMMARY: A ferry.\nKEYS: keeper' }], usage: {} }) : sse(ANSWER) }); };
  await page.route('https://api.anthropic.com/v1/messages', apiBody);
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

  await page.goto(url);
  await page.waitForTimeout(700);
  await page.click('#startBtn');
  await page.waitForTimeout(2500);
  assert(requests === 1, 'the first frame went to Claude (' + requests + ' request)');
  assert((await page.textContent('#readerSrc')) === '[Claude API]', 'panel says [Claude API]');
  assert(/auto-scrolling/.test(await page.textContent('#readerState')), 'timer runs by default');
  // speak words from the middle of the text: the highlight jumps there and the timer pauses
  await page.evaluate(() => window.__say('chosen by the keeper and'));
  await page.waitForTimeout(300);
  assert((await page.textContent('.w.cur')) === 'never', 'highlight followed the voice to the next word ("' + (await page.textContent('.w.cur')) + '")');
  assert(/following your voice/.test(await page.textContent('#readerState')), 'panel says it follows the voice');
  await page.waitForTimeout(5800);
  assert(/auto-scrolling/.test(await page.textContent('#readerState')), 'timer resumed a few seconds after the voice stopped');
  assert(requests === 1, 'nothing new was generated while speaking / in the quiet spell (' + requests + ')');
  // a few recorded sentences, so the session is worth saving; then end it: the storyline (with its memory) is saved on the phone
  await page.evaluate(() => { window.__say('We talked about the ferry and the toll today.', true); window.__say('The keeper stays on the far bank.', true); });
  await page.waitForTimeout(300);
  await page.click('#readerClose'); await page.click('#startBtn');
  await page.waitForTimeout(2500);
  const reqBefore = requests;
  // a fresh page: the same picture is answered from memory, with no request
  await page.reload(); await page.waitForTimeout(900);
  await page.click('#startBtn');
  await page.waitForTimeout(3000);
  assert(requests === reqBefore, 'no Claude request for a picture seen before (' + (requests - reqBefore) + ' new)');
  assert(/from memory · this phone/.test(await page.textContent('#readerSrc')), 'panel says [from memory · this phone] ("' + (await page.textContent('#readerSrc')) + '")');
  assert(/Every crossing costs one remembered day/.test(await page.textContent('#readerBody')), 'the stored text is the one shown');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'MEMORY/VOICE FAILED' : 'MEMORY/VOICE PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
