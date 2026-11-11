// Unit test of "always the newest model of its line" (the pure part, extracted from index.html): reading a model id's
// version, telling which of two models is the newer, picking the newest Fable out of Anthropic's list of the models a
// key can use (GET /v1/models) whatever shape the list takes, the order in which models are tried, the effort asked
// for, the model's display name and the price table — and a few facts about the page itself: Fable 5.2 at max is
// built in, every request to the answering model goes through one door, and nothing a current Fable rejects is sent.
// Run: node test/model.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  const PRICES = [', '  // ----- the model in force -----');
const { priceFor, modelVersion, modelFamily, newerModel, newestOfLine, deepestEffort, prettyModel, modelOrder, EFFORTS } =
  new Function(code + '; return { priceFor, modelVersion, modelFamily, newerModel, newestOfLine, deepestEffort, prettyModel, modelOrder, EFFORTS };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the page's own constants
const konst = (name) => (new RegExp("const " + name + " = ('([^']*)'|true|false)").exec(html) || [])[1];
assert(konst('MODEL') === "'claude-fable-5-2'", 'the built-in model is Claude Fable 5.2 (' + konst('MODEL') + ')');
assert(konst('EFFORT') === "'max'", 'the built-in effort is max (' + konst('EFFORT') + ')');
assert(konst('MODEL_AUTO') === 'true' && konst('MODEL_LINE') === "'fable'", 'the newest model of the fable line is taken automatically');
assert(konst('MODEL_BEFORE') === "'claude-fable-5-1'", 'the model before, as the last resort (' + konst('MODEL_BEFORE') + ')');
// every request to the answering model goes through claudeFetch: the only other requests to /v1/messages are the two quick looks (their own fixed model)
const posts = html.split("fetch('https://api.anthropic.com/v1/messages'").length - 1;
assert(posts === 3, 'three fetches to /v1/messages in the page: claudeFetch and the two quick looks (' + posts + ')');
assert((html.match(/await claudeFetch\(/g) || []).length === 4, 'the answer, the role play, the storyline routing and the digest all go through claudeFetch');
assert(!/model: S\.model, max_tokens[^\n]*\n[^\n]*fetch\('https:\/\/api\.anthropic/.test(html), 'no request names the model and posts by itself');
// nothing a current Fable rejects with a 400: sampling parameters, a thinking switch or budget, a forced tool
const script = (html.match(/<script>\n([\s\S]*?)\n<\/script>/) || [])[1] || '';
assert(!/\b(temperature|top_p|top_k|budget_tokens|tool_choice)\s*:/.test(script) && !/thinking\s*:\s*\{/.test(script), 'no temperature / top_p / top_k, no thinking switch, no forced tool in any request');
assert(/'anthropic-version': '2023-06-01'/.test(script) && /v1\/models\?limit=1000/.test(script), 'the model list is asked for in one page of up to 1000');

// ---- a model id's version
assert(same(modelVersion('claude-fable-5-2'), [5, 2, Infinity]) && same(modelVersion('claude-fable-5'), [5, 0, Infinity]), 'claude-fable-5-2 → 5.2, claude-fable-5 → 5.0');
assert(same(modelVersion('claude-fable-6-20270301'), [6, 0, 20270301]) && same(modelVersion('claude-haiku-4-5-20251001'), [4, 5, 20251001]), 'a dated snapshot keeps its date apart from the version');
assert(same(modelVersion('claude-fable-5-12'), [5, 12, Infinity]), 'a two-digit minor version');
assert(modelFamily('claude-fable-5-2') === 'fable' && modelFamily('claude-haiku-4-5-20251001') === 'haiku' && modelFamily('gpt-x') === '' && modelFamily(undefined) === '', 'the family in an id');
assert(modelVersion('claude-fable-5-2-fast') === null && modelVersion('claude-fable-6-preview') === null && modelVersion('claude-3-5-sonnet-20241022') === null && modelVersion('') === null && modelVersion(undefined) === null, 'variants, previews, old-style ids and nothing: no version');

// ---- which of two is the newer
const N = (a, b) => newerModel(typeof a === 'string' ? { id: a } : a, typeof b === 'string' ? { id: b } : b);
assert(N('claude-fable-5-2', 'claude-fable-5-1') && !N('claude-fable-5-1', 'claude-fable-5-2'), '5.2 is newer than 5.1');
assert(N('claude-fable-6', 'claude-fable-5-2') && N('claude-fable-5-10', 'claude-fable-5-9') && N('claude-fable-10', 'claude-fable-9-9'), '6 over 5.2, 5.10 over 5.9, 10 over 9.9 (numbers, not text)');
assert(N({ id: 'claude-story-1', created: 2e12 }, { id: 'claude-fable-5-2', created: 1.7e12 }) && !N({ id: 'claude-story-1', created: 1e12 }, { id: 'claude-fable-5-2', created: 1.7e12 }), 'two families: versions are not set against each other — the release time decides');
assert(N('claude-fable-5-2', 'claude-fable-5-2-20261109') && !N('claude-fable-5-2-20261109', 'claude-fable-5-2'), 'a version\'s plain id over its dated snapshot');
assert(N('claude-fable-5-2-20270115', 'claude-fable-5-2-20261109'), 'a later snapshot over an earlier one');
assert(N({ id: 'claude-fable-5-2', created: 1 }, { id: 'claude-fable-5-1', created: 9e12 }), 'the version decides even when the older version was released again later');
assert(!N('claude-fable-5-2', 'claude-fable-5-2'), 'a model is not newer than itself');
assert(N({ id: 'claude-fable-next', created: 2e12 }, { id: 'claude-fable-5-2', created: 1.7e12 }) && !N({ id: 'claude-fable-next', created: 1e12 }, { id: 'claude-fable-5-2', created: 1.7e12 }), 'an id of another shape: by its release time');
assert(N({ id: 'claude-fable-5-2' }, { id: 'claude-fable-next' }) && !N({ id: 'claude-fable-next' }, { id: 'claude-fable-5-2' }), '… and with no release time known, the id of a known shape');
assert(N({ id: 'claude-x', order: 0 }, { id: 'claude-y', order: 3 }), 'nothing else to go by: the list\'s own order (newest first)');

// ---- Anthropic's list, as documented (GET /v1/models: newest first; line, lifecycle, created_at, capabilities)
const eff = (...on) => Object.assign({ supported: on.length > 0 }, ...EFFORTS.map((e) => ({ [e]: { supported: on.includes(e) } })));
const M = (id, line, name, created, extra) => Object.assign({ type: 'model', id, display_name: name, created_at: created, lifecycle: 'active', line, deprecated_at: null, retires_at: null,
  max_input_tokens: 1000000, max_tokens: 128000, capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, effort: eff(...EFFORTS), thinking: { supported: true, types: { adaptive: { supported: true } } } } }, extra || {});
const TODAY = [
  M('claude-fable-5-2', 'fable', 'Claude Fable 5.2', '2026-11-09T00:00:00Z'), M('claude-mythos-5-2', 'mythos', 'Claude Mythos 5.2', '2026-11-09T00:00:00Z'),
  M('claude-haiku-5-5', 'haiku', 'Claude Haiku 5.5', '2026-10-07T00:00:00Z'), M('claude-sonnet-5-5', 'sonnet', 'Claude Sonnet 5.5', '2026-09-28T00:00:00Z'),
  M('claude-opus-5-5', 'opus', 'Claude Opus 5.5', '2026-09-21T00:00:00Z'), M('claude-fable-5-1', 'fable', 'Claude Fable 5.1', '2026-09-01T00:00:00Z'),
  M('claude-mythos-5-1', 'mythos', 'Claude Mythos 5.1', '2026-09-01T00:00:00Z'), M('claude-sonnet-5', 'sonnet', 'Claude Sonnet 5', '2026-06-30T00:00:00Z'),
  M('claude-fable-5', 'fable', 'Claude Fable 5', '2026-06-09T00:00:00Z'), M('claude-haiku-4-5-20251001', 'haiku', 'Claude Haiku 4.5', '2025-10-15T00:00:00Z'),
];
let p = newestOfLine(TODAY, 'fable');
assert(p && p.id === 'claude-fable-5-2' && p.name === 'Claude Fable 5.2' && p.created === Date.parse('2026-11-09T00:00:00Z') && p.maxTokens === 128000, 'today\'s list: the newest Fable is Claude Fable 5.2 (' + JSON.stringify(p) + ')');
assert(same(p.efforts, EFFORTS), '… with all five efforts on its list, max among them');
assert(newestOfLine(TODAY, 'opus').id === 'claude-opus-5-5' && newestOfLine(TODAY, 'haiku').id === 'claude-haiku-5-5' && newestOfLine(TODAY, 'mythos').id === 'claude-mythos-5-2', 'the other lines by the same rule');
assert(newestOfLine(TODAY.slice().reverse(), 'fable').id === 'claude-fable-5-2', 'the same list, oldest first: still 5.2 (the version decides, not the order)');
const SIX = [M('claude-fable-6', 'fable', 'Claude Fable 6', '2027-03-01T00:00:00Z')].concat(TODAY);
p = newestOfLine(SIX, 'fable');
assert(p.id === 'claude-fable-6' && p.name === 'Claude Fable 6', 'a Fable 6 in the list: taken (' + p.id + ')');
assert(newestOfLine(TODAY.concat([M('claude-fable-5-3', 'fable', 'Claude Fable 5.3', '2027-01-20T00:00:00Z')]), 'fable').id === 'claude-fable-5-3', 'a Fable 5.3 at the END of the list: taken all the same');
// what is left out
assert(newestOfLine([M('claude-fable-5-2-fast', 'fable', 'Claude Fable 5.2 (fast)', '2026-12-01T00:00:00Z'), M('claude-fable-6-preview', 'fable', 'Claude Fable 6 Preview', '2027-01-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'a "-fast" variant and a "-preview": not plain versions, left out');
assert(newestOfLine([M('claude-fable-6', 'fable', 'Claude Fable 6', '2027-03-01T00:00:00Z', { lifecycle: 'deprecated' })].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'a model on its way out (lifecycle deprecated): left out');
assert(newestOfLine([M('claude-fable-6', 'fable', 'Claude Fable 6', '2027-03-01T00:00:00Z', { lifecycle: 'retired' })].concat(TODAY), 'fable').id === 'claude-fable-5-2', '… and a retired one');
const noImg = M('claude-fable-6', 'fable', 'Claude Fable 6', '2027-03-01T00:00:00Z'); noImg.capabilities = Object.assign({}, noImg.capabilities, { image_input: { supported: false } });
assert(newestOfLine([noImg].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'a model that takes no images: left out (the page sends photos)');
assert(newestOfLine([M('claude-fable-9', null, 'Something else', '2027-05-01T00:00:00Z'), M('claude-fable-8', 'opus', 'Mislabelled', '2027-04-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'the list\'s own "line" decides, not the id: line null or another line is not a Fable');
assert(newestOfLine([M('claude-story-1', 'fable', 'Claude Story 1', '2027-06-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-story-1', 'the line under a new name with its numbering begun again ("claude-story-1", released later): taken by its release time — versions are only set against each other within one name');
assert(newestOfLine([M('claude-story-1', 'fable', 'An old oddity', '2025-06-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', '… and one released earlier is not');
assert(newestOfLine([M('claude-fable-2027', 'fable', 'Claude Fable 2027', '2027-06-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-2027', 'an id of a new shape, released later than every versioned one: taken by its release time');
assert(newestOfLine([M('claude-fable-2025', 'fable', 'An old oddity', '2025-01-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', '… and one released earlier is not');
assert(newestOfLine([M('claude-fable-5-2-20261109', 'fable', 'Claude Fable 5.2', '2026-11-09T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'the plain id and its dated snapshot both listed: the plain id');
assert(newestOfLine([M('claude-fable-5-1-20270201', 'fable', 'Claude Fable 5.1 (refresh)', '2027-02-01T00:00:00Z')].concat(TODAY), 'fable').id === 'claude-fable-5-2', 'an older version released again later does not win');
// other shapes of list
const bare = TODAY.map((m) => ({ type: 'model', id: m.id, display_name: m.display_name, created_at: m.created_at }));
p = newestOfLine(bare, 'fable');
assert(p && p.id === 'claude-fable-5-2' && same(p.efforts, []) && p.maxTokens === 0, 'a list with no line, lifecycle or capabilities (an older API): read by id — 5.2, its efforts unknown');
assert(newestOfLine([{ type: 'model', id: 'claude-fable-5-2', created_at: '1970-01-01T00:00:00Z' }], 'fable').created === 0, 'an epoch release date means "unknown"');
assert(newestOfLine([null, 7, 'x', {}, { id: 5 }, { id: 'claude-fable-5-2', line: 'fable' }], 'fable').id === 'claude-fable-5-2', 'rubbish entries are skipped');
assert(newestOfLine([], 'fable') === null && newestOfLine(undefined, 'fable') === null && newestOfLine({ data: [] }, 'fable') === null && newestOfLine(TODAY.filter((m) => m.line !== 'fable'), 'fable') === null, 'no list, an empty list, a list with no Fable: nothing picked');
const noMax = M('claude-fable-7', 'fable', 'Claude Fable 7', '2027-09-01T00:00:00Z'); noMax.capabilities = Object.assign({}, noMax.capabilities, { effort: eff('low', 'medium', 'high', 'xhigh') });
p = newestOfLine([noMax].concat(TODAY), 'fable');
assert(p.id === 'claude-fable-7' && same(p.efforts, ['low', 'medium', 'high', 'xhigh']), 'a model that does not list max: its efforts as listed');

// ---- the effort asked for
assert(deepestEffort('max', EFFORTS) === 'max' && deepestEffort('max', []) === 'max' && deepestEffort('max', null) === 'max' && deepestEffort('max', undefined) === 'max', 'max where it is listed, and where nothing is known');
assert(deepestEffort('max', ['low', 'medium', 'high', 'xhigh']) === 'xhigh' && deepestEffort('max', ['low', 'medium', 'high']) === 'high' && deepestEffort('max', ['low']) === 'low', 'max not listed: the deepest that is');
assert(deepestEffort('high', ['low', 'medium', 'xhigh', 'max']) === 'medium' && deepestEffort('low', ['medium', 'high']) === 'high', 'never deeper than asked where something at or below is listed; else what there is');

// ---- names
assert(prettyModel('claude-fable-5-2') === 'Claude Fable 5.2' && prettyModel('claude-fable-6') === 'Claude Fable 6' && prettyModel('claude-opus-5-5') === 'Claude Opus 5.5' && prettyModel('claude-haiku-4-5-20251001') === 'Claude Haiku 4.5', 'ids read as names');
assert(prettyModel('claude-fable-next') === 'claude-fable-next' && prettyModel('') === '' && prettyModel(undefined) === '', 'an id of another shape stays as it is');

// ---- the order in which models are tried
const MODEL = 'claude-fable-5-2', BEFORE = 'claude-fable-5-1', BUILT = Date.parse('2026-11-10T21:40');
const O = (seen) => modelOrder(seen, MODEL, BEFORE, BUILT);
assert(same(O(null), [MODEL, BEFORE]) && same(O(undefined), [MODEL, BEFORE]) && same(O({}), [MODEL, BEFORE]), 'nothing seen in the list: the built-in model, then the one before');
assert(same(O({ id: MODEL }), [MODEL, BEFORE]), 'the list\'s newest IS the built-in model: the same two');
assert(same(O({ id: 'claude-fable-6', created: Date.parse('2027-03-01') }), ['claude-fable-6', MODEL, BEFORE]), 'a newer Fable seen: first, with the built-in model to step back to');
assert(same(O({ id: 'claude-fable-5-3' }), ['claude-fable-5-3', MODEL, BEFORE]), '… a point release too, with or without a release time');
assert(same(O({ id: BEFORE }), [MODEL, BEFORE]), 'the list shows only the model before (a key that cannot use the built-in one): the built-in one is still tried first');
assert(same(O({ id: 'claude-fable-5' }), [MODEL, 'claude-fable-5', BEFORE]), 'the list\'s newest is older than the built-in model: never moved DOWN on the list\'s word, kept as a fallback');
assert(same(O({ id: 'claude-fable-5-2-20270115', created: Date.parse('2027-01-15') }), [MODEL, 'claude-fable-5-2-20270115', BEFORE]), 'a dated snapshot of the built-in version: the plain id stays in force');
assert(same(O({ id: 'claude-fable-next', created: BUILT + 86400000 }), ['claude-fable-next', MODEL, BEFORE]), 'an id of a new shape released AFTER this build: newer');
assert(same(O({ id: 'claude-fable-odd', created: BUILT - 86400000 }), [MODEL, 'claude-fable-odd', BEFORE]) && same(O({ id: 'claude-fable-odd' }), [MODEL, 'claude-fable-odd', BEFORE]), '… released before it, or at a time unknown: not');
assert(same(O({ id: 'claude-story-1', created: BUILT + 86400000 }), ['claude-story-1', MODEL, BEFORE]) && same(O({ id: 'claude-story-9', created: BUILT - 86400000 }), [MODEL, 'claude-story-9', BEFORE]), 'the line under a new name: newer exactly when released after this build, whatever its number');
assert(same(modelOrder({ id: 'claude-fable-6' }, MODEL, MODEL, BUILT), ['claude-fable-6', MODEL]), 'no duplicates in the line');

// ---- prices ($ per million tokens: input, output, cache read as a share of input, known)
assert(same(priceFor('claude-fable-5-2'), [8, 40, 0.025, true]) && same(priceFor('claude-mythos-5-2'), [8, 40, 0.025, true]), 'Fable 5.2: $8 in, $40 out, cache reads at 2.5 %');
assert(same(priceFor('claude-fable-5-1'), [10, 50, 0.025, true]) && same(priceFor('claude-fable-5'), [10, 50, 0.1, true]), 'Fable 5.1: $10 / $50 with reads at 2.5 %; Fable 5: reads at 10 %');
assert(same(priceFor('claude-fable-5-2-20261109'), [8, 40, 0.025, true]), 'a dated snapshot at its version\'s price');
assert(same(priceFor('claude-fable-6'), [8, 40, 0.025, false]) && same(priceFor('claude-fable-5-3'), [8, 40, 0.025, false]) && same(priceFor('claude-fable-5-20'), [8, 40, 0.025, false]), 'a Fable this build does not know: the newest Fable\'s price, marked unknown');
assert(same(priceFor('claude-opus-5-5'), [4, 20, 0.05, true]) && same(priceFor('claude-opus-5'), [5, 25, 0.1, true]) && same(priceFor('claude-opus-4-8'), [5, 25, 0.1, true]) && same(priceFor('claude-opus-4-1'), [15, 75, 0.1, true]), 'Opus 5.5, 5, 4.8, 4.1');
assert(same(priceFor('claude-sonnet-5-5'), [2, 10, 0.05, true]) && same(priceFor('claude-sonnet-5'), [2, 10, 0.1, true]) && same(priceFor('claude-sonnet-4-6'), [3, 15, 0.1, true]), 'Sonnet 5.5, 5, 4.6');
assert(same(priceFor('claude-haiku-4-5'), [1, 5, 0.1, true]) && same(priceFor('claude-haiku-4-5-20251001'), [1, 5, 0.1, true]) && same(priceFor('claude-haiku-5-5'), [0.1, 0.5, 0.1, true]), 'Haiku 4.5 (the quick look) and 5.5');
assert(same(priceFor('something-else'), [4, 20, 0.1, false]) && same(priceFor(''), [4, 20, 0.1, false]) && same(priceFor(undefined), [4, 20, 0.1, false]), 'an unknown model: a middling guess, marked unknown');
console.log(process.exitCode ? 'MODEL TEST FAILED' : 'MODEL TEST PASSED');
