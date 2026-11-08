import { describe, expect, it } from 'vitest'
import { aggregateWords, wordcloud, wordKey } from './wordcloud.js'

describe('wordcloud', () => {
  it('validateAnswer nettoie le mot', () => {
    expect(wordcloud.validateAnswer({ word: '  bonne   ambiance ' })).toEqual({ word: 'bonne ambiance' })
  })

  it('validateAnswer refuse un mot vide après nettoyage', () => {
    expect(() => wordcloud.validateAnswer({ word: '   ' })).toThrow()
  })

  it('validateAnswer borne la longueur à 25 caractères', () => {
    expect(() => wordcloud.validateAnswer({ word: 'a'.repeat(26) })).toThrow()
    expect(wordcloud.validateAnswer({ word: 'a'.repeat(25) })).toEqual({ word: 'a'.repeat(25) })
  })

  it('validatePayload accepte un payload vide', () => {
    expect(wordcloud.validatePayload({})).toEqual({})
  })

  it('ne donne jamais de points', () => {
    expect(wordcloud.isCorrect({}, { word: 'x' })).toBe(false)
    expect(wordcloud.score({}, { word: 'x' }, { timeMs: 0, maxMs: 1000, basePoints: 1000 })).toBe(0)
  })

  it('wordKey ignore casse, accents et espaces', () => {
    expect(wordKey('Équipe')).toBe(wordKey('equipe'))
    expect(wordKey('  EQUIPE ')).toBe(wordKey('equipe'))
  })
})

describe('aggregateWords', () => {
  it('fusionne les graphies et compte les participants', () => {
    const r = aggregateWords(
      [{ words: ['Bonne  ambiance'] }, { words: ['bonne ambiance', 'café'] }, { words: ['bonne ambiance'] }],
      new Set(),
    )
    expect(r.participants).toBe(3)
    expect(r.totalWords).toBe(4)
    expect(r.words[0]).toMatchObject({ text: 'bonne ambiance', count: 3 })
  })

  it('affiche la graphie la plus fréquente, égalité par ordre alphabétique', () => {
    const r = aggregateWords([{ words: ['Café'] }, { words: ['cafe'] }], new Set())
    expect(r.words).toHaveLength(1)
    expect(r.words[0]?.text).toBe('cafe')
    const r2 = aggregateWords([{ words: ['Café'] }, { words: ['Café'] }, { words: ['cafe'] }], new Set())
    expect(r2.words[0]?.text).toBe('Café')
  })

  it('trie par effectif décroissant puis alphabétique', () => {
    const r = aggregateWords([{ words: ['zèbre', 'abeille', 'chat'] }, { words: ['chat'] }], new Set())
    expect(r.words.map((w) => w.text)).toEqual(['chat', 'abeille', 'zèbre'])
  })

  it('exclut les mots retirés et les joueurs sans mot restant', () => {
    const r = aggregateWords([{ words: ['rush'] }, { words: ['rush', 'café'] }], new Set([wordKey('rush')]))
    expect(r.words.map((w) => w.text)).toEqual(['café'])
    expect(r.totalWords).toBe(1)
    expect(r.participants).toBe(1)
  })

  it('gère une liste vide', () => {
    expect(aggregateWords([], new Set())).toEqual({ words: [], participants: 0, totalWords: 0 })
  })
})
