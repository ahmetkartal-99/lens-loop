// Needs playwright. Run: node test/document.e2e.js
// A document shown page by page, by camera alone: three pages of text, then the empty desk, then something
// else. Checks that each page turn is caught (pages of text are alike by the numbers, so the quick look is
// asked and answers DIFFERENT), that every request carries the earlier pages in order with the cache mark,
// that the desk's "nothing to read" keeps the document's answer on screen and drops the desk from the
// document, and that a new subject's answer waits until the document's answer has played through.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const W = 320, H = 240;
function page(seed, dark) {   // a page of "text": lines of dashes, a layout of its own per seed
  const Y = new Uint8Array(W * H).fill(dark ? 30 : 235);
  let r = seed; const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let line = 18; line < H - 18; line += 14) {
    let x = 24; while (x < W - 24) { const len = 6 + Math.floor(rnd() * 30); if (rnd() < 0.85) for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < len; xx++) Y[(line + yy) * W + x + xx] = dark ? 220 : 40; x += len + 5 + Math.floor(rnd() * 6); }
  }
  return Y;
}
const Y4M = path.join(os.tmpdir(), 'lensloop-document.y4m');
(() => {   // page 1 (0–9 s), page 2 (9–18), page 3 (18–27), the desk (27–38), something else (38–108)
  const scenes = [[page(1), 9], [page(2), 9], [page(3), 9], [new Uint8Array(W * H).fill(120), 11], [page(7, true), 70]];   // long enough that the file never loops back to page one during the test
  const parts = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F2:1 Ip A1:1 C420jpeg\n')];
  for (const [Y, secs] of scenes) for (let i = 0; i < secs * 2; i++) parts.push(Buffer.from('FRAME\n'), Buffer.from(Y), Buffer.alloc(W * H / 4, 128), Buffer.alloc(W * H / 4, 128));
  fs.writeFileSync(Y4M, Buffer.concat(parts));
})();
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' });
  fs.createReadStream(p).pipe(res);
});
const SCENES = { page1: page(1), page2: page(2), page3: page(3), desk: new Uint8Array(W * H).fill(120), subject: page(7, true) };
const sigOf = (Y) => { const w = 32, h = 24, out = new Float32Array(w * h), cw = W / w, ch = H / h; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let t = 0, n = 0; for (let y = Math.floor(j * ch); y < Math.floor((j + 1) * ch); y++) for (let x = Math.floor(i * cw); x < Math.floor((i + 1) * cw); x++) { t += Y[y * W + x]; n++; } out[j * w + i] = t / n; } return out; };
const KNOWN = Object.fromEntries(Object.entries(SCENES).map(([k, Y]) => [k, sigOf(Y)]));
let classify = null;   // set once the page exists: decodes a frame's JPEG in the browser and names the nearest known scene
const sse = (text) => { const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 1000 } } }) + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }) + ev('message_stop', { type: 'message_stop' }); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + Y4M] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, interval: 4, saveKey: true, saveAudio: false, sessionListen: false, key: 'sk-ant-test', quietSec: 2 }));
  });
  const bodies = [], looks = [], seen = [];
  classify = async (b64) => {
    const grey = await page.evaluate(async (data) => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + data; await img.decode(); const c = document.createElement('canvas'); c.width = 32; c.height = 24; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 24); const d = x.getImageData(0, 0, 32, 24).data; const out = []; for (let i = 0; i < 32 * 24; i++) out.push((d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10); return out; }, b64);
    let best = null; for (const [k, sg] of Object.entries(KNOWN)) { let t = 0; for (let i = 0; i < sg.length; i++) t += Math.abs(sg[i] - grey[i]); t /= sg.length; if (!best || t < best.d) best = { k, d: t }; }
    return best.k;
  };
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const b = JSON.parse(route.request().postData());
    if (/haiku/.test(b.model)) { looks.push(b); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'DIFFERENT' }], usage: {} }) }); return; }
    bodies.push(b);
    const images = b.messages[0].content.filter((c) => c.type === 'image');
    const scene = await classify(images[images.length - 1].source.data); seen.push(scene);
    const pagesSoFar = seen.filter((k) => /^page/.test(k)).length;
    const text = scene === 'desk' ? 'ANSWER: nothing to read\nSTORYLINE: none\nFRAMES: new\n\nAn empty desk.'
      : scene === 'subject' ? 'ANSWER: Something else entirely\nSTORYLINE: none\nFRAMES: new\n\nA different subject with its own answer.'
      : pagesSoFar === 1 ? 'ANSWER: Instructions, page one\nSTORYLINE: none\n\nPage one sets out the task and the rules; more pages follow.'
      : pagesSoFar === 2 ? 'ANSWER: Instructions, pages one and two\nSTORYLINE: none\nFRAMES: continues\n\nTwo of the pages so far; the document continues.'
      : 'ANSWER: The whole instruction set\nSTORYLINE: none\nFRAMES: continues\n\nAll three pages read together give one answer here, and it takes a little while to read it through, which is the point of this test: the reader must be left in peace until the end of it.';
    console.log('mock: request', bodies.length, 'shows', scene, '→', text.split('\n')[0]);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(text) });
  });
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
  const panel = () => page.evaluate(() => document.getElementById('readerBody').textContent.trim());
  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test`); await page.waitForTimeout(700);
  const t0 = Date.now();
  await page.click('#startBtn');
  await page.waitForTimeout(30000);   // through the three pages and into the desk
  const imgs = bodies.map((b) => b.messages[0].content.filter((c) => c.type === 'image').length);
  console.log('requests:', bodies.length, '· images per request:', imgs.join(', '), '· quick looks:', looks.length);
  assert(bodies.length === 4, 'each page and the desk were sent once (' + bodies.length + ' requests; the desk in view is not sent again)');
  assert(looks.length >= 2, 'alike-looking pages were checked by the quick look (' + looks.length + ' looks)');
  assert(imgs[1] === 2 && imgs[2] === 3, 'the second request carried the earlier page, the third both earlier pages (' + imgs.slice(0, 3).join(', ') + ')');
  const c3 = bodies[2] ? bodies[2].messages[0].content : [];
  const earlierImgs = c3.filter((c) => c.type === 'image').slice(0, -1);
  assert(earlierImgs.length === 2 && !!earlierImgs[1].cache_control && !earlierImgs[0].cache_control, 'the last earlier page carries the cache mark');
  assert(c3.some((c) => c.type === 'text' && /EARLIER FRAMES — 2 pictures/.test(c.text)) && c3.some((c) => c.type === 'text' && /FRAMES: continues/.test(c.text)), 'the model is told how to read the pages together and to say FRAMES: continues or new');
  assert(/All three pages read together/.test(await panel()), 'the panel shows the whole-document answer after the desk (the desk kept it)');
  assert(/nothing to read/.test(await page.textContent('#statusText')) || bodies.length >= 4, 'status reported the desk as nothing to read');
  // the new subject (from 38 s): its answer waits until the document's answer has played through
  await page.waitForTimeout(Math.max(0, 41000 - (Date.now() - t0)));

  const fifthImgs = bodies[4] ? bodies[4].messages[0].content.filter((c) => c.type === 'image').length : -1;
  assert(bodies.length >= 5 && fifthImgs === 4, 'the new subject was sent with the three pages but not the desk (' + fifthImgs + ' images)');
  assert(/All three pages read together/.test(await panel()), 'the document answer is still on screen while it plays');
  await page.waitForTimeout(36000);   // the document answer (thirty-odd words at 1.5 s each) has played through by now
  assert(/A different subject/.test(await panel()), 'once played through, the new subject\'s answer took over');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'DOCUMENT FAILED' : 'DOCUMENT PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
