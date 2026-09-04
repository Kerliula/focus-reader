import type { Block, BlockType } from '../../../shared/types'

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const BLOCK_TAGS = new Set([...HEADING_TAGS, 'p', 'li', 'blockquote', 'dd', 'dt', 'figcaption'])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'nav', 'table'])

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
/** `<img>`, and the `<image>` an EPUB wraps a full-page plate in. */
const IMAGE_SELECTOR = 'img, image'

/**
 * A block whose picture has not been fetched yet: `imageRef` is whatever the
 * parser needs to find the bytes later — a path inside the EPUB, an absolute
 * URL, a key into a page's rendered figures. It is resolved away by
 * `attachImages`, and never reaches a `Block` that gets stored or rendered.
 */
export interface ExtractedBlock extends Block {
  imageRef?: string
}

export interface ExtractOptions {
  /**
   * Called for every picture found, with the address as the document wrote it.
   * Return a reference to fetch it by, or null to leave the picture out.
   */
  imageRef?: (href: string, el: Element) => string | null
}

function typeFor(tag: string): BlockType {
  if (tag === 'h1') return 'h1'
  if (tag === 'h2') return 'h2'
  if (HEADING_TAGS.has(tag)) return 'h3'
  if (tag === 'blockquote' || tag === 'figcaption') return 'quote'
  return 'p'
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hasNestedBlock(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName.toLowerCase())) return true
    if (hasNestedBlock(child)) return true
  }
  return false
}

/** Pick the highest-density candidate from a `srcset` attribute. */
function bestSrcset(value: string): string {
  let best = ''
  let bestScore = -1

  for (const candidate of value.split(',')) {
    const parts = candidate.trim().split(/\s+/)
    const href = parts[0] ?? ''
    if (href === '') continue

    const descriptor = parts[1] ?? ''
    const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/i)
    // Width descriptors are directly comparable. Density descriptors are
    // weighted above width values because they describe a deliberate retina
    // rendition rather than a layout hint.
    const score = match
      ? Number(match[1]) * (match[2].toLowerCase() === 'x' ? 10000 : 1)
      : 0
    if (score >= bestScore) {
      best = href
      bestScore = score
    }
  }

  return best
}

/**
 * Where a picture actually lives. Half the web ships a placeholder in `src`
 * and the real file in a data attribute, so that the browser can decide later
 * whether the reader ever scrolls far enough to want it; reading only `src`
 * would collect a page of grey squares. Prefer an explicit full-size source,
 * then the largest `srcset` candidate, before falling back to `src`.
 */
function hrefOf(el: Element): string {
  const src = el.getAttribute('src') ?? ''
  const usableSrc = src !== '' && !(src.startsWith('data:') && src.length < 512)

  for (const name of ['data-full-src', 'data-original']) {
    const value = el.getAttribute(name)
    if (value) return value
  }

  const srcset = bestSrcset(el.getAttribute('srcset') ?? el.getAttribute('data-srcset') ?? '')
  if (srcset !== '') return srcset

  for (const name of ['data-src', 'data-lazy-src']) {
    const value = el.getAttribute(name)
    if (value) return value
  }

  if (usableSrc) return src

  return (
    el.getAttributeNS(XLINK_NAMESPACE, 'href') ??
    el.getAttribute('xlink:href') ??
    el.getAttribute('href') ??
    src
  )
}

/** What the book itself says the picture shows — the caption of last resort. */
function altOf(el: Element): string {
  return clean(el.getAttribute('alt') ?? el.getAttribute('title') ?? '')
}

/**
 * Walk a parsed document and pull out readable blocks. Emits the innermost
 * block element so nested markup (a <p> inside a <blockquote>) is not
 * duplicated, and — when `imageRef` is given — the pictures in document order
 * alongside the text, so an illustration stays where its author put it.
 */
export function extractBlocks(
  root: Element,
  idPrefix: string,
  options: ExtractOptions = {}
): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = []
  let counter = 0

  const emitImage = (el: Element): void => {
    if (!options.imageRef) return
    const href = hrefOf(el).trim()
    if (href === '') return
    const ref = options.imageRef(href, el)
    if (ref === null) return
    blocks.push({ id: `${idPrefix}-b${counter++}`, type: 'image', text: altOf(el), imageRef: ref })
  }

  const visit = (el: Element): void => {
    const tag = el.tagName.toLowerCase()

    if (tag === 'img' || tag === 'image') {
      emitImage(el)
      return
    }

    // Icons and decoration are drawn inline; the one thing an <svg> holds that
    // is worth keeping is the <image> an EPUB cover or plate page wraps.
    if (tag === 'svg') {
      for (const image of Array.from(el.getElementsByTagName('image'))) emitImage(image)
      return
    }

    if (SKIP_TAGS.has(tag)) return

    if (BLOCK_TAGS.has(tag) && !hasNestedBlock(el)) {
      // A paragraph that is really just a frame around a figure — the commonest
      // way an EPUB places one — would otherwise be read as an empty block.
      if (options.imageRef) {
        for (const image of Array.from(el.querySelectorAll(IMAGE_SELECTOR))) emitImage(image)
      }

      const text = clean(el.textContent ?? '')
      if (text.length > 0) {
        blocks.push({ id: `${idPrefix}-b${counter++}`, type: typeFor(tag), text })
      }
      return
    }

    for (const child of Array.from(el.children)) visit(child)
  }

  visit(root)
  return blocks
}

/** Parse XHTML, falling back to lenient HTML parsing for malformed EPUB files. */
export function parseDocument(source: string): Document {
  const parser = new DOMParser()
  try {
    const xml = parser.parseFromString(source, 'application/xhtml+xml')
    if (!xml.querySelector('parsererror')) return xml
  } catch {
    // fall through to HTML parsing
  }
  return parser.parseFromString(source, 'text/html')
}
