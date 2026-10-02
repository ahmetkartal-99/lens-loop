// Unit test of the live-session prompt assembly (frozen blocks, cache mark, budget, visual-note caps), run
// against the functions extracted from index.html. Run: node test/live-prompt.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = (html.match(/<script>\n([\s\S]*?)\n<\/script>/) || [])[1] || '';
const start = src.indexOf('  const VISUALS_SAVED_MAX');
const end = src.indexOf('  // Full transcripts of the storylines that fit the budget.');
if (start < 0 || end < 0) throw new Error('could not locate the live block code');
let code = src.slice(start, end);
// stubs for what the extracted code reaches into
const prelude = `
  let listening = true, story = null, stories = [];
  const STORY_BUDGET_CHARS = 480000;
  const fmtTime = (d) => '10:00:00';
  const mmss = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0'); };
  const storyWords = (st) => st.finals.reduce((n, f) => n + f.text.split(/\\s+/).filter(Boolean).length, 0);
  const usableStories = () => stories.filter((st) => st.use !== false && st.text);
`;
const fn = new Function('out', prelude + code + `
  out.set = (st, l) => { story = st; listening = l === undefined ? true : l; };
  out.liveParts = liveParts; out.liveBlocks = liveBlocks; out.liveChars = liveChars; out.visualNotes = visualNotes; out.storyChars = storyChars; out.storiesOverBudget = storiesOverBudget;
  out.C = { LIVE_CHUNK_CHARS, LIVE_BUDGET_CHARS, LIVE_KEEP_CHARS, VISUALS_LIVE_MAX, VISUALS_LIVE_HIGH, VISUALS_SAVED_MAX };
`);
const L = {}; fn(L);
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

const sentence = (i) => `Sentence number ${i} of the brainstorming session about the toll keeper and the river crossing.`;
const mk = (n, visuals = 0) => {
  const finals = []; for (let i = 0; i < n; i++) finals.push({ t: i * 4, text: sentence(i) });
  const vis = []; for (let i = 0; i < visuals; i++) vis.push({ at: 1700000000000 + i * 15000, tag: 'F-' + String(i + 1).padStart(4, '0'), question: i % 3 ? '' : 'what is this', caption: 'A sketch of the ferry ' + i + ' — ' + 'x'.repeat(300) });
  return { id: 'st_test', startedAt: Date.now() - n * 4000, finals, interim: 'and the last', visuals: vis };
};

// 1. nothing recorded yet → still a block (the sentence in progress) and no frozen chunk
L.set(mk(0));
let lb = L.liveBlocks();
assert(lb && lb.blocks.length === 1 && lb.frozenCount === 1 && lb.tail.includes('[still being spoken]'), 'empty session: intro block + tail with the interim');

// 2. short session: no frozen chunk, tail holds everything
L.set(mk(10));
lb = L.liveBlocks();
assert(lb.blocks.length === 1 && lb.tail.includes(sentence(9)) && lb.tail.includes('words so far'), 'short session: everything in the tail');

// 3. medium session: frozen chunks of >= 4000 chars, tail < 4000, order preserved, nothing lost
L.set(mk(400));
lb = L.liveBlocks();
const frozen = lb.blocks.slice(1);
assert(frozen.length > 5 && frozen.every((b) => b.length >= L.C.LIVE_CHUNK_CHARS), 'frozen chunks are at least LIVE_CHUNK_CHARS');
const joined = frozen.join(' ') + ' ' + lb.tail;
let all = true; for (let i = 0; i < 400; i++) if (!joined.includes(sentence(i))) { all = false; break; }
assert(all, 'every sentence present once chunked');
assert(joined.indexOf(sentence(100)) < joined.indexOf(sentence(300)), 'order preserved');
assert(lb.blocks[lb.frozenCount - 1] === frozen[frozen.length - 1], 'cache mark lands on the last frozen chunk');

// 4. stability: adding sentences does not change frozen chunks (cache-friendly)
const st = mk(400); L.set(st);
const before = L.liveBlocks().blocks.slice(1);
st.finals.push({ t: 1600, text: sentence(400) }); st.finals.push({ t: 1604, text: sentence(401) });
const after = L.liveBlocks().blocks.slice(1);
assert(before.every((b, i) => after[i] === b), 'earlier frozen chunks are byte-identical after new sentences');

// 5. budget: a huge session drops the oldest chunks with hysteresis and reports the omission
const big = mk(4000); L.set(big);   // ~400k chars
lb = L.liveBlocks();
const charsNow = lb.blocks.slice(1).reduce((n, b) => n + b.length, 0) + lb.tail.length;
assert(charsNow <= L.C.LIVE_KEEP_CHARS + L.C.LIVE_CHUNK_CHARS, 'over budget → trimmed to about LIVE_KEEP_CHARS (' + charsNow + ')');
assert(/The first \d+ words of this session \(up to [\d:]+ in\) are left out/.test(lb.blocks[0]), 'intro reports the omitted words and time');
assert(!lb.blocks.join(' ').includes(sentence(0)) && lb.tail.includes(sentence(3999)), 'oldest text gone, newest kept');
const dropA = big.liveDrop;
big.finals.push({ t: 16000, text: sentence(4000) });
L.liveBlocks();
assert(big.liveDrop === dropA, 'no further drops right after trimming (hysteresis)');

// 6. visual notes: frozen after the words, capped with hysteresis
const v = mk(50, 100); L.set(v);
lb = L.liveBlocks();
const noteLines = (lb.blocks.join('\n') + '\n' + lb.tail).split('\n').filter((l) => l.startsWith('- ') && l.includes('A sketch of the ferry')).length;
assert(noteLines <= L.C.VISUALS_LIVE_HIGH && noteLines >= L.C.VISUALS_LIVE_MAX - 8, 'live visual notes capped (' + noteLines + ' of 100)');
assert(lb.blocks.some((b) => b.startsWith('VISUAL NOTES')), 'visual notes carry their heading');
assert(/earliest of its 100 visual notes are left out/.test(lb.blocks[0]), 'intro reports omitted notes');
assert(lb.blocks.findIndex((b) => b.startsWith('VISUAL NOTES')) > 1, 'notes come after the words');

// 7. saved storyline notes capped and counted
const saved = { text: 'x'.repeat(1000), visuals: mk(0, 200).visuals };
const vn = L.visualNotes(saved);
assert((vn.match(/\n- /g) || []).length === L.C.VISUALS_SAVED_MAX && /earliest of 200 notes/.test(vn), 'saved storyline keeps the newest VISUALS_SAVED_MAX notes');
assert(L.storyChars(saved) === 1000 + vn.length + 400, 'storyChars counts the notes');

// 8. liveChars matches what is sent; storiesOverBudget uses it
L.set(mk(400));
assert(L.liveChars() > 0 && L.liveChars() === L.liveBlocks().blocks.reduce((n, b) => n + b.length + 2, 0) + L.liveBlocks().tail.length, 'liveChars consistent');
L.set(null, false);
assert(L.liveBlocks() === null && L.liveChars() === 0, 'nothing when not listening');
console.log(process.exitCode ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED');
