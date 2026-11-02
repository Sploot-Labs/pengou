# Correctifs de l'audit de sécurité run-1 : plan d'implémentation

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Objectif : corriger les 7 constats confirmés de l'audit run-1 et appliquer les correctifs des 5 pistes « à valider » dont le correctif est sûr même sans validation préalable.

Architecture : chaque constat est corrigé au dernier point de décision fiable. Côté base, ce sont l'acceptation d'invitation et la garde du dernier owner. Côté résolution de tenant, c'est le mode single. Côté passerelle Socket.IO, ce sont les gardes d'hôte, l'attribution de sièges et le budget de PIN. Côté HTTP, ce sont l'IP client, la vérification d'origine et la configuration. Une seule brique est partagée : `apps/server/src/client-ip.ts` (tâche 2), réutilisée par la tâche 10.

Pile technique : TypeScript, Fastify 5, Socket.IO 4, Better Auth 1.7.12, Drizzle/Postgres (tests sur base réelle via `startTestDb`), Vitest.

Spec : `C:\Users\julie\security-audit-skill\pengou\run-1\REPORT.md`, avec `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` et `findings.json` dans le même dossier. L'audit porte sur `e4a7db6`. Les numéros de ligne ci-dessous sont ceux de `a51c678`, qui a ajouté le nuage de mots dans `game-gateway.ts`.

## Contraintes globales

Ne jamais lancer `biome format --write` (dépôt non formaté Biome). `pnpm lint`, `pnpm typecheck` et `pnpm test` doivent sortir en code 0 avant chaque commit.

Travailler sur une branche `fix/audit-securite`. Titre de la PR (repris par le squash) : `fix(securite): correctifs de l'audit run-1`. Ne committer et ne pousser que sur demande.

Messages d'erreur visibles en français, apostrophe droite, pas de tiret cadratin.

Aucun changement de comportement pour un usage légitime : un hôte connecté et membre continue de piloter sa partie, un joueur qui recharge la page retrouve sa place, l'outil de charge (`apps/server/charge/`) et les clients Node sans en-tête `Origin` continuent de se connecter.

Toute nouvelle variable d'environnement est documentée dans `.env.example` et, si la production en a besoin, transmise par `docker-compose.prod.yml`.

## Review Focus

Un hôte légitime dont la session Better Auth expire pendant une partie longue : il perd le contrôle (comportement voulu), et le message d'erreur doit le lui dire clairement. Tâche 3, test `refuse host:start après sign-out` : vérifier le texte.

Un joueur qui passe d'une partie terminée à la suivante sur la même socket (`PlayerLive.tsx:393`, remontage via `player:reconnect`). Il ne doit pas être bloqué par la correction des sièges multiples. Tâche 6, test `une socket qui rejoint une seconde partie libère sa place dans la première`.

Une salle de classe derrière une seule IP publique (NAT) : 30 élèves qui se trompent de PIN ne doivent pas bloquer la salle. Tâche 10, le budget compte uniquement les échecs, et il est réglé à 30 échecs par 5 minutes et par IP.

Un déploiement en production sans `TRUSTED_PROXIES` : tous les clients partagent l'IP du proxy, et le limiteur global Fastify (1000 requêtes par minute) sature pendant une partie. Tâche 2, journaliser un avertissement au démarrage en production quand la liste est vide, avec un test.

Une installation en mode single antérieure aux memberships, avec des comptes sans ligne `membership` : après la tâche 4, ils reçoivent 403. Ajouter la vérification d'exploitation correspondante (section finale) avant de déployer.

---

### Tâche 1 : invitation qui survit au retrait de l'admin (gravité moyenne)

Fichiers :
- Modifier : `packages/db/src/repos/invitation.ts:120-160` (`AcceptCode`, `acceptInvitation`), et ajouter `revokePendingInvitationsBy`
- Modifier : `apps/server/src/routes/invitations.ts:26-34` (`mapAcceptError`)
- Modifier : `apps/server/src/routes/members.ts:58-61` et `:79-81`
- Test : `apps/server/src/routes-workspaces.test.ts`

