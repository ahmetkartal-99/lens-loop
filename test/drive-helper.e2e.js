// Needs playwright. Run: node test/drive-helper.e2e.js
// With a Drive helper set, the sign-in asks Google for a code with offline access, the page redeems the code
// through the helper and keeps the refresh token, and the access token is renewed through the helper before
// it runs out — no bounce through Google, no hidden frame, nothing to tap.
const { chromium, devices } = require('playwright');
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
  const HELPER = 'https://script.google.com/macros/s/TEST/exec';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const helperCalls = [];
  await page.route(HELPER, (route) => {
    const p = JSON.parse(route.request().postData() || '{}'); helperCalls.push(p);
    const body = p.code ? { access_token: 'AT1', expires_in: 3599, refresh_token: 'RT1' } : p.refresh_token === 'RT1' ? { access_token: 'AT2', expires_in: 3599 } : { error: 'invalid_grant' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://www.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"files":[]}' }));
  let authUrl = '';
  await page.route('https://accounts.google.com/**', (route) => { authUrl = route.request().url(); return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>google</body></html>' }); });
  await ctx.addInitScript((helper) => {
    if (!localStorage.getItem('lensloop.settings')) localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, saveKey: true, key: 'sk-ant-test', driveHelper: helper }));   // seed once; the page's own saves must survive reloads
  }, HELPER);
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

  // 1. Connect asks Google for a code with offline access
  await page.goto(base + 'index.html#key=sk-ant-test'); await page.waitForTimeout(600);
  await page.click('#storiesBtn'); await page.waitForTimeout(200);
  await page.click('#driveConnect'); await page.waitForTimeout(800);
  const u = new URL(authUrl);
  assert(u.searchParams.get('response_type') === 'code' && u.searchParams.get('access_type') === 'offline' && u.searchParams.get('prompt') === 'consent', 'the sign-in asks for a code with offline access and consent');
  const state = u.searchParams.get('state');
  assert(u.searchParams.get('redirect_uri') === base, 'redirect comes back to the page (' + u.searchParams.get('redirect_uri') + ')');

  // 2. Google sends the page back with a code: the helper redeems it, the refresh token is kept
  await page.goto(base + 'index.html?code=CODE123&state=' + encodeURIComponent(state) + '#key=sk-ant-test'); await page.waitForTimeout(1500);
  assert(helperCalls.length === 1 && helperCalls[0].code === 'CODE123' && helperCalls[0].redirect_uri === base, 'the code went to the helper with the page address');
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lensloop.drive')));
  assert(stored && stored.token === 'AT1' && stored.refresh === 'RT1', 'access and refresh tokens stored (' + JSON.stringify(stored) + ')');
  assert(!/code=/.test(await page.evaluate(() => location.href)) && /#key=sk-ant-test/.test(await page.evaluate(() => location.href)), 'the code is gone from the address, the key link is back');

  // 3. The access token nears its hour: renewed through the helper, no bounce, no frame
  await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('lensloop.drive')); t.exp = Date.now() + 4 * 60 * 1000; localStorage.setItem('lensloop.drive', JSON.stringify(t)); });
  await page.reload(); await page.waitForTimeout(32000);
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lensloop.drive')));
  assert(helperCalls.some((c) => c.refresh_token === 'RT1'), 'the helper was asked to renew');
  assert(stored && stored.token === 'AT2' && stored.exp > Date.now() + 50 * 60 * 1000 && stored.refresh === 'RT1', 'a fresh access token is stored, the refresh token kept (' + JSON.stringify(stored) + ')');
  assert(page.frames().length === 1 && !/accounts\.google\.com/.test(await page.evaluate(() => location.href)), 'no hidden frame and no bounce through Google');
  await page.click('#storiesBtn'); await page.waitForTimeout(200);
  assert(/for good/.test(await page.textContent('#driveStatus')), 'the sheet says the sign-in is kept for good');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'DRIVE HELPER FAILED' : 'DRIVE HELPER PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
