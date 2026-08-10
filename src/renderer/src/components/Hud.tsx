import { memo, useMemo } from 'react'

interface Props {
  chapterWords: number
  wordsIntoChapter: number
  /** Word count of every section, in order. */
  sectionWords: number[]
  /** Their sum — already computed by the reader, so don't add it up again. */
  totalWords: number
  sectionPosition: number
  bookFraction: number
  wpm: number
}

/**
 * Progress, and nothing else: how far through this section, and how far
 * through the book. The book bar is one continuous track with a tick per
 * section, which stays legible whether the book has four sections or four
 * hundred.
 */
export const Hud = memo(function Hud({
  chapterWords,
  wordsIntoChapter,
  sectionWords,
  totalWords,
  sectionPosition,
  bookFraction,
  wpm
}: Props): JSX.Element {
  const sectionFraction = chapterWords === 0 ? 0 : Math.min(1, wordsIntoChapter / chapterWords)
  const minutesLeft = Math.max(1, Math.round((chapterWords - wordsIntoChapter) / Math.max(1, wpm)))

  // The tick marks only move when the book does, not when the spotlight does.
  const bounds = useMemo(() => {
    const total = totalWords || 1
    let running = 0
    return sectionWords.map((words) => {
      const start = running / total
      running += words
      return { start, end: running / total }
    })
  }, [sectionWords, totalWords])

  const currentBound = bounds[sectionPosition]

  return (
    <footer className="hud">
      <div className="meter">
        <span className="meter-label">This section</span>
        <div className="track">
          <span className="track-fill" style={{ width: `${sectionFraction * 100}%` }} />
        </div>
        <span className="meter-value">~{minutesLeft} min left</span>
      </div>

      <div className="meter">
        <span className="meter-label">
          Section {sectionPosition + 1}/{sectionWords.length}
        </span>
        <div className="track book-track">
          <span className="track-fill" style={{ width: `${bookFraction * 100}%` }} />
          {currentBound && (
            <span
              className="track-current"
              style={{
                left: `${currentBound.start * 100}%`,
                width: `${Math.max(0.6, (currentBound.end - currentBound.start) * 100)}%`
              }}
            />
          )}
          {bounds.slice(1).map((bound, i) => (
            <span key={i} className="track-tick" style={{ left: `${bound.start * 100}%` }} />
          ))}
        </div>
        <span className="meter-value">{Math.round(bookFraction * 100)}% of book</span>
      </div>
    </footer>
  )
})
