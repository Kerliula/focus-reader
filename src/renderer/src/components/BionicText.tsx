import { Fragment, memo } from 'react'

interface Props {
  text: string
  enabled: boolean
  strength: number
}

// Hoisted: these were rebuilt for every word of every unit on every keystroke.
const WHITESPACE = /(\s+)/
const WORD_SHAPE = /^([^\p{L}\p{N}]*)([\p{L}\p{N}'’-]+)(.*)$/u

/**
 * Bolds the leading letters of each word so the eye has a fixation point to
 * jump to, instead of re-scanning the line.
 */
export const BionicText = memo(function BionicText({
  text,
  enabled,
  strength
}: Props): JSX.Element {
  if (!enabled) return <>{text}</>

  const tokens = text.split(WHITESPACE)

  return (
    <>
      {tokens.map((token, i) => {
        if (token.trim() === '') return <Fragment key={i}>{token}</Fragment>

        const match = token.match(WORD_SHAPE)
        if (!match) return <Fragment key={i}>{token}</Fragment>

        const [, lead, word, tail] = match
        const max = word.length <= 3 ? 1 : word.length - 1
        const boldLength = Math.min(max, Math.max(1, Math.round(word.length * strength)))

        return (
          <Fragment key={i}>
            {lead}
            <b className="bionic">{word.slice(0, boldLength)}</b>
            {word.slice(boldLength)}
            {tail}
          </Fragment>
        )
      })}
    </>
  )
})
