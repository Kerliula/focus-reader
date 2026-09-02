import { OPS, type PDFPageProxy } from 'pdfjs-dist'
import type { StoredImage } from '../lib/images'

/**
 * A PDF does not hold figures; it holds drawing instructions. Getting a
 * picture out of one therefore means finding *where* a page draws an image and
 * then asking pdf.js to render the page normally and cutting that rectangle
 * out of the result.
 *
 * Reading the image objects directly would skip the render, but it would also
 * mean re-implementing colour spaces, soft masks and the tiling that
 * converters use to cut one photograph into forty strips. Cropping what pdf.js
 * has already drawn gets the figure as the reader would actually see it, for
 * the cost of rendering pages that have pictures on them — and only those.
 */

export interface PlacedImage {
  /** Top edge in PDF user space, for slotting the figure back into the text. */
  y: number
  image: StoredImage
}

/** A rectangle in PDF user space, y measured upwards from the bottom. */
interface Rect {
  left: number
  right: number
  bottom: number
  top: number
}

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Apply `inner` first, then `outer` — the way a `cm` concatenates onto the CTM. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
  ]
}

/** An image is painted into the unit square; the CTM says where that lands. */
function unitSquareBounds(ctm: Matrix): Rect {
  const xs: number[] = []
  const ys: number[] = []
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ]) {
    xs.push(ctm[0] * u + ctm[2] * v + ctm[4])
    ys.push(ctm[1] * u + ctm[3] * v + ctm[5])
  }
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys)
  }
}

/**
 * The ops that paint one image into the current transform's unit square. The
 * `Repeat` and `Group` variants carry their own per-instance placements in
 * their arguments and are used for tiling and for stencil marks — neither is a
 * figure, and reading them off the CTM would put a box in the wrong place.
 */
const PAINT_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject
])

/** Walk the drawing instructions, tracking the transform, and note every image. */
function placementsOf(opList: { fnArray: number[]; argsArray: unknown[] }): Rect[] {
  let ctm = IDENTITY
  const stack: Matrix[] = []
  const rects: Rect[] = []

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i]

    if (op === OPS.save) {
      stack.push(ctm)
    } else if (op === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY
    } else if (op === OPS.transform) {
      ctm = compose(ctm, opList.argsArray[i] as Matrix)
    } else if (op === OPS.paintFormXObjectBegin) {
      // A form is its own little content stream with its own matrix on top.
      stack.push(ctm)
      const matrix = (opList.argsArray[i] as [Matrix, unknown])[0]
      if (matrix) ctm = compose(ctm, matrix)
    } else if (op === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY
    } else if (PAINT_OPS.has(op)) {
      rects.push(unitSquareBounds(ctm))
    }
  }

  return rects
}

/** Smaller than this on a side and it is a logo, a bullet or a rule. */
const MIN_SIDE_PT = 48

/**
 * A scientific figure is a picture with writing around it — panel letters,
 * axis numbers, a row of column headings — and that writing is drawn as text,
 * outside the image box. Cutting exactly to the box slices those in half. A
 * small margin takes them along; more than this and the crop starts eating the
 * caption underneath, which is already in the text where it belongs.
 */
const CROP_MARGIN_PT = 10
/** How close two pieces must be to be treated as one picture cut into strips. */
const JOIN_SLACK_PT = 2

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left - JOIN_SLACK_PT <= b.right &&
    b.left - JOIN_SLACK_PT <= a.right &&
    a.bottom - JOIN_SLACK_PT <= b.top &&
    b.bottom - JOIN_SLACK_PT <= a.top
  )
}

/**
 * Converters routinely slice one photograph into a grid of image objects, and
 * a scanned figure often arrives as a picture plus a separate mask. Pieces that
 * touch are one picture, and are cut out of the page as one.
 */
function mergeTouching(rects: Rect[]): Rect[] {
  const merged: Rect[] = []

  for (const rect of rects) {
    let current = rect
    let joined = true
    while (joined) {
      joined = false
      for (let i = merged.length - 1; i >= 0; i--) {
        if (!overlaps(current, merged[i])) continue
        current = {
          left: Math.min(current.left, merged[i].left),
          right: Math.max(current.right, merged[i].right),
          bottom: Math.min(current.bottom, merged[i].bottom),
          top: Math.max(current.top, merged[i].top)
        }
        merged.splice(i, 1)
        joined = true
      }
    }
    merged.push(current)
  }

  return merged
}

/**
 * Both the scan and the render ask for the *print* rendition of the page, and
 * not because anything is being printed.
 *
 * pdf.js draws a page in chunks, and for its on-screen rendition it schedules
 * each next chunk with `requestAnimationFrame` — which a browser stops firing
 * the moment its window is hidden or covered by another. Reading a long
 * illustrated PDF takes minutes, and nobody watches a progress bar for
 * minutes; the first time the window went behind something, the import stopped
 * where it stood and never came back. The print rendition is scheduled on
 * microtasks instead, so it runs at full speed whether or not anyone is
 * looking. Asking for the same rendition twice also means pdf.js builds the
 * page's drawing instructions once and reuses them for both calls.
 */
const RENDER_INTENT = { intent: 'print' } as const

