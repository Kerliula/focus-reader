export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote'

export interface Block {
  id: string
  type: BlockType
  text: string
}

export interface Chapter {
  id: string
  title: string
  blocks: Block[]
}

/** A fully parsed book, cached to disk so re-opening is instant. */
export interface BookDoc {
  id: string
  title: string
  author: string
  chapters: Chapter[]
}

export type BookFormat = 'epub' | 'pdf' | 'article'

export interface BookMeta {
  id: string
  /** A file path, or the source URL when the format is `article`. */
  path: string
  format: BookFormat
  title: string
  author: string
  addedAt: number
  lastOpenedAt: number
  totalWords: number
}

export interface Progress {
  chapterIndex: number
  unitIndex: number
  /** Words read across the whole book, used for the overall progress bar. */
  wordsRead: number
  updatedAt: number
  /** Minutes actually spent reading, accumulated per session. */
  minutesRead: number
}

export interface Thought {
  id: string
  bookId: string | null
  text: string
  createdAt: number
  done: boolean
}

/**
 * What a question is actually checking. Recall ("says") is the anchor; the rest
 * are the ones that catch a reader who followed the words but not the argument.
 */
export type QuizKind = 'says' | 'means' | 'implies' | 'applies' | 'limits'

export interface QuizQuestion {
  question: string
  options: string[]
  /** Index into `options`. */
  answer: number
  because: string
  kind: QuizKind
  /** Aligned with `options`: the misreading behind each wrong one, '' at the answer. */
  whyWrong: string[]
}

/** Two lines of orientation shown before a section, so you know where it goes. */
export interface SectionPreview {
  /** The ground this section covers — never its conclusions. */
  about: string
  /** The one thing worth holding on to while reading it. */
  watchFor: string
}

/** A word looked up mid-sentence, explained for a non-native reader. */
export interface WordExplanation {
  /** Exactly what was clicked, so the popover can show it back. */
  word: string
  /** The dictionary form: "wolves" → "wolf". */
  lemma: string
  /** What it means *here* — other senses of the word are deliberately dropped. */
  meaning: string
  /** The surrounding clause, said again in plain English. */
  inSentence: string
  /** Something concrete to hang it on: a root, a relative, an image. */
  trick: string
  /** A few familiar neighbours, for building the word family out. */
  related: string[]
}

/** A word you kept, with the sentence you met it in. */
export interface SavedWord {
  id: string
  word: string
  lemma: string
  meaning: string
  trick: string
  related: string[]
  /** The sentence it came from — usually the thing that makes it stick. */
  sentence: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  createdAt: number
}

export interface Note {
  id: string
  bookId: string
  bookTitle: string
  chapterId: string
  chapterTitle: string
  summary: string
  score: number
  total: number
  createdAt: number
}

/** Whether the AI features have a key to work with, and where it came from. */
export interface AiKeyStatus {
  hasKey: boolean
  /** DEEPSEEK_API_KEY was set in the environment — it overrides the saved key. */
  fromEnv: boolean
}

/** The result of checking a key against DeepSeek, in words fit to show. */
export interface KeyTestResult {
  ok: boolean
  message: string
}

export type Theme = 'dark' | 'sepia' | 'light'
export type Granularity = 'sentence' | 'paragraph'

export interface Settings {
  theme: Theme
  fontFamily: string
  fontSize: number
  lineHeight: number
  columnWidth: number
  bionic: boolean
  bionicStrength: number
  focusDim: boolean
  dimOpacity: number
  granularity: Granularity
  /** Target words per minute — used only for the time-left estimate. */
  wpm: number
  /** DeepSeek key. Lives in userData, never in the repo. */
  apiKey: string
  /** Quiz + summary at the end of every section. */
  quizAfterSection: boolean
  /** Use DeepSeek's thinking mode for the questions: sharper, far slower. */
  quizThinking: boolean
  /** Two lines of orientation at the top of each new section. */
  sectionPreview: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  fontSize: 21,
  lineHeight: 1.75,
  columnWidth: 620,
  bionic: true,
  bionicStrength: 0.4,
  focusDim: true,
  dimOpacity: 0.22,
  granularity: 'sentence',
  wpm: 220,
  apiKey: '',
  quizAfterSection: true,
  quizThinking: true,
  sectionPreview: true
}
