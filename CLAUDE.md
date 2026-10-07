# Lens Loop — baseline for every future change

Lens Loop is one file, `index.html` (plus `pcm-worklet.js`), published by GitHub Pages from `main` at
https://ahmetkartal-99.github.io/lens-loop/. The branch **`baseline`** on GitHub marks the state the author
approved (the same commit also carries the local tags `baseline` and `baseline-<date>`; some sessions cannot
push tags, so the branch is the one that is always there). Everything in the inventory below exists at the
baseline and **must survive every change**. A feature is never removed, narrowed, or quietly degraded unless
the author asks for exactly that in the current conversation — an earlier session once stripped the hands-free
feed and it had to be restored commit by commit. When unsure whether something is still intact, diff against
the baseline: `git fetch origin baseline && git diff origin/baseline -- index.html`, or read
`git show origin/baseline:index.html`.

## Rules

- The Claude API key and the ElevenLabs key are never committed or embedded in the page; they live only in the
  `#key=…&stt=…` link fragment and the phone's storage. The Google OAuth client ID is public and stays in the page.
- Model and effort come from the two constants near the top of the script (`MODEL`, `EFFORT`); settings cannot
  override them past the current open.
- Keep it one self-contained file: no build step, no framework, no external script beyond what is already loaded.
- Bump the `BUILD` stamp (near `MODEL`/`EFFORT`) with every change: it is shown at the foot of Settings and is what
  `freshBuild` compares to reload a phone that is still running a cached build.
- Commit messages end with the attribution lines the session asks for; push to `main` only after the tests below pass.
- When a change is approved by the author, move the baseline to that commit: `git push -f origin main:baseline`
  (and, where tags can be pushed, `git tag -f baseline && git push -f origin baseline`, plus a dated tag).

## Must-keep inventory

1. **Hands-free loop.** Start opens the camera and microphone together, keeps the screen awake, snaps a frame every
   N seconds (5–600, default 15), watches the picture twice a second and sends anything new that holds still
   (settled, ≥3 s apart), skips a picture that has not changed since the last frame sent, and stops with Stop or
   "Lens, stop recording". Busy policy (latest/skip), image size, max output tokens, zoom chips, upright photo.
2. **Snap cache.** The last 20 frames' signatures keep their answers (`snapCache`, with `readPos`): a picture that
   already has an answer shows it again without a request, opens the reader and resumes where reading stopped.
3. **Metered feed.** Every camera answer that is text to read aloud opens the reader by itself (`openReader(..., { force: true })`) and
   plays word by word at `wordSecs` = 1.5 s per word (−/+ 0.25–4 s, Auto/Pause); `closeReader` saves the position.
   Lyrics layout (`phrasesOf`, `layoutReader`, `paintReader`): phrases as `.ph` divs, the live one `.on` biggest
   and bright in the upper part of the box, earlier ones `.done`, the live word `.w.cur`. The reply streams into
   the panel as soon as its first sentence is in (`streamToPanel` → `growReader`, `reader.streamId`), and the
   text on screen is never replaced while the camera stays on its scene (`shownSig`, diff < 12).
   The feed is **not full-screen**: with the `feed` class it takes the answer panel's place over the lower part
   of the camera (dark, translucent, `.reader.feed`, the reader element lives inside `.stage`), so the status
   bar, the camera strip and the Snap/Stop buttons stay visible and tappable. Only the manual Read view fills
   the screen. Both turn with the phone's tilt exactly like the answer panel (`applyPanelRotation`, `turnedCss`);
   sideways, the panel grows up to the top bar's top edge (over the camera strip and the header).
   **Your voice leads** (`heardSpeech` → `voiceFollow`, `feedReader(…, wide, from)` returns the match): while you
   speak the highlight follows the words you say anywhere in the text (the last up-to-six words aligned over every
   window, ≥60 % agreeing with a real word among them, nearest window on ties; a lone word only nudges forward) and the timer pauses, resuming 5 s after you stop. Real time:
   `voiceDisplay` advances between partials at the measured reading pace with a `VOICE_LAT` lead, capped at
   three words past the last match; the worklet streams 100 ms chunks (`Int16Array(1600)`, both copies).
   **Nothing changes while you talk** (`holdingForSpeech`, `S.quietSec` = 25): no camera text is generated
   (`snap` holds, `heldSnap`) or shown (`finish` parks the answer in `heldReq`) until the quiet spell has
   passed; your own spoken questions show at once. By voice: "Lens, hold" (`heldByVoice`) keeps the text until
   "Lens, next" (which also skips the quiet spell); "Lens, again / slower / faster / pause / play" drive the panel.
   Every answer, photo or not, becomes a note in its storyline; the Drive `.txt` lists them in full.
   **Documents page by page** (`docFrames`, `docFramesFor`, `rememberFrame`/`forgetFrame`): the frames of the last
   `DOC_FRAMES_MINUTES` = 50 minutes (the newest `DOC_FRAMES_SEND` = 24 of up to `DOC_FRAMES_KEEP` = 48 kept) go into
   every request before the current one (not for a role-play card — see 13), oldest first, the last one cache-marked; the
   session's open tail now rides in the message after them (`buildSystem` returns `{ blocks, tail }`) so the
   frames stay cached. The reply's third line `FRAMES: continues|new` (`splitAnswer(...).frames`): `new` waits
   for `readingUnderWay()` to end before display; `nothing to read` (head) keeps the text, is never cached or
   recorded, and sets `nothingFrame`. Scene comparison: `sameScene`/`nearScene` (mean + share of cells off by
   >20, 48×36 cells) against the shown frame, the empty scene and the last sent frame; when alike but not
   identical (mean < 40) `looksSame` asks `PAGE_CHECK_MODEL` (Haiku) SAME/DIFFERENT (`pageCheckBusy`).
   **Memory first** (`recall` → `memoryHit`/`cacheHit`): every visual note keeps the picture's fingerprint
   (`sig`, base64 of the 32×24 grey signature) and the whole `text`; a matching picture or question is answered
   from memory with no request, labelled `[memory · Google Drive]` / `[memory · this phone]`; fresh answers are
   labelled by what they drew on, `[Claude API · your storylines | this session | general knowledge]`
   (`sourceLabel`, `apiSource`, `#readerSrc`, the answer meta line). Every fresh answer comes from the model and
   effort named at the top of the script (Fable 5.1 at max), which is told the reader is waiting hands-free.
