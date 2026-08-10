import { useEffect, useState } from 'react'
import type { SectionPreview as Preview } from '../../../shared/types'

interface Props {
  chapterTitle: string
  text: string
  onDismiss: () => void
}

/**
 * Two lines of orientation before the section starts: what ground it covers and
 * what to hold on to. Deliberately not a summary — it says where the section is
 * going, never where it arrives.
 *
 * The block keeps its height from the first render, whether or not the text has
 * arrived yet. Reserving the space matters more than it sounds: text sliding
 * down the page a second after you have started reading is exactly the
 * interruption this app exists to avoid.
 */
export function SectionPreview({ chapterTitle, text, onDismiss }: Props): JSX.Element | null {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setFailed(false)

    void (async () => {
      try {
        const result = await window.api.makePreview(chapterTitle, text)
        if (!cancelled) setPreview(result)
      } catch {
        // A preview is a nicety. If it fails, the section just starts.
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [chapterTitle, text])

  if (failed) return null

  return (
    <aside className={`section-preview${preview ? '' : ' waiting'}`} aria-live="polite">
      <button className="ghost tiny section-preview-close" onClick={onDismiss} title="Hide">
        ✕
      </button>

      {preview === null ? (
        <p className="muted section-preview-waiting">Looking ahead…</p>
      ) : (
        <>
          <p className="section-preview-about">{preview.about}</p>
          {preview.watchFor !== '' && (
            <p className="section-preview-watch">
              <span className="section-preview-label">hold on to</span>
              {preview.watchFor}
            </p>
          )}
        </>
      )}
    </aside>
  )
}
