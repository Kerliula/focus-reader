import { useEffect, useRef, useState } from 'react'

interface Props {
  onSave: (text: string) => void
  onCancel: () => void
}

/**
 * The intrusive-thought catcher: dump whatever pulled you away, get straight
 * back to the page. Deliberately one field and two keys.
 */
export function ParkPrompt({ onSave, onCancel }: Props): JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed !== '') onSave(trimmed)
    else onCancel()
  }

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="park">
        <label htmlFor="park-input">Park it — you can come back to this later</label>
        <input
          id="park-input"
          ref={inputRef}
          value={text}
          placeholder="the thing you suddenly need to do…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        <div className="park-hint">
          <kbd>Enter</kbd> to save · <kbd>Esc</kbd> to drop it
        </div>
      </div>
    </>
  )
}
