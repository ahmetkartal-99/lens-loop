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
   for `readingUnderWay()` to end before display; a reply that is NO ANSWER (`nothingToRead(text, choice)`: the
   head `nothing to read`, OR a title that only describes a blurred or empty frame — `emptyFrameTitle`,
   `EMPTY_FRAME_RE`: "Overexposed, motion-blurred frame — only washed-out white", "Out-of-focus, washed-out pale
   blur", the author's morning captures of Oct 15 came back exactly so, titled instead of "nothing to read" — never
   an option / Yes-No / value verdict, a "No legible text" head aside) keeps the text, is never cached or recorded,
   sets `nothingFrame`, puts the shown meta line back (`shownMeta`) and says "F-0012: nothing to read · keeping the
   answer" (`req.keptNote`, which the readout loop keeps); `renderCurrent` never draws such a reply over the panel
   while it streams (the panel waits, dimmed, until the first line is in, then draws an answer or stays as it was).
   The rules now say so too ("never a title that describes the blur, the glare or the lack of text"). With NOTHING
   on screen yet, "nothing to read" for a screen larger than the view with no block of print in it gets a line
   added before display: "The camera is looking at a blank part of the screen (… cut off on the right and top and
   bottom). Aim it at the question — the zoom then closes in on it — or hold the phone a hand's width further back
   so the whole screen fits." (the author's 07:05–07:14 session: the phone 10 cm from the screen, the question at
   the far corner of the frame or out of it, forty frames of blank page and moiré).
   **An answer is KEPT for ten seconds** (`ANSWER_HOLD_MS`, `holdAnswer` from `displayAnswer`/`showRecalled`,
   `answerHeld`; the author: "if faced with MC questions it shouldn't change its answer for at least 10 seconds and
   stay with the right answer"): once a VERDICT is on screen, `snap` (every source but the button), `watchFrame`
   and the queued `pending` frame stand down until the hold is over — no capture, no quick look, no request, however
   the hand drifts or the zoom settles — and `reschedule` makes the hold's end the next tick, so the next look comes
   then; a spoken question is never held; titles, briefings and letters are not held (the feed has its own
   `readingUnderWay` guard). While a verdict is on screen (< 3 min), every camera request carries it "for
   consistency" (`send`: "the answer on the user's screen at this moment … is "B) 42". If this frame shows the SAME
   question, give that same answer unless this frame shows plainly that a different option is the correct one"), so
   the same question re-framed keeps its answer instead of flickering between readings. `test/hold.e2e.js`: the
   verdict B, the picture moved 3 s later — nothing for the hold; after it the moved picture sent (≥ 10 s), the
   consistency note, a blur-titled reply keeping B with its meta line and status; a different question answered at
   once; "nothing to read" keeping C. Scene comparison: `sameScene`/`nearScene` (mean + share of cells off by
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
    panel, big and bold, and never opens the feed** (`verdictOf(a, loose)`, `isVerdictText`, `showVerdictPanel`;
    `.big-answer.verdict`, `.verdict-key` 104 px in the accent colour, `.verdict-text`): the letter of a
    multiple-choice option ("B) …", "C.", "(D)", "3)", a bare "C"), Yes/No/True/False, or a bare value with units —
    the question's label in front is stripped ("Q1: C) …", "Question 3 — B.", "#4 D)", "1. C)", "Option C:", "The
    answer is B)") — never an answer with a ROLE:/TASK: line, nor a title that merely starts with "A " or "B-".
    **Two layers, so it does not hinge on the model's wording**: the quick look judges the PAGE (`CHOICE` — a
    question with lettered/numbered options, any subject, true/false, fill-in-the-blank → `frame.choice`, meta line
    "a question with options"; with a lock it is a different task and the lock lets go), and with `frame.choice` the
    verdict is `loose`: "C Water…" is option C and even an answer line with no option mark is shown big (no key,
    ≥40 px). The rules tell the model the ANSWER line begins with the option itself (no "Q1:", "Option", "Answer")
    and that the explanation never narrates the frames. `displayAnswer`, `streamToPanel`, `showRecalled` and
    `renderCurrent` route on it; a feed open over the panel is closed first. Text to read aloud (role lines, a
    letter, a description) keeps the feed. `test/verdict.test.js` fixes the boundary, `role-cards.e2e.js` steps 7
    and 3e check the rendered panel.
13a. **Status notices hold.** `setStatus` stamps `statusAt`; the 250 ms ticker leaves a fresh `armed` notice alone
    for `NOTICE_HOLD_MS` = 2.5 s (`noticeHolding`), so "Moving on", "Keeping the Patient briefing", "Case notes
    collected (2 pages)" are readable instead of being overwritten by the session line on the next tick.
