// Needs playwright. Run: node test/fresh-build.e2e.js
// The page reloads itself once when the server has a newer build, and never loops.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let hits = 0;
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(p, 'utf8');
  if (p.endsWith('index.html')) { hits++; if (hits > 1) body = body.replace(/const BUILD = '[^']+'/, "const BUILD = 'NEWER'"); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/javascript', 'cache-control': 'max-age=600' });
  res.end(body);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html#key=sk-ant-test`);
  await page.waitForTimeout(6000);
  await page.click('#settingsBtn'); await page.waitForTimeout(200);
  const stamp = await page.textContent('#buildStamp');
  console.log('index requests:', hits, '| running build:', stamp, '| hash kept:', await page.evaluate(() => location.hash), '| errors:', errors.length);
  const ok = hits === 4 && /NEWER/.test(stamp) && errors.length === 0;
  console.log(ok ? 'FRESH-BUILD PASSED' : 'FRESH-BUILD FAILED');
  await browser.close(); server.close();
})();