/** Render wide enough that a figure still holds up when it is opened full size. */
const TARGET_PAGE_WIDTH = 1600
const MAX_SCALE = 3
/** A crop bigger than this is stored as a photograph rather than losslessly. */
const LOSSLESS_PIXELS = 1_000_000
/** Enough for a plate on every page of a chapter, and a stop on runaway files. */
const MAX_IMAGES_PER_PAGE = 8

/**
 * Encoding is asynchronous and, when the browser is short of memory for
 * canvases, can simply never call back. One figure is never worth hanging a
 * whole book on, so it gets a deadline.
 */
const ENCODE_TIMEOUT_MS = 20_000

async function toBytes(canvas: HTMLCanvasElement): Promise<{ data: Uint8Array; mediaType: string }> {
  const photographic = canvas.width * canvas.height > LOSSLESS_PIXELS
  const mediaType = photographic ? 'image/jpeg' : 'image/png'

  const blob = await new Promise<Blob | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ENCODE_TIMEOUT_MS)
    canvas.toBlob(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      mediaType,
      photographic ? 0.92 : undefined
    )
  })
  if (blob === null) throw new Error('Could not read the rendered figure back.')
  return { data: new Uint8Array(await blob.arrayBuffer()), mediaType }
}

/**
 * Cuts figures out of pages, holding on to its two canvases between calls.
 *
 * This matters more than it looks: a page rendered at reading resolution is
 * around thirteen megabytes of pixels, and a textbook has hundreds of pages.
 * Allocating one canvas per page leaves the browser to reclaim them faster
 * than it actually does, and once it falls behind, encoding stops calling back
 * and the import stops dead. One canvas, resized, costs the same at page one
 * as at page five hundred.
 */
export interface FigureCutter {
  imagesOnPage(
    page: PDFPageProxy,
    store: (data: Uint8Array, mediaType: string) => Promise<StoredImage | null>
  ): Promise<PlacedImage[]>
  /** Hand the pixels back; a canvas left at full size stays allocated. */
  dispose(): void
}

export function createFigureCutter(): FigureCutter {
  const pageCanvas = document.createElement('canvas')
  const crop = document.createElement('canvas')

  const release = (canvas: HTMLCanvasElement): void => {
    canvas.width = 0
    canvas.height = 0
  }

  return {
    dispose() {
      release(pageCanvas)
      release(crop)
    },

    async imagesOnPage(page, store) {
      const base = page.getViewport({ scale: 1 })
      const pageArea = base.width * base.height

      const opList = await page.getOperatorList(RENDER_INTENT)
      const wanted = mergeTouching(placementsOf(opList))
        .filter((r) => {
          const width = r.right - r.left
          const height = r.top - r.bottom
          if (width < MIN_SIDE_PT || height < MIN_SIDE_PT) return false
          // A whole-page image is the paper itself — a background wash, a
          // border, a watermark — not something anybody set out to look at.
          return width * height <= pageArea * 0.95
        })
        .sort((a, b) => b.top - a.top)
        .slice(0, MAX_IMAGES_PER_PAGE)

      // Rendering is the expensive half, and a page with no figures never pays it.
      if (wanted.length === 0) return []

      const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_PAGE_WIDTH / base.width))
      const viewport = page.getViewport({ scale })

      pageCanvas.width = Math.ceil(viewport.width)
      pageCanvas.height = Math.ceil(viewport.height)
      const pageCtx = pageCanvas.getContext('2d')
      if (pageCtx === null) return []

      // A PDF page is a sheet of paper; without this the parts of a figure that
      // are simply unpainted come out transparent, and then black.
      pageCtx.fillStyle = '#ffffff'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      await page.render({ canvasContext: pageCtx, viewport, ...RENDER_INTENT }).promise

      const [va, vb, vc, vd, ve, vf] = viewport.transform as Matrix
      const placed: PlacedImage[] = []

      for (const rect of wanted) {
        const padded = {
          left: rect.left - CROP_MARGIN_PT,
          right: rect.right + CROP_MARGIN_PT,
          bottom: rect.bottom - CROP_MARGIN_PT,
          top: rect.top + CROP_MARGIN_PT
        }
        const xs = [padded.left, padded.right].flatMap((x) =>
          [padded.bottom, padded.top].map((y) => va * x + vc * y + ve)
        )
        const ys = [padded.left, padded.right].flatMap((x) =>
          [padded.bottom, padded.top].map((y) => vb * x + vd * y + vf)
        )

        const left = Math.max(0, Math.floor(Math.min(...xs)))
        const top = Math.max(0, Math.floor(Math.min(...ys)))
        const width = Math.min(pageCanvas.width - left, Math.ceil(Math.max(...xs) - left))
        const height = Math.min(pageCanvas.height - top, Math.ceil(Math.max(...ys) - top))
        if (width < 1 || height < 1) continue

        crop.width = width
        crop.height = height
        const cropCtx = crop.getContext('2d')
        if (cropCtx === null) continue
        cropCtx.drawImage(pageCanvas, left, top, width, height, 0, 0, width, height)

        try {
          const { data, mediaType } = await toBytes(crop)
          const image = await store(data, mediaType)
          if (image !== null) placed.push({ y: rect.top, image })
        } catch {
          // One figure that won't come out is not a reason to lose the page.
        }
      }

      return placed
    }
  }
}
