# Partie de démonstration sans compte : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un visiteur du site ouvre `/demo`, coche « J'ai 15 ans ou plus », clique sur « Lancer la démonstration » et arrive dans le salon d'une vraie partie du quiz d'exemple, sans créer de compte.

**Architecture:** Le serveur crée un hôte invité avec le plugin `anonymous` de Better Auth (colonne `user.is_anonymous`), appelé uniquement depuis la route `POST /api/demo` ; l'invité reçoit son espace personnel par le hook d'inscription existant, puis le quiz d'exemple. La passerelle temps réel reste inchangée dans son principe : elle borne seulement le nombre de joueurs, de parties simultanées et la durée quand l'hôte est invité. Un balayage supprime les invités de plus de vingt-quatre heures avec leur espace.

**Tech Stack:** TypeScript, Fastify, Better Auth 1.7 (`better-auth/plugins/anonymous`), Drizzle + Postgres (RLS), Socket.IO, React + Vite + react-router, Vitest + Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-13-partie-de-demonstration-design.md`

## Global Constraints

- Variables et défauts : `DEMO_ENABLED` (`'true'` ou `'false'`, défaut `'false'`), `DEMO_MAX_PLAYERS` (30), `DEMO_MAX_CONCURRENT` (20), `DEMO_PER_IP_PER_HOUR` (5). `DEMO_ENABLED=true` avec `TENANCY_MODE=single` fait échouer `loadConfig`.
- Durées : une partie de démonstration vit 60 minutes au plus après sa création (`DEMO_SESSION_MAX_AGE_MS = 3_600_000`) ; un invité et son espace sont supprimés 24 heures après sa création (`GUEST_MAX_AGE_MS = 86_400_000`) ; la fenêtre du budget par IP est d'une heure.
- Le quiz joué est `EXAMPLE_QUIZ` (`apps/server/src/example-quiz.ts`), sans variante.
- Seule `POST /api/demo` crée un invité. `/api/auth/sign-in/anonymous` et `/api/auth/delete-anonymous-user` répondent 404 en HTTP, fonction active ou non.
- Un invité n'accède en REST qu'à `GET /api/me`, `GET /api/workspaces`, `GET /api/quizzes`, `POST /api/demo` et aux routes publiques. Toute autre route protégée lui répond 403 avec `code: 'GUEST_NOT_ALLOWED'`.
- L'acceptation est exigée côté serveur : corps `ageConfirmed: true` et `acceptedTermsVersion` égal à la version courante quand `LEGAL_TERMS_VERSION` est défini. La version et l'horodatage sont écrits sur le compte invité.
- Aucune donnée personnelle dans le compteur quotidien : date, provenance (slug de `normalizeSignupSource`, ou `direct`), deux nombres.
- Textes de l'interface au vouvoiement, sans tiret cadratin, apostrophe droite, guillemets français. Chaînes JS contenant une apostrophe entre guillemets doubles. Fichiers en fins de ligne LF.
- Migrations écrites à la main (pas d'instantané drizzle depuis 0015) : fichier SQL plus entrée de `packages/db/drizzle/meta/_journal.json`, `idx` suivant et `when` strictement croissant. La dernière entrée est `0025_signup_source`.
- Chaque tâche se termine par `pnpm check`, `pnpm typecheck` et les tests cités, tous verts, puis un commit au format Conventional Commits en français.

## Review Focus

1. Rechargement de `/host/:sessionId` par l'invité en pleine partie : la partie reprend (`host:reconnect`), avec le même plafond de 30 joueurs. Test en tâche 5 (reprise après réhydratation) et en tâche 6 (garde `allowGuest`).
2. Double clic ou second onglet sur « Lancer la démonstration » : un seul invité, une seule partie vivante ; le second appel renvoie `liveSessionId` et ne consomme pas le budget par IP. Test en tâche 4.
3. Cookie d'un invité déjà purgé ou expiré : `POST /api/demo` le traite comme un visiteur neuf et crée un nouvel invité, sans erreur 500. Test en tâche 4.
4. Inscription par e-mail faite avec le cookie d'invité encore présent : un compte ordinaire naît avec son propre espace, l'invité reste intact jusqu'à la purge, et la purge ne supprime jamais un espace qui a un autre membre ni l'espace d'un utilisateur non invité. Tests en tâche 2 (inscription) et en tâche 3 (purge).
5. Vingt et unième démonstration quand vingt sont vivantes, y compris par vingt-cinq lancements simultanés : refus net, aucun invité orphelin laissé avec une partie au-delà du plafond. Tests en tâche 4 (refus avant création) et en tâche 5 (refus dans `host:create`).

---

### Task 1: Configuration de la démonstration

**Files:**
- Modify: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/config.test.ts`
- Modify: `.env.example`, `docker-compose.prod.yml`

