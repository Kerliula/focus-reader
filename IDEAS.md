# 20 ideas for making Focus Reader work harder for ADHD readers

Ordered by the problem they solve, not by size. Each one says what it is, why it
might help, and roughly where it would go in the code.

A note on the reasoning: these are design hypotheses drawn from how attention
tends to fail while reading — task initiation, time blindness, the cost of
getting back in after a drift, and working memory dropping the thread. They are
not clinical claims, and the only way to know which ones work is for you to use
them for a week.

---

## Getting started

Starting is often harder than continuing. Everything here is about lowering the
activation energy of opening the book at all.

### 1. Actually build reading sprints

`package.json` describes the app as having "reading sprints" — but there's no
timer anywhere in the code. The `wpm` setting only feeds the "minutes left"
estimate in `Hud.tsx`.

A sprint is a visible, bounded commitment: 10, 15 or 25 minutes with a countdown
you can see. Bounded time is easier to start than open-ended time, and the
visible clock does the work that internal time-sense doesn't.

*Where:* new `Sprint.tsx` + a timer alongside `minutesRead` in `Reader.tsx`.

### 2. A "one sentence" button

A single control on the library screen that opens your book and starts a
60-second timer. The promise is explicitly tiny.

The hard part is the transition into reading, not the reading. Once the spotlight
is moving, continuing is cheap — so make the smallest possible version of
starting a real, named action rather than something you have to talk yourself into.

*Where:* `Library.tsx`, reusing the resume button's data.

### 3. Tell me what this section is about before I read it

Two lines of "here is what's coming" before a section, generated the same way the
quiz is and prefetched so it's instant.

Uncertainty is friction. A scaffold to hang sentences on also means working
memory holds less at once, because you already know roughly where the argument
is going.

*Where:* `ai.ts` next to `buildQuiz`, shown at the top of a new section.

### 4. Resume with the thread attached

Reopening a book currently drops you at the right sentence with no context. Show
the previous two sentences greyed above it, plus any thought you parked last
session, and let one key dismiss it.

Re-entry is where sessions die: you land mid-argument, can't remember the setup,
and close the app. This is the cheapest idea on the list and probably the highest
value per line of code.

*Where:* `Reader.tsx` mount, using `initialProgress` and `thoughts`.

---

## Staying in

### 5. Auto-advance at your own pace

The spotlight moves on its own at your `wpm`, with a key to pause and nudge the
speed. You read to the light instead of deciding to move it.

Self-pacing costs attention that could go on the text. An external pace
externalises that decision — the same reason a metronome helps.

*Where:* an interval in `Reader.tsx` calling the existing `next()`.

### 6. Fade text further as you leave it behind

`.unit-read` is one fixed opacity today. Make it fade with distance, so text from
five sentences back is nearly gone.

Regressive eye movements — sliding back to re-read what you already covered — are
a common way a page stops moving forward. Make backward the visibly less
inviting direction.

*Where:* `ReaderUnit.tsx` passes distance; `styles.css` interpolates.

### 7. A real ruler, not just dimming

An opaque band that masks everything except the current line, following it down
the page. Dimming leaves shapes; a mask removes them.

Offer it as an alternative to `focusDim` rather than a replacement — people split
sharply on which one works.

*Where:* an overlay element positioned from `activeRef`.

### 8. Adjustable spotlight width

Light 1, 2 or 3 units instead of exactly one. One sentence can be too tight for
flowing prose — you lose the shape of the paragraph and end up re-reading.

Granularity already switches sentence/paragraph; this is the in-between that's
currently missing.

*Where:* `settings.spotlightUnits`, then a range check in `ReaderUnit.tsx`.

### 9. Notice when I've stopped

If nothing has moved for 45 seconds, pulse the spotlight once. No modal, no
sound, no judgement.

Drift is usually silent — you don't notice you left. A small ambient signal can
catch it without becoming another interruption.

*Where:* an idle timer in `Reader.tsx` reset by `next`/`prev`.

