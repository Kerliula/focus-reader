import { memo } from 'react'

interface Props {
  pageCount: number
  current: number
  onPick: (page: number) => void
}

/** Past this many pages, one mark each would be thinner than a hairline. */
const MAX_SEGMENTS = 60

/**
 * The pages of this section, standing beside the document like a PDF viewer's
 * thumbnail strip with the thumbnails taken away: one mark per page, filled as
 * it is turned. It is the finish line you can see from where you are — a
 * section is twelve marks, and seven of them are already lit.
 */
export const PageRail = memo(function PageRail({ pageCount, current, onPick }: Props): JSX.Element {
  if (pageCount <= MAX_SEGMENTS) {
    return (
      <nav className="rail" aria-label="Pages" style={{ height: `min(58vh, ${pageCount * 17}px)` }}>
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            className={`rail-seg${i < current ? ' read' : i === current ? ' on' : ''}`}
            title={`Page ${i + 1}`}
            onClick={() => onPick(i)}
          />
        ))}
      </nav>
    )
  }

  const fraction = pageCount <= 1 ? 1 : current / (pageCount - 1)
  return (
    <nav className="rail" aria-label="Pages" style={{ height: '58vh' }}>
      <div
        className="rail-bar"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const at = (e.clientY - rect.top) / rect.height
          onPick(Math.max(0, Math.min(pageCount - 1, Math.round(at * (pageCount - 1)))))
        }}
      >
        <span className="rail-fill" style={{ height: `${fraction * 100}%` }} />
        <span className="rail-mark" style={{ top: `${fraction * 100}%` }} />
      </div>
    </nav>
  )
})
