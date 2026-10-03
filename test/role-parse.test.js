// Unit test of the role-card verdict parser (parseRoleLook), run against the function extracted from index.html:
// the quick look's answer must be read however a model writes it. Run: node test/role-parse.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const a = html.indexOf('  function parseRoleLook('), b = html.indexOf('  // The decision for a new picture once the quick look is back.');
if (a < 0 || b < 0) throw new Error('could not locate parseRoleLook');
const parseRoleLook = new Function(html.slice(a, b) + '; return parseRoleLook;')();
const cases = [
  ['CARD | Patient | Medical ward in a hospital | Explain that you are very worried about going home', false, 'card Patient'],
  ['**CARD** | PATIENT | Medical ward | Explain that you are very worried', false, 'card PATIENT'],
  ['CARD | Carer | Suburban Clinic', false, 'card Carer'],                                   // no task field
  ['Here is my answer:\nCARD | Doctor | Hospital ward | Advise the patient about going home', false, 'card Doctor'],
  ['NONE', false, 'none'],
  ['NONE — this is a desk with a keyboard.', false, 'none'],
  ['SAME', true, 'same'],
  ['**SAME**', true, 'same'],
  ['Same — it is the same card, moved.', true, 'same'],
  ['NEW | Doctor | Medical ward in a hospital | Advise the patient', true, 'card Doctor'],
  ['NEW**|** Nurse | Ward 3 | Check the dressing', true, 'card Nurse'],
  ['SAME', false, 'none'],                                                                   // SAME only means something with a locked card
];
let bad = 0;
for (const [t, paired, want] of cases) {
  const r = parseRoleLook(t, paired);
  const got = r.card ? 'card ' + r.card.role : r.same ? 'same' : 'none';
  if (got !== want) { bad++; console.error('FAIL:', JSON.stringify(t), '->', got, '(wanted', want + ')'); } else console.log('ok:', JSON.stringify(t).slice(0, 70), '->', got);
}
const full = parseRoleLook('CARD | Patient | Medical ward in a hospital | Explain that you are very worried', false).card;
if (!(full.setting === 'Medical ward in a hospital' && /very worried/.test(full.task))) { bad++; console.error('FAIL: setting/task fields', JSON.stringify(full)); } else console.log('ok: setting and task fields kept');
console.log(bad ? 'ROLE PARSE FAILED' : 'ALL TESTS PASSED');
process.exitCode = bad ? 1 : 0;
