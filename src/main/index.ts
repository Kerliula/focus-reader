import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { store } from './store'
import type {
  BookDoc,
  BookMeta,
  Note,
  Progress,
  SavedWord,
  Settings,
  Thought
} from '../shared/types'
import {
  aiAvailable,
  aiKeyStatus,
  explainWord,
  makePreview,
  makeQuiz,
  prefetchPreview,
  prefetchQuiz,
  testKey
} from './ai'

const isDev = !app.isPackaged

function bookIdFor(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16)
}

function formatFor(filePath: string): 'epub' | 'pdf' | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.epub') return 'epub'
  if (ext === '.pdf') return 'pdf'
  return null
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 840,
    minWidth: 620,
    minHeight: 480,
    show: false,
    backgroundColor: '#15120e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  ipcMain.handle('dialog:openBooks', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add books',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Books', extensions: ['epub', 'pdf'] }]
    })
    if (result.canceled) return []
    return result.filePaths
      .map((filePath) => {
        const format = formatFor(filePath)
        return format ? { path: filePath, format, id: bookIdFor(filePath) } : null
      })
      .filter((v): v is { path: string; format: 'epub' | 'pdf'; id: string } => v !== null)
  })

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const buf = await fs.readFile(filePath)
    // Returned as a Uint8Array to the renderer.
    return new Uint8Array(buf)
  })

  ipcMain.handle('file:exists', async (_e, filePath: string) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // Fetching happens here rather than in the renderer: the renderer is a
  // file:// document with no business making cross-origin requests, and the
  // page is only ever read as text — never loaded, never executed.
  ipcMain.handle('article:fetch', async (_e, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`${url} is not a valid address.`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https addresses can be read.')
    }

    const response = await net.fetch(parsed.toString(), {
      headers: {
        // Some publishers serve a stub to clients they don't recognise.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    if (!response.ok) {
      throw new Error(`That page could not be read (${response.status} ${response.statusText}).`)
    }

    const type = response.headers.get('content-type') ?? ''
    if (type !== '' && !/html|xml|text\/plain/i.test(type)) {
      throw new Error(`That address is ${type.split(';')[0]}, not a web page.`)
    }

    return { html: await response.text(), url: response.url || parsed.toString() }
  })

  ipcMain.handle('book:idFor', (_e, filePath: string) => bookIdFor(filePath))
  ipcMain.handle('book:formatFor', (_e, filePath: string) => formatFor(filePath))

  ipcMain.handle('library:get', () => store.getLibrary())
  ipcMain.handle('library:upsert', (_e, meta: BookMeta) => store.upsertBook(meta))
  ipcMain.handle('library:remove', (_e, id: string) => store.removeBook(id))

  ipcMain.handle('progress:get', (_e, id: string) => store.getProgress(id))
  ipcMain.handle('progress:getAll', () => store.getAllProgress())
  ipcMain.handle('progress:save', (_e, id: string, p: Progress) => store.saveProgress(id, p))

  ipcMain.handle('thoughts:get', () => store.getThoughts())
  ipcMain.handle('thoughts:save', (_e, thoughts: Thought[]) => store.saveThoughts(thoughts))

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', (_e, s: Settings) => store.saveSettings(s))

  ipcMain.handle('notes:get', () => store.getNotes())
  ipcMain.handle('notes:add', (_e, note: Note) => store.addNote(note))
  ipcMain.handle('notes:delete', (_e, id: string) => store.deleteNote(id))

  ipcMain.handle('words:get', () => store.getWords())
  ipcMain.handle('words:add', (_e, word: SavedWord) => store.addWord(word))
  ipcMain.handle('words:delete', (_e, id: string) => store.deleteWord(id))

  // The API key stays in the main process; the renderer only ever sees results.
  // The model is only ever given a section's text to write questions from — it
  // never decides what you read.
  ipcMain.handle('ai:available', () => aiAvailable())
  ipcMain.handle('ai:keyStatus', () => aiKeyStatus())
  // The key itself never comes back out — only whether DeepSeek accepted it.
  ipcMain.handle('ai:testKey', (_e, candidate?: string) => testKey(candidate))
  ipcMain.handle('ai:quiz', (_e, title: string, text: string) => makeQuiz(title, text))
  // Returns at once: the generation carries on in the background.
  ipcMain.handle('ai:prefetchQuiz', (_e, title: string, text: string) => {
    prefetchQuiz(title, text)
  })

  ipcMain.handle('ai:preview', (_e, title: string, text: string) => makePreview(title, text))
  ipcMain.handle('ai:prefetchPreview', (_e, title: string, text: string) => {
    prefetchPreview(title, text)
  })
  ipcMain.handle('ai:explainWord', (_e, word: string, sentence: string) =>
    explainWord(word, sentence)
  )

  ipcMain.handle('parsed:get', (_e, id: string) => store.readParsed(id))
  ipcMain.handle('parsed:save', (_e, doc: BookDoc) => store.writeParsed(doc))
}