**Interfaces:**
- Produces: `AppConfig.demo: { enabled: boolean; maxPlayers: number; maxConcurrent: number; perIpPerHour: number }`.

- [ ] **Step 1: Tests en échec** dans `config.test.ts`, bloc `describe('loadConfig, démonstration sans compte')` :

```ts
it('est éteinte par défaut, avec les plafonds de la proposition', () => {
  expect(loadConfig({}).demo).toEqual({ enabled: false, maxPlayers: 30, maxConcurrent: 20, perIpPerHour: 5 })
})
it('s active en mode multi', () => {
  expect(loadConfig({ DEMO_ENABLED: 'true', TENANCY_MODE: 'multi' }).demo.enabled).toBe(true)
})
it('refuse DEMO_ENABLED=true en mode single', () => {
  expect(() => loadConfig({ DEMO_ENABLED: 'true' })).toThrow(/DEMO_ENABLED.*TENANCY_MODE=multi/)
})
it('lit les plafonds et refuse zéro', () => {
  const env = { DEMO_MAX_PLAYERS: '12', DEMO_MAX_CONCURRENT: '3', DEMO_PER_IP_PER_HOUR: '2' }
  expect(loadConfig(env).demo).toMatchObject({ maxPlayers: 12, maxConcurrent: 3, perIpPerHour: 2 })
  expect(() => loadConfig({ DEMO_MAX_PLAYERS: '0' })).toThrow()
})
```

- [ ] **Step 2: Vérifier l'échec.** Run: `pnpm vitest run packages/shared/src/config.test.ts`. Expected: FAIL, `demo` indéfini.
- [ ] **Step 3: Implémenter** les quatre variables dans `EnvSchema` (`z.enum(['true', 'false']).default('false')` et `z.coerce.number().int().positive()`), le champ `demo` dans `AppConfig` et `loadConfig`, et le refus « Configuration invalide : DEMO_ENABLED=true demande TENANCY_MODE=multi. », à la manière des contrôles croisés déjà présents (`MAIL_FROM`, `LEGAL_TERMS_URL`).
- [ ] **Step 4: Vérifier le passage.** Même commande. Expected: PASS.
- [ ] **Step 5: Documenter** les quatre variables, commentées et éteintes, dans `.env.example` et `docker-compose.prod.yml` (une ligne chacune : rôle et défaut).
- [ ] **Step 6: Commit** `feat(demo): configuration de la démonstration sans compte`.

### Task 2: Compte invité et restriction des routes

**Files:**
- Create: `packages/db/drizzle/0026_user_is_anonymous.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`, `packages/db/src/auth-schema.ts`
- Modify: `packages/auth/src/auth.ts`, `packages/auth/src/auth.test.ts`
- Modify: `apps/server/src/auth-plugin.ts`, `apps/server/src/auth-plugin.test.ts`
- Modify: `apps/server/src/require-user.ts`, `apps/server/src/require-user.test.ts`
- Modify: `apps/server/src/app.ts` (type `FastifyContextConfig`), `apps/server/src/routes/workspaces.ts`, `apps/server/src/routes/quizzes.ts`
- Test: `apps/server/src/guest-e2e.test.ts` (nouveau, sur le modèle de `example-quiz-e2e.test.ts`)

**Interfaces:**
- Produces: colonne `user.is_anonymous boolean NOT NULL DEFAULT false`, champ drizzle `user.isAnonymous`.
- Produces: `auth.api.signInAnonymous({ headers, returnHeaders: true })`, disponible sur toute instance de `createAuth` (plugin toujours chargé).
- Produces: `request.user.isAnonymous: boolean` ; option de route `config: { guestAllowed: true }` ; constante `GUEST_NOT_ALLOWED = 'GUEST_NOT_ALLOWED'` exportée par `require-user.ts`.

