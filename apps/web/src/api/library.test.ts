import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  composeQuiz,
  drawLibraryQuestions,
  duplicateLibraryQuiz,
  getLibraryMeta,
  listLibraryQuestions,
  listLibraryQuizzes,
} from './library.js'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    }),
  )
}

function lastCall() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api/library', () => {
  it('getLibraryMeta → GET /api/library/meta', async () => {
    const meta = {
      themes: [{ id: 'cinema', label: 'Cinéma' }],
      difficulties: ['facile'],
      audiences: ['tous'],
      languages: ['fr'],
    }
    mockFetchOnce(200, meta)
    expect(await getLibraryMeta()).toEqual(meta)
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/meta')
    expect(init.method).toBe('GET')
  })

  it('listLibraryQuizzes → GET avec les filtres non vides seulement', async () => {
    mockFetchOnce(200, [])
    await listLibraryQuizzes({ theme: 'cinema', language: '', difficulty: 'facile' })
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/quizzes?theme=cinema&difficulty=facile')
    expect(init.method).toBe('GET')
  })

  it('listLibraryQuizzes sans filtre → pas de query string', async () => {
    mockFetchOnce(200, [])
    await listLibraryQuizzes({})
    expect(lastCall()[0]).toBe('/api/library/quizzes')
  })

  it('listLibraryQuestions → GET avec filtres puis offset et limit', async () => {
    mockFetchOnce(200, { items: [], total: 0 })
    await listLibraryQuestions({ theme: 'cinema' }, { offset: 0, limit: 50 })
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/questions?theme=cinema&offset=0&limit=50')
    expect(init.method).toBe('GET')
  })

  it('listLibraryQuestions encode la recherche', async () => {
    mockFetchOnce(200, { items: [], total: 0 })
    await listLibraryQuestions({ search: 'à b&c' }, { offset: 50, limit: 50 })
    expect(lastCall()[0]).toBe('/api/library/questions?search=%C3%A0+b%26c&offset=50&limit=50')
  })

  it('drawLibraryQuestions → POST /api/library/draw et renvoie items', async () => {
    mockFetchOnce(200, { items: [{ id: 'a' }] })
    const result = await drawLibraryQuestions({ theme: 'cinema', audience: undefined }, 5, ['x'])
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/draw')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ filters: { theme: 'cinema' }, count: 5, excludeIds: ['x'] })
    expect(result).toEqual([{ id: 'a' }])
  })

  it('duplicateLibraryQuiz → POST /api/library/quizzes/:id/duplicate', async () => {
    mockFetchOnce(201, { id: 'q1' })
    await duplicateLibraryQuiz('lib-1')
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/quizzes/lib-1/duplicate')
    expect(init.method).toBe('POST')
  })

  it('composeQuiz → POST /api/library/compose avec title et questionIds', async () => {
    mockFetchOnce(201, { id: 'q1' })
    await composeQuiz('Mon quiz', ['a', 'b'])
    const [path, init] = lastCall()
    expect(path).toBe('/api/library/compose')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ title: 'Mon quiz', questionIds: ['a', 'b'] }))
  })
})
