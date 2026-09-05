import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BookDoc,
  BookMeta,
  Note,
  Progress,
  SavedWord,
  Settings,
  Subject,
  Thought
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

const dataDir = (): string => app.getPath('userData')
const cacheDir = (): string => path.join(dataDir(), 'parsed')
const assetDir = (bookId: string): string => path.join(dataDir(), 'assets', bookId)

/** The file extension to keep a picture under, from what the source called it. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff'
}

export const ASSET_MEDIA_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_EXTENSIONS).map(([type, ext]) => [ext, type])
)

/** Book ids are hex digests and file names are `<hash>.<ext>` — anything else is not ours. */
const SAFE_ID = /^[a-f0-9]{1,64}$/
const SAFE_ASSET = /^[a-f0-9]{1,64}\.[a-z0-9]{1,8}$/

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(dataDir(), file), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true })
  const target = path.join(dataDir(), file)
  // Write to a temp file first so a crash mid-write can't corrupt the store.
  // The temp name is unique per write: two writers sharing one temp path can
  // interleave and rename a half-written file into place.
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, target)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

/**
 * Read-modify-write is not atomic on its own: two overlapping updates would
 * both read the same starting state and the later write would drop the
 * earlier one's changes. Updates to a given file are queued instead.
 */
const queues = new Map<string, Promise<unknown>>()

function update<T, R>(file: string, fallback: T, mutate: (current: T) => [T, R]): Promise<R> {
  const run = async (): Promise<R> => {
    const current = await readJson<T>(file, fallback)
    const [next, result] = mutate(current)
    await writeJson(file, next)
    return result
  }

  const chained = (queues.get(file) ?? Promise.resolve()).then(run, run)
  // Keep the chain alive even if one update fails.
  queues.set(
    file,
    chained.catch(() => undefined)
  )
  return chained
}