- [ ] **Step 1: Migration.** `0026_user_is_anonymous.sql` contient uniquement `ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;`. Entrée de journal `idx: 26`, `tag: "0026_user_is_anonymous"`, `when: 1794614400000`. Champ `isAnonymous: boolean('is_anonymous').default(false).notNull()` dans `auth-schema.ts`.
- [ ] **Step 2: Tests en échec** dans `auth.test.ts` :

```ts
it('crée un invité sans adresse réelle, avec son espace en mode multi', async () => {
  const auth = createAuth(db, { secret, baseURL, tenancyMode: 'multi' })
  const { response } = await auth.api.signInAnonymous({ headers: new Headers(), returnHeaders: true })
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, response.user.id))
  expect(row.isAnonymous).toBe(true)
  expect(row.name).toBe('Invité')
  expect(row.email.endsWith('@invite.invalid')).toBe(true)
  expect(await listUserWorkspaces(db, row.id)).toHaveLength(1)
})
it('laisse l invité en place quand un compte ordinaire est créé avec son cookie', async () => {
  // signInAnonymous, puis signUpEmail avec les cookies reçus : deux lignes user, l'invité toujours là.
})
```

- [ ] **Step 3: Implémenter** dans `createAuth` : `plugins: [anonymous({ disableDeleteAnonymousUser: true, emailDomainName: 'invite.invalid', generateName: () => 'Invité' })]`, import depuis `better-auth/plugins`. Le hook `user.create.after` existant crée l'espace sans changement.
- [ ] **Step 4: Tests en échec** dans `auth-plugin.test.ts` : `POST /api/auth/sign-in/anonymous` et `POST /api/auth/delete-anonymous-user` répondent 404 et n'écrivent aucune ligne `user`.
- [ ] **Step 5: Implémenter** le refus dans `registerAuth`, avant `authHandler`, par comparaison du chemin sans query.
- [ ] **Step 6: Tests en échec** dans `require-user.test.ts` et `guest-e2e.test.ts` (application en mode multi, invité créé par `auth.api.signInAnonymous`, cookie rejoué) :

```ts
it.each([
  ['POST', '/api/quizzes'], ['POST', '/api/quizzes/example'], ['GET', '/api/library/themes'],
  ['POST', '/api/workspaces'], ['GET', '/api/sessions'], ['POST', '/api/media'],
])('refuse %s %s à un invité', async (method, url) => {
  const res = await app.inject({ method, url, headers: guestHeaders })
  expect(res.statusCode).toBe(403)
  expect(res.json().code).toBe('GUEST_NOT_ALLOWED')
})
it('laisse l invité lire ses espaces et ses quiz', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/workspaces', headers: guestHeaders })).statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/quizzes', headers: guestHeaders })).statusCode).toBe(200)
})
it('ne change rien pour un compte ordinaire', async () => { /* POST /api/quizzes répond 201 */ })
```