Interfaces :
- Produit : `AcceptCode` gagne `'inviter_revoked'`. `revokePendingInvitationsBy(scope: TenantScope, userId: string): Promise<number>` passe en `revoked` les invitations `pending` dont `invitedBy = userId` dans `scope.tenantId`, et renvoie le nombre de lignes. Elle est exportée par `@splootlabs/db`.

- [ ] Étape 1 : écrire les tests qui échouent (mode multi, dans `routes-workspaces.test.ts`, avec les helpers `signUp` et `buildApp` du fichier)

```ts
it('un admin retiré ne peut pas accepter une invitation qu\'il a créée', async () => {
  // O crée W, invite A en admin, A accepte.
  // A crée une invitation admin pour other@x.test, garde invitation.token.
  // O : DELETE /api/workspaces/W/members/<A> → 200
  // A : POST /api/invitations/<token>/accept → 409
  // A : GET /api/workspaces/W/members → 403
  // en base : aucune membership (A, W)
})
it('le retrait d\'un admin révoque ses invitations en attente', async () => {
  // après le DELETE ci-dessus, GET /api/workspaces/W/invitations (par O) ne contient plus l'invitation de A
})
it('rétrograder un admin en member révoque ses invitations en attente', async () => {
  // PATCH role member → 200 ; un tiers D2 qui accepte le jeton de D → 409, pas de membership
})
it('une invitation d\'un admin toujours en place reste acceptable', async () => {
  // témoin : acceptation → 200, role admin
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/routes-workspaces.test.ts`. Attendu : les trois premiers tests échouent (200 au lieu de 409), le témoin passe.

- [ ] Étape 3 : dans la transaction d'`acceptInvitation`, juste après le contrôle `expired`, lire le rôle de `inv.invitedBy` dans `inv.tenantId`. S'il est absent ou si `hasPermission(role, 'members:manage')` est faux, lever `InvitationError('inviter_revoked')`. Ajouter `eq(schema.invitation.status, 'pending')` au `WHERE` de l'update final, et lever `not_pending` si aucune ligne n'est touchée (course entre deux acceptations, point de durcissement du rapport).

- [ ] Étape 4 : implémenter `revokePendingInvitationsBy` à côté de `revokeInvitation`. Dans `members.ts`, l'appeler dans la même `withTenantTx` après `removeMember` réussi, et après `setMemberRole` quand `hasPermission(nextRole, 'members:manage')` est faux. Dans `mapAcceptError`, ajouter `case 'inviter_revoked': return { status: 409, error: "Cette invitation n'est plus valable." }`.

- [ ] Étape 5 : relancer la commande de l'étape 2. Attendu : PASS sur les quatre tests et sur le reste du fichier.

- [ ] Étape 6 : commit `fix(invitations): refuser une invitation dont l'auteur a perdu members:manage`

### Tâche 2 : limite de connexion contournable par X-Forwarded-For (gravité moyenne)

Fichiers :
- Créer : `apps/server/src/client-ip.ts`
- Modifier : `packages/shared/src/config.ts` (schéma, `AppConfig`, `loadConfig`)
- Modifier : `apps/server/src/app.ts:66-69` (`trustProxy`)
- Modifier : `apps/server/src/auth-plugin.ts:25-27`
- Modifier : `apps/server/package.json` (dépendance directe `@fastify/proxy-addr`, version du lockfile `5.1.2`)
- Modifier : `.env.example`, `docker-compose.prod.yml`
- Test : `apps/server/src/client-ip.test.ts` (nouveau), `apps/server/src/auth-plugin.test.ts`

Interfaces :
- Produit : `AppConfig.trustedProxies: string[]`, lu depuis `TRUSTED_PROXIES` (liste séparée par des virgules, espaces retirés, vide par défaut). Les valeurs acceptées sont celles de proxy-addr : IP, CIDR, `loopback`, `linklocal`, `uniquelocal`.
- Produit : `client-ip.ts` exporte `compileTrust(list: string[]): (addr: string, i: number) => boolean` et `clientIpFromRequest(req: IncomingMessage, trust: ReturnType<typeof compileTrust>): string`.
- Consommé par : la tâche 10.

