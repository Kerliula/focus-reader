import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AiKeyStatus, KeyTestResult, Settings, Theme } from '../../../shared/types'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
  onClose: () => void
  /** Open the panel with the key box focused — how the library's prompt gets here. */
  focusApiKey?: boolean
}

const KEY_PAGE = 'https://platform.deepseek.com/api_keys'

const FONTS: { label: string; value: string }[] = [
  { label: 'Serif (Georgia)', value: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
  { label: 'Sans (system)', value: '-apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Rounded', value: '"SF Pro Rounded", "Avenir Next", Verdana, sans-serif' },
  { label: 'Monospace', value: '"SF Mono", Menlo, Consolas, monospace' },
  { label: 'OpenDyslexic (if installed)', value: '"OpenDyslexic", "Comic Sans MS", sans-serif' }
]

const THEMES: Theme[] = ['dark', 'sepia', 'light']

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="setting-row">
      <span className="setting-label">
        {label}
        {hint ? <em className="setting-hint">{hint}</em> : null}
      </span>
      {children}
    </label>
  )
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  focusApiKey = false
}: Props): JSX.Element {
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState<AiKeyStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<KeyTestResult | null>(null)
  const keyInput = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    onChange({ ...settings, [key]: value })

  // Only the environment half of this can change behind the panel's back; the
  // saved key is whatever is in the box.
  useEffect(() => {
    void window.api.aiKeyStatus().then(setStatus)
  }, [])

  // Arriving from "add a key" should land the cursor in the box, not leave the
  // reader hunting for it down the panel.
  useEffect(() => {
    if (!focusApiKey) return
    const input = keyInput.current
    input?.scrollIntoView({ block: 'center' })
    input?.focus()
  }, [focusApiKey])

  // A verdict on the old key says nothing about the one being typed now.
  useEffect(() => setResult(null), [settings.apiKey])

  // Escape closes the drawer from wherever it was opened.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const check = async (): Promise<void> => {
    setTesting(true)
    // The typed key hasn't been saved yet — check exactly what's in the box.
    const typed = settings.apiKey.trim()
    try {
      setResult(await window.api.testApiKey(typed === '' ? undefined : typed))
    } finally {
      setTesting(false)
    }
  }

  const statusLine = status?.fromEnv
    ? 'Using DEEPSEEK_API_KEY from your environment — it overrides anything typed here.'
    : settings.apiKey.trim() !== ''
      ? 'Saved. Check it here if lookups aren’t coming back.'
      : 'No key yet — lookups, previews and quizzes stay off until there is one.'

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Reading setup</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <Row label="Theme">
            <div className="segmented">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  className={settings.theme === theme ? 'seg on' : 'seg'}
                  onClick={() => set('theme', theme)}
                >
                  {theme}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Font">
            <select value={settings.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>
              {FONTS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label={`Text size — ${settings.fontSize}px`} hint="how much fits on a page">
            <input
              type="range"
              min={14}
              max={34}
              value={settings.fontSize}
              onChange={(e) => set('fontSize', Number(e.target.value))}
            />
          </Row>

          <Row label={`Line spacing — ${settings.lineHeight.toFixed(2)}`}>
            <input
              type="range"
              min={1.3}
              max={2.4}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => set('lineHeight', Number(e.target.value))}
            />
          </Row>

          <Row label={`Column width — ${settings.columnWidth}px`} hint="narrow is easier">
            <input
              type="range"
              min={380}
              max={900}
              step={10}
              value={settings.columnWidth}
              onChange={(e) => set('columnWidth', Number(e.target.value))}
            />
          </Row>

          <hr />

          <Row label="Spotlight focus" hint="D">
            <input
              type="checkbox"
              checked={settings.focusDim}
              onChange={(e) => set('focusDim', e.target.checked)}
            />
          </Row>

          <Row label={`Dim level — ${Math.round(settings.dimOpacity * 100)}%`}>
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.01}
              value={settings.dimOpacity}
              onChange={(e) => set('dimOpacity', Number(e.target.value))}
            />
          </Row>

          <Row label="Spotlight unit" hint="G">
            <div className="segmented">
              <button
                className={settings.granularity === 'sentence' ? 'seg on' : 'seg'}
                onClick={() => set('granularity', 'sentence')}
              >
                sentence
              </button>
              <button
                className={settings.granularity === 'paragraph' ? 'seg on' : 'seg'}
                onClick={() => set('granularity', 'paragraph')}
              >
                paragraph
              </button>
            </div>
          </Row>

          <hr />

          <Row label="Bionic bolding" hint="B">
            <input
              type="checkbox"
              checked={settings.bionic}
              onChange={(e) => set('bionic', e.target.checked)}
            />
          </Row>

          <Row label={`Bold amount — ${Math.round(settings.bionicStrength * 100)}%`}>
            <input
              type="range"
              min={0.2}
              max={0.7}
              step={0.05}
              value={settings.bionicStrength}
              onChange={(e) => set('bionicStrength', Number(e.target.value))}
            />
          </Row>

          <hr />

          <Row label={`Your reading pace — ${settings.wpm} wpm`} hint="sets the time estimate">
            <input
              type="range"
              min={100}
              max={500}
              step={10}
              value={settings.wpm}
              onChange={(e) => set('wpm', Number(e.target.value))}
            />
          </Row>

          <hr />

          <h3 className="setting-section">Word lookups, previews and quizzes</h3>
          <p className="setting-note">
            These three ask DeepSeek, so they need a key of your own. Everything else in
            Focus Reader works without one. Get a key at{' '}
            <a href={KEY_PAGE} target="_blank" rel="noreferrer">
              platform.deepseek.com
            </a>
            , then paste it below.
          </p>

          <Row label="DeepSeek API key" hint="stays on this machine">
            <div className="key-input">
              <input
                ref={keyInput}
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set('apiKey', e.target.value.trim())}
              />
              <button
                type="button"
                className="ghost tiny"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? 'Hide the key' : 'Show the key'}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Row>

          <div className="key-status">
            <button
              type="button"
              className="ghost boxed"
              disabled={testing || (settings.apiKey.trim() === '' && !status?.fromEnv)}
              onClick={() => void check()}
            >
              {testing ? 'Checking…' : 'Check key'}
            </button>
            <span className={result?.ok === false ? 'key-msg bad' : 'key-msg'}>
              {testing ? '' : (result?.message ?? statusLine)}
            </span>
          </div>

          <Row
            label="Two lines before each section"
            hint="where it's going — never how it ends"
          >
            <input
              type="checkbox"
              checked={settings.sectionPreview}
              onChange={(e) => set('sectionPreview', e.target.checked)}
            />
          </Row>

          <Row label="Quiz me at the end of each section" hint="then write it down">
            <input
              type="checkbox"
              checked={settings.quizAfterSection}
              onChange={(e) => set('quizAfterSection', e.target.checked)}
            />
          </Row>

          {settings.quizAfterSection && (
            <Row
              label="Think harder about the questions"
              hint="sharper, but ~90s instead of ~12s — usually ready before you finish the section"
            >
              <input
                type="checkbox"
                checked={settings.quizThinking}
                onChange={(e) => set('quizThinking', e.target.checked)}
              />
            </Row>
          )}

          <div className="shortcuts">
            <h3>Keys</h3>
            <ul>
              <li>
                <kbd>Space</kbd> / <kbd>→</kbd> next · <kbd>←</kbd> back
              </li>
              <li>
                <kbd>PgDn</kbd> / <kbd>PgUp</kbd> turn the page · <kbd>[</kbd> <kbd>]</kbd> previous /
                next section
              </li>
              <li>
                <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>0</kbd> fit the page · <kbd>F</kbd> fit the
                width
              </li>
              <li>
                <kbd>B</kbd> bionic · <kbd>D</kbd> dim · <kbd>G</kbd> unit size
              </li>
              <li>
                <kbd>⌘K</kbd> park a thought · <kbd>T</kbd> sections · <kbd>N</kbd> notes
              </li>
              <li>
                <kbd>W</kbd> the words you've saved
              </li>
              <li>
                <strong>Double-click any word</strong> for a plain-English explanation, then
                Save to keep it
              </li>
              <li>
                <kbd>,</kbd> this panel · <kbd>Esc</kbd> back to library
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </>
  )
}