### 10. Sound that comes with the sprint

Brown noise or rain, generated locally with an `OscillatorNode` and a filter — no
audio files, no network. Starts with a sprint, stops with it.

Consistent sound masks the environment, and it becomes a cue: this sound means
we're reading now.

*Where:* small Web Audio module in the renderer.

### 11. A mode with nothing on screen but words

Hide the HUD, the header, the counts. Progress appears only when you ask.

A progress bar is a stimulus, and "how far have I got" is exactly the thought
that ends a reading session. Some days you want it gone.

*Where:* conditional rendering in `Reader.tsx`; a `bare` setting.

---

## Getting back in after drifting

### 12. Let me mark where I lost it

One key that says "I stopped taking this in here." No penalty, no popup — it just
records the spot.

Over a book, those marks are data: which sections, what time of day, how far into
a session. Drift stops being a personal failing and becomes a pattern with
causes you can act on.

*Where:* a `drifts.json` store mirroring `thoughts.json`.

### 13. Say the last sentence out loud

One key re-reads the current unit aloud with the system voice.

When your eyes have slid over the same line four times, hearing it breaks the
loop — a second channel rather than another attempt at the same one.

*Where:* Web Speech API in the renderer; no new dependency.

### 14. Read to me, with the light following

Full text-to-speech with the spotlight tracking the spoken sentence.

Audio plus synchronised visual is, for a lot of people, the difference between a
page that fights back and a page that goes down easily. It also rescues the
sessions where reading isn't going to happen at all.

*Where:* the same speech API, driving `setUnitIndex` on boundary events.

### 15. "Wait — what did I just read?"

A key that asks one question about the last three paragraphs only, answered on
the spot.

The section quiz comes at the end, which is too late to catch a drift that
started two pages ago. This is the small, immediate version — and the machinery
already exists in `ai.ts`.

*Where:* reuse `complete()` with a much smaller prompt.

---

## Making it stick

### 16. Explain this passage, not just this word

Double-click already explains a word in context. Select a sentence and the same
gesture should explain the *sentence*: simplified, not translated.

Sometimes the words are all familiar and the sentence still doesn't parse. That
gap has no answer in the app today.

*Where:* `WordPopover.tsx` already receives multi-word selections — branch the
prompt on length.

### 17. Bring the saved words back

`words.json` and `notes.json` are accumulating and nothing ever resurfaces them.
A short review — five words, a few days later, using the sentence you met them
in — turns a list into actual retention.

Deliberately not a streak. Miss two days and a streak becomes a reason to quit.

*Where:* new `Review.tsx`, plus a `lastReviewedAt` field on `SavedWord`.

### 18. Warn me when a section is heavy

Sentence length and rare-word density can be computed offline from the parsed
book, with no API call. Flag a section as denser than the book's average.

Knowing a section is genuinely hard changes the interpretation of struggling with
it — from "I can't focus today" to "this bit is hard, take it slower."

*Where:* extend `lib/units.ts` at parse time; show a marker in `ChapterList.tsx`.

---

## Knowing your own patterns

### 19. Session stats that aren't a scoreboard

Minutes, sentences, words looked up, drift marks — shown as a record, not a
score, with no targets and no red.

Reading data is genuinely useful. Gamified reading data turns the app into
another thing to fail at.

*Where:* a small panel over `progress.json`.

### 20. Tell me when I actually read well

`progress.json` already timestamps every save. That's enough to answer: which
hours do you read most in, and where do drift marks cluster?

"You read about twice as much before noon" is a more actionable fact than any
setting in this app.

*Where:* aggregate `updatedAt` in the same stats panel.

---

## If you only do three

**#4 (resume with the thread)** — smallest change, removes the most common reason
a session never restarts.

**#1 (sprints)** — the README already promises it, and bounded time is the single
biggest lever on starting.

**#14 (read aloud with the spotlight)** — the largest build here, and the one most
likely to change which days you read at all.