13b. **The live role play** (the author's spec, replacing the read-aloud monologue): a speaking role card brings a
    BRIEFING — `SCENE_SYSTEM_RULES`/`SCENE_PROMPT` and `SYSTEM_RULES` rule (1) both ask for it — "ANSWER: title",
    "ROLE: <the role on the card, which CLAUDE plays>", then markdown with exactly **Setting:** / **Your role:** (the
    part the USER plays: the doctor or nurse for a patient's, relative's or carer's card, the patient for a doctor's)
    / **Background:** / **Tasks:** (four or five bullets) and the cue *Say "I'm ready" to begin — I will be the
    <role>.* It is shown in the answer panel like a verdict (never the feed), locked like any role lock, and runs at
    `S.convoEffort` (default `low`, streamed) so it is on screen within seconds; `_…_` renders as italics too.
    **"I'm ready"** (plain, `READY_RE` in `handleUtterance`: "I'm ready", "ready", "let's start", "start the role
    play"; or "Lens, I'm ready" → `parseCommand` kind `ready`) with a role lock whose text is in → `startConvo()`:
    Claude becomes the card's role (`convoRules(c)`: in character, 1–3 sentences a turn, asks for information, raises
    two or three of the card's worries one at a time, works through the tasks, never feedback, never narration; the
    briefing and `S.sceneCharacter` voice notes in the cached system block), the user is `counterpartOf(role)`. Every
    final transcript while `convoActive()` is a turn (`convoHeard`), recorded in the storyline too. **No waiting on
    the pause**: a transcribed sentence goes out AT ONCE as a PROVISIONAL request (`convoSend` → `convoRequest`, the
    reply kept back from the panel), and the pause `S.convoPause` (default 0.6 s on top of ElevenLabs' own 0.8 s
    silence commit; `convoSchedule` → `convoPauseOver`) only decides whether a further sentence folds in (abort,
    resend both: `convoHeard`) or the request is committed (its reply shows, `convoSettle` adds the turn to
    `convo.history`); words said while a committed reply is still coming wait and go as the next turn (`pending`);
    partial transcripts with new words restart the pause (`convoInterim`), empty/repeated ones (keepalives) do not.
    Turns: `max_tokens` 400, streamed at `S.convoEffort` (`low` → first words in about a second; the Settings hint says
    plainly a reply cannot arrive before the model produced it), messages = the card photo (cache-marked) + a
    standing "I am the <role>" + the dialogue + the user's words with a bracketed clock note (`convoMessages`:
    "[Elapsed m:ss of about N minutes.]", "nearly up" from N−1 min, "final exchange … end with [End of role play]"
    from N min, N = `S.convoMinutes`, default 5); "[End of role play]" in a reply, N+1.5 min, "Lens, next", "Lens, end
    the role play", a spoken "Lens, …" question, Stop or Listen stop end it (`endConvo`): the dialogue is saved into
    the storyline as a visual note `rp_…` (transcript "You (the doctor or nurse): … / Patient: …", no clock notes), the
    briefing's lock STAYS so "I'm ready" starts another go and a different card brings a new briefing. Meanwhile
    `snap()` returns at once (the camera waits), the status line reads "Role play m:ss · you are … · Claude is the …",
    the panel shows `.convo-who` / `.convo-you` (the user's last words) / `.convo-line` (30 px, the reply as it
    streams) / `.convo-end`, the meta line the turn, the first word's delay and the effort. `test/convo.test.js` fixes
    the rules, counterparts, messages, clock and the spoken ways in and out; `role-cards.e2e.js` part 5 runs a whole
    role play against the fake endpoint (eager send, fold-in, waiting words, the model's end, a second go, "Lens, next",
    the saved transcript, the camera waiting and resuming).
