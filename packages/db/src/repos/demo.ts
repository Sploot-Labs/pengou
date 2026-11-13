import { and, asc, desc, eq, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { user } from '../auth-schema.js'
import { demoDaily, gameSession, invitation, membership, quiz, tenant } from '../schema.js'

// Partie de démonstration sans compte : un hôte invité (`user.is_anonymous`) anime le quiz d'exemple
// dans son espace personnel. Toutes ces fonctions tournent sur la connexion privilégiée : elles
// regardent plusieurs espaces à la fois (plafond global, balayages) ou précèdent tout contexte.

const LIVE = ['lobby', 'active'] as const

/** Vrai si `userId` est un hôte invité. Faux pour un compte ordinaire comme pour un inconnu. */
export async function isGuestUser(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.isAnonymous === true
}

/** Nombre de parties vivantes (salon ou en cours) animées par un hôte invité, sur toute l'instance. */
export async function countLiveGuestSessions(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gameSession)
    .innerJoin(user, eq(user.id, gameSession.hostId))
    .where(and(inArray(gameSession.status, [...LIVE]), eq(user.isAnonymous, true)))
  return row?.n ?? 0
}

export type GuestDemo = {
  /** Espace personnel de l'invité, créé à sa naissance. */
  tenantId: string
  /** Son quiz de démonstration (le plus ancien non archivé), `null` tant qu'il n'est pas copié. */
  quizId: string | null
  /** Sa partie vivante la plus récente, `null` s'il n'en anime aucune. */
  liveSessionId: string | null
  /** Provenance `?from=` enregistrée à la création, `null` sans provenance. */
  source: string | null
}

/** Ce que l'on sait de la démonstration d'un invité. Lève si l'invité n'a pas d'espace. */
export async function findGuestDemo(db: Db, userId: string): Promise<GuestDemo> {
  const [space] = await db
    .select({ tenantId: membership.tenantId })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.role, 'owner')))
    .orderBy(asc(membership.createdAt))
    .limit(1)
  if (!space) throw new Error("findGuestDemo : l'invité n'a pas d'espace")
  const [ownQuiz] = await db
    .select({ id: quiz.id })
    .from(quiz)
    .where(and(eq(quiz.ownerId, userId), eq(quiz.tenantId, space.tenantId), isNull(quiz.archivedAt)))
    .orderBy(asc(quiz.createdAt))
    .limit(1)
  const [live] = await db
    .select({ id: gameSession.id })
    .from(gameSession)
    .where(and(eq(gameSession.hostId, userId), inArray(gameSession.status, [...LIVE])))
    .orderBy(desc(gameSession.createdAt))
    .limit(1)
  const [account] = await db.select({ source: user.signupSource }).from(user).where(eq(user.id, userId)).limit(1)
  return {
    tenantId: space.tenantId,
    quizId: ownQuiz?.id ?? null,
    liveSessionId: live?.id ?? null,
    source: account?.source ?? null,
  }
}

/**
 * Écrit sur le compte invité ce qu'il a accepté en lançant la démonstration (version des conditions
 * d'utilisation et horodatage serveur) et la provenance du lancement. Sans effet sur un compte
 * ordinaire : la garde `is_anonymous` fait partie de la requête.
 */
export async function setGuestAcceptance(
  db: Db,
  userId: string,
  input: { termsVersion: string | null; acceptedAt: Date; source: string | null },
): Promise<void> {
  await db
    .update(user)
    .set({
      termsVersion: input.termsVersion,
      termsAcceptedAt: input.termsVersion ? input.acceptedAt : null,
      signupSource: input.source,
    })
    .where(and(eq(user.id, userId), eq(user.isAnonymous, true)))
}

/**
 * Passe en `abandoned` les parties vivantes d'un hôte invité créées depuis plus de `maxAgeMs` : une
 * démonstration ne dure pas au-delà. Efface le checkpoint moteur et pose `ended_at`, comme le
 * balayage des parties inactives. Renvoie les identifiants pour le nettoyage mémoire de la passerelle.
 */
export async function abandonExpiredGuestSessions(db: Db, maxAgeMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const guests = db.select({ id: user.id }).from(user).where(eq(user.isAnonymous, true))
  const rows = await db
    .update(gameSession)
    .set({ status: 'abandoned', endedAt: new Date(), engineState: null })
    .where(
      and(
        inArray(gameSession.status, [...LIVE]),
        lt(gameSession.createdAt, cutoff),
        inArray(gameSession.hostId, guests),
      ),
    )
    .returning({ id: gameSession.id })
  return rows.map((r) => r.id)
}

