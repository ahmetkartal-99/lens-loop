// Needs playwright. Run: node test/model.e2e.js
// "Always the newest Fable" (the author: "make the newest Fable model always the default without me needing to tell
// you … I want it to automatically adjust"). The real page runs against a fake Anthropic: a model list (GET
// /v1/models, in the documented shape) and a messages endpoint that can turn a given model down.
//   A. today's list (Fable 5.2 the newest): asked once on open with the key; answers come from claude-fable-5-2 at
//      max; Settings, the build stamp and the diagnostics say so; what was found is remembered.
//   B. a Fable 6 appears in the list: taken on the next open by itself — a status line, a note, the next answer from
//      it at max, its cost marked "≈" (a price this build does not know); the list unreachable on a later open: the
//      remembered model answers from the first request; the model withdrawn from the list: back to the built-in one.
//   C. a newer model that turns the page's request down (400 before it ever answered): the same picture is answered
//      by the built-in model at once, a note says so, later requests go straight there, the next open tries it
//      afresh; once it has answered, a later 400 is the request's trouble, not the model's.
//   D. a key that cannot use the built-in model and no list to go by (404): the model before answers. The account's
//      own trouble (credit) is never blamed on the model; a request every model turns down is reported once.
//   E. a model that does not list max: the deepest effort it does list; its max_tokens cap respected.
//   F. the list arriving while a session runs: nothing changes under the session; the newer model takes over at Stop.
//   G. a model typed into Settings: used as typed (and never stepped away from) until the field is emptied.
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
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 9000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await WAIT(100); } };

// Anthropic's list as documented: newest first; line, lifecycle, release time, what each model can do
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const eff = (...on) => Object.assign({ supported: on.length > 0 }, ...EFFORTS.map((e) => ({ [e]: { supported: on.includes(e) } })));
const M = (id, line, name, created, extra) => Object.assign({ type: 'model', id, display_name: name, created_at: created, lifecycle: 'active', line, deprecated_at: null, retires_at: null,
  max_input_tokens: 1000000, max_tokens: 128000, capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, effort: eff(...EFFORTS), thinking: { supported: true, types: { adaptive: { supported: true } } } } }, extra || {});
const TODAY = [
  M('claude-fable-5-2', 'fable', 'Claude Fable 5.2', '2026-11-09T00:00:00Z'), M('claude-mythos-5-2', 'mythos', 'Claude Mythos 5.2', '2026-11-09T00:00:00Z'),
  M('claude-haiku-5-5', 'haiku', 'Claude Haiku 5.5', '2026-10-07T00:00:00Z'), M('claude-sonnet-5-5', 'sonnet', 'Claude Sonnet 5.5', '2026-09-28T00:00:00Z'),
  M('claude-opus-5-5', 'opus', 'Claude Opus 5.5', '2026-09-21T00:00:00Z'), M('claude-fable-5-1', 'fable', 'Claude Fable 5.1', '2026-09-01T00:00:00Z'),
  M('claude-fable-5', 'fable', 'Claude Fable 5', '2026-06-09T00:00:00Z'), M('claude-haiku-4-5-20251001', 'haiku', 'Claude Haiku 4.5', '2025-10-15T00:00:00Z'),
];
const SIX = [M('claude-fable-6', 'fable', 'Claude Fable 6', '2027-03-01T00:00:00Z')].concat(TODAY);
const SEVEN = [M('claude-fable-7', 'fable', 'Claude Fable 7', '2027-09-01T00:00:00Z')].concat(TODAY);
const EIGHT = [M('claude-fable-8', 'fable', 'Claude Fable 8', '2028-03-01T00:00:00Z', { max_tokens: 16000 })].concat(TODAY);
EIGHT[0].capabilities = Object.assign({}, EIGHT[0].capabilities, { effort: eff('low', 'medium', 'high', 'xhigh') });
const ANSWERS = { q1: 'ANSWER: B) 42\n\nFrom the second line.', q2: 'ANSWER: C) 7\n\nThe third line gives it.', q3: 'ANSWER: D) 9\n\nBy the last line.' };

