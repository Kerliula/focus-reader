import { useMemo, useState } from 'react'
import type { SavedWord } from '../../../shared/types'

interface Props {
  words: SavedWord[]
  /** Set while reading, to offer this book's words first. */
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

/** Words you kept, newest first, each with the sentence you met it in. */
export function WordsPanel({ words, bookId, onDelete, onClose }: Props): JSX.Element {
  const [thisBookOnly, setThisBookOnly] = useState(bookId !== null)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return words.filter((w) => {
      if (thisBookOnly && bookId !== null && w.bookId !== bookId) return false
      if (needle === '') return true
      return (
        w.lemma.toLowerCase().includes(needle) ||
        w.word.toLowerCase().includes(needle) ||
        w.meaning.toLowerCase().includes(needle)
      )
    })
  }, [words, thisBookOnly, bookId, query])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Your words</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {words.length === 0 ? (
            <p className="muted">
              Nothing yet. Double-click a word while reading, then press Save on the card.
            </p>
          ) : (
            <>
              <div className="words-filter">
                <input
                  type="search"
                  value={query}
                  placeholder={`Search ${words.length} word${words.length === 1 ? '' : 's'}…`}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {bookId !== null && (
                  <div className="segmented">
                    <button
                      className={thisBookOnly ? 'seg on' : 'seg'}
                      onClick={() => setThisBookOnly(true)}
                    >
                      this book
                    </button>
                    <button
                      className={thisBookOnly ? 'seg' : 'seg on'}
                      onClick={() => setThisBookOnly(false)}
                    >
                      everything
                    </button>
                  </div>
                )}
              </div>

              {shown.length === 0 && <p className="muted">No word matches that.</p>}

              <ul className="words">
                {shown.map((word) => (
                  <li key={word.id}>
                    <div className="word-item-head">
                      <span className="word-item-lemma">{word.lemma}</span>
                      <button
                        className="ghost tiny"
                        title="Forget this word"
                        onClick={() => onDelete(word.id)}
                      >
                        ✕
                      </button>
                    </div>

                    <p className="word-item-meaning">{word.meaning}</p>

                    {word.trick !== '' && <p className="word-item-trick">{word.trick}</p>}

                    <p className="word-item-sentence">“{word.sentence}”</p>

                    <span className="note-meta">
                      {word.bookTitle} · {word.chapterTitle} · {when(word.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
