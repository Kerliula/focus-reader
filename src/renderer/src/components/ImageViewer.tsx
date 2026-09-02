import { useEffect } from 'react'
import type { BookImage } from '../../../shared/types'

interface Props {
  image: BookImage
  onClose: () => void
}

/**
 * A figure at full size. A reading column is 620 pixels wide by design, which
 * is right for prose and hopeless for a map or a table of results — so the
 * picture gets the whole window when you ask for it, and gives it straight back.
 */
export function ImageViewer({ image, onClose }: Props): JSX.Element {
  // Nothing behind this should scroll while it is up.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt === '' ? 'Illustration' : image.alt}
      onClick={onClose}
    >
      <img src={image.src} alt={image.alt} draggable={false} />
      <button className="ghost image-viewer-close" onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  )
}
