import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveQuiz,
  createQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  getQuiz,
  listQuestions,
  listQuizzes,
  reorderQuestions,
  restoreQuiz,
  updateQuestion,
  updateQuiz,
} from './quizzes.js'

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const text = body === undefined ? '' : JSON.stringify(body)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      text: () => Promise.resolve(text),
    }),
  )
}

function lastCall() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api/quizzes — routes et méthodes HTTP', () => {
  it('listQuizzes → GET /api/quizzes', async () => {
    mockFetchOnce(200, [{ id: 'q1' }])
    const result = await listQuizzes()
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes')
    expect(init.method).toBe('GET')
    expect(result).toEqual([{ id: 'q1' }])
  })

  it('listQuizzes({ archived: true }) → GET /api/quizzes?archived=1', async () => {
    mockFetchOnce(200, [])
    await listQuizzes({ archived: true })
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes?archived=1')
    expect(init.method).toBe('GET')
  })

  it('archiveQuiz / restoreQuiz → POST /api/quizzes/:id/archive|restore sans body', async () => {
    mockFetchOnce(200, { id: 'q1' })
    await archiveQuiz('q1')
    let [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/archive')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()

    mockFetchOnce(200, { id: 'q1' })
    await restoreQuiz('q1')
    ;[path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/restore')
    expect(init.method).toBe('POST')
  })

  it('createQuiz → POST /api/quizzes avec le body', async () => {
    mockFetchOnce(201, { id: 'q1', title: 'Mon quiz' })
    await createQuiz({ title: 'Mon quiz' })
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ title: 'Mon quiz' }))
  })

  it('getQuiz → GET /api/quizzes/:id', async () => {
    mockFetchOnce(200, { id: 'q1' })
    await getQuiz('q1')
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1')
    expect(init.method).toBe('GET')
  })

  it('updateQuiz → PATCH /api/quizzes/:id', async () => {
    mockFetchOnce(200, { id: 'q1' })
    await updateQuiz('q1', { title: 'Nouveau titre' })
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteQuiz → DELETE /api/quizzes/:id', async () => {
    mockFetchOnce(200, { ok: true })
    await deleteQuiz('q1')
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1')
    expect(init.method).toBe('DELETE')
  })

  it('listQuestions → GET /api/quizzes/:quizId/questions', async () => {
    mockFetchOnce(200, [])
    await listQuestions('q1')
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/questions')
    expect(init.method).toBe('GET')
  })

  it('createQuestion → POST /api/quizzes/:quizId/questions avec le payload typé', async () => {
    mockFetchOnce(201, { id: 'quest1' })
    await createQuestion('q1', {
      type: 'mcq',
      prompt: 'Question ?',
      timeLimit: 20,
      payload: {
        options: [
          { label: 'A', correct: true },
          { label: 'B', correct: false },
        ],
      },
    })
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/questions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ type: 'mcq' })
  })

  it('updateQuestion → PATCH /api/quizzes/:quizId/questions/:questionId', async () => {
    mockFetchOnce(200, { id: 'quest1' })
    await updateQuestion('q1', 'quest1', { prompt: 'Modifié' })
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/questions/quest1')
    expect(init.method).toBe('PATCH')
  })

  it('deleteQuestion → DELETE /api/quizzes/:quizId/questions/:questionId (204 vide)', async () => {
    mockFetchOnce(204, undefined)
    await expect(deleteQuestion('q1', 'quest1')).resolves.toBeUndefined()
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/questions/quest1')
    expect(init.method).toBe('DELETE')
  })

  it('reorderQuestions → PUT /api/quizzes/:quizId/questions/order avec orderedIds', async () => {
    mockFetchOnce(200, { ok: true })
    await reorderQuestions('q1', ['a', 'b', 'c'])
    const [path, init] = lastCall()
    expect(path).toBe('/api/quizzes/q1/questions/order')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify({ orderedIds: ['a', 'b', 'c'] }))
  })
})
