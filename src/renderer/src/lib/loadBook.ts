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

/** Add a file — or an article URL — to the library, parsing it once up front. */
export async function importBook(path: string, format: BookFormat): Promise<BookMeta> {
  const id = await window.api.idFor(path)

  const existing = (await window.api.getLibrary()).find((b) => b.id === id)
  if (existing) return existing

  const doc = await parseFile(path, format, id)
  await window.api.saveParsed(doc)

  const meta: BookMeta = {
    id,
    path,
    format,
    title: doc.title,
    author: doc.author,
    addedAt: Date.now(),
    lastOpenedAt: 0,
    totalWords: totalWordsOf(doc)
  }
  await window.api.upsertBook(meta)
  return meta
}
