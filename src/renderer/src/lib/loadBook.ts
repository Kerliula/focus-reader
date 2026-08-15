import type { BookDoc, BookFormat, BookMeta } from '../../../shared/types'
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
  if (format === 'article') {
    const [{ parseArticle }, page] = await Promise.all([
      import('../parse/article'),
      window.api.fetchArticle(path)
    ])
    return parseArticle(page.html, page.url, id)
  }

  const dataPromise = window.api.readFile(path)

  if (format === 'epub') {
    const [{ parseEpub }, data] = await Promise.all([import('../parse/epub'), dataPromise])
    return parseEpub(data, id)
  }

  const [{ parsePdf }, data] = await Promise.all([import('../parse/pdf'), dataPromise])
  return parsePdf(data, id)
}

/** Parsed books are cached on disk — re-opening a 600-page PDF should be instant. */
export async function loadBook(meta: BookMeta): Promise<BookDoc> {
  const cached = await window.api.getParsed(meta.id)
  if (cached && cached.chapters.length > 0) return cached

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
