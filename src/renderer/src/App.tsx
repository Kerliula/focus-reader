import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BookDoc,
  BookMeta,
  Note,
  Progress,
  SavedWord,
  Settings,
  Thought
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { importBook, loadBook } from './lib/loadBook'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { ThoughtPanel } from './components/ThoughtPanel'
import { NotesPanel } from './components/NotesPanel'
import { WordsPanel } from './components/WordsPanel'

type View = { name: 'library' } | { name: 'reader'; meta: BookMeta; doc: BookDoc }

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [books, setBooks] = useState<BookMeta[]>([])
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [view, setView] = useState<View>({ name: 'library' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showThoughts, setShowThoughts] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [showNotes, setShowNotes] = useState(false)
  const [words, setWords] = useState<SavedWord[]>([])
  const [showWords, setShowWords] = useState(false)
  const [aiReady, setAiReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const [loadedSettings, library, allProgress, savedThoughts, savedNotes, savedWords, ai] =
        await Promise.all([
          window.api.getSettings(),
          window.api.getLibrary(),
          window.api.getAllProgress(),
          window.api.getThoughts(),
          window.api.getNotes(),
          window.api.getWords(),
          window.api.aiAvailable()
        ])
      setSettings(loadedSettings)
      setBooks(library)
      setProgress(allProgress)
      setThoughts(savedThoughts)
      setNotes(savedNotes)
      setWords(savedWords)
      setAiReady(ai)
    })()
  }, [])

  // The key can be pasted in mid-session; re-check once it changes.
  useEffect(() => {
    void window.api.aiAvailable().then(setAiReady)
  }, [settings.apiKey])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Settings are written back on a short delay so dragging a slider is smooth.
  const firstSettingsRender = useRef(true)
  useEffect(() => {
    if (firstSettingsRender.current) {
      firstSettingsRender.current = false
      return
    }
    const timer = window.setTimeout(() => void window.api.saveSettings(settings), 400)
    return () => window.clearTimeout(timer)
  }, [settings])

  // These callbacks are handed to the reader, which re-renders a whole chapter.
  // Reading the current list through a ref keeps their identity stable, so
  // parking a thought doesn't re-render the page you're reading.
  const thoughtsRef = useRef(thoughts)
  useEffect(() => {
    thoughtsRef.current = thoughts
  }, [thoughts])

  const persistThoughts = useCallback((next: Thought[]) => {
    thoughtsRef.current = next
    setThoughts(next)
    void window.api.saveThoughts(next)
  }, [])

  const currentBookId = view.name === 'reader' ? view.meta.id : null
  const currentBookIdRef = useRef(currentBookId)
  useEffect(() => {
    currentBookIdRef.current = currentBookId
  }, [currentBookId])

  const addThought = useCallback(
    (text: string) => {
      const thought: Thought = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        bookId: currentBookIdRef.current,
        text,
        createdAt: Date.now(),
        done: false
      }
      persistThoughts([thought, ...thoughtsRef.current])
    },
    [persistThoughts]
  )

  const toggleThought = useCallback(
    (id: string) => {
      persistThoughts(
        thoughtsRef.current.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      )
    },
    [persistThoughts]
  )

  const deleteThought = useCallback(
    (id: string) => persistThoughts(thoughtsRef.current.filter((t) => t.id !== id)),
    [persistThoughts]
  )

  const addNote = useCallback((note: Note) => {
    void window.api.addNote(note).then(setNotes)
  }, [])

  const deleteNote = useCallback((id: string) => {
    void window.api.deleteNote(id).then(setNotes)
  }, [])

  const addWord = useCallback((word: SavedWord) => {
    void window.api.addWord(word).then(setWords)
  }, [])

  const deleteWord = useCallback((id: string) => {
    void window.api.deleteWord(id).then(setWords)
  }, [])

  const addPaths = useCallback(async (paths: string[]) => {
    setError(null)
    for (const path of paths) {
      const format = await window.api.formatFor(path)
      if (!format) {
        setError(`${path.split('/').pop()} is not an EPUB or PDF.`)
        continue
      }
      setBusy(`Reading ${path.split('/').pop()}…`)
      try {
        await importBook(path, format)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    setBooks(await window.api.getLibrary())
    setBusy(null)
  }, [])

  const addBooks = useCallback(async () => {
    const picked = await window.api.openBooks()
    if (picked.length > 0) await addPaths(picked.map((p) => p.path))
  }, [addPaths])

  const addArticle = useCallback(async (rawUrl: string) => {
    setError(null)
    // Pasting a bare "example.com/post" is the common case, not a typo.
    const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`
    setBusy(`Fetching ${new URL(url).hostname}…`)
    try {
      await importBook(url, 'article')
      setBooks(await window.api.getLibrary())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const openBook = useCallback(async (meta: BookMeta) => {
    setError(null)
    setBusy(`Opening ${meta.title}…`)
    try {
      // An article's "path" is a URL, and its text is already parsed and
      // cached — there is no file on disk to go looking for.
      if (meta.format !== 'article' && !(await window.api.fileExists(meta.path))) {
        throw new Error(`${meta.title} has moved or been deleted — remove it and add it again.`)
      }
      const doc = await loadBook(meta)
      const updated: BookMeta = { ...meta, lastOpenedAt: Date.now() }
      setBooks(await window.api.upsertBook(updated))
      setView({ name: 'reader', meta: updated, doc })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const removeBook = useCallback(async (id: string) => {
    setBooks(await window.api.removeBook(id))
    setProgress((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  const saveProgress = useCallback((bookId: string, next: Progress) => {
    setProgress((current) => ({ ...current, [bookId]: next }))
    void window.api.saveProgress(bookId, next)
  }, [])

  const readerProgressHandler = useCallback(
    (next: Progress) => {
      if (currentBookId) saveProgress(currentBookId, next)
    },
    [currentBookId, saveProgress]
  )

  const openThoughtCount = useMemo(() => thoughts.filter((t) => !t.done).length, [thoughts])

  if (view.name === 'reader') {
    return (
      <Reader
        doc={view.doc}
        meta={view.meta}
        settings={settings}
        onSettingsChange={setSettings}
        initialProgress={progress[view.meta.id] ?? null}
        onProgress={readerProgressHandler}
        onExit={() => setView({ name: 'library' })}
        thoughts={thoughts}
        onAddThought={addThought}
        onToggleThought={toggleThought}
        onDeleteThought={deleteThought}
        notes={notes}
        onAddNote={addNote}
        onDeleteNote={deleteNote}
        words={words}
        onAddWord={addWord}
        onDeleteWord={deleteWord}
        aiReady={aiReady}
      />
    )
  }

  return (
    <>
      <Library
        books={books}
        progress={progress}
        busy={busy}
        error={error}
        onOpen={(meta) => void openBook(meta)}
        onAdd={() => void addBooks()}
        onAddPaths={(paths) => void addPaths(paths)}
        onAddUrl={(url) => void addArticle(url)}
        onRemove={(id) => void removeBook(id)}
        onOpenThoughts={() => setShowThoughts(true)}
        openThoughtCount={openThoughtCount}
        onOpenNotes={() => setShowNotes(true)}
        noteCount={notes.length}
        onOpenWords={() => setShowWords(true)}
        wordCount={words.length}
      />
      {showThoughts && (
        <ThoughtPanel
          thoughts={thoughts}
          bookId={null}
          onToggle={toggleThought}
          onDelete={deleteThought}
          onClose={() => setShowThoughts(false)}
        />
      )}
      {showNotes && (
        <NotesPanel
          notes={notes}
          bookId={null}
          onDelete={deleteNote}
          onClose={() => setShowNotes(false)}
        />
      )}
      {showWords && (
        <WordsPanel
          words={words}
          bookId={null}
          onDelete={deleteWord}
          onClose={() => setShowWords(false)}
        />
      )}
    </>
  )
}
