// Needs playwright. Run: node test/latency.e2e.js
// Measures the two things the page controls on the way from voice to highlight: how often audio leaves the
// phone (100 ms chunks → about ten per second) and how long the highlight takes to move once a partial has
// arrived (should be a few milliseconds). The engine's own round trip is outside the page and not measured.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const Y4M = path.join(os.tmpdir(), 'lensloop-static.y4m');
if (!fs.existsSync(Y4M)) {
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
  await ctx.addInitScript(() => { localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test', sttKey: 'xi-test', quietSec: 2 })); });
  await page.route('https://api.elevenlabs.io/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"t"}' }));
  let sock = null; const chunkTimes = [];
  await page.routeWebSocket(/api\.elevenlabs\.io/, (ws) => { sock = ws; ws.onMessage((m) => { try { if (JSON.parse(m).message_type === 'input_audio_chunk') chunkTimes.push(Date.now()); } catch (e) {} }); ws.onClose(() => { if (sock === ws) sock = null; }); });
  const keep = setInterval(() => { try { sock && sock.send(JSON.stringify({ message_type: 'keepalive' })); } catch (e) {} }, 2500);
  await page.route('https://api.anthropic.com/v1/messages', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(ANSWER) }));
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
  await page.goto(url); await page.waitForTimeout(700);
  await page.click('#startBtn');
  await page.waitForTimeout(3000);
  // 1. audio cadence: chunks per second over three seconds
  chunkTimes.length = 0; await page.waitForTimeout(3000);
  const perSec = chunkTimes.length / 3;
  assert(perSec >= 8 && perSec <= 12, 'audio leaves the page in 100 ms chunks (' + perSec.toFixed(1) + ' per second)');
  // 2. in-page reaction: a MutationObserver stamps the moment the highlight changes after a partial arrives
  await page.evaluate(() => {
    window.__stamps = [];
    new MutationObserver(() => { window.__stamps.push(performance.now()); }).observe(document.getElementById('readerBody'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  const partial = (text) => { sock.send(JSON.stringify({ message_type: 'partial_transcript', text })); };
  // partials that each jump three words, so every one of them demands a correction the prediction cannot have made
  const words = 'chosen by the keeper and never by the traveller, which is why the ferry road is lined with people who cannot say why they came.'.split(' ');
  const reactions = [];
  for (let i = 3; i <= words.length; i += 3) {
    const sentAt = await page.evaluate(() => { window.__stamps = []; return performance.now(); });
    partial(words.slice(0, i).join(' '));
    await page.waitForTimeout(250);
    const first = await page.evaluate(() => window.__stamps[0] || null);
    if (first !== null) reactions.push(first - sentAt);
  }
  const sent = Math.floor(words.length / 3);
  console.log('highlight moved on', reactions.length, 'of', sent, 'partials; reaction times (ms):', reactions.map((r) => r.toFixed(0)).join(', '));
  assert(reactions.length >= sent - 1, 'the highlight reacted to every partial that needed a correction');
  assert(reactions.length && Math.max(...reactions) < 40, 'each reaction within a few milliseconds of the partial arriving (max ' + (reactions.length ? Math.max(...reactions).toFixed(0) : '-') + ' ms)');
  assert(/following your voice · ElevenLabs/.test(await page.textContent('#readerState')), 'panel names ElevenLabs as the engine listening');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  clearInterval(keep);
  await browser.close(); server.close();
  console.log(process.exitCode ? 'LATENCY FAILED' : 'LATENCY PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
