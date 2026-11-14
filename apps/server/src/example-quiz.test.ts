import { describe, expect, it } from 'vitest'
import { LANGS } from '@splootlabs/shared/i18n'
import { EXAMPLE_QUIZ, exampleQuiz } from './example-quiz.js'

describe('exampleQuiz', () => {
  it('le français est la constante exportée', () => {
    expect(exampleQuiz('fr')).toBe(EXAMPLE_QUIZ)
  })
  it('titres', () => {
    expect(exampleQuiz('en').title).toBe('My first quiz (example)')
    expect(exampleQuiz('es').title).toBe('Mi primer quiz (ejemplo)')
  })
  it.each(LANGS)('%s garde la structure du français', (lang) => {
    const quiz = exampleQuiz(lang)
    expect(quiz.questions).toHaveLength(EXAMPLE_QUIZ.questions.length)
    quiz.questions.forEach((q, i) => {
      const ref = EXAMPLE_QUIZ.questions[i]
      expect(q.type).toBe(ref.type)
      expect(q.timeLimit).toBe(ref.timeLimit)
      expect(q.readingTime).toBe(ref.readingTime)
      expect(q.source).toBe(ref.source)
      expect(q.prompt.length).toBeGreaterThan(0)
      const p = q.payload as Record<string, unknown>
      const r = ref.payload as Record<string, unknown>
      if ('options' in r) {
        const opts = p.options as { label: string; correct?: boolean }[]
        const refOpts = r.options as { label: string; correct?: boolean }[]
        expect(opts.map((o) => o.correct)).toEqual(refOpts.map((o) => o.correct))
        expect(opts.every((o) => o.label.length > 0)).toBe(true)
        expect(p.multiple).toBe(r.multiple)
      } else {
        expect(p).toEqual(r)
      }
    })
  })
  it.each(['en', 'es'] as const)('%s : les faits restent vrais', (lang) => {
    const quiz = exampleQuiz(lang)
    const options = (quiz.questions[0].payload as { options: { label: string; correct?: boolean }[] }).options
    expect(options.find((o) => o.correct)?.label).toBe('Canberra')
    expect((quiz.questions[2].payload as { correct: number }).correct).toBe(1969)
    expect(quiz.questions[1].prompt).toMatch(lang === 'en' ? /emperor penguin/i : /pingüino emperador/i)
    expect((quiz.questions[1].payload as { correct: boolean }).correct).toBe(true)
  })
})
