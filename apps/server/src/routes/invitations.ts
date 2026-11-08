import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify'
import { eq } from 'drizzle-orm'
import {
  withTenantTx,
  createInvitation,
  listInvitations,
  getInvitationById,
  revokeInvitation,
  resendInvitation,
  getInvitationByToken,
  acceptInvitation,
  newInvitationToken,
  invitationExpiry,
  markInvitationEmailed,
  InvitationError,
  schema,
  type Db,
  type Invitation,
} from '@splootlabs/db'
import {
  checkEmailDeliverable,
  DELIVERABILITY_MESSAGES,
  invitationMail,
  sendAndLog,
  type DnsResolver,
  type Mailer,
  type MailLogger,
} from '@splootlabs/mail'
import type { AppConfig, Role } from '@splootlabs/shared'
import { requireUser } from '../require-user.js'
import { requirePermission } from '../require-permission.js'
import { invitationEmailProof, isInvitationEmailProofValid } from '../invitation-proof.js'

export type InvitationDeps = {
  systemDb: Db
  appDb: Db
  config: AppConfig
  /** Absent : envoi désactivé, comme avec le mailer de repli. */
  mailer?: Mailer
  /** Journal des envois et du contrôle DNS ; par défaut celui de l'app. */
  mailLogger?: MailLogger
  /** Résolveur DNS injecté (tests : jamais de réseau). */
  resolver?: DnsResolver
  /** Limite de création et de renvoi par utilisateur ; par défaut active hors NODE_ENV=test. */
  invitationRateLimit?: boolean
}

/** 20 créations ou renvois d'invitation par heure et par utilisateur (cf. spec, limitation de débit). */
const INVITATION_RATE_LIMIT = { max: 20, timeWindow: '1 hour' } as const

async function workspaceName(systemDb: Db, tenantId: string): Promise<string> {
  const [row] = await systemDb
    .select({ name: schema.tenant.name })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId))
    .limit(1)
  return row?.name ?? ''
}

// Rôles invitables : jamais `owner` (l'ownership se transfère via PATCH members par un owner).
const INVITABLE_ROLES: Role[] = ['admin', 'member']

function isInvitableRole(value: unknown): value is Role {
  return typeof value === 'string' && (INVITABLE_ROLES as string[]).includes(value)
}

// Validation e-mail volontairement permissive (présence d'un `@` encadré) — la vérité, c'est
// l'acceptation authentifiée ; on borne surtout la longueur. La longueur est vérifiée avant la
// regex, et les libellés du domaine excluent le point : aucun retour arrière polynomial (ReDoS).
function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value)
}

function mapAcceptError(code: string): { status: number; error: string } {
  switch (code) {
    case 'not_found':
      return { status: 404, error: 'Invitation introuvable.' }
    case 'not_pending':
      return { status: 409, error: 'Cette invitation a déjà été utilisée ou révoquée.' }
    case 'expired':
      return { status: 410, error: 'Cette invitation a expiré.' }
    case 'already_member':
      return { status: 409, error: 'Vous êtes déjà membre de ce workspace.' }
    case 'inviter_revoked':
      return { status: 409, error: "Cette invitation n'est plus valable." }
    default:
      return { status: 400, error: 'Invitation invalide.' }
  }
}

/** Vue publique (au porteur du token) d'une invitation. Ne divulgue que ce que le token autorise. */
function publicInvitation(inv: Awaited<ReturnType<typeof getInvitationByToken>>, nowMs: number) {
  if (!inv) return null
  return {
    email: inv.email,
    role: inv.role,
    status: inv.status,
    workspaceName: inv.workspaceName,
    workspaceSlug: inv.workspaceSlug,
    expired: inv.expiresAt.getTime() < nowMs,
    expiresAt: inv.expiresAt,
  }
}

/**
 * Invitations (Slice 3b). Endpoints de GESTION (`:tenantId`) gardés par
 * `requirePermission('members:manage')`, sur appDb+withTenantTx (RLS invitation). Endpoints par
 * TOKEN (preview/accept) gardés par `requireUser` seulement, sur systemDb (pré-contexte, le
 * destinataire n'est pas encore membre). La création et le renvoi envoient l'e-mail d'invitation
 * une fois l'invitation enregistrée (si un mailer est actif) et répondent `emailSent` ; la réponse
 * porte toujours le token, le client garde le lien copiable. En mode multi, un invitant à l'adresse
 * non confirmée n'envoie rien : `emailSkipped: 'inviter_unverified'`.
 */
