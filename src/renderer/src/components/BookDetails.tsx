import { useEffect, useRef, useState } from 'react'
import type { BookMeta } from '../../../shared/types'

interface Props {
  /** The entry as read from the file — a suggestion, not a decision. */
  draft: BookMeta
  /** How many more books are waiting behind this one. */
  queued: number
  onSubmit: (title: string, author: string) => void
  onCancel: () => void
}

/** What the file was called, or where the article came from, for bearings. */
function sourceOf(meta: BookMeta): string {
  if (meta.format === 'article') {
    try {
      return new URL(meta.path).hostname
    } catch {
      return meta.path
    }
  }
  return meta.path.split('/').pop() ?? meta.path
}

/**
 * The last step of adding a book: its name and author, filled in from the
 * file and handed over to be checked. Files are guessed at — "final_v3.pdf"
 * by nobody — and the shelf is yours to read, so the words on it should be
 * yours too. Enter adds it, Escape leaves it out.
 */
export function BookDetails({ draft, queued, onSubmit, onCancel }: Props): JSX.Element {
  const [title, setTitle] = useState(draft.title)
  const [author, setAuthor] = useState(draft.author)
  const titleRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const ready = title.trim() !== ''

  const submit = (): void => {
    if (ready) onSubmit(title.trim(), author.trim())
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="book-details" role="dialog" aria-labelledby="book-details-kicker">
        <span id="book-details-kicker" className="quiz-kicker">
          New {draft.format === 'article' ? 'article' : 'book'}
          {queued > 0 ? ` · ${queued} more waiting` : ''}
        </span>
        <p className="book-details-source muted">{sourceOf(draft)}</p>

        <label className="book-details-field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            placeholder="What should it be called on the shelf?"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
          />
        </label>

        <label className="book-details-field">
          <span>Author</span>
          <input
            value={author}
            placeholder="Leave blank if there isn’t one"
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={onKey}
          />
        </label>

        <p className="book-details-hint muted">
          Filled in from the file, which is often wrong about both. Change what you like, then
          add it.
        </p>

        <div className="quiz-actions book-details-actions">
          <button className="ghost boxed" onClick={onCancel}>
            Don’t add
          </button>
          <button className="primary" disabled={!ready} onClick={submit}>
            Add to library
          </button>
        </div>
      </div>
    </>
  )
}
