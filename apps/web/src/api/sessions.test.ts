import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSessionReport, listSessions, sessionCsvUrl } from './sessions.js'

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

describe('api/sessions — routes et méthodes HTTP', () => {
  it('listSessions() sans limite → GET /api/sessions (pas de query string)', async () => {
    mockFetchOnce(200, [{ id: 's1' }])
    const result = await listSessions()
    const [path, init] = lastCall()
    expect(path).toBe('/api/sessions')
    expect(init.method).toBe('GET')
    expect(result).toEqual([{ id: 's1' }])
  })

  it('listSessions(limit) → GET /api/sessions?limit=', async () => {
    mockFetchOnce(200, [])
    await listSessions({ limit: 10 })
    const [path] = lastCall()
    expect(path).toBe('/api/sessions?limit=10')
  })

  it('listSessions({ status }) → GET /api/sessions?status=a,b', async () => {
    mockFetchOnce(200, [])
    await listSessions({ status: ['lobby', 'active'] })
    const [path] = lastCall()
    expect(String(path)).toContain('/api/sessions?')
    expect(decodeURIComponent(String(path))).toContain('status=lobby,active')
  })

  it('getSessionReport → GET /api/sessions/:id', async () => {
    mockFetchOnce(200, { session: { id: 's1' }, questions: [], players: [] })
    const result = await getSessionReport('s1')
    const [path, init] = lastCall()
    expect(path).toBe('/api/sessions/s1')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ session: { id: 's1' }, questions: [], players: [] })
  })

  it('sessionCsvUrl → URL same-origin de l’export CSV, sans appeler fetch', () => {
    expect(sessionCsvUrl('s1')).toBe('/api/sessions/s1/export.csv')
  })
})
