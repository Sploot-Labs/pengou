import type { FastifyInstance } from 'fastify'
import {
  importQuiz, withTenantTx, listLibraryThemes, listLibraryLanguages, searchLibraryQuestions,
  listLibraryQuizzes, drawLibraryQuestions, getLibraryQuestions, getLibraryQuiz,
  type Db, type LibraryFilters, type LibraryQuestion,
} from '@splootlabs/db'
import type { Audience, Difficulty } from '@splootlabs/library'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { LIMITS, tooLong } from '../validation.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

const DIFFICULTIES: Difficulty[] = ['facile', 'moyen', 'difficile']
const AUDIENCES: Audience[] = ['enfants', 'adultes', 'tous']

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const MAX_DRAW = 50
const MAX_EXCLUDE_IDS = 200
const MAX_COMPOSE_IDS = 100
const MAX_FILTER_TEXT = 200

type FilterResult = { filters: LibraryFilters } | { error: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Valide un objet de critères (query string ou corps) ; les valeurs d'enum inconnues sont refusées. */
function parseFilters(raw: Record<string, unknown> | undefined, withSearch: boolean): FilterResult {
  const filters: LibraryFilters = {}
  const src = raw ?? {}
  for (const key of ['theme', 'language'] as const) {
    const value = src[key]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || value.length > MAX_FILTER_TEXT) return { error: `Critère « ${key} » invalide.` }
    filters[key] = value
  }
  if (src.difficulty !== undefined && src.difficulty !== '') {
    if (!DIFFICULTIES.includes(src.difficulty as Difficulty)) return { error: 'Difficulté inconnue.' }
    filters.difficulty = src.difficulty as Difficulty
  }
  if (src.audience !== undefined && src.audience !== '') {
    if (!AUDIENCES.includes(src.audience as Audience)) return { error: 'Public inconnu.' }
    filters.audience = src.audience as Audience
  }
  if (withSearch && src.search !== undefined && src.search !== '') {
    if (typeof src.search !== 'string' || src.search.length > MAX_FILTER_TEXT) return { error: 'Recherche invalide.' }
    filters.search = src.search
  }
  return { filters }
}

/** Entier décimal positif ou nul dans une query string ; `undefined` si absent, `null` si invalide. */
function parseIntParam(value: unknown): number | undefined | null {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  return Number(value)
}

/** Question du catalogue vers la forme attendue par `importQuiz` (copie dans le tenant). */
function toImported(q: LibraryQuestion) {
  return {
    type: q.type, prompt: q.prompt, payload: q.payload,
    timeLimit: q.timeLimit, readingTime: q.readingTime, source: q.source,
  }
}

export function registerLibraryRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, config } = deps

  // Lectures : tables du catalogue sans tenant ni RLS, donc `appDb` directement.
  app.get('/api/library/meta', { preHandler: requireUser }, async () => {
    const [themes, languages] = await Promise.all([listLibraryThemes(appDb), listLibraryLanguages(appDb)])
    return { themes, difficulties: DIFFICULTIES, audiences: AUDIENCES, languages }
  })

  app.get('/api/library/quizzes', { preHandler: requireUser }, async (request, reply) => {
    const parsed = parseFilters(request.query as Record<string, unknown>, false)
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
    return listLibraryQuizzes(appDb, parsed.filters)
  })

  // Aperçu d'un quiz tout prêt : ses questions dans l'ordre, réponses comprises (le front choisit
  // de les montrer ou non ; le catalogue est public pour tout utilisateur connecté).
  app.get<{ Params: { id: string } }>('/api/library/quizzes/:id', { preHandler: requireUser }, async (request, reply) => {
    const found = await getLibraryQuiz(appDb, request.params.id)
    if (!found) return reply.code(404).send({ error: 'Quiz introuvable dans la bibliothèque.' })
    return found
  })

  app.get('/api/library/questions', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const parsed = parseFilters(query, true)
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
    const offset = parseIntParam(query.offset)
    const limit = parseIntParam(query.limit)
    if (offset === null) return reply.code(400).send({ error: 'Décalage invalide.' })
    if (limit === null) return reply.code(400).send({ error: 'Limite invalide.' })
    return searchLibraryQuestions(appDb, parsed.filters, {
      offset: offset ?? 0,
      limit: Math.min(limit === undefined || limit < 1 ? DEFAULT_LIMIT : limit, MAX_LIMIT),
    })
  })

  app.post('/api/library/draw', { preHandler: requireUser }, async (request, reply) => {
    const body = request.body as { filters?: unknown; count?: unknown; excludeIds?: unknown } | undefined
    const rawFilters = body?.filters
    if (rawFilters !== undefined && (typeof rawFilters !== 'object' || rawFilters === null || Array.isArray(rawFilters))) {
      return reply.code(400).send({ error: 'Critères invalides.' })
    }
    const parsed = parseFilters(rawFilters as Record<string, unknown> | undefined, true)
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
    const count = body?.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_DRAW) {
      return reply.code(400).send({ error: `Le nombre de questions doit être un entier de 1 à ${MAX_DRAW}.` })
    }
    const excludeIds = body?.excludeIds ?? []
    if (!Array.isArray(excludeIds) || excludeIds.length > MAX_EXCLUDE_IDS || !excludeIds.every(isNonEmptyString)) {
      return reply.code(400).send({ error: `Les questions à exclure doivent être au plus ${MAX_EXCLUDE_IDS} identifiants.` })
    }
    return { items: await drawLibraryQuestions(appDb, parsed.filters, count, excludeIds as string[]) }
  })

  // Écritures : le catalogue est lu d'abord, puis la copie est écrite dans le tenant de l'utilisateur.
  app.post<{ Params: { id: string } }>('/api/library/quizzes/:id/duplicate', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return

    const found = await getLibraryQuiz(appDb, request.params.id)
    if (!found) return reply.code(404).send({ error: 'Quiz introuvable dans la bibliothèque.' })

    // Réponse envoyée APRÈS le COMMIT (hors du callback) : l'éditeur ouvre aussitôt la copie.
    const created = await withTenantTx(appDb, context, (scope) =>
      importQuiz(scope, {
        ownerId: request.user.id,
        title: found.quiz.title,
        description: found.quiz.description,
        source: found.quiz.source,
        questions: found.questions.map(toImported),
      }))
    return reply.code(201).send(created)
  })

  app.post('/api/library/compose', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return

    const body = request.body as { title?: unknown; questionIds?: unknown } | undefined
    if (!isNonEmptyString(body?.title)) return reply.code(400).send({ error: 'Le titre est requis.' })
    if (tooLong(body.title, LIMITS.title)) {
      return reply.code(400).send({ error: `Le titre est trop long (${LIMITS.title} caractères max).` })
    }
    const ids = body?.questionIds
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isNonEmptyString)) {
      return reply.code(400).send({ error: 'Choisissez au moins une question.' })
    }
    if (ids.length > MAX_COMPOSE_IDS) {
      return reply.code(400).send({ error: `Trop de questions (${MAX_COMPOSE_IDS} max).` })
    }
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: 'Une même question ne peut pas être choisie deux fois.' })
    }

    const questions = await getLibraryQuestions(appDb, ids as string[])
    if (!questions) return reply.code(404).send({ error: 'Question introuvable dans la bibliothèque.' })

    const title = body.title
    const created = await withTenantTx(appDb, context, (scope) =>
      importQuiz(scope, { ownerId: request.user.id, title, source: null, questions: questions.map(toImported) }))
    return reply.code(201).send(created)
  })
}
