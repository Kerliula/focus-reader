import { useEffect, useRef, useState } from 'react'
import type { Subject } from '../../../shared/types'

interface Props {
  subjects: Subject[]
  /** The subject this book is on now, so the menu can mark it. */
  current: string | null
  onPick: (subjectId: string | null) => void
  /** Make a subject and file the book on it in one move. */
  onCreate: (name: string) => void
  onClose: () => void
}

/** Where one book goes: pick a shelf, take it off one, or name a new one. */
export function SubjectMenu({ subjects, current, onPick, onCreate, onClose }: Props): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [naming, setNaming] = useState(subjects.length === 0)
  const [name, setName] = useState('')

  // A menu that stays open after you have looked away is a menu in the way.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const submit = (): void => {
    if (name.trim() === '') return
    onCreate(name.trim())
  }

  return (
    <div className="subject-menu" ref={box}>
      {subjects.map((subject) => (
        <button key={subject.id} onClick={() => onPick(subject.id)}>
          <span className="tick">{subject.id === current ? '✓' : ''}</span>
          <span className="subject-menu-name">{subject.name}</span>
        </button>
      ))}

      {current !== null && (
        <button onClick={() => onPick(null)}>
          <span className="tick" />
          <span className="muted">Take off the shelf</span>
        </button>
      )}

      {subjects.length > 0 && <hr />}

      {naming ? (
        <input
          autoFocus
          value={name}
          placeholder="New subject"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
        />
      ) : (
        <button onClick={() => setNaming(true)}>
          <span className="tick">＋</span>
          <span>New subject…</span>
        </button>
      )}
    </div>
  )
}
