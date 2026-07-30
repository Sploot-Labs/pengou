import type { FastifyInstance } from 'fastify'
import { createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz, withTenantTx, type Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { LIMITS, tooLong, isSafeMedia } from '../validation.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

/** `title` non vide requis à la création ; à la modification, s'il est fourni, il doit rester non vide. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Bornes de longueur (P2) : évite le stockage/rediffusion de chaînes démesurées.
const MAX_TITLE = LIMITS.title
const MAX_DESCRIPTION = LIMITS.description

export function registerQuizRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, config } = deps

  app.post('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return

    const body = request.body as { title?: unknown; description?: unknown } | undefined
    if (!isNonEmptyString(body?.title)) {
      return reply.code(400).send({ error: 'Le titre est requis.' })
    }
    if (tooLong(body.title, MAX_TITLE)) {
      return reply.code(400).send({ error: `Le titre est trop long (${MAX_TITLE} caractères max).` })
    }
    if (tooLong(body?.description, MAX_DESCRIPTION)) {
      return reply.code(400).send({ error: `La description est trop longue (${MAX_DESCRIPTION} caractères max).` })
    }
    const description = isNonEmptyString(body?.description) ? body.description : undefined

    return withTenantTx(appDb, context, async (scope) => {
      const quiz = await createQuiz(scope, { ownerId: request.user.id, title: body.title as string, description })
      return reply.code(201).send(quiz)
    })
  })

  app.get('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    return withTenantTx(appDb, context, (scope) => listQuizzes(scope))
  })

  app.get<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    return withTenantTx(appDb, context, async (scope) => {
      const quiz = await getQuiz(scope, request.params.id)
      if (!quiz) return reply.code(404).send({ error: 'Quiz introuvable.' })
      return quiz
    })
  })

  app.patch<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return

    const body = request.body as { title?: unknown; description?: unknown; cover?: unknown } | undefined
    const patch: Partial<{ title: string; description: string | null; cover: string | null }> = {}
    if (body?.title !== undefined) {
      if (!isNonEmptyString(body.title)) return reply.code(400).send({ error: 'Le titre ne peut pas être vide.' })
      if (tooLong(body.title, MAX_TITLE)) return reply.code(400).send({ error: `Le titre est trop long (${MAX_TITLE} caractères max).` })
      patch.title = body.title
    }
    if (body?.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') {
        return reply.code(400).send({ error: 'La description doit être une chaîne ou null.' })
      }
      if (tooLong(body.description, MAX_DESCRIPTION)) return reply.code(400).send({ error: `La description est trop longue (${MAX_DESCRIPTION} caractères max).` })
      patch.description = body.description
    }
    if (body?.cover !== undefined) {
      if (body.cover !== null && typeof body.cover !== 'string') {
        return reply.code(400).send({ error: 'La couverture doit être une chaîne ou null.' })
      }
      // Même durcissement que `media` (P2) : la couverture est une URL d'image → bornée +
      // schémas dangereux refusés (anti-XSS latent / abus stockage).
      if (typeof body.cover === 'string' && !isSafeMedia(body.cover, LIMITS.cover)) {
        return reply.code(400).send({ error: 'Couverture invalide (URL http(s) ou référence relative attendue).' })
      }
      patch.cover = body.cover
    }

    return withTenantTx(appDb, context, async (scope) => {
      const quiz = await updateQuiz(scope, request.params.id, patch)
      if (!quiz) return reply.code(404).send({ error: 'Quiz introuvable.' })
      return quiz
    })
  })

  app.delete<{ Params: { id: string } }>('/api/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    return withTenantTx(appDb, context, async (scope) => {
      const ok = await deleteQuiz(scope, request.params.id)
      if (!ok) return reply.code(404).send({ error: 'Quiz introuvable.' })
      return { ok: true }
    })
  })
}
