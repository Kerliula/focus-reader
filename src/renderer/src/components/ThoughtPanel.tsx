import type { Thought } from '../../../shared/types'

interface Props {
  thoughts: Thought[]
  bookId: string | null
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function ThoughtPanel({ thoughts, bookId, onToggle, onDelete, onClose }: Props): JSX.Element {
  const relevant = bookId ? thoughts.filter((t) => t.bookId === bookId || t.bookId === null) : thoughts
  const open = relevant.filter((t) => !t.done)
  const done = relevant.filter((t) => t.done)

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Parked thoughts</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {relevant.length === 0 && (
            <p className="muted">
              Nothing parked yet. Hit <kbd>⌘K</kbd> while reading to dump a thought without losing
              your place.
            </p>
          )}

          <ul className="thoughts">
            {open.map((thought) => (
              <li key={thought.id}>
                <input type="checkbox" checked={false} onChange={() => onToggle(thought.id)} />
                <span>{thought.text}</span>
                <button className="ghost tiny" onClick={() => onDelete(thought.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {done.length > 0 && (
            <>
              <h3 className="muted">Done</h3>
              <ul className="thoughts done">
                {done.map((thought) => (
                  <li key={thought.id}>
                    <input type="checkbox" checked readOnly onClick={() => onToggle(thought.id)} />
                    <span>{thought.text}</span>
                    <button className="ghost tiny" onClick={() => onDelete(thought.id)}>
                      ✕
                    </button>
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
