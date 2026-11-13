import type { FastifyInstance } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import {
  countLiveGuestSessions,
  deleteGuest,
  findGuestDemo,
  importQuiz,
  recordDemoLaunched,
  setGuestAcceptance,
  withTenantTx,
  type Db,
} from '@splootlabs/db'
import type { Auth } from '@splootlabs/auth'
import { normalizeSignupSource, type AppConfig } from '@splootlabs/shared'
import { pinFailureKey } from '../client-ip.js'
import { EXAMPLE_QUIZ } from '../example-quiz.js'
import { FailureBudget } from '../failure-budget.js'

type Deps = {
  systemDb: Db
  appDb: Db
  auth: Auth
  config: AppConfig
  /** Horloge injectée (tests) : budget par IP, horodatage de l'acceptation, jour du compteur. */
  now?: () => number
  /** Copie du quiz de démonstration dans l'espace de l'invité ; par défaut, le quiz d'exemple. */
  copyQuiz?: (tenantId: string, ownerId: string) => Promise<string>
}

/** Fenêtre du budget de démonstrations par IP. */
const DEMO_BUDGET_WINDOW_MS = 3_600_000

/** Même code que le refus d'inscription et la revalidation des CGU : le web le connaît déjà. */
const TERMS_ACCEPTANCE_REQUIRED = 'TERMS_ACCEPTANCE_REQUIRED'

const refusal = (error: string, code: string) => ({ error, code })

/**
 * Partie de démonstration sans compte : `POST /api/demo` est la seule porte d'entrée d'un hôte
 * invité (les points d'entrée du plugin `anonymous` de Better Auth sont fermés en HTTP). La route
 * crée l'invité, laisse le hook d'inscription lui créer son espace, y copie le quiz d'exemple et
 * rend ce qu'il faut au client pour lancer la partie par l'événement `host:create` habituel.
 *
 * Elle n'est appelée que par le clic sur « Lancer la démonstration » : une simple visite de `/demo`
 * (robot, aperçu de lien) ne crée rien. Le contrôle d'origine des requêtes mutantes s'y applique.
 *
 * Ordre des contrôles : fonction active, compte ordinaire déjà connecté (refus), invité déjà connecté
 * (réutilisation, sans rien consommer), acceptation, plafond global, budget par IP, création. Le
 * budget vient en dernier parce qu'il est lu et réservé d'un seul tenant, sans attente entre les
 * deux : des requêtes simultanées d'une même adresse ne peuvent pas toutes passer le contrôle.
 */
