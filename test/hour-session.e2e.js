// Needs playwright. Run: node test/hour-session.e2e.js
// An hour of talking, compressed: ~10,000 words of dictation stream through the real page (ElevenLabs path:
// the token endpoint and the realtime socket are mocked, the AudioWorklet, microphone and recorder are real) in about half a
// minute while the camera loop runs and audio parts are recorded. Checks that every word is in the draft and
// the saved storyline, that the live transcript rides along in the requests (frozen blocks, one cache mark),
// that a question asked during the session carries it, that audio parts land in IndexedDB, and that after a
// reload a question still has the whole storyline in its prompt.
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
const sse = (text) => { const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 1000 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }) + ev('message_stop', { type: 'message_stop' }); };
const SENTENCES = 360;   // × 25 words ≈ 9,000 words ≈ an hour of talking
const sentence = (i) => `Minute ${Math.floor(i / 6)} note ${i}: the toll keeper takes one remembered day from every traveller at the river crossing and writes it into the eel skin ledger before the ferry leaves.`;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, url = `http://127.0.0.1:${port}/index.html#key=sk-ant-test`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 5, saveKey: true, saveAudio: true, audioSegSec: 5, key: 'sk-ant-test', sttKey: 'xi-test', quietSec: 2 }));
  });
  // the ElevenLabs side: a token for every connection, and a realtime socket the test speaks through
  await page.route('https://api.elevenlabs.io/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"t"}' }));
  let sock = null, sockets = 0;
  await page.routeWebSocket(/api\.elevenlabs\.io/, (ws) => { sock = ws; sockets++; ws.onMessage(() => {}); ws.onClose(() => { if (sock === ws) sock = null; }); });
  const say = async (text) => { for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(100); if (!sock) throw new Error('no socket'); sock.send(JSON.stringify({ message_type: 'committed_transcript', text })); };
  const keep = setInterval(() => { try { sock && sock.send(JSON.stringify({ message_type: 'keepalive' })); } catch (e) {} }, 2500);
  const bodies = [];
  await page.route('https://api.anthropic.com/v1/messages', (route) => {
    const b = JSON.parse(route.request().postData());
    if (/haiku/.test(b.model)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'DIFFERENT' }], usage: {} }) });
    bodies.push(b);
    const isDigest = /Transcript of one recorded session/.test(JSON.stringify(b.messages));
    return route.fulfill({ status: 200, contentType: isDigest ? 'application/json' : 'text/event-stream',
      body: isDigest ? JSON.stringify({ content: [{ type: 'text', text: 'TITLE: The eel skin ledger\nSUMMARY: The keeper takes a day from every traveller.\nKEYS: toll keeper, eel skin ledger, river crossing' }], usage: {} })
        : sse('ANSWER: One remembered day\nSTORYLINE: Current session\n\nThe keeper takes one remembered day from every traveller, as the session says.') });
  });
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
  const t0 = Date.now();
  await page.goto(url); await page.waitForTimeout(700);
  await page.click('#startBtn');
  await page.waitForTimeout(1500);
  // an hour of talking in ~25 s
  for (let i = 0; i < SENTENCES; i += 4) {
    for (const k of [0, 1, 2, 3]) await say(sentence(i + k));
    await page.waitForTimeout(200);
  }
  const spoken = SENTENCES * sentence(0).split(/\s+/).length;
  console.log('dictated', spoken, 'words in', Math.round((Date.now() - t0) / 1000), 's');
  // the draft on the phone holds every word while the session runs
  const draft = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lensloop.draft') || 'null'); return d ? d.finals.map((f) => f.text).join(' ').split(/\s+/).length : 0; });
  assert(Math.abs(draft - spoken) <= 2, 'draft holds every word while recording (' + draft + ' of ' + spoken + ')');
  // a question asked mid-session carries the whole session so far
  await page.waitForTimeout(2500);   // past the quiet spell, so the camera loop is free again
  const before = bodies.length;
  await say('Lens, what does the keeper write into the ledger?');
  await page.waitForTimeout(1500);
  const q = bodies.slice(before).find((b) => /Spoken question/.test(JSON.stringify(b.messages)));
  assert(!!q, 'the spoken question went out as a request');
  if (q) {
    const sys = q.system.map((b) => b.text).join('\n') + '\n' + q.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const live = sys.indexOf('CURRENT SESSION');
    assert(live > 0, 'its prompt carries the live session');
    assert(sys.includes(sentence(0)) && sys.includes(sentence(SENTENCES - 1)), 'first and last sentences of the hour are in the prompt');
    const marks = q.system.filter((b) => b.cache_control).length, frozen = q.system.filter((b) => /^Minute \d+ note/.test(b.text)).length;
    assert(frozen >= 8 && marks === 1, 'the hour went in as ' + frozen + ' frozen blocks with one cache mark (' + marks + ')');
    assert(sys.length < 100000, 'the whole prompt stays well inside the budget (' + sys.length + ' chars)');
  }
  // audio parts are recorded in pieces as it goes
  await page.waitForTimeout(6000);
  const parts = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lensloop', 3); r.onsuccess = () => { const g = r.result.transaction('audio', 'readonly').objectStore('audio').getAll(); g.onsuccess = () => res(g.result.map((p) => ({ part: p.part, bytes: p.blob ? p.blob.size : 0, secs: p.seconds }))); }; r.onerror = () => res([]); }));
  assert(parts.length >= 3 && parts.every((p) => p.bytes > 0), 'audio parts saved on the phone as the session runs (' + parts.length + ' parts, ' + parts.map((p) => p.bytes).join('/') + ' bytes)');
  // stop: the storyline is saved with every word, titled by the digest
  if (await page.isVisible('#readerClose')) { try { await page.click('#readerClose', { timeout: 2000 }); } catch (e) {} }
  await page.click('#startBtn');
  await page.waitForTimeout(3000);
  const saved = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lensloop', 3); r.onsuccess = () => { const g = r.result.transaction('storylines', 'readonly').objectStore('storylines').getAll(); g.onsuccess = () => res(g.result.map((st) => ({ title: st.title, words: st.words, textWords: st.text.split(/\s+/).length, summary: st.summary, visuals: (st.visuals || []).length }))); }; r.onerror = () => res([]); }));
  console.log('saved:', JSON.stringify(saved));
  assert(saved.length === 1 && Math.abs(saved[0].textWords - spoken) <= 12, 'the saved storyline holds the whole hour (' + (saved[0] && saved[0].textWords) + ' words; a question sentence is left out by design)');
  assert(saved[0] && saved[0].title === 'The eel skin ledger' && !!saved[0].summary, 'title and summary written');
  // after a reload, a question still has the whole storyline in its prompt
  await page.reload(); await page.waitForTimeout(1200);
  const before2 = bodies.length;
  await page.click('#askBtn'); await page.waitForTimeout(800);
  await say('What does the keeper take from every traveller?');
  await page.waitForTimeout(3000);   // the question goes out 1.2 s after the last sentence
  const q2 = bodies.slice(before2).find((b) => /Spoken question/.test(JSON.stringify(b.messages)));
  assert(!!q2, 'a question after the session went out');
  if (q2) {
    const sys = q2.system.map((b) => b.text).join('\n') + '\n' + q2.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    assert(/INDEX OF SAVED STORYLINES \(1; full text included for 1\)/.test(sys), 'the saved storyline is in the prompt in full');
    assert(sys.includes(sentence(5)) && sys.includes(sentence(SENTENCES - 2)), 'its text is complete in the prompt');
  }
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log('ElevenLabs sockets opened during the run:', sockets);
  clearInterval(keep);
  await browser.close(); server.close();
  console.log(process.exitCode ? 'HOUR SESSION FAILED' : 'HOUR SESSION PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
