import type { Block, BookDoc, Chapter } from '../../../shared/types'
import { PARSE_VERSION } from '../../../shared/types'
import { attachImages, readDataUri, type ImageSink } from '../lib/images'
import { extractBlocks, parseDocument } from './html'

/**
 * A web page is a book with no spine: no manifest saying which files are the
 * text, and no contents page naming the sections. Both have to be recovered
 * from the markup — first by throwing away everything that isn't the article,
 * then by cutting what's left into sections small enough to finish.
 */

/** Elements that are never the article, whatever a page calls them. */
const DROP_TAGS = [
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'iframe',
  'button',
  'select',
  'svg',
  'template'
]

/**
 * Words that mark a container as furniture rather than text. Matched against
 * class and id split into words, so "related-posts" hits and "adventure" —
 * which a substring match on "ad" would wrongly catch — does not.
 */
const JUNK_WORDS = new Set([
  'nav',
  'navigation',
  'menu',
  'masthead',
  'header',
  'footer',
  'sidebar',
  'aside',
  'widget',
  'subscribe',
  'subscription',
  'newsletter',
  'signup',
  'share',
  'sharing',
  'social',
  'comment',
  'comments',
  'disqus',
  'related',
  'recommended',
  'recirc',
  'promo',
  'promotion',
  'banner',
  'ad',
  'ads',
  'advert',
  'advertisement',
  'sponsored',
  'cookie',
  'consent',
  'popup',
  'modal',
  'overlay',
  'breadcrumb',
  'breadcrumbs',
  'pagination',
  'pager',
  'toc',
  'tableofcontents',
  'tags',
  'taglist',
  'metadata',
  'byline',
  'authorbox',
  'skip',
  'hidden',
  'print',
  'noprint'
])

function wordsOf(attr: string | null): string[] {
  if (!attr) return []
  return attr
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function looksLikeFurniture(el: Element): boolean {
  const names = [...wordsOf(el.getAttribute('class')), ...wordsOf(el.getAttribute('id'))]
  return names.some((word) => JUNK_WORDS.has(word))
}

function textLength(el: Element): number {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
}

/** How much of an element's text sits inside links — high means it's a list of places to go, not something to read. */
function linkDensity(el: Element): number {
  const total = textLength(el)
  if (total === 0) return 1
  let linked = 0
  for (const anchor of Array.from(el.getElementsByTagName('a'))) linked += textLength(anchor)
  return linked / total
}

/**
 * Strip the page down to plausible article content. Runs on a detached copy so
 * nothing here can disturb the live document.
 */
function stripFurniture(doc: Document): void {
  for (const tag of DROP_TAGS) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) el.remove()
  }

  for (const el of Array.from(doc.querySelectorAll('[class],[id]'))) {
    // An <article class="post-header"> wrapper would take the article with it.
    if (el.tagName.toLowerCase() === 'article') continue
    if (looksLikeFurniture(el)) el.remove()
  }

  for (const el of Array.from(doc.querySelectorAll('[hidden],[aria-hidden="true"]'))) el.remove()

  // In-page contents lists and "read next" rails: three or more links and
  // almost nothing between them. These sit inside the article body, so they
  // survive everything above and would otherwise be read as prose.
  for (const list of Array.from(doc.querySelectorAll('ul,ol'))) {
    if (list.getElementsByTagName('a').length >= 3 && linkDensity(list) > 0.8) list.remove()
  }
}

const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,figcaption,pre'

/**
 * Layout tables were how the web was built for a decade, and a lot of the best
 * long essays have never been re-marked-up. Tables holding prose are unwrapped
 * so their text is read; tables holding data are left alone, and skipped as
 * before, because flattening a grid into sentences produces nonsense.
 */
function unwrapProseTables(doc: Document): void {
  for (const table of Array.from(doc.getElementsByTagName('table'))) {
    const cells = Array.from(table.getElementsByTagName('td'))
    const holdsProse = cells.some((cell) => textLength(cell) >= 200)
    if (!holdsProse) continue

    for (const el of Array.from(table.querySelectorAll('table,tbody,thead,tr,td,th'))) {
      const div = doc.createElement('div')
      while (el.firstChild) div.appendChild(el.firstChild)
      el.replaceWith(div)
    }
    const div = doc.createElement('div')
    while (table.firstChild) div.appendChild(table.firstChild)
    table.replaceWith(div)
  }
}

/**
 * Text separated by blank lines rather than paragraph tags — the other half of
 * the old-markup problem. Split on runs of <br> so each paragraph becomes one.
 */
