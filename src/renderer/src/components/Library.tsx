import { useEffect, useMemo, useState } from 'react'
import type { BookMeta, Progress } from '../../../shared/types'

interface Props {
  books: BookMeta[]
  progress: Record<string, Progress>
  busy: string | null
  error: string | null
  onOpen: (meta: BookMeta) => void
  onAdd: () => void
  onAddPaths: (paths: string[]) => void
  onAddUrl: (url: string) => void
  onRemove: (id: string) => void
  onOpenThoughts: () => void
  openThoughtCount: number
  onOpenNotes: () => void
  noteCount: number
  onOpenWords: () => void
  wordCount: number
  onOpenSettings: () => void
  /** False until a DeepSeek key is in place; the AI extras stay off till then. */
  aiReady: boolean
  onAddKey: () => void
}

function percent(meta: BookMeta, progress?: Progress): number {
  if (!progress || meta.totalWords === 0) return 0
  return Math.min(100, Math.round((progress.wordsRead / meta.totalWords) * 100))
}

export function Library({
  books,
  progress,
  busy,
  error,
  onOpen,
  onAdd,
  onAddPaths,
  onAddUrl,
  onRemove,
  onOpenThoughts,
  openThoughtCount,
  onOpenNotes,
  noteCount,
  onOpenWords,
  wordCount,
  onOpenSettings,
  aiReady,
  onAddKey
}: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')

  // Same key as in the reader, so it works wherever you are.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenSettings])

  const submitUrl = (): void => {
    if (url.trim() === '') return
    onAddUrl(url)
    setUrl('')
  }

  // One pass for the most-recent book, rather than copying and sorting the
  // whole shelf to read a single element off the front.
  const lastRead = useMemo(() => {
    let best: BookMeta | undefined
    for (const book of books) {
      if (!best || (book.lastOpenedAt ?? 0) > (best.lastOpenedAt ?? 0)) best = book
    }
    return best
  }, [books])

  const lastProgress = lastRead ? progress[lastRead.id] : undefined

  return (
    <div
      className={`library${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const paths = Array.from(e.dataTransfer.files).map((file) => window.api.pathForFile(file))
        if (paths.length > 0) {
          onAddPaths(paths)
          return
        }
        // A link dragged out of a browser arrives as text, not as a file.
        const dropped = (
          e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
        )
          .split('\n')
          .find((line) => /^https?:\/\//i.test(line.trim()))
        if (dropped) onAddUrl(dropped.trim())
      }}
    >
      <header className="library-bar">
        <h1>Focus Reader</h1>
        <div className="library-bar-right">
          <button className="ghost boxed" onClick={onOpenWords}>
            ◈ Words{wordCount > 0 ? ` (${wordCount})` : ''}
          </button>
          <button className="ghost boxed" onClick={onOpenNotes}>
            ▤ Notes{noteCount > 0 ? ` (${noteCount})` : ''}
          </button>
          <button className="ghost boxed" onClick={onOpenThoughts}>
            ✎ Parked{openThoughtCount > 0 ? ` (${openThoughtCount})` : ''}
          </button>
          <button className="ghost boxed" title="Settings (,)" onClick={onOpenSettings}>
            ⚙ Settings
          </button>
          <button className="primary" onClick={onAdd}>
            Add book
          </button>
        </div>
      </header>

      <div className="add-url">
        <input
          type="url"
          value={url}
          placeholder="Paste an article address to read it here"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitUrl()
          }}
        />
        <button className="ghost boxed" disabled={url.trim() === ''} onClick={submitUrl}>
          Add article
        </button>
      </div>

      {!aiReady && (
        <div className="banner setup">
          <div>
            <strong>Word lookups, previews and quizzes are off.</strong>
            <span className="muted">
              {' '}
              They ask DeepSeek, so they need an API key. Everything else already works.
            </span>
          </div>
          <button className="ghost boxed" onClick={onAddKey}>
            Add a key
          </button>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      {busy && <div className="banner">{busy}</div>}

      {lastRead && lastProgress && (
        <button className="resume" onClick={() => onOpen(lastRead)}>
          <span className="resume-kicker">Pick up where you left off</span>
          <span className="resume-title">{lastRead.title}</span>
          <span className="muted">
            {percent(lastRead, lastProgress)}% · {lastProgress.minutesRead} minutes read so far
          </span>
        </button>
      )}

      {books.length === 0 ? (
        <div className="empty">
          <p>No books yet.</p>
          <p className="muted">
            Drop an EPUB, a PDF or a link here — or paste an article address above.
          </p>
        </div>
      ) : (
        <ul className="shelf">
          {books.map((book) => {
            const pct = percent(book, progress[book.id])
            return (
              <li key={book.id}>
                <button className="book" onClick={() => onOpen(book)}>
                  <span className="book-format">{book.format}</span>
                  <span className="book-title">{book.title}</span>
                  <span className="book-author">{book.author}</span>
                  <span className="book-track">
                    <span className="book-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="muted book-pct">
                    {pct > 0 ? `${pct}%` : `${Math.round(book.totalWords / 1000)}k words`}
                  </span>
                </button>
                <button
                  className="ghost tiny remove"
                  title="Remove from library"
                  onClick={() => onRemove(book.id)}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {dragging && <div className="drop-hint">Drop to add</div>}
    </div>
  )
}