- [ ] **Step 7: Implémenter** dans `requireUser` : après le contrôle des CGU, si `session.user.isAnonymous === true` et `request.routeOptions.config.guestAllowed !== true`, répondre 403 `{ error: 'Créez un compte gratuit pour utiliser cette fonction.', code: GUEST_NOT_ALLOWED }` en renvoyant `reply`. Renseigner `request.user.isAnonymous`. Déclarer `guestAllowed?: boolean` à côté de `spaAsset` dans `app.ts`. Poser `config: { guestAllowed: true }` sur `GET /api/workspaces` et `GET /api/quizzes` seulement.
- [ ] **Step 8: Vérifier.** Run: `pnpm vitest run packages/auth apps/server/src/auth-plugin.test.ts apps/server/src/require-user.test.ts apps/server/src/guest-e2e.test.ts`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(demo): compte invité restreint aux routes de lecture de la partie`.

### Task 3: Dépôt de base de données de la démonstration

**Files:**
- Create: `packages/db/drizzle/0027_demo_daily.sql`, `packages/db/src/repos/demo.ts`, `packages/db/src/repos/demo.test.ts`
- Modify: `packages/db/drizzle/meta/_journal.json`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `user.isAnonymous` (tâche 2).
- Produces, toutes sur la connexion privilégiée (`Db`) :
  - `countLiveGuestSessions(db: Db): Promise<number>` : parties `lobby` ou `active` dont l'hôte est invité.
  - `findGuestDemo(db: Db, userId: string): Promise<{ tenantId: string; quizId: string | null; liveSessionId: string | null; source: string | null }>` : l'espace de l'invité, son quiz non archivé le plus ancien, sa partie `lobby` ou `active` la plus récente, et son `signup_source`.
  - `isGuestUser(db: Db, userId: string): Promise<boolean>`.
  - `setGuestAcceptance(db: Db, userId: string, input: { termsVersion: string | null; acceptedAt: Date; source: string | null }): Promise<void>` : écrit `terms_version`, `terms_accepted_at`, `signup_source`.
  - `abandonExpiredGuestSessions(db: Db, maxAgeMs: number): Promise<string[]>` : passe en `abandoned` (avec `ended_at`, `engine_state` à null) les parties `lobby` ou `active` d'un hôte invité créées avant le seuil, renvoie leurs identifiants.
  - `purgeExpiredGuests(db: Db, maxAgeMs: number): Promise<number>` : supprime les invités créés avant le seuil et renvoie leur nombre.
  - `recordDemoLaunched(db: Db, day: string, source: string): Promise<void>` et `recordDemoStarted(db: Db, day: string, source: string): Promise<void>` (`day` au format `AAAA-MM-JJ`, UTC).
  - `listDemoDaily(db: Db): Promise<Array<{ day: string; source: string; launched: number; started: number }>>`, du plus récent au plus ancien.

- [ ] **Step 1: Migration.** Table `demo_daily` : `day date NOT NULL`, `source text NOT NULL`, `launched integer NOT NULL DEFAULT 0`, `started integer NOT NULL DEFAULT 0`, clé primaire `(day, source)`. Aucun droit pour `app_role` : la table n'est lue et écrite que par la connexion privilégiée. Journal `idx: 27`, `tag: "0027_demo_daily"`, `when: 1794700800000`. Table drizzle `demoDaily` dans `schema.ts`.
- [ ] **Step 2: Tests en échec** dans `demo.test.ts` (base de test par `startTestDb`, modèle `signups.test.ts`) :

```ts
it('compte les seules parties vivantes d un hôte invité', ...)          // 1 invité lobby, 1 invité ended, 1 compte ordinaire lobby => 1
it('retrouve l espace, le quiz et la partie vivante d un invité', ...)
it('abandonne les parties d invité de plus d une heure, pas les autres', ...)
it('purge l invité de plus de 24 h avec son espace, ses quiz, parties, joueurs et réponses', async () => {
  // après purge : plus de ligne user, tenant, membership, quiz, question, game_session, session_player, answer
  expect(await purgeExpiredGuests(db, 86_400_000)).toBe(1)
})
it('ne purge ni un invité récent ni un compte ordinaire ancien', ...)
it('ne supprime pas un espace qui a un autre membre', ...)               // l'invité est retiré, l'espace reste
it('cumule les lancements et les parties démarrées par jour et par provenance', async () => {
  await recordDemoLaunched(db, '2026-11-13', 'accueil'); await recordDemoLaunched(db, '2026-11-13', 'accueil')
  await recordDemoStarted(db, '2026-11-13', 'accueil')
  expect(await listDemoDaily(db)).toEqual([{ day: '2026-11-13', source: 'accueil', launched: 2, started: 1 }])
})
```

- [ ] **Step 3: Implémenter `purgeExpiredGuests`.** Pour chaque invité échu, dans une transaction : supprimer les espaces dont il est membre `owner` et qui n'ont aucun autre membre (la cascade du tenant emporte quiz, questions, parties, joueurs et réponses), puis supprimer ses quiz et ses parties restants dans d'autres espaces s'il y en a, puis la ligne `user` (la cascade emporte `session`, `account` et `membership`). Une erreur sur un invité est journalisée par l'appelant et n'arrête pas les suivants : la fonction traite les invités un par un et relance la première erreur seulement après avoir tenté les autres.
- [ ] **Step 4: Implémenter le reste**, `recordDemo*` en `INSERT ... ON CONFLICT (day, source) DO UPDATE SET <colonne> = demo_daily.<colonne> + 1`. Exporter depuis `packages/db/src/index.ts`.
- [ ] **Step 5: Vérifier.** Run: `pnpm vitest run packages/db/src/repos/demo.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(demo): dépôt des invités, de leur purge et du compteur quotidien`.

### Task 4: Route `POST /api/demo`

**Files:**
- Create: `apps/server/src/routes/demo.ts`, `apps/server/src/demo-e2e.test.ts`
- Modify: `apps/server/src/editor.ts` (enregistrement), `apps/server/src/auth-plugin.ts` (`/api/auth-features`), `apps/server/src/index.ts` (option `demoEnabled`)

**Interfaces:**
- Consumes: `config.demo` (tâche 1), `auth.api.signInAnonymous` (tâche 2), le dépôt de la tâche 3, `importQuiz`, `EXAMPLE_QUIZ`, `FailureBudget`, `pinFailureKey` (`client-ip.ts`), `normalizeSignupSource`.
- Produces: `registerDemoRoutes(app, deps: { systemDb: Db; appDb: Db; auth: Auth; config: AppConfig; now?: () => number })`.
- Produces: `POST /api/demo`, corps `{ ageConfirmed?: unknown; acceptedTermsVersion?: unknown; from?: unknown }`, réponse 201 `{ quizId: string; tenantId: string; liveSessionId: string | null }` avec les en-têtes `set-cookie` de la session invitée.
- Produces: refus `{ error: string; code: string }` avec les codes `DEMO_DISABLED` (404), `ALREADY_SIGNED_IN` (409), `TERMS_ACCEPTANCE_REQUIRED` (400), `DEMO_RATE_LIMITED` (429), `DEMO_FULL` (503).
- Produces: `GET /api/auth-features` renvoie aussi `demoEnabled: boolean`.

Ordre des contrôles, à respecter : fonction active, puis compte ordinaire déjà connecté (refus 409), puis invité déjà connecté (réutilisation), puis acceptation, puis budget par IP, puis plafond global, puis création. La provenance enregistrée est `normalizeSignupSource(from) ?? 'direct'` pour le compteur, et `normalizeSignupSource(from)` pour `signup_source`.

- [ ] **Step 1: Tests en échec** dans `demo-e2e.test.ts` (application multi, `DEMO_ENABLED=true`, `LEGAL_TERMS_VERSION` défini, `now` injecté) :

```ts
it('répond 404 DEMO_DISABLED quand la fonction est éteinte', ...)
it('refuse sans la case d âge, puis sans la version des CGU', async () => {
  // 400 TERMS_ACCEPTANCE_REQUIRED dans les deux cas, aucune ligne user créée
  // messages : « Confirmez que vous avez 15 ans ou plus pour lancer la démonstration. »
  //            « Acceptez les conditions d'utilisation pour lancer la démonstration. »
})
it('crée l invité, son espace et le quiz d exemple de cinq questions', async () => {
  const res = await post({ ageConfirmed: true, acceptedTermsVersion: TERMS, from: 'Accueil' })
  expect(res.statusCode).toBe(201)
  expect(res.json().liveSessionId).toBeNull()
  // user : is_anonymous vrai, terms_version = TERMS, signup_source = 'accueil'
  // quiz : titre de EXAMPLE_QUIZ, 5 questions, dans le tenant renvoyé
  // demo_daily : { source: 'accueil', launched: 1, started: 0 }
})
it('enregistre la provenance « direct » sans paramètre from valide', ...)
it('réutilise l invité déjà connecté sans consommer le budget', async () => {
  // second POST avec le cookie : même tenantId et quizId, toujours 1 ligne user invitée, launched reste à 1
})
it('repart de zéro avec le cookie d un invité purgé', ...)           // 201, nouvel invité
it('bloque la sixième création de l heure pour une même IP, puis rouvre après une heure', ...) // 429 DEMO_RATE_LIMITED
it('refuse quand vingt démonstrations sont vivantes, sans créer d invité', ...)                 // 503 DEMO_FULL
it('refuse une origine étrangère', ...)                               // 403 du contrôle d'origine existant
it('ne crée rien pour un compte ordinaire connecté', ...)             // 409, code 'ALREADY_SIGNED_IN'
```

- [ ] **Step 2: Vérifier l'échec.** Run: `pnpm vitest run apps/server/src/demo-e2e.test.ts`. Expected: FAIL, route absente.
- [ ] **Step 3: Implémenter `registerDemoRoutes`.** La route n'utilise pas `requireUser` : elle lit la session elle-même (`auth.api.getSession`). Budget : `new FailureBudget({ max: config.demo.perIpPerHour, windowMs: 3_600_000, now })`, clé `pinFailureKey(request.ip)`, `isBlocked` avant la création et `recordFailure` après une création réussie. Création : `auth.api.signInAnonymous({ headers: fromNodeHeaders(request.headers), returnHeaders: true })`, recopier chaque `set-cookie` reçu sur la réponse, puis `setGuestAcceptance`, `findGuestDemo` pour l'espace, `withTenantTx(appDb, { tenantId }, (scope) => importQuiz(scope, { ownerId, source: null, ...EXAMPLE_QUIZ }))`, `recordDemoLaunched`. Messages des refus : « La démonstration n'est pas disponible sur cette instance. », « Trop de démonstrations lancées depuis votre réseau. Réessayez dans une heure, ou créez un compte gratuit. », « La démonstration est très demandée en ce moment. Créez un compte gratuit pour lancer votre quiz tout de suite. », « Vous êtes déjà connecté : lancez un quiz depuis votre espace. ».
- [ ] **Step 4: `demoEnabled`** dans `/api/auth-features` (option de `registerAuth`, passée depuis `index.ts`), avec son test dans `auth-plugin.test.ts`.
- [ ] **Step 5: Vérifier le passage.** Même commande, plus `apps/server/src/auth-plugin.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(demo): route POST /api/demo avec budget par IP et plafond global`.

### Task 5: Passerelle temps réel et balayages

**Files:**
- Modify: `apps/server/src/game-gateway.ts`, `apps/server/src/index.ts`
- Test: `apps/server/src/demo-game-e2e.test.ts` (nouveau, modèle `game-e2e.test.ts` et `sweep-e2e.test.ts`)

**Interfaces:**
- Consumes: `config.demo`, `isGuestUser`, `countLiveGuestSessions`, `findGuestDemo`, `abandonExpiredGuestSessions`, `purgeExpiredGuests`, `recordDemoStarted` (tâche 3).
- Produces: champs `maxPlayers: number` et `isGuest: boolean` dans la méta de session ; `registerGameGateway` renvoie aussi `purgeGuests(): Promise<number>`.

- [ ] **Step 1: Tests en échec** dans `demo-game-e2e.test.ts` (invité créé par `POST /api/demo`, sockets réelles, `DEMO_MAX_PLAYERS=2` et `DEMO_MAX_CONCURRENT=1` pour rester courts) :

```ts
it('borne une partie d invité à DEMO_MAX_PLAYERS et pas une partie ordinaire', ...) // 3e player:join refusé, message de salle pleine existant
it('garde ce plafond après un redémarrage (réhydratation)', ...)
it('refuse une seconde partie vivante au même invité', ...)   // ack { error: 'Une démonstration est déjà en cours.' }
it('refuse host:create au-delà de DEMO_MAX_CONCURRENT', ...)   // ack { error: 'La démonstration est très demandée en ce moment.' }
it('refuse à un invité le quiz d un autre espace', ...)        // ack { error: 'quiz introuvable' }
it('laisse l invité relancer son quiz depuis le podium', ...)  // host:relaunch renvoie une nouvelle partie
it('compte une partie démarrée avec au moins un joueur, une seule fois', ...) // demo_daily.started = 1
it('abandonne la partie d invité de plus d une heure au balayage', ...)        // statut abandoned, PIN libéré
it('purgeGuests supprime l invité de plus de 24 h', ...)
```

- [ ] **Step 2: Vérifier l'échec.** Run: `pnpm vitest run apps/server/src/demo-game-e2e.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implémenter.** `resolveHostContext` renvoie aussi `isGuest` (lu dans `authSession.user.isAnonymous`). `buildHostedSession` reçoit `isGuest` : pour un invité, il refuse si `findGuestDemo(...).liveSessionId` existe ou si `countLiveGuestSessions` atteint `config.demo.maxConcurrent`, avant toute écriture, et pose `maxPlayers = Math.min(config.maxPlayersPerSession, config.demo.maxPlayers)` ; sinon `maxPlayers = config.maxPlayersPerSession`. `host:relaunch` ne passe pas le contrôle de partie vivante pour la partie qu'il remplace (elle est au podium, donc terminée). Le contrôle de `player:join` compare `meta.seatsTaken` à `meta.maxPlayers`. La réhydratation recalcule `isGuest` et `maxPlayers` avec `isGuestUser`. `host:start` appelle `recordDemoStarted(systemDb, <jour UTC>, source ?? 'direct')` quand `meta.isGuest` est vrai et que la partie compte au moins un joueur, la provenance venant de `findGuestDemo`, sans jamais faire échouer le démarrage (erreur journalisée).
- [ ] **Step 4: Balayages.** `sweepAbandonedSessions` traite aussi les identifiants de `abandonExpiredGuestSessions(systemDb, 3_600_000)` avec le même nettoyage mémoire. `purgeGuests` appelle `purgeExpiredGuests(systemDb, 86_400_000)`. Dans `index.ts` : un appel au démarrage puis un minuteur horaire `.unref()`, erreurs journalisées, arrêté dans `onClose`. La purge tourne même fonction éteinte, pour nettoyer après une désactivation.
- [ ] **Step 5: Vérifier le passage**, puis `pnpm vitest run apps/server/src/game-e2e.test.ts apps/server/src/sweep-e2e.test.ts apps/server/src/game-gateway.test.ts` pour l'absence de régression. Expected: PASS.
- [ ] **Step 6: Commit** `feat(demo): plafonds, durée et purge des parties d'invité`.