export function registerDemoRoutes(app: FastifyInstance, deps: Deps): void {
  const { systemDb, appDb, auth, config } = deps
  const now = deps.now ?? Date.now
  // Le budget compte les créations tentées une fois tous les autres contrôles passés. Il vit en
  // mémoire : un redémarrage le remet à zéro, ce qui convient à une instance unique (le plafond
  // global, lui, se lit en base).
  const budget = new FailureBudget({ max: config.demo.perIpPerHour, windowMs: DEMO_BUDGET_WINDOW_MS, now })

  const copyExampleQuiz =
    deps.copyQuiz ??
    (async (tenantId: string, ownerId: string): Promise<string> => {
      const quiz = await withTenantTx(appDb, { tenantId }, (scope) =>
        importQuiz(scope, { ownerId, source: null, ...EXAMPLE_QUIZ }),
      )
      return quiz.id
    })

  app.post('/api/demo', async (request, reply) => {
    if (!config.demo.enabled) {
      return reply.code(404).send(refusal("La démonstration n'est pas disponible sur cette instance.", 'DEMO_DISABLED'))
    }

    const headers = fromNodeHeaders(request.headers)
    const session = await auth.api.getSession({ headers })
    if (session?.user && session.user.isAnonymous !== true) {
      return reply
        .code(409)
        .send(refusal('Vous êtes déjà connecté : lancez un quiz depuis votre espace.', 'ALREADY_SIGNED_IN'))
    }
    if (session?.user) {
      // Second onglet, double clic, retour sur /demo : le même invité, la même démonstration.
      const demo = await findGuestDemo(systemDb, session.user.id)
      const quizId = demo.quizId ?? (await copyExampleQuiz(demo.tenantId, session.user.id))
      return reply.code(201).send({ quizId, tenantId: demo.tenantId, liveSessionId: demo.liveSessionId })
    }

    // Acceptation : comme à l'inscription, exigée dès que l'instance publie des conditions
    // d'utilisation. La case « J'ai 15 ans ou plus » et la version acceptée viennent du corps.
    const body = (request.body ?? {}) as { ageConfirmed?: unknown; acceptedTermsVersion?: unknown; from?: unknown }
    const termsVersion = config.legal?.termsVersion ?? null
    if (termsVersion) {
      if (body.ageConfirmed !== true) {
        return reply
          .code(400)
          .send(
            refusal('Confirmez que vous avez 15 ans ou plus pour lancer la démonstration.', TERMS_ACCEPTANCE_REQUIRED),
          )
      }
      if (body.acceptedTermsVersion !== termsVersion) {
        const message =
          typeof body.acceptedTermsVersion === 'string'
            ? "Les conditions d'utilisation ont changé. Rechargez la page pour lire et accepter la nouvelle version."
            : "Acceptez les conditions d'utilisation pour lancer la démonstration."
        return reply.code(400).send(refusal(message, TERMS_ACCEPTANCE_REQUIRED))
      }
    }

    if ((await countLiveGuestSessions(systemDb)) >= config.demo.maxConcurrent) {
      return reply
        .code(503)
        .send(
          refusal(
            'La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite.',
            'DEMO_FULL',
          ),
        )
    }
    // Lecture et réservation du budget sans aucun `await` entre les deux.
    const key = pinFailureKey(request.ip)
    if (budget.isBlocked(key)) {
      return reply
        .code(429)
        .send(
          refusal(
            'Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit.',
            'DEMO_RATE_LIMITED',
          ),
        )
    }
    budget.recordFailure(key)

    // Comme pour /api/auth/*, l'IP enregistrée avec la session est celle que Fastify a établie
    // (TRUSTED_PROXIES), jamais un X-Forwarded-For choisi par le client.
    headers.set('x-forwarded-for', request.ip)
    const created = await auth.api.signInAnonymous({ headers, returnHeaders: true })
    const userId = created.response?.user.id
    if (!userId) throw new Error("POST /api/demo : la création de l'invité n'a rendu aucun compte")
    const source = normalizeSignupSource(body.from)
    let demo: Awaited<ReturnType<typeof findGuestDemo>>
    let quizId: string
    try {
      await setGuestAcceptance(systemDb, userId, { termsVersion, acceptedAt: new Date(now()), source })
      demo = await findGuestDemo(systemDb, userId)
      quizId = await copyExampleQuiz(demo.tenantId, userId)
    } catch (error) {
      // L'invité existe mais sa démonstration n'a pas pu être préparée : il est supprimé, plutôt que
      // laissé sans quiz jusqu'à la purge, et son cookie de session n'est pas posé.
      await deleteGuest(systemDb, userId).catch((cleanup: unknown) =>
        request.log.error(cleanup, "démonstration : ménage de l'invité incomplet"),
      )
      throw error
    }
    const cookies = created.headers.getSetCookie()
    if (cookies.length > 0) reply.header('set-cookie', cookies)

    // Le compteur ne fait jamais échouer un lancement réussi.
    await recordDemoLaunched(systemDb, new Date(now()).toISOString().slice(0, 10), source ?? 'direct').catch(
      (error: unknown) => request.log.error(error, 'démonstration : lancement non compté'),
    )
    return reply.code(201).send({ quizId, tenantId: demo.tenantId, liveSessionId: null })
  })
}
