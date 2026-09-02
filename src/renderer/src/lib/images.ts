import type { Block, BookImage } from '../../../shared/types'
import type { ExtractedBlock } from '../parse/html'

/** A picture as the store hands it back: an address and the space it needs. */
export type StoredImage = Omit<BookImage, 'alt'>

/** Turn the bytes of one picture into something the page can show, or nothing. */
export type ImageSink = (data: Uint8Array, mediaType: string) => Promise<StoredImage | null>

/** Fetch the bytes behind whatever reference a parser recorded for a picture. */
export type ImageLoader = (ref: string) => Promise<{ data: Uint8Array; mediaType: string } | null>

/**
 * Below this on either side it is a spacer, a bullet, a share button or a
 * tracking pixel — never something anybody meant you to look at. Filtering on
 * the decoded size rather than on the markup catches all of them at once,
 * whatever the page decided to call them.
 */
const MIN_EDGE = 64

/** A rule or a divider drawn as an image: real, but not a figure. */
const MAX_ASPECT = 20

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

/** Guess a media type from a path, for sources that don't declare one. */
export function mediaTypeFor(pathOrUrl: string): string {
  const ext = pathOrUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[ext] ?? ''
}

export function isImageType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith('image/')
}

/**
 * A picture written straight into the markup rather than referenced. Rare in
 * books, common enough in web pages that ignoring it loses real diagrams.
 */
export function readDataUri(uri: string): { data: Uint8Array; mediaType: string } | null {
  const head = uri.match(/^data:([^;,]*)(;base64)?,/i)
  if (!head) return null

  const mediaType = head[1].toLowerCase() || 'text/plain'
  if (!isImageType(mediaType)) return null
  const body = uri.slice(head[0].length)

  try {
    if (head[2]) {
      const binary = atob(body)
      const data = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
      return { data, mediaType }
    }
    return { data: new TextEncoder().encode(decodeURIComponent(body)), mediaType }
  } catch {
    return null
  }
}

interface Size {
  width: number
  height: number
}

/**
 * An SVG carries no pixels to decode, so its size has to be read off the
 * markup. `width`/`height` are often a percentage of whatever box the file was
 * dropped into, in which case the viewBox is the only honest answer.
 */
function measureSvg(data: Uint8Array): Size | null {
  const source = new TextDecoder().decode(data.slice(0, 4096))
  const open = source.match(/<svg\b[^>]*>/i)?.[0]
  if (!open) return null

  const attr = (name: string): number => {
    const raw = open.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? ''
    if (raw.includes('%')) return 0
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  const width = attr('width')
  const height = attr('height')
  if (width > 0 && height > 0) return { width, height }

  const box = (open.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? '')
    .split(/[\s,]+/)
    .map(Number)
  if (box.length === 4 && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] }

  // Scalable and unlabelled: shown at whatever the column allows.
  return { width: 0, height: 0 }
}

async function measure(data: Uint8Array, mediaType: string): Promise<Size | null> {
  if (mediaType === 'image/svg+xml') return measureSvg(data)

  try {
    // A copy: the blob must not be backed by a buffer a parser still owns.
    const bitmap = await createImageBitmap(new Blob([data.slice()], { type: mediaType }))
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    // A format this build can't decode is a format it can't display either.
    return null
  }
}

/**
 * Keep a book's pictures beside it, skipping the ones that are furniture.
 * Deciding here rather than in each parser means an EPUB, a PDF and a web page
 * are all held to the same standard of what counts as an illustration.
 */
export function createImageSink(bookId: string): ImageSink {
  return async (data, mediaType) => {
    if (data.byteLength === 0 || !isImageType(mediaType)) return null

    const size = await measure(data, mediaType)
    if (size === null) return null

    const { width, height } = size
    if (width > 0 && height > 0) {
      if (width < MIN_EDGE || height < MIN_EDGE) return null
      const aspect = Math.max(width / height, height / width)
      if (aspect > MAX_ASPECT) return null
    }

    try {
      const src = await window.api.saveAsset(bookId, data, mediaType)
      return { src, width, height }
    } catch {
      return null
    }
  }
}

/** Run tasks a few at a time: a hundred parallel downloads help nobody. */
async function inBatches<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]()
  })
  await Promise.all(workers)
}

/**
 * Replace the picture references a parser left behind with real, stored
 * images, and drop the blocks whose picture could not be had — a gap in the
 * text is worse than a missing illustration nobody knew was there.
 *
 * Each distinct reference is resolved once, and `cache` carries that across
 * calls: the decoration an EPUB repeats at every chapter opening is fetched,
 * decoded and stored a single time for the whole book.
 */
export async function attachImages(
  blocks: ExtractedBlock[],
  load: ImageLoader,
  sink: ImageSink,
  cache: Map<string, StoredImage | null> = new Map(),
  concurrency = 4
): Promise<Block[]> {
  const refs = [
    ...new Set(blocks.flatMap((b) => (b.imageRef && !cache.has(b.imageRef) ? [b.imageRef] : [])))
  ]

  await inBatches(
    refs.map((ref) => async () => {
      try {
        const raw = await load(ref)
        cache.set(ref, raw === null ? null : await sink(raw.data, raw.mediaType))
      } catch {
        cache.set(ref, null)
      }
    }),
    concurrency
  )

  const out: Block[] = []
  for (const block of blocks) {
    if (block.imageRef === undefined) {
      out.push(stripRef(block))
      continue
    }
    const image = cache.get(block.imageRef)
    if (!image) continue
    out.push({ id: block.id, type: 'image', text: '', image: { ...image, alt: block.text } })
  }
  return out
}

function stripRef(block: ExtractedBlock): Block {
  const { imageRef: _imageRef, ...rest } = block
  return rest
}
