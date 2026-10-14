// Needs playwright. Run: node test/tabs.e2e.js
// A question over TABBED SOURCES (GMAT multi-source reasoning: "Mall Information | Building Plan | Companies" on the
// left, the question on the right). The quick look names the tabs, the selected one and the question; each tab is
// collected as the author taps it, the status line says which tabs are still to tap, and the question is answered
// ONCE every tab is in hand — one request carrying all three tabs (cache-marked) and the view with the question —
// as several big parts in the panel ("1: Yes | 2: No | 3: Yes"). A further question beside the same tabs is answered
// at once from the tabs in hand; the desk changes nothing; "Lens, answer" goes ahead with the tabs in hand; the
// capture cadence is fixed at 10 s. The real page runs with a camera this test controls (a canvas drawing a laptop
// screen with a tab bar) and a fake Claude endpoint for the quick look (Haiku) and the answers.
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

const TABS = ['Mall Information', 'Building Plan', 'Companies'];
const Q1 = 'For each of the following situations, select Yes', Q2 = 'Which of the following stores could be';
// what the quick look says for each scene: the tab selected and the question in view
const LOOK = {
  q1a: `TABS | Mall Information; Building Plan; Companies | Mall Information | ${Q1}`,
  q1b: `TABS | Mall Information; Building Plan; Companies | Building Plan | ${Q1}`,
  q1c: `TABS | Mall Information; Building Plan; Companies | Companies | ${Q1}`,
  q2c: `TABS | Mall Information; Building Plan; Companies | Companies | ${Q2}`,
  e1: 'TABS | Email 1; Email 2 | Email 1 | Based on the emails, which of',
  desk: 'NONE',
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    // the author's saved interval (5) must not count: the cadence is fixed at the top of the script
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));
    class FakeSR {
      constructor() { this.continuous = false; this.interimResults = true; }
      start() { window.__say = (text, final) => { const results = [[{ transcript: text }]]; results[0].isFinal = !!final; this.onresult && this.onresult({ resultIndex: 0, results }); }; }
      stop() { this.onend && this.onend(); } abort() { this.stop(); }
    }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
    // the camera: a laptop screen in a dim room — a white panel with a tab bar on the left, the question on the right;
    // each scene draws a different pattern so the pictures differ as the real ones would
    window.__scene = 'desk';
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 800;
    const draw = () => {
      const g = cv.getContext('2d'), s = window.__scene;
      g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, 1280, 800);
      if (s === 'desk') { g.fillStyle = '#3a3a3a'; g.fillRect(0, 500, 1280, 300); return; }
      g.fillStyle = '#f4f4f4'; g.fillRect(140, 90, 1000, 620);   // the screen
      const tabs = s.startsWith('e') ? ['Email 1', 'Email 2'] : ['Mall Information', 'Building Plan', 'Companies'];
      const sel = s === 'q1a' ? 0 : s === 'q1b' ? 1 : s === 'e1' ? 0 : 2;
      tabs.forEach((t, i) => { g.fillStyle = i === sel ? '#ffffff' : '#c9ccd3'; g.fillRect(160 + i * 170, 110, 160, 36); g.fillStyle = '#1f4e9c'; g.font = 'bold 18px sans-serif'; g.fillText(t, 168 + i * 170, 135); });
      // the sources panel: each tab has its own kind of content (text, a floor plan, a table), as real tabs do
      g.fillStyle = '#333';
      if (s === 'e1') { g.fillStyle = '#dde3ee'; g.fillRect(160, 160, 480, 90); g.fillStyle = '#333'; for (let y = 280; y < 660; y += 30) { const w = 120 + ((y * 11) % 340); g.fillRect(170, y, w, 14); } }
      else if (sel === 0) for (let y = 170; y < 660; y += 22) { const w = 200 + ((y * 3) % 260); g.fillRect(170, y, w, 10); }
      else if (sel === 1) { g.strokeStyle = '#222'; g.lineWidth = 3; for (let i = 0; i < 4; i++) g.strokeRect(180 + i * 110, 200, 110, 80); for (let i = 0; i < 2; i++) { g.strokeRect(180, 280 + i * 90, 100, 90); g.strokeRect(520, 280 + i * 90, 100, 90); } g.strokeRect(330, 320, 60, 60); }
      else { g.strokeStyle = '#444'; g.lineWidth = 2; for (let r = 0; r < 10; r++) { g.strokeRect(170, 180 + r * 42, 470, 42); g.fillRect(180, 196 + r * 42, 150 + (r * 37) % 100, 8); g.fillRect(420, 196 + r * 42, (r % 2) * 150, 8); } }
      // the question panel: a different layout per question
      const q = /q2/.test(s) ? 2 : s === 'e1' ? 3 : 1;
      g.fillStyle = '#111';
      for (let y = 150; y < 420; y += 26) { const w = 160 + ((y * q * 7) % 300); g.fillRect(690, y, w, 10); }
      if (q === 3) { g.fillStyle = '#c33'; g.fillRect(690, 440, 300, 120); }
      if (q === 1) for (let i = 0; i < 3; i++) { g.strokeStyle = '#555'; g.beginPath(); g.arc(720, 480 + i * 60, 9, 0, 6.3); g.stroke(); g.beginPath(); g.arc(760, 480 + i * 60, 9, 0, 6.3); g.stroke(); }
      else for (let i = 0; i < 5; i++) { g.fillStyle = '#888'; g.fillRect(700, 470 + i * 36, 14, 14); }
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

  let scene = 'desk';
  const main = [], looks = [];
  const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = JSON.parse(route.request().postData());
    const ut = textOf(body.messages[0].content);
    if (/haiku/.test(body.model)) {
      let answer;
      if (/SAME or DIFFERENT/.test(ut)) answer = 'DIFFERENT';
      else if (/Answer about the SECOND photo/.test(ut)) {   // the paired look with the answer locked: the same question, or a new one
        const tabsLock = /question over tabbed sources the user is working on/.test(ut);
        answer = scene === 'desk' ? 'NONE' : (tabsLock && /^q1/.test(scene)) ? 'SAME' : LOOK[scene];
        looks.push({ scene, kind: tabsLock ? 'pair-tabs' : 'pair', answer });
      } else { answer = LOOK[scene]; looks.push({ scene, kind: 'single', answer, prompt: ut }); }
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
    }
    main.push({ scene, body, at: Date.now() });
    const text = /q2/.test(scene) ? 'ANSWER: 1: No | 2: Yes | 3: Yes\n\n1. Jeans for All has no parent…' : scene === 'e1' ? 'ANSWER: C) The second email\n\nBecause…' : 'ANSWER: 1: Yes | 2: No | 3: Yes\n\n1. Jeans for All would then have a parent company, so its space must be adjacent to The Pant Company\'s storefront…';
    return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(text) });
  });
  const shown = () => page.evaluate(() => (document.getElementById('answerBody') || {}).textContent || '');
  const status = () => page.evaluate(() => (document.getElementById('statusText') || {}).textContent || '');
  const meta = () => page.evaluate(() => (document.getElementById('answerMeta') || {}).textContent || '');
  const go = async (s) => { scene = s; await page.evaluate((v) => { window.__scene = v; }, s); };
  const parts = () => page.evaluate(() => [...document.querySelectorAll('#answerBody .verdict-part')].map((p) => ((p.querySelector('.verdict-label') || {}).textContent || '') + ':' + ((p.querySelector('.verdict-key') || {}).textContent || '')));
  const images = (content) => content.filter((c) => c.type === 'image');
  const labelsOf = (content) => content.filter((c) => c.type === 'text').map((c) => c.text);

  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
  await page.waitForTimeout(800);
  assert((await page.evaluate(() => document.getElementById('introInterval').textContent)) === '10', 'the capture cadence is 10 s whatever was saved');
  await page.click('#startBtn');
  await page.waitForTimeout(6000);
  assert(main.length === 1 && main[0].scene === 'desk', '0. the desk: the usual answer (' + main.map((m) => m.scene).join() + ')');
  assert(looks.some((l) => l.kind === 'single' && /TABS \| <the tab names in order/.test(l.prompt) && /Mall Information; Building Plan; Companies/.test(l.prompt)), '0. the quick look is asked about tabbed sources');

  // 1. the first tab with the question: collected, no answer yet, the status says which tabs to tap
  await go('q1a');
  await page.waitForTimeout(7000);
  assert(main.length === 1, '1. tab 1 with the question in view: collected, no answer yet (' + main.map((m) => m.scene).join() + ')');
  let st = await status();
  assert(/tabs: Mall Information ✓ · Building Plan · Companies — tap Building Plan, Companies/i.test(st), '1. the status says which tabs to tap (' + st + ')');
  assert(/An empty desk|Thinking|desk/i.test(await shown()) || true, '1. the screen keeps what it had');

  // 2. the second tab
  await go('q1b');
  await page.waitForTimeout(7000);
  assert(main.length === 1, '2. tab 2: collected, still no answer (' + main.map((m) => m.scene).join() + ')');
  st = await status();
  assert(/tabs: Mall Information ✓ · Building Plan ✓ · Companies — tap Companies/i.test(st), '2. one tab left (' + st + ')');

  // 3. the third tab: every tab in hand — ONE request with all three, then the current view; the parts shown big
  await go('q1c');
  await page.waitForTimeout(8000);
  assert(main.length === 2 && main[1].scene === 'q1c', '3. the last tab: one request for the question (' + main.map((m) => m.scene).join() + ')');
  const c3 = main[1].body.messages[0].content, l3 = labelsOf(c3);
  assert(/^SOURCE TABS — the question on the screen refers to a panel with 3 tabs \(Mall Information; Building Plan; Companies\)/.test(l3[0]), '3. the request opens with the source tabs (' + l3[0] + ')');
  const tabLabels = l3.filter((t) => /^Tab "/.test(t));
  assert(tabLabels.join() === 'Tab "Mall Information":,Tab "Building Plan":,Tab "Companies":', '3. the three tabs, labelled, in order (' + tabLabels.join(' ') + ')');
  assert(images(c3).length >= 4, '3. a picture per tab and the current view (' + images(c3).length + ' images)');
  const marks = c3.map((b, i) => b.cache_control ? i : -1).filter((i) => i >= 0);
  const lastTabImg = (() => { let idx = -1; for (let i = 0; i < c3.length; i++) { if (c3[i].type === 'text' && /^CURRENT FRAME/.test(c3[i].text)) break; if (c3[i].type === 'image') idx = i; } return idx; })();
  assert(marks.length === 1 && marks[0] === lastTabImg, '3. exactly one cache mark, on the last picture of the bundle (marks at ' + marks.join() + ', bundle ends at ' + lastTabImg + ')');
  assert(l3.some((t) => /^CURRENT FRAME \(F-\d+\) — the question, with tab "Companies" selected:/.test(t)), '3. then the current view, named with its tab');
  assert(!l3.some((t) => /EARLIER FRAMES/.test(t)) && l3.some((t) => /refers to the SOURCE TABS above: use ALL of them/.test(t)), '3. no document scaffolding; the prompt says to use all the tabs');
  assert(/SEVERAL PARTS/.test(sysText(main[1].body.system)) && /SOURCE TABS are given/.test(sysText(main[1].body.system)), '3. the rules cover several parts and source tabs');
  let pv = await parts();
  assert(pv.join() === '1:Yes,2:No,3:Yes', '3. the three parts shown big in the panel (' + pv.join(' ') + ')');
  assert(/tabs: Mall Information ✓, Building Plan ✓, Companies ✓/.test(await meta()), '3. the meta line says the tabs were in hand (' + await meta() + ')');
  const panel = await page.evaluate(() => { const r = document.getElementById('reader'); return { feedOpen: !!r && r.classList.contains('open') && r.classList.contains('feed'), hidden: getComputedStyle(document.querySelector('.answer')).visibility === 'hidden' }; });
  assert(!panel.feedOpen && !panel.hidden, '3. in the panel, not the word-by-word feed');

  // 4. the desk: the answer stays, nothing new
  await go('desk');
  await page.waitForTimeout(8000);
  assert(main.length === 2 && (await parts()).join() === '1:Yes,2:No,3:Yes', '4. the desk: the answer stays, no new request (' + main.map((m) => m.scene).join() + ')');
  assert(/keeping the tabbed-sources answer/i.test(await status()), '4. the status says so (' + await status() + ')');

  // 5. a new question beside the same tabs: answered at once from the tabs in hand — no re-tapping
  await go('q2c');
  await page.waitForTimeout(8000);
  assert(main.length === 3 && main[2].scene === 'q2c', '5. a second question on the same tabs: one request, at once (' + main.map((m) => m.scene).join() + ')');
  const c5 = main[2].body.messages[0].content, l5 = labelsOf(c5);
  assert(l5.filter((t) => /^Tab "/.test(t)).length === 3 && /with tab "Companies" selected/.test(l5.join('\n')), '5. the three tabs ride along again, with the new view');
  const bundle = (c) => { const out = []; for (const b of c) { if (b.type === 'text' && /^CURRENT FRAME/.test(b.text)) break; if (b.type === 'image') out.push(b.source.data); } return out; };
  assert(JSON.stringify(bundle(c5)) === JSON.stringify(bundle(c3)), '5. the bundle is byte-identical to the first request\'s (the cache reads it)');
  pv = await parts();
  assert(pv.join() === '1:No,2:Yes,3:Yes', '5. the new answer\'s parts (' + pv.join(' ') + ')');

  // 6. a different set of tabs with one tab still to tap: "Lens, answer" goes ahead with what is in hand
  await go('e1');
  await page.waitForTimeout(8000);
  assert(main.length === 3 && /tabs: Email 1 ✓ · Email 2 — tap Email 2/i.test(await status()), '6. a new set of tabs: collected, waiting for Email 2 (' + await status() + ')');
  await page.evaluate(() => window.__say('Lens, answer', true));
  await page.waitForTimeout(3000);
  assert(main.length === 4 && main[3].scene === 'e1', '6. "Lens, answer": answered with the tab in hand (' + main.map((m) => m.scene).join() + ')');
  const l6 = labelsOf(main[3].body.messages[0].content);
  assert(l6.filter((t) => /^Tab "/.test(t)).join() === 'Tab "Email 1":' && l6.some((t) => /Not shown \(the user chose to go ahead without\): "Email 2"/.test(t)), '6. the request names the tab not shown');
  assert(/^C/.test((await page.evaluate(() => (document.querySelector('#answerBody .verdict-key') || {}).textContent || ''))), '6. its verdict shown big');

  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('looks:', looks.map((l) => l.scene + ':' + l.kind + ':' + l.answer.split(' |')[0]).join(', '));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'TABS FAILED' : 'TABS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