### Task 6: Écran `/demo` et parcours de l'invité

**Files:**
- Create: `apps/web/src/screens/Demo.tsx`, `apps/web/src/screens/Demo.test.tsx`, `apps/web/src/api/demo.ts`
- Modify: `packages/shared/src/spa-routes.ts`, `packages/shared/src/spa-routes.test.ts`, `apps/web/src/routes.tsx`
- Modify: `apps/web/src/api/auth.tsx` (`User.isAnonymous?: boolean`), `apps/web/src/api/features.ts` (`demoEnabled`), `apps/web/src/RequireAuth.tsx`, `apps/web/src/RequireAuth.test.tsx`
- Modify: `apps/web/src/realtime/useGameSocket.ts`, `apps/web/src/screens/HostLive.tsx`, `apps/web/src/screens/HostLive.relaunch.test.tsx`, `apps/web/src/ui/VerifyEmailBanner.tsx`

**Interfaces:**
- Consumes: `POST /api/demo` et ses codes (tâche 4), `GET /api/auth-features`, `fetchLegal`, `setActiveTenantId`, `useLaunchGame`, `signOut`.
- Produces: `startDemo(input: { ageConfirmed: boolean; acceptedTermsVersion?: string; from?: string }): Promise<{ quizId: string; tenantId: string; liveSessionId: string | null }>` dans `api/demo.ts`.
- Produces: route `/demo`, sous `HostRealtimeLayout` (elle lance la partie sur la socket partagée), sans `RequireAuth` ; prop `allowGuest` de `RequireAuth`.

