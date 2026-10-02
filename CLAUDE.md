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
3. **Metered feed.** Every camera answer opens the reader by itself (`openReader(..., { force: true })`) and
   auto-scrolls word by word at 0.5 words/s (speed 0.3×–5×, Auto/Pause); `closeReader` saves the position.
   The feed is **not full-screen**: with the `feed` class it takes the answer panel's place over the lower part
   of the camera (dark, translucent, `.reader.feed`, the reader element lives inside `.stage`), so the status
   bar, the camera strip and the Snap/Stop buttons stay visible and tappable. Only the manual Read view fills
   the screen. Both turn with the phone's tilt exactly like the answer panel (`applyPanelRotation`, `turnedCss`).
4. **Read-along.** The reader shows the text large with the Apple-Music-style highlight (`.w`, `.w.read`,
   `.w.cur`): when opened by hand with no session running it follows the reader's own voice (`feedReader`, phone
   or cloud engine); when forced open during a session it auto-scrolls instead. A+/A− sizing.
5. **Recording.** ElevenLabs Scribe v2 Realtime through an AudioWorklet (AGC, 16 kHz PCM, single-use token per
   connection, key terms from saved storylines), with keepalives, a watchdog that replaces a dead or silent
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
9. **Google Drive mirror.** OAuth implicit flow by redirect (works in Safari and Home Screen apps), silent
   `prompt=none` refresh on open, hidden-frame renewal five minutes before the token runs out
   (`driveRenewSilently`; the framed copy of the page posts the fragment to the parent and stops — see the top
   of the script), two-way sync of storylines, the live transcript pushed every 8 s, audio in 2-minute parts,
   catch-up of everything pending after a reconnect, uploaded blobs pruned from the phone.
10. **Recovery.** A frame whose request failed is sent again on the next tick even if the picture did not move
    (`retryFrame`, sooner with backoff after a passing failure); a failed spoken question is asked again once;
    a camera the phone took away is reopened (`cameraCheck`); wake lock and engines resume on `visibilitychange`.
11. **Answer panel.** "ANSWER:" headline, storyline tag, cost/latency readouts (cached tokens counted), history
    of 40, copy, Read button, settings sheet, intro text, privacy/terms pages, PWA icons.

## Tests (run before every push)

- `node --check` on the script body, then `node test/live-prompt.test.js` (prompt assembly, no browser).
- `node test/session.e2e.js` and `node test/drive-renewal.e2e.js` (headless Chromium via Playwright,
  `npm i -D playwright` if missing): a real session with a fake camera, fake dictation and a fake Claude
  endpoint; checks request bodies, cache marks, retries and the Drive renewal frame.
