import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiKeyStatus,
  BookDoc,
  BookMeta,
  KeyTestResult,
  Note,
  Progress,
  QuizQuestion,
  SavedWord,
  SectionPreview,
  Settings,
  Subject,
  Thought,
  WordExplanation
} from '../shared/types'

const api = {
  openBooks: (): Promise<{ path: string; format: 'epub' | 'pdf'; id: string }[]> =>
    ipcRenderer.invoke('dialog:openBooks'),
  readFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('file:read', path),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('file:exists', path),
  idFor: (path: string): Promise<string> => ipcRenderer.invoke('book:idFor', path),
  formatFor: (path: string): Promise<'epub' | 'pdf' | null> =>
    ipcRenderer.invoke('book:formatFor', path),
  /** Download a page as text. The renderer never loads or runs it. */
  fetchArticle: (url: string): Promise<{ html: string; url: string }> =>
    ipcRenderer.invoke('article:fetch', url),
  /** Download one of an article's illustrations. Null when it can't be had. */
  fetchImage: (
    url: string,
    referrer: string
  ): Promise<{ data: Uint8Array; mediaType: string } | null> =>
    ipcRenderer.invoke('image:fetch', url, referrer),
  /** Keep a picture beside its book; returns the `bookimg://` address to show it at. */
  saveAsset: (bookId: string, data: Uint8Array, mediaType: string): Promise<string> =>
    ipcRenderer.invoke('asset:save', bookId, data, mediaType),

  /** Resolve a dropped File back to its absolute path. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  getLibrary: (): Promise<BookMeta[]> => ipcRenderer.invoke('library:get'),
  upsertBook: (meta: BookMeta): Promise<BookMeta[]> => ipcRenderer.invoke('library:upsert', meta),
  removeBook: (id: string): Promise<BookMeta[]> => ipcRenderer.invoke('library:remove', id),
  /** File a book under a subject, or `null` to take it off the shelf it is on. */
  setBookSubject: (bookId: string, subjectId: string | null): Promise<BookMeta[]> =>
    ipcRenderer.invoke('library:setSubject', bookId, subjectId),

  getSubjects: (): Promise<Subject[]> => ipcRenderer.invoke('subjects:get'),
  /** Returns the subject as well as the list — a name already taken gives back that one. */
  addSubject: (name: string): Promise<{ subjects: Subject[]; subject: Subject }> =>
    ipcRenderer.invoke('subjects:add', name),
  renameSubject: (id: string, name: string): Promise<Subject[]> =>
    ipcRenderer.invoke('subjects:rename', id, name),
  /** Drops the shelf and unfiles its books; nothing is deleted. */
  removeSubject: (id: string): Promise<{ subjects: Subject[]; library: BookMeta[] }> =>
    ipcRenderer.invoke('subjects:remove', id),

  getProgress: (id: string): Promise<Progress | null> => ipcRenderer.invoke('progress:get', id),
  getAllProgress: (): Promise<Record<string, Progress>> => ipcRenderer.invoke('progress:getAll'),
  saveProgress: (id: string, p: Progress): Promise<void> =>
    ipcRenderer.invoke('progress:save', id, p),

  getThoughts: (): Promise<Thought[]> => ipcRenderer.invoke('thoughts:get'),
  saveThoughts: (thoughts: Thought[]): Promise<void> =>
    ipcRenderer.invoke('thoughts:save', thoughts),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: Settings): Promise<void> => ipcRenderer.invoke('settings:save', s),

  getNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:get'),
  addNote: (note: Note): Promise<Note[]> => ipcRenderer.invoke('notes:add', note),
  deleteNote: (id: string): Promise<Note[]> => ipcRenderer.invoke('notes:delete', id),

  getWords: (): Promise<SavedWord[]> => ipcRenderer.invoke('words:get'),
  addWord: (word: SavedWord): Promise<SavedWord[]> => ipcRenderer.invoke('words:add', word),
  deleteWord: (id: string): Promise<SavedWord[]> => ipcRenderer.invoke('words:delete', id),

  aiAvailable: (): Promise<boolean> => ipcRenderer.invoke('ai:available'),
  aiKeyStatus: (): Promise<AiKeyStatus> => ipcRenderer.invoke('ai:keyStatus'),
  /** Check a key against DeepSeek. Omit it to check the one already in use. */
  testApiKey: (candidate?: string): Promise<KeyTestResult> =>
    ipcRenderer.invoke('ai:testKey', candidate),
  makeQuiz: (title: string, text: string): Promise<QuizQuestion[]> =>
    ipcRenderer.invoke('ai:quiz', title, text),
  /** Start building this section's quiz now, so it's ready at the end of it. */
  prefetchQuiz: (title: string, text: string): Promise<void> =>
    ipcRenderer.invoke('ai:prefetchQuiz', title, text),

  makePreview: (title: string, text: string): Promise<SectionPreview> =>
    ipcRenderer.invoke('ai:preview', title, text),
  /** Build the next section's preview while the current one is still being read. */
  prefetchPreview: (title: string, text: string): Promise<void> =>
    ipcRenderer.invoke('ai:prefetchPreview', title, text),
  explainWord: (word: string, sentence: string): Promise<WordExplanation> =>
    ipcRenderer.invoke('ai:explainWord', word, sentence),

  getParsed: (id: string): Promise<BookDoc | null> => ipcRenderer.invoke('parsed:get', id),
  saveParsed: (doc: BookDoc): Promise<void> => ipcRenderer.invoke('parsed:save', doc)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