- [ ] **Step 1: Tests en échec** dans `Demo.test.tsx` (modèle `Signup.test.tsx`) :

```tsx
it('affiche la phrase, la case d âge, le lien des conditions et le bouton', ...)
// titre « Essayez Pengou sans créer de compte »
// phrase « Une vraie partie du quiz d'exemple, jusqu'à 30 joueurs. Rien n'est conservé après la démonstration. »
// case « J'ai 15 ans ou plus », mention « En lançant la démonstration, vous acceptez les conditions d'utilisation. »
it('ne lance rien tant que la case n est pas cochée', ...)            // message « Confirmez que vous avez 15 ans ou plus. », aucun appel réseau
it('lance la partie puis ouvre le salon', async () => {
  // startDemo appelé avec { ageConfirmed: true, acceptedTermsVersion, from: 'accueil' } (lu dans ?from=)
  // setActiveTenantId(tenantId), refresh de la session, host:create { quizId }, navigation vers /host/<sessionId>
})
it('reprend la partie vivante au lieu d en créer une', ...)            // liveSessionId => navigation directe
it('n appelle le serveur qu une fois sur un double clic', ...)
it('affiche le message du serveur et le lien « Créer un compte gratuit » sur DEMO_FULL et DEMO_RATE_LIMITED', ...)
it('explique que la démonstration n existe pas ici quand demoEnabled est faux', ...)
it('renvoie un compte ordinaire déjà connecté vers son espace', ...)   // lien « Ouvrir mon espace » vers /, aucun appel à startDemo
```

