import { memo, type RefObject } from 'react'
import type { Unit } from '../lib/units'
import { BionicText } from './BionicText'

interface Props {
  unit: Unit
  /**
   * The words of the unit that fall on this page. A sentence cut by a page
   * break is drawn twice, once per page; each half gets its own text and the
   * same unit, so both light up together.
   */
  text?: string
  /** Only one of a unit's halves carries the ref the reader scrolls to. */
  anchor?: boolean
  isActive: boolean
  isRead: boolean
  bionic: boolean
  bionicStrength: number
  onSelect: (index: number) => void
  /** Double-clicking a word asks for an explanation of it, in this sentence. */
  onExplain: (word: string, sentence: string, at: DOMRect) => void
  /** Attached to whichever unit is active, so the reader can scroll it into view. */
  activeRef: RefObject<HTMLSpanElement>
}

/** Longer than this and it isn't a word or an idiom, it's a sentence. */
const MAX_LOOKUP_WORDS = 4

/**
 * One spotlight unit. Memoized because moving the spotlight re-renders the
 * page: without this, every word on it is re-tokenized and re-bolded on every
 * keypress instead of just the two units that changed.
 */
export const ReaderUnit = memo(function ReaderUnit({
  unit,
  text = unit.text,
  anchor = true,
  isActive,
  isRead,
  bionic,
  bionicStrength,
  onSelect,
  onExplain,
  activeRef
}: Props): JSX.Element {
  return (
    <span
      ref={isActive && anchor ? activeRef : undefined}
      className={`unit${isActive ? ' unit-active' : ''}${isRead ? ' unit-read' : ''}`}
      onClick={() => onSelect(unit.index)}
      onDoubleClick={() => {
        // The browser has already selected the word under the cursor, which
        // saves wrapping every word in its own element just to find it.
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const picked = selection.toString().trim()
        if (picked === '' || picked.split(/\s+/).length > MAX_LOOKUP_WORDS) return

        onExplain(picked, unit.text, selection.getRangeAt(0).getBoundingClientRect())
      }}
    >
      <BionicText text={text} enabled={bionic} strength={bionicStrength} />{' '}
    </span>
  )
})
