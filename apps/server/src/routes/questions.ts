import type { FastifyInstance } from 'fastify'
import {
  createQuestion,
  listQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  withTenantTx,
  type Db,
} from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { validateQuestionPayload, questionTypes, type QuestionType } from '@splootlabs/quiz'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { LIMITS, tooLong, isSafeMedia } from '../validation.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(questionTypes, value)
}

const MAX_PROMPT = LIMITS.prompt

export function registerQuestionRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, config } = deps

  app.post<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return

      const body = request.body as
        | {
            type?: unknown
            prompt?: unknown
            timeLimit?: unknown
            readingTime?: unknown
            payload?: unknown
            media?: unknown
            mediaAlt?: unknown
          }
        | undefined

      if (!isQuestionType(body?.type)) {
        return reply.code(400).send({ error: 'Le type de question est invalide.' })
      }
      if (!isNonEmptyString(body?.prompt)) {
        return reply.code(400).send({ error: "L'énoncé (prompt) est requis." })
      }
      if (tooLong(body.prompt, MAX_PROMPT)) {
        return reply.code(400).send({ error: `L'énoncé est trop long (${MAX_PROMPT} caractères max).` })
      }
      if (!isPositiveInt(body?.timeLimit)) {
        return reply.code(400).send({ error: 'timeLimit doit être un entier positif.' })
      }
      // Optionnel à la création (défaut 0 = pas de phase de lecture, voir `createQuestion` en
      // base) — mais si fourni, doit être un entier ≥ 0, mirror de `timeLimit`.
      if (body?.readingTime !== undefined && !isNonNegativeInt(body.readingTime)) {
        return reply.code(400).send({ error: 'readingTime doit être un entier positif ou nul.' })
      }

      let validatedPayload: unknown
      try {
        validatedPayload = validateQuestionPayload(body.type, body.payload)
      } catch {
        return reply.code(400).send({ error: 'Le payload est invalide pour ce type de question.' })
      }

      const media = isNonEmptyString(body?.media) ? body.media : undefined
      if (media !== undefined && !isSafeMedia(media)) {
        return reply.code(400).send({ error: 'media invalide (URL http(s) ou référence relative attendue).' })
      }

      if (body?.mediaAlt != null && typeof body.mediaAlt !== 'string') {
        return reply.code(400).send({ error: 'mediaAlt doit être une chaîne ou null.' })
      }
      if (tooLong(body?.mediaAlt, LIMITS.mediaAlt)) {
        return reply.code(400).send({ error: `Le texte alternatif est trop long (${LIMITS.mediaAlt} caractères max).` })
      }
      const mediaAlt = isNonEmptyString(body?.mediaAlt) ? body.mediaAlt : undefined

      return withTenantTx(appDb, context, async (scope) => {
        const question = await createQuestion(scope, request.params.quizId, {
          type: body.type as QuestionType,
          prompt: body.prompt as string,
          timeLimit: body.timeLimit as number,
          readingTime: isNonNegativeInt(body.readingTime) ? body.readingTime : undefined,
          payload: validatedPayload,
          media,
          mediaAlt,
        })
        if (!question) return reply.code(404).send({ error: 'Quiz introuvable.' })
        return reply.code(201).send(question)
      })
    },
  )

  app.get<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      return withTenantTx(appDb, context, async (scope) => {
        const questions = await listQuestions(scope, request.params.quizId)
        if (!questions) return reply.code(404).send({ error: 'Quiz introuvable.' })
        return questions
      })
    },
  )

  // Revalidation du payload à la modification : le type d'une question est IMMUABLE via
  // cette route (aucun champ `type` dans `updateQuestion`). Si `payload` est fourni, on va
  // chercher le type RÉELLEMENT STOCKÉ via `getQuestion` et on valide contre celui-ci — tout
  // `type` envoyé par le client est ignoré pour la validation (il ne peut jamais faire
  // dévier le schéma utilisé). Sans ça, un client pourrait déclarer un type différent du
  // type stocké et faire persister un payload mal formé pour le moteur de scoring (Plan 5).
  app.patch<{ Params: { quizId: string; questionId: string } }>(
    '/api/quizzes/:quizId/questions/:questionId',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return

      const body = request.body as
        | {
            prompt?: unknown
            timeLimit?: unknown
            readingTime?: unknown
            payload?: unknown
            media?: unknown
            mediaAlt?: unknown
          }
        | undefined

      const patch: Partial<{
        prompt: string
        timeLimit: number
        readingTime: number
        payload: unknown
        media: string | null
        mediaAlt: string | null
      }> = {}

      if (body?.prompt !== undefined) {
        if (!isNonEmptyString(body.prompt))
          return reply.code(400).send({ error: "L'énoncé (prompt) ne peut pas être vide." })
        if (tooLong(body.prompt, MAX_PROMPT))
          return reply.code(400).send({ error: `L'énoncé est trop long (${MAX_PROMPT} caractères max).` })
        patch.prompt = body.prompt
      }
      if (body?.timeLimit !== undefined) {
        if (!isPositiveInt(body.timeLimit))
          return reply.code(400).send({ error: 'timeLimit doit être un entier positif.' })
        patch.timeLimit = body.timeLimit
      }
      if (body?.readingTime !== undefined) {
        if (!isNonNegativeInt(body.readingTime))
          return reply.code(400).send({ error: 'readingTime doit être un entier positif ou nul.' })
        patch.readingTime = body.readingTime
      }
      if (body?.media !== undefined) {
        if (body.media !== null && typeof body.media !== 'string') {
          return reply.code(400).send({ error: 'media doit être une chaîne ou null.' })
        }
        if (typeof body.media === 'string' && !isSafeMedia(body.media)) {
          return reply.code(400).send({ error: 'media invalide (URL http(s) ou référence relative attendue).' })
        }
        patch.media = body.media
        // Retirer l'image retire aussi son texte alternatif, sauf si le corps en fournit un.
        if (body.media === null && body.mediaAlt === undefined) patch.mediaAlt = null
      }
      if (body?.mediaAlt !== undefined) {
        if (body.mediaAlt !== null && typeof body.mediaAlt !== 'string') {
          return reply.code(400).send({ error: 'mediaAlt doit être une chaîne ou null.' })
        }
        if (tooLong(body.mediaAlt, LIMITS.mediaAlt)) {
          return reply
            .code(400)
            .send({ error: `Le texte alternatif est trop long (${LIMITS.mediaAlt} caractères max).` })
        }
        // Chaîne vide ou blanche : pas de texte alternatif (comme au POST).
        patch.mediaAlt = isNonEmptyString(body.mediaAlt) ? body.mediaAlt : null
      }

      return withTenantTx(appDb, context, async (scope) => {
        if (body?.payload !== undefined) {
          const existing = await getQuestion(scope, request.params.quizId, request.params.questionId)
          if (!existing) return reply.code(404).send({ error: 'Question ou quiz introuvable.' })
          try {
            patch.payload = validateQuestionPayload(existing.type as QuestionType, body.payload)
          } catch {
            return reply.code(400).send({ error: 'Le payload est invalide pour ce type de question.' })
          }
        }

        const question = await updateQuestion(scope, request.params.quizId, request.params.questionId, patch)
        if (!question) return reply.code(404).send({ error: 'Question ou quiz introuvable.' })
        return question
      })
    },
  )

  app.delete<{ Params: { quizId: string; questionId: string } }>(
    '/api/quizzes/:quizId/questions/:questionId',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      return withTenantTx(appDb, context, async (scope) => {
        const ok = await deleteQuestion(scope, request.params.quizId, request.params.questionId)
        if (!ok) return reply.code(404).send({ error: 'Question ou quiz introuvable.' })
        return reply.code(204).send()
      })
    },
  )

  app.put<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions/order',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return

      const body = request.body as { orderedIds?: unknown } | undefined
      if (!Array.isArray(body?.orderedIds) || !body.orderedIds.every((id) => typeof id === 'string')) {
        return reply.code(400).send({ error: 'orderedIds doit être un tableau de chaînes.' })
      }

      return withTenantTx(appDb, context, async (scope) => {
        const ok = await reorderQuestions(scope, request.params.quizId, body.orderedIds as string[])
        if (!ok) return reply.code(404).send({ error: 'Quiz introuvable ou orderedIds invalide.' })
        return { ok: true }
      })
    },
  )
}
