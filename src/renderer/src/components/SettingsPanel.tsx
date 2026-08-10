import type { ReactNode } from 'react'
import type { Settings, Theme } from '../../../shared/types'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
  onClose: () => void
}

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

export function SettingsPanel({ settings, onChange, onClose }: Props): JSX.Element {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    onChange({ ...settings, [key]: value })

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

          <Row label={`Text size — ${settings.fontSize}px`} hint="+ / −">
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

          <Row label="DeepSeek API key" hint="stored on this machine only">
            <input
              type="password"
              value={settings.apiKey}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set('apiKey', e.target.value.trim())}
            />
          </Row>

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
                <kbd>[</kbd> <kbd>]</kbd> previous / next section
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
                <kbd>Esc</kbd> back to library
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </>
  )
}
