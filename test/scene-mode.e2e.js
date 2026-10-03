// Needs playwright. Run: node test/scene-mode.e2e.js
// Scene mode must send the model ONE card and ask it to speak that card's role — not the describe-a-document
// scaffolding the normal loop uses. This runs the real page with a fake (drifting) camera and a fake Claude endpoint,
// turns Scene mode on, and checks every request body the page builds:
//   - the system prompt is the scene rules (with the voice notes), not the normal rules and not the session transcript;
//   - the user turn carries exactly ONE image (each card alone — never earlier frames merged in);
//   - it carries the scene prompt and none of the "EARLIER FRAMES" / "FRAMES: continues" document instructions.
// It failed on the build that wrapped scene mode in the document scaffolding (the app described the card); it passes now.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const Y4M = path.join(os.tmpdir(), 'lensloop-drift.y4m');   // a slowly brightening picture: each frame differs from the last
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
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 1000, cache_read_input_tokens: 500 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) +
    ev('message_stop', { type: 'message_stop' });
};
const textOf = (content) => content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const sysText = (sys) => (Array.isArray(sys) ? sys.map((b) => b.text).join('\n') : String(sys || ''));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] });
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sceneMode: true, sceneCharacter: 'Calm Australian GP, plain language.', sttEngine: 'phone' }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }   // no speech, so nothing holds the frames back
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
  });
  const bodies = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'DIFFERENT' }], usage: {} }) });
    bodies.push(body);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('ANSWER: Heart attack recovery advice\n\nRight, so, how have you been feeling since you got home? Good. Now, the main thing I want to talk through is your warfarin...') });
  });
  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  await page.click('#startBtn');
  await page.waitForTimeout(26000);   // a few camera frames at the 5 s interval

  assert(bodies.length >= 2, 'the camera loop sent several requests (' + bodies.length + ')');
  let allOneImage = true, anyEarlier = false, anyFramesLine = false, allScenePrompt = true, allSceneSys = true, anyNormalSys = false, anySessionSys = false, sawVoiceNotes = false;
  for (const b of bodies) {
    const content = b.messages[0].content;
    const images = content.filter((c) => c.type === 'image');
    const ut = textOf(content), st = sysText(b.system);
    if (images.length !== 1) allOneImage = false;
    if (/EARLIER FRAMES/.test(ut)) anyEarlier = true;
    if (/FRAMES:\s*continues/i.test(ut)) anyFramesLine = true;
    if (!/BECOME that person/.test(ut)) allScenePrompt = false;
    if (!/dialogue generator/i.test(st)) allSceneSys = false;
    if (/the very first line is exactly/i.test(st)) anyNormalSys = true;           // the normal SYSTEM_RULES hallmark
    if (/recording a spoken brainstorming session/i.test(st)) anySessionSys = true; // the live-session instruction
    if (/CHARACTER \/ VOICE NOTES:[\s\S]*Australian GP/i.test(st)) sawVoiceNotes = true;
  }
  assert(allOneImage, 'every request carries exactly one card image — earlier frames are never merged in');
  assert(!anyEarlier, 'no "EARLIER FRAMES" document block in scene mode');
  assert(!anyFramesLine, 'no "FRAMES: continues/new" instruction in scene mode');
  assert(allScenePrompt, 'every request carries the scene prompt (BECOME that person)');
  assert(allSceneSys, 'the system prompt is the scene rules');
  assert(!anyNormalSys, 'the normal describe/solve rules are NOT sent in scene mode');
  assert(!anySessionSys, 'the brainstorming-session transcript instructions are NOT sent in scene mode');
  assert(sawVoiceNotes, 'the voice notes ride in the system prompt under CHARACTER / VOICE NOTES');

  // the reply is shown as a scene answer (headline + dialogue), proving the pipeline round-trips
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  assert(/Heart attack recovery advice/.test(shown) && /how have you been feeling/.test(shown), 'the generated dialogue is shown on screen');

  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'SCENE MODE FAILED' : 'SCENE MODE PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
