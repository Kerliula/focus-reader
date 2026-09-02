import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Block, BookDoc, Chapter } from '../../../shared/types'
import { PARSE_VERSION } from '../../../shared/types'
import type { ImageSink } from '../lib/images'
import { createFigureCutter, type PlacedImage } from './pdfImages'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface RawItem {
  str: string
  transform: number[]
  width: number
  height: number
}

interface Line {
  text: string
  y: number
  left: number
  right: number
  size: number
}

const PAGES_PER_CHUNK = 12

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Group text items sharing a baseline into lines, left-to-right. */
function toLines(items: RawItem[]): Line[] {
  const rows = new Map<number, RawItem[]>()
  for (const item of items) {
    if (item.str.trim() === '') continue
    const y = Math.round(item.transform[5] / 2.5) * 2.5
    const row = rows.get(y)
    if (row) row.push(item)
    else rows.set(y, [item])
  }

  const lines: Line[] = []
  for (const [y, row] of rows) {
    row.sort((a, b) => a.transform[4] - b.transform[4])
    let text = ''
    let prevRight = Number.NaN
    for (const item of row) {
      const left = item.transform[4]
      if (!Number.isNaN(prevRight) && left - prevRight > 1 && !/\s$/.test(text)) text += ' '
      text += item.str
      prevRight = left + item.width
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (text === '') continue

    lines.push({
      text,
      y,
      left: row[0].transform[4],
      right: prevRight,
      size: median(row.map((i) => Math.abs(i.transform[3]) || i.height))
    })
  }

  return lines.sort((a, b) => b.y - a.y)
}

/** Page numbers and running heads add noise and break the reading flow. */
function isFurniture(line: Line): boolean {
  return /^[\divxlcdm]{1,6}$/i.test(line.text.replace(/[.\s|—-]/g, ''))
}

/** A block, with the height on the page it starts at — where a figure slots in. */
interface AnchoredBlock {
  block: Block
  y: number
}

function linesToBlocks(lines: Line[], idPrefix: string, startIndex: number): AnchoredBlock[] {
  const kept = lines.filter((l) => !isFurniture(l))
  if (kept.length === 0) return []

  const pageRight = Math.max(...kept.map((l) => l.right))
  const pageLeft = Math.min(...kept.map((l) => l.left))
  const bodySize = median(kept.map((l) => l.size))
  const gaps: number[] = []
  for (let i = 1; i < kept.length; i++) gaps.push(kept[i - 1].y - kept[i].y)
  const bodyGap = median(gaps) || bodySize * 1.2

  const blocks: AnchoredBlock[] = []
  let counter = startIndex
  let current: { text: string; heading: boolean; y: number } | null = null

  const flush = (): void => {
    if (current && current.text.trim() !== '') {
      blocks.push({
        block: {
          id: `${idPrefix}-b${counter++}`,
          type: current.heading ? 'h3' : 'p',
          text: current.text.trim()
        },
        y: current.y
      })
    }
    current = null
  }

  for (let i = 0; i < kept.length; i++) {
    const line = kept[i]
    const prev = i > 0 ? kept[i - 1] : null
    const isHeading = line.size > bodySize * 1.18

    let breakHere = prev === null || isHeading
    if (prev && !breakHere) {
      const gap = prev.y - line.y
      const prevWasHeading = prev.size > bodySize * 1.18
      const prevEndedShort = prev.right < pageRight - (pageRight - pageLeft) * 0.12
      const prevEndedSentence = /[.!?"'”’]$/.test(prev.text)
      const indented = line.left > pageLeft + bodySize * 0.6

      if (gap > bodyGap * 1.45) breakHere = true
      else if (prevWasHeading) breakHere = true
      else if (indented && prevEndedSentence) breakHere = true
      else if (prevEndedShort && prevEndedSentence) breakHere = true
    }

    if (breakHere) {
      flush()
      current = { text: line.text, heading: isHeading, y: line.y }
      continue
    }

    if (current) {
      if (/[-‐]$/.test(current.text) && /^[a-z]/.test(line.text)) {
        // Rejoin a word split across lines.
        current.text = current.text.slice(0, -1) + line.text
      } else {
        current.text += ` ${line.text}`
      }
    }
  }
  flush()

  return blocks
}

/**
 * Weave a page's figures back in among its paragraphs. Both are known by the
 * height they sit at, so this is the same merge a compositor would do: work
 * down the page, and whatever comes next is whatever is highest up.
 */
function interleave(blocks: AnchoredBlock[], images: PlacedImage[], idPrefix: string): Block[] {
  if (images.length === 0) return blocks.map((b) => b.block)

  const out: Block[] = []
  let next = 0

  const take = (until: number): void => {
    while (next < images.length && images[next].y >= until) {
      out.push({
        id: `${idPrefix}-i${next}-${out.length}`,
        type: 'image',
        text: '',
        image: { ...images[next].image, alt: '' }
      })
      next++
    }
  }

  for (const anchored of blocks) {
    take(anchored.y)
    out.push(anchored.block)
  }
  take(Number.NEGATIVE_INFINITY)

  return out
}

export async function parsePdf(data: Uint8Array, id: string, sink?: ImageSink): Promise<BookDoc> {
  // pdf.js detaches the buffer it is handed, so give it a copy.
  const pdf = await pdfjs.getDocument({ data: data.slice() }).promise

  const meta = await pdf.getMetadata().catch(() => null)
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string }

  // Page index -> chapter title, taken from the PDF outline when there is one.
  const starts = new Map<number, string>()
  try {
    const outline = await pdf.getOutline()
    for (const item of outline ?? []) {
      const dest =
        typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      if (!dest || !dest[0]) continue
      const pageIndex = await pdf.getPageIndex(dest[0])
      if (!starts.has(pageIndex)) starts.set(pageIndex, item.title.trim())
    }
  } catch {
    // No usable outline — fall back to fixed page chunks below.
  }

  // Holds the canvases the figures are cut from, for as long as the parse runs.
  const cutter = sink ? createFigureCutter() : null

  const chapters: Chapter[] = []
  let current: Chapter | null = null
  let blockCount = 0

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pageIndex = pageNum - 1
    const outlineTitle = starts.get(pageIndex)
    const chunkBoundary = starts.size === 0 && pageIndex % PAGES_PER_CHUNK === 0

    if (outlineTitle || chunkBoundary || current === null) {
      if (current && current.blocks.length > 0) chapters.push(current)
      const lastPage = Math.min(pageNum + PAGES_PER_CHUNK - 1, pdf.numPages)
      current = {
        id: `c${chapters.length}`,
        title: outlineTitle || `Pages ${pageNum}–${lastPage}`,
        blocks: []
      }
      blockCount = 0
    }

    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items.filter((i) => 'str' in i) as unknown as RawItem[]
    const anchored = linesToBlocks(toLines(items), current.id, blockCount)
    blockCount += anchored.length

    let figures: PlacedImage[] = []
    if (cutter && sink) {
      try {
        figures = await cutter.imagesOnPage(page, sink)
      } catch {
        // A page whose figures won't come out is still a page worth reading.
      }
    }

    current.blocks.push(...interleave(anchored, figures, `${current.id}-p${pageNum}`))
    page.cleanup()
  }

  if (current && current.blocks.length > 0) chapters.push(current)
  cutter?.dispose()
  await pdf.destroy()

  if (chapters.length === 0) {
    throw new Error('No selectable text in this PDF — it is probably a scan and needs OCR.')
  }

  return {
    id,
    title: info.Title?.trim() || 'Untitled PDF',
    author: info.Author?.trim() || 'Unknown author',
    chapters,
    version: PARSE_VERSION
  }
}
