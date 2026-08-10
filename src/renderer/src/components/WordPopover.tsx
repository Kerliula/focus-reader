import { useEffect, useState } from 'react'
import type { WordExplanation } from '../../../shared/types'

export interface Lookup {
  /** What was selected — usually one word, sometimes a short phrase. */
  word: string
  /** The unit it sits in. This is what makes the answer the right one. */
  sentence: string
  /** Where the selection was on screen, in viewport coordinates. */
  top: number
  bottom: number
  left: number
}

interface Props {
  lookup: Lookup
  aiReady: boolean
  /** Saves it if it isn't kept yet, forgets it if it is. */
  onToggleSave: (explanation: WordExplanation) => void
  isSaved: (lemma: string, sentence: string) => boolean
  onClose: () => void
}

const WIDTH = 340
const MARGIN = 12
/** Enough for a full answer; below this the popover flips above the word. */
const ROOM_NEEDED = 280

/** Anchor the card under the word, or above it when the page runs out of room. */
function place(lookup: Lookup): { left: number; top?: number; bottom?: number } {
  const left = Math.min(
    Math.max(MARGIN, lookup.left - WIDTH / 2),
    window.innerWidth - WIDTH - MARGIN
  )

  if (lookup.bottom + ROOM_NEEDED > window.innerHeight && lookup.top > ROOM_NEEDED) {
    return { left, bottom: window.innerHeight - lookup.top + 10 }
  }
  return { left, top: lookup.bottom + 10 }
}

export function WordPopover({
  lookup,
  aiReady,
  onToggleSave,
  isSaved,
  onClose
}: Props): JSX.Element {
  const [explanation, setExplanation] = useState<WordExplanation | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  const { word, sentence } = lookup

  useEffect(() => {
    if (!aiReady) return

    let cancelled = false
    setExplanation(null)
    setError('')

    void (async () => {
      try {
        const result = await window.api.explainWord(word, sentence)
        if (!cancelled) setExplanation(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [word, sentence, aiReady, attempt])

  const position = place(lookup)

  return (
    <div className="word-pop" style={position} onClick={(e) => e.stopPropagation()}>
      <div className="word-pop-head">
        <span className="word-pop-word">{explanation?.lemma ?? word}</span>
        <button className="ghost tiny" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>

      {!aiReady ? (
        <p className="muted">
          Add a DeepSeek key in Settings (,) and you can look up any word from here.
        </p>
      ) : error !== '' ? (
        <>
          <p className="muted">{error}</p>
          <button className="ghost tiny" onClick={() => setAttempt((a) => a + 1)}>
            try again
          </button>
        </>
      ) : explanation === null ? (
        <p className="muted word-pop-loading">Looking up “{word}”…</p>
      ) : (
        <>
          {explanation.lemma.toLowerCase() !== word.toLowerCase() && (
            <p className="word-pop-form">you clicked “{word}”</p>
          )}

          <p className="word-pop-meaning">{explanation.meaning}</p>

          {explanation.inSentence !== '' && (
            <p className="word-pop-line">
              <span className="word-pop-label">here</span>
              {explanation.inSentence}
            </p>
          )}

          {explanation.trick !== '' && (
            <p className="word-pop-line word-pop-trick">
              <span className="word-pop-label">remember</span>
              {explanation.trick}
            </p>
          )}

          {explanation.related.length > 0 && (
            <p className="word-pop-related">{explanation.related.join(' · ')}</p>
          )}

          <div className="word-pop-actions">
            {(() => {
              const saved = isSaved(explanation.lemma, sentence)
              return (
                <button
                  className={saved ? 'ghost tiny word-pop-saved' : 'ghost boxed tiny'}
                  onClick={() => onToggleSave(explanation)}
                  title={saved ? 'Remove from your words' : 'Keep this word'}
                >
                  {saved ? '✓ Saved' : 'Save word'}
                </button>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}