- [ ] Étape 1 : écrire les tests qui échouent.

`client-ip.test.ts` :
```ts
it('sans proxy de confiance, ignore X-Forwarded-For', () => {
  // req.socket.remoteAddress = '203.0.113.9', x-forwarded-for = '192.0.2.1'
  expect(clientIpFromRequest(req, compileTrust([]))).toBe('203.0.113.9')
})
it('derrière un proxy de confiance, prend le dernier saut non fiable', () => {
  // remoteAddress = '10.0.0.2', xff = '192.0.2.1, 198.51.100.7'
  expect(clientIpFromRequest(req, compileTrust(['10.0.0.0/8']))).toBe('198.51.100.7')
})
```

`auth-plugin.test.ts`, avec `createAuth(..., { nodeEnv: 'production' })` pour activer le limiteur et `app.inject` avec `remoteAddress` fixe :
```ts
it('changer X-Forwarded-For ne remet pas le compteur de connexion à zéro', async () => {
  // 4 POST /api/auth/sign-in/email (mauvais mot de passe) en < 10 s, XFF différent à chaque fois
  // codes attendus : 401, 401, 401, 429
})
it('deux pairs distincts ne partagent pas de compteur', async () => {
  // 3 échecs depuis remoteAddress 203.0.113.1, puis 1 essai depuis 203.0.113.2 → 401, pas 429
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/client-ip.test.ts src/auth-plugin.test.ts`. Attendu : `client-ip.test.ts` échoue (module absent) et le premier test d'`auth-plugin` reçoit 401 quatre fois.

- [ ] Étape 3 : ajouter `TRUSTED_PROXIES` à la config. Implémenter `client-ip.ts` avec `proxyaddr` et `proxyaddr.compile` de `@fastify/proxy-addr`. Dans `buildServer`, passer `trustProxy: config.trustedProxies.length ? config.trustedProxies : false`, mettre à jour le commentaire de `app.ts:31-35`, et en production avec une liste vide journaliser `TRUSTED_PROXIES est vide : derrière un reverse proxy, tous les clients partagent la même IP pour les limites de débit.` (avec un test). Dans `registerAuth`, avant `authHandler`, faire `request.raw.headers['x-forwarded-for'] = request.ip`, avec un commentaire qui renvoie au constat.

- [ ] Étape 4 : documenter `TRUSTED_PROXIES` dans `.env.example`. Dans `docker-compose.prod.yml`, ajouter `TRUSTED_PROXIES: ${TRUSTED_PROXIES:?Définissez TRUSTED_PROXIES (IP ou CIDR du reverse proxy vu depuis le conteneur) dans le .env du VPS}`. Ne pas toucher `docker-compose.yml` (démarrage rapide sans proxy : liste vide, donc XFF ignoré).

- [ ] Étape 5 : relancer la commande de l'étape 2, puis `pnpm test`. Attendu : PASS.

- [ ] Étape 6 : commit `fix(auth): indexer la limite de connexion sur l'IP vue par un proxy de confiance`

### Tâche 3 : autorité d'hôte non revalidée (deux constats faibles)

Couvre le membre retiré qui garde le contrôle d'hôte et la socket d'hôte qui survit à la déconnexion.

Fichiers :
- Modifier : `apps/server/src/game-gateway.ts:585-591` (`requireHost`), ses appels (`:736`, `:758`, `:1102`, `:1226`, `:1252`, `:1272`, `:1292`, `:1318`, `:1506` et suivants), et `host:reconnect` (`:1173-1196`)
- Test : `apps/server/src/game-gateway.test.ts`

