import { useEffect, useMemo, useState } from 'react'
import type { BookMeta, Progress, Subject } from '../../../shared/types'
import { SubjectMenu } from './SubjectMenu'

interface Props {
  books: BookMeta[]
  subjects: Subject[]
  progress: Record<string, Progress>
  busy: string | null
  error: string | null
  onOpen: (meta: BookMeta) => void
  /** A book added while a subject is on screen lands on that shelf. */
  onAdd: (subjectId: string | null) => void
  onAddPaths: (paths: string[], subjectId: string | null) => void
  onAddUrl: (url: string, subjectId: string | null) => void
  onRemove: (id: string) => void
  /** Resolves with the subject, so whatever asked for it can use it at once. */
  onCreateSubject: (name: string) => Promise<Subject>
  onRenameSubject: (id: string, name: string) => void
  onDeleteSubject: (id: string) => void
  onSetSubject: (bookId: string, subjectId: string | null) => void
  onOpenThoughts: () => void
  openThoughtCount: number
  onOpenNotes: () => void
  noteCount: number
  onOpenWords: () => void
  wordCount: number
  onOpenSettings: () => void
  /** False until an OpenRouter key is in place; the AI extras stay off till then. */
  aiReady: boolean
  onAddKey: () => void
}

/** Which shelf is on screen: everything, one subject, or the books on none. */
type Shelf = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'subject'; id: string }

function percent(meta: BookMeta, progress?: Progress): number {
  if (!progress || meta.totalWords === 0) return 0
  return Math.min(100, Math.round((progress.wordsRead / meta.totalWords) * 100))
}

