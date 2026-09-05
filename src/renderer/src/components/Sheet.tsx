import { memo, type CSSProperties, type RefObject } from 'react'
import type { BookImage, Settings } from '../../../shared/types'
import { figureSize, type Page, type PageGeometry } from '../lib/pages'
import { ReaderUnit } from './ReaderUnit'
import { ReaderFigure } from './ReaderFigure'

/** Where a page stands relative to the spotlight. */
export type SheetStatus = 'read' | 'current' | 'unread'

interface Props {
  page: Page
  /** The section this page belongs to, for the running head. */
  sectionTitle: string
  bookTitle: string
  geometry: PageGeometry
  /** Drawn at this fraction of its typeset size. */
  scale: number
  settings: Settings
  status: SheetStatus
  /** The active unit, or -1 when it is not on this page. */
  activeIndex: number
  onSelect: (index: number) => void
  onExplain: (word: string, sentence: string, at: DOMRect) => void
  onOpen: (image: BookImage) => void
  activeRef: RefObject<HTMLSpanElement>
  sheetRef: (index: number, el: HTMLElement | null) => void
}

/**
 * The typographic settings the text block is laid out with. The measuring pass
 * and every sheet use exactly this, because a page break found under one set
 * of styles is wrong under any other.
 */
export function bodyStyle(settings: Settings, geometry: PageGeometry): CSSProperties {
  return {
    fontFamily: settings.fontFamily,
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    width: `${geometry.bodyWidth}px`,
    height: `${geometry.bodyHeight}px`,
    ['--body-h' as string]: `${geometry.bodyHeight}px`
  }
}

/**
 * One page of the section, drawn as a sheet of paper: running head, the text
 * block, a folio. It is laid out at its own size and scaled as a picture, so
 * zooming never moves a line break.
 *
 * Memoized, and given `-1` rather than the active index when the spotlight is
 * elsewhere, so a keypress re-renders the page you are on and no other.
 */
export const Sheet = memo(function Sheet({
  page,
  sectionTitle,
  bookTitle,
  geometry,
  scale,
  settings,
  status,
  activeIndex,
  onSelect,
  onExplain,
  onOpen,
  activeRef,
  sheetRef
}: Props): JSX.Element {
  const isRead = (index: number): boolean =>
    status === 'read' || (status === 'current' && activeIndex !== -1 && index < activeIndex)

  return (
    <section
      ref={(el) => sheetRef(page.index, el)}
      className={`sheet ${status}`}
      style={{
        width: `${geometry.sheetWidth * scale}px`,
        height: `${geometry.sheetHeight * scale}px`
      }}
      data-page={page.index}
    >
      <div
        className="sheet-inner"
        style={{
          width: `${geometry.sheetWidth}px`,
          height: `${geometry.sheetHeight}px`,
          transform: `scale(${scale})`
        }}
      >
        <header
          className="sheet-head"
          style={{ height: `${geometry.marginTop}px`, padding: `0 ${geometry.marginX}px` }}
        >
          <span className="sheet-running">{sectionTitle}</span>
          <span className="sheet-running muted">{bookTitle}</span>
        </header>

        <div className="sheet-body" style={bodyStyle(settings, geometry)}>
          {page.lead && <h1 className="page-chapter-title">{sectionTitle}</h1>}

          {page.blocks.map((block) => {
            if (block.type === 'image') {
              if (!block.image) return null
              const fragment = block.fragments[0]
              return (
                <ReaderFigure
                  key={block.id}
                  unit={fragment.unit}
                  image={block.image}
                  size={figureSize(block.image, geometry)}
                  isActive={fragment.unit.index === activeIndex}
                  isRead={isRead(fragment.unit.index)}
                  anchor={fragment.anchor}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  activeRef={activeRef}
                />
              )
            }

            const Tag = (block.type === 'p'
              ? 'p'
              : block.type === 'quote'
                ? 'blockquote'
                : block.type) as keyof JSX.IntrinsicElements
            return (
              <Tag key={block.id} className={`blk blk-${block.type}`}>
                {block.fragments.map((fragment) => (
                  <ReaderUnit
                    key={fragment.unit.key}
                    unit={fragment.unit}
                    text={fragment.text}
                    anchor={fragment.anchor}
                    isActive={fragment.unit.index === activeIndex}
                    isRead={isRead(fragment.unit.index)}
                    bionic={settings.bionic}
                    bionicStrength={settings.bionicStrength}
                    onSelect={onSelect}
                    onExplain={onExplain}
                    activeRef={activeRef}
                  />
                ))}
              </Tag>
            )
          })}
        </div>

        <footer className="sheet-folio" style={{ height: `${geometry.marginBottom}px` }}>
          {status === 'read' && (
            <span className="folio-tick" aria-label="Read">
              ✓
            </span>
          )}
          <span className="folio-number">{page.index + 1}</span>
        </footer>
      </div>
    </section>
  )
})