function splitOnBreaks(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('div,section,td,font,body'))) {
    if (el.querySelector(BLOCK_SELECTOR)) continue
    if (el.querySelector('img,picture')) continue
    if (!/(?:<br[^>]*>\s*){2,}/i.test(el.innerHTML)) continue

    const parts = el.innerHTML
      .split(/(?:<br[^>]*>\s*){2,}/i)
      .map((part) => tidy(part.replace(/<[^>]+>/g, ' ')))
      .filter((part) => part !== '')
    if (parts.length < 2) continue

    const holder = doc.createElement('div')
    for (const part of parts) {
      const p = doc.createElement('p')
      p.textContent = part
      holder.appendChild(p)
    }
    el.replaceWith(holder)
  }
}

/**
 * Rails that sit inside the article's own container and so survive every check
 * above — they announce themselves in their heading rather than their markup.
 * Only trailing sections are dropped, so a section genuinely called "What's
 * next" in the middle of an argument is left where the author put it.
 */
const RAIL_TITLE =
  /^(related|recent|more from|more posts|popular|latest|you might|read next|further reading|comments?|subscribe|newsletter|share this|about the author|footnotes?)\b/i

/**
 * Rewrite text-bearing bare containers as paragraphs. EPUB files are built by
 * publishing tools and mark their prose up properly; a lot of the web does not,
 * and a `<div>` holding a paragraph of text is common enough that ignoring it
 * loses real content — the standfirst under a headline, most often.
 */
function promoteBareText(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('div,section'))) {
    // Only the innermost container, so a paragraph isn't emitted twice.
    if (el.querySelector(`${BLOCK_SELECTOR},div,section`)) continue
    // Rewriting to a paragraph keeps the text and throws the markup away, which
    // would take a figure with it.
    if (el.querySelector('img,picture')) continue
    const text = tidy(el.textContent ?? '')
    if (text.length < 40 || linkDensity(el) > 0.5) continue
    const p = doc.createElement('p')
    p.textContent = text
    el.replaceWith(p)
  }
}

/**
 * Pick the element holding the article. Scores every candidate by how much
 * unlinked paragraph text it contains, then prefers the deepest element that
 * still holds essentially all of it — the tightest wrapper around the text,
 * rather than <body>, which trivially contains everything.
 */
function pickContent(doc: Document): Element {
  const root = doc.body ?? doc.documentElement

  const scored: { el: Element; score: number; depth: number }[] = []
  const candidates = [root, ...Array.from(root.querySelectorAll('article,main,section,div,td'))]

  for (const el of candidates) {
    let score = 0
    for (const p of Array.from(el.querySelectorAll('p,blockquote,li'))) {
      const length = textLength(p)
      // Short paragraphs are captions, credits and buttons far more often than prose.
      if (length >= 40 && linkDensity(p) < 0.5) score += length
    }
    if (score === 0) continue

    let depth = 0
    for (let node = el.parentElement; node; node = node.parentElement) depth++
    scored.push({ el, score, depth })
  }

  if (scored.length === 0) return root

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
  const tight = scored
    .filter((c) => c.score >= best.score * 0.95)
    .reduce((a, b) => (b.depth > a.depth ? b : a))
  return tight.el
}

function meta(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content')?.trim()
    if (value) return value
  }
  return ''
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shorten(text: string, max: number): string {
  const clean = tidy(text)
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function wordCount(text: string): number {
  const clean = tidy(text)
  return clean === '' ? 0 : clean.split(' ').length
}

function wordsIn(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + wordCount(b.text), 0)
}

/** Roughly a five-minute read: long enough to be a real section, short enough to see the end of. */
const CHUNK_WORDS = 600
/** Past this, a section is a wall of text whatever the author's headings say. */
const OVERSIZED_WORDS = 1100

/**
 * Cut a run of blocks into sections of roughly CHUNK_WORDS, always on a
 * paragraph boundary. Used when an article has no headings to cut on, and to
 * break up any single heading section that runs far too long.
 */
function chunkBlocks(blocks: Block[], startIndex: number): Chapter[] {
  const chapters: Chapter[] = []
  let current: Block[] = []

  const flush = (): void => {
    if (current.length === 0) return
    const n = startIndex + chapters.length
    const first = current.find((b) => wordCount(b.text) >= 4) ?? current[0]
    chapters.push({
      id: `c${n}`,
      title: shorten(first.text, 52) || `Part ${n + 1}`,
      blocks: current
    })
    current = []
  }

  for (const block of blocks) {
    current.push(block)
    if (wordsIn(current) >= CHUNK_WORDS) flush()
  }

  // A short tail is joined to the section before it rather than left as a stub.
  if (wordsIn(current) < CHUNK_WORDS * 0.4 && chapters.length > 0) {
    chapters[chapters.length - 1].blocks.push(...current)
    current = []
  }
  flush()

  return chapters
}

/**
 * Cut the article into sections on its own headings, so the progress bar, the
 * preview and the end-of-section quiz all work exactly as they do in a book.
 * The article's own structure is used wherever it has one — nothing is dropped
 * or reordered, only grouped.
 */