Interfaces :
- Produit : `requireLiveHost(socket: Socket): Promise<{ sessionId: string; meta: SessionMeta }>`. Elle remplace `requireHost` partout. Elle fait les contrôles synchrones actuels, puis relit la session Better Auth depuis `socket.handshake.headers` et exige `user.id === session.hostId`. Elle exige enfin que `getMembershipRole(systemDb, user.id, meta.tenantId)` soit non nul. En cas d'échec : `Error("votre session a expiré ou vous n'êtes plus membre de cet espace")`.
- Produit : `assertHostMembership(userId: string, tenantId: string): Promise<void>`, partagée par `requireLiveHost` et `host:reconnect`.

- [ ] Étape 1 : écrire les tests qui échouent (avec les helpers socket de `game-e2e.test.ts` : `connectClient`, `ack`)

```ts
it('refuse host:start après sign-out sur la socket déjà ouverte', async () => {
  // hôte crée la partie (host:create OK), POST /api/auth/sign-out avec le même cookie
  // ack(host, 'host:start') → { error: "votre session a expiré ou vous n'êtes plus membre de cet espace" }
  // ack(host, 'host:createScreenToken') → même erreur
})
it('refuse host:reconnect et host:start à un membre retiré (multi)', async () => {
  // M crée une partie dans W ; O retire M ; nouvelle socket de M : host:reconnect → error
})
it('un hôte toujours membre garde la main', async () => {
  // témoin : host:start puis host:next → pas d'erreur
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/game-gateway.test.ts`. Attendu : les deux premiers échouent (actions acceptées).

- [ ] Étape 3 : implémenter `assertHostMembership` et `requireLiveHost`, puis remplacer chaque `requireHost(socket)` par `await requireLiveHost(socket)`. Les handlers concernés sont déjà `async`, sauf `host:createScreenToken`, qu'il faut rendre `async`. Appeler `assertHostMembership(authSession.user.id, meta.tenantId)` dans `host:reconnect`, après le contrôle `hostId`. Pas de cache : les événements d'hôte sont rares (quelques-uns par minute).

- [ ] Étape 4 : relancer la commande de l'étape 2, puis `pnpm --filter @splootlabs/server test`. Attendu : PASS, y compris `game-e2e`, `wordcloud-e2e` et `sweep-e2e`.

- [ ] Étape 5 : commit `fix(gateway): revalider la session et la membership de l'hôte à chaque action`

### Tâche 4 : retrait sans effet en mode single (faible)

Fichiers :
- Modifier : `packages/db/src/tenant.ts:86-99` (`resolveTenantId`)
- Test : `packages/db/src/tenant-membership.test.ts`, `apps/server/src/routes-workspaces.test.ts`

Interfaces :
- Produit : en mode single, quand `opts.userId` est fourni, `resolveTenantId` lève `TenantAccessDeniedError` si aucune membership `(userId, tenant par défaut)` n'existe. Sans `userId`, le comportement est inchangé (appels techniques).

- [ ] Étape 1 : tests qui échouent.

```ts
// tenant-membership.test.ts
it('mode single : un utilisateur sans membership est refusé', async () => {
  await expect(resolveTenantId(db, { tenancyMode: 'single' }, { userId: 'sans-membership' }))
    .rejects.toBeInstanceOf(TenantAccessDeniedError)
})
// routes-workspaces.test.ts (single)
it('mode single : un membre retiré reçoit 403 sur POST /api/quizzes', async () => {
  // owner + membre ; DELETE membre → 200 ; POST /api/quizzes par le membre → 403
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/db exec vitest run src/tenant-membership.test.ts` et `pnpm --filter @splootlabs/server exec vitest run src/routes-workspaces.test.ts`. Attendu : FAIL (résolution OK, 201).

- [ ] Étape 3 : ajouter le contrôle de membership dans la branche single. Laisser le repli `?? 'member'` de `require-user.ts:43` et `game-gateway.ts:512`, qui devient inatteignable une fois la membership garantie.

- [ ] Étape 4 : relancer `pnpm test` en entier (les suites single créent toutes leurs comptes par inscription, donc avec membership). Attendu : PASS.

