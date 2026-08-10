import type { BlockType, Chapter, Granularity } from '../../../shared/types'

export interface Unit {
  key: string
  index: number
  text: string
  words: number
  /** Words in this chapter before this unit. */
  wordsBefore: number
}

export interface RenderBlock {
  id: string
  type: BlockType
  units: Unit[]
}

export interface ChapterUnits {
  blocks: RenderBlock[]
  units: Unit[]
  totalWords: number
}

const ABBREVIATIONS =
  /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|fig|no|vol|pp?|ch|ed|al|inc|ltd|co)\.$/i

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * Split a paragraph into sentences, keeping abbreviations and initials intact
 * so the spotlight does not stop in the middle of "Dr. Weiss".
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g)
  if (!parts) return [text]

  const out: string[] = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    const prevTrimmed = prev?.trimEnd() ?? ''
    const mergeIntoPrev =
      prev !== undefined &&
      (ABBREVIATIONS.test(prevTrimmed) ||
        /\b[A-Z]\.$/.test(prevTrimmed) ||
        countWords(prevTrimmed) < 2)

    if (mergeIntoPrev) out[out.length - 1] = prev + part
    else out.push(part)
  }

  return out.map((s) => s.trim()).filter((s) => s !== '')
}

export function buildChapterUnits(chapter: Chapter, granularity: Granularity): ChapterUnits {
  const blocks: RenderBlock[] = []
  const units: Unit[] = []
  let running = 0

  for (const block of chapter.blocks) {
    // Headings are always one unit — splitting them reads badly.
    const pieces =
      granularity === 'sentence' && block.type === 'p' ? splitSentences(block.text) : [block.text]

    const blockUnits: Unit[] = pieces.map((text, i) => {
      const words = countWords(text)
      const unit: Unit = {
        key: `${block.id}-u${i}`,
        index: units.length,
        text,
        words,
        wordsBefore: running
      }
      running += words
      units.push(unit)
      return unit
    })

    blocks.push({ id: block.id, type: block.type, units: blockUnits })
  }

  return { blocks, units, totalWords: running }
}
