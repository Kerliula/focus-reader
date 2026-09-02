import JSZip from 'jszip'
import type { Block, BookDoc, Chapter } from '../../../shared/types'
import { PARSE_VERSION } from '../../../shared/types'
import {
  attachImages,
  mediaTypeFor,
  readDataUri,
  type ImageSink,
  type StoredImage
} from '../lib/images'
import { extractBlocks, parseDocument } from './html'

const OPS_NAMESPACE = 'http://www.idpf.org/2007/ops'

/** Resolve an href relative to the directory holding the referring document. */
function resolvePath(baseDir: string, href: string): string {
  const target = decodeURIComponent(href.split('#')[0])
  if (!baseDir) return target
  const parts = `${baseDir}/${target}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf('/')
  return i === -1 ? '' : filePath.slice(0, i)
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  if (!file) return null
  return file.async('string')
}

/**
 * Tag lookup that works whether the file parsed as XML (case-sensitive) or fell
 * back to lenient HTML parsing (tag names lowercased).
 */
function byTag(root: Document | Element, name: string): Element[] {
  const exact = Array.from(root.getElementsByTagName(name))
  const lower = name.toLowerCase()
  return lower === name ? exact : [...exact, ...Array.from(root.getElementsByTagName(lower))]
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Trim to a readable length on a word boundary. */
function shorten(text: string, max: number): string {
  const clean = tidy(text)
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The EPUB 3 navigation document: <nav epub:type="toc"> of <a href> entries. */
function titlesFromNav(navDoc: Document, navDir: string): Map<string, string> {
  const titles = new Map<string, string>()

  const navs = Array.from(navDoc.getElementsByTagName('nav'))
  const toc =
    navs.find((nav) =>
      (nav.getAttribute('epub:type') ?? nav.getAttributeNS(OPS_NAMESPACE, 'type') ?? '')
        .split(/\s+/)
        .includes('toc')
    ) ?? navs[0]
  if (!toc) return titles

  for (const anchor of Array.from(toc.getElementsByTagName('a'))) {
    const href = anchor.getAttribute('href')
    const label = tidy(anchor.textContent ?? '')
    if (!href || label === '') continue
    const path = resolvePath(navDir, href)
    // Several entries can point into one file; the first names the file itself.
    if (!titles.has(path)) titles.set(path, label)
  }

  return titles
}

/** The EPUB 2 fallback: toc.ncx, a navMap of navPoints. */
function titlesFromNcx(ncxDoc: Document, ncxDir: string): Map<string, string> {
  const titles = new Map<string, string>()

  for (const point of byTag(ncxDoc, 'navPoint')) {
    const label = tidy(byTag(point, 'text')[0]?.textContent ?? '')
    const src = byTag(point, 'content')[0]?.getAttribute('src')
    if (!src || label === '') continue
    const path = resolvePath(ncxDir, src)
    if (!titles.has(path)) titles.set(path, label)
  }

  return titles
}

/**
 * Map each spine file to the name the publisher gave it. Far better than
 * guessing from markup: it is the same list the reader would see in a shop.
 */
async function readTocTitles(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, { path: string; mediaType: string; properties: string }>
): Promise<Map<string, string>> {
  const navItem = [...manifest.values()].find((item) =>
    item.properties.split(/\s+/).includes('nav')
  )
  if (navItem) {
    const source = await readText(zip, navItem.path)
    if (source) {
      const titles = titlesFromNav(parseDocument(source), dirOf(navItem.path))
      if (titles.size > 0) return titles
    }
  }

  const ncxId = opf.querySelector('spine')?.getAttribute('toc')
  const ncxItem =
    (ncxId ? manifest.get(ncxId) : undefined) ??
    [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml')
  if (ncxItem) {
    const source = await readText(zip, ncxItem.path)
    if (source) return titlesFromNcx(parseDocument(source), dirOf(ncxItem.path))
  }

  return new Map()
}

const HEADINGS = new Set(['h1', 'h2', 'h3'])
const LABEL_ONLY = /^(chapter|part|book|section|appendix)\b/i
const TITLE_MAX = 90
const LINE_MAX = 50

/** Words made of actual letters — "v 1.0" and "2013" have none. */
function alphaWords(text: string): number {
  return tidy(text)
    .split(' ')
    .filter((word) => /[a-z]{2,}/i.test(word)).length
}

/**
 * A short, unpunctuated line — the shape of a title, not of prose. A trailing
 * number means it is a contents entry ("Introduction 3"), not part of a title.
 */
function looksLikeTitleLine(text: string): boolean {
  const clean = tidy(text)
  return (
    clean.length <= LINE_MAX &&
    alphaWords(clean) >= 1 &&
    // Closing quotes and brackets hide the sentence punctuation behind them.
    !/[.!?:;,]["'”’)\]]*$/.test(clean) &&
    !/\s\d{1,4}$/.test(clean)
  )
}

/**
 * Name a section from its own opening. Many books style their titles as plain
 * paragraphs and break them over one element per printed line — "CHAPTER ONE"
 * above "The Mom Test", or "Conclusion and" above "cheatsheet" — so the run has
 * to be stitched back together instead of showing only its first fragment.
 */
function titleFromBlocks(blocks: Block[]): string {
  const start = blocks.findIndex((b) => tidy(b.text) !== '')
  if (start === -1) return ''

  const seed = blocks[start]
  const seedText = tidy(seed.text)
  const usable =
    HEADINGS.has(seed.type) || (looksLikeTitleLine(seedText) && alphaWords(seedText) >= 2)

  if (usable) {
    // "CHAPTER TWO" is a label for the name that follows, so it takes a dash.
    // The rest of the run is one title broken over lines, so it takes spaces.
    const labelled = LABEL_ONLY.test(seedText)
    let title = seedText
    for (let i = start + 1; i < blocks.length && i < start + 5; i++) {
      const part = tidy(blocks[i].text)
      if (!looksLikeTitleLine(part)) break
      const joiner = labelled && i === start + 1 ? ' — ' : ' '
      if (title.length + joiner.length + part.length > TITLE_MAX) break
      title += joiner + part
    }
    return shorten(title, TITLE_MAX)
  }

  // A stack of "v 1.0", "@robfitz", "August 2013" names nothing. Reach past it
  // for the first line with something in it.
  const meaningful = blocks.find((b) => alphaWords(b.text) >= 4)
  return shorten((meaningful ?? seed).text, 60)
}

export async function parseEpub(
  data: Uint8Array,
  id: string,
  sink?: ImageSink
): Promise<BookDoc> {
  const zip = await JSZip.loadAsync(data)

  const containerXml = await readText(zip, 'META-INF/container.xml')
  if (!containerXml) throw new Error('Not a valid EPUB: META-INF/container.xml is missing.')

  const container = parseDocument(containerXml)
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('Not a valid EPUB: no rootfile in container.xml.')

  const opfSource = await readText(zip, opfPath)
  if (!opfSource) throw new Error(`Not a valid EPUB: ${opfPath} is missing.`)
  const opf = parseDocument(opfSource)
  const baseDir = dirOf(opfPath)

  const title =
    opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() ||
    opf.querySelector('title')?.textContent?.trim() ||
    'Untitled'
  const author =
    opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim() ||
    opf.querySelector('creator')?.textContent?.trim() ||
    'Unknown author'

  // manifest id -> absolute path inside the zip
  const manifest = new Map<string, { path: string; mediaType: string; properties: string }>()
  for (const item of Array.from(opf.querySelectorAll('manifest > item'))) {
    const itemId = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!itemId || !href) continue
    manifest.set(itemId, {
      path: resolvePath(baseDir, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? ''
    })
  }

  const tocTitles = await readTocTitles(zip, opf, manifest)

  const spine = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((ref) => ref.getAttribute('idref'))
    .filter((v): v is string => Boolean(v))
    .map((idref) => manifest.get(idref))
    .filter((v): v is { path: string; mediaType: string; properties: string } => Boolean(v))
    .filter((item) => !item.mediaType.includes('image'))

  // Manifest paths give a picture's declared type; the file extension is the
  // fallback for the EPUBs whose manifest disagrees with what is in the zip.
  const imageTypes = new Map<string, string>()
  for (const item of manifest.values()) imageTypes.set(item.path, item.mediaType)

  /** Read a picture out of the zip by the path the spine document named. */
  const loadImage = async (
    ref: string
  ): Promise<{ data: Uint8Array; mediaType: string } | null> => {
    if (ref.startsWith('data:')) return readDataUri(ref)
    const file = zip.file(ref)
    if (!file) return null
    const declared = imageTypes.get(ref) ?? ''
    return {
      data: await file.async('uint8array'),
      mediaType: declared.startsWith('image/') ? declared : mediaTypeFor(ref)
    }
  }

  // Shared across sections: publishers repeat the same rule or ornament at the
  // head of every chapter, and it should cost one read for the whole book.
  const imageCache = new Map<string, StoredImage | null>()

  const chapters: Chapter[] = []
  for (let i = 0; i < spine.length; i++) {
    const source = await readText(zip, spine[i].path)
    if (!source) continue

    const doc = parseDocument(source)
    const body = doc.body ?? doc.documentElement
    if (!body) continue

    const baseDirOfDoc = dirOf(spine[i].path)
    const raw = extractBlocks(body, `c${i}`, {
      imageRef: sink
        ? (href) => (href.startsWith('data:') ? href : resolvePath(baseDirOfDoc, href))
        : undefined
    })

    const blocks = sink ? await attachImages(raw, loadImage, sink, imageCache) : (raw as Block[])

    // Skip cover pages and other near-empty spine entries — but a page holding
    // a full-page plate and nothing else is exactly what it looks like, and is
    // worth keeping even though it has no words in it.
    const words = blocks.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0)
    const hasPicture = blocks.some((b) => b.type === 'image')
    if (words < 12 && !hasPicture) continue

    const fromToc = tocTitles.get(spine[i].path) ?? ''
    // A plate's alt text is a description, never a section name.
    const fromBlocks = titleFromBlocks(blocks.filter((b) => b.type !== 'image'))
    // The contents entry wins by default, except when it is a bare "1", or when
    // the page carries the same title plus the part that got left off it.
    const preferBlocks =
      fromBlocks !== '' &&
      (fromToc.length < 3 ||
        (fromBlocks.length > fromToc.length &&
          fromBlocks.toLowerCase().startsWith(fromToc.toLowerCase())))

    chapters.push({
      id: `c${i}`,
      title:
        (preferBlocks ? fromBlocks : fromToc) ||
        fromBlocks ||
        fromToc ||
        `Section ${chapters.length + 1}`,
      blocks
    })
  }

  if (chapters.length === 0) throw new Error('No readable text found in this EPUB.')

  return { id, title, author, chapters, version: PARSE_VERSION }
}
