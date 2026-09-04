import type { PDFPageProxy } from 'pdfjs-dist'
import type { StoredImage } from '../lib/images'

/**
 * A PDF has no idea what a figure is. It holds drawing instructions, and the
 * thing a reader calls "figure 1.2" is whatever those instructions happen to
 * put in one part of the page.
 *
 * The first version of this looked for images the page painted and cut those
 * out. That finds photographs and nothing else, which in a textbook is close
 * to nothing: a diagram of five labelled panels, arrows and boxes is drawn as
 * vector art, and the one photograph inside it is a small tile in a corner.
 * Cropping to the tile produced a bicycle where the figure should have been.
 *
 * So a figure is located the other way round — by where the *text* isn't. Prose
 * runs down a page at a steady leading; where it stops for a couple of inches
 * and picks up again, something else is on the paper. That band is rendered as
 * the page would print, and the crop is trimmed to the ink actually inside it.
 * It makes no difference whether the figure is a photograph, a vector drawing,
 * or both, and the labels and axes around it come along because they were
 * never separate things to begin with.
 */

export interface PlacedImage {
  /** Top edge in PDF user space, for slotting the figure back into the text. */
  y: number
  image: StoredImage
}

/** What the caller already knows about a page's text: one entry per line. */
export interface TextLine {
  /** Baseline, in PDF user space — y measured upwards from the bottom. */
  y: number
  /** Font size on that line, for guessing how far its glyphs reach. */
  size: number
}

/**
 * A break in the text this tall is a figure, a table or a displayed diagram.
 * Set below about ninety points it starts catching the space around section
 * headings and displayed equations, which are text and belong in the text.
 */
const INNER_GAP_PT = 100

/**
 * Above the first line and below the last there is always a page margin, so
 * the bar is higher: enough to tell a plate that fills the page from the white
 * space every page has at its edges.
 */
const EDGE_GAP_PT = 150

/** Under this in either direction, the ink in a band is a rule or a stray mark. */
const MIN_FIGURE_PT = 72

/** Render wide enough that a figure still holds up when it is opened full size. */
const TARGET_PAGE_WIDTH = 2400
const MAX_SCALE = 4

/** Trimming works off a thumbnail; a few points either way is close enough. */
const TRIM_WIDTH = 400

/** How far a pixel must be from paper white to count as ink. */
const INK_THRESHOLD = 12

/**
 * How much of its own bounding box a figure has to actually cover.
 *
 * Books printed from a press carry crop marks: four hairlines in the corners
 * of every sheet, including the blank ones. They are ink, they sit at the
 * extremes of the page, and so a blank page trims to a box the size of the
 * page with almost nothing in it. Measured over this book, those pages came in
 * at 0.1%, 0.5% and 0.9% coverage, while the emptiest real figure — a line
 * plot with two axes — was 5.5%, and most are above 8%. Anything under a
 * fiftieth of its box is a mark on paper, not a picture.
 */
const MIN_INK_DENSITY = 0.02

/** A little air, so a glyph at the very edge of the figure isn't shaved. */
const TRIM_PAD_PT = 4

/**
 * Encoding is asynchronous and, when the browser is short of memory for
 * canvases, can simply never call back. One figure is never worth hanging a
 * whole book on, so it gets a deadline.
 */
const ENCODE_TIMEOUT_MS = 20_000

type Matrix = [number, number, number, number, number, number]

/** A horizontal slice of the page, in user space. */
interface Band {
  bottom: number
  top: number
}

/**
 * The gaps in a page's text. Lines arrive in reading order, top of the page
 * first, and each entry is a baseline — so the space between two of them is
 * the space between where one line's letters stop hanging down and the next
 * line's start reaching up.
 */
function bandsBetweenText(lines: TextLine[], pageHeight: number): Band[] {
  if (lines.length === 0) return [{ bottom: 0, top: pageHeight }]

  const sorted = [...lines].sort((a, b) => b.y - a.y)
  const bands: Band[] = []

  for (let i = 1; i < sorted.length; i++) {
    const above = sorted[i - 1]
    const below = sorted[i]
    if (above.y - below.y <= INNER_GAP_PT) continue
    bands.push({ bottom: below.y + below.size * 0.9, top: above.y - above.size * 0.35 })
  }

  const first = sorted[0]
  if (pageHeight - first.y > EDGE_GAP_PT) {
    bands.push({ bottom: first.y + first.size * 0.9, top: pageHeight })
  }
  const last = sorted[sorted.length - 1]
  if (last.y > EDGE_GAP_PT) bands.push({ bottom: 0, top: last.y - last.size * 0.35 })

  // Edge bands are discovered after inner gaps, but the caller merges these
  // with text blocks in top-to-bottom order. Keep that ordering explicit so a
  // plate above the first paragraph cannot be inserted after figures below it.
  return bands
    .filter((b) => b.top - b.bottom >= MIN_FIGURE_PT)
    .sort((a, b) => b.top - a.top)
}

async function toBytes(canvas: HTMLCanvasElement): Promise<{ data: Uint8Array; mediaType: string }> {
  // PDF figures are often vector drawings containing small labels and thin
  // lines. Choosing JPEG from pixel area alone turns those into fuzzy blocks;
  // PNG keeps the rendered PDF lossless and compresses flat line art well.
  const mediaType = 'image/png'

  const blob = await new Promise<Blob | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ENCODE_TIMEOUT_MS)
    canvas.toBlob(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      mediaType,
      undefined
    )
  })
  if (blob === null) throw new Error('Could not read the rendered figure back.')
  return { data: new Uint8Array(await blob.arrayBuffer()), mediaType }
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the ink is. A band is as wide as the page, and a figure rarely is, so
 * without this every crop would carry the page's margins on both sides.
 * Measured on a thumbnail: finding an edge to within a couple of points does
 * not need thirteen megabytes of pixels.
 */
