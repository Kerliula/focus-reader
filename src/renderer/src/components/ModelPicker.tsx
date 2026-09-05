import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiModel } from '../../../shared/types'

interface Props {
  value: string
  onChange: (id: string) => void
  /** The catalogue, or null while it is still on its way (or failed to come). */
  models: AiModel[] | null
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement>
}

/** Enough to choose from without turning the drawer into the whole catalogue. */
const MAX_SHOWN = 14

function price(model: AiModel): string {
  if (model.promptPrice < 0 || model.completionPrice < 0) return ''
  if (model.promptPrice === 0 && model.completionPrice === 0) return 'free'
  const fmt = (n: number): string => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3))
  return `$${fmt(model.promptPrice)} in · $${fmt(model.completionPrice)} out /M`
}

/**
 * A box for a model id that also knows the catalogue. Type and the list
 * narrows to what matches, by name or id, with the price beside each; pick
 * one, or type an id the list has never heard of and it is used as written.
 * The value is always the id — what actually goes on the wire — so there is
 * never a gap between what is shown and what is asked.
 */
export function ModelPicker({ value, onChange, models, placeholder, inputRef }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  /** What has been typed since the box was focused; null shows the value itself. */
  const [query, setQuery] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const shown = query ?? value
  const matches = useMemo(() => {
    if (!models) return []
    const needle = (query ?? '').trim().toLowerCase()
    const pool = needle === ''
      ? models
      : models.filter(
          (m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)
        )
    return pool.slice(0, MAX_SHOWN)
  }, [models, query])

  const pick = (id: string): void => {
    onChange(id)
    setQuery(null)
    setOpen(false)
  }

  const current = models?.find((m) => m.id === value)

  return (
    <div className="model-picker" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        value={shown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          // Typing is choosing: an id nobody listed still counts.
          onChange(e.target.value.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery(null)
            setOpen(false)
            e.currentTarget.blur()
          }
          if (e.key === 'Enter') {
            if (matches.length > 0 && query !== null) pick(matches[0].id)
            else {
              setOpen(false)
              setQuery(null)
            }
          }
        }}
      />
      {current && !open && (
        <span className="model-picker-current muted">
          {current.name}
          {price(current) !== '' ? ` · ${price(current)}` : ''}
        </span>
      )}

      {open && (
        <ul className="model-picker-list">
          {models === null ? (
            <li className="model-picker-note muted">Fetching the list from OpenRouter…</li>
          ) : matches.length === 0 ? (
            <li className="model-picker-note muted">
              Nothing by that name. The id will be used as typed.
            </li>
          ) : (
            matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={m.id === value ? 'on' : ''}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m.id)}
                >
                  <span className="model-picker-name">{m.name}</span>
                  <span className="model-picker-meta muted">
                    {m.id}
                    {price(m) !== '' ? ` · ${price(m)}` : ''}
                    {m.reasoning ? ' · thinks' : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
