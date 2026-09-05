import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  BookDoc,
  BookImage,
  BookMeta,
  Note,
  Progress,
  SavedWord,
  Settings,
  Thought,
  WordExplanation,
  Zoom
} from '../../../shared/types'
import { buildChapterUnits, countWords } from '../lib/units'
import { pageGeometry, type PageLayout } from '../lib/pages'
import { Sheet, type SheetStatus } from './Sheet'
import { PageMeasurer } from './PageMeasurer'
import { PageRail } from './PageRail'
import { ImageViewer } from './ImageViewer'
import { SectionPreview } from './SectionPreview'
import { WordPopover, type Lookup } from './WordPopover'
import { SettingsPanel } from './SettingsPanel'
import { ThoughtPanel } from './ThoughtPanel'
import { NotesPanel } from './NotesPanel'
import { WordsPanel } from './WordsPanel'
import { ParkPrompt } from './ParkPrompt'
import { SectionQuiz } from './SectionQuiz'
import { ChapterList } from './ChapterList'
import { Hud } from './Hud'

interface Props {
  doc: BookDoc
  meta: BookMeta
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  initialProgress: Progress | null
  onProgress: (progress: Progress) => void
  onExit: () => void
  thoughts: Thought[]
  onAddThought: (text: string) => void
  onToggleThought: (id: string) => void
  onDeleteThought: (id: string) => void
  notes: Note[]
  onAddNote: (note: Note) => void
  onDeleteNote: (id: string) => void
  words: SavedWord[]
  onAddWord: (word: SavedWord) => void
  onDeleteWord: (id: string) => void
  aiReady: boolean
}

type Overlay = 'none' | 'settings' | 'thoughts' | 'notes' | 'words' | 'chapters' | 'park' | 'quiz'

/** Space kept around the sheets, and between them. */
const SHEET_GAP = 18
const MIN_ZOOM = 30
const MAX_ZOOM = 300
const ZOOM_STEP = 10

const ZOOM_PRESETS: { label: string; value: Zoom }[] = [
  { label: 'Fit page', value: 'page' },
  { label: 'Fit width', value: 'width' },
  { label: '50%', value: 50 },
  { label: '75%', value: 75 },
  { label: '100%', value: 100 },
  { label: '125%', value: 125 },
  { label: '150%', value: 150 },
  { label: '200%', value: 200 }
]

const zoomLabel = (zoom: Zoom): string =>
  zoom === 'page' ? 'Fit page' : zoom === 'width' ? 'Fit width' : `${zoom}%`