4. **Read-along.** The reader shows the text large with the Apple-Music-style highlight (`.w`, `.w.read`,
   `.w.cur`): when opened by hand with no session running it follows the reader's own voice (`feedReader`, phone
   or cloud engine); when forced open during a session it auto-scrolls instead. A+/A− sizing.
5. **Recording.** ElevenLabs Scribe v2 Realtime through an AudioWorklet (AGC, 16 kHz PCM, single-use token per
   connection, key terms: the personal glossary `S.sttTerms` first, then saved-storyline names; `language_code`
   the phone's language unless chosen), with keepalives, a watchdog that replaces a dead or silent
   connection and never gives up (forced reconnects back off 30 s → 5 min), microphone reacquire, audio-engine
   resume; phone dictation as fallback. "Lens, …" voice commands (question, look at this, new chapter, stop).
   Draft saved every utterance; a cut-off recording is restored on the next open and digested.
6. **Storylines.** Stop saves the session to IndexedDB, Claude writes title/summary/key terms. Every request
   carries the index of all storylines plus full transcripts within `STORY_BUDGET_CHARS`; a routing call picks
   storylines when the library is bigger; the storyline block is cache-marked. Sheet: rename, read, read aloud,
   untick, delete, export/import JSON.
7. **Live session in every request, no time limit.** The recording in progress goes in after the saved
   storylines as frozen ~4k-character blocks (`liveBlocks`, cache mark on the last frozen one) plus an open tail
   with the newest sentences, the sentence in progress and a `[time, words]` line; past `LIVE_BUDGET_CHARS`
   (240k) the oldest blocks drop a quarter at a time with an omission note. Visual notes are capped
   (`VISUALS_LIVE_MAX/HIGH`, `VISUALS_SAVED_MAX`) and counted in the budget. Nothing stops a session by the clock.
8. **Visual notes.** Every analysed photo is kept with its storyline (IndexedDB `frames`), uploaded to Drive as a
   JPEG with Claude's description, and listed in the storyline's record and prompt.
9. **Google Drive mirror.** OAuth by redirect (works in Safari and Home Screen apps). With `S.driveHelper`
   set (the web-app URL of `drive-helper.gs`, a Google Apps Script holding the client secret), the sign-in is the
   authorization-code flow with offline access: the helper redeems the code (`driveHelper`, a plain text/plain
   POST so no preflight) and renews the access token from the refresh token five minutes before expiry
   (`driveRenewWithHelper`, also on a 401) — permanent, hands-free, any browser. It also renews on every open after
   the hour has lapsed (`silentRefresh`, then `driveCheck` every 30 s, on returning to the foreground and on `online`);
   a passing failure keeps the refresh token and retries on a backoff (`driveRetryDue`, 15 s doubling to 10 min, a
   30 s timeout per request) and stays off the screen the first time; only `invalid_grant` — read from the error's
   `code`, since Google's description never names it — asks for a fresh Connect. The startup "sign-in has expired"
   banner appears only when nothing will renew by itself, and a fresh token clears any Drive banner (`storeDriveToken`).
   A helper reply without an access token is never a success: waking from idle, the script can answer a POST with its
   doGet greeting (`{ ok, helper: "lens-loop" }` — measured on the real one: 11 s, nothing redeemed), so `driveHelper`
   asks again at once (up to three tries) and otherwise fails as a passing error. With a permanent sign-in the Drive
   row says "Connected for good" while the hourly key is fetched and hides Connect; Sync fetches the key first.
   Files can vanish from Drive while the phone still holds their addresses: `drive()` errors carry `status` and
   `notFound`; `syncDrive` looks directly at any remembered address the listing lacks and, when the file is really
   gone, forgets it and copies the storyline afresh; `pushStory` turns an update that meets "not found" into a new
   file on the spot (the live transcript too); one storyline's failure never stops the others, and renames stop
   asking about a file that is gone.
   Without the helper: implicit
   flow, silent `prompt=none` refresh on open, hidden-frame renewal (`driveRenewSilently`; the framed copy of
   the page posts the fragment to the parent and stops — see the top of the script). Two-way sync of
   storylines, the live transcript pushed every 8 s, audio in 2-minute parts, catch-up of everything pending
   after a reconnect, uploaded blobs pruned from the phone. The helper's web-app address is the built-in default
   (`DRIVE_HELPER_URL`, public by design; Settings → Drive helper overrides it). The client secret never goes in
   the page or the repo.
10. **Recovery.** A frame whose request failed is sent again on the next tick even if the picture did not move
    (`retryFrame`, sooner with backoff after a passing failure); a failed spoken question is asked again once;
    a camera the phone took away is reopened (`cameraCheck`); wake lock and engines resume on `visibilitychange`.
11. **Always the latest build.** `freshBuild` fetches the page past the cache shortly after opening and reloads
    once when the server's `BUILD` differs (never mid-session or during a sign-in bounce); the build stamp is at
    the foot of Settings. A declined motion permission shows a banner instead of silently leaving text unturned.
12. **Answer panel.** "ANSWER:" headline, storyline tag, cost/latency readouts (cached tokens counted), history
    of 40, copy, Read button, settings sheet, intro text, privacy/terms pages, PWA icons. **A verdict stays in the
    panel, big and bold, and never opens the feed** (`verdictOf`, `isVerdictText`, `showVerdictPanel`; `.big-answer
    .verdict`, `.verdict-key` 104 px in the accent colour, `.verdict-text`): the letter of a multiple-choice option
    ("B) …", "C.", "(D)", "3)"), Yes/No/True/False, or a bare value with units — never an answer with a ROLE:/TASK:
    line, nor a title that merely starts with "A " or "B-". `displayAnswer`, `streamToPanel` and `showRecalled` route
    on it; a feed open over the panel is closed first. Text to read aloud (role lines, a letter, a description) keeps
    the feed. `test/verdict.test.js` fixes the boundary.
13. **Tasks: role-play cards and writing tasks** — automatic, nothing to switch on (`S.roleAuto`, default on;
    `S.sceneCharacter` = optional voice notes). The author's spec: a SPEAKING role-play card (a SETTING, a role —
    DOCTOR, PATIENT, CARER… — and a TASK list) is answered IN that role — the lines that carry out the tasks, for him
    to read aloud with voice-follow; a WRITING task ("Writing Task: write a letter of referral…", with case notes on
    the pages before) gets the finished piece itself (`SYSTEM_RULES` rule (2): format and length as asked, facts from
    the case notes among the earlier frames; reply header `TASK: <name>`, `splitAnswer(...).task`); and either stays
    on screen EXACTLY AS IT IS until a DIFFERENT task appears, whatever else the camera sees. The lock has a `kind`
    (`'role'` | `'task'`); a task lock keeps `seen` = the pages the text was written from (`req.seenFrames`), which
    `snap()` counts among the known pictures, so showing the case notes again costs nothing. **A writing task spans
    pages, so it is collect-then-write**: the quick look answers `NOTES | <subject>` for a page of case notes
    (collected by `collectPage` — `rememberFrame` + `roleMaterial`, no full request, the screen unchanged, the status
    line and recording strip say "case notes collected (n pages)" via `taskNote`) and `WRITE | <what>` for the page
    with the instructions (→ `frame.write`, `frame.fresh` so memory is bypassed, the usual request with the pages
    among the earlier frames and a line saying it is a writing task). The paired look for a task lock answers SAME /
    MORE (another page of the same task → gathered, and the piece written again ONCE after `ROLE_MORE_SETTLE_MS` = 6 s
    without a further page: `roleMoreGo`, `frame.writeMore`, never once per page) / `TASK | <what>` (a different
    writing task) / `NOTES | …` (another subject's notes: collected, the lock stays) / NEW | … (a role card) / OTHER /
    NONE. The quick look and the rules say outright that a writing task and its case notes are NOT a role-play card
    (that misread sent a referral task down the speaking path). Stop, "Lens, next", a spoken question and the
    setting clear the collected pages too (`clearMaterial`).
    Every new picture first gets a quick look by `PAGE_CHECK_MODEL` (`roleCardCheck`: `CARD | role | setting | task`
    or `NONE`; with lines locked it compares the new picture with the locked card: `SAME` / `NEW | …` / `NONE`), then
    `decideRole`: a (new) card → a focused request (`frame.role` → `send` with `scene`: ONE card, no earlier frames, no
    "FRAMES:" line, `buildSystem(prefer, true)` = only `SCENE_SYSTEM_RULES` + voice notes, the role named in the
    prompt) and `roleLock` from the moment it is asked; `OTHER` with a lock (a question, a problem, a multiple-choice
    item — a different task) → the lock lets go and the usual answer follows; `SAME`/`NONE` with a lock → nothing changes, no full request
    (`roleKept` keeps a still desk from being looked at on every tick); `NONE` without a lock → the usual answer, and
    `roleRelook` looks at that picture twice more, ≥4 s apart (a card first caught out of focus). The prompts forbid
    describing or reading the card back. **The full model is a detector too**: `SYSTEM_RULES` ends with the role-card
    rule, so a usual request whose answer carries a `ROLE: <role>` second line (`splitAnswer(...).role`; header lines
    STORYLINE/FRAMES/ROLE in any order) is promoted in `finish` to a role answer and locked — the quick look missing a
    card never leaves it described. The verdict rides on the frame (`frame.roleLook`: `card:X`, `card:X (by the
    answer)`, `no role card seen`, `same card`, `look failed`) and shows at the end of the answer's meta line, so a
    screenshot says which path ran. Memory and the snap cache are keyed by "role card or not" (`req.scene` →
    `note.scene`, `cacheFind(sig, isRole)`, `recall(sig, q, isRole)`): a card's earlier description is never replayed
    as its role lines; a visual note from before this rule (no `note.rv`) is not replayed on the usual path either
    while Role-play cards is on — that picture is answered afresh once and remembered anew. The lock lets go on
    Stop, "Lens, next", a spoken "Lens, …" question, or switching the setting. `parseRoleLook` reads the quick
    look's verdict as JSON, `CARD | … | … | …` or prose ("role: Patient"), never as "role-play".

## Tests (run before every push)

- `node --check` on the script body, then `node test/live-prompt.test.js` (prompt assembly, no browser) and
  `node test/role-parse.test.js` (the role-card verdict read however a model writes it) and `node test/verdict.test.js`
  (which answers are shown big in the panel, which go to the feed).
- `node test/session.e2e.js`, `node test/drive-renewal.e2e.js`, `node test/fresh-build.e2e.js`,
  `node test/memory-voice.e2e.js`, `node test/drive-helper.e2e.js`, `node test/drive-expired-open.e2e.js` (the app
  opened hours later: a silent renewal, retries on a backoff, a dead token in Google's real shape, and the banner only
  when a tap is truly needed), `node test/drive-vanished.e2e.js` (files deleted from Drive behind the app's back,
  against an in-memory Drive), `node test/role-cards.e2e.js` (desk → a role card caught blurred then legible → desk →
  the same card → a different card → desk, against a controlled camera: the role's lines appear, stay locked, change
  only for a different card), `node test/latency.e2e.js` (audio cadence and
  highlight reaction time), `node test/document.e2e.js` (a document page by page, the desk, a new subject) and
  `node test/hour-session.e2e.js` (an hour of dictation compressed into half a
  minute through the real ElevenLabs engine path with the socket mocked: draft, prompt, audio parts, saved
  storyline, questions before and after a reload) (headless Chromium via Playwright,
  `npm i -D playwright` if missing): a real session with a fake camera, fake dictation and a fake Claude
  endpoint; checks request bodies, cache marks, retries and the Drive renewal frame.