export function registerInvitationRoutes(app: FastifyInstance, deps: InvitationDeps): void {
  const { systemDb, appDb, config, mailer } = deps
  const mailLogger: MailLogger = deps.mailLogger ?? app.log
  // Même secret que Better Auth (cf. index.ts) : la preuve du lien e-mailé en dépend.
  const proofSecret = config.authSecret ?? config.sessionSecret
  const guard = { preHandler: [requireUser, requirePermission(systemDb, 'members:manage')] }

  // Limite propre à la création et au renvoi, en plus de la limite globale par IP. Un seul
  // compteur partagé par les deux routes. Le contrôle tourne en preHandler APRÈS requireUser, la
  // clé est donc l'utilisateur connecté. On passe par `createRateLimit` (contrôle brut) : le
  // gestionnaire `app.rateLimit()` ne s'exécute qu'une fois par requête, et la limite globale
  // l'a déjà consommé au onRequest. Désactivée en test, sauf dans les tests dédiés.
  const rateLimitEnabled = deps.invitationRateLimit ?? config.nodeEnv !== 'test'
  let sendGuard: { preHandler: preHandlerHookHandler[] } = guard
  if (rateLimitEnabled) {
    const check = app.createRateLimit({
      ...INVITATION_RATE_LIMIT,
      keyGenerator: (req: FastifyRequest) => `invitation:${req.user?.id ?? req.ip}`,
    })
    const limitInvitations: preHandlerHookHandler = async (request, reply) => {
      if (reply.sent) return
      const result = await check(request)
      if (result.isAllowed || !result.isExceeded) return
      reply.header('retry-after', result.ttlInSeconds)
      return reply.code(429).send({ error: "Trop d'invitations envoyées en une heure. Réessayez plus tard." })
    }
    sendGuard = { preHandler: [...guard.preHandler, limitInvitations] }
  }

  /** Envoie l'invitation et note l'envoi réussi. Ne lève jamais : un échec laisse l'invitation telle quelle. */
  async function sendInvitation(
    request: FastifyRequest,
    tenantId: string,
    invitation: Invitation,
  ): Promise<{ invitation: Invitation; emailSent: boolean; emailSkipped?: 'inviter_unverified' }> {
    if (!mailer?.enabled) return { invitation, emailSent: false }
    // Inscription ouverte (mode multi) : un compte à l'adresse non confirmée ne fait pas envoyer
    // d'e-mail par Pengou à une adresse de son choix (réputation de l'expéditeur). L'invitation
    // existe, le lien reste copiable.
    if (config.tenancyMode === 'multi' && !request.user.emailVerified) {
      return { invitation, emailSent: false, emailSkipped: 'inviter_unverified' }
    }
    let sent = false
    try {
      const rendered = invitationMail({
        baseUrl: config.authUrl,
        // Seul le lien e-mailé porte la preuve `v` ; l'API ne renvoie que le token nu.
        url: `${config.authUrl}/invitations/${invitation.token}?v=${invitationEmailProof(proofSecret, invitation.token)}`,
        inviterName: request.user.name?.trim() || request.user.email,
        workspaceName: await workspaceName(systemDb, tenantId),
        role: invitation.role === 'admin' ? 'admin' : 'member',
        expiresAt: invitation.expiresAt,
      })
      const mail = { ...rendered, to: invitation.email, kind: 'invitation' as const }
      // Libellé du transport configuré (un mailer de test injecté garde ce libellé) ; un mailer
      // désactivé n'arrive jamais ici.
      sent = await sendAndLog(mailer, mail, mailLogger, config.mail.transport)
      if (!sent) return { invitation, emailSent: false }
      const emailedAt = new Date()
      await withTenantTx(appDb, { tenantId }, (scope) => markInvitationEmailed(scope, invitation.id, emailedAt))
      return { invitation: { ...invitation, emailedAt }, emailSent: true }
    } catch (error) {
      // Gabarit ou base en échec (l'envoi lui-même ne lève pas). Si l'e-mail est parti, seul le
      // marquage manque : l'acceptation ne confirmera pas l'adresse. On ne journalise que le nom
      // de l'erreur, un message SQL pourrait citer le token ou l'adresse.
      mailLogger.error(
        { kind: 'invitation', err: error instanceof Error ? error.name : 'Error' },
        sent ? "E-mail d'invitation parti, envoi non enregistré" : "E-mail d'invitation non préparé",
      )
      return { invitation, emailSent: sent }
    }
  }

  app.get<{ Params: { tenantId: string } }>('/api/workspaces/:tenantId/invitations', guard, async (request) => {
    const { tenantId } = request.workspace!
    const invitations = await withTenantTx(appDb, { tenantId }, (scope) =>
      listInvitations(scope, { status: 'pending' }),
    )
    // Jamais de jeton dans la liste : il n'est remis qu'à la création et au renvoi, à celui qui en
    // devient l'auteur. Sinon tout gestionnaire lirait les jetons des invitations des autres.
    return { invitations: invitations.map(({ token: _token, ...rest }) => rest) }
  })

  app.post<{ Params: { tenantId: string } }>(
    '/api/workspaces/:tenantId/invitations',
    sendGuard,
    async (request, reply) => {
      const { tenantId } = request.workspace!
      const body = request.body as { email?: unknown; role?: unknown } | undefined
      if (!isEmail(body?.email)) return reply.code(400).send({ error: 'E-mail invalide.' })
      const role: Role = isInvitableRole(body?.role) ? body.role : 'member'
      const deliverability = await checkEmailDeliverable(body.email as string, {
        dns: config.emailDomainCheck,
        resolver: deps.resolver,
        logger: mailLogger,
      })
      if (deliverability !== 'ok') return reply.code(400).send({ error: DELIVERABILITY_MESSAGES[deliverability] })

      const token = newInvitationToken()
      const expiresAt = invitationExpiry()
      const invitation = await withTenantTx(appDb, { tenantId }, (scope) =>
        createInvitation(scope, { email: body.email as string, role, invitedBy: request.user.id, token, expiresAt }),
      )
      return reply.code(201).send(await sendInvitation(request, tenantId, invitation))
    },
  )

  app.post<{ Params: { tenantId: string; id: string } }>(
    '/api/workspaces/:tenantId/invitations/:id/resend',
    sendGuard,
    async (request, reply) => {
      const { tenantId } = request.workspace!
      const token = newInvitationToken()
      const expiresAt = invitationExpiry()
      const invitation = await withTenantTx(appDb, { tenantId }, (scope) =>
        resendInvitation(scope, request.params.id, { token, expiresAt, invitedBy: request.user.id }),
      )
      if (!invitation) return reply.code(404).send({ error: 'Invitation en attente introuvable.' })
      return sendInvitation(request, tenantId, invitation)
    },
  )

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/api/workspaces/:tenantId/invitations/:id',
    guard,
    async (request, reply) => {
      const { tenantId } = request.workspace!
      const invitation = await withTenantTx(appDb, { tenantId }, async (scope) => {
        const existing = await getInvitationById(scope, request.params.id)
        if (!existing) return null
        return revokeInvitation(scope, request.params.id)
      })
      if (!invitation) return reply.code(404).send({ error: 'Invitation en attente introuvable.' })
      return { ok: true }
    },
  )

  // --- Endpoints par token (pré-contexte, systemDb) ---

  // Aperçu PUBLIC (pas de requireUser) : le token est la capacité (bearer). Permet à un invité qui
  // n'a pas encore de compte de voir dans quel workspace il est invité avant de s'inscrire. Ne
  // divulgue que le strict nécessaire (nom du workspace, e-mail invité, rôle, expiration).
  app.get<{ Params: { token: string } }>('/api/invitations/:token', async (request, reply) => {
    const inv = await getInvitationByToken(systemDb, request.params.token)
    const view = publicInvitation(inv, Date.now())
    if (!view) return reply.code(404).send({ error: 'Invitation introuvable.' })
    return view
  })

  app.post<{ Params: { token: string } }>(
    '/api/invitations/:token/accept',
    { preHandler: requireUser },
    async (request, reply) => {
      try {
        // `v` : preuve du lien e-mailé. Absente (lien copié) ou fausse, l'acceptation réussit mais ne
        // confirme pas l'adresse.
        const { token } = request.params
        const proof = (request.body as { v?: unknown } | undefined)?.v
        const result = await acceptInvitation(systemDb, {
          token,
          userId: request.user.id,
          emailProofValid: isInvitationEmailProofValid(proofSecret, token, proof),
        })
        return reply.code(200).send(result)
      } catch (e) {
        if (e instanceof InvitationError) {
          const { status, error } = mapAcceptError(e.code)
          return reply.code(status).send({ error })
        }
        throw e
      }
    },
  )
}
