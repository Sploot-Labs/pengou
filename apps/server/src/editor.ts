import type { FastifyInstance } from 'fastify'
import type { Db } from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import type { AppConfig } from '@splootlabs/shared'
import type { Mailer } from '@splootlabs/mail'
import { registerRequireUser } from './require-user.js'
import { registerQuizRoutes } from './routes/quizzes.js'
import { registerQuestionRoutes } from './routes/questions.js' // Task 5
import { registerReportRoutes } from './routes/sessions.js'
import { registerWorkspaceRoutes } from './routes/workspaces.js' // Slice 3a
import { registerMemberRoutes } from './routes/members.js' // Slice 3b
import { registerInvitationRoutes, type InvitationDeps } from './routes/invitations.js' // Slice 3b
import { registerLibraryRoutes } from './routes/library.js' // Bibliothèque de questions

export function registerEditor(
  app: FastifyInstance,
  // `mailer` et les options d'envoi servent aux routes d'invitation ; sans mailer, l'envoi est
  // désactivé (routes de test qui n'en ont pas besoin).
  deps: { systemDb: Db; appDb: Db; auth: Auth; config: AppConfig; mailer?: Mailer }
    & Pick<InvitationDeps, 'mailLogger' | 'resolver' | 'invitationRateLimit'>,
): void {
  registerRequireUser(app, deps.auth)
  const routeDeps = { systemDb: deps.systemDb, appDb: deps.appDb, config: deps.config }
  registerQuizRoutes(app, routeDeps)
  registerQuestionRoutes(app, routeDeps) // Task 5
  registerReportRoutes(app, routeDeps)
  registerWorkspaceRoutes(app, routeDeps) // Slice 3a : gestion des workspaces
  registerMemberRoutes(app, routeDeps) // Slice 3b : gestion des membres
  registerInvitationRoutes(app, {
    ...routeDeps,
    mailer: deps.mailer,
    mailLogger: deps.mailLogger,
    resolver: deps.resolver,
    invitationRateLimit: deps.invitationRateLimit,
  }) // Slice 3b : invitations, envoyées par e-mail
  registerLibraryRoutes(app, routeDeps) // Bibliothèque de questions
}
// NOTE : les routes 3b (membres/invitations) sont enregistrées ci-dessus ; leurs fichiers sont
// livrés dans le même chantier. Voir routes/members.ts, routes/invitations.ts, require-permission.ts.