- [ ] Étape 5 : commit `fix(tenant): exiger une membership en mode single`

### Tâche 5 : course sur la garde du dernier owner (faible)

Fichiers :
- Modifier : `packages/db/src/workspace.ts:134-139` (`countOwners`)
- Test : `packages/db/src/workspace.test.ts`

Interfaces :
- Produit : `countOwners(scope: TenantScope): Promise<number>`, même signature. Elle sélectionne les `id` des lignes owner du tenant avec `.for('update')` et renvoie leur nombre (Postgres refuse `FOR UPDATE` avec un agrégat). En READ COMMITTED, la seconde transaction attend la première puis relit les lignes : l'owner rétrogradé n'est plus compté.

- [ ] Étape 1 : test qui échoue.

```ts
it('countOwners sérialise deux rétrogradations concurrentes', async () => {
  // tenant avec owners A et B
  // tx1 : countOwners → 2, setMemberRole(A, 'admin'), puis attend un verrou (deferred) avant commit
  // tx2 lancée pendant ce temps : countOwners ; après 100 ms elle n'est pas résolue
  // libérer tx1 → tx2 renvoie 1
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/db exec vitest run src/workspace.test.ts`. Attendu : FAIL (tx2 renvoie 2 sans attendre).

- [ ] Étape 3 : implémenter le verrou dans `countOwners`. Les deux routes de `members.ts` l'appellent déjà dans leur `withTenantTx`, donc rien à changer côté route.

- [ ] Étape 4 : relancer la commande de l'étape 2. Attendu : PASS.

- [ ] Étape 5 : commit `fix(membres): verrouiller les owners avant la garde du dernier owner`

### Tâche 6 : plusieurs sièges par socket (faible)

Fichiers :
- Modifier : `apps/server/src/game-gateway.ts:1333-1385` (`player:join`), `:1439-1490` (`player:reconnect`), `:1493-1500` (`disconnect`)
- Test : `apps/server/src/game-gateway.test.ts`

Interfaces :
- Produit : `releasePlayerSeat(socket: Socket): Promise<void>`. Si `socket.data` porte un joueur, elle le marque déconnecté dans le moteur (seulement si cette socket est encore la socket active du joueur), retire l'entrée d'`activeSocketIdByPlayerId`, quitte `roomName(ancienneSession)` et programme `scheduleLobbyBroadcast` pour l'ancienne session. Elle est appelée en tête de `player:join` et de `player:reconnect`, après validation de la charge utile.
- Si `socket.data.role` vaut `'host'` ou `'screen'`, `player:join` et `player:reconnect` sont refusés : `Error('cette connexion est déjà utilisée par un hôte ou un écran')`.

Le refus pur pour une socket déjà joueur casserait le passage d'une partie à la suivante (`PlayerLive.tsx:393`). On libère donc l'ancienne place au lieu de refuser.

- [ ] Étape 1 : tests qui échouent.

```ts
it('un second player:join sur la même socket libère la première place', async () => {
  // une socket : join 'a' puis join 'b' sur la même partie
  // lobby:update de l'hôte : 'a' connected false, 'b' connected true
})
it('les places libérées ne bloquent pas l\'auto-révélation', async () => {
  // socket X : join a, join b ; socket Y : join c ; host:start ; b et c répondent → question:reveal reçu
})
it('une socket qui rejoint une seconde partie libère sa place dans la première', async () => {
  // join partie 1 puis player:reconnect/join partie 2 : joueur de la partie 1 connected false
})
it('une socket d\'hôte ne peut pas prendre de siège', async () => {
  // host:create puis player:join sur la même socket → error
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/game-gateway.test.ts`. Attendu : FAIL sur les quatre tests.

- [ ] Étape 3 : implémenter `releasePlayerSeat` et les deux gardes. Le handler `disconnect` reste inchangé : il ne voit que le dernier joueur, et les précédents sont déjà libérés.

