import type { BlockType, BookImage } from '../../../shared/types'
import type { RenderBlock, Unit } from './units'

/**
 * A section is typeset onto sheets of a fixed size, the way a book is, and the
 * window then shows the sheets at whatever scale fits — the model a PDF viewer
 * uses. The sheet is a little taller than Letter and a little shorter than A4:
 * a page, not a screen.
 */
export const SHEET_RATIO = 4 / 3
export const SHEET_MARGIN_X = 64
export const SHEET_MARGIN_TOP = 64
export const SHEET_MARGIN_BOTTOM = 64

/** A figure may take this much of the text block before it is scaled down. */
export const FIGURE_MAX_HEIGHT = 0.62
/** Breathing room drawn around a figure — part of its box, so part of the sums. */
export const FIGURE_PADDING = 6

export interface PageGeometry {
  sheetWidth: number
  sheetHeight: number
  /** The text block: the sheet inside its margins. */
  bodyWidth: number
  bodyHeight: number
  marginX: number
  marginTop: number
  marginBottom: number
}

export function pageGeometry(columnWidth: number): PageGeometry {
  const sheetWidth = columnWidth + 2 * SHEET_MARGIN_X
  const sheetHeight = Math.round(sheetWidth * SHEET_RATIO)
  return {
    sheetWidth,
    sheetHeight,
    bodyWidth: columnWidth,
    bodyHeight: sheetHeight - SHEET_MARGIN_TOP - SHEET_MARGIN_BOTTOM,
    marginX: SHEET_MARGIN_X,
    marginTop: SHEET_MARGIN_TOP,
    marginBottom: SHEET_MARGIN_BOTTOM
  }
}

/**
 * The size a picture is drawn at on the page. Worked out here rather than left
 * to the browser, because the measuring pass and the real page must agree to
 * the pixel, and a browser sizing an image it has not loaded yet is a guess.
 */
