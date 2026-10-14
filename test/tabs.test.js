// Unit test of the tabbed-sources pieces, extracted from index.html: the quick look's TABS verdict read however a
// model writes it, the selected tab matched to a name, and "the same question" — which must tell apart two items
// that open with the same stem word for word. Run: node test/tabs.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  function parseRoleLook(', '  // The decision for a new picture once the quick look is back.') +
  pick('  const normName = ', '  const panelChanged = ');
const { parseRoleLook, tabsOf, sameQuestion } = new Function(code + '; return { parseRoleLook, tabsOf, sameQuestion };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

// the TABS verdict, in the forms a model writes it
const forms = [
  'TABS | Mall Information; Building Plan; Companies | Building Plan | For each of the following situations, select Yes / Jeans for All is purchased by The',
  '**TABS** | Mall Information; Building Plan; Companies | building plan | For each of the following situations, select Yes / Jeans for All is purchased by The',
  'Here you go:\nTABS | Mall Information, Building Plan, Companies | Building Plan | For each of the following situations, select Yes / Jeans for All is purchased by The',
  '{"tabs": ["Mall Information", "Building Plan", "Companies"], "active": "Building Plan", "question": "For each of the following situations, select Yes / Jeans for All is purchased by The"}',
];
for (const t of forms) {
  const r = parseRoleLook(t, false);
  assert(r.tabs && r.tabs.names.join('|') === 'Mall Information|Building Plan|Companies' && r.tabs.active === 'Building Plan' && /^For each of the following/.test(r.tabs.question) && / \/ Jeans for All/.test(r.tabs.question), 'TABS read: ' + JSON.stringify(t.slice(0, 60)) + ' -> ' + JSON.stringify(r.tabs));
}
assert(parseRoleLook('TABS | Email 1; Email 2; Email 3 | Email 2 | none', true).tabs.question === '', 'TABS with no question in view: question empty');
assert(parseRoleLook('TABS | Email 1; Email 2; Email 3 | Email 2 | none', true).tabs.active === 'Email 2', 'TABS paired: the selected tab');
assert(!parseRoleLook('TABS | Only one | Only one | a question', false).tabs, 'one tab is no tab panel');
assert(parseRoleLook('CHOICE', false).choice && !parseRoleLook('CHOICE', false).tabs, 'CHOICE is still CHOICE');
const sel = tabsOf(['Mall Information', 'Building Plan', 'Companies'], 'the Building Plan tab', 'N/A');
assert(sel.active === 'Building Plan' && sel.question === '', 'tabsOf: the selected tab matched loosely, "N/A" is no question');

// the same question, or another: items in a set open with the same stem word for word
const stem = 'For each of the following situations, select Yes';
assert(sameQuestion(stem + ' / Jeans for All is purchased by The', stem + ' / Jeans for All is purchased by the Pant'), 'the same item, worded a little differently by two looks');
assert(!sameQuestion(stem + ' / Jeans for All is purchased by The', stem + ' / Mini Sweet Treats moves into annex 2'), 'the same stem, a different first statement: ANOTHER question');
assert(!sameQuestion(stem + ' / Jeans for All is purchased by The', stem + ' / Tax Guys purchases a company'), 'and another');
assert(sameQuestion('Which of the following stores could be', 'Which of the following stores could be assigned'), 'no statement given: the first words decide');
assert(!sameQuestion('Which of the following stores could be', 'Which of the following companies must have'), 'no statement given: different first words are a different question');
assert(sameQuestion('', '') && !sameQuestion('', 'a question'), 'empty against empty is the same; empty against words is not');
console.log(process.exitCode ? 'TABS FAILED' : 'ALL TESTS PASSED');
