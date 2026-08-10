import type { Chapter } from '../../../shared/types'

interface Props {
  chapters: Chapter[]
  current: number
  onPick: (index: number) => void
  onClose: () => void
}

export function ChapterList({ chapters, current, onPick, onClose }: Props): JSX.Element {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Sections</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <ol className="chapters">
            {chapters.map((chapter, index) => (
              <li key={chapter.id}>
                <button
                  className={index === current ? 'chapter on' : 'chapter'}
                  onClick={() => onPick(index)}
                >
                  <span className="chapter-index">{index + 1}</span>
                  <span className="chapter-text">{chapter.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </>
  )
}