- [ ] Étape 4 : relancer la commande de l'étape 2, puis `pnpm --filter @splootlabs/server test`. Attendu : PASS.

- [ ] Étape 5 : commit `fix(gateway): une socket n'occupe qu'un siège joueur à la fois`

### Tâche 7 : mot de passe par défaut d'app_role (piste à valider)

Fichiers :
- Modifier : `packages/shared/src/config.ts:13` et `:77-83`
- Modifier : `docker-compose.prod.yml` (bloc `app.environment`), `.env.example`
- Test : `packages/shared/src/config.test.ts` (créer s'il n'existe pas)

Interfaces :
- Produit : `export const DEFAULT_APP_DB_PASSWORD = 'app-dev-password-change-me'`. En production, sans `APP_DATABASE_URL`, `loadConfig` lève `Configuration invalide : APP_DB_PASSWORD doit être défini en production (mot de passe du rôle app_role).` si la valeur est absente ou égale au défaut.

- [ ] Étape 1 : tests qui échouent : production sans `APP_DB_PASSWORD`, puis avec la valeur par défaut, doit lever ; avec `APP_DB_PASSWORD=autre`, ou avec `APP_DATABASE_URL` fourni, ne doit rien lever ; en développement sans rien, pas d'erreur.

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/shared exec vitest run src/config.test.ts`. Attendu : FAIL sur les deux cas production.

- [ ] Étape 3 : implémenter la garde à côté de celle de `BETTER_AUTH_SECRET`. Dans `docker-compose.prod.yml`, ajouter `APP_DB_PASSWORD: ${APP_DB_PASSWORD:?Définissez APP_DB_PASSWORD dans le .env du VPS}`, et mentionner la variable dans l'en-tête de commentaire des secrets.

- [ ] Étape 4 : relancer la commande de l'étape 2, puis `pnpm test`. Les tests serveur utilisent `NODE_ENV: 'test'` et ne sont pas concernés. Attendu : PASS.

- [ ] Étape 5 : commit `fix(config): refuser le mot de passe app_role par défaut en production`

### Tâche 8 : contrôle d'origine (WebSocket et POST sans corps, pistes à valider)

Fichiers :
- Modifier : `apps/server/src/realtime.ts:29` (`allowRequest`)
- Créer : `apps/server/src/origin-guard.ts`
- Modifier : `apps/server/src/app.ts` (enregistrer le hook après helmet)
- Test : `apps/server/src/realtime.test.ts`, `apps/server/src/app.test.ts`

Interfaces :
- Consomme : `allowedOrigins(config)` de `realtime.ts`.
- Produit : `isOriginAllowed(origin: string | undefined, allowed: string[]): boolean`. Elle renvoie vrai si `origin` est absent (clients non navigateurs, outil de charge, tests) ou s'il figure dans la liste.
- Produit : `registerOriginGuard(app: FastifyInstance, config: Pick<AppConfig, 'authUrl' | 'nodeEnv'>): void`, un hook `onRequest` qui répond 403 `{ error: 'Origine non autorisée.' }` sur `POST`, `PUT`, `PATCH` et `DELETE` des URL `/api/*` hors `/api/auth/*` quand `Origin` est présent et non autorisé, ou quand `Origin` est absent et que `Sec-Fetch-Site` vaut `cross-site` ou `same-site`. Better Auth contrôle déjà ses propres routes.

- [ ] Étape 1 : tests qui échouent.

```ts
// realtime.test.ts
it('refuse le handshake WebSocket d\'une origine étrangère', async () => {
  // connectClient(url, { origin: 'https://evil.example' }) → connect_error
})
it('accepte un client sans Origin et l\'origine BETTER_AUTH_URL', async () => { /* connect OK */ })
// app.test.ts
it('POST /api/invitations/x/accept avec Origin étrangère → 403', async () => { /* inject */ })
it('POST sans corps avec Sec-Fetch-Site: same-site → 403', async () => { /* inject */ })
it('POST même origine → passe la garde (401 sans cookie)', async () => { /* inject */ })
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/realtime.test.ts src/app.test.ts`. Attendu : FAIL.

- [ ] Étape 3 : implémenter `origin-guard.ts`. Dans `attachRealtime`, passer `allowRequest: (req, cb) => cb(null, isOriginAllowed(req.headers.origin, allowedOrigins(config)))`. Enregistrer `registerOriginGuard` dans `buildServer`, juste après helmet. Garder le commentaire de `realtime.ts:7-15`, qui devient exact.

- [ ] Étape 4 : relancer la commande de l'étape 2, puis `pnpm --filter @splootlabs/server test` (les e2e socket se connectent sans Origin). Attendu : PASS.

- [ ] Étape 5 : commit `fix(securite): vérifier l'origine des upgrades WebSocket et des requêtes mutantes`

