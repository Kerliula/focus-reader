# Focus Reader

A desktop reading app built around the way attention actually fails: not slow
reading, but hollow reading — eyes moving, nothing landing.

Reads EPUB, PDF, and articles on the web. Everything stays on your machine;
there are no accounts and nothing is uploaded.

## What it does

**Pages, not a scroll.** A section is typeset onto sheets of a fixed size and
shown the way a PDF viewer shows a document: paper on a desk, a running head
and a page number on every sheet, a page box and a zoom control in the toolbar.
Fit the whole page in the window or fit its width; zoom scales the picture of
the page and never moves a line break. Turning a page is `PageDown`, and the
rail down the left fills a mark per page as you go — the section is twelve marks,
and seven of them are lit.

**Spotlight focus.** One sentence (or paragraph) is lit, the rest of the page
dims. There is exactly one place for your eye to be, and moving on is a
deliberate keypress rather than a drift. A sentence that runs over the foot of a
page is lit on both sheets.

**Bionic bolding.** The first few letters of every word are bolded, giving the
eye a fixation point instead of a wall of even grey.

**One section at a time.** The bar you watch is the section you're in, not the
400-page book — a finish line you can see from where you're standing.

**Thought parking.** `⌘K` opens one field. Dump the thing that just pulled you
away, hit Enter, carry on. The list is there when the reading is done.

**You name the book.** Adding a file reads it in, then stops to ask: the title and
author are filled in from the file, and files are wrong about both often enough —
`final_v3.pdf`, an author field holding the publisher — that nothing goes on the
shelf until you have looked at them and pressed Enter. Change either, or leave
the book out after all. Books that are already on the shelf are not asked about
again.

**A shelf per subject.** Group books by what you are reading them for — a
course, a thesis chapter, a standing interest. The library then opens as your
subjects rather than as one long wall: each with its own heading and count, and
whatever you have not filed gathered at the bottom under **Unfiled**. Click a
subject to see only it; anything you add while it is open lands there. A book
sits on one shelf, moved from the pill on its card. Dropping a subject unfiles
its books and deletes nothing — the shelf goes, the reading stays.

**Progress you can actually read.** Two bars at the bottom: which page of this
section you are on and how far through it, and the whole book as one track with a
tick per section — legible whether the book has four sections or four hundred.
A page you have turned gets a tick in its folio. No points, no levels, no streaks.

**Articles read like books.** Paste a link — or drop one onto the library — and the
page is stripped down to the text: no nav, no subscribe box, no share buttons, no
"related posts". The article is then cut into sections on its own headings, so a
long essay gets the same contents page, per-section progress bar and end-of-section
check that a book does. Articles with no headings are cut into roughly five-minute
sections instead, and any one section that runs very long is split so the end of it
is always in sight. Once it's been read in, it stays readable offline.

**The pictures come too.** Diagrams, plates and photographs are pulled out of
the book and shown where the author put them — between the same two paragraphs,
in the same order, with the caption underneath still reading as the caption. A
figure takes its turn in the spotlight like a sentence does, and clicking it
opens it at full size, because a reading column is the wrong width for a map.
Spacers, bullets, rules, share icons and tracking pixels are left behind.

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
| `PageDown` `PageUp` | Next / previous page |
| `Home` `End` | First / last page of the section |
| `[` `]` | Previous / next section |
| `B` | Bionic bolding |
| `D` | Spotlight dimming |
| `G` | Sentence ↔ paragraph |
| `+` `−` | Zoom |
| `0` | Fit the page |
| `F` | Fit the width |
| `T` | Sections |
| `,` | Settings (in the library too) |
| `N` | Your notes |
| `⌘K` | Park a thought |
| Click a figure | Open it full size (`Esc` closes) |
| `Esc` | Back to library |

## DeepSeek

Three things call the DeepSeek API: the two-line section preview, the double-click
word explanation, and the end-of-section quiz. They stay off until there is a key,
and the library says so with an **Add a key** button; without one the app works
exactly the same, minus those three.