Dans `RequireAuth.test.tsx` : un invité est redirigé vers `/demo` sur une route sans `allowGuest`, et voit l'écran avec `allowGuest`. Dans `HostLive.relaunch.test.tsx` : au podium, un invité voit le lien « Créer mon compte pour faire mes propres quiz » ; un hôte ordinaire ne le voit pas.

- [ ] **Step 2: Vérifier l'échec.** Run: `pnpm vitest run apps/web/src/screens/Demo.test.tsx apps/web/src/RequireAuth.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implémenter.** Ajouter `'/demo'` à `SPA_ROUTES` (et à la liste « reconnaît » de `spa-routes.test.ts`) et la route dans `routes.tsx`. `RequireAuth` : `user.isAnonymous && !allowGuest` donne `<Navigate to="/demo" replace />` ; `allowGuest` posé sur `/host/:sessionId` seulement. `useGameSocket` : l'option `auth` devient la forme fonction (`auth: (cb) => cb(tenantId ? { tenantId } : {})`, `tenantId` relu par `getActiveTenantId()` à chaque connexion), pour que la poignée de main porte l'espace créé juste avant. Lien du podium : `signOut()`, `refresh()`, puis navigation vers `/signup?from=demo`. `VerifyEmailBanner` ne s'affiche jamais pour un invité.
- [ ] **Step 4: Vérifier le passage**, puis `pnpm vitest run apps/web packages/shared` pour l'absence de régression, dont `routes.spa-list.test.tsx`. Expected: PASS.
- [ ] **Step 5: Vérifier dans un navigateur**, image de production locale avec `DEMO_ENABLED=true` et `TENANCY_MODE=multi` : `/demo`, lancement, un joueur qui rejoint depuis un second onglet, partie jusqu'au podium, rechargement de `/host/:sessionId` en cours de partie, lien d'inscription. Largeur de 360 px vérifiée sur `/demo`.
- [ ] **Step 6: Commit** `feat(demo): écran /demo et parcours de l'hôte invité`.

