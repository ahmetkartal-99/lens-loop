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
  ['{"card": true, "role": "Patient", "setting": "Medical ward", "task": "Explain that you are worried"}', false, 'card Patient'],
  ['Here you go:\n```json\n{"role":"Doctor","setting":"Clinic","task":"Advise"}\n```', false, 'card Doctor'],
  ['{"card": false}', false, 'none'],
  ['{"same": true}', true, 'same'],
  ['Yes, this is a role-play card. Role: Patient. Setting: Medical ward in a hospital. Task: Explain that you are worried.', false, 'card Patient'],
  ['Yes — the role is the Carer, setting: Suburban Clinic', false, 'card Carer'],
  ['This photo shows a desk and a keyboard; it is not a card.', false, 'none'],                // prose with no verdict word
  ['OTHER', true, 'other'],
  ['**OTHER** — a multiple-choice question.', true, 'other'],
  ['{"other": true}', true, 'other'],
  ['OTHER', false, 'none'],                                                                  // OTHER only means something with a locked card
  ['MORE', true, 'more'],
  ['**MORE** — the case notes for the same task.', true, 'more'],
  ['{"more": true}', true, 'more'],
  ['TASK', true, 'newTask a writing task'],
  ['TASK — a different letter.', true, 'newTask a writing task'],
  ['{"task": true}', true, 'newTask a writing task'],
  ['MORE', false, 'none'],
  ['TASK', false, 'none'],
  ['WRITE | a letter of referral to Dr Smith', false, 'write a letter of referral to Dr Smith'],
  ['**WRITE** | referral letter', true, 'write referral letter'],
  ['{"write": "a referral letter"}', false, 'write a referral letter'],
  ['NOTES | Mrs Priya Sharma', false, 'notes Mrs Priya Sharma'],
  ['NOTES | Mrs Priya Sharma', true, 'notes Mrs Priya Sharma'],
  ['{"notes": "Mrs Sharma, diabetes"}', false, 'notes Mrs Sharma, diabetes'],
  ['TASK | a discharge summary for Mr Jones', true, 'newTask a discharge summary for Mr Jones'],
  ['TASK | a discharge summary for Mr Jones', false, 'none'],
  ['WRITE', false, 'write a writing task'],
  ['NOTES', false, 'notes case notes'],
  ['CHOICE', false, 'choice'],
  ['CHOICE', true, 'choice'],
  ['**CHOICE** — a multiple-choice question.', true, 'choice'],
  ['{"choice": true}', false, 'choice'],
];
let bad = 0;
for (const [t, paired, want] of cases) {
  const r = parseRoleLook(t, paired);
  const got = r.card ? 'card ' + r.card.role : r.write ? 'write ' + r.write : r.notes ? 'notes ' + r.notes : r.choice ? 'choice' : r.same ? 'same' : r.more ? 'more' : r.newTask ? 'newTask ' + r.newTask : r.other ? 'other' : 'none';
  if (got !== want) { bad++; console.error('FAIL:', JSON.stringify(t), '->', got, '(wanted', want + ')'); } else console.log('ok:', JSON.stringify(t).slice(0, 70), '->', got);
}
const full = parseRoleLook('CARD | Patient | Medical ward in a hospital | Explain that you are very worried', false).card;
if (!(full.setting === 'Medical ward in a hospital' && /very worried/.test(full.task))) { bad++; console.error('FAIL: setting/task fields', JSON.stringify(full)); } else console.log('ok: setting and task fields kept');
const prose = parseRoleLook('Yes, this is a role-play card. Role: Patient. Setting: Medical ward in a hospital. Task: Explain that you are worried.', false).card;
if (!(prose.role === 'Patient' && prose.setting === 'Medical ward in a hospital' && /worried/.test(prose.task))) { bad++; console.error('FAIL: prose fields', JSON.stringify(prose)); } else console.log('ok: prose fields kept');

// the reply parser: the ROLE: header line is read in any order with STORYLINE/FRAMES and stripped from the body
const a2 = html.indexOf('  function splitAnswer('), b2 = html.indexOf('  function headlineSize(');
const splitAnswer = new Function(html.slice(a2, b2) + '; return splitAnswer;')();
const sa = [
  ['ANSWER: Worried about going home\nROLE: Patient\n\nDoctor, I still feel weak.', { role: 'Patient', body: 'Doctor, I still feel weak.' }],
  ['ANSWER: Title\nSTORYLINE: none\nFRAMES: new\nROLE: Doctor\n\nGood morning.', { role: 'Doctor', body: 'Good morning.', frames: 'new' }],
  ['ANSWER: Title\n**ROLE:** Carer\n\nHi there.', { role: 'Carer', body: 'Hi there.' }],
  ['ANSWER: A desk\n\nA grey desk.', { role: '', body: 'A grey desk.' }],
  ['ANSWER: Referral to Dr Smith\nTASK: referral letter — Mrs Sharma to Dr Smith\n\nDear Dr Smith,', { role: '', task: 'referral letter — Mrs Sharma to Dr Smith', body: 'Dear Dr Smith,' }],
  ['ANSWER: Referral\nSTORYLINE: none\nFRAMES: continues\n**TASK:** referral letter\n\nDear Dr Smith,', { role: '', task: 'referral letter', body: 'Dear Dr Smith,', frames: 'continues' }],
];
for (const [t, want] of sa) {
  const r = splitAnswer(t);
  const ok = r.role === want.role && r.body === want.body && (want.frames === undefined || r.frames === want.frames) && (want.task === undefined ? r.task === '' : r.task === want.task);
  if (!ok) { bad++; console.error('FAIL: splitAnswer', JSON.stringify(t), '->', JSON.stringify(r)); } else console.log('ok: splitAnswer', JSON.stringify(t).slice(0, 50), '-> role', JSON.stringify(r.role));
}
console.log(bad ? 'ROLE PARSE FAILED' : 'ALL TESTS PASSED');
process.exitCode = bad ? 1 : 0;
