import type { Note } from '../../../shared/types'

interface Props {
  notes: Note[]
  bookId: string | null
  onDelete: (id: string) => void
  onClose: () => void
}

function when(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

/** What you wrote down after each section — the part you actually keep. */
export function NotesPanel({ notes, bookId, onDelete, onClose }: Props): JSX.Element {
  const relevant = bookId ? notes.filter((n) => n.bookId === bookId) : notes

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Your notes</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {relevant.length === 0 && (
            <p className="muted">
              Nothing yet. Finish a section, pass its quiz, and what you write gets kept here.
            </p>
          )}

          <ul className="notes">
            {relevant.map((note) => (
              <li key={note.id}>
                <div className="note-head">
                  <span className="note-chapter">{note.chapterTitle}</span>
                  <button className="ghost tiny" onClick={() => onDelete(note.id)}>
                    ✕
                  </button>
                </div>
                {!bookId && <span className="note-book">{note.bookTitle}</span>}
                <p className="note-summary">{note.summary}</p>
                <span className="note-meta">
                  {note.score}/{note.total} correct · {when(note.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  )
}
