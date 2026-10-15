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

// several parts: each shown big in order — labelled parts take any wording, unlabelled ones must be verdicts themselves
const parts = (text, loose) => { const r = verdictOf(splitAnswer(text), loose); return r && r.parts ? r.parts.map((p) => [p.label, p.key, p.rest].join('/')) : null; };
assert(JSON.stringify(parts('ANSWER: 1: Yes | 2: No | 3: Yes\n\nJeans for All…')) === JSON.stringify(['1/Yes/', '2/No/', '3/Yes/']), 'parts: three Yes/No statements');
assert(JSON.stringify(parts('ANSWER: first blank: 118 | second blank: 1')) === JSON.stringify(['first blank/118/', 'second blank/1/']), 'parts: two blanks with values');
assert(JSON.stringify(parts('ANSWER: Statement 1: True | Statement 2: False')) === JSON.stringify(['Statement 1/True/', 'Statement 2/False/']), 'parts: true/false');
assert(JSON.stringify(parts('ANSWER: Column A: Jeans for All | Column B: Tax Guys')) === JSON.stringify(['Column A//Jeans for All', 'Column B//Tax Guys']), 'parts: a two-part table, the choices as text');
assert(JSON.stringify(parts('ANSWER: 1: B) 121 | 2: D) 27')) === JSON.stringify(['1/B/121', '2/D/27']), 'parts: lettered options per part');
assert(JSON.stringify(parts('ANSWER: Yes | No | Yes', true)) === JSON.stringify(['/Yes/', '/No/', '/Yes/']), 'parts: bare Yes/No parts');
assert(parts('ANSWER: Pros | Cons\n\nA title with a bar in it.') === null && !v('ANSWER: Pros | Cons\n\n…'), 'not parts: a title with a bar, unlabelled plain words');
assert(parts('ANSWER: Mall Information | Building Plan') === null, 'not parts: tab names are not verdicts');
assert(JSON.stringify(parts('ANSWER: **1: Yes** | **2: No**')) === JSON.stringify(['1/Yes/', '2/No/']), 'parts: bold stripped');
assert(!vl('ANSWER: nothing to read\n\nAn empty desk.'), 'loose: never "nothing to read"');

// a reply that is NO ANSWER keeps the text on screen: "nothing to read", or a title that only describes a blurred or
// empty frame — the words the model used on the user's own captures — never a verdict, never a title about a subject
const empty = new Function(code + pick('  const EMPTY_FRAME_RE = ', '  function recall(') + '; return { nothingToRead, emptyFrameTitle };')();
const nr = (text, choice) => empty.nothingToRead(text, choice);
for (const t of [
  'ANSWER: nothing to read\n\nAn empty desk.',
  'ANSWER: Overexposed, motion-blurred frame — only washed-out white visible\n\nNo text can be made out.',
  'ANSWER: Out-of-focus, washed-out pale blur\n\nThe frame holds no legible text.',
  'ANSWER: Blurry photo of a laptop screen\n\nToo blurred to read.',
  'ANSWER: Blank white screen\n\nNothing on it.',
  'ANSWER: No legible text in frame\n\nA white glow.',
  'ANSWER: Screen too blurred to read\n\n…',
  'ANSWER: Camera still moving — unreadable\n\n…',
]) assert(nr(t), 'no answer: ' + t.split('\n')[0]);
for (const t of [
  'ANSWER: B) Blurred vision is a side effect\n\nOf the drug…',
  'ANSWER: C) Washed-out appearance of the retina\n\n…',
  'ANSWER: Blurred vision after head injury\n\nA reading passage about…',
  'ANSWER: Yes\n\nThe text is clear.',
  'ANSWER: 1: Yes | 2: No\n\n…',
  'ANSWER: Discharge advice after pneumonia\nROLE: Doctor\n\n**Setting:** …',
  'ANSWER: A patient who cannot read small print\n\nPresbyopia is…',
  'ANSWER: The toll keeper takes a memory\nSTORYLINE: Current session\n\n…',
]) assert(!nr(t), 'an answer: ' + t.split('\n')[0]);
assert(!nr('ANSWER: Lobar pneumonia\n\n…', true) && !nr('ANSWER: C) Image is out of focus\n\n…', true), 'a page judged a question with options: a bare answer line, or an option, is an answer');
assert(nr('ANSWER: Out-of-focus, washed-out pale blur\n\n…', true), '… but a bare line that only describes the blur is none, even on such a page');
console.log(process.exitCode ? 'VERDICT FAILED' : 'ALL TESTS PASSED');