function inkBox(source: HTMLCanvasElement, scratch: HTMLCanvasElement): Box | null {
  const scale = Math.min(1, TRIM_WIDTH / source.width)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  let inked = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const ink =
        255 - data[i] > INK_THRESHOLD ||
        255 - data[i + 1] > INK_THRESHOLD ||
        255 - data[i + 2] > INK_THRESHOLD
      if (!ink) continue
      inked++
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }

  if (right < 0) return null
  if (inked / ((right - left + 1) * (bottom - top + 1)) < MIN_INK_DENSITY) return null

  // Back to the full-resolution canvas, generously: the thumbnail rounded down.
  const back = 1 / scale
  const boxLeft = Math.max(0, Math.floor(left * back) - 1)
  const boxTop = Math.max(0, Math.floor(top * back) - 1)
  return {
    left: boxLeft,
    top: boxTop,
    width: Math.min(source.width, Math.ceil((right + 1) * back) + 1) - boxLeft,
    height: Math.min(source.height, Math.ceil((bottom + 1) * back) + 1) - boxTop
  }
}

/**
 * Cuts figures out of pages, holding on to its canvases between calls.
 *
 * This matters more than it looks: a page rendered at reading resolution is
 * around thirteen megabytes of pixels, and a textbook has hundreds of pages.
 * Allocating one canvas per page leaves the browser to reclaim them faster
 * than it actually does, and once it falls behind, encoding stops calling back
 * and the import stops dead. One canvas, resized, costs the same at page one
 * as at page five hundred.
 */
export interface FigureCutter {
  figuresOnPage(
    page: PDFPageProxy,
    lines: TextLine[],
    store: (data: Uint8Array, mediaType: string) => Promise<StoredImage | null>
  ): Promise<PlacedImage[]>
  /** Hand the pixels back; a canvas left at full size stays allocated. */
  dispose(): void
}

export function createFigureCutter(): FigureCutter {
  const bandCanvas = document.createElement('canvas')
  const crop = document.createElement('canvas')
  const thumb = document.createElement('canvas')

  const release = (canvas: HTMLCanvasElement): void => {
    canvas.width = 0
    canvas.height = 0
  }

  return {
    dispose() {
      release(bandCanvas)
      release(crop)
      release(thumb)
    },

    async figuresOnPage(page, lines, store) {
      const base = page.getViewport({ scale: 1 })
      const bands = bandsBetweenText(lines, base.height)
      if (bands.length === 0) return []

      const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_PAGE_WIDTH / base.width))
      const viewport = page.getViewport({ scale })
      const [, , , , , vf] = viewport.transform as Matrix

      const placed: PlacedImage[] = []

      for (const band of bands) {
        // Only this slice of the page is rasterised. Most figures are a
        // fraction of a page, and drawing the other four fifths of it to throw
        // them away is the single most expensive thing this could do.
        const deviceTop = Math.max(0, Math.floor(vf - band.top * scale))
        const deviceBottom = Math.min(
          Math.ceil(viewport.height),
          Math.ceil(vf - band.bottom * scale)
        )
        const width = Math.ceil(viewport.width)
        const height = deviceBottom - deviceTop
        if (width < 1 || height < 1) continue

        bandCanvas.width = width
        bandCanvas.height = height
        const ctx = bandCanvas.getContext('2d')
        if (ctx === null) continue

        // A PDF page is a sheet of paper; without this the parts of a figure
        // that are simply unpainted come out transparent, and then black.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)

        try {
          await page.render({
            canvasContext: ctx,
            viewport,
            // Slide the page up so the band lands at the canvas origin.
            transform: [1, 0, 0, 1, 0, -deviceTop],
            ...RENDER_INTENT
          }).promise
        } catch {
          continue
        }

        const box = inkBox(bandCanvas, thumb)
        if (box === null) continue

        const pad = Math.round(TRIM_PAD_PT * scale)
        const left = Math.max(0, box.left - pad)
        const top = Math.max(0, box.top - pad)
        const cropWidth = Math.min(width - left, box.width + pad * 2)
        const cropHeight = Math.min(height - top, box.height + pad * 2)
        const minSide = MIN_FIGURE_PT * scale
        if (cropWidth < minSide || cropHeight < minSide) continue

        crop.width = cropWidth
        crop.height = cropHeight
        const cropCtx = crop.getContext('2d')
        if (cropCtx === null) continue
        cropCtx.drawImage(bandCanvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)

        try {
          const { data, mediaType } = await toBytes(crop)
          const image = await store(data, mediaType)
          // Where the ink actually starts, so the figure lands between the
          // right two paragraphs rather than at the top of the empty band.
          if (image !== null) placed.push({ y: band.top - top / scale, image })
        } catch {
          // One figure that won't come out is not a reason to lose the page.
        }
      }

      return placed
    }
  }
}

/**
 * The render asks for the *print* rendition of the page, and not because
 * anything is being printed.
 *
 * pdf.js draws a page in chunks, and for its on-screen rendition it schedules
 * each next chunk with `requestAnimationFrame` — which a browser stops firing
 * the moment its window is hidden or covered by another. Reading a long
 * illustrated PDF takes minutes, and nobody watches a progress bar for
 * minutes; the first time the window went behind something, the import stopped
 * where it stood and never came back. The print rendition is scheduled on
 * microtasks instead, so it runs at full speed whether or not anyone is
 * looking.
 */
const RENDER_INTENT = { intent: 'print' } as const
