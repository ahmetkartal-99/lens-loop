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
      if (s === 'mcq') { for (let x = 0; x < 640; x += 40) { g.fillStyle = (x / 40) % 2 ? '#f0f0f0' : '#101010'; g.fillRect(x, 0, 40, 480); } }
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
  DESCRIBE.mcq = 'ANSWER: C) Pneumonia\n\nThe findings fit a lobar pneumonia.';

  let scene = 'desk', card1Looks = 0, lockedRole = '';
  const main = [], roleBodies = [], looks = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const ut = textOf(body.messages[0].content);
    if (/haiku/.test(body.model)) {
      let answer;
      if (/SAME or DIFFERENT/.test(ut)) answer = 'DIFFERENT';                                   // the page check (not expected with these distinct pictures)
      else if (/Answer about the SECOND photo/.test(ut)) {                                       // the pairwise look, lines locked
        answer = scene === 'desk' ? 'NONE' : scene === 'mcq' ? 'OTHER' : CARDS[scene].role === lockedRole ? 'SAME' : CARDS[scene].line.replace(/^CARD/, 'NEW');
        looks.push({ scene, kind: 'pair', answer });
      } else {                                                                                   // the single look, nothing locked
        if (scene === 'card1') card1Looks++;
        answer = (scene === 'desk' || scene === 'mcq') ? 'NONE' : (scene === 'card1' && card1Looks === 1) ? 'NONE' : CARDS[scene].line;   // card 1 first caught out of focus
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

  // 7. a multiple-choice question: a different task — the lock lets go and it is answered the usual way (full model)
  await go('mcq');
  await page.waitForTimeout(9000);
  assert(main.join() === 'normal:desk,normal:card1,role:Patient,role:Doctor,normal:mcq', '7. a question while lines were locked: answered by the usual full request (' + main.join() + ')');
  s = await shown();
  assert(/Pneumonia/.test(s) && !/what to look out for/.test(s), '7. the answer is on screen, the Doctor\'s lines are gone');
  assert(/a different task/.test(await page.evaluate(() => document.getElementById('answerMeta').textContent)), '7. the meta line says why');

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
  await browser.close();

  // ---- Part 2: the quick look misses the card every time (answers NONE), and an old description of that very card
  // sits in memory from before the role rule. The full model must still catch it by its answer (a ROLE: line), the
  // stale description must not be replayed, and the lines must then lock like any other.
  const b2 = await chromium.launch();
  const ctx2 = await b2.newContext({ viewport: { width: 420, height: 860 } });
  const p2 = await ctx2.newPage();
  const errors2 = []; p2.on('pageerror', (e) => errors2.push(String(e)));
  await ctx2.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone', useStories: true }));
    class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
    window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
    window.__scene = 'card1';
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      g.fillStyle = '#787878'; g.fillRect(0, 0, 640, 480);
      if (s === 'card1') { for (let y = 0; y < 480; y += 32) for (let x = 0; x < 640; x += 32) { g.fillStyle = ((x + y) / 32) % 2 ? '#c8c8c8' : '#3c3c3c'; g.fillRect(x, y, 32, 32); } }
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
  // a stale memory note of card 1 — a description made before the role rule (no rv flag), with the card's fingerprint
  await p2.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await p2.waitForTimeout(800);
  const planted = await p2.evaluate(async () => {
    // the page's own fingerprint of the current camera picture, via a hidden capture
    const v = document.getElementById('video'); const s = await navigator.mediaDevices.getUserMedia({ video: true }); v.srcObject = s; await v.play();
    await new Promise((r) => setTimeout(r, 600));
    // the same fingerprint the page makes (frameSignature): 48×36 grey, (3R + 6G + B) / 10
    const sc = document.createElement('canvas'); sc.width = 48; sc.height = 36; const c = sc.getContext('2d', { willReadFrequently: true });
    c.drawImage(v, 0, 0, 48, 36);
    const d = c.getImageData(0, 0, 48, 36).data, sig = new Uint8Array(48 * 36);
    for (let i = 0; i < sig.length; i++) sig[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
    let b = ''; for (let i = 0; i < sig.length; i++) b += String.fromCharCode(sig[i]);
    s.getTracks().forEach((t) => t.stop()); v.srcObject = null;
    const note = { id: 'vf_stale', at: Date.now() - 3600000, tag: 'F-0001', question: '', caption: 'Roleplayer card', sig: btoa(b), text: 'ANSWER: Roleplayer card, medical ward\n\nThe card says: you are 54 years old and were admitted with pneumonia.' };
    const st = { id: 'st_old', title: 'Old session', createdAt: Date.now() - 7200000, updatedAt: Date.now() - 3600000, seconds: 60, words: 3, text: 'old transcript', summary: 'Old.', keys: 'k', use: true, visuals: [note] };
    await new Promise((res) => { const r = indexedDB.open('lensloop', 3); r.onsuccess = () => { const tx = r.result.transaction('storylines', 'readwrite'); tx.objectStore('storylines').put(st); tx.oncomplete = () => res(); }; });
    return sig.length;
  });
  assert(planted > 0, 'part 2: a stale description of the card planted in memory (' + planted + '-byte fingerprint)');
  const main2 = [];
  await p2.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (/haiku/.test(body.model)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'NONE' }], usage: {} }) });   // the quick look never sees the card
    const ut = textOf(body.messages[0].content), st = sysText(body.system);
    main2.push(/dialogue generator/i.test(st) ? 'role' : 'normal');
    // the full model sees the card in the usual request and answers in role, as the rules now ask
    const hasRule = /A SPEAKING ROLE-PLAY CARD/.test(st) && /"ROLE: "/.test(st);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(hasRule ? 'ANSWER: Worried about going home\nSTORYLINE: none\nROLE: Patient\n\nDoctor, I still don\'t feel back to normal, and honestly I\'m scared to go home today.' : 'ANSWER: Roleplayer card\n\nThe card says: you are 54.') });
  });
  await p2.reload(); await p2.waitForTimeout(1500);
  await p2.click('#startBtn');
  await p2.waitForTimeout(9000);
  const shown2 = await p2.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  const meta2 = await p2.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  assert(main2.join() === 'normal', 'part 2: the quick look said NONE, so the usual request went out — not the stale memory (' + main2.join() + ')');
  assert(/scared to go home/.test(shown2) && !/The card says/.test(shown2), 'part 2: the full model answered in role by itself and the lines are on screen');
  assert(/card:Patient \(by the answer\)/.test(meta2), 'part 2: the meta line says the card was caught by the answer (' + meta2 + ')');
  await p2.waitForTimeout(12000);
  assert(main2.length === 1 && /scared to go home/.test(await p2.evaluate(() => document.getElementById('answerBody').textContent)), 'part 2: locked — the same card over 12 s brought no new answer (' + main2.join() + ')');
  // during a recording the note goes into the live draft (local storage until Stop); saved storylines live in the database
  const remembered = await p2.evaluate(() => new Promise((res) => {
    let draft = []; try { draft = (JSON.parse(localStorage.getItem('lensloop.draft') || 'null') || {}).visuals || []; } catch (e) {}
    const r = indexedDB.open('lensloop', 3);
    r.onsuccess = () => { const q = r.result.transaction('storylines').objectStore('storylines').getAll(); q.onsuccess = () => res(q.result.flatMap((s) => s.visuals || []).concat(draft).map((v) => ({ scene: !!v.scene, rv: !!v.rv }))); };
  }));
  assert(remembered.some((v) => v.scene && v.rv), 'part 2: the lines were remembered as a role card\'s, with the rule in force (' + JSON.stringify(remembered) + ')');
  assert(errors2.length === 0, 'part 2: no page errors' + (errors2.length ? ': ' + errors2.join(' | ') : ''));
  await b2.close();

  // ---- Parts 3 and 4: a WRITING task over several pages (case notes, then "Writing Task: write a letter of referral…").
  // A harness with a camera this test switches between pages (desk / notes / notes2 / task / mcq) and a fake Claude
  // endpoint whose quick look answers as a well-behaved model would for these pages.
  const LETTER = 'ANSWER: Referral to Dr Smith\nTASK: referral letter — Mrs Sharma to Dr Smith\n\nDear Dr Smith,\n\nThank you for seeing Mrs Priya Sharma, a 60-year-old retired clerical worker with type 2 diabetes since 1999, whose fasting sugars remain in the 16+ range despite metformin 750 mg b.d. and glipizide.';
  async function writingHarness() {
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
    const p = await ctx.newPage();
    const h = { b, p, errors: [], main: [], looks: [], singlePrompts: [], scene: 'desk' };
    p.on('pageerror', (e) => h.errors.push(String(e)));
    await ctx.addInitScript(() => {
      localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));
      class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
      window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
      window.__scene = 'desk';
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
      const draw = () => {
        const g = cv.getContext('2d'), s = window.__scene;
        g.fillStyle = '#787878'; g.fillRect(0, 0, 640, 480);
        if (s === 'notes') { for (let y = 0; y < 480; y += 24) { g.fillStyle = (y / 24) % 2 ? '#d0d0d0' : '#303030'; g.fillRect(0, y, 640, 24); } }
        if (s === 'notes2') { for (let y = 0; y < 480; y += 16) { g.fillStyle = (y / 16) % 3 ? '#e8e8e8' : '#202020'; g.fillRect(0, y, 640, 16); } }
        if (s === 'task') { for (let y = 0; y < 480; y += 48) for (let x = 0; x < 640; x += 48) { g.fillStyle = ((x + y) / 48) % 2 ? '#b0b0b0' : '#404040'; g.fillRect(x, y, 48, 48); } }
        if (s === 'mcq') { for (let x = 0; x < 640; x += 40) { g.fillStyle = (x / 40) % 2 ? '#f0f0f0' : '#101010'; g.fillRect(x, 0, 40, 480); } }
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
    const look = (ut) => {
      const paired = /Answer about the SECOND photo/.test(ut), taskStyle = paired && /whose finished text the user is reading now/.test(ut);
      if (h.scene === 'desk') return 'NONE';
      if (h.scene === 'mcq') return paired ? 'OTHER' : 'NONE';
      if (h.scene === 'notes' || h.scene === 'notes2') return taskStyle ? 'MORE' : 'NOTES | Mrs Priya Sharma';
      if (h.scene === 'task') return taskStyle ? 'SAME' : 'WRITE | a letter of referral to Dr Smith';
      return 'NONE';
    };
    await p.route('https://api.anthropic.com/v1/messages', async (route) => {
      const body = JSON.parse(route.request().postData());
      const ut = textOf(body.messages[0].content);
      if (/haiku/.test(body.model)) {
        let answer;
        if (/SAME or DIFFERENT/.test(ut)) answer = 'DIFFERENT';
        else { answer = look(ut); const paired = /Answer about the SECOND photo/.test(ut); if (!paired) h.singlePrompts.push(ut); h.looks.push({ scene: h.scene, kind: paired ? (/whose finished text/.test(ut) ? 'pair-task' : 'pair-role') : 'single', answer }); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
      }
      const images = body.messages[0].content.filter((c) => c.type === 'image').length;
      h.main.push(h.scene + ':' + images + 'img' + (/WRITING TASK/.test(ut) ? '+write' : ''));
      const text = /WRITING TASK/.test(ut) || h.scene === 'task' ? LETTER : h.scene === 'mcq' ? 'ANSWER: C) Pneumonia\n\nThe findings fit a lobar pneumonia.' : /^notes/.test(h.scene) ? 'ANSWER: Case notes — Mrs Priya Sharma\n\nCase notes for a 60-year-old with type 2 diabetes.' : 'ANSWER: An empty desk\n\nA grey surface, nothing to read.';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(text) });
    });
    h.shown = () => p.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
    h.status = () => p.evaluate(() => (document.getElementById('statusText') || {}).textContent || '');
    h.meta = () => p.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
    h.go = async (s) => { h.scene = s; await p.evaluate((v) => { window.__scene = v; }, s); };
    await p.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
    await p.waitForTimeout(800);
    await p.click('#startBtn');
    return h;
  }
  const looksOf = (h) => h.looks.map((l) => l.scene + ':' + l.kind + ':' + l.answer.split(' |')[0]).join(', ');

  // Part 3: the notes first, then the instructions. The quick look must not take the notes for a role-play card; the
  // notes pages are collected with no full answer; the instructions page brings ONE request for the letter, with the
  // pages among the earlier frames; the letter is locked: the desk and the pages it was written from change nothing
  // and cost no request; a different task (a multiple-choice item) replaces it.
  {
    const h = await writingHarness();
    await h.p.waitForTimeout(7000);
    assert(h.singlePrompts.length >= 1 && h.singlePrompts.every((u) => /A WRITING task is NOT a role-play card/.test(u) && /\nNOTES \| /.test(u) && /\nWRITE \| /.test(u)), '3. the quick look is told a writing task is not a role-play card, and asked about notes and instructions pages');

    await h.go('notes');
    await h.p.waitForTimeout(8000);
    assert(h.main.join() === 'desk:1img', '3a. a case-notes page: collected, no full answer (' + h.main.join() + ')');
    assert(/case notes collected \(1 page\)/i.test(await h.status()), '3a. the status line says so (' + await h.status() + ')');
    await h.go('notes2');
    await h.p.waitForTimeout(8000);
    assert(h.main.join() === 'desk:1img', '3a. a second page: collected too, still no full answer (' + h.main.join() + ')');
    assert(/case notes collected \(2 pages\)/i.test(await h.status()), '3a. two pages collected (' + await h.status() + ')');
    assert(/empty desk/.test(await h.shown()), '3a. the screen is unchanged meanwhile');

    await h.go('task');
    await h.p.waitForTimeout(9000);
    assert(h.main.join() === 'desk:1img,task:4img+write', '3b. the instructions page: ONE request for the letter, the desk and both notes pages among the earlier frames, told it is a writing task (' + h.main.join() + ')');
    let s3 = await h.shown();
    assert(/Dear Dr Smith/.test(s3) && /Priya Sharma/.test(s3), '3b. the letter is on screen');
    assert(/task:referral letter/.test(await h.meta()), '3b. the meta line says a task was caught by the answer');
    assert(/keeping the referral letter/i.test(await h.status()), '3b. the status line says the text is kept (' + await h.status() + ')');

    await h.go('desk');
    await h.p.waitForTimeout(9000);
    assert(h.main.length === 2 && /Dear Dr Smith/.test(await h.shown()), '3c. the desk: the letter stays, no new answer (' + h.main.join() + ')');

    const looksBefore = h.looks.length;
    await h.go('notes2');
    await h.p.waitForTimeout(9000);
    assert(h.main.length === 2 && /Dear Dr Smith/.test(await h.shown()), '3d. the case notes again: the letter stays, no new answer (' + h.main.join() + ')');
    assert(!h.looks.slice(looksBefore).some((l) => l.scene === 'notes2'), '3d. a page the letter was written from is known: no quick look spent on it (' + h.looks.slice(looksBefore).map((l) => l.scene + ':' + l.answer).join(', ') + ')');

    await h.go('mcq');
    await h.p.waitForTimeout(9000);
    assert(h.main.join() === 'desk:1img,task:4img+write,mcq:5img', '3e. a multiple-choice item: answered as usual (' + h.main.join() + ')');
    s3 = await h.shown();
    assert(/Pneumonia/.test(s3) && !/Dear Dr Smith/.test(s3), '3e. the answer is on screen, the letter is gone');
    assert(h.errors.length === 0, 'part 3: no page errors' + (h.errors.length ? ': ' + h.errors.join(' | ') : ''));
    console.log('part 3 looks:', looksOf(h));
    await h.b.close();
  }

  // Part 4: the other order — the instructions page first (the letter written without the notes), then two notes
  // pages close together: gathered, and the letter written again ONCE, after the pages stop coming.
  {
    const h = await writingHarness();
    await h.p.waitForTimeout(6000);
    await h.go('task');
    await h.p.waitForTimeout(9000);
    assert(h.main.join() === 'desk:1img,task:2img+write', '4a. the instructions first: the letter written from what is in hand (' + h.main.join() + ')');
    assert(/Dear Dr Smith/.test(await h.shown()), '4a. the letter is on screen');
    await h.go('notes');
    await h.p.waitForTimeout(3600);
    await h.go('notes2');
    await h.p.waitForTimeout(2500);
    assert(h.main.length === 2, '4b. two notes pages in quick succession: gathered, no request yet (' + h.main.join() + ')');
    assert(/Dear Dr Smith/.test(await h.shown()), '4b. the letter still on screen meanwhile');
    assert(/more of the task collected \(2 pages\)/i.test(await h.status()), '4b. the status line says so (' + await h.status() + ')');
    await h.p.waitForTimeout(9000);
    assert(h.main.join() === 'desk:1img,task:2img+write,notes2:4img+write', '4c. then the letter written again ONCE, with the instructions and both pages among the frames, told it is more of the task (' + h.main.join() + ')');
    assert(/Dear Dr Smith/.test(await h.shown()), '4c. the rewritten letter is on screen');
    await h.p.waitForTimeout(9000);
    assert(h.main.length === 3, '4d. and locked again: nothing more (' + h.main.join() + ')');
    assert(h.errors.length === 0, 'part 4: no page errors' + (h.errors.length ? ': ' + h.errors.join(' | ') : ''));
    console.log('part 4 looks:', looksOf(h));
    await h.b.close();
  }
  server.close();
  console.log(process.exitCode ? 'ROLE CARDS FAILED' : 'ROLE CARDS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
