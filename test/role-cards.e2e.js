// Needs playwright. Run: node test/role-cards.e2e.js
// Role-play cards, as the author specified: a card with a SETTING, a role (DOCTOR, PATIENT, CARER…) and a TASK list
// is answered IN that role — the lines that carry out the tasks, for him to read aloud — with nothing to switch on;
// and those lines stay on screen exactly as they are until a DIFFERENT role card appears, whatever else the camera
// sees meanwhile (the desk, the same card again). The real page runs with a camera this test controls (a canvas
// stream: desk / card 1 / card 2) and a fake Claude endpoint for both the quick look (Haiku) and the full answers.
// Timeline: desk → card 1 (caught out of focus first, then legible on a second look) → desk → card 1 again → card 2 → desk.
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
const sysText = (sys) => (Array.isArray(sys) ? sys.map((b) => b.text).join('\n') : String(sys || ''));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

const CARDS = {
  card1: { role: 'Patient', line: 'CARD | Patient | Medical ward in a hospital | Explain that you are very worried about going home as you still' },
  card2: { role: 'Doctor', line: 'CARD | Doctor | Medical ward in a hospital | Advise the patient about going home and arrange a follow-up chest' },
};
const LINES = {
  Patient: 'ANSWER: Worried about going home\n\nDoctor, I still don\'t feel back to normal, and honestly I\'m scared to go home today.',
  Doctor: 'ANSWER: Discharge advice after pneumonia\n\nGood morning. I\'ve come to talk to you about going home today and what to look out for.',
};
const DESCRIBE = { desk: 'ANSWER: An empty desk\n\nA grey surface, nothing to read.', card1: 'ANSWER: A blurred page\n\nA page of text, too blurred to read.' };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    // default settings: Role-play cards is NOT set here — it must be on by default
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }   // no speech: nothing holds the frames back
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
    // the camera: a canvas whose picture this test switches (desk / card1 / card2), each a fixed, distinct pattern
    window.__scene = 'desk';
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      g.fillStyle = '#787878'; g.fillRect(0, 0, 640, 480);
      if (s === 'card1') { for (let y = 0; y < 480; y += 32) for (let x = 0; x < 640; x += 32) { g.fillStyle = ((x + y) / 32) % 2 ? '#c8c8c8' : '#3c3c3c'; g.fillRect(x, y, 32, 32); } }
      if (s === 'card2') { for (let y = 0; y < 480; y += 40) { g.fillStyle = (y / 40) % 2 ? '#e0e0e0' : '#202020'; g.fillRect(0, y, 640, 40); } }
    };
    draw(); setInterval(draw, 100);
    const vstream = cv.captureStream(10);
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = async (c) => {
      const tracks = [];
      if (!c || c.video) tracks.push(...vstream.getVideoTracks().map((t) => t.clone()));
      if (c && c.audio) { const ac = new AudioContext(); tracks.push(...ac.createMediaStreamDestination().stream.getAudioTracks()); }
      return new MediaStream(tracks);
    };
  });

  let scene = 'desk', card1Looks = 0, lockedRole = '';
  const main = [], roleBodies = [], looks = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const ut = textOf(body.messages[0].content);
    if (/haiku/.test(body.model)) {
      let answer;
      if (/SAME or DIFFERENT/.test(ut)) answer = 'DIFFERENT';                                   // the page check (not expected with these distinct pictures)
      else if (/Answer about the SECOND photo/.test(ut)) {                                       // the pairwise look, lines locked
        answer = scene === 'desk' ? 'NONE' : CARDS[scene].role === lockedRole ? 'SAME' : CARDS[scene].line.replace(/^CARD/, 'NEW');
        looks.push({ scene, kind: 'pair', answer });
      } else {                                                                                   // the single look, nothing locked
        if (scene === 'card1') card1Looks++;
        answer = scene === 'desk' ? 'NONE' : (scene === 'card1' && card1Looks === 1) ? 'NONE' : CARDS[scene].line;   // card 1 first caught out of focus
        looks.push({ scene, kind: 'single', answer });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    const role = /dialogue generator/i.test(sysText(body.system)) ? ((/You are the (\w+)\./.exec(ut) || [])[1] || '?') : '';
    if (role) { lockedRole = role; roleBodies.push(body); main.push('role:' + role); return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(LINES[role] || 'ANSWER: ?\n\n?') }); }
    main.push('normal:' + scene);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(DESCRIBE[scene] || 'ANSWER: Something\n\nSomething.') });
  });
  const shown = () => page.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  const go = async (s) => { scene = s; await page.evaluate((v) => { window.__scene = v; }, s); };

  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  await page.click('#startBtn');

  // 1. the desk: no card → the usual answer
  await page.waitForTimeout(7000);
  assert(main.join() === 'normal:desk', '1. desk: the usual answer (' + main.join() + ')');

  // 2. card 1 — out of focus at first (described), legible on the second look → the PATIENT's lines, locked
  await go('card1');
  await page.waitForTimeout(16000);
  assert(main.join() === 'normal:desk,normal:card1,role:Patient', '2. card 1: caught blurred, then a second look found the card and asked for the Patient\'s lines (' + main.join() + ')');
  let s = await shown();
  assert(/scared to go home/.test(s), '2. the Patient\'s lines are on screen');

  // 3. the desk again: the lines stay exactly as they are, no new answer, and the still desk is not looked at over and over
  const looksBefore = looks.length;
  await go('desk');
  await page.waitForTimeout(16000);
  s = await shown();
  assert(main.length === 3, '3. desk with lines locked: no new answer (' + main.join() + ')');
  assert(/scared to go home/.test(s) && !/empty desk/.test(s), '3. the Patient\'s lines are still on screen, untouched');
  const deskLooks = looks.slice(looksBefore).filter((l) => l.scene === 'desk').length;
  assert(deskLooks >= 1 && deskLooks <= 2, '3. the desk was looked at once (maybe twice), not on every tick (' + deskLooks + ' looks in 16 s)');

  // 4. the same card again: same lines, nothing new
  await go('card1');
  await page.waitForTimeout(9000);
  assert(main.length === 3, '4. the same card again: no new answer (' + main.join() + ')');
  assert(/scared to go home/.test(await shown()), '4. the Patient\'s lines still on screen');

  // 5. a different card: the DOCTOR's lines replace them
  await go('card2');
  await page.waitForTimeout(9000);
  assert(main.join() === 'normal:desk,normal:card1,role:Patient,role:Doctor', '5. a different card: the Doctor\'s lines asked for (' + main.join() + ')');
  s = await shown();
  assert(/what to look out for/.test(s) && !/scared to go home/.test(s), '5. the Doctor\'s lines are on screen');

  // 6. the desk: the Doctor's lines stay
  await go('desk');
  await page.waitForTimeout(9000);
  assert(main.length === 4 && /what to look out for/.test(await shown()), '6. desk again: the Doctor\'s lines stay, no new answer (' + main.join() + ')');

  // the role requests themselves: one card, the role-play rules, the role named, no document scaffolding, no session transcript
  for (const b of roleBodies) {
    const content = b.messages[0].content, ut = textOf(content), st = sysText(b.system);
    const role = (/You are the (\w+)\./.exec(ut) || [])[1];
    assert(content.filter((c) => c.type === 'image').length === 1, 'role request (' + role + '): exactly one card image');
    assert(!/EARLIER FRAMES|FRAMES:\s*continues/i.test(ut), 'role request (' + role + '): no "read as one document" scaffolding');
    assert(/BECOME that person/.test(ut) && /dialogue generator/i.test(st), 'role request (' + role + '): the role-play prompt and rules');
    assert(!/the very first line is exactly|recording a spoken brainstorming session/i.test(st), 'role request (' + role + '): not the describe rules, not the session transcript');
  }
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('looks:', looks.map((l) => l.scene + ':' + l.kind + ':' + l.answer.split(' |')[0]).join(', '));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'ROLE CARDS FAILED' : 'ROLE CARDS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