export const store = {
  async getLibrary(): Promise<BookMeta[]> {
    return readJson<BookMeta[]>('library.json', [])
  },

  async upsertBook(meta: BookMeta): Promise<BookMeta[]> {
    return update<BookMeta[], BookMeta[]>('library.json', [], (library) => {
      // Re-adding a book that is already filed must not take it off its shelf.
      // An import builds its meta from the file and knows nothing about
      // subjects, so an absent one means "leave it where it was" — only an
      // explicit null unfiles a book.
      const existing = library.find((b) => b.id === meta.id)
      const subjectId = meta.subjectId === undefined ? (existing?.subjectId ?? null) : meta.subjectId

      const next = library.filter((b) => b.id !== meta.id)
      next.unshift({ ...meta, subjectId })
      return [next, next]
    })
  },

  async removeBook(id: string): Promise<BookMeta[]> {
    const library = await update<BookMeta[], BookMeta[]>('library.json', [], (current) => {
      const next = current.filter((b) => b.id !== id)
      return [next, next]
    })

    await update<Record<string, Progress>, void>('progress.json', {}, (all) => {
      delete all[id]
      return [all, undefined]
    })

    await fs.rm(path.join(cacheDir(), `${id}.json`), { force: true })
    await fs.rm(assetDir(id), { force: true, recursive: true })
    return library
  },

  async getSubjects(): Promise<Subject[]> {
    return readJson<Subject[]>('subjects.json', [])
  },

  /**
   * Naming a subject that already exists hands back the one that is there:
   * typing "Statistics" a second time should file the book, not leave two
   * shelves of the same name to drift apart.
   */
  async addSubject(name: string): Promise<{ subjects: Subject[]; subject: Subject }> {
    const clean = name.trim().slice(0, 60)
    if (clean === '') throw new Error('A subject needs a name.')

    return update<Subject[], { subjects: Subject[]; subject: Subject }>(
      'subjects.json',
      [],
      (subjects) => {
        const existing = subjects.find((s) => s.name.toLowerCase() === clean.toLowerCase())
        if (existing) return [subjects, { subjects, subject: existing }]

        const subject: Subject = {
          id: randomBytes(8).toString('hex'),
          name: clean,
          createdAt: Date.now()
        }
        const next = [...subjects, subject]
        return [next, { subjects: next, subject }]
      }
    )
  },

  async renameSubject(id: string, name: string): Promise<Subject[]> {
    const clean = name.trim().slice(0, 60)
    if (clean === '') throw new Error('A subject needs a name.')

    return update<Subject[], Subject[]>('subjects.json', [], (subjects) => {
      const next = subjects.map((s) => (s.id === id ? { ...s, name: clean } : s))
      return [next, next]
    })
  },

  /**
   * Dropping a subject unfiles the books that were on it. Deleting the shelf
   * is not a reason to delete what was standing on it, and a course you have
   * finished is exactly when you want the shelf gone and the books kept.
   */
  async removeSubject(id: string): Promise<{ subjects: Subject[]; library: BookMeta[] }> {
    const subjects = await update<Subject[], Subject[]>('subjects.json', [], (current) => {
      const next = current.filter((s) => s.id !== id)
      return [next, next]
    })

    const library = await update<BookMeta[], BookMeta[]>('library.json', [], (current) => {
      const next = current.map((b) => (b.subjectId === id ? { ...b, subjectId: null } : b))
      return [next, next]
    })

    return { subjects, library }
  },

  async setBookSubject(bookId: string, subjectId: string | null): Promise<BookMeta[]> {
    return update<BookMeta[], BookMeta[]>('library.json', [], (library) => {
      const next = library.map((b) => (b.id === bookId ? { ...b, subjectId } : b))
      return [next, next]
    })
  },

  async getProgress(id: string): Promise<Progress | null> {
    const all = await readJson<Record<string, Progress>>('progress.json', {})
    return all[id] ?? null
  },

  async getAllProgress(): Promise<Record<string, Progress>> {
    return readJson<Record<string, Progress>>('progress.json', {})
  },

  async saveProgress(id: string, progress: Progress): Promise<void> {
    await update<Record<string, Progress>, void>('progress.json', {}, (all) => {
      all[id] = progress
      return [all, undefined]
    })
  },

  async getThoughts(): Promise<Thought[]> {
    return readJson<Thought[]>('thoughts.json', [])
  },

  async saveThoughts(thoughts: Thought[]): Promise<void> {
    await update<Thought[], void>('thoughts.json', [], () => [thoughts, undefined])
  },

  async getNotes(): Promise<Note[]> {
    return readJson<Note[]>('notes.json', [])
  },

  async addNote(note: Note): Promise<Note[]> {
    return update<Note[], Note[]>('notes.json', [], (notes) => {
      const next = [note, ...notes]
      return [next, next]
    })
  },

  async deleteNote(id: string): Promise<Note[]> {
    return update<Note[], Note[]>('notes.json', [], (notes) => {
      const next = notes.filter((n) => n.id !== id)
      return [next, next]
    })
  },

  async getWords(): Promise<SavedWord[]> {
    return readJson<SavedWord[]>('words.json', [])
  },

  /**
   * Meeting a word again in a different sentence is worth its own entry — that
   * second sense is usually the one that was confusing. Saving the *same*
   * encounter twice is not.
   */
  async addWord(word: SavedWord): Promise<SavedWord[]> {
    const same = (a: SavedWord, b: SavedWord): boolean =>
      a.lemma.toLowerCase() === b.lemma.toLowerCase() && a.sentence === b.sentence

    return update<SavedWord[], SavedWord[]>('words.json', [], (words) => {
      const next = [word, ...words.filter((w) => !same(w, word))]
      return [next, next]
    })
  },

  async deleteWord(id: string): Promise<SavedWord[]> {
    return update<SavedWord[], SavedWord[]>('words.json', [], (words) => {
      const next = words.filter((w) => w.id !== id)
      return [next, next]
    })
  },

  async getSettings(): Promise<Settings> {
    const saved = await readJson<Partial<Settings>>('settings.json', {})
    return { ...DEFAULT_SETTINGS, ...saved }
  },

  async saveSettings(settings: Settings): Promise<void> {
    await update<Settings, void>('settings.json', DEFAULT_SETTINGS, () => [settings, undefined])
  },

  /**
   * Keep a picture beside the book it came from. The name is the hash of the
   * bytes, so a decoration repeated on forty pages is stored once and a
   * re-import overwrites rather than accumulates.
   */
  async writeAsset(bookId: string, data: Uint8Array, mediaType: string): Promise<string> {
    if (!SAFE_ID.test(bookId)) throw new Error('Bad book id.')

    const ext = IMAGE_EXTENSIONS[mediaType.toLowerCase()] ?? 'bin'
    const name = `${createHash('sha1').update(data).digest('hex').slice(0, 32)}.${ext}`
    const dir = assetDir(bookId)

    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, name)
    // Same name means same bytes; writing it again would only cost the disk.
    try {
      await fs.access(target)
    } catch {
      await fs.writeFile(target, data)
    }

    return `bookimg://${bookId}/${name}`
  },

  /** Resolve a `bookimg://` request to a file, or null if it points outside the store. */
  assetPath(bookId: string, name: string): string | null {
    if (!SAFE_ID.test(bookId) || !SAFE_ASSET.test(name)) return null
    const dir = assetDir(bookId)
    const target = path.resolve(dir, name)
    return target.startsWith(`${dir}${path.sep}`) ? target : null
  },

  async readParsed(id: string): Promise<BookDoc | null> {
    try {
      const raw = await fs.readFile(path.join(cacheDir(), `${id}.json`), 'utf-8')
      return JSON.parse(raw) as BookDoc
    } catch {
      return null
    }
  },

  async writeParsed(doc: BookDoc): Promise<void> {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(path.join(cacheDir(), `${doc.id}.json`), JSON.stringify(doc), 'utf-8')
  }
}
