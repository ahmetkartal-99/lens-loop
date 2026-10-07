// Unit test of the live role play's pieces, extracted from index.html: who plays whom, the rules for a turn, the
// message list with its clock note, and the spoken ways in and out ("I'm ready", "Lens, next", "end role play").
// Run: node test/convo.test.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pick = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('could not locate ' + from); return html.slice(a, b); };
const code = pick('  function convoRules(', '  const DIGEST_RULES =') +
  pick('  let convo = null;', '  function startConvo(') +
  pick('  function convoMessages(', '  async function convoRequest(') +
  pick('  function parseCommand(', '  function handleUtterance(');
const make = (S) => new Function('S', code + '; return { convoRules, counterpartOf, convoMessages, parseCommand, READY_RE, setConvo: (c) => { convo = c; } };')(S);
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };

// who plays whom: the model is the card's role, the user the other party
const S = { sceneCharacter: '', convoMinutes: 5 };
const X = make(S);
assert(/^the patient/.test(X.counterpartOf('Doctor')) && /^the patient/.test(X.counterpartOf('Nurse')) && /^the patient/.test(X.counterpartOf('GP')), 'a doctor\'s or nurse\'s card: the user is the patient');
assert(/^the doctor or nurse/.test(X.counterpartOf('Patient')) && /^the doctor or nurse/.test(X.counterpartOf('Carer')) && /^the doctor or nurse/.test(X.counterpartOf('Relative')), 'a patient\'s, carer\'s or relative\'s card: the user is the doctor or nurse');

// the rules for a turn
const c = { role: 'Patient', counterpart: X.counterpartOf('Patient'), brief: '**Setting:** Medical ward\n**Tasks:**\n- Explain that you are worried about going home', history: [], startedAt: Date.now() };
const rules = X.convoRules(c);
assert(/You are playing the Patient/.test(rules) && /The user plays the doctor or nurse/.test(rules), 'rules: the model is the Patient, the user the doctor');
assert(/Stay in character/.test(rules) && /one to three sentences a turn/.test(rules), 'rules: in character, conversational turns, not a speech');
assert(/Ask for more information/.test(rules) && /two or three realistic worries or objections/.test(rules), 'rules: asks for information, raises two or three worries');
assert(/\[End of role play\]/.test(rules) && /final exchange/.test(rules), 'rules: the clock and the closing line');
assert(/never give the user feedback/.test(rules) && /never mention being an AI/.test(rules), 'rules: no feedback, no breaking character');
assert(/BRIEFING:\n\*\*Setting:\*\* Medical ward/.test(rules), 'rules: the briefing is in the prompt');
assert(!/VOICE NOTES/.test(rules), 'rules: no voice notes when none are set');
S.sceneCharacter = 'Nervous, speaks quickly.';
assert(/VOICE NOTES for your character: Nervous, speaks quickly\./.test(X.convoRules(c)), 'rules: the voice notes from settings are passed on');
S.sceneCharacter = '';

// the messages: the card's photo opens, the dialogue follows, the user's words last with the clock
c.frame = { b64: 'AAAA' };
c.history = [{ role: 'user', text: '[I am ready. Open…]' }, { role: 'assistant', text: 'Hello doctor.' }];
X.setConvo({ startedAt: Date.now() - 42 * 1000, ended: false });
let m = X.convoMessages(c, 'Good morning, how are you feeling?');
assert(m.length === 5 && m[0].role === 'user' && m[0].content.some((b) => b.type === 'image' && b.source.data === 'AAAA') && /This is the role card/.test(m[0].content[0].text), 'messages: the role card\'s photo opens the conversation');
assert(m[1].role === 'assistant' && /I am the Patient/.test(m[1].content), 'messages: the model\'s standing answer follows');
assert(m[2].role === 'user' && m[3].role === 'assistant' && m[3].content === 'Hello doctor.', 'messages: the dialogue so far');
assert(m[4].role === 'user' && /^Good morning, how are you feeling\?\n\n\[Elapsed 0:42 of about 5 minutes\.\]$/.test(m[4].content), 'messages: the user\'s words with the clock (' + JSON.stringify(m[4].content) + ')');
assert(m[0].content.find((b) => b.type === 'image').cache_control, 'messages: the card image is cache-marked');
X.setConvo({ startedAt: Date.now() - 4 * 60 * 1000 - 10 * 1000, ended: false });
m = X.convoMessages(c, 'ok');
assert(/\[Elapsed 4:10 of 5 minutes — the time is nearly up; steer towards a natural close\.\]/.test(m[4].content), 'clock: at 4:10 of 5 the close is steered (' + m[4].content + ')');
X.setConvo({ startedAt: Date.now() - 5 * 60 * 1000 - 3 * 1000, ended: false });
m = X.convoMessages(c, 'ok');
assert(/this is the final exchange: close the conversation and end with "\[End of role play\]"/.test(m[4].content), 'clock: at 5:03 of 5 the final exchange is called (' + m[4].content + ')');
S.convoMinutes = 8;
X.setConvo({ startedAt: Date.now() - 5 * 60 * 1000 - 3 * 1000, ended: false });
m = X.convoMessages(c, 'ok');
assert(/\[Elapsed 5:03 of about 8 minutes\.\]/.test(m[4].content), 'clock: the length comes from settings (' + m[4].content + ')');
S.convoMinutes = 5;
c.frame = null;
m = X.convoMessages(c, 'ok');
assert(m[0].content.length === 1 && m[0].content[0].type === 'text', 'messages: no photo when the card\'s frame is gone (memory replay)');

// the spoken way in: plain "I'm ready" (no wake word) in its common shapes; and not just anything
const ready = ['I\'m ready', 'im ready', 'I am ready.', 'Okay, I\'m ready', 'Ready', 'ready!', 'We\'re ready', 'Let\'s start', 'let\'s begin', 'Start the role play', 'start roleplay'];
for (const t of ready) assert(X.READY_RE.test(t), 'ready: ' + JSON.stringify(t));
const notReady = ['I\'m ready to go home', 'Are you ready?', 'ready for the next page', 'I am not ready', 'the patient is ready'];
for (const t of notReady) assert(!X.READY_RE.test(t), 'not ready: ' + JSON.stringify(t));
// with the wake word: a command of its own
assert(X.parseCommand('Lens, I\'m ready').kind === 'ready' && X.parseCommand('Lens ready').kind === 'ready' && X.parseCommand('Lens, start the role play').kind === 'ready', 'command: "Lens, I\'m ready" / "Lens, start the role play"');
assert(X.parseCommand('Lens, end the role play').kind === 'endplay' && X.parseCommand('Lens, stop role play').kind === 'endplay' && X.parseCommand('Lens, finish roleplay').kind === 'endplay', 'command: "Lens, end the role play"');
assert(X.parseCommand('Lens, next').kind === 'next' && X.parseCommand('Lens, stop').kind === 'stop', 'command: "Lens, next" and "Lens, stop" still themselves');
assert(X.parseCommand('Lens, what is the dose').kind === 'question', 'command: a question is still a question');
assert(X.parseCommand('I\'m ready') === null, 'command: plain "I\'m ready" is not a command (it is the briefing\'s cue, handled by the utterance)');
console.log(process.exitCode ? 'CONVO FAILED' : 'ALL TESTS PASSED');
