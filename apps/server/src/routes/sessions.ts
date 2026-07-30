import type { FastifyInstance } from 'fastify'
import { listSessions, getSessionReport, withTenantTx, type SessionReport, type Db } from '@splootlabs/db'
import type { AppConfig } from '@splootlabs/shared'
import { requireUser, resolveContextOr403 } from '../require-user.js'
import { toCsv } from '../csv.js'

type Deps = { systemDb: Db; appDb: Db; config: AppConfig }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Parse+borne `?limit=` depuis la query string : ignore les valeurs absentes/invalides/hors bornes
 * (retombe sur le défaut du repo plutôt que de 400 sur une query mal formée — cette route est
 * une simple lecture). */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return undefined
  return Math.min(n, MAX_LIMIT)
}

const VALID_STATUSES = ['lobby', 'active', 'ended', 'abandoned'] as const
type SessionStatus = (typeof VALID_STATUSES)[number]

/** Parse `?status=a,b` en un jeu de statuts valides ; ignore les valeurs inconnues. Renvoie
 * `undefined` si rien de valide (⇒ pas de filtre, comme une query absente). */
function parseStatuses(raw: unknown): SessionStatus[] | undefined {
  if (typeof raw !== 'string') return undefined
  const parsed = raw.split(',')
    .map((s) => s.trim())
    .filter((s): s is SessionStatus => (VALID_STATUSES as readonly string[]).includes(s))
  return parsed.length > 0 ? parsed : undefined
}

/** Section CSV : une ligne titre, une ligne d'en-têtes, puis les lignes de données. Deux sections
 * (joueurs, questions) séparées par une ligne vide dans le même fichier — plus simple à consommer
 * dans un tableur qu'un ZIP à deux fichiers, et les deux blocs sont clairement titrés. */
function buildReportCsv(report: SessionReport): string {
  const rows: (string | number | null)[][] = []

  rows.push([`Partie ${report.session.pin} — ${report.session.quizTitle}`])
  rows.push([])

  rows.push(['Joueurs'])
  rows.push(['Pseudo', 'Score total', 'Réponses correctes', 'Réponses données'])
  for (const p of report.players) {
    rows.push([p.nickname, p.totalScore, p.correctCount, p.answerCount])
  }
  rows.push([])

  rows.push(['Questions'])
  rows.push(['# ', 'Énoncé', 'Réponses données', 'Réponses correctes', 'Temps moyen (ms)'])
  for (const q of report.questions) {
    rows.push([q.orderIndex + 1, q.prompt, q.answerCount, q.correctCount, q.avgTimeMs])
  }

  return toCsv(rows, { bom: true })
}

export function registerReportRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, config } = deps

  app.get('/api/sessions', { preHandler: requireUser }, async (request, reply) => {
    const context = await resolveContextOr403(request, reply, systemDb, config)
    if (!context) return
    const query = request.query as { limit?: unknown; status?: unknown } | undefined
    const limit = parseLimit(query?.limit)
    const status = parseStatuses(query?.status)
    return withTenantTx(appDb, context, (scope) => listSessions(scope, { limit, status }))
  })

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      return withTenantTx(appDb, context, async (scope) => {
        const report = await getSessionReport(scope, request.params.sessionId)
        if (!report) return reply.code(404).send({ error: 'Partie introuvable.' })
        return report
      })
    },
  )

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/export.csv',
    { preHandler: requireUser },
    async (request, reply) => {
      const context = await resolveContextOr403(request, reply, systemDb, config)
      if (!context) return
      const report = await withTenantTx(appDb, context, (scope) => getSessionReport(scope, request.params.sessionId))
      if (!report) return reply.code(404).send({ error: 'Partie introuvable.' })

      // Nom de fichier dérivé du PIN (chiffres uniquement) : jamais le titre du quiz, texte
      // non-fiable saisi par l'hôte, qui ne doit jamais atterrir tel quel dans un en-tête HTTP.
      const pinDigits = report.session.pin.replace(/[^0-9]/g, '')
      const filename = `arena-partie-${pinDigits}.csv`

      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
      return buildReportCsv(report)
    },
  )
}