const FIXTURE = () => {
  if (!localStorage.getItem('lensloop.settings')) localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: false, key: 'sk-ant-test-0000', quietSec: 2, sttEngine: 'phone' }));   // (kept across reloads: what the page remembers is part of the test)
  class HushSR { start() {} stop() { this.onend && this.onend(); } abort() { this.stop(); } }
  window.webkitSpeechRecognition = HushSR; window.SpeechRecognition = HushSR;
  // the camera: a bright page with a block of "text" lines — q1, q2, q3 are three different questions, a trailing "b" the same block moved
  window.__scene = 'q1';
  const W = 1280, H = 720;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const draw = () => {
    const g = cv.getContext('2d'), s = window.__scene, q = s.charAt(1), moved = /b$/.test(s);
    g.fillStyle = q === '2' ? '#d8d8d2' : q === '3' ? '#dfe5ea' : '#ececea'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1a1a';
    const x0 = moved ? 620 : 60, y0 = q === '2' ? 300 : q === '3' ? 190 : 70, lines = q === '2' ? 11 : q === '3' ? 8 : 6;
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
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const allErrors = [];
  // one phone: its own storage, a model list (st.models: { list } | { status } with an optional delay) and a messages
  // endpoint that turns a request down when st.refuse(body) says so
  const phone = async (models, refuse) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
    await ctx.addInitScript(FIXTURE);
    const page = await ctx.newPage();
    const st = { ctx, page, models, refuse: refuse || (() => null), main: [], lists: [], looks: 0, scene: 'q1' };
    page.on('pageerror', (e) => allErrors.push(String(e)));
    const fulfil = (route, opts) => route.fulfill(opts).catch(() => {});
    await page.route('https://api.anthropic.com/v1/models**', async (route) => {
      const rq = route.request(), m = st.models;
      const entry = { url: rq.url(), method: rq.method(), headers: rq.headers(), done: false };
      st.lists.push(entry);
      if (m.delay) await WAIT(m.delay);
      entry.done = true;
      if (m.status && m.status !== 200) return fulfil(route, { status: m.status, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Internal server error' } }) });
      return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ data: m.list, has_more: false, first_id: m.list.length ? m.list[0].id : null, last_id: m.list.length ? m.list[m.list.length - 1].id : null }) });
    });
    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      const body = JSON.parse(route.request().postData());
      if (/haiku/.test(body.model)) {
        st.looks++;
        return fulfil(route, { status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: /SAME or DIFFERENT/.test(textOf(body.messages[0].content)) ? 'DIFFERENT' : 'CHOICE' }], usage: { input_tokens: 1500, output_tokens: 20 } }) });
      }
      const no = st.refuse(body);
      st.main.push({ model: body.model, effort: body.output_config && body.output_config.effort, max_tokens: body.max_tokens, keys: Object.keys(body).sort().join(), refused: no ? no.status : 0, scene: st.scene, at: Date.now() });
      if (no) return fulfil(route, { status: no.status, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: no.type, message: no.message } }) });
      return fulfil(route, { status: 200, contentType: 'text/event-stream', body: sse(ANSWERS[st.scene.slice(0, 2)]) });
    });
    st.open = async (reload) => {
      const n = st.lists.length;
      st.scene = 'q1';   // (the fixture's camera starts on q1 with every load)
      if (reload) await page.reload(); else await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test-0000`);
      if (!st.models.delay) { await until(() => st.lists.length > n && st.lists[st.lists.length - 1].done); await WAIT(500); }
    };
    st.go = async (s) => { st.scene = s; await page.evaluate((v) => { window.__scene = v; }, s); await WAIT(450); };
    // a new picture in front of the camera: the requests it brought (a turned-down one and its second go count
    // together). An answer on screen is kept for ten seconds, so the new picture is looked at when that is over.
    st.ask = async (s) => { const n = st.main.length; await st.go(s); await until(() => st.main.length > n && !st.main[st.main.length - 1].refused, 15000); await WAIT(700); return st.main.slice(n); };
    st.text = (sel) => page.evaluate((q) => { const e = document.querySelector(q); return e ? (e.hidden ? '' : e.textContent || '') : ''; }, sel);
    st.val = (id) => page.evaluate((q) => document.getElementById(q).value, id);
    st.key = () => st.text('#answerBody .verdict-key');
    st.settings = async () => { await page.click('#settingsBtn'); await WAIT(250); const r = { now: await st.text('#modelNow'), stamp: await st.text('#buildStamp'), model: await st.val('model'), effort: await st.val('effort'), diag: await st.val('diagBox') }; await page.click('#cancelBtn'); await WAIT(150); return r; };
    st.stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('lensloop.settings') || '{}'));
    st.start = async () => { const n = st.main.length; await page.click('#startBtn'); await until(() => st.main.length > n && !st.main[st.main.length - 1].refused, 15000); await WAIT(900); return st.main.slice(n); };
    st.close = () => ctx.close();
    return st;
  };
  const models = (st) => st.main.map((m) => m.model.replace('claude-', '') + (m.refused ? '✗' + m.refused : '')).join(' ');

  // ---------- A. today's list: Fable 5.2 at max ----------
  let st = await phone({ list: TODAY });
  await st.open();
  const L = st.lists[0];
  assert(st.lists.length === 1 && L.method === 'GET' && /\/v1\/models\?limit=1000$/.test(L.url), 'A. on open the page asks Anthropic for its model list, once (' + st.lists.map((l) => l.method + ' ' + l.url.replace(/^https:\/\/[^/]+/, '')).join() + ')');
  assert(L.headers['x-api-key'] === 'sk-ant-test-0000' && L.headers['anthropic-version'] === '2023-06-01' && L.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'A. … with the key, the API version and the browser-access header');
  let got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-5-2' && got[0].effort === 'max', 'A. the answer comes from claude-fable-5-2 at max (' + models(st) + ', effort ' + (got[0] && got[0].effort) + ')');
  assert(got[0].keys === 'max_tokens,messages,model,output_config,stream,system', 'A. the request holds nothing a current Fable rejects: ' + got[0].keys);
  assert((await st.key()) === 'B', 'A. the answer is on screen (verdict ' + await st.key() + ')');
  assert(/\$0\.\d{3}/.test(await st.text('#answerMeta')) && !/≈/.test(await st.text('#answerMeta')), 'A. its cost at Fable 5.2\'s price, no "≈" (' + await st.text('#answerMeta') + ')');
  let se = await st.settings();
  assert(/^Claude Fable 5\.2 at max · the newest Fable Anthropic lists for this key \(checked /.test(se.now), 'A. Settings says which model answers and why: ' + se.now);
  assert(/· Claude Fable 5\.2 · max$/.test(se.stamp) && /^Lens Loop · build /.test(se.stamp), 'A. the build stamp names the model and the effort: ' + se.stamp);
  assert(se.model === 'claude-fable-5-2' && se.effort === 'max', 'A. the two fields show claude-fable-5-2 and max');
  assert(/^model: claude-fable-5-2 · Claude Fable 5\.2 at max/.test(se.diag) && /in line: claude-fable-5-2 → claude-fable-5-1/.test(se.diag) && /8 models in Anthropic's list/.test(se.diag), 'A. the diagnostics: the model, the line of fallbacks, the list\'s size (' + se.diag.split('\n')[0] + ')');
  let sv = await st.stored();
  assert(sv.modelSeen && sv.modelSeen.id === 'claude-fable-5-2' && sv.modelSeen.name === 'Claude Fable 5.2' && sv.modelOk && sv.modelOk['claude-fable-5-2'], 'A. what the list showed, and that the model has answered, are remembered on the phone');
  assert(!/model|turned|newer/i.test(await st.text('#banner')), 'A. no note about the model: nothing changed');

  // ---------- B. a Fable 6 appears: taken by itself on the next open ----------
  st.models = { list: SIX };
  await st.open(true);
  assert(/^Now on Claude Fable 6 — the newest Fable, taken automatically$/.test(await st.text('#statusText')), 'B. the next open: the status line says the newer model was taken (' + await st.text('#statusText') + ')');
  assert(/^A newer model is out: Lens Loop now answers with Claude Fable 6 at max \(before: Claude Fable 5\.2\)\. Nothing to do/.test(await st.text('#banner')), 'B. … and a note says so once (' + (await st.text('#banner')).slice(0, 90) + '…)');
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-6' && got[0].effort === 'max', 'B. the answer comes from claude-fable-6 at max, nothing typed or edited (' + got.map((m) => m.model + '@' + m.effort).join() + ')');
  assert(/≈\$0\.\d{3}/.test(await st.text('#answerMeta')), 'B. its cost is marked "≈": a price this build does not know (' + await st.text('#answerMeta') + ')');
  se = await st.settings();
  assert(/^Claude Fable 6 at max · the newest Fable Anthropic lists for this key \(checked [^)]+\) · its price per token is not known to this build/.test(se.now) && se.model === 'claude-fable-6' && / · Claude Fable 6 · max$/.test(se.stamp), 'B. Settings: ' + se.now);
  // the list unreachable on a later open: the remembered model answers from the first request
  st.models = { status: 500 };
  await st.open(true);
  assert(!/A newer model is out/.test(await st.text('#banner')), 'B. a later open: no note again');
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-6', 'B. the list unreachable (HTTP 500): the model found earlier answers from the first request (' + got.map((m) => m.model).join() + ')');
  se = await st.settings();
  assert(/^Claude Fable 6 at max · the newest Fable found on an earlier open; Anthropic's list could not be read just now \(HTTP 500 · Internal server error\), asked again on the next open/.test(se.now), 'B. Settings says the list could not be read: ' + se.now);
  // the model withdrawn from the list: back to the built-in one
  st.models = { list: TODAY };
  await st.open(true);
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-5-2' && (await st.stored()).modelSeen.id === 'claude-fable-5-2', 'B. Fable 6 gone from the list again: the built-in model answers (' + got.map((m) => m.model).join() + ')');
  await st.close();

  // ---------- C. a newer model that turns the page's request down ----------
  const no7 = (b) => b.model === 'claude-fable-7' ? { status: 400, type: 'invalid_request_error', message: 'output_config.effort: Input should be \'low\', \'medium\' or \'high\'' } : null;
  st = await phone({ list: SEVEN }, no7);
  await st.open();
  assert(/^Now on Claude Fable 7/.test(await st.text('#statusText')), 'C. Fable 7 is in the list: taken (' + await st.text('#statusText') + ')');
  got = await st.start();
  assert(got.length === 2 && got[0].model === 'claude-fable-7' && got[0].refused === 400 && got[1].model === 'claude-fable-5-2' && !got[1].refused && got[1].effort === 'max', 'C. Fable 7 turns the request down (400): the same picture goes to claude-fable-5-2 at max (' + models(st) + ')');
  assert(got[1].at - got[0].at < 1500, 'C. … at once (' + (got[1].at - got[0].at) + ' ms later)');
  assert((await st.key()) === 'B' && !/failed/.test(await st.text('#answerMeta')), 'C. the answer is on screen — no failed request shown (' + await st.text('#answerMeta') + ')');
  assert(/^Claude Fable 7 turned the request down \(HTTP 400 · output_config\.effort: Input should be[^)]*\) — answering with Claude Fable 5\.2 instead\. It is tried again the next time the page opens\.$/.test(await st.text('#banner')), 'C. a note says what happened: ' + await st.text('#banner'));
  got = await st.ask('q2');
  assert(got.length === 1 && got[0].model === 'claude-fable-5-2' && (await st.key()) === 'C', 'C. the next question goes straight to claude-fable-5-2 (' + models(st) + ')');
  se = await st.settings();
  assert(/^Claude Fable 5\.2 at max · Claude Fable 7 turned the page's request down \(HTTP 400 · [^)]+\), tried again on the next open · Anthropic lists Claude Fable 7 as the newest Fable for this key/.test(se.now) && se.model === 'claude-fable-5-2', 'C. Settings keeps the reason: ' + se.now);
  assert(/in line: claude-fable-7 → claude-fable-5-2 → claude-fable-5-1/.test(se.diag), 'C. the diagnostics show the line of models');
  st.main.length = 0;
  await st.open(true);
  got = await st.start();
  assert(got.length === 2 && got[0].model === 'claude-fable-7' && got[0].refused && got[1].model === 'claude-fable-5-2', 'C. the next open tries Fable 7 afresh, and steps back again (' + models(st) + ')');
  // Fable 7 fixed on Anthropic's side: it answers; after that a 400 is the request's trouble, not the model's
  st.refuse = () => null; st.main.length = 0;
  await st.open(true);
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-7' && (await st.stored()).modelOk['claude-fable-7'], 'C. once Fable 7 takes the request it answers (' + models(st) + ') and is remembered as working');
  st.refuse = () => ({ status: 400, type: 'invalid_request_error', message: 'messages.0.content.4.image.source.base64: image exceeds 5 MB maximum' }); st.main.length = 0;
  await st.go('q2'); await until(() => st.main.length >= 1, 15000); await WAIT(1200);
  assert(st.main.length === 1 && st.main[0].model === 'claude-fable-7' && /failed after .*image exceeds 5 MB/.test(await st.text('#banner')), 'C. a 400 from a model that has answered before is reported as it is — one request, no stepping back (' + models(st) + ' · ' + (await st.text('#banner')).slice(0, 80) + ')');
  assert((await st.settings()).model === 'claude-fable-7', 'C. … and Fable 7 stays in force');
  await st.close();

  // ---------- D. a key that cannot use the built-in model, and no list to go by ----------
  st = await phone({ status: 500 }, (b) => b.model === 'claude-fable-5-2' ? { status: 404, type: 'not_found_error', message: 'model: claude-fable-5-2' } : null);
  await st.open();
  got = await st.start();
  assert(got.length === 2 && got[0].model === 'claude-fable-5-2' && got[0].refused === 404 && got[1].model === 'claude-fable-5-1' && got[1].effort === 'max' && (await st.key()) === 'B', 'D. claude-fable-5-2 unknown to this key (404), the list unreachable: claude-fable-5-1 answers, at max (' + models(st) + ')');
  assert(/^Claude Fable 5\.2 turned the request down \(HTTP 404 · model: claude-fable-5-2\) — answering with Claude Fable 5\.1 instead/.test(await st.text('#banner')), 'D. the note: ' + (await st.text('#banner')).slice(0, 110));
  assert(/\$0\.\d{3}/.test(await st.text('#answerMeta')) && !/≈/.test(await st.text('#answerMeta')), 'D. costed at Fable 5.1\'s own price');
  await st.close();
  // the account's own trouble is not the model's
  st = await phone({ list: TODAY }, () => ({ status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' }));
  await st.open();
  await st.page.click('#startBtn'); await until(() => st.main.length >= 1); await WAIT(1500);
  assert(st.main.length === 1 && st.main[0].model === 'claude-fable-5-2' && /failed after .*credit balance is too low/.test(await st.text('#banner')), 'D. no credit: reported as it is — one request, no other model tried (' + models(st) + ')');
  assert((await st.settings()).model === 'claude-fable-5-2' && !/turned the page's request down/.test((await st.settings()).now), 'D. … and the model stays');
  await st.close();
  // a request every model turns down is the request's fault: reported once, the model back where it was
  st = await phone({ list: TODAY }, () => ({ status: 400, type: 'invalid_request_error', message: 'messages.0.content.2.image.source.base64: image exceeds 5 MB maximum' }));
  await st.open();
  await st.page.click('#startBtn'); await until(() => st.main.length >= 2); await WAIT(1500);
  assert(st.main.length === 2 && st.main[0].model === 'claude-fable-5-2' && st.main[1].model === 'claude-fable-5-1' && /failed after .*image exceeds 5 MB/.test(await st.text('#banner')), 'D. a request neither model takes (first use of both): each tried once, then the failure reported (' + models(st) + ')');
  se = await st.settings();
  assert(se.model === 'claude-fable-5-2' && !/turned the page's request down/.test(se.now), 'D. … and the page is back on claude-fable-5-2, nothing held against it: ' + se.now);
  await st.close();

  // ---------- E. a model that does not list max ----------
  st = await phone({ list: EIGHT });
  await st.open();
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-8' && got[0].effort === 'xhigh', 'E. Fable 8 lists no max: asked at xhigh, the deepest it lists (' + got.map((m) => m.model + '@' + m.effort).join() + ')');
  assert(got[0].max_tokens === 16000, 'E. its max_tokens cap from the list is respected (' + got[0].max_tokens + ')');
  se = await st.settings();
  assert(/xhigh is the deepest effort it offers \(max is not on its list\)/.test(se.now) && se.effort === 'xhigh' && (await st.text('#roEffort')) === 'xhigh', 'E. Settings and the footer say xhigh: ' + se.now);
  await st.close();

  // ---------- F. the list arriving while a session runs ----------
  st = await phone({ list: SIX, delay: 8000 });
  await st.open();
  await WAIT(300);
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-5-2' && !st.lists[0].done, 'F. the list not in yet: the session starts on the built-in model (' + models(st) + ')');
  await until(() => st.lists[0].done, 11000); await WAIT(800);
  got = await st.ask('q2');
  assert(got.length === 1 && got[0].model === 'claude-fable-5-2', 'F. the list is in (Fable 6) but the session runs: the model does not change under it (' + models(st) + ')');
  se = await st.settings();
  assert(/^Claude Fable 5\.2 at max · Anthropic lists Claude Fable 6 as the newest Fable for this key \(checked [^)]+\) · it takes over when the session is over/.test(se.now) && se.model === 'claude-fable-5-2', 'F. Settings says the newer model is waiting: ' + se.now);
  assert((await st.stored()).modelSeen.id === 'claude-fable-6', 'F. … and it is remembered already: a page closed mid-session opens on it next time');
  await st.page.click('#startBtn');   // Stop
  await until(async () => /^Now on Claude Fable 6/.test(await st.text('#statusText')), 5000);
  assert(/^Now on Claude Fable 6 — the newest Fable, taken automatically$/.test(await st.text('#statusText')), 'F. at Stop the newer model takes over (' + await st.text('#statusText') + ')');
  await st.go('q3');
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-6' && got[0].effort === 'max' && st.lists.length === 1, 'F. the next session answers from claude-fable-6 at max; the list was asked once (' + models(st) + ')');
  await st.close();

  // ---------- G. a model typed into Settings ----------
  st = await phone({ list: SIX });
  await st.open();
  await st.page.click('#settingsBtn'); await WAIT(250);
  assert((await st.val('model')) === 'claude-fable-6', 'G. Settings opens on the model in force (claude-fable-6)');
  await st.page.fill('#model', 'claude-opus-5-5'); await st.page.click('#saveBtn'); await WAIT(250);
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-opus-5-5' && got[0].effort === 'max', 'G. a model typed into Settings is used as typed (' + got.map((m) => m.model + '@' + m.effort).join() + ')');
  se = await st.settings();
  assert(/^Claude Opus 5\.5 at max · typed in here, used until the page is closed/.test(se.now), 'G. Settings: ' + se.now);
  st.refuse = () => ({ status: 404, type: 'not_found_error', message: 'model: claude-opus-5-5' }); st.main.length = 0;
  await st.go('q2'); await until(() => st.main.length >= 1, 15000); await WAIT(1200);
  assert(st.main.length === 1 && st.main[0].model === 'claude-opus-5-5' && /failed after .*model: claude-opus-5-5/.test(await st.text('#banner')), 'G. a typed model that fails is reported, not stepped away from (' + models(st) + ')');
  await st.page.click('#startBtn'); await WAIT(400);   // Stop (the failed picture would otherwise be sent again on the next tick)
  st.refuse = () => null; st.main.length = 0;
  await st.page.click('#settingsBtn'); await WAIT(250);
  await st.page.fill('#model', ''); await st.page.click('#saveBtn'); await WAIT(250);
  await st.go('q3');
  got = await st.start();
  assert(got.length === 1 && got[0].model === 'claude-fable-6' && got[0].effort === 'max', 'G. the field emptied: automatic again — the newest Fable, at max (' + models(st) + ')');
  await st.close();

  assert(allErrors.length === 0, 'no page errors' + (allErrors.length ? ': ' + allErrors.slice(0, 3).join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'MODEL E2E FAILED' : 'MODEL E2E PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
