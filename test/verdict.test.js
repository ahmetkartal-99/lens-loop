// Unit test of verdictOf: which answers are shown big and bold in the answer panel (a multiple-choice letter, Yes/No,
// a value) and which go to the word-by-word feed (titles, role lines, a letter). Run: node test/verdict.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  function splitAnswer(', '  function headlineSize(') + pick('  function verdictOf(', '  function renderAnswer(');
const { verdictOf, splitAnswer } = new Function(code + '; return { verdictOf, splitAnswer };')();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
const v = (text) => verdictOf(splitAnswer(text));

const yes = [
  ['ANSWER: B) Chloride-bicarbonate ionic shift\n\nThe saline load…', 'B', 'Chloride-bicarbonate ionic shift'],
  ['ANSWER: C. Decreased urinary acid excretion\n\nBecause…', 'C', 'Decreased urinary acid excretion'],
  ['ANSWER: (D) Inadequate mechanical ventilation', 'D', 'Inadequate mechanical ventilation'],
  ['ANSWER: e — Prolonged systemic hypoperfusion', 'E', 'Prolonged systemic hypoperfusion'],
  ['ANSWER: 3) 42', '3', '42'],
  ['ANSWER: Yes, within normal limits\n\n…', 'Yes', 'within normal limits'],
  ['ANSWER: No', 'No', ''],
  ['ANSWER: 42 mmol/L\n\nFrom the…', '42 mmol/L', ''],
  ['ANSWER: 7.4\n\n…', '7.4', ''],
  ['ANSWER: **A)** Absorption of intraperitoneal CO2', 'A', 'Absorption of intraperitoneal CO2'],
  // the question's label in front of the option, as models like to write it
  ['ANSWER: Q1: C) Water treatment facility bond\n\nA feasibility study…', 'C', 'Water treatment facility bond'],
  ['ANSWER: Question 3 — B. Local park bond', 'B', 'Local park bond'],
  ['ANSWER: Q 12 → D) Library bond', 'D', 'Library bond'],
  ['ANSWER: #4 D) Library bond', 'D', 'Library bond'],
  ['ANSWER: 1. C) Water treatment facility bond', 'C', 'Water treatment facility bond'],   // "1." is the question's number
  ['ANSWER: Option C: Water treatment facility bond', 'C', 'Water treatment facility bond'],
  ['ANSWER: The answer is B) Local park bond', 'B', 'Local park bond'],
  ['ANSWER: C', 'C', ''],
  ['ANSWER: (C)', 'C', ''],
];
for (const [t, key, rest] of yes) { const r = v(t); assert(r && r.key === key && r.rest === rest, 'verdict: ' + JSON.stringify(t.split('\n')[0]) + ' -> ' + JSON.stringify(r)); }

const no = [
  'ANSWER: A day at the clinic\n\nThe photo shows…',                       // a title that starts with "A "
  'ANSWER: Case notes — Mrs Priya Sharma\n\n…',
  'ANSWER: Worried about going home\nROLE: Patient\n\nDoctor, I still…',   // role lines: read aloud
  'ANSWER: Referral to Dr Smith\nTASK: referral letter\n\nDear Dr Smith,', // a letter: read aloud
  'ANSWER: nothing to read\n\nAn empty desk.',
  'ANSWER: B-cell lymphoma is the diagnosis\n\n…',                         // "B-" then words, not an option
  'ANSWER: 2019 was the year the policy changed, according to the note on the page\n\n…',   // a long sentence that happens to start with a number
  'The reply has no ANSWER line at all.',
  'ANSWER: Question 1 is about feasibility studies\n\n…',    // a question label, but no option after it
  'ANSWER: Q1 answered on the previous page',
  'ANSWER: Choice of therapy depends on the stage',           // "Choice" as a word, not a label
];
for (const t of no) assert(!v(t), 'not a verdict: ' + JSON.stringify(t.split('\n')[0]));

// loose: the quick look already judged the PAGE a question with options — the answer line is shown big whatever
// its wording, with the letter picked out where there is one
const vl = (text) => verdictOf(splitAnswer(text), true);
const loose = [
  ['ANSWER: C Water treatment facility bond', 'C', 'Water treatment facility bond'],
  ['ANSWER: Water treatment facility bond', '', 'Water treatment facility bond'],   // the option text alone
  ['ANSWER: A feasibility study is for revenue bonds', '', 'A feasibility study is for revenue bonds'],   // "A" the article, not option A
  ['ANSWER: photosynthesis', '', 'photosynthesis'],   // a fill-in-the-blank
  ['ANSWER: Q1: C) Water treatment facility bond', 'C', 'Water treatment facility bond'],
];
for (const [t, key, rest] of loose) { const r = vl(t); assert(r && r.key === key && r.rest === rest, 'loose: ' + JSON.stringify(t.split('\n')[0]) + ' -> ' + JSON.stringify(r)); }
assert(!vl('ANSWER: Worried about going home\nROLE: Patient\n\nDoctor…'), 'loose: never role lines');
assert(!vl('ANSWER: nothing to read\n\nAn empty desk.'), 'loose: never "nothing to read"');
console.log(process.exitCode ? 'VERDICT FAILED' : 'ALL TESTS PASSED');
