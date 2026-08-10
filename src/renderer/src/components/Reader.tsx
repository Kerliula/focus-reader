import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BookDoc,
  BookMeta,
  Note,
  Progress,
  SavedWord,
  Settings,
  Thought,
  WordExplanation
} from '../../../shared/types'
import { buildChapterUnits, countWords } from '../lib/units'
import { ReaderUnit } from './ReaderUnit'
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

  // ---- navigation -----------------------------------------------------------

  const goToChapter = useCallback(
    (index: number, position: 'start' | 'end' = 'start') => {
      setLookup(null)
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
        target?.isContentEditable === true

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOverlay('park')
        return
      }

      if (typing) return

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
        case '=': {
          const fontSize = Math.min(34, settings.fontSize + 1)
          applySettings({ ...settings, fontSize })
          announce(`Text size ${fontSize}px`)
          break
        }
        case '-': {
          const fontSize = Math.max(14, settings.fontSize - 1)
          applySettings({ ...settings, fontSize })
          announce(`Text size ${fontSize}px`)
          break
        }
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
      goToChapter,
      chapterIndex,
      overlay,
      lookup,
      settings,
      applySettings,
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

  // ---- keep the active line in view -----------------------------------------

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [safeUnitIndex, chapterIndex])

  // ---- time + progress -------------------------------------------------------

  useEffect(() => {
    const timer = window.setInterval(() => setMinutesRead((m) => m + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const wordsRead = (sectionStats.offsets[chapterIndex] ?? 0) + wordsIntoChapter
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onProgress({
        chapterIndex,
        unitIndex: safeUnitIndex,
        wordsRead,
        minutesRead,
        updatedAt: Date.now()
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [chapterIndex, safeUnitIndex, wordsRead, minutesRead, onProgress])

  const bookFraction = sectionStats.total === 0 ? 0 : wordsRead / sectionStats.total

  // ---- quiz -------------------------------------------------------------------

  const chapterText = useMemo(
    () => chapter.blocks.map((b) => b.text).join('\n\n'),
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
    if (!quizEnabled || units.length === 0) return
    if (prefetchedFor.current === chapter.id) return
    if (safeUnitIndex / units.length < 0.65) return

    prefetchedFor.current = chapter.id
    void window.api.prefetchQuiz(chapter.title, chapterText)
  }, [quizEnabled, safeUnitIndex, units.length, chapter.id, chapter.title, chapterText])

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

  // EPUB sections usually open with their own heading — don't print it twice.
  const firstBlock = chapter.blocks[0]
  const titleAppearsInText =
    firstBlock !== undefined &&
    (firstBlock.type === 'h1' || firstBlock.type === 'h2') &&
    firstBlock.text.trim().toLowerCase() === chapter.title.trim().toLowerCase()

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

      <div className="page-scroll">
        <article
          className={`page${settings.focusDim ? ' dim' : ''}`}
          style={{
            fontFamily: settings.fontFamily,
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            maxWidth: `${settings.columnWidth}px`,
            ['--dim' as string]: settings.dimOpacity
          }}
        >
          {!titleAppearsInText && <h1 className="page-chapter-title">{chapter.title}</h1>}

          {blocks.map((block) => {
            const Tag = (block.type === 'p'
              ? 'p'
              : block.type === 'quote'
                ? 'blockquote'
                : block.type) as keyof JSX.IntrinsicElements
            return (
              <Tag key={block.id} className={`blk blk-${block.type}`}>
                {block.units.map((unit) => (
                  <ReaderUnit
                    key={unit.key}
                    unit={unit}
                    isActive={unit.index === safeUnitIndex}
                    isRead={unit.index < safeUnitIndex}
                    bionic={settings.bionic}
                    bionicStrength={settings.bionicStrength}
                    onSelect={setUnitIndex}
                    onExplain={explainWord}
                    activeRef={activeRef}
                  />
                ))}
              </Tag>
            )
          })}

          <div className="page-end">
            {!atLastSection ? (
              <button className="primary" onClick={finishSection}>
                {quizEnabled ? 'Finish section' : 'Next section'}:{' '}
                {doc.chapters[chapterIndex + 1]?.title}
              </button>
            ) : (
              <p className="muted">That’s the end of the book. Nice work.</p>
            )}
          </div>
        </article>
      </div>

      <Hud
        chapterWords={chapterWords}
        wordsIntoChapter={wordsIntoChapter}
        sectionWords={sectionStats.words}
        totalWords={sectionStats.total}
        sectionPosition={chapterIndex}
        bookFraction={bookFraction}
        wpm={settings.wpm}
      />

      {lookup !== null ? (
        <WordPopover
          lookup={lookup}
          aiReady={aiReady}
          onToggleSave={toggleSaveWord}
          isSaved={isWordSaved}
          onClose={() => setLookup(null)}
        />
      ) : null}

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
