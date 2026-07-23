import type { FastifyInstance } from 'fastify'
import { createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz, type Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, requestScope } from '../require-user.js'

type Deps = { db: Db; config: AppConfig }

/** `title` non vide requis à la création ; à la modification, s'il est fourni, il doit rester non vide. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function registerQuizRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps

  app.post('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
    let scope
    try {
      scope = await requestScope(request, db, config)
    } catch {
      return reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
    }

    const body = request.body as { title?: unknown; description?: unknown } | undefined
    if (!isNonEmptyString(body?.title)) {
      return reply.code(400).send({ error: 'Le titre est requis.' })
    }
    const description = isNonEmptyString(body?.description) ? body.description : undefined

    const quiz = await createQuiz(scope, { ownerId: request.user.id, title: body.title, description })
    return reply.code(201).send(quiz)
  })

  app.get('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
    let scope
    try {
      scope = await requestScope(request, db, config)
    } catch {
      return reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
    }
    return listQuizzes(scope)
  })

  app.get<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    let scope
    try {
      scope = await requestScope(request, db, config)
    } catch {
      return reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
    }
    const quiz = await getQuiz(scope, request.params.id)
    if (!quiz) return reply.code(404).send({ error: 'Quiz introuvable.' })
    return quiz
  })

  app.patch<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    let scope
    try {
      scope = await requestScope(request, db, config)
    } catch {
      return reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
    }

    const body = request.body as { title?: unknown; description?: unknown; cover?: unknown } | undefined
    const patch: Partial<{ title: string; description: string | null; cover: string | null }> = {}
    if (body?.title !== undefined) {
      if (!isNonEmptyString(body.title)) return reply.code(400).send({ error: 'Le titre ne peut pas être vide.' })
      patch.title = body.title
    }
    if (body?.description !== undefined) patch.description = body.description === null ? null : String(body.description)
    if (body?.cover !== undefined) patch.cover = body.cover === null ? null : String(body.cover)

    const quiz = await updateQuiz(scope, request.params.id, patch)
    if (!quiz) return reply.code(404).send({ error: 'Quiz introuvable.' })
    return quiz
  })

  app.delete<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    let scope
    try {
      scope = await requestScope(request, db, config)
    } catch {
      return reply.code(403).send({ error: 'Accès refusé à ce tenant.' })
    }
    const ok = await deleteQuiz(scope, request.params.id)
    if (!ok) return reply.code(404).send({ error: 'Quiz introuvable.' })
    return { ok: true }
  })
}
