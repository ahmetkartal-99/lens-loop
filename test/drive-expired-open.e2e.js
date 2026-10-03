// Needs playwright. Run: node test/drive-expired-open.e2e.js
// The phone case the other Drive tests miss: the app is opened hours after it was last used, so the access token
// died long ago while the refresh token is still good. Then the helper renews the sign-in without a word on screen —
// no "sign-in has expired" banner racing ahead of it, nothing left standing once it succeeds; a renewal that fails
// for a passing reason is retried by itself (on a backoff, and at once when the network comes back); a dead refresh
// token, in the shape Google really sends it, asks for one fresh Connect; and with no automatic way back at all the
// banner still asks for a tap.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript' });
  fs.createReadStream(p).pipe(res);
});
const HELPER = 'https://script.google.com/macros/s/TEST/exec';
const HOUR = 3600 * 1000;
const DRIVE_TEXT = /drive|sign-in|helper|expired|reconnect/i;   // any banner about the Drive sign-in
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, base, seed, onHelper) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const calls = []; let authHits = 0;
  await page.route(HELPER, (route) => {
    const p = JSON.parse(route.request().postData() || '{}'); calls.push({ p, at: Date.now() });
    return onHelper(route, p, calls.length);
  });
  await page.route('https://www.googleapis.com/**', (route) => json(route, { files: [] }));
  await page.route('https://accounts.google.com/**', (route) => { authHits++; return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>google</body></html>' }); });
  await ctx.addInitScript((sd) => {
    if (localStorage.getItem('lensloop.test.seeded')) return;   // seed once; the page's own saves must survive
    localStorage.setItem('lensloop.test.seeded', '1');
    localStorage.setItem('lensloop.settings', JSON.stringify(sd.settings));
    localStorage.setItem('lensloop.drive', JSON.stringify(sd.drive));
  }, seed);
  await page.goto(base + 'index.html#key=sk-ant-test');
  return {
    ctx, page, errors, calls, authHits: () => authHits,
    banner: () => page.evaluate(() => { const b = document.getElementById('banner'); return b && !b.hidden ? b.textContent : ''; }),
    row: () => page.evaluate(() => document.getElementById('driveStatus').textContent),
    stored: () => page.evaluate(() => JSON.parse(localStorage.getItem('lensloop.drive') || 'null')),
  };
}
const signedInBefore = (drive, extra) => ({
  settings: Object.assign({ v: 3, saveKey: true, key: 'sk-ant-test', driveOn: true, driveRedirectOk: true, driveHelper: HELPER }, extra || {}),
  drive,
});
const noErrors = (tag, s) => assert(s.errors.length === 0, tag + ': no page errors' + (s.errors.length ? ': ' + s.errors.join(' | ') : ''));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();

  // A. Opened three hours later. The helper takes a moment to wake (like an Apps Script) and renews the sign-in.
  {
    const s = await open(browser, base, signedInBefore({ token: 'OLD', exp: Date.now() - 3 * HOUR, refresh: 'RT1' }), async (route, p) => {
      await sleep(1200);
      return json(route, p.refresh_token === 'RT1' ? { access_token: 'AT2', expires_in: 3599 } : { error: 'invalid_grant' });
    });
    await s.page.waitForTimeout(400);
    const during = await s.banner();
    assert(!DRIVE_TEXT.test(during), 'A: no "expired" banner while the helper renews (' + (during || 'no banner') + ')');
    await s.page.waitForTimeout(2600);
    const st = await s.stored(), after = await s.banner();
    assert(st && st.token === 'AT2' && st.refresh === 'RT1' && st.exp > Date.now() + 50 * 60 * 1000, 'A: renewed through the helper, refresh token kept (' + JSON.stringify(st) + ')');
    assert(!DRIVE_TEXT.test(after), 'A: nothing on screen asks for a reconnect once renewed (' + (after || 'no banner') + ')');
    assert(/for good/.test(await s.row()), 'A: the Drive row says connected for good');
    assert(s.calls.length === 1 && s.authHits() === 0, 'A: one helper call, no bounce through Google (' + s.calls.length + ' / ' + s.authHits() + ')');
    noErrors('A', s);
    await s.ctx.close();
  }

  // B. Opened while the phone's network is still waking: the first two renewals fail on the way, the third goes through.
  {
    const s = await open(browser, base, signedInBefore({ token: 'OLD', exp: Date.now() - 3 * HOUR, refresh: 'RT1' }), (route, p, n) =>
      n <= 2 ? route.abort('internetdisconnected') : json(route, { access_token: 'AT3', expires_in: 3599 }));
    await s.page.waitForTimeout(1500);
    const first = await s.banner(), row1 = await s.row();
    assert(s.calls.length === 1, 'B: the helper was tried once at open (' + s.calls.length + ')');
    assert(!DRIVE_TEXT.test(first), 'B: one passing failure puts nothing on screen — no "expired" (' + (first || 'no banner') + ')');
    assert(/again by itself/i.test(row1), 'B: the Drive row says it is trying again by itself (' + row1 + ')');
    for (let i = 0; i < 30 && s.calls.length < 2; i++) await s.page.waitForTimeout(1000);
    assert(s.calls.length === 2, 'B: a second try came by itself (' + s.calls.length + ' call(s))');
    if (s.calls.length >= 2) assert(s.calls[1].at - s.calls[0].at >= 14000, 'B: on a backoff, not a hammer (' + ((s.calls[1].at - s.calls[0].at) / 1000).toFixed(1) + ' s apart)');
    await s.page.waitForTimeout(500);
    const second = await s.banner();
    assert(/again by itself/i.test(second) && !/expired/i.test(second), 'B: still failing, the banner says it keeps trying — not "expired" (' + (second || 'no banner') + ')');
    await s.page.evaluate(() => window.dispatchEvent(new Event('online')));   // the network is back
    await s.page.waitForTimeout(1000);
    const st = await s.stored(), after = await s.banner();
    assert(s.calls.length === 3, 'B: the network coming back retried at once (' + s.calls.length + ' call(s))');
    assert(st && st.token === 'AT3' && st.refresh === 'RT1', 'B: renewed, refresh token kept (' + JSON.stringify(st) + ')');
    assert(!DRIVE_TEXT.test(after), 'B: the failure banner cleared itself once renewed (' + (after || 'no banner') + ')');
    noErrors('B', s);
    await s.ctx.close();
  }

  // C. The refresh token really is dead (e.g. issued while the Google app was in "Testing"), in the shape Google sends.
  {
    const s = await open(browser, base, signedInBefore({ token: 'OLD', exp: Date.now() - 3 * HOUR, refresh: 'RT_DEAD' }), (route) =>
      json(route, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    await s.page.waitForTimeout(1500);
    const b = await s.banner(), st = await s.stored();
    assert(/retired the permanent sign-in/i.test(b), 'C: says plainly that one fresh Connect is needed (' + (b || 'no banner') + ')');
    assert(st && !st.refresh, 'C: the dead refresh token is dropped (' + JSON.stringify(st) + ')');
    assert(await s.page.evaluate(() => document.getElementById('banner').dataset.action === 'drive'), 'C: a tap on that banner starts the Connect');
    await s.page.waitForTimeout(17000);   // past the first retry window
    assert(s.calls.length === 1, 'C: the dead token is not retried (' + s.calls.length + ' call(s))');
    noErrors('C', s);
    await s.ctx.close();
  }

  // D. No refresh token and the silent Google bounce already tried a minute ago: no way back without a tap, so ask.
  {
    const s = await open(browser, base, signedInBefore({ token: 'OLD', exp: Date.now() - 3 * HOUR, refresh: '' }, { driveSilentAt: Date.now() - 60 * 1000 }), (route) =>
      json(route, { error: 'bad_request' }));
    await s.page.waitForTimeout(800);
    const b = await s.banner();
    assert(/expired/i.test(b), 'D: with no automatic way back the banner still asks for a tap (' + (b || 'no banner') + ')');
    assert(s.calls.length === 0 && s.authHits() === 0, 'D: no helper call, no bounce (' + s.calls.length + ' / ' + s.authHits() + ')');
    noErrors('D', s);
    await s.ctx.close();
  }

  await browser.close(); server.close();
  console.log(process.exitCode ? 'DRIVE EXPIRED-OPEN FAILED' : 'DRIVE EXPIRED-OPEN PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