/**
 * Supprime les hôtes invités créés depuis plus de `maxAgeMs` et qui n'animent aucune partie vivante,
 * avec tout ce qui leur appartient, et renvoie leur nombre. Un invité à la fois, chacun dans sa transaction : l'échec de l'un n'empêche
 * pas les suivants, et la première erreur est relancée une fois tous les invités tentés.
 *
 * Un espace n'est supprimé que si l'invité en est propriétaire et seul membre. La cascade du tenant
 * ne suffit pas : les questions, les joueurs et les réponses référencent le tenant sans cascade, et
 * Postgres refuse alors sa suppression. On supprime donc dans l'ordre les parties (leur cascade
 * emporte joueurs et réponses), les quiz (leur cascade emporte les questions), puis l'espace.
 * Dans tout autre espace, seuls les parties et les quiz de l'invité partent ; l'espace et le contenu
 * des autres membres restent.
 */
export async function purgeExpiredGuests(db: Db, maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  // Un invité qui anime encore une partie attend le passage suivant : le purger en pleine partie
  // laisserait l'hôte sans commandes et les joueurs devant un écran figé. La partie elle-même est
  // bornée par le balayage (durée d'une démonstration, inactivité), donc l'attente aussi.
  const hostingLive = db
    .select({ id: gameSession.hostId })
    .from(gameSession)
    .where(inArray(gameSession.status, [...LIVE]))
  const guests = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.isAnonymous, true), lt(user.createdAt, cutoff), notInArray(user.id, hostingLive)))
  let purged = 0
  let firstError: unknown
  for (const { id } of guests) {
    try {
      await deleteGuest(db, id)
      purged += 1
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
  return purged
}

/**
 * Supprime un hôte invité et ce qui lui appartient, dans une transaction. Sans effet sur un compte
 * ordinaire : chaque suppression de compte porte la garde `is_anonymous`. Sert à la purge et au
 * ménage d'un invité dont la création n'a pas abouti (`POST /api/demo`).
 */
export async function deleteGuest(db: Db, userId: string): Promise<void> {
  if (!(await isGuestUser(db, userId))) return
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ tenantId: membership.tenantId })
      .from(membership)
      .where(and(eq(membership.userId, userId), eq(membership.role, 'owner')))
    for (const { tenantId } of owned) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(membership)
        .where(and(eq(membership.tenantId, tenantId), ne(membership.userId, userId)))
      if ((others?.n ?? 0) > 0) continue
      await tx.delete(gameSession).where(eq(gameSession.tenantId, tenantId))
      await tx.delete(quiz).where(eq(quiz.tenantId, tenantId))
      await tx.delete(tenant).where(eq(tenant.id, tenantId))
    }
    // Ce qui reste à son nom dans un espace partagé : parties animées, parties jouées sur ses
    // quiz, quiz, invitations. Sans cela, la suppression du compte buterait sur ces références.
    const ownQuizzes = tx.select({ id: quiz.id }).from(quiz).where(eq(quiz.ownerId, userId))
    await tx.delete(gameSession).where(eq(gameSession.hostId, userId))
    await tx.delete(gameSession).where(inArray(gameSession.quizId, ownQuizzes))
    await tx.delete(quiz).where(eq(quiz.ownerId, userId))
    await tx.delete(invitation).where(eq(invitation.invitedBy, userId))
    // La cascade de `user` emporte ses sessions, ses comptes liés et ses adhésions.
    await tx.delete(user).where(and(eq(user.id, userId), eq(user.isAnonymous, true)))
  })
}

export type DemoDailyRow = { day: string; source: string; launched: number; started: number }

/** Compte une démonstration lancée ce jour-là (`AAAA-MM-JJ`, UTC) pour cette provenance. */
export async function recordDemoLaunched(db: Db, day: string, source: string): Promise<void> {
  await db
    .insert(demoDaily)
    .values({ day, source, launched: 1 })
    .onConflictDoUpdate({
      target: [demoDaily.day, demoDaily.source],
      set: { launched: sql`${demoDaily.launched} + 1` },
    })
}

/** Compte une partie de démonstration démarrée avec au moins un joueur. */
export async function recordDemoStarted(db: Db, day: string, source: string): Promise<void> {
  await db
    .insert(demoDaily)
    .values({ day, source, started: 1 })
    .onConflictDoUpdate({
      target: [demoDaily.day, demoDaily.source],
      set: { started: sql`${demoDaily.started} + 1` },
    })
}

/** Le compteur quotidien, du jour le plus récent au plus ancien. Agrégat seul, sans donnée de compte. */
export async function listDemoDaily(db: Db): Promise<DemoDailyRow[]> {
  return db
    .select({
      day: demoDaily.day,
      source: demoDaily.source,
      launched: demoDaily.launched,
      started: demoDaily.started,
    })
    .from(demoDaily)
    .orderBy(desc(demoDaily.day), asc(demoDaily.source))
}