### Tâche 9 : neutralisation CSV contournée par « ; » (piste à valider)

Fichiers :
- Modifier : `apps/server/src/csv.ts:33-52`
- Test : `apps/server/src/csv.test.ts`

Les mots du nuage de mots (25 caractères, saisis par les joueurs) passent eux aussi par `toCsv` via `reports.ts` : ce correctif les couvre.

Interfaces :
- Produit : `formatCell` inchangé en signature. Une cellule texte contenant `;` ou une tabulation est toujours mise entre guillemets. Toute occurrence de `;` ou de tabulation suivie (après blancs éventuels) d'un déclencheur `=`, `+`, `-` ou `@` reçoit une apostrophe juste après le séparateur. Exemple : `a;=1+1;` devient `"a;'=1+1;"`.

- [ ] Étape 1 : tests qui échouent.

```ts
expect(toCsv([['a;=1+1;', 0]])).toBe('"a;\'=1+1;",0\r\n')
expect(toCsv([['x; @SUM(A1)']])).toBe('"x; \'@SUM(A1)"\r\n')
expect(toCsv([['a\t-2']])).toBe('"a\t\'-2"\r\n')
expect(toCsv([['Léa;Paul']])).toBe('"Léa;Paul"\r\n') // ; sans déclencheur : guillemets seulement
expect(toCsv([[-5]])).toBe('-5\r\n') // nombre jamais neutralisé
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/csv.test.ts`. Attendu : FAIL sur les quatre premiers.

- [ ] Étape 3 : implémenter la règle, et compléter le commentaire d'en-tête de `csv.ts` (paragraphe « séparateur de liste `;` des tableurs en français »).

- [ ] Étape 4 : relancer la commande de l'étape 2. Attendu : PASS.

