import type { BookDoc, BookFormat, BookMeta } from '../../../shared/types'
import { PARSE_VERSION } from '../../../shared/types'
import { createImageSink } from './images'
import { countWords } from './units'

export function totalWordsOf(doc: BookDoc): number {
  let total = 0
  for (const chapter of doc.chapters) {
    for (const block of chapter.blocks) total += countWords(block.text)
  }
  return total
}

/**
 * The parsers are loaded on demand: pdfjs and jszip are the two heaviest things
 * in the renderer, and opening the library or a book that's already cached
 * never touches either. The import starts alongside the file read rather than
 * after it, so splitting them costs nothing in wall-clock time.
 */
export async function parseFile(path: string, format: BookFormat, id: string): Promise<BookDoc> {
  // Where a book's illustrations go. Handed to the parsers rather than reached
  // for inside them, so each one only has to say what a picture is and where
  // it sits — not where it is kept or what makes one worth keeping.
  const sink = createImageSink(id)

  if (format === 'article') {
    const [{ parseArticle }, page] = await Promise.all([
      import('../parse/article'),
      window.api.fetchArticle(path)
    ])
    return parseArticle(page.html, page.url, id, sink)
  }

  const dataPromise = window.api.readFile(path)

  if (format === 'epub') {
    const [{ parseEpub }, data] = await Promise.all([import('../parse/epub'), dataPromise])
    return parseEpub(data, id, sink)
  }

  const [{ parsePdf }, data] = await Promise.all([import('../parse/pdf'), dataPromise])
  return parsePdf(data, id, sink)
}

/** Parsed books are cached on disk — re-opening a 600-page PDF should be instant. */
export async function loadBook(meta: BookMeta): Promise<BookDoc> {
  const cached = await window.api.getParsed(meta.id)
  // A cache written by an older parser is missing whatever that parser could
  // not see. Reading the file again is a one-off cost; a book permanently
  // missing its illustrations is not.
  if (cached && cached.chapters.length > 0 && cached.version === PARSE_VERSION) return cached

  const doc = await parseFile(meta.path, meta.format, meta.id)
  await window.api.saveParsed(doc)
  return doc
}

/** A book read and ready to be added, once its name has been agreed on. */
export interface PreparedBook {
  meta: BookMeta
  /** Already on the shelf: nothing to ask, nothing to add. */
  existing: boolean
}

/**
 * Read a file — or an article URL — and draft its library entry, without adding
 * it. The title and author come from the file, and files are often wrong about
 * both: a PDF called "final_v3", an EPUB whose author field is the publisher.
 * So they are a suggestion, and the reader has the last word before the book
 * goes on the shelf.
 */
export async function prepareBook(path: string, format: BookFormat): Promise<PreparedBook> {
  const id = await window.api.idFor(path)

  const existing = (await window.api.getLibrary()).find((b) => b.id === id)
  if (existing) return { meta: existing, existing: true }

  const doc = await parseFile(path, format, id)
  await window.api.saveParsed(doc)

  return {
    meta: {
      id,
      path,
      format,
      title: doc.title,
      author: doc.author,
      addedAt: Date.now(),
      lastOpenedAt: 0,
      totalWords: totalWordsOf(doc)
    },
    existing: false
  }
}
