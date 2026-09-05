import { memo, type RefObject } from 'react'
import type { BookImage } from '../../../shared/types'
import type { Unit } from '../lib/units'

interface Props {
  unit: Unit
  image: BookImage
  /** Its size on the page, decided by the layout so the page can be trusted to hold it. */
  size: { width: number; height: number }
  isActive: boolean
  isRead: boolean
  anchor?: boolean
  onSelect: (index: number) => void
  /** A diagram at column width is often unreadable; clicking opens it properly. */
  onOpen: (image: BookImage) => void
  activeRef: RefObject<HTMLSpanElement>
}

/**
 * An illustration, taking its turn in the spotlight like any sentence: it dims
 * with the rest of the page, lights up when you reach it, and one more press of
 * the space bar moves past it. A picture the author put between two paragraphs
 * is part of the argument, not decoration to be skipped over.
 *
 * A real caption is already in the text: the book's own <figcaption> comes
 * through as its own block, so the alt text stays where it belongs — read out
 * rather than printed, and never duplicating the caption underneath.
 */
export const ReaderFigure = memo(function ReaderFigure({
  unit,
  image,
  size,
  isActive,
  isRead,
  anchor = true,
  onSelect,
  onOpen,
  activeRef
}: Props): JSX.Element {
  return (
    <figure className="blk blk-image">
      <span
        ref={isActive && anchor ? activeRef : undefined}
        className={`unit unit-figure${isActive ? ' unit-active' : ''}${isRead ? ' unit-read' : ''}`}
        onClick={() => onSelect(unit.index)}
      >
        <img
          src={image.src}
          alt={image.alt}
          // The box is fixed before the file arrives, so a figure loading late
          // never shoves the line you're reading down the page.
          style={{ width: `${size.width}px`, height: `${size.height}px` }}
          width={size.width}
          height={size.height}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(unit.index)
            onOpen(image)
          }}
        />
      </span>
    </figure>
  )
})