export function Reader({
  doc,
  meta,
  settings,
  onSettingsChange,
  initialProgress,
  onProgress,
  onExit,
  thoughts,
  onAddThought,
  onToggleThought,
  onDeleteThought,
  notes,
  onAddNote,
  onDeleteNote,
  words,
  onAddWord,
  onDeleteWord,
  aiReady
}: Props): JSX.Element {
  const [chapterIndex, setChapterIndex] = useState(() =>
    Math.max(0, Math.min(initialProgress?.chapterIndex ?? 0, doc.chapters.length - 1))
  )
  const [unitIndex, setUnitIndex] = useState(initialProgress?.unitIndex ?? 0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [minutesRead, setMinutesRead] = useState(initialProgress?.minutesRead ?? 0)
  const [toast, setToast] = useState<string | null>(null)
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [zoomed, setZoomed] = useState<BookImage | null>(null)

  const explainWord = useCallback((word: string, sentence: string, at: DOMRect) => {
    setLookup({ word, sentence, top: at.top, bottom: at.bottom, left: at.left + at.width / 2 })
  }, [])

  // A single keystroke flipping a persistent setting has to say so, or the app
  // just looks broken the next time you open it.
  const toastTimer = useRef<number | null>(null)
  const announce = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }, [])
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const chapter = doc.chapters[chapterIndex]
  const { blocks, units, totalWords: chapterWords } = useMemo(
    () => buildChapterUnits(chapter, settings.granularity),
    [chapter, settings.granularity]
  )

  const safeUnitIndex = Math.min(unitIndex, Math.max(0, units.length - 1))
  const activeUnit = units[safeUnitIndex]
  const wordsIntoChapter = activeUnit ? activeUnit.wordsBefore : 0

  /** Word counts and running offsets across every section. */
  const sectionStats = useMemo(() => {
    const words = doc.chapters.map((c) =>
      c.blocks.reduce((sum, b) => sum + countWords(b.text), 0)
    )
    const offsets: number[] = []
    let running = 0
    for (const count of words) {
      offsets.push(running)
      running += count
    }
    return { words, offsets, total: running }
  }, [doc])

  const activeRef = useRef<HTMLSpanElement | null>(null)

  // ---- pages ------------------------------------------------------------------

  const geometry = useMemo(() => pageGeometry(settings.columnWidth), [settings.columnWidth])

  // EPUB sections usually open with their own heading — don't print it twice.
  const firstBlock = chapter.blocks[0]
  const titleAppearsInText =
    firstBlock !== undefined &&
    (firstBlock.type === 'h1' || firstBlock.type === 'h2') &&
    firstBlock.text.trim().toLowerCase() === chapter.title.trim().toLowerCase()
  const leadTitle = titleAppearsInText ? null : chapter.title

  /**
   * Everything a page break depends on. When any of it changes the section is
   * measured again; until then the pages already on screen are the truth.
   */
  const layoutKey = [
    meta.id,
    chapter.id,
    settings.granularity,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.columnWidth,
    settings.bionic,
    settings.bionicStrength,
    leadTitle === null ? 0 : 1
  ].join('|')

  const [layout, setLayout] = useState<PageLayout | null>(null)
  const ready = layout !== null && layout.key === layoutKey
  const pages = ready ? layout.pages : []
  const pageCount = pages.length
  const currentPage = ready ? Math.min(layout.pageOfUnit[safeUnitIndex] ?? 0, pageCount - 1) : 0

  // ---- zoom ---------------------------------------------------------------------

  const viewerRef = useRef<HTMLDivElement | null>(null)
  const sheetsRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  /** Bumped when the column of sheets changes height — the slip above page one loading, say. */
  const [reflow, setReflow] = useState(0)

  // Read before the first paint, so the sheets never flash at full size while
  // the observer is still on its way.
  useLayoutEffect(() => {
    const el = viewerRef.current
    if (!el) return
    setViewport({ width: el.clientWidth, height: el.clientHeight })
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setViewport({ width: box.width, height: box.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = sheetsRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setReflow((n) => n + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = useMemo(() => {
    const clamp = (s: number): number => Math.max(MIN_ZOOM / 100, Math.min(MAX_ZOOM / 100, s))
    if (typeof settings.zoom === 'number') return clamp(settings.zoom / 100)
    if (viewport.width === 0 || viewport.height === 0) return 1
    if (settings.zoom === 'width') return clamp((viewport.width - 2 * SHEET_GAP) / geometry.sheetWidth)
    return clamp((viewport.height - 2 * SHEET_GAP) / geometry.sheetHeight)
  }, [settings.zoom, viewport, geometry])

  const setZoom = useCallback(
    (zoom: Zoom) => {
      onSettingsChange({ ...settings, zoom })
      announce(zoomLabel(zoom))
    },
    [settings, onSettingsChange, announce]
  )

  const zoomBy = useCallback(
    (direction: 1 | -1) => {
      // Stepping from a fit mode starts at whatever it currently works out to.
      const current = Math.round(scale * 100)
      const snapped = direction === 1
        ? Math.floor(current / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP
        : Math.ceil(current / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, snapped)))
    },
    [scale, setZoom]
  )

  // ---- navigation -----------------------------------------------------------

  const goToChapter = useCallback(
    (index: number, position: 'start' | 'end' = 'start') => {
      setLookup(null)
      setZoomed(null)
      const clamped = Math.max(0, Math.min(doc.chapters.length - 1, index))
      if (clamped === chapterIndex && position === 'start') {
        setUnitIndex(0)
        return
      }
      setChapterIndex(clamped)
      if (position === 'end') {
        const target = buildChapterUnits(doc.chapters[clamped], settings.granularity)
        setUnitIndex(Math.max(0, target.units.length - 1))
      } else {
        setUnitIndex(0)
      }
    },
    [chapterIndex, doc, settings.granularity]
  )

  const atLastSection = chapterIndex >= doc.chapters.length - 1
  const quizEnabled = settings.quizAfterSection && aiReady
  const previewEnabled = settings.sectionPreview && aiReady

  // Hidden by hand for this section only; the next one gets a fresh chance.
  const [previewHiddenFor, setPreviewHiddenFor] = useState<string | null>(null)

  const advanceSection = useCallback(() => {
    if (!atLastSection) goToChapter(chapterIndex + 1)
  }, [atLastSection, goToChapter, chapterIndex])

  /** Reaching the end of a section is the moment to check it landed. */
  const finishSection = useCallback(() => {
    if (quizEnabled) setOverlay('quiz')
    else advanceSection()
  }, [quizEnabled, advanceSection])

  // Moving on is the signal that you're done with the word you looked up.
  const next = useCallback(() => {
    setLookup(null)
    if (safeUnitIndex < units.length - 1) setUnitIndex(safeUnitIndex + 1)
    else finishSection()
  }, [safeUnitIndex, units.length, finishSection])

  const prev = useCallback(() => {
    setLookup(null)
    if (safeUnitIndex > 0) setUnitIndex(safeUnitIndex - 1)
    else if (chapterIndex > 0) goToChapter(chapterIndex - 1, 'end')
  }, [safeUnitIndex, chapterIndex, goToChapter])

  /** Turn to a page of this section: the spotlight lands on its first line. */
  const goToPage = useCallback(
    (page: number) => {
      if (!ready) return
      setLookup(null)
      if (page >= pageCount) {
        finishSection()
        return
      }
      if (page < 0) {
        if (chapterIndex > 0) goToChapter(chapterIndex - 1, 'end')
        return
      }
      setUnitIndex(pages[page].firstUnit)
    },
    [ready, pageCount, pages, finishSection, chapterIndex, goToChapter]
  )

  // ---- settings ---------------------------------------------------------------

  /**
   * Every settings change from inside the reader goes through here. Switching
   * granularity renumbers the units, so land on whichever unit now contains the
   * word we were already on rather than reusing an index that has changed
   * meaning. Doing it here — where the change happens — keeps it out of an
   * effect that would otherwise run after every single render.
   */
  const applySettings = useCallback(
    (nextSettings: Settings): void => {
      if (nextSettings.granularity !== settings.granularity) {
        const target = wordsIntoChapter
        const rebuilt = buildChapterUnits(chapter, nextSettings.granularity)
        const index = rebuilt.units.findIndex((u) => target < u.wordsBefore + u.words)
        setUnitIndex(index === -1 ? Math.max(0, rebuilt.units.length - 1) : index)
      }
      onSettingsChange(nextSettings)
    },
    [settings.granularity, wordsIntoChapter, chapter, onSettingsChange]
  )

  // ---- keyboard -------------------------------------------------------------

  const onKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOverlay('park')
        return
      }

      if (typing) return

      // A picture at full size is the whole window: reading keys would move
      // the spotlight behind something you can't see.
      if (zoomed !== null) {
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          setZoomed(null)
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // The quiz is the one overlay Escape shouldn't dismiss by accident.
        if (overlay === 'quiz') return
        if (lookup !== null) setLookup(null)
        else if (overlay === 'none') onExit()
        else setOverlay('none')
        return
      }

      if (overlay === 'park' || overlay === 'quiz') return

      switch (e.key) {
        case ' ':
        case 'ArrowRight':
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          next()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          prev()
          break
        case 'PageDown':
          e.preventDefault()
          goToPage(currentPage + 1)
          break
        case 'PageUp':
          e.preventDefault()
          goToPage(currentPage - 1)
          break
        case 'Home':
          e.preventDefault()
          goToPage(0)
          break
        case 'End':
          e.preventDefault()
          if (pageCount > 0) goToPage(pageCount - 1)
          break
        case ']':
          e.preventDefault()
          goToChapter(chapterIndex + 1)
          break
        case '[':
          e.preventDefault()
          goToChapter(chapterIndex - 1)
          break
        case 'b':
          applySettings({ ...settings, bionic: !settings.bionic })
          announce(`Bionic bolding ${settings.bionic ? 'off' : 'on'}`)
          break
        case 'd':
          applySettings({ ...settings, focusDim: !settings.focusDim })
          announce(`Spotlight focus ${settings.focusDim ? 'off' : 'on'}`)
          break
        case 'g': {
          const granularity = settings.granularity === 'sentence' ? 'paragraph' : 'sentence'
          applySettings({ ...settings, granularity })
          announce(`Spotlight moves by ${granularity}`)
          break
        }
        case '+':
        case '=':
          e.preventDefault()
          zoomBy(1)
          break
        case '-':
          e.preventDefault()
          zoomBy(-1)
          break
        case '0':
          setZoom('page')
          break
        case 'f':
          setZoom(settings.zoom === 'width' ? 'page' : 'width')
          break
        case 't':
          setOverlay((o) => (o === 'chapters' ? 'none' : 'chapters'))
          break
        case 'n':
          setOverlay((o) => (o === 'notes' ? 'none' : 'notes'))
          break
        case 'w':
          setOverlay((o) => (o === 'words' ? 'none' : 'words'))
          break
        case ',':
          setOverlay((o) => (o === 'settings' ? 'none' : 'settings'))
          break
        default:
          break
      }
    },
    [
      next,
      prev,
      goToPage,
      goToChapter,
      chapterIndex,
      currentPage,
      pageCount,
      overlay,
      lookup,
      zoomed,
      settings,
      applySettings,
      setZoom,
      zoomBy,
      onExit,
      announce
    ]
  )

  // The handler changes on nearly every keystroke; the subscription shouldn't.
  const keyHandlerRef = useRef(onKeyDown)
  useEffect(() => {
    keyHandlerRef.current = onKeyDown
  }, [onKeyDown])

  useEffect(() => {
    const listener = (e: KeyboardEvent): void => keyHandlerRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ---- keep the page in view -----------------------------------------------

  const sheetEls = useRef(new Map<number, HTMLElement>())
  const registerSheet = useCallback((index: number, el: HTMLElement | null) => {
    if (el) sheetEls.current.set(index, el)
    else sheetEls.current.delete(index)
  }, [])

  /**
   * When the whole sheet fits the window, the page is the thing to keep in
   * view: turning to a new one brings it in whole and top-aligned, and moving
   * the spotlight within a page moves nothing — the page is already there.
   * When the sheet is taller than the window, the line is what matters, and it
   * is brought back toward the middle only once it has strayed toward an edge.
   * A sentence cut by the foot of the page is lit on two sheets, so both halves
   * are brought into view together — the page turns half-way to keep the
   * thought whole.
   */
  const lastScrolledChapter = useRef<number | null>(null)
  useEffect(() => {
    if (!ready) return
    const viewer = viewerRef.current
    const sheet = sheetEls.current.get(currentPage)
    if (!viewer || !sheet) return

    const behavior: ScrollBehavior =
      lastScrolledChapter.current === chapterIndex ? 'smooth' : 'auto'
    lastScrolledChapter.current = chapterIndex

    const view = viewer.getBoundingClientRect()
    const box = sheet.getBoundingClientRect()
    const straddles = (layout.lastPageOfUnit[safeUnitIndex] ?? currentPage) > currentPage
    const scrollTo = (top: number): void => viewer.scrollTo({ top: viewer.scrollTop + top, behavior })

    if (!straddles && box.height <= view.height - 2 * SHEET_GAP + 1) {
      const above = box.top < view.top + SHEET_GAP - 1
      const below = box.bottom > view.bottom - SHEET_GAP + 1
      if (above || below) scrollTo(box.top - view.top - SHEET_GAP)
      return
    }

    // Every half of the lit unit, wherever it is drawn.
    const lit = Array.from(viewer.querySelectorAll<HTMLElement>('.unit-active'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
    if (lit.length === 0) {
      scrollTo(box.top - view.top - SHEET_GAP)
      return
    }
    const top = Math.min(...lit.map((r) => r.top))
    const bottom = Math.max(...lit.map((r) => r.bottom))

    const upper = view.top + view.height * 0.12
    const lower = view.bottom - view.height * 0.3
    if (top >= upper && bottom <= lower) return

    if (bottom - top > view.height * 0.6) scrollTo(top - upper)
    else scrollTo((top + bottom) / 2 - view.top - view.height * 0.42)
  }, [ready, layout, currentPage, safeUnitIndex, chapterIndex, scale, reflow])

  // ---- time + progress -------------------------------------------------------

  useEffect(() => {
    const timer = window.setInterval(() => setMinutesRead((m) => m + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const wordsRead = (sectionStats.offsets[chapterIndex] ?? 0) + wordsIntoChapter
  useEffect(() => {
    const nextProgress: Progress = {
      chapterIndex,
      unitIndex: safeUnitIndex,
      wordsRead,
      minutesRead,
      updatedAt: Date.now()
    }
    const timer = window.setTimeout(() => {
      onProgress(nextProgress)
    }, 700)
    return () => {
      window.clearTimeout(timer)
      // Leaving quickly should still establish a resume point. Cleanup also
      // runs when the active unit changes, which safely writes the last unit
      // before the next delayed save takes over.
      onProgress(nextProgress)
    }
  }, [chapterIndex, safeUnitIndex, wordsRead, minutesRead, onProgress])

  const bookFraction = sectionStats.total === 0 ? 0 : wordsRead / sectionStats.total

  // ---- quiz -------------------------------------------------------------------

  const chapterText = useMemo(
    () =>
      chapter.blocks
        .map((b) => b.text)
        .filter((text) => text !== '')
        .join('\n\n'),
    [chapter]
  )

  /**
   * Thinking mode needs upwards of a minute, so the quiz is started while
   * there's still a chunk of the section left to read. By the time you reach
   * the end it is usually sitting there waiting. Once per section: the main
   * process joins any request already in flight.
   */
  const prefetchedFor = useRef<string | null>(null)
  useEffect(() => {
    if (units.length === 0) return
    if (prefetchedFor.current === chapter.id) return
    if (safeUnitIndex / units.length < 0.65) return

    prefetchedFor.current = chapter.id
    if (quizEnabled) void window.api.prefetchQuiz(chapter.title, chapterText)

    // The next section's heads-up, built now so it's already there when you
    // arrive — the whole point is that it costs you no waiting.
    if (previewEnabled) {
      const upcoming = doc.chapters[chapterIndex + 1]
      if (upcoming) {
        void window.api.prefetchPreview(
          upcoming.title,
          upcoming.blocks
            .map((b) => b.text)
            .filter((text) => text !== '')
            .join('\n\n')
        )
      }
    }
  }, [
    quizEnabled,
    previewEnabled,
    safeUnitIndex,
    units.length,
    chapter.id,
    chapter.title,
    chapterText,
    doc,
    chapterIndex
  ])

  const handleQuizDone = useCallback(
    (result: { summary: string; score: number; total: number } | null) => {
      if (result && result.summary !== '') {
        onAddNote({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          bookId: meta.id,
          bookTitle: meta.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          summary: result.summary,
          score: result.score,
          total: result.total,
          createdAt: Date.now()
        })
      }
      setOverlay('none')
      advanceSection()
    },
    [advanceSection, chapter.id, chapter.title, meta.id, meta.title, onAddNote]
  )

  // ---- saved words -------------------------------------------------------------

  /** A word is kept per sentence: the same word in a new context is a new entry. */
  const findSaved = useCallback(
    (lemma: string, sentence: string): SavedWord | undefined =>
      words.find(
        (w) => w.lemma.toLowerCase() === lemma.toLowerCase() && w.sentence === sentence
      ),
    [words]
  )

  const isWordSaved = useCallback(
    (lemma: string, sentence: string): boolean => findSaved(lemma, sentence) !== undefined,
    [findSaved]
  )

  const toggleSaveWord = useCallback(
    (explanation: WordExplanation) => {
      if (lookup === null) return

      const existing = findSaved(explanation.lemma, lookup.sentence)
      if (existing) {
        onDeleteWord(existing.id)
        announce(`Forgot “${existing.lemma}”`)
        return
      }

      onAddWord({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word: explanation.word,
        lemma: explanation.lemma,
        meaning: explanation.meaning,
        trick: explanation.trick,
        related: explanation.related,
        sentence: lookup.sentence,
        bookId: meta.id,
        bookTitle: meta.title,
        chapterTitle: chapter.title,
        createdAt: Date.now()
      })
      announce(`Saved “${explanation.lemma}”`)
    },
    [lookup, findSaved, meta.id, meta.title, chapter.title, onAddWord, onDeleteWord, announce]
  )

  // ---- render ----------------------------------------------------------------

  const openThoughtCount = useMemo(
    () => thoughts.filter((t) => !t.done && (t.bookId === meta.id || t.bookId === null)).length,
    [thoughts, meta.id]
  )
  const bookNoteCount = useMemo(
    () => notes.filter((n) => n.bookId === meta.id).length,
    [notes, meta.id]
  )
  const bookWordCount = useMemo(
    () => words.filter((w) => w.bookId === meta.id).length,
    [words, meta.id]
  )

  const statusOf = (page: { lowestUnit: number; lastUnit: number }): SheetStatus =>
    safeUnitIndex >= page.lowestUnit && safeUnitIndex <= page.lastUnit
      ? 'current'
      : page.lastUnit < safeUnitIndex
        ? 'read'
        : 'unread'

  return (
    <div className="reader">
      <header className="reader-bar">
        <button className="ghost" onClick={onExit} title="Back to library (Esc)">
          ←
        </button>
        <button className="chapter-button" onClick={() => setOverlay('chapters')} title="Sections (T)">
          <span className="chapter-name">{chapter.title}</span>
          <span className="chapter-count">
            {chapterIndex + 1} / {doc.chapters.length}
          </span>
        </button>

        <div className="reader-bar-centre">
          <PageBox page={currentPage} count={pageCount} onJump={goToPage} />
          <span className="bar-divider" />
          <button className="ghost tiny" onClick={() => zoomBy(-1)} title="Zoom out (−)">
            −
          </button>
          <select
            className="zoom-select"
            value={String(settings.zoom)}
            onChange={(e) => {
              const raw = e.target.value
              setZoom(raw === 'page' || raw === 'width' ? raw : Number(raw))
            }}
            title="Zoom (0 fits the page, F fits the width)"
          >
            {ZOOM_PRESETS.every((p) => String(p.value) !== String(settings.zoom)) && (
              <option value={String(settings.zoom)}>{zoomLabel(settings.zoom)}</option>
            )}
            {ZOOM_PRESETS.map((preset) => (
              <option key={String(preset.value)} value={String(preset.value)}>
                {preset.label}
              </option>
            ))}
          </select>
          <button className="ghost tiny" onClick={() => zoomBy(1)} title="Zoom in (+)">
            +
          </button>
        </div>

        <div className="reader-bar-right">
          <button className="ghost" onClick={() => setOverlay('words')} title="Your words (W)">
            ◈{bookWordCount > 0 ? ` ${bookWordCount}` : ''}
          </button>
          <button className="ghost" onClick={() => setOverlay('notes')} title="Your notes (N)">
            ▤{bookNoteCount > 0 ? ` ${bookNoteCount}` : ''}
          </button>
          <button
            className="ghost"
            onClick={() => setOverlay('thoughts')}
            title="Parked thoughts (⌘K to add)"
          >
            ✎{openThoughtCount > 0 ? ` ${openThoughtCount}` : ''}
          </button>
          <button className="ghost" onClick={() => setOverlay('settings')} title="Settings (,)">
            ⚙
          </button>
        </div>
      </header>

      <div className="viewer-wrap">
        {pageCount > 1 && <PageRail pageCount={pageCount} current={currentPage} onPick={goToPage} />}

        <div className="viewer" ref={viewerRef}>
          <div
            ref={sheetsRef}
            className={`sheets${settings.focusDim ? ' dim' : ''}`}
            style={{
              width: `${geometry.sheetWidth * scale}px`,
              gap: `${SHEET_GAP}px`,
              ['--dim' as string]: settings.dimOpacity
            }}
          >
            {previewEnabled && previewHiddenFor !== chapter.id && (
              <SectionPreview
                key={chapter.id}
                chapterTitle={chapter.title}
                text={chapterText}
                onDismiss={() => setPreviewHiddenFor(chapter.id)}
              />
            )}

            {pages.map((page) => (
              <Sheet
                key={page.index}
                page={page}
                sectionTitle={chapter.title}
                bookTitle={meta.title}
                geometry={geometry}
                scale={scale}
                settings={settings}
                status={statusOf(page)}
                activeIndex={
                  safeUnitIndex >= page.lowestUnit && safeUnitIndex <= page.lastUnit
                    ? safeUnitIndex
                    : -1
                }
                onSelect={setUnitIndex}
                onExplain={explainWord}
                onOpen={setZoomed}
                activeRef={activeRef}
                sheetRef={registerSheet}
              />
            ))}

            {ready && (
              <div className="page-end">
                {!atLastSection ? (
                  <>
                    <span className="page-end-kicker">End of section</span>
                    <button className="primary" onClick={finishSection}>
                      {quizEnabled ? 'Finish section' : 'Next section'}:{' '}
                      {doc.chapters[chapterIndex + 1]?.title}
                    </button>
                  </>
                ) : (
                  <p className="muted">That’s the end of the book. Nice work.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Hud
        chapterWords={chapterWords}
        wordsIntoChapter={wordsIntoChapter}
        pageIndex={currentPage}
        pageCount={pageCount}
        sectionWords={sectionStats.words}
        totalWords={sectionStats.total}
        sectionPosition={chapterIndex}
        bookFraction={bookFraction}
        wpm={settings.wpm}
      />

      {!ready && (
        <PageMeasurer
          layoutKey={layoutKey}
          leadTitle={leadTitle}
          blocks={blocks}
          units={units}
          geometry={geometry}
          settings={settings}
          onLayout={setLayout}
        />
      )}

      {lookup !== null ? (
        <WordPopover
          lookup={lookup}
          aiReady={aiReady}
          onToggleSave={toggleSaveWord}
          isSaved={isWordSaved}
          onClose={() => setLookup(null)}
        />
      ) : null}

      {zoomed !== null ? <ImageViewer image={zoomed} onClose={() => setZoomed(null)} /> : null}

      {toast !== null ? <div className="toast">{toast}</div> : null}

      {overlay === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={applySettings}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'chapters' && (
        <ChapterList
          chapters={doc.chapters}
          current={chapterIndex}
          onPick={(i) => {
            goToChapter(i)
            setOverlay('none')
          }}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'thoughts' && (
        <ThoughtPanel
          thoughts={thoughts}
          bookId={meta.id}
          onToggle={onToggleThought}
          onDelete={onDeleteThought}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'notes' && (
        <NotesPanel
          notes={notes}
          bookId={meta.id}
          onDelete={onDeleteNote}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'words' && (
        <WordsPanel
          words={words}
          bookId={meta.id}
          onDelete={onDeleteWord}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'park' && (
        <ParkPrompt
          onSave={(text) => {
            onAddThought(text)
            setOverlay('none')
          }}
          onCancel={() => setOverlay('none')}
        />
      )}

      {overlay === 'quiz' && (
        <SectionQuiz
          chapterTitle={chapter.title}
          text={chapterText}
          onDone={handleQuizDone}
          onReread={() => {
            setOverlay('none')
            setUnitIndex(0)
          }}
        />
      )}
    </div>
  )
}

/**
 * The page box from a PDF viewer's toolbar: the page you are on, over how many
 * there are, and a place to type the one you want.
 */
function PageBox({
  page,
  count,
  onJump
}: {
  page: number
  count: number
  onJump: (page: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(Math.min(page + 1, Math.max(1, count)))

  const commit = (): void => {
    if (draft !== null) {
      const wanted = Number.parseInt(draft, 10)
      if (Number.isFinite(wanted) && count > 0) {
        onJump(Math.max(0, Math.min(count - 1, wanted - 1)))
      }
    }
    setDraft(null)
  }

  return (
    <label className="page-box" title="Page within this section">
      <input
        type="text"
        inputMode="numeric"
        value={shown}
        onFocus={(e) => {
          setDraft(shown)
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
      <span className="page-box-of">/ {Math.max(1, count)}</span>
    </label>
  )
}