- [ ] Étape 5 : vérification manuelle (le blocage de l'audit) : exporter un rapport avec un pseudo `a;=1+1;`, puis l'ouvrir par double-clic dans Excel réglé en fr-FR et dans LibreOffice avec `;` comme séparateur. Aucune cellule ne doit afficher `2`.

- [ ] Étape 6 : commit `fix(csv): neutraliser les formules après un séparateur « ; » ou tabulation`

### Tâche 10 : devinette de PIN sans limite globale (piste à valider)

Fichiers :
- Créer : `apps/server/src/failure-budget.ts`
- Modifier : `apps/server/src/game-gateway.ts` (`player:join` `:1344-1345`, `player:reconnect` `:1447-1452`)
- Test : `apps/server/src/failure-budget.test.ts` (nouveau), `apps/server/src/game-gateway.test.ts`

Interfaces :
- Consomme : `compileTrust` et `clientIpFromRequest` (tâche 2), `config.trustedProxies`.
- Produit : `class FailureBudget { constructor(opts: { max: number; windowMs: number; now?: () => number; maxKeys?: number }); isBlocked(key: string): boolean; recordFailure(key: string): void }`, avec une fenêtre fixe par clé. Les clés expirées sont purgées au fil des accès, et quand `maxKeys` (défaut 10 000) est atteint, la plus ancienne est évincée.
- Valeurs : `PIN_FAILURE_MAX = 30`, `PIN_FAILURE_WINDOW_MS = 5 * 60_000`, clé = IP client de `socket.request`.
- Message unique pour tout échec de PIN ou de jeton : `PIN ou jeton invalide`. Message de blocage : `trop de tentatives, réessayez dans quelques minutes`.

- [ ] Étape 1 : tests qui échouent.

```ts
// failure-budget.test.ts (horloge injectée)
it('bloque après max échecs dans la fenêtre puis se rouvre', () => { /* 30 échecs → bloqué ; +5 min → libre */ })
it('isole les clés', () => { /* 30 échecs sur A ; B libre */ })
// game-gateway.test.ts
it('le budget d\'échecs de PIN est partagé entre les sockets d\'une même IP', async () => {
  // 30 player:join PIN inconnu répartis sur 2 sockets ; 31e (3e socket) avec le BON PIN → 'trop de tentatives…'
})
it('player:reconnect ne distingue plus PIN inconnu et jeton faux', async () => {
  // les deux réponses valent { error: 'PIN ou jeton invalide' }
})
```

- [ ] Étape 2 : lancer `pnpm --filter @splootlabs/server exec vitest run src/failure-budget.test.ts src/game-gateway.test.ts`. Attendu : FAIL.

- [ ] Étape 3 : implémenter `FailureBudget`. Dans la passerelle, créer une instance au démarrage et calculer la clé une fois par connexion, dans `socket.data`. Contrôler `isBlocked` avant la recherche du PIN, et appeler `recordFailure` sur PIN inconnu, session introuvable ou jeton refusé. Unifier les messages. `PlayerLive.tsx:362` et `Join.tsx:97` affichent le message serveur tel quel : rien à changer côté web, mais vérifier les tests web qui comparent le texte (`grep -rn "PIN invalide" apps/web/src`).

- [ ] Étape 4 : relancer la commande de l'étape 2, puis `pnpm test`. Attendu : PASS.

- [ ] Étape 5 : commit `fix(gateway): budget d'échecs de PIN par IP et réponse uniforme`

---

## Vérification finale

- [ ] `pnpm lint`, `pnpm typecheck` et `pnpm test` sortent en code 0.
- [ ] Relancer les sondes de l'audit qui correspondent aux constats confirmés, sur une image reconstruite depuis la branche. Elles sont dans `C:\Users\julie\security-audit-skill\pengou\run-1\agents\*\scratch\*.mjs`, et le banc se lance avec `harness/fixture-up.sh` après avoir retaggé l'image en `pengou-charge-app:latest`. Chaque sonde doit maintenant observer le refus.

## Côté exploitation, avant de déployer (hors dépôt, dans `splootlabs-ops` et sur le VPS)

- [ ] Ajouter `APP_DB_PASSWORD` (nouvelle valeur aléatoire) et `TRUSTED_PROXIES` au `.env` du VPS. Sans eux, le compose de prod refuse de démarrer, comme prévu. Pour `TRUSTED_PROXIES`, relever dans la config du reverse proxy de `splootlabs-ops` l'adresse par laquelle il joint le conteneur. C'est en général la passerelle du réseau Docker quand le proxy passe par `127.0.0.1:3000`.
- [ ] Le redémarrage applique le nouveau mot de passe (`setAppRolePassword` au boot). Vérifier ensuite que l'ancien mot de passe par défaut est refusé pour `app_role`.
- [ ] Vérifier que Postgres (`db:5432`) n'est joignable par aucun autre conteneur ni port publié (`docker compose port db 5432`, `docker network inspect`). C'est le blocage de la piste 1 : s'il était joignable avant ce correctif, considérer que les tables Better Auth ont pu être lues.
- [ ] Mode single : compter les comptes sans membership avant la tâche 4 (`select count(*) from "user" u where not exists (select 1 from membership m where m.user_id = u.id)`). S'il y en a, décider de les rattacher en `member` ou de les laisser refusés.
- [ ] Après déploiement, relancer un audit ciblé (unité différée `host:create` et jetons d'écran, puis revalidation des 7 constats).
