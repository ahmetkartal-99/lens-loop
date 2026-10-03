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
  await browser.close();

  // ---- Part 2: memory is mode-aware. A card held still is described in the normal mode (that answer goes into
  // memory with the picture's fingerprint); switched to Scene mode, the SAME card must get fresh scene lines — not the
  // remembered description replayed, and not "kept" because the camera did not move. Switched back, the normal
  // memory still answers it with no request.
  const STILL = path.join(os.tmpdir(), 'lensloop-still.y4m');
  if (!fs.existsSync(STILL)) {
    const W = 320, H = 240, FPS = 2, parts = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F' + FPS + ':1 Ip A1:1 C420jpeg\n')];
    const Yp = Buffer.alloc(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Yp[y * W + x] = ((x >> 5) + (y >> 5)) % 2 ? 200 : 60;   // a fixed checker pattern
    for (let i = 0; i < FPS * 85; i++) parts.push(Buffer.from('FRAME\n'), Yp, Buffer.alloc(W * H / 4, 128), Buffer.alloc(W * H / 4, 128));
    fs.writeFileSync(STILL, Buffer.concat(parts));
  }
  const b2 = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + STILL] });
  const ctx2 = await b2.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 420, height: 860 } });
  const p2 = await ctx2.newPage();
  const errors2 = []; p2.on('pageerror', (e) => errors2.push(String(e)));
  await ctx2.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sceneMode: false, sttEngine: 'phone' }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
  });
  const reqs = [];
  const DESCRIPTION = 'ANSWER: Roleplayer card, medical ward\n\nThe card says: you are 54 years old and you were admitted to hospital two days ago with pneumonia.';
  const SCENE_LINES = 'ANSWER: Worried about going home\n\nHonestly, doctor, I still don\'t feel back to normal, and I\'m a bit scared about going home today.';
  await p2.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'SAME' }], usage: {} }) });
    const scene = /dialogue generator/i.test(sysText(body.system));
    reqs.push(scene ? 'scene' : 'normal');
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(scene ? SCENE_LINES : DESCRIPTION) });
  });
  const shown2 = () => p2.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  const setScene = async (on) => {
    await p2.click('#settingsBtn'); await p2.waitForTimeout(300);
    await p2.evaluate((v) => { const c = document.getElementById('sceneMode'); c.checked = v; }, on);
    await p2.click('#saveBtn'); await p2.waitForTimeout(300);
  };
  await p2.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p2.waitForTimeout(800);
  await p2.click('#startBtn');
  await p2.waitForTimeout(9000);
  assert(reqs.length === 1 && reqs[0] === 'normal', 'normal mode: the still card was described once (' + reqs.join(',') + ')');
  assert(/pneumonia/.test(await shown2()), 'normal mode: the description is on screen');
  await p2.waitForTimeout(6000);
  assert(reqs.length === 1, 'the card held still is not asked about again (' + reqs.length + ' request(s))');

  await setScene(true);
  await p2.waitForTimeout(9000);
  assert(reqs.length === 2 && reqs[1] === 'scene', 'switched to Scene mode, the same card got a fresh scene request — not the remembered description (' + reqs.join(',') + ')');
  const sceneShown = await shown2();
  assert(/scared about going home/.test(sceneShown) && !/The card says/.test(sceneShown), 'the scene lines are on screen, not the description');

  await setScene(false);
  await p2.waitForTimeout(9000);
  assert(reqs.length === 2, 'switched back, the normal memory answers the same card with no new request (' + reqs.join(',') + ')');
  assert(/pneumonia/.test(await shown2()), 'and the description is back on screen');
  assert(errors2.length === 0, 'part 2: no page errors' + (errors2.length ? ': ' + errors2.join(' | ') : ''));
  await b2.close(); server.close();
  console.log(process.exitCode ? 'SCENE MODE FAILED' : 'SCENE MODE PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