function toChapters(blocks: Block[]): Chapter[] {
  const level: 'h2' | 'h3' | null =
    blocks.filter((b) => b.type === 'h2').length >= 2
      ? 'h2'
      : blocks.filter((b) => b.type === 'h3').length >= 2
        ? 'h3'
        : null

  if (level === null) return chunkBlocks(blocks, 0)

  const runs: { title: string; blocks: Block[] }[] = []
  let current: { title: string; blocks: Block[] } = { title: '', blocks: [] }

  for (const block of blocks) {
    if (block.type === level) {
      if (current.blocks.length > 0) runs.push(current)
      current = { title: tidy(block.text), blocks: [block] }
    } else {
      current.blocks.push(block)
    }
  }
  if (current.blocks.length > 0) runs.push(current)

  const chapters: Chapter[] = []
  // A run too short to stand as a section — a standfirst above the first
  // heading, or a heading with nothing under it — joins a neighbour instead:
  // the section before it, or the next one when there is nothing before.
  let pending: Block[] = []

  for (const run of runs) {
    const blocks = [...pending, ...run.blocks]
    pending = []

    if (wordsIn(blocks) < 40) {
      if (chapters.length > 0) chapters[chapters.length - 1].blocks.push(...blocks)
      else pending = blocks
      continue
    }

    if (wordsIn(blocks) > OVERSIZED_WORDS) {
      const parts = chunkBlocks(blocks, chapters.length)
      // The author's heading names the first part; the rest are numbered under it.
      parts.forEach((part, i) => {
        chapters.push({
          ...part,
          title: run.title === '' ? part.title : i === 0 ? run.title : `${run.title} (${i + 1})`
        })
      })
      continue
    }

    chapters.push({
      id: `c${chapters.length}`,
      title: run.title || shorten(blocks[0].text, 52) || `Part ${chapters.length + 1}`,
      blocks
    })
  }

  // Nothing but a standfirst: better one short section than none at all.
  if (pending.length > 0) {
    if (chapters.length > 0) chapters[0].blocks.unshift(...pending)
    else chapters.push({ id: 'c0', title: shorten(pending[0].text, 52), blocks: pending })
  }

  while (chapters.length > 1 && RAIL_TITLE.test(chapters[chapters.length - 1].title)) {
    chapters.pop()
  }

  return chapters.map((chapter, i) => ({ ...chapter, id: `c${i}` }))
}

/**
 * More than an essay's worth of figures is a gallery, a photo rail or a page
 * whose furniture we failed to strip — either way, not something to spend a
 * hundred downloads on.
 */
const MAX_ARTICLE_IMAGES = 40

export async function parseArticle(
  html: string,
  url: string,
  id: string,
  sink?: ImageSink
): Promise<BookDoc> {
  const doc = parseDocument(html)

  const title =
    meta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    tidy(doc.querySelector('h1')?.textContent ?? '') ||
    tidy(doc.querySelector('title')?.textContent ?? '') ||
    'Untitled article'

  const author =
    meta(doc, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="twitter:creator"]'
    ]) ||
    tidy(doc.querySelector('[rel="author"], .author-name, [itemprop="author"]')?.textContent ?? '')

  stripFurniture(doc)
  unwrapProseTables(doc)
  splitOnBreaks(doc)
  promoteBareText(doc)
  const content = pickContent(doc)

  // A page's own addresses are relative to the page; ours have to survive
  // being read back offline, so they are made absolute here, where the URL the
  // page was actually served from is still known.
  let taken = 0
  let raw = extractBlocks(content, 'a', {
    imageRef: sink
      ? (href) => {
          if (href.startsWith('data:')) return href
          if (taken >= MAX_ARTICLE_IMAGES) return null
          try {
            const absolute = new URL(href, url)
            if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null
            taken++
            return absolute.toString()
          } catch {
            return null
          }
        }
      : undefined
  })

  // The page title is usually printed at the top of the article too; keeping it
  // would open the reading with a heading that says what the header already says.
  if (raw.length > 0 && raw[0].type === 'h1') raw = raw.slice(1)

  if (wordsIn(raw) < 100) {
    throw new Error(
      'No article text found at that address — the page may be mostly script-rendered, or behind a paywall.'
    )
  }

  const blocks: Block[] = sink
    ? await attachImages(
        raw,
        async (ref) =>
          ref.startsWith('data:') ? readDataUri(ref) : window.api.fetchImage(ref, url),
        sink
      )
    : (raw as Block[])

  return {
    id,
    title: shorten(title, 120),
    author: author === '' ? new URL(url).hostname.replace(/^www\./, '') : shorten(author, 80),
    chapters: toChapters(blocks),
    version: PARSE_VERSION
  }
}