export function figureSize(
  image: BookImage,
  geometry: PageGeometry
): { width: number; height: number } {
  const availWidth = geometry.bodyWidth - 2 * FIGURE_PADDING
  const availHeight = geometry.bodyHeight * FIGURE_MAX_HEIGHT - 2 * FIGURE_PADDING
  const known = image.width > 0 && image.height > 0
  const w = known ? image.width : availWidth
  const h = known ? image.height : Math.round(availWidth * 0.66)
  const scale = Math.min(1, availWidth / w, availHeight / h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** A run of one unit's text as it appears on one page. */
export interface PageFragment {
  unit: Unit
  /** The words of the unit that fall on this page; the whole unit, usually. */
  text: string
  /** The first page this unit appears on carries the spotlight anchor. */
  anchor: boolean
}

export interface PageBlock {
  id: string
  type: BlockType
  image?: BookImage
  fragments: PageFragment[]
}

export interface Page {
  index: number
  /** The section title printed above the text, on the first page only. */
  lead: boolean
  blocks: PageBlock[]
  /**
   * The first unit that *starts* on this page — where turning to it lands. A
   * sentence carried over from the foot of the previous page belongs to that
   * page, and landing on it would not turn the page at all.
   */
  firstUnit: number
  /** The lowest and highest unit with any words on this page. */
  lowestUnit: number
  lastUnit: number
}

export interface PageLayout {
  /** What this layout was measured for; stale when it no longer matches. */
  key: string
  pages: Page[]
  /** The first page each unit appears on. */
  pageOfUnit: number[]
  /** The last page each unit appears on — the same, unless it was cut. */
  lastPageOfUnit: number[]
}

type Part = { kind: 'lead' } | { kind: 'unit'; index: number; frag: number }

interface Line {
  top: number
  bottom: number
  parts: Part[]
}

const HEADINGS = new Set<BlockType>(['h1', 'h2', 'h3'])
const WHITESPACE = /\s/

/**
 * Read the section back off a hidden rendering of it and decide where the
 * pages break.
 *
 * The rendering is walked line by line: every inline fragment of every unit
 * (one per line it touches), grown to the full line box so the sums match what
 * the page will actually hold. Lines are then dealt onto pages greedily. A
 * heading is never left as the last line of a page, and a sentence that
 * straddles a break is cut at the line — the exact character found by
 * measuring — so both halves re-render with the same line breaks they had here.
 */
export function measurePages(
  container: HTMLElement,
  blocks: RenderBlock[],
  units: Unit[],
  bodyHeight: number,
  key: string
): PageLayout {
  const blockTypeOfUnit: BlockType[] = []
  for (const block of blocks) for (const unit of block.units) blockTypeOfUnit[unit.index] = block.type

  const spans: HTMLElement[] = []
  container.querySelectorAll<HTMLElement>('[data-unit]').forEach((el) => {
    spans[Number(el.dataset.unit)] = el
  })

  // ---- lines -----------------------------------------------------------------

  const lines: Line[] = []
  const fragTops: number[][] = []

  const push = (top: number, bottom: number, part: Part): void => {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.top - top) < 1.5) {
      last.parts.push(part)
      last.bottom = Math.max(last.bottom, bottom)
    } else {
      lines.push({ top, bottom, parts: [part] })
    }
  }

  const lead = container.querySelector<HTMLElement>('[data-lead]')
  if (lead) {
    const r = lead.getBoundingClientRect()
    push(r.top, r.bottom, { kind: 'lead' })
  }

  for (const unit of units) {
    const span = spans[unit.index]
    fragTops[unit.index] = []
    if (!span) continue

    const isBlock = getComputedStyle(span).display === 'block'
    const rects = Array.from(span.getClientRects()).filter((r) => r.height > 0)

    if (rects.length === 0) {
      // Nothing was drawn — an empty heading, say. It still has to live on
      // some page or the spotlight would land nowhere.
      const last = lines[lines.length - 1]
      const at = last ? last.bottom : 0
      push(last ? last.top : 0, at, { kind: 'unit', index: unit.index, frag: 0 })
      fragTops[unit.index].push(at)
      continue
    }

    // An inline fragment is the glyph box; the line it sits on is taller by
    // the leading on either side. Page capacity is a matter of line boxes.
    let halfLeading = 0
    if (!isBlock) {
      const lineHeight = parseFloat(getComputedStyle(span.parentElement ?? span).lineHeight)
      if (Number.isFinite(lineHeight)) halfLeading = Math.max(0, (lineHeight - rects[0].height) / 2)
    }

    rects.forEach((r, frag) => {
      fragTops[unit.index].push(r.top)
      push(r.top - halfLeading, r.bottom + halfLeading, { kind: 'unit', index: unit.index, frag })
    })
  }

  // ---- pages ------------------------------------------------------------------

  const isHeadingLine = (line: Line): boolean =>
    line.parts.every((p) => p.kind === 'unit' && HEADINGS.has(blockTypeOfUnit[p.index]))

  const pagesOfLines: Line[][] = []
  let current: Line[] = []
  let startTop = 0

  for (const line of lines) {
    if (current.length === 0) {
      current = [line]
      startTop = line.top
      continue
    }
    if (line.bottom - startTop <= bodyHeight + 0.5) {
      current.push(line)
      continue
    }
    // Keep a heading with what it heads.
    const carried: Line[] = []
    while (current.length > 1 && isHeadingLine(current[current.length - 1])) {
      carried.unshift(current.pop() as Line)
    }
    pagesOfLines.push(current)
    current = [...carried, line]
    startTop = current[0].top
  }
  if (current.length > 0 || pagesOfLines.length === 0) pagesOfLines.push(current)

  // ---- text offsets where a unit is cut --------------------------------------

  const range = document.createRange()
  const offsetCache = new Map<string, number>()

  /** The index in the unit's text of the first character on its `frag`-th line. */
  const offsetAtFrag = (unit: Unit, frag: number): number => {
    if (frag === 0) return 0
    const cacheKey = `${unit.index}:${frag}`
    const cached = offsetCache.get(cacheKey)
    if (cached !== undefined) return cached

    const span = spans[unit.index]
    const target = fragTops[unit.index][frag]
    const text = unit.text
    let result = text.length

    if (span && target !== undefined) {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)

      const charTop = (i: number): number => {
        let rest = i
        for (const node of nodes) {
          const len = node.data.length
          if (rest < len) {
            range.setStart(node, rest)
            range.setEnd(node, rest + 1)
            return range.getBoundingClientRect().top
          }
          rest -= len
        }
        return Infinity
      }

      let lo = 0
      let hi = text.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (charTop(mid) >= target - 1) hi = mid
        else lo = mid + 1
      }
      let i = lo
      while (i < text.length && WHITESPACE.test(text[i])) i++
      while (i > 0 && !WHITESPACE.test(text[i - 1])) i--
      result = i
    }

    offsetCache.set(cacheKey, result)
    return result
  }

  // ---- assemble ----------------------------------------------------------------

  const pageOfUnit: number[] = []
  const lastPageOfUnit: number[] = []
  const pages: Page[] = pagesOfLines.map((pageLines, pageIndex) => {
    let lead = false
    const frags = new Map<number, { first: number; last: number }>()
    for (const line of pageLines) {
      for (const part of line.parts) {
        if (part.kind === 'lead') {
          lead = true
          continue
        }
        const entry = frags.get(part.index)
        if (entry) {
          entry.first = Math.min(entry.first, part.frag)
          entry.last = Math.max(entry.last, part.frag)
        } else {
          frags.set(part.index, { first: part.frag, last: part.frag })
        }
      }
    }

    const pageBlocks: PageBlock[] = []
    let firstAnchored = Infinity
    let lowestUnit = Infinity
    let lastUnit = -1

    for (const block of blocks) {
      const fragments: PageFragment[] = []
      for (const unit of block.units) {
        const entry = frags.get(unit.index)
        if (!entry) continue

        const total = fragTops[unit.index].length
        const start = offsetAtFrag(unit, entry.first)
        const end = entry.last >= total - 1 ? unit.text.length : offsetAtFrag(unit, entry.last + 1)
        const text = unit.text.slice(start, end).trim()
        const anchor = pageOfUnit[unit.index] === undefined

        // A cut that left nothing on this side happens when a unit's last
        // line is only its trailing space; the words are all on the other page.
        // The first appearance is kept even when empty, so the spotlight always
        // has something to land on.
        if (text === '' && !anchor && block.type !== 'image') continue
        if (anchor) {
          pageOfUnit[unit.index] = pageIndex
          firstAnchored = Math.min(firstAnchored, unit.index)
        }
        lastPageOfUnit[unit.index] = pageIndex

        fragments.push({ unit, text, anchor })
        lowestUnit = Math.min(lowestUnit, unit.index)
        lastUnit = Math.max(lastUnit, unit.index)
      }
      if (fragments.length > 0) {
        pageBlocks.push({ id: block.id, type: block.type, image: block.image, fragments })
      }
    }

    const lowest = lowestUnit === Infinity ? 0 : lowestUnit
    return {
      index: pageIndex,
      lead,
      blocks: pageBlocks,
      // A page holding only the tail of one long paragraph has nothing that
      // starts on it; the tail is then the best there is.
      firstUnit: firstAnchored === Infinity ? lowest : firstAnchored,
      lowestUnit: lowest,
      lastUnit: lastUnit === -1 ? 0 : lastUnit
    }
  })

  // A unit the measurement somehow missed is put with its neighbour, never lost.
  for (const unit of units) {
    if (pageOfUnit[unit.index] === undefined) {
      pageOfUnit[unit.index] = unit.index > 0 ? (pageOfUnit[unit.index - 1] ?? 0) : 0
    }
    if (lastPageOfUnit[unit.index] === undefined) lastPageOfUnit[unit.index] = pageOfUnit[unit.index]
  }

  return { key, pages, pageOfUnit, lastPageOfUnit }
}
