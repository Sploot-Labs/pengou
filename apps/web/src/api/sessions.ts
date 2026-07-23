/**
 * Typed wrappers for the read-only session/report REST endpoints (Plan 07
 * Task 3: `apps/server/src/routes/sessions.ts`). Row shapes mirror
 * `SessionSummary`/`SessionReport` from `packages/db/src/repos/reports.ts`
 * exactly, verified by reading that file — with ONE deliberate deviation:
 * the repo types `startedAt`/`endedAt` as `Date | null`, but Fastify's JSON
 * serialization turns a `Date` into its ISO string on the wire, so this
 * client sees `string | null`, never a `Date` instance.
 */
import { apiGet } from './client'
import type { QuestionType } from './quizzes'

export type SessionStatus = 'lobby' | 'active' | 'ended'

export interface SessionSummary {
  id: string
  pin: string
  status: SessionStatus
  startedAt: string | null
  endedAt: string | null
  quizId: string
  quizTitle: string
  playerCount: number
}

export interface SessionReportQuestion {
  questionId: string
  prompt: string
  type: QuestionType
  orderIndex: number
  answerCount: number
  correctCount: number
  avgTimeMs: number | null
}

export interface SessionReportPlayer {
  playerId: string
  nickname: string
  totalScore: number
  correctCount: number
  answerCount: number
}

export interface SessionReport {
  session: {
    id: string
    pin: string
    status: SessionStatus
    startedAt: string | null
    endedAt: string | null
    quizId: string
    quizTitle: string
  }
  questions: SessionReportQuestion[]
  players: SessionReportPlayer[]
}

/** `GET /api/sessions?limit=` — sessions of the caller's tenant, most recent
 * first. `limit` is omitted from the query string entirely when not given
 * (the server falls back to its own default rather than this client
 * hardcoding one). */
export function listSessions(limit?: number): Promise<SessionSummary[]> {
  const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`
  return apiGet<SessionSummary[]>(`/api/sessions${query}`)
}

/** `GET /api/sessions/:id` — throws `ApiError` with `status === 404` when the
 * session doesn't exist or belongs to another tenant (never a distinct
 * "forbidden" — see the server route). */
export function getSessionReport(id: string): Promise<SessionReport> {
  return apiGet<SessionReport>(`/api/sessions/${id}`)
}

/** Same-origin URL for the CSV export (`GET /api/sessions/:id/export.csv`).
 * Deliberately NOT fetched via `apiGet`/`fetch` — it's meant to be used
 * directly as an `<a href>` so the browser's native download handling
 * applies (`Content-Disposition: attachment`) and the session cookie rides
 * along automatically, same-origin. Consumed by `SessionReport.tsx` (Task 5). */
export function sessionCsvUrl(id: string): string {
  return `/api/sessions/${id}/export.csv`
}
