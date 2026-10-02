// Needs playwright. Run: node test/drive-renewal.e2e.js
// Checks the hands-free Drive token renewal: the page opens a hidden frame to Google, the frame redirects back
// to the page with a token in the fragment, the framed copy of the page hands it to the parent and stops.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' });
  fs.createReadStream(p).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await ctx.addInitScript(() => {
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, saveKey: true, key: 'sk-ant-test', driveOn: true, driveRedirectOk: true }));
    localStorage.setItem('lensloop.drive', JSON.stringify({ token: 'OLD', exp: Date.now() + 4 * 60 * 1000 }));
  });
  let authHits = 0, framedLoads = 0;
  await page.route('https://accounts.google.com/**', async (route) => {
    authHits++;
    const u = new URL(route.request().url());
    const ok = u.searchParams.get('prompt') === 'none' && u.searchParams.get('response_type') === 'token' && u.searchParams.get('redirect_uri') === base;
    console.log('auth request:', ok ? 'well-formed' : 'UNEXPECTED ' + u.search);
    await route.fulfill({ status: 302, headers: { location: base + '#access_token=NEW&token_type=Bearer&expires_in=3599&state=' + encodeURIComponent(u.searchParams.get('state')) } });
  });
  await page.route('https://www.googleapis.com/**', (route) => route.fulfill({ status: 500, body: '{}' }));
  page.on('frameattached', () => framedLoads++);
  await page.goto(base + 'index.html');
  await page.waitForTimeout(32000);   // the renewal check runs every 30 s
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lensloop.drive')));
  const frames = page.frames().length;
  await browser.close(); server.close();
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  assert(authHits === 1, 'exactly one silent auth request (' + authHits + ')');
  assert(framedLoads >= 1, 'a hidden frame was opened');
  assert(stored && stored.token === 'NEW' && stored.exp > Date.now() + 50 * 60 * 1000, 'token renewed and stored (' + JSON.stringify(stored) + ')');
  assert(frames === 1, 'the frame was removed afterwards (' + frames + ' frame(s) left)');
  console.log(process.exitCode ? 'DRIVE RENEWAL FAILED' : 'DRIVE RENEWAL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
