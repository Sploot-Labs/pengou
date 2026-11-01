import { describe, expect, it } from 'vitest'
import type { Pack } from './schema.js'
import { mergeTables, translatePack } from './translate.js'

const SOURCE = { name: 'X', license: 'CC BY-SA 4.0', url: 'https://example.org' }

function mcq(id: string) {
  return {
    id,
    type: 'mcq' as const,
    prompt: `Question ${id}`,
    payload: {
      options: [
        { label: 'A', correct: false },
        { label: 'B', correct: true },
        { label: 'C', correct: false },
        { label: 'D', correct: false },
      ],
    },
    theme: 'cinema',
    difficulty: 'moyen' as const,
    language: 'fr',
    audience: 'tous' as const,
  }
}

function truefalse(id: string) {
  return { ...mcq(id), type: 'truefalse' as const, payload: { correct: false } }
}

function quiz(id: string, questionIds: string[]) {
  return {
    id,
    title: 'Titre',
    description: 'Description',
    theme: 'cinema',
    difficulty: 'moyen' as const,
    language: 'fr',
    audience: 'tous' as const,
    questionIds,
  }
}

const table = (questions: Record<string, unknown>, quizzes: Record<string, unknown> = {}) =>
  ({ questions, quizzes }) as Parameters<typeof translatePack>[1]

describe('translatePack', () => {
  it('traduit un QCM en gardant la place de la bonne réponse', () => {
    const pack: Pack = { source: SOURCE, questions: [mcq('q1')], quizzes: [] }
    const { pack: out, missing } = translatePack(pack, table({ q1: { prompt: 'P', options: ['a', 'b', 'c', 'd'] } }), 'en')
    expect(missing).toEqual([])
    expect(out?.source).toEqual({ ...SOURCE, name: 'X (traduction Sploot Labs)' })
    const q = out?.questions[0]
    expect(q?.id).toBe('q1-en')
    expect(q?.language).toBe('en')
    expect(q?.prompt).toBe('P')
    const options = (q?.payload as { options: unknown[] } | undefined)?.options
    expect(options?.[1]).toEqual({ label: 'b', correct: true })
    expect(options?.[0]).toEqual({ label: 'a', correct: false })
  })

  it("recopie le payload d'un vrai/faux", () => {
    const pack: Pack = { source: SOURCE, questions: [truefalse('q1')], quizzes: [] }
    const { pack: out } = translatePack(pack, table({ q1: { prompt: 'P' } }), 'en')
    expect(out?.questions[0].payload).toEqual({ correct: false })
    expect(out?.questions[0].type).toBe('truefalse')
  })

  it('écarte une question marquée skip et ne reproduit pas son quiz', () => {
    const pack: Pack = {
      source: SOURCE,
      questions: [mcq('q1'), mcq('q2')],
      quizzes: [quiz('z1', ['q1', 'q2'])],
    }
    const t = table(
      { q1: { prompt: 'P1', options: ['a', 'b', 'c', 'd'] }, q2: { skip: 'jeu de mots' } },
      { z1: { title: 'T' } },
    )
    const { pack: out, skippedQuizzes, missing } = translatePack(pack, t, 'en')
    expect(missing).toEqual([])
    expect(skippedQuizzes).toEqual(['z1'])
    expect(out?.questions.map((q) => q.id)).toEqual(['q1-en'])
    expect(out?.quizzes).toEqual([])
  })

  it('reproduit un quiz entièrement traduit', () => {
    const pack: Pack = {
      source: SOURCE,
      questions: [mcq('q1'), mcq('q2')],
      quizzes: [quiz('z1', ['q1', 'q2'])],
    }
    const opts = ['a', 'b', 'c', 'd']
    const t = table(
      { q1: { prompt: 'P1', options: opts }, q2: { prompt: 'P2', options: opts } },
      { z1: { title: 'Title', description: 'Desc' } },
    )
    const { pack: out } = translatePack(pack, t, 'en')
    expect(out?.quizzes).toEqual([
      { ...quiz('z1-en', ['q1-en', 'q2-en']), title: 'Title', description: 'Desc', language: 'en' },
    ])
  })

  it('signale un quiz entièrement traduit mais sans entrée de quiz', () => {
    const pack: Pack = { source: SOURCE, questions: [mcq('q1')], quizzes: [quiz('z1', ['q1'])] }
    const { pack: out, missing } = translatePack(pack, table({ q1: { prompt: 'P', options: ['a', 'b', 'c', 'd'] } }), 'en')
    expect(missing).toEqual(['z1'])
    expect(out?.quizzes).toEqual([])
  })

  it('liste les questions sans entrée dans missing', () => {
    const pack: Pack = { source: SOURCE, questions: [mcq('q1'), mcq('q2')], quizzes: [] }
    const { pack: out, missing } = translatePack(pack, table({ q1: { prompt: 'P', options: ['a', 'b', 'c', 'd'] } }), 'en')
    expect(missing).toEqual(['q2'])
    expect(out?.questions.map((q) => q.id)).toEqual(['q1-en'])
  })

  it('renvoie pack null quand aucune question n’est traduite', () => {
    const pack: Pack = { source: SOURCE, questions: [mcq('q1')], quizzes: [] }
    expect(translatePack(pack, table({ q1: { skip: 'x' } }), 'en').pack).toBeNull()
  })

  it('lève si le nombre de propositions diffère', () => {
    const pack: Pack = { source: SOURCE, questions: [mcq('q1')], quizzes: [] }
    expect(() => translatePack(pack, table({ q1: { prompt: 'P', options: ['a', 'b'] } }), 'en')).toThrow(/q1/)
  })
})

describe('mergeTables', () => {
  it('fusionne des tables disjointes', () => {
    const merged = mergeTables([table({ a: { skip: 'x' } }, { z: { title: 'T' } }), table({ b: { skip: 'y' } })])
    expect(Object.keys(merged.questions)).toEqual(['a', 'b'])
    expect(Object.keys(merged.quizzes)).toEqual(['z'])
  })

  it('mergeTables lève sur une clé en double', () => {
    expect(() => mergeTables([table({ a: { skip: 'x' } }), table({ a: { skip: 'y' } })])).toThrow(/a/)
    expect(() => mergeTables([table({}, { z: { title: 'T' } }), table({}, { z: { title: 'U' } })])).toThrow(/z/)
  })
})
