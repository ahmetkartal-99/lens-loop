// Needs playwright. Run: node test/drive-vanished.e2e.js
// Files the app made can vanish from Drive — deleted or trashed by hand, or made under another account — while the
// phone still remembers their addresses. Every sync then hit "File not found" on the first one and gave up the whole
// sync ("Sync failed: Drive error 404 …"). Now a remembered address the Drive listing lacks is checked directly and,
// when the file is really gone, forgotten and the storyline copied afresh; an update that still meets "not found"
// (a listing a moment behind) makes a new copy on the spot; one storyline's trouble never holds back the others.
// An in-memory Drive stands in for Google's.
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
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

// ---- a small Drive: files by id, a listing that can lag behind, uploads in Google's multipart shape ----
const drv = new Map();   // id -> { id, name, mimeType, parents, appProperties, trashed, content }
const ghosts = new Set();   // ids a lagging listing still shows although the file is gone
const hits = [];   // every request: "METHOD what id"
let seq = 0;
const put = (f) => { drv.set(f.id, Object.assign({ trashed: false, parents: [], appProperties: {}, content: '' }, f)); };
const notFound = (route, id) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 404, message: 'File not found: ' + id + '.', errors: [{ message: 'File not found: ' + id + '.', domain: 'global', reason: 'notFound' }] } }) });
const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
function parts(body) {   // multipart/related: --boundary, the JSON metadata, --boundary, the content, --boundary--
  const boundary = body.slice(2, body.indexOf('\r\n'));
  const [meta, content] = body.split('--' + boundary).slice(1, 3).map((seg) => seg.slice(seg.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
  return { meta: JSON.parse(meta), content };
}
async function driveRoute(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method();
  const upload = u.pathname.startsWith('/upload/drive/v3/files');
  const id = decodeURIComponent((u.pathname.match(/\/files\/([^/]+)$/) || [])[1] || '');
  if (m === 'GET' && !id) {   // a listing
    const q = u.searchParams.get('q') || '';
    hits.push('LIST ' + (q.includes('folder') ? 'folder' : (q.match(/value='([^']+)'/) || [])[1]));
    if (q.includes("mimeType='application/vnd.google-apps.folder'")) return ok(route, { files: [...drv.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && !f.trashed).map((f) => ({ id: f.id })) });
    const parent = (q.match(/'([^']+)' in parents/) || [])[1], kind = (q.match(/value='([^']+)'/) || [])[1];
    const listed = [...drv.values()].filter((f) => !f.trashed && f.parents.includes(parent) && f.appProperties.lensloop === kind);
    for (const g of ghosts) if (g.kind === kind) listed.push(g);
    return ok(route, { files: listed.map((f) => ({ id: f.id, name: f.name, appProperties: f.appProperties })) });
  }
  if (m === 'GET' && id) {
    const f = drv.get(id);
    hits.push((u.searchParams.get('alt') === 'media' ? 'READ ' : 'GET ') + id);
    if (!f) return notFound(route, id);
    return u.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, contentType: 'application/json', body: f.content }) : ok(route, { id: f.id, trashed: f.trashed });
  }
  if (m === 'POST' && !upload) {   // a folder
    const meta = JSON.parse(req.postData() || '{}'); const nid = 'NEWFOLDER' + (++seq); put(Object.assign({ id: nid }, meta)); hits.push('MKDIR ' + nid);
    return ok(route, { id: nid });
  }
  if (m === 'POST' && upload) {
    const { meta, content } = parts(req.postData() || ''); const nid = 'NEW' + (++seq);
    put({ id: nid, name: meta.name, parents: meta.parents || [], appProperties: meta.appProperties || {}, content }); hits.push('CREATE ' + nid + ' ' + meta.name);
    return ok(route, { id: nid });
  }
  if (m === 'PATCH') {
    const f = drv.get(id); hits.push((upload ? 'UPDATE ' : 'PATCH ') + id);
    if (!f) return notFound(route, id);
    if (upload) { const { meta, content } = parts(req.postData() || ''); Object.assign(f, { name: meta.name || f.name, appProperties: Object.assign({}, f.appProperties, meta.appProperties || {}), content }); }
    else Object.assign(f, JSON.parse(req.postData() || '{}'));
    return ok(route, { id });
  }
  return route.fulfill({ status: 400, body: '{}' });
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // On Drive: the folder; A's two files; C's text file. B's files, C's record and D's record were deleted by hand —
  // D's record still turns up in a listing that lags behind.
  const T = Date.now() - 24 * 3600 * 1000;
  put({ id: 'FOLDER', name: 'Lens Loop', mimeType: 'application/vnd.google-apps.folder' });
  put({ id: 'JA', name: 'Alpha.json', parents: ['FOLDER'], appProperties: { lensloop: '1', storyId: 'sA', updatedAt: String(T) }, content: '{}' });
  put({ id: 'TA', name: 'Alpha.txt', parents: ['FOLDER'], appProperties: { lensloop: 'txt', storyId: 'sA' }, content: 'Alpha' });
  put({ id: 'TC', name: 'Gamma.txt', parents: ['FOLDER'], appProperties: { lensloop: 'txt', storyId: 'sC' }, content: 'old Gamma' });
  ghosts.add({ id: 'JD_GHOST', name: 'Delta.json', kind: '1', appProperties: { lensloop: '1', storyId: 'sD', updatedAt: String(T) } });
  const story = (id, title, extra) => Object.assign({ id, title, createdAt: T, updatedAt: T, seconds: 60, words: 3, text: title + ' transcript', summary: 'A summary.', keys: 'k', use: true, syncedAt: T }, extra);
  const seedStories = [
    story('sA', 'Alpha', { driveId: 'JA', driveTxtId: 'TA' }),                                     // all there
    story('sB', 'Beta', { driveId: 'JB_DEAD', driveTxtId: 'TB_DEAD' }),                            // unchanged, both files gone
    story('sC', 'Gamma', { driveId: 'JC_DEAD', driveTxtId: 'TC', updatedAt: T + 60000 }),          // changed here, its record gone
    story('sD', 'Delta', { driveId: 'JD_GHOST', driveTxtId: null, updatedAt: T + 60000 }),         // the listing still shows a gone record
  ];
  await page.route('https://www.googleapis.com/**', driveRoute);
  await page.route(HELPER, (route) => ok(route, { error: 'invalid_grant' }));
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.route('https://api.anthropic.com/**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await ctx.addInitScript((sd) => {
    if (localStorage.getItem('lensloop.test.seeded')) return;
    localStorage.setItem('lensloop.test.seeded', '1');
    localStorage.setItem('lensloop.settings', JSON.stringify({ v: 3, saveKey: true, key: 'sk-ant-test', driveOn: true, driveRedirectOk: true, driveHelper: sd.helper, driveFolder: 'FOLDER' }));
    localStorage.setItem('lensloop.drive', JSON.stringify({ token: 'AT', exp: Date.now() + 50 * 60 * 1000, refresh: 'RT1' }));
    localStorage.setItem('lensloop.storylines', JSON.stringify(sd.stories));   // the older storage, moved into the database on load
  }, { helper: HELPER, stories: seedStories });

  await page.goto(base + 'index.html#key=sk-ant-test');
  await page.waitForTimeout(4500);   // the sync that runs on open (1.5 s after the storylines load)
  await page.click('#storiesBtn'); await page.waitForTimeout(300);
  const row = await page.textContent('#driveStatus');
  const local = await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('lensloop', 3);
    r.onsuccess = () => { const q = r.result.transaction('storylines').objectStore('storylines').getAll(); q.onsuccess = () => resolve(Object.fromEntries(q.result.map((s) => [s.id, { driveId: s.driveId, driveTxtId: s.driveTxtId }]))); };
  }));
  const onDrive = (sid, kind) => [...drv.values()].filter((f) => !f.trashed && f.appProperties.storyId === sid && f.appProperties.lensloop === kind && f.parents.includes('FOLDER'));
  console.log('requests:', hits.join(' | '));

  assert(!/fail|not found|404/i.test(row) && /for good/.test(row) && /last sync/.test(row), 'the sync went through: ' + row);
  // B — unchanged, both files gone: copied afresh, addresses replaced
  assert(onDrive('sB', '1').length === 1 && onDrive('sB', 'txt').length === 1, 'B: record and text copied to Drive afresh');
  assert(local.sB && local.sB.driveId === onDrive('sB', '1')[0]?.id && local.sB.driveTxtId === onDrive('sB', 'txt')[0]?.id, 'B: the phone now remembers the new addresses (' + JSON.stringify(local.sB) + ')');
  assert(hits.filter((h) => /JB_DEAD|TB_DEAD/.test(h)).length <= 2, 'B: each gone address was looked at once, not hammered (' + hits.filter((h) => /JB_DEAD|TB_DEAD/.test(h)).join(', ') + ')');
  // C — changed, its record gone: a new record, the existing text file updated in place
  assert(onDrive('sC', '1').length === 1 && local.sC.driveId === onDrive('sC', '1')[0].id, 'C: a new record on Drive (' + JSON.stringify(local.sC) + ')');
  assert(local.sC.driveTxtId === 'TC' && /Gamma transcript/.test(drv.get('TC').content), 'C: its text file updated where it was');
  // D — the listing showed a record that was gone: the update met "not found" and made a new one on the spot
  assert(onDrive('sD', '1').length === 1 && local.sD.driveId === onDrive('sD', '1')[0].id && local.sD.driveId !== 'JD_GHOST', 'D: an update that met "not found" made a new record (' + JSON.stringify(local.sD) + ')');
  // A — nothing to do: left alone
  assert(!hits.some((h) => /^(UPDATE|CREATE|PATCH) (JA|TA)\b/.test(h)) && local.sA.driveId === 'JA' && local.sA.driveTxtId === 'TA', 'A: untouched');
  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // A second sync finds everything in order: no lookups of the old addresses, nothing re-copied.
  const before = hits.length;
  await page.click('#driveSync'); await page.waitForTimeout(2500);
  const second = hits.slice(before);
  assert(!second.some((h) => /DEAD|GHOST/.test(h)) && !second.some((h) => /^CREATE/.test(h)), 'a second sync is clean (' + second.join(' | ') + ')');
  assert(/last sync/.test(await page.textContent('#driveStatus')), 'and says so');

  await browser.close(); server.close();
  console.log(process.exitCode ? 'DRIVE VANISHED FAILED' : 'DRIVE VANISHED PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