### Task 7: Charge, rapport et documentation d'exploitation

**Files:**
- Modify: `apps/server/charge/scenarios.mjs` et son test, `docs/charge/README.md`, `docs/charge/historique.jsonl`
- Create: `apps/server/src/demo-report.ts` (modèle `signups-report.ts`), script `demos:rapport` dans `apps/server/package.json`
- Modify: `docs/devops.md`, `README.md`, `docs/superpowers/specs/2026-11-13-partie-de-demonstration-design.md` (section coût)

**Interfaces:**
- Consumes: `listDemoDaily` (tâche 3).

- [ ] **Step 1: Scénario `demo`** dans `SCENARIOS` : `[{ libelle: 'demo', joueurs: 30, parties: 20, cadence: 25, essais: 1 }]`, avec son test de présence et la ligne d'usage dans `docs/charge/README.md`.
- [ ] **Step 2: Jouer la campagne** en local, limites du serveur (`PENGOU_CHARGE_CPUS=4`, `PENGOU_CHARGE_MEM=15360m`, `PENGOU_CHARGE_MEMSWAP=15360m`) : `pnpm --filter @splootlabs/server charge:campagne -- --scenario demo`. Expected: passage « reussi », code 0. Jamais contre la production. Committer la ligne de référence de `historique.jsonl` et reporter le résultat mesuré dans la section « Coût serveur » de la spec, à la place de la phrase « Ce cas précis n'a pas été mesuré ».
- [ ] **Step 3: Rapport.** `demo-report.ts` écrit sur la sortie standard un CSV `jour,provenance,lancees,demarrees` depuis `listDemoDaily`. Test sur le formatage.
- [ ] **Step 4: Documentation** dans `docs/devops.md`, section « Démonstration sans compte » : les quatre variables, l'exigence du mode multi, la purge et sa cadence, la commande du rapport (`node apps/server/dist/demo-report.js` dans le conteneur), ce qui est conservé (compte invité sans adresse pendant 24 heures, compteur quotidien sans donnée personnelle, budget par IP en mémoire seulement) et le lien à poser sur le site (`/demo?from=<slug-de-page>`). Une ligne dans le README.
- [ ] **Step 5: Vérifier** la chaîne complète : `pnpm check && pnpm typecheck && pnpm build && pnpm test`. Expected: tout vert.
- [ ] **Step 6: Commit** `test(charge): vingt parties de démonstration simultanées` puis `docs(exploitation): démonstration sans compte`.

## Hors du plan

Le bouton « Essayer sans compte » et la page dédiée vivent dans le dépôt du site. L'activation en production (`DEMO_ENABLED: "true"` dans la pile d'exploitation) et la mention de la démonstration dans la politique de confidentialité et les conditions d'utilisation restent à la main de l'éditeur. Un captcha ou une preuve de travail ne sont pas prévus : ils restent le recours si les journaux montrent un abus.
