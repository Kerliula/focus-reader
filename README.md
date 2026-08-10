# Focus Reader

A desktop reading app built around the way attention actually fails: not slow
reading, but hollow reading — eyes moving, nothing landing.

Reads EPUB and PDF. Everything stays on your machine; there are no accounts and
nothing is uploaded.

## What it does

**Spotlight focus.** One sentence (or paragraph) is lit, the rest of the page
dims. There is exactly one place for your eye to be, and moving on is a
deliberate keypress rather than a drift.

**Bionic bolding.** The first few letters of every word are bolded, giving the
eye a fixation point instead of a wall of even grey.

**One section at a time.** The bar you watch is the section you're in, not the
400-page book — a finish line you can see from where you're standing.

**Thought parking.** `⌘K` opens one field. Dump the thing that just pulled you
away, hit Enter, carry on. The list is there when the reading is done.

**Progress you can actually read.** Two bars at the bottom: how far through this
section, and the whole book as one track with a tick per section — legible whether
the book has four sections or four hundred. No points, no levels, no streaks.

**The book is left alone.** Nothing is hidden, reordered or skipped. Every section
the file contains is a section you can read, contents page included. The model is
never asked what belongs in your book.

**A check at the end of every section.** Four multiple-choice questions written
from the section you just read, then a box asking what it said in your own words.
Get most of the questions right and the summary is kept as a note. Get them
wrong and it offers you the section again — the note only gets banked when the
reading actually landed.

## Running it

```bash
npm install
```

```bash
npm run dev
```

To build a distributable `.dmg`:

```bash
npm run dist
```

## Keys

| Key | Does |
| --- | --- |
| `Space` `→` `J` | Next sentence |
| `←` `K` | Back |
| `[` `]` | Previous / next section |
| `B` | Bionic bolding |
| `D` | Spotlight dimming |
| `G` | Sentence ↔ paragraph |
| `+` `−` | Text size |
| `T` | Sections |
| `,` | Settings |
| `N` | Your notes |
| `⌘K` | Park a thought |
| `Esc` | Back to library |

## DeepSeek

The end-of-section quiz is the only thing that calls the DeepSeek API. Paste a key
into Settings (or set `DEEPSEEK_API_KEY`) to switch it on; without one the app
works exactly the same, minus the quizzes.

The model reads a section in order to ask questions about it. It never decides what
you read, never edits or reorders text, and nothing it returns is written back into
the book. One call per section, only when you reach the end of one.

The key is stored in `settings.json` under the app's own data directory and never
leaves the main process — the renderer only ever receives results.

## How it is put together

- `src/main` — Electron main process: window, file dialogs, and a small JSON
  store in `userData` (library, progress, thoughts, settings). Writes are queued
  per file so overlapping updates can't lose each other.
- `src/preload` — the `window.api` bridge; the renderer has no Node access.
- `src/renderer/src/parse` — EPUB (JSZip + DOMParser over the OPF spine) and PDF
  (pdf.js text items regrouped into lines and paragraphs) reduced to the same
  block shape. Parsed books are cached so reopening is instant.
  Section names come from the book's own contents (the EPUB 3 nav document, or
  toc.ncx), falling back to the headings printed on the page — stitched back
  together when a title is broken over several elements, as most are.
- `src/renderer/src/lib/units.ts` — sentence splitting and unit building, pure and
  separate from the UI.

## Sample books

`samples/` holds a short generated EPUB and a text PDF for trying things out.