Get a key at [platform.deepseek.com](https://platform.deepseek.com/api_keys), then
open **Settings** — the ⚙ button in the library bar, or `,` from anywhere — and
paste it in. **Check key** asks DeepSeek whether it works, so you find out there
rather than mid-section. Setting `DEEPSEEK_API_KEY` in the environment works too,
and overrides the saved one.

The model reads a section in order to ask questions about it. It never decides what
you read, never edits or reorders text, and nothing it returns is written back into
the book. One call per section, only when you reach the end of one.

The key is stored in `settings.json` under the app's own data directory and never
leaves the main process — the renderer only ever receives results.

## How it is put together

- `src/main` — Electron main process: window, file dialogs, and a small JSON
  store in `userData` (library, subjects, progress, thoughts, settings). Writes
  are queued per file so overlapping updates can't lose each other. A subject is
  its own record and a book carries its id, so renaming one is a single write
  and dropping one cannot take books with it.
- `src/preload` — the `window.api` bridge; the renderer has no Node access.
- `src/renderer/src/parse` — EPUB (JSZip + DOMParser over the OPF spine), PDF
  (pdf.js text items regrouped into lines and paragraphs) and web articles all
  reduced to the same block shape. Parsed books are cached so reopening is instant.
  An article is fetched in the main process and never loaded or executed — only
  read as text. The body is found by scoring containers on how much unlinked
  paragraph text they hold, after page furniture is removed by tag and by class
  name. Legacy pages that lay their prose out in tables, or separate paragraphs
  with `<br>` rather than `<p>`, are normalised first so they read like anything else.
  Section names come from the book's own contents (the EPUB 3 nav document, or
  toc.ncx), falling back to the headings printed on the page — stitched back
  together when a title is broken over several elements, as most are.
- `src/renderer/src/lib/units.ts` — sentence splitting and unit building, pure and
  separate from the UI.
- `src/renderer/src/lib/pages.ts` — how a section becomes pages. The text is
  typeset once, off screen, at the width of the text block (`PageMeasurer`); every
  line of it is read back and the lines are dealt onto sheets of a fixed height.
  A heading is never left as the last line of a page. A sentence that straddles a
  break is cut at the exact character the measurement finds, so each half renders
  with the line breaks it had, and both halves light up as one unit. Each sheet
  (`Sheet.tsx`) is laid out at its own size and scaled as a picture, which is why
  zoom is free and never changes where a page breaks. Changing the text size or the
  font does, and the section is measured again.
- `src/renderer/src/lib/images.ts` — one rule for what counts as an illustration,
  shared by all three parsers: measured, filtered on its real size rather than on
  what the markup called it, and stored under the hash of its bytes so a
  decoration repeated at every chapter opening is kept once. The files live beside
  the library in the app's data directory, not inside the parsed JSON, and are
  served to the page over a `bookimg://` scheme that can only reach that
  directory. Where a picture is written into the file — an EPUB names it in the
  spine document, an article links to it, a PDF has none — is each parser's own
  problem.

  A PDF is the hard one, because it has no idea what a figure is: it holds
  drawing instructions, and "figure 1.2" is whatever those instructions happen to
  put in one part of the page. Looking for the images a page paints finds
  photographs and almost nothing else — a five-panel diagram of arrows, boxes and
  labels is vector art, and the one photograph in it is a tile in the corner. So
  `parse/pdfImages.ts` works the other way round and finds a figure by where the
  *text* isn't: prose runs down a page at a steady leading, and where it stops for
  a couple of inches, something else is on the paper. That band is rendered as the
  page would print and trimmed to the ink inside it — which makes no difference
  between a photograph, a drawing or both, and keeps the labels and axes around it
  because they were never separate things to begin with. A band has to be
  reasonably covered in ink to count: printers' crop marks are four hairlines in
  the corners of every sheet, blank ones included, and without that test every
  blank page in a book becomes a picture of nothing.

  Pulling figures out of a PDF means rendering, so the first open of a heavily
  illustrated one takes longer than it used to: a 500-page textbook with a figure
  on nearly every page took a couple of minutes and produced 226 of them. Only
  the band a figure sits in is rasterised, at a resolution suitable for the
  full-size viewer, and PDF figures are kept as lossless PNGs so labels and thin
  vector lines stay sharp. It happens once — the result is cached like
  everything else, the library says what it is doing while it works, and it
  carries on whether or not the window is in front. Adding illustrations changed
  what the parsers produce, so books already in the library are read once more
  the next time they are opened.

## Sample books

`samples/` holds a few short generated EPUBs and a text PDF for trying things
out. `an-illustrated-study.epub` is the one with pictures in it: a figure with a
caption, an SVG drawing, a full-page plate on its own, the same diagram used
twice, and a rule, an icon and a tracking pixel that should never appear.
