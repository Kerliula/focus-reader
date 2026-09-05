import { useLayoutEffect, useRef } from 'react'
import type { Settings } from '../../../shared/types'
import type { RenderBlock, Unit } from '../lib/units'
import { figureSize, measurePages, type PageGeometry, type PageLayout } from '../lib/pages'
import { BionicText } from './BionicText'
import { bodyStyle } from './Sheet'

interface Props {
  layoutKey: string
  /** The section title to set at the head of the text, or null when the text already opens with it. */
  leadTitle: string | null
  blocks: RenderBlock[]
  units: Unit[]
  geometry: PageGeometry
  settings: Settings
  onLayout: (layout: PageLayout) => void
}

/**
 * The whole section, typeset once at the width of the text block and kept off
 * screen, so its line breaks can be read back and dealt onto pages. It renders
 * the same classes with the same styles as a real page — that is the entire
 * point of it — and is gone as soon as the pages exist.
 */
export function PageMeasurer({
  layoutKey,
  leadTitle,
  blocks,
  units,
  geometry,
  settings,
  onLayout
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    onLayout(measurePages(el, blocks, units, geometry.bodyHeight, layoutKey))
    // The key already names everything the layout depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, onLayout])

  return (
    <div ref={ref} className="sheet-body measure" aria-hidden style={bodyStyle(settings, geometry)}>
      {leadTitle !== null && (
        <h1 className="page-chapter-title" data-lead>
          {leadTitle}
        </h1>
      )}

      {blocks.map((block) => {
        if (block.type === 'image') {
          if (!block.image) return null
          const size = figureSize(block.image, geometry)
          return (
            <figure key={block.id} className="blk blk-image">
              <span className="unit unit-figure" data-unit={block.units[0].index}>
                {/* No src: the size is known, and loading the file would only be waiting. */}
                <img alt="" style={{ width: `${size.width}px`, height: `${size.height}px` }} />
              </span>
            </figure>
          )
        }

        const Tag = (block.type === 'p'
          ? 'p'
          : block.type === 'quote'
            ? 'blockquote'
            : block.type) as keyof JSX.IntrinsicElements
        return (
          <Tag key={block.id} className={`blk blk-${block.type}`}>
            {block.units.map((unit) => (
              <span key={unit.key} className="unit" data-unit={unit.index}>
                <BionicText
                  text={unit.text}
                  enabled={settings.bionic}
                  strength={settings.bionicStrength}
                />{' '}
              </span>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}
