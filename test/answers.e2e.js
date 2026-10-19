// Needs playwright. Run: node test/answers.e2e.js
// The Answers button (ANSWERS ONLY): off, everything as usual — a desk is described, a role card brings its briefing;
// on, questions get their answer and nothing else — the request carries the answers-only rules and prompt, a desk's
// "nothing to read" keeps the answer on screen, a role card is left alone without a request, and a question with
// options is answered; the setting survives a reload; off again, a role card brings its briefing once more. The real
// page runs with a camera this test controls (a canvas with four scenes) and a fake Claude endpoint.
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
const sysText = (sys) => Array.isArray(sys) ? sys.map((b) => b.text).join('\n') : String(sys || '');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const CARD = 'CARD | Patient | Medical ward in a hospital | Explain that you are very worried about going home as you still';
const BRIEF = 'ANSWER: Worried about going home\nROLE: Patient\n\n**Setting:** Medical ward in a hospital.\n**Your role:** the doctor on the ward round.\n**Background:** A 54-year-old admitted with pneumonia, told they can go home today; still weak.\n**Tasks:**\n- Say you are scared to go home\n- Ask what to look out for\n- Ask who to call\n- Ask about the medicines\n\n*Say "I\'m ready" to begin — I will be the Patient.*';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('lensloop.settings')) localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));   // (kept across the reload below, so the saved setting shows)
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
    // the camera: four scenes told apart by the quick look's mock, drawn distinct enough for the page's own fingerprints
    window.__scene = 'desk';
    const W = 1280, H = 720;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      g.fillStyle = s === 'desk' ? '#6a6a66' : '#ececea'; g.fillRect(0, 0, W, H);
      if (s === 'desk') return;
      g.fillStyle = '#1a1a1a';
      const x0 = s === 'q2' ? 620 : 60, y0 = s === 'card' ? 300 : 70, lines = s === 'card' ? 11 : 6;
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
  let scene = 'desk';
  const main = [], looks = [];
  const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const ut = textOf(body.messages[0].content), st = sysText(body.system);
    if (/haiku/.test(body.model)) {
      looks.push(scene);
      const answer = /SAME or DIFFERENT/.test(ut) ? 'DIFFERENT' : scene === 'desk' ? 'NONE' : scene === 'card' ? CARD : 'CHOICE';
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    const role = /preparing a spoken role-play practice/.test(st);
    const only = /ANSWERS ONLY/.test(st);
    main.push({ scene, role, only, prompt: ut, sys: st, at: Date.now() });
    const text = role ? BRIEF : only ? (scene === 'desk' || scene === 'card' ? 'ANSWER: nothing to read\n\nNo question in the frame.' : scene === 'q2' ? 'ANSWER: C) 7\n\nThe third line gives it.' : 'ANSWER: B) 42\n\nFrom the second line.')
      : scene === 'desk' ? 'ANSWER: An empty desk\n\nA grey surface, nothing to read.' : scene === 'q2' ? 'ANSWER: C) 7\n\nThe third line gives it.' : 'ANSWER: B) 42\n\nFrom the second line.';
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(text) });
  });
  const go = async (s) => { scene = s; await page.evaluate((v) => { window.__scene = v; }, s); };
  const shown = () => page.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  const status = () => page.evaluate(() => (document.getElementById('statusText') || {}).textContent || '');
  const btn = () => page.evaluate(() => { const b = document.getElementById('answersBtn'); return { on: b.dataset.on, text: b.textContent, pressed: b.getAttribute('aria-pressed') }; });

  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  assert((await btn()).on === 'false' && (await btn()).text === 'Answers', '0. the Answers button is there, off (' + JSON.stringify(await btn()) + ')');
  await page.click('#startBtn');
  await page.waitForTimeout(4000);
  assert(main.length === 1 && main[0].scene === 'desk' && !main[0].only && /An empty desk/.test(await shown()), '1. off: the desk is described as usual (' + main.map((m) => m.scene + (m.only ? '/only' : '')).join() + ')');
  assert(!/ANSWERS ONLY/.test(main[0].sys) && /Look at this photo carefully/.test(main[0].prompt), '1. off: the usual rules and prompt');

  // 2. the button on: the desk is "nothing to read" — the description stays on screen; the request carries the rules
  await page.click('#answersBtn');
  await page.waitForTimeout(300);
  assert((await btn()).on === 'true' && (await btn()).text === 'Answers only' && (await btn()).pressed === 'true', '2. the button on, lit, "Answers only" (' + JSON.stringify(await btn()) + ')');
  assert(/Answers only: questions get their answer/.test(await status()), '2. the status says so (' + await status() + ')');
  await page.waitForTimeout(12000);   // the desk, looked at afresh (the switch let the known pictures go): one request, in the mode
  const onDesk = main.filter((m) => m.only && m.scene === 'desk');
  assert(onDesk.length >= 1, '2. on: the desk brought one request in the mode (' + main.map((m) => m.scene + (m.only ? '/only' : '')).join() + ')');
  assert(onDesk.length && /ANSWERS ONLY — in this session you answer QUESTIONS and nothing else/.test(onDesk[0].sys) && /Answer the question in this photo/.test(onDesk[0].prompt) && !/Look at this photo carefully/.test(onDesk[0].prompt), '2. on: the answers-only rules and prompt went, the usual prompt did not');
  assert(/An empty desk/.test(await shown()), '2. on: "nothing to read" for the desk kept the text on screen');

  // 3. a question with options: answered, the verdict big
  await go('q1');
  await page.waitForTimeout(5000);
  assert(main.filter((m) => m.only && m.scene === 'q1').length === 1 && (await page.evaluate(() => (document.querySelector('#answerBody .verdict-key') || {}).textContent || '')) === 'B', '3. on: a question is answered, the verdict B in the panel');

  // 4. a role card: left alone — no request at all, the answer stays, the status says why
  await page.waitForTimeout(8000);   // past the answer's hold
  await go('card');
  await page.waitForTimeout(8000);
  assert(!main.some((m) => m.scene === 'card'), '4. on: a role card in view brought no request (' + main.map((m) => m.scene + (m.only ? '/only' : '') + (m.role ? '/role' : '')).join() + ')');
  assert(looks.includes('card'), '4. … the quick look saw it (' + looks.join() + ')');
  assert((await page.evaluate(() => (document.querySelector('#answerBody .verdict-key') || {}).textContent || '')) === 'B', '4. the answer B is still on screen');

  // 5. the setting survives a reload
  await page.reload(); await page.waitForTimeout(1200);
  assert((await btn()).on === 'true', '5. after a reload the button is still on');

  // 6. off again: the role card brings its briefing as usual
  await page.click('#answersBtn');
  await page.waitForTimeout(300);
  assert((await btn()).on === 'false', '6. the button off again');
  await page.click('#startBtn');
  await page.waitForTimeout(9000);
  assert(main.some((m) => m.role) && /Say "I'm ready"/.test(await shown()), '6. off: the role card brought its briefing (' + main.map((m) => m.scene + (m.role ? '/role' : '')).join() + ')');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'ANSWERS FAILED' : 'ANSWERS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
