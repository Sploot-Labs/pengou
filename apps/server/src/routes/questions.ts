import type { FastifyInstance } from 'fastify'
import { createQuestion, listQuestions, getQuestion, updateQuestion, deleteQuestion, reorderQuestions, type Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { validateQuestionPayload, questionTypes, type QuestionType } from '@splootlabs/quiz'
import { requireUser, resolveScopeOr403 } from '../require-user.js'

type Deps = { db: Db; config: AppConfig }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(questionTypes, value)
}

export function registerQuestionRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps

  app.post<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions',
    { preHandler: requireUser },
    async (request, reply) => {
      const scope = await resolveScopeOr403(request, reply, db, config)
      if (!scope) return

      const body = request.body as
        | { type?: unknown; prompt?: unknown; timeLimit?: unknown; payload?: unknown; media?: unknown }
        | undefined

      if (!isQuestionType(body?.type)) {
        return reply.code(400).send({ error: 'Le type de question est invalide.' })
      }
      if (!isNonEmptyString(body?.prompt)) {
        return reply.code(400).send({ error: "L'énoncé (prompt) est requis." })
      }
      if (!isPositiveInt(body?.timeLimit)) {
        return reply.code(400).send({ error: 'timeLimit doit être un entier positif.' })
      }

      let validatedPayload: unknown
      try {
        validatedPayload = validateQuestionPayload(body.type, body.payload)
      } catch {
        return reply.code(400).send({ error: 'Le payload est invalide pour ce type de question.' })
      }

      const media = isNonEmptyString(body?.media) ? body.media : undefined

      const question = await createQuestion(scope, request.params.quizId, {
        type: body.type,
        prompt: body.prompt,
        timeLimit: body.timeLimit,
        payload: validatedPayload,
        media,
      })
      if (!question) return reply.code(404).send({ error: 'Quiz introuvable.' })
      return reply.code(201).send(question)
    },
  )

  app.get<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions',
    { preHandler: requireUser },
    async (request, reply) => {
      const scope = await resolveScopeOr403(request, reply, db, config)
      if (!scope) return

      const questions = await listQuestions(scope, request.params.quizId)
      if (!questions) return reply.code(404).send({ error: 'Quiz introuvable.' })
      return questions
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
      const scope = await resolveScopeOr403(request, reply, db, config)
      if (!scope) return

      const body = request.body as
        | { prompt?: unknown; timeLimit?: unknown; payload?: unknown; media?: unknown }
        | undefined

      const patch: Partial<{ prompt: string; timeLimit: number; payload: unknown; media: string | null }> = {}

      if (body?.prompt !== undefined) {
        if (!isNonEmptyString(body.prompt)) return reply.code(400).send({ error: "L'énoncé (prompt) ne peut pas être vide." })
        patch.prompt = body.prompt
      }
      if (body?.timeLimit !== undefined) {
        if (!isPositiveInt(body.timeLimit)) return reply.code(400).send({ error: 'timeLimit doit être un entier positif.' })
        patch.timeLimit = body.timeLimit
      }
      if (body?.media !== undefined) {
        if (body.media !== null && typeof body.media !== 'string') {
          return reply.code(400).send({ error: 'media doit être une chaîne ou null.' })
        }
        patch.media = body.media
      }
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
    },
  )

  app.delete<{ Params: { quizId: string; questionId: string } }>(
    '/api/quizzes/:quizId/questions/:questionId',
    { preHandler: requireUser },
    async (request, reply) => {
      const scope = await resolveScopeOr403(request, reply, db, config)
      if (!scope) return

      const ok = await deleteQuestion(scope, request.params.quizId, request.params.questionId)
      if (!ok) return reply.code(404).send({ error: 'Question ou quiz introuvable.' })
      return reply.code(204).send()
    },
  )

  app.put<{ Params: { quizId: string } }>(
    '/api/quizzes/:quizId/questions/order',
    { preHandler: requireUser },
    async (request, reply) => {
      const scope = await resolveScopeOr403(request, reply, db, config)
      if (!scope) return

      const body = request.body as { orderedIds?: unknown } | undefined
      if (!Array.isArray(body?.orderedIds) || !body.orderedIds.every((id) => typeof id === 'string')) {
        return reply.code(400).send({ error: 'orderedIds doit être un tableau de chaînes.' })
      }

      const ok = await reorderQuestions(scope, request.params.quizId, body.orderedIds)
      if (!ok) return reply.code(404).send({ error: 'Quiz introuvable ou orderedIds invalide.' })
      return { ok: true }
    },
  )
}
