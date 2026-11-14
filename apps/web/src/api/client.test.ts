import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, ApiError, onTermsAcceptanceRequired } from './client.js'
import { setActiveTenantId } from './activeTenant.js'

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

afterEach(() => {
  vi.unstubAllGlobals()
  setActiveTenantId(null)
})

describe('client API typé', () => {
  it('apiGet renvoie le JSON parsé sur 200', async () => {
    mockFetchOnce(200, { user: { id: '1' } })
    const result = await apiGet<{ user: { id: string } }>('/api/me')
    expect(result).toEqual({ user: { id: '1' } })
  })

  it('envoie toujours credentials: same-origin', async () => {
    mockFetchOnce(200, { ok: true })
    await apiGet('/api/me')
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.credentials).toBe('same-origin')
  })

  it('apiPost sérialise le corps en JSON avec le bon header', async () => {
    mockFetchOnce(200, { ok: true })
    await apiPost('/api/quizzes', { title: 'Quiz' })
    const [path, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toBe('/api/quizzes')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Accept-Language': 'fr', 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ title: 'Quiz' }))
  })

  it('apiPatch et apiDelete utilisent la bonne méthode HTTP', async () => {
    mockFetchOnce(200, {})
    await apiPatch('/api/quizzes/1', { title: 'X' })
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('PATCH')

    mockFetchOnce(200, {})
    await apiDelete('/api/quizzes/1')
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('DELETE')
  })

  it("n'ajoute PAS d'en-tête x-tenant-id quand aucun workspace n'est actif (mode single)", async () => {
    mockFetchOnce(200, { ok: true })
    await apiGet('/api/quizzes')
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers).toEqual({ 'Accept-Language': 'fr' })
  })

  it('ajoute x-tenant-id sur GET quand un workspace est actif', async () => {
    setActiveTenantId('tenant-123')
    mockFetchOnce(200, { ok: true })
    await apiGet('/api/quizzes')
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers).toEqual({ 'Accept-Language': 'fr', 'x-tenant-id': 'tenant-123' })
  })

  it('combine Content-Type et x-tenant-id sur un POST avec corps', async () => {
    setActiveTenantId('tenant-abc')
    mockFetchOnce(200, { ok: true })
    await apiPost('/api/quizzes', { title: 'Quiz' })
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers).toEqual({
      'Accept-Language': 'fr',
      'Content-Type': 'application/json',
      'x-tenant-id': 'tenant-abc',
    })
  })

  it('lève une ApiError avec le message du champ `error` du serveur (routes maison)', async () => {
    mockFetchOnce(401, { error: 'Non authentifié.' })
    await expect(apiGet('/api/me')).rejects.toMatchObject({
      status: 401,
      message: 'Non authentifié.',
    })
  })

  it('lève une ApiError avec le message du champ `message` du serveur (Better Auth)', async () => {
    mockFetchOnce(400, { message: 'Password too short', code: 'PASSWORD_TOO_SHORT' })
    await expect(apiPost('/api/auth/sign-up/email', {})).rejects.toMatchObject({
      status: 400,
      message: 'Password too short',
    })
  })

  it('retombe sur un message en français si le corps ne porte ni `error` ni `message`', async () => {
    mockFetchOnce(500, { whatever: true })
    await expect(apiGet('/api/broken')).rejects.toMatchObject({
      status: 500,
      message: 'Le serveur a rencontré une erreur. Réessayez dans un instant.',
    })
  })

  it("ignore le corps d'erreur par défaut de Fastify (libellés techniques en anglais)", async () => {
    mockFetchOnce(404, { statusCode: 404, error: 'Not Found', message: 'Route GET:/api/x not found' })
    await expect(apiGet('/api/x')).rejects.toMatchObject({ status: 404, message: 'Élément introuvable.' })
  })

  it('garde le code HTTP dans le repli pour un statut sans message dédié', async () => {
    mockFetchOnce(418, {})
    await expect(apiGet('/api/x')).rejects.toMatchObject({ status: 418, message: 'Erreur 418' })
  })

  it('gère un corps non-JSON (ex. page 502 en HTML) sans lever une erreur de parsing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('<html>Bad Gateway</html>') }),
    )
    await expect(apiGet('/api/x')).rejects.toMatchObject({
      status: 502,
      message: 'Le serveur ne répond pas. Réessayez dans un instant.',
    })
  })

  it('gère un corps vide (ex. 204) sans lever une erreur de parsing', async () => {
    mockFetchOnce(204, undefined)
    await expect(apiDelete('/api/x')).resolves.toBeUndefined()
  })
})

describe('client API, revalidation des CGU', () => {
  it("expose le code d'erreur du serveur sur l'ApiError", async () => {
    mockFetchOnce(400, { message: 'Acceptez les CGU.', code: 'TERMS_ACCEPTANCE_REQUIRED' })
    await expect(apiPost('/api/auth/sign-up/email', {})).rejects.toMatchObject({
      status: 400,
      code: 'TERMS_ACCEPTANCE_REQUIRED',
    })
  })

  it('signale un 403 TERMS_ACCEPTANCE_REQUIRED aux abonnés, une fois par réponse', async () => {
    const listener = vi.fn()
    const unsubscribe = onTermsAcceptanceRequired(listener)
    mockFetchOnce(403, { error: 'Les CGU ont changé.', code: 'TERMS_ACCEPTANCE_REQUIRED' })
    await expect(apiGet('/api/quizzes')).rejects.toMatchObject({ status: 403 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    mockFetchOnce(403, { error: 'Les CGU ont changé.', code: 'TERMS_ACCEPTANCE_REQUIRED' })
    await expect(apiGet('/api/quizzes')).rejects.toMatchObject({ status: 403 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("ne signale rien pour un autre 403 (droits d'accès)", async () => {
    const listener = vi.fn()
    const unsubscribe = onTermsAcceptanceRequired(listener)
    mockFetchOnce(403, { error: 'Accès refusé à ce workspace.' })
    await expect(apiGet('/api/workspaces')).rejects.toMatchObject({ status: 403 })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('apiPostForm envoie le FormData tel quel, sans Content-Type, avec x-tenant-id', async () => {
    setActiveTenantId('t1')
    mockFetchOnce(201, { url: '/uploads/t1/a.png' })
    const form = new FormData()
    form.append('file', new Blob(['x']), 'a.png')
    const result = await apiPostForm<{ url: string }>('/api/media', form)
    const [path, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toBe('/api/media')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBe(form)
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.headers['x-tenant-id']).toBe('t1')
    expect(result).toEqual({ url: '/uploads/t1/a.png' })
  })

  it('apiPostForm lève ApiError avec le message serveur sur 413', async () => {
    mockFetchOnce(413, { error: 'Image trop lourde (2 Mo max).' })
    const err = (await apiPostForm('/api/media', new FormData()).catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(413)
    expect(err.message).toBe('Image trop lourde (2 Mo max).')
  })
})