export function Library({
  books,
  subjects,
  progress,
  busy,
  error,
  onOpen,
  onAdd,
  onAddPaths,
  onAddUrl,
  onRemove,
  onCreateSubject,
  onRenameSubject,
  onDeleteSubject,
  onSetSubject,
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
  const [shelf, setShelf] = useState<Shelf>({ kind: 'all' })
  /** The book whose subject menu is open, if any. */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [newSubject, setNewSubject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirmDrop, setConfirmDrop] = useState(false)

  // An armed confirmation that stays armed is a subject dropped by a stray
  // click some minutes later. It forgets on its own.
  useEffect(() => {
    if (!confirmDrop) return
    const timer = window.setTimeout(() => setConfirmDrop(false), 5000)
    return () => window.clearTimeout(timer)
  }, [confirmDrop])

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

  // Books whose subject was dropped elsewhere count as unfiled, not as
  // members of a shelf that no longer exists.
  const { bySubject, unfiled } = useMemo(() => {
    const known = new Set(subjects.map((s) => s.id))
    const grouped = new Map<string, BookMeta[]>()
    const loose: BookMeta[] = []

    for (const book of books) {
      const id = book.subjectId
      if (id && known.has(id)) {
        const shelved = grouped.get(id)
        if (shelved) shelved.push(book)
        else grouped.set(id, [book])
      } else {
        loose.push(book)
      }
    }
    return { bySubject: grouped, unfiled: loose }
  }, [books, subjects])

  const activeSubject =
    shelf.kind === 'subject' ? (subjects.find((s) => s.id === shelf.id) ?? null) : null

  const visible =
    shelf.kind === 'all'
      ? books
      : shelf.kind === 'unfiled'
        ? unfiled
        : (bySubject.get(shelf.id) ?? [])

  // One pass for the most-recent book, rather than copying and sorting the
  // whole shelf to read a single element off the front. It follows the shelf
  // you are looking at: a card offering another subject's book is a distraction.
  const lastRead = useMemo(() => {
    let best: BookMeta | undefined
    for (const book of visible) {
      if (!best || (book.lastOpenedAt ?? 0) > (best.lastOpenedAt ?? 0)) best = book
    }
    return best
  }, [visible])

  const lastProgress = lastRead ? progress[lastRead.id] : undefined
  const addTo = shelf.kind === 'subject' ? shelf.id : null

  const submitUrl = (): void => {
    if (url.trim() === '') return
    onAddUrl(url, addTo)
    setUrl('')
  }

  const goToShelf = (next: Shelf): void => {
    setShelf(next)
    setRenaming(false)
    setConfirmDrop(false)
    setMenuFor(null)
  }

  const chip = (label: string, count: number, target: Shelf, on: boolean): JSX.Element => (
    <button className={`chip${on ? ' on' : ''}`} onClick={() => goToShelf(target)}>
      {label}
      <span className="chip-count">{count}</span>
    </button>
  )

  const shelfGrid = (list: BookMeta[]): JSX.Element => (
    <ul className="shelf">
      {list.map((book) => {
        const pct = percent(book, progress[book.id])
        const on = subjects.find((s) => s.id === book.subjectId)
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
              className={`subject-pill${menuFor === book.id ? ' open' : ''}`}
              title={on ? `Filed under ${on.name}` : 'Put this on a subject shelf'}
              onClick={() => setMenuFor(menuFor === book.id ? null : book.id)}
            >
              {on ? on.name : '＋ Subject'}
            </button>

            {menuFor === book.id && (
              <SubjectMenu
                subjects={subjects}
                current={on?.id ?? null}
                onPick={(subjectId) => {
                  onSetSubject(book.id, subjectId)
                  setMenuFor(null)
                }}
                onCreate={(name) => {
                  void onCreateSubject(name).then((made) => onSetSubject(book.id, made.id))
                  setMenuFor(null)
                }}
                onClose={() => setMenuFor(null)}
              />
            )}

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
  )

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
          onAddPaths(paths, addTo)
          return
        }
        // A link dragged out of a browser arrives as text, not as a file.
        const dropped = (
          e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
        )
          .split('\n')
          .find((line) => /^https?:\/\//i.test(line.trim()))
        if (dropped) onAddUrl(dropped.trim(), addTo)
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
          <button className="primary" onClick={() => onAdd(addTo)}>
            Add book
          </button>
        </div>
      </header>

      <div className="subject-bar">
        {chip('All', books.length, { kind: 'all' }, shelf.kind === 'all')}
        {subjects.map((subject) =>
          chip(
            subject.name,
            bySubject.get(subject.id)?.length ?? 0,
            { kind: 'subject', id: subject.id },
            shelf.kind === 'subject' && shelf.id === subject.id
          )
        )}
        {unfiled.length > 0 &&
          subjects.length > 0 &&
          chip('Unfiled', unfiled.length, { kind: 'unfiled' }, shelf.kind === 'unfiled')}

        {newSubject === null ? (
          <button className="chip new" onClick={() => setNewSubject('')}>
            ＋ Subject
          </button>
        ) : (
          <input
            className="chip-input"
            autoFocus
            value={newSubject}
            placeholder="Name it"
            maxLength={60}
            onChange={(e) => setNewSubject(e.target.value)}
            onBlur={() => setNewSubject(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNewSubject(null)
              if (e.key === 'Enter' && newSubject.trim() !== '') {
                void onCreateSubject(newSubject.trim()).then((made) =>
                  goToShelf({ kind: 'subject', id: made.id })
                )
                setNewSubject(null)
              }
            }}
          />
        )}
      </div>

      <div className="add-url">
        <input
          type="url"
          value={url}
          placeholder={
            activeSubject
              ? `Paste an article address to read it under ${activeSubject.name}`
              : 'Paste an article address to read it here'
          }
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
              They ask a language model through OpenRouter, so they need an API key. Everything else already works.
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

      {activeSubject && (
        <div className="subject-head">
          {renaming ? (
            <input
              className="subject-rename"
              autoFocus
              defaultValue={activeSubject.name}
              maxLength={60}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setRenaming(false)
                if (e.key === 'Enter') {
                  const name = e.currentTarget.value.trim()
                  if (name !== '') onRenameSubject(activeSubject.id, name)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <h2>{activeSubject.name}</h2>
          )}
          <div className="subject-head-actions">
            <button className="ghost tiny" onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button
              className={`ghost tiny${confirmDrop ? ' armed' : ''}`}
              onClick={() => {
                if (!confirmDrop) {
                  setConfirmDrop(true)
                  return
                }
                onDeleteSubject(activeSubject.id)
                goToShelf({ kind: 'all' })
              }}
            >
              {confirmDrop ? 'Drop it — the books stay' : 'Drop subject'}
            </button>
          </div>
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty">
          <p>No books yet.</p>
          <p className="muted">
            Drop an EPUB, a PDF or a link here — or paste an article address above.
          </p>
        </div>
      ) : shelf.kind === 'all' && subjects.length > 0 ? (
        <>
          {subjects.map((subject) => {
            const shelved = bySubject.get(subject.id)
            if (!shelved || shelved.length === 0) return null
            return (
              <section className="shelf-group" key={subject.id}>
                <h2 className="shelf-heading">
                  <button onClick={() => goToShelf({ kind: 'subject', id: subject.id })}>
                    {subject.name}
                  </button>
                  <span className="muted">{shelved.length}</span>
                </h2>
                {shelfGrid(shelved)}
              </section>
            )
          })}
          {unfiled.length > 0 && (
            <section className="shelf-group">
              <h2 className="shelf-heading">
                <button onClick={() => goToShelf({ kind: 'unfiled' })}>Unfiled</button>
                <span className="muted">{unfiled.length}</span>
              </h2>
              {shelfGrid(unfiled)}
            </section>
          )}
        </>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>Nothing under {activeSubject ? activeSubject.name : 'Unfiled'} yet.</p>
          <p className="muted">
            Add a book while this shelf is open, or move one here from the ＋ Subject button on
            its card.
          </p>
        </div>
      ) : (
        shelfGrid(visible)
      )}

      {dragging && (
        <div className="drop-hint">
          {activeSubject ? `Drop into ${activeSubject.name}` : 'Drop to add'}
        </div>
      )}
    </div>
  )
}