14. **The screen in the frame, whatever the angle** (the author's spec: "regardless of how acute the angle … it should
    always read the entire screen"). Every capture (`captureFrame`) finds the bright rectangle of the laptop screen
    (or page) in a 192-px grey copy of the sensor frame — `screenQuad`: Otsu's split between the room and the screen,
    which must be BRIGHT (mean ≥ 90) and far brighter than the room (≥ 45 apart; two shades of a dark desk are not a
    screen); then `screenAt(thr)`: every bright region ≥ 1 % of the frame is a candidate with its four corners (the
    diagonal extremes), `fill` (a rectangle ≈ 1, a round lamp ≈ 1.57), aspect (0.4–3.5) and `cut` (which frame edges
    it runs into), and the screen is the largest region SHAPED like one — a rectangle not cut off — else the largest
    cut on one edge, else the largest of all (a window behind the laptop, bigger and cut off, loses to the screen; a
    lamp never merges). Several splits are tried and the LARGEST clean rectangle among them is the screen: higher
    splits toward the 99th percentile when a lit room puts desk, walls and screen on the bright side together (one
    blob off the frame), and LOWER splits (0.75…0.22 × Otsu's, floor 28; they count only when clean, since the
    room's own grey taken in is a blob off the frame) for a screen seen at a STEEP ANGLE — an LCD dims hard
    off-axis, its face runs from dark at the far side (dimmer than the room) to blown-out at the near side, and at
    Otsu's split only the near part is "bright"; the black bezel keeps the whole screen apart from the room, so the
    low split takes in the dim far part. The look is a 320-cell copy (a real 6 mm bezel is three cells wide, so it
    survives the low splits). The author's own framing (the old frames' 48×36 fingerprints on Drive: a smooth
    gradient, dark top to blown-out bottom, bright area at three frame edges) is exactly this: close, steep, the
    screen overflowing — so the zoom-out / ultra-wide path and this low-split path are what his captures hit. Other
    clean rectangles lying close by (their union box ≤ 3× their joint area: the two panels of a page split by a dark
    bar, the boxes of a dark-themed page) are joined and the joined set's own corners used — one screen, straightened
    — or the `union` box when those corners hold no rectangle. **A screen LARGER than the view** (the author's real
    captures of Oct 15, read back from the Captures folder: the phone ~15 cm from the screen looking up at it, the
    page off the right, the top and the bottom even at 0.5×) is a cut-off bright surface at Otsu's split covering
    ≥ 40 % of the frame (`overflow`); at the higher splits its blown-out centre / moiré is a clean rectangle — and
    the old "largest clean rectangle" rule took THAT for the screen (27–39 % wide), zoomed in on it and sent the
    model a patch of white. Now a clean candidate inside an overflowing surface, under 60 % of its area, passes only
    if `ringDark` holds — the ring one to four cells outside its box is under 0.72× as bright as the inside (a real
    screen has its bezel and the desk round it; a patch has the same surface going on): otherwise the cut-off
    surface stays the answer (`test/screen.test.js` 6d; the real captures run through `run-finder.js` confirm it).
    A cut-off screen is STRAIGHTENED too (`captureFrame` rectifies whatever was found): its corners on the cut
    sides lie on the frame's edge, so the part in view comes out with its own edge upright and the lines of text
    level, the room left out — far more legible than the raw frame — and goes with the cut note ("the right edge of
    the screen may lie outside the photo…"); the meta line says "screen cut off on the right — the part in view
    straightened". The night-time dark-desk tests were not enough: a
    real room has walls, a lamp, a silver laptop body; the realistic scenes (lit room, window behind, far screen with
    a lamp, split page) are in `test/screen.test.js` 6c, and the author's own screenshots were pushed through the real
    finder + GPU rectifier as warped "phone photos" (scratch work, not committed). `screenWhy` says why nothing was
    found — then
    `screenFind` adds a margin and `rectify` STRAIGHTENS it with a homography on the GPU (`glInit`, Heckbert
    square-to-quad, `RECT_MAX` 3200 px long side; an axis-aligned crop without WebGL) at the sensor's resolution.
    What goes to Claude is that straightened screen: the overview at `S.imgSize` plus up to 2×2 overlapping closer
    tiles when it holds more pixels than one picture carries (`tilePlan`: `TILE_MIN` 1900, `TILE_SIDE` 1500, 6 %
    overlap; `frameImages` labels them "The same picture in N closer tiles…"), so small print is read at the pixels
    the camera has. The frame also carries `docSig` (the straightened picture's own fingerprint, stricter than the
    hand-drifting frame's: `docChanged`, so a changed question in an unchanged layout is caught — made ONLY when a
    screen was found and straightened/cropped, since on a raw hand-held frame it would defeat the drift tolerance)
    and `leftSig` (the left 55 %: a tab's panel, see 15; always made). Closer tiles are made only when a screen or
    page was found: a desk, a hand, a blur go as one picture. Other bright pieces (`scattered`, `otherFrac`) stop
    the straightening only when they are of a size with the largest (≥ 25 %: the boxes of a dark-themed page →
    the union crop); a lamp or reflection is simply left out. A picture answered FROM MEMORY becomes a known
    picture too (`showRecalled` sets `lastSentFrame`), so the camera resting on it costs no further look. `screenNote` puts "screen straightened · 2 tiles · 1.8×" / "screen cut off on
    the right" on the meta line. `S.screenRead` (default on) switches it. `test/screen.test.js` fixes the geometry.
14a. **Auto-zoom, LIVE** (`frameLoopTick` every 400 ms while running, `S.autoZoom` default on, `zoomCaps` from the
    track): the live picture is looked at for the screen with the captures' own finder (`screenFind(video, w, h)`)
    and the lens moved ONE STEP at a time by the pure decision `framingMove(sc, cur, caps, base, missing)`
    (unit-tested in `test/framing.test.js`, 400 random runs): IN while the screen is under 80 % of the frame (the
    step ≤ 1.6, toward 90 % fill, CAPPED by the nearest frame edge's headroom from `boxFrac` — the lens zooms about
    the centre, so a screen off to one side would run out of the frame first — never past the edge, and no step
    < 1.06); OUT (× 0.72) while an edge is outside the frame (and "the whole frame is bright" counts as cut on every
    side); a touch out (× 0.9) when it fills the frame to its edges; BACK toward the chosen zoom (`baseZoom`, S.zoom
    default 1 = the main lens) once five looks in a row (2 s) saw nothing screen-like; nothing between 80 and 97 %.
    At the widest and still cut: the ultra-wide lens where the phone lists one apart (`wideLens`, once; the loop
    counts as busy meanwhile and `frameAdjusting` holds a capture until it was tried), else the part in view is
    ANSWERED AT ONCE (`cutAtWidest` → `frameSettled`; no more "three captures first") under a banner that stays
    with the answer (`moveBack`, once per 60 s, `banner.dataset.action = 'framing'`, which `send` leaves alone and
    the loop clears once the whole screen is in view): "From here the screen is larger than the camera's view (cut
    off on the right and top and bottom) — the part in view is read and answered. A hand's width further back, the
    whole screen fits." **The camera stays at 4K 16:9** (`openCamera`: 3840×2160 ideal, nothing larger): asking
    for the sensor's full 4:3 (4032×3024, tried Oct 15 00:40) gave the author's iPhone BLACK frames for seconds at
    a time ("bright side 0, the rest 0" in the Captures of 02:21–02:31, a black picture even sent to the model) and,
    after the camera was taken away and returned, a 192×144 stream — the "camera turns all black" and the blurry
    white preview of his screenshots. **`applyZoom` tries the advanced form first** (`{ advanced: [{ zoom }] }`,
    the one proven to move the zoom and leave the frame size alone), the plain form only if refused. **The camera
    watchdog** (`cameraCheck`) now also reopens the camera when the live picture has been BLACK for 5 s
    (`blackSince`, set by the live loop from the finder's "the frame is black"; 6 s of black, and only 8 s after
    the camera opened) or the stream came back at a TWENTIETH of the pixels this camera gave before in the session
    (`camBestPixels`; a camera that never gave more than 320×240 — a test fake, a cheap webcam — is left alone),
    with the placeholder saying "Camera restarting…"; a black capture is never sent nor remembered (`snap`: "The
    camera shows nothing yet"). The finder tells a black frame (99th percentile < 10) from a frame all of one grey
    (nothing to crop, as before) from a frame all of one bright shade (the screen fills the view) — Otsu cannot
    split a uniform frame, so these go by percentiles, not by its class means (a first cut that used the means
    called every uniform test frame "black" and reopened the camera for ever: `test/screen.test.js` 4 fixes the
    three verdicts). A cut-off region is straightened only when it is screen-shaped and sizable (`straight` and
    coverage ≥ 25 %); a cut-off sliver (a bright bar, a stripe) is not the screen's outline, and the frame goes whole. **The screen FILLING the view**
    (the phone close, or far off to one side looking across the screen at a question at the far end — the author's
    photo of a radical-expression item at the top left of a screen seen from the far right): the finder returns
    "the whole frame is bright (118 – 171): the screen fills the view" (both sides of Otsu's split bright) or a
    region cut on all four sides — either is `fills`: the frame goes as the screen does, with its closer tiles,
    the model told "the screen is larger than the photo — on every side", the meta line "the screen fills the view —
    read as it is · 4 tiles · text close-up". It is no longer "nothing much brighter than the room" (which sent the
    frame as ONE 1568-px picture with the question 230 px wide, unreadable) and no longer makes the loop ease back
    to 1× while the screen overfills the frame. **The text close-up** (`inkBox` / `inkBoxOf`, unit-tested in
    `test/ink.test.js`): on an 800-px grey copy (a question block 4 % of a 4K frame across is still two cells) in
    16×16 cells, ink is what lies WELL below the cell's OWN background (its 85th percentile): 45 or more, and three
    tenths of the ground — local, since the far side of a screen seen from an angle is dim all over and print there
    is dark on grey — and NEUTRAL (chroma ≤ 40: the coloured fringes of a moiré, a picture, a highlight are not
    print); a cell holds print when 1.5–50 % of it is ink on a page-like ground (≥ 50 and ≥ 0.4 × the picture's
    white), the ink is strokes, not blocks (when ≥ 70 % of a cell's ink lies in rows or columns dark from end to end
    it is a bar, a stripe, a block of colour — the role-card test's stripes and checkerboards), AND the page is FLAT:
    at most three tenths of the cell lies between the ink threshold and 15 below the ground. That last rule is what
    tells print from a MOIRÉ — the screen's pixel grid beating with the sensor's, a dense weave of dashes a few of
    which are dark enough to count as ink: measured on the author's own captures (the blank, moiré-banded frames of
    07:06–07:14 on Oct 15, `cell-stats.js` scratch work) a moiré cell has 36–54 % of its pixels in that in-between
    band, a print cell 3–30 % — ink depth, adjacency and chroma alone did not separate them. Touching cells cluster
    and the cluster with the MOST CELLS is the text (a block of lines is extensive; a cursor, a speck is compact);
    (cells one empty row apart join too — the lines of a widely spaced question, a stem and its options, are one
    block; columns apart stay apart; a cluster that never runs two cells wide — a column of specks, a seam — is no
    print at all; and the BROWSER'S BARS along the top edge — a band of print touching the top, five rows at most
    — give way to a cluster of its own below them with a third of the cells: from a distance the tab bar can
    outweigh the question under it, `test/ink.test.js` 8); `strong` marks a BLOCK of print (≥ 6 cells, some row ≥ 3 cells wide, some
    column ≥ 2 deep — `rowMax`/`colMax`;
    the cells along the edge of a moiré band, half page half weave, make a line or a staircase, never a block;
    density was tried and rejected: real paragraphs fill 10–30 % of their box). Only a strong block goes CLOSE UP —
    its box with a margin, cropped from the picture at the camera's own pixels and sent as one more image ("The
    text in the same picture, close up … read the small print here") whenever the print covers < 55 % of the
    picture — the author's far-right photo yields the question and all five options crisp at 454×655 from a
    2016-px frame; his blank/moiré frames now yield none (they used to send the model a "close-up" of the weave,
    22–53 % of the frame, and the loop zoomed INTO it). On a screen LARGER than the view the close-up is cut from
    the FRAME as the camera saw it (`rawInk`, sharp, never resampled — the straightened part in view may stretch
    the far end threefold and leave it soft; the label says it is not straightened, lines may slope, letters be
    squeezed) and ANY print found goes (a one-line question, a small block at the far end: `strong` not required
    there; a whole screen in view keeps the block rule and the straightened picture); the margin round the box is
    a cell and a half (the last option of the author's GMAT item sat half outside the old three-quarter margin);
    print counts only when it lies ON the screen the finder found (`inkOnScreen`: the box's centre inside
    `boxFrac` — his fingers at the frame's edge and the keyboard below the bezel are "print" to the cell test);
    and every close-up has its CONTRAST EVENED (`evenContrast`: a 6×6 grid, each cell's 3rd and 92nd percentiles
    as its black and white, interpolated between cell centres, every pixel stretched between them on all three
    channels; a cell with under 60 between black and white keeps its white and takes its black 60 below, so blank
    page is not blown up into speckles) — print on the dim far side of a screen seen from an angle, grey on darker
    grey, reaches the model black on white; his 10:53 capture at 0.7× yields the GMAT question and all five
    options crisp from the 1024-px Drive copy alone. **A screen larger than the view is FRAMED BY ITS PRINT**
    (`framingMove`'s `ink` argument, from `inkBox(video)` on the live frame whenever the screen is cut;
    `frameAdjusting` gets the capture's own `screen.ink`): a BLOCK whole in view is closed in on as far as its
    headroom to the nearest frame edge allows (`stepIn`'s cap — the lens zooms about the middle, so the step stops
    where the block would reach an edge; a question in a corner gets what the corner allows and never leaves the
    view; the step a tenth short, × 0.9; no `central` gate any more — the cap is what keeps the block in view),
    not within 8 s of a step out from print (`frameInHoldUntil`, `ink.noIn`); a LARGE block (`FRAME_BIG` 0.4 of
    the frame) running off an edge → ONE step out (× 0.72, why 'text'), then another look; a SMALL block or a line
    at an edge (the question at the top of the view with its page header above, the browser's tab bar) → the lens
    STAYS — a step out would only shrink it and the close-up reads what is in view (the author's 10:53 session:
    the loop used to step out from 0.7×, where the question was a block, to 0.5×, where it was nothing — the
    "zooming out" captures in his Captures folder); a line or a speck whole in view → stays; only with NO print in
    view does a cut-off screen go out, to find some. **The SWEEP** (`seeking`, `inkMissing`, `INK_MISS` 5 looks,
    `SEEK_STEP` 1.2, `SEEK_DWELL` 1.5 s, `SEEK_REST` 60 s; `framingMove`'s `seek` = 'step' | 'hold'): at the
    widest zoom with the screen cut off and no BLOCK of print in sight for five looks — print too small to count
    there (his question: nothing but the tab bar at 0.5×, a block at 0.7×) — the lens sweeps IN toward the chosen
    zoom a fifth at a time, 1.5 s apart, never out meanwhile and no capture after a sweep step; a block found →
    the framing takes over (and a settle brings the capture); nothing by the chosen zoom → out as usual and no
    sweep for a minute. A sweep counts as a move in progress for `frameAdjusting` (captures held ≤ 6 s). Only
    with a range below the chosen zoom (an iPhone's 0.5×; the e2e fakes' 1–5 never sweep). The overlay draws the
    print's box (thin dashed white) and the readout (`cutReadout`) says "screen
    larger than the view — reading the text", or "text off at the top left — point at it to zoom in" when the
    block is off-centre (its centre more than a quarter of the frame from the middle — what no step in can frame)
    and not already large in the view (`inkAside`: the author's real case — the question at
    the far top-left of the frame from 10 cm away is ~4 % of the frame and only aiming at it lets the zoom, up to
    10×, enlarge it), "text runs off the left — zooming out", or "screen fills the view · no print in view — aim at
    the question" (a blank part of the screen, or text too small and far to count; dark-mode pages are not found
    by this detector, a known limit), "text small at the top left — point at it" for a line of print, "no print
    in view — looking closer" during a sweep. `test/screen.e2e.js` part 9: the screen filling the view with a
    question block at the top left — answered at once, the lens unmoved, the frame + tiles + close-up (the
    close-up the block alone), the note, the meta line, the readout "text off at the top left"; part 10 (a range
    0.5–10 on the `wideRange` flag; scenes 'blank' and 'corner', the block scaled about the middle by the zoom): a
    blank screen larger than the view → out to the widest; the block appearing, too small to count → the sweep
    (0.62…), the block counted, the framing in to ~0.85, the capture with the evened close-up and its answer. Moves are 450 ms apart (`FRAME_HOLD`), at most eight per ten seconds
    (`frameBudget`); a tapped chip holds the loop for 20 s (`frameHoldUntil`). Two stable looks after a move =
    SETTLED (`frameSettled`): the capture is taken at once (`snap('zoom')`, `zoomBumped` so it is new whatever the
    fingerprints say) and the tick rescheduled — the answer comes ~2–3 s after a screen appears, not at the next
    tick. **Capture time** (`autoZoom` from `snap`, when the lens can zoom) only asks the loop (`frameAdjusting`):
    a capture while the lens is moving or a move is due is dropped ("Zooming to fit the screen" / "cut off … zooming
    out"), deferred six seconds at most, then it goes as it is; a lens with no zoom range keeps the capture-time
    handling of a cut-off screen (the ultra-wide lens, then the banner). Every step goes through `zoomStep`: a lens
    that refuses or ignores two moves — the reported zoom unchanged AND the picture unchanged 350 ms later — sets
    `zoomDead` and the loop stands down for the session with a status line. (`applyZoom`: the advanced form
    first, the plain `{ zoom }` constraint as the fallback — see above.) **On the
    viewfinder** (`overlayDraw`, a canvas over the "cover"-scaled video): the found quad outlined — green when it
    fits, amber when cut off (dashed round the whole frame when overfull), dashed white while zooming in — and a
    readout beside the frame counter (`#zoomLive`: "2.4× · screen fits" / "screen cut off: right" / "zooming to
    fit" / "no screen in view"). A move makes exactly ONE capture new (`zoomBumped`, consumed by `snap`) — never the
    retry flag. The lens borrowed by `wideLens` is given back at Stop (`mainDevice`); `start` resets the state
    (`frameLoopStart`), Stop clears the overlay. **The lens**: iPhone Safari hands `facingMode: environment` the
    MULTI-LENS device itself (WebKit's `cameraCaptureDeviceTypes` ranks Triple > Dual Wide > … for the back) and
    reports its zoom IN THE CAMERA APP'S TERMS — `AVVideoCaptureSource::cameraZoomScaleFactor` is 2 for the Triple
    and Dual Wide cameras, so min = 0.5 (the ultra-wide), 1 = the main lens, max = min(videoMaxZoomFactor / 2, 10):
    **0.5×–10× is the whole range a browser gets; "15×" was never available**. `bestLens` still takes a labelled
    multi-lens device when the plain back camera opened (rank Triple > Dual Wide > Dual by label, kept only if the
    range is > 1.2× wider; `lensTried`, `lensAuto`, dropped at Stop); `wideLens` stands down for such a lens.
    `zoomScale` = 0.5 ONLY for the ultra-wide camera chosen on its own (label /ultra/ and not triple/dual, min ≥
    0.95): that one reports its widest as raw 1.0 — a range starting below 1 is already in Camera-app terms (the
    old rule halved the multi-lens camera's values, so a real iPhone showed "0.25×–5×", the chips applied the wrong
    lens and the app started on the ultra-wide). **Captures to Drive** (`keepCapture`, `S.keepCaptures` default
    on): every analysed capture — sent, answered from memory, dropped for zooming or cut off — goes up AS THE
    CAMERA SAW IT (`frame.rawB64`, the whole frame at 1024 px, q 0.62, made in `captureFrame` only when Drive is
    connected) into a "Captures" folder inside Lens Loop (`captureFolder`, `S.driveCaptures`), named "Capture
    11.45.14 PM · 2.5× · sent.jpg" with the finder's verdict, the zoom range, the frame size and the loop state in
    the description (`appProperties.lensloop = 'capture'`); a sent picture always goes, dropped ones one per 4 s,
    two uploads in flight at most, nothing kept on the phone. **Diagnostics**: the Settings sheet shows
    `diagText()` — the camera label, its zoom range and the zoom now, the live framing state and its last look,
    whether the GPU straightening ran, and the last 12 captures (`diagLog`) with what the finder saw. **Lighting
    evened** (`S.flattenLight`, default on): after the GPU straightening, `gainMapOf` measures each cell of a 32×24
    grid at its PAGE WHITE (the brightest of 16 sub-cells), and when the brightest cells are ≥ 1.3× the dimmest, a
    second GPU pass multiplies by a smoothly interpolated gain map (each cell lifted to the 90th-percentile level,
    ≤ 3.5×, never darkened); the meta line says "screen straightened, lighting evened". **Photos to Drive**: the
    IndexedDB is opened at version 4 (a phone at 3 never got the `frames` store). `test/screen.e2e.js` runs the
    whole thing against a 2560×1440 canvas camera whose tracks report a zoom range (1–5, the fake's convention) and
    an ultra-wide device: 1 the live zoom-in (1.6 then 2.49 within ~3 s, the readout, the green outline), 1b the
    stepped return to 1× and a desk answered from memory, 2 the angled screen, 3 cut off → the wide lens, 4 a stuck
    lens, 5 a role card locked and the desk still costing nothing after a move, 6 the multi-lens device, 7 the
    captures on an in-memory Drive (the folder, the names, the description, the size), 8 a screen larger than the
    view with no wider lens: the part in view straightened and answered within a second, the model told, the meta
    line and the banner.
14b. **A capture every 10 s at all times** (`INTERVAL` = 10, applied on every open like the model and the effort;
    the Settings field is read-only and says so) — a change in the picture still brings one sooner.
15. **A question over tabbed sources** (the author's spec: the sources in tabs — "Mall Information / Building Plan /
    Companies" — the question beside them; wait until every tab was tapped; several questions over the same tabs
    handled without re-tapping). The quick look's single and paired verdicts gain `TABS | <names in order; separated
    by ;> | <selected tab> | <first eight words of the question, or none>` (`tabsLine`, `tabsOf`, `parseRoleLook`).
    `tabsSeen` keeps ONE `tabSet` { key = the normalised names, frames: name → the newest capture of that tab,
    question { text, frame, answered } } (`TABS_MAX_AGE` 20 min): a tab is collected as the user taps it (kept as it
    was unless its panel moved — `panelMoved` on `leftSig` — so the bundle's bytes stay the same from question to
    question; a tab whose panel looks like OTHER contents — `panelChanged` — starts the set afresh), a tab is not a
    document page (`forgetFrame`), the status line and `taskNote` say "Tabs: Mall Information ✓ · Building Plan ·
    Companies — tap Building Plan, Companies (or say "Lens, answer")", the screen keeps what it had. Once the
    question is in view AND every named tab is in hand → `tabsAnswer`: ONE request (`send` with `frame.tabs`) that
    opens with "SOURCE TABS — … Each tab as the user showed it:" and every tab's pictures labelled `Tab "…":` in
    order, the LAST picture of the bundle cache-marked, then the current view named with its tab, no document
    scaffolding, the prompt saying to use all the tabs; the answer is `frame.fresh` (never memory) and
    `frame.choice` (shown big in the panel — several parts "1: Yes | 2: No | 3: Yes" each big, in order:
    `verdictOne`/`verdictOf` parts), locked as `roleLock.kind === 'tabs'` (the desk, the same question, another of
    its tabs change nothing; the paired look's SAME/OTHER/TABS verdicts decide). A further question beside the SAME
    tabs is answered AT ONCE with the tabs in hand — the bundle byte-identical, so the prompt cache serves it.
    **Items in a set open with the same stem word for word** ("For each of the following situations, select Yes…"),
    so the quick look gives the question as its first eight words, then " / " and the first six words of its first
    statement/option/row, and `sameQuestion` requires BOTH halves to match (≥ 60 % of the words each) when both
    looks gave a statement, ≥ 75 % of the first words otherwise — `test/tabs.test.js` fixes this and the TABS
    verdict's forms. "Lens, answer" (`parseCommand` kind
    `answer`) answers with the tabs in hand, the request naming the tab not shown. `test/tabs.e2e.js` runs desk →
    tab 1 + question → tab 2 → tab 3 (one request) → desk (kept) → question 2 (at once, same bytes) → a new set →
    "Lens, answer".
13. **Tasks: role-play cards and writing tasks** — automatic, nothing to switch on (`S.roleAuto`, default on;
    `S.sceneCharacter` = optional voice notes). The author's spec: a SPEAKING role-play card (a SETTING, a role —
    DOCTOR, PATIENT, CARER… — and a TASK list) brings its briefing and then a live role play (13b; the role answer's
    text, `roleLock.text`, is the briefing); a WRITING task ("Writing Task: write a letter of referral…", with case notes on
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
  `node test/role-parse.test.js` (the role-card verdict read however a model writes it), `node test/verdict.test.js`
  (which answers are shown big in the panel, which go to the feed), `node test/convo.test.js` (the live role
  play's rules, who plays whom, the clock, "I'm ready" / "Lens, next"), `node test/screen.test.js` (the screen
  finder's geometry: corners however the screen is turned, cut edges, a window behind, a lamp beside a far screen,
  a lit room, a page split by a dark bar, two shades of desk, the homography, the tiles), `node test/framing.test.js`
  (the live auto-zoom's one step: in, capped by the nearest edge; out; back; a screen larger than the view framed by
  its print — a block closed in on as far as its headroom allows, a speck or a line not, a fresh step-out not, a
  large block at an edge out, a small one or a line at an edge kept; the sweep's steps, waits and end; and 400
  random runs that settle without ever leaving the frame), `node test/ink.test.js` (the text close-up: the question
  block boxed, a cursor left out, print on a dim grey ground found, print at an edge said so, none for a whole page
  of print or no page, stripes/bars/a checkerboard not print, a moiré band no block of print and print beside it the
  print alone, a one-cell strip no block) and `node test/tabs.test.js` (the TABS verdict in every form, the
  selected tab, the same question vs another with the same stem); `node test/verdict.test.js` also fixes which
  replies are NO answer (a blur-describing title) and which are (an option about blurred vision).
- `node test/session.e2e.js`, `node test/drive-renewal.e2e.js`, `node test/fresh-build.e2e.js`,
  `node test/memory-voice.e2e.js`, `node test/drive-helper.e2e.js`, `node test/drive-expired-open.e2e.js` (the app
  opened hours later: a silent renewal, retries on a backoff, a dead token in Google's real shape, and the banner only
  when a tap is truly needed), `node test/drive-vanished.e2e.js` (files deleted from Drive behind the app's back,
  against an in-memory Drive), `node test/role-cards.e2e.js` (desk → a role card caught blurred then legible → desk →
  the same card → a different card → desk, against a controlled camera: the card's briefing appears, stays locked,
  changes only for a different card; writing tasks over pages; and part 5, a whole live role play by voice),
  `node test/screen.e2e.js` (a 2560×1440 canvas camera with a zoom range and an ultra-wide device: the desk as it
  is, a small screen zoomed in on live — step by step within seconds, the readout and the outline — an angled screen
  straightened with two tiles, a cut-off screen and the wide lens, a stuck lens, a role card locked and a zoom move
  costing nothing after, a phone with a multi-lens device taken for its wider range, the captures mirrored to an
  in-memory Drive, a screen larger than the view answered at once from the part in view, the screen filling the view
  answered with tiles and the text close-up), `node test/hold.e2e.js` (a verdict kept ten seconds whatever the
  picture does, the consistency note, a blur-titled reply and "nothing to read" keeping it, a different question
  answered at once), `node test/tabs.e2e.js` (a question over three tabs: collected tab by tab, one request with the
  bundle, a second question at once from the same bytes, "Lens, answer"), `node test/latency.e2e.js` (audio cadence and
  highlight reaction time), `node test/document.e2e.js` (a document page by page, the desk, a new subject) and
  `node test/hour-session.e2e.js` (an hour of dictation compressed into half a
  minute through the real ElevenLabs engine path with the socket mocked: draft, prompt, audio parts, saved
  storyline, questions before and after a reload) (headless Chromium via Playwright,
  `npm i -D playwright` if missing): a real session with a fake camera, fake dictation and a fake Claude
  endpoint; checks request bodies, cache marks, retries and the Drive renewal frame.
