import { useEffect, useRef, useState } from 'react'
import type { QuizKind, QuizQuestion } from '../../../shared/types'

/** Saying what a question is after makes it clear this isn't a memory test. */
const KIND_LABEL: Record<QuizKind, string> = {
  says: 'what it said',
  means: 'what it means',
  implies: 'what follows from it',
  applies: 'using it somewhere new',
  limits: 'what it doesn’t show'
}

interface Props {
  chapterTitle: string
  text: string
  /** Below this share of correct answers the summary isn't worth keeping. */
  passMark?: number
  onDone: (result: { summary: string; score: number; total: number } | null) => void
  onReread: () => void
}

type Stage = 'loading' | 'error' | 'asking' | 'scored' | 'summary' | 'lowScore'

const PASS_MARK = 0.6

export function SectionQuiz({
  chapterTitle,
  text,
  passMark = PASS_MARK,
  onDone,
  onReread
}: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [current, setCurrent] = useState(0)
  const [picked, setPicked] = useState<number[]>([])
  const [summary, setSummary] = useState('')
  const summaryRef = useRef<HTMLTextAreaElement | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStage('loading')

    void (async () => {
      try {
        // Truncation happens in main, so the key matches whatever was prefetched.
        const made = await window.api.makeQuiz(chapterTitle, text)
        if (cancelled) return
        if (made.length === 0) throw new Error('No questions came back.')
        setQuestions(made)
        setPicked([])
        setCurrent(0)
        setStage('asking')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStage('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [chapterTitle, text, attempt])

  useEffect(() => {
    if (stage === 'summary') summaryRef.current?.focus()
  }, [stage])

  /**
   * Escape is held back from the quiz everywhere else, so that a section's
   * check can't be dismissed by a stray keypress. While the questions are
   * still being written there is nothing to dismiss by accident and nothing to
   * lose — and in thinking mode that wait runs past a minute. Waiting on a
   * model is not the reading, and it should never be the thing that stops you.
   */
  useEffect(() => {
    if (stage !== 'loading') return
    const listener = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onDone(null)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [stage, onDone])

  const score = picked.reduce((sum, choice, i) => sum + (choice === questions[i]?.answer ? 1 : 0), 0)
  const passed = questions.length > 0 && score / questions.length >= passMark

  const choose = (index: number): void => {
    const next = [...picked]
    next[current] = index
    setPicked(next)

    if (current < questions.length - 1) setCurrent(current + 1)
    else setStage('scored')
  }

  const submitSummary = (): void => {
    const trimmed = summary.trim()
    if (trimmed.length < 15) return
    if (passed) onDone({ summary: trimmed, score, total: questions.length })
    else setStage('lowScore')
  }

  if (stage === 'loading') {
    return (
      <>
        <div className="scrim solid" />
        <div className="quiz">
          <span className="quiz-kicker">{chapterTitle}</span>
          <p className="muted">
            Working through what you just read, then writing six questions on it…
          </p>
          <div className="quiz-spinner" />
          <button className="ghost tiny quiz-skip-waiting" onClick={() => onDone(null)}>
            skip the quiz <span className="quiz-hint">Esc</span>
          </button>
        </div>
      </>
    )
  }

  if (stage === 'error') {
    return (
      <>
        <div className="scrim solid" />
        <div className="quiz">
          <span className="quiz-kicker">Couldn’t build a quiz</span>
          <p className="muted">{error}</p>
          <div className="quiz-actions">
            <button className="primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
            <button className="ghost boxed" onClick={() => onDone(null)}>
              Skip and carry on
            </button>
          </div>
        </div>
      </>
    )
  }

  if (stage === 'asking') {
    const question = questions[current]
    return (
      <>
        <div className="scrim solid" />
        <div className="quiz">
          <span className="quiz-kicker">
            Question {current + 1} of {questions.length}
            <span className="quiz-kind">{KIND_LABEL[question.kind]}</span>
          </span>
          <h2 className="quiz-question">{question.question}</h2>
          <ul className="quiz-options">
            {question.options.map((option, i) => (
              <li key={i}>
                <button onClick={() => choose(i)}>
                  <span className="quiz-key">{String.fromCharCode(65 + i)}</span>
                  {option}
                </button>
              </li>
            ))}
          </ul>
          <button className="ghost tiny" onClick={() => onDone(null)}>
            skip the quiz
          </button>
        </div>
      </>
    )
  }

  if (stage === 'scored') {
    return (
      <>
        <div className="scrim solid" />
        <div className="quiz wide">
          <span className="quiz-kicker">{chapterTitle}</span>
          <div className={`quiz-score${passed ? ' pass' : ''}`}>
            {score} / {questions.length}
          </div>
          <ul className="quiz-review">
            {questions.map((question, i) => {
              const choice = picked[i]
              const right = choice === question.answer
              const misread = choice === undefined ? '' : (question.whyWrong[choice] ?? '')

              return (
                <li key={i} className={right ? 'right' : 'wrong'}>
                  <span className="quiz-review-mark">{right ? '✓' : '✕'}</span>
                  <div>
                    <span className="quiz-kind">{KIND_LABEL[question.kind]}</span>
                    <p className="quiz-review-q">{question.question}</p>

                    {!right && (
                      <>
                        {/* Naming the misreading is the part worth reading. */}
                        {misread !== '' && (
                          <p className="quiz-review-misread">
                            <span className="quiz-review-label">you picked</span>
                            {misread}
                          </p>
                        )}
                        <p className="muted">
                          <span className="quiz-review-label">the answer</span>
                          {question.options[question.answer]} — {question.because}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="quiz-actions">
            <button className="primary" onClick={() => setStage('summary')}>
              Now write it down
            </button>
          </div>
        </div>
      </>
    )
  }

  if (stage === 'lowScore') {
    return (
      <>
        <div className="scrim solid" />
        <div className="quiz">
          <span className="quiz-kicker">
            {score} of {questions.length} — not enough to bank it
          </span>
          <p className="muted">
            The note only gets saved when the section actually landed. Going back over it is
            usually faster than it sounds.
          </p>
          <div className="quiz-actions">
            <button className="primary" onClick={onReread}>
              Re-read this section
            </button>
            <button
              className="ghost boxed"
              onClick={() => onDone({ summary: summary.trim(), score, total: questions.length })}
            >
              Save the note anyway
            </button>
            <button className="ghost boxed" onClick={() => onDone(null)}>
              Carry on without saving
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="scrim solid" />
      <div className="quiz">
        <span className="quiz-kicker">{chapterTitle}</span>
        <h2 className="quiz-question">In your own words — what did this section say?</h2>
        <p className="muted">
          Not a transcript. The two or three things you'd tell someone who hasn't read it.
        </p>
        <textarea
          ref={summaryRef}
          value={summary}
          rows={6}
          placeholder="The main argument was…"
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submitSummary()
            }
          }}
        />
        <div className="quiz-actions">
          <button className="primary" disabled={summary.trim().length < 15} onClick={submitSummary}>
            Save and carry on
          </button>
          <span className="muted quiz-hint">⌘↵</span>
        </div>
      </div>
    </>
  )
}
