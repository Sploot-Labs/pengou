import type { FastifyInstance } from 'fastify'
import {
  createQuiz,
  listQuizzes,
  getQuiz,
  updateQuiz,
  archiveQuiz,
  restoreQuiz,
  deleteQuiz,
  importQuiz,
  withTenantTx,
  type Db,
} from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { assertCanOwnAnotherQuiz } from '../quiz-quota.js'
import { LIMITS, tooLong, isSafeMedia } from '../validation.js'
import { EXAMPLE_QUIZ } from '../example-quiz.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig; mailEnabled?: boolean }

/** `title` non vide requis à la création ; à la modification, s'il est fourni, il doit rester non vide. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Bornes de longueur (P2) : évite le stockage/rediffusion de chaînes démesurées.
const MAX_TITLE = LIMITS.title
const MAX_DESCRIPTION = LIMITS.description

export function registerQuizRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, config } = deps
  const quotaOpts = { mailEnabled: deps.mailEnabled === true, tenancyMode: config.tenancyMode }

  app.post('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    const refused = await assertCanOwnAnotherQuiz(systemDb, request.user, quotaOpts)
    if (refused) return reply.code(refused.status).send(refused.body)

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

    // Réponse envoyée APRÈS le COMMIT (hors du callback) : sinon le client peut enchaîner une
    // requête qui ne voit pas encore le quiz.
    const quiz = await withTenantTx(appDb, context, (scope) =>
      createQuiz(scope, { ownerId: request.user.id, title: body.title as string, description }),
    )
    return reply.code(201).send(quiz)
  })

  // Quiz d'exemple déjà rempli, proposé juste après l'inscription : l'hôte arrive dans l'éditeur
  // avec un quiz à modifier plutôt que sur une liste vide. Mêmes droits et même limite qu'une
  // création ordinaire ; le contenu est fixe, le client n'envoie rien.
  app.post('/api/quizzes/example', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    const refused = await assertCanOwnAnotherQuiz(systemDb, request.user, quotaOpts)
    if (refused) return reply.code(refused.status).send(refused.body)
    const quiz = await withTenantTx(appDb, context, (scope) =>
      importQuiz(scope, { ownerId: request.user.id, source: null, ...EXAMPLE_QUIZ }),
    )
    return reply.code(201).send(quiz)
  })

  // `?archived=1` liste les quiz archivés ; par défaut, seulement les actifs (« Mes quiz »).
  // Ouverte à l'hôte invité : l'écran hôte y lit le quiz de sa démonstration pour la relancer.
  app.get<{ Querystring: { archived?: string } }>(
    '/api/quizzes',
    { preHandler: requireUser, config: { guestAllowed: true } },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      const archived = request.query.archived === '1' || request.query.archived === 'true'
      return withTenantTx(appDb, context, (scope) => listQuizzes(scope, { archived }))
    },
  )

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
      if (tooLong(body.title, MAX_TITLE))
        return reply.code(400).send({ error: `Le titre est trop long (${MAX_TITLE} caractères max).` })
      patch.title = body.title
    }
    if (body?.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') {
        return reply.code(400).send({ error: 'La description doit être une chaîne ou null.' })
      }
      if (tooLong(body.description, MAX_DESCRIPTION))
        return reply.code(400).send({ error: `La description est trop longue (${MAX_DESCRIPTION} caractères max).` })
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

  // Archivage / restauration : mêmes droits que la modification (auteur, ou propriétaire/admin
  // du workspace via `content:access-all`). Un quiz hors de portée répond 404 comme ailleurs.
  for (const [action, apply] of [
    ['archive', archiveQuiz],
    ['restore', restoreQuiz],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/quizzes/:id/${action}`,
      { preHandler: requireUser },
      async (request, reply) => {
        const context = await resolveContextOr403(request, reply, systemDb, config)
        if (!context) return
        // Désarchiver crée un quiz actif de plus : même limite que la création.
        if (action === 'restore') {
          const refused = await assertCanOwnAnotherQuiz(systemDb, request.user, quotaOpts)
          if (refused) return reply.code(refused.status).send(refused.body)
        }
        return withTenantTx(appDb, context, async (scope) => {
          const quiz = await apply(scope, request.params.id)
          if (!quiz) return reply.code(404).send({ error: 'Quiz introuvable.' })
          return quiz
        })
      },
    )
  }

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
