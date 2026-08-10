import type { Block, BlockType } from '../../../shared/types'

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const BLOCK_TAGS = new Set([...HEADING_TAGS, 'p', 'li', 'blockquote', 'dd', 'dt', 'figcaption'])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'nav', 'svg', 'table'])

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

/**
 * Walk a parsed document and pull out readable blocks. Emits the innermost
 * block element so nested markup (a <p> inside a <blockquote>) is not duplicated.
 */
export function extractBlocks(root: Element, idPrefix: string): Block[] {
  const blocks: Block[] = []
  let counter = 0

  const visit = (el: Element): void => {
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return

    if (BLOCK_TAGS.has(tag) && !hasNestedBlock(el)) {
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
