export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'image'

/**
 * A picture lifted out of a book and kept beside it. The bytes live in the
 * app's own asset store rather than in the parsed JSON: a well illustrated
 * EPUB carries more image than text, and base64 in the cache would be read
 * back into memory in full every time the book is opened.
 */
export interface BookImage {
  /** `bookimg://<bookId>/<hash>.<ext>`, served from the asset store. */
  src: string
  /** Intrinsic size, so the page can hold the space before the file loads. */
  width: number
  height: number
  /** The book's own description of the picture, for screen readers. */
  alt: string
}

export interface Block {
  id: string
  type: BlockType
  text: string
  /** Set on `image` blocks, and on those only. */
  image?: BookImage
}

export interface Chapter {
  id: string
  title: string
  blocks: Block[]
}

/**
 * Bumped whenever a parser starts producing something it did not before, so
 * books already in the library are read again instead of being served from a
 * cache that predates the change.
 */
export const PARSE_VERSION = 3

/** A fully parsed book, cached to disk so re-opening is instant. */
export interface BookDoc {
  id: string
  title: string
  author: string
  chapters: Chapter[]
  /** The PARSE_VERSION this was parsed by; absent on caches written before it. */
  version?: number
}

export type BookFormat = 'epub' | 'pdf' | 'article'

/**
 * A shelf of one's own: books grouped by what they are for — a course, a
 * thesis chapter, a standing interest. A book sits on at most one, because
 * the question a subject answers is "what am I reading for this?", and an
 * answer that lists a book under four headings is no answer.
 */
export interface Subject {
  id: string
  name: string
  createdAt: number
}

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
  /**
   * The subject this book is filed under, `null` when it is unfiled. Absent
   * on entries written before subjects existed, and on a freshly imported
   * book — which is why `undefined` means "unchanged" rather than "unfile it".
   */
  subjectId?: string | null
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
  /** OPENROUTER_API_KEY was set in the environment — it overrides the saved key. */
  fromEnv: boolean
}

/** The result of checking a key against OpenRouter, in words fit to show. */
export interface KeyTestResult {
  ok: boolean
  message: string
}

/** One model OpenRouter offers, trimmed to what the picker shows. */
export interface AiModel {
  /** The id sent with a request: "anthropic/claude-sonnet-4", say. */
  id: string
  name: string
  /** Dollars per million tokens, in and out. 0 for free models, -1 when unknown. */
  promptPrice: number
  completionPrice: number
  /** Context window, in tokens. 0 when unknown. */
  context: number
  /** Takes a reasoning effort — the quiz can ask it to think. */
  reasoning: boolean
}

export type Theme = 'dark' | 'sepia' | 'light'
export type Granularity = 'sentence' | 'paragraph'

/**
 * How hard the model is asked to think before it writes the quiz — OpenRouter's
 * reasoning effort. `off` sends nothing and leaves the model to its defaults;
 * a model that cannot reason ignores the rest.
 */
export type Effort = 'off' | 'low' | 'medium' | 'high'

/**
 * How big a page is drawn, in the sense a PDF viewer means it: the page is
 * typeset once at its own size, and zoom only scales the picture of it. `page`
 * fits the whole sheet in the window, `width` fits its width, a number is a
 * percentage.
 */
export type Zoom = 'page' | 'width' | number

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
  /** OpenRouter key. Lives in userData, never in the repo. */
  apiKey: string
  /** The OpenRouter model id everything is asked of. */
  model: string
  /**
   * A model for the quiz alone, when the questions deserve a slower or
   * stronger one than the word lookups. Empty means the same as `model`.
   */
  quizModel: string
  /** How much reasoning the quiz is given. Lookups and previews stay quick. */
  quizEffort: Effort
  /** Quiz + summary at the end of every section. */
  quizAfterSection: boolean
  /** Two lines of orientation at the top of each new section. */
  sectionPreview: boolean
  /** How the sheets are scaled to the window. */
  zoom: Zoom
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
  model: 'openai/gpt-4o-mini',
  quizModel: '',
  quizEffort: 'medium',
  quizAfterSection: true,
  sectionPreview: true,
  zoom: 'page'
}
