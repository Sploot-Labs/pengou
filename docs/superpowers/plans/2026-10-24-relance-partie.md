# Relancer une partie depuis le podium — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'animateur, depuis le podium, de relancer sur n'importe quel quiz, en migrant automatiquement joueurs et grand écran connectés vers la nouvelle partie, en lobby, sans ressaisie.

**Architecture:** Un seul nouvel événement serveur `host:relaunch { quizId }`, réservé à l'hôte et à la phase podium, crée une partie neuve (en réutilisant la logique de `host:create`, factorisée en deux helpers) puis distribue à chaque participant connecté une identité valide dans cette nouvelle partie via l'événement `session:relaunched`. Aucune socket n'est déplacée côté serveur : chaque client (hôte, joueur, grand écran) enregistre sa nouvelle identité puis effectue un rechargement complet, et rejoint la nouvelle room par son chemin de (re)connexion déjà existant et testé (host:reconnect / player:reconnect / screen:join).

**Tech Stack:** TypeScript, Socket.IO (serveur `apps/server`, moteur `packages/game`), React + react-router + Vitest/Testing-Library (`apps/web`). Base Postgres sous RLS via `@splootlabs/db`.

**Spec:** `docs/superpowers/specs/2026-10-24-relance-partie-design.md`

## Global Constraints

- Le serveur est seul maître de l'état et du temps ; aucune donnée de timing/correction du client ; la bonne réponse n'existe côté client qu'après `question:reveal`.
- Multi-tenant sous RLS : la nouvelle session se crée dans le contexte tenant de l'hôte, avec la même résolution rôle/owner que `host:create` (owner/admin : tout quiz du tenant ; member : les siens).
- Id de session unifié moteur↔base (un seul id) ; le PIN est généré avant la création de la ligne `game_session`.
- Les écrans montent leurs abonnements une seule fois et figent leur identité au montage ; on adopte une nouvelle partie par rechargement complet, jamais par mutation en place.
- Le grand écran lit son jeton dans l'URL et `screen:join` est à usage unique ; la bascule passe par un nouveau jeton dans une nouvelle URL.
- Ne jamais lancer `biome format --write` sur ce dépôt (le dépôt n'est pas au format Biome).
- Typographie des textes destinés à l'utilisateur : pas de tiret cadratin/demi-cadratin, pas de gras d'emphase, apostrophe droite, pas d'émoji décoratif.

## Review Focus

- Relance hors phase podium (reading/question/reveal/scoreboard) : doit être refusée, sans migrer personne ni créer de session (sinon les minuteurs autoritatifs de l'ancienne partie continuent de tourner). Testé en Task 1.
- Relance par une socket non-hôte : doit être refusée (`requireHost`). Testée en Task 1.
- Relance sur un quiz d'un autre tenant ou sans droits (member sur quiz d'autrui) : refus pré-vol, aucune session créée, aucun participant bougé. Testé en Task 1.
- Participant déconnecté au moment de la relance : non migré, aucun `session:relaunched` émis pour lui, aucune erreur serveur ; les autres migrent quand même. Testé en Task 1.
- PIN de la nouvelle partie distinct de l'ancien, l'ancien PIN pointant toujours sur l'ancienne session (fenêtre d'éviction) : testé en Task 1.

---

### Task 1: Serveur — événement `host:relaunch` + helpers factorisés

**Files:**
- Modify: `apps/server/src/game-gateway.ts` (extraire deux helpers depuis le handler `host:create` ; ajouter le handler `host:relaunch` et un helper de migration)
- Test: `apps/server/src/game-gateway.test.ts`

**Interfaces:**
- Consomme : `engine.createSession`, `engine.addPlayer`, `engine.getSession`, `generateUniquePin` (moteur) ; `createGameSession`, `addSessionPlayer`, `withTenantTx`, `listQuestions`, `resolveTenantId`, `getMembershipRole`, `hasPermission` (déjà importés) ; `io.in(room).fetchSockets()`, `crypto.randomUUID()`, `roomName`, `pinToSessionId`, `screenTokenToSessionId`, `sessionMetaByEngineId`.
- Produit (fil Socket.IO) :
  - `host:relaunch` (hôte → serveur), payload `{ quizId: string }`, ack `{ sessionId: string; pin: string } | { error: string }`.
  - `session:relaunched` (serveur → une socket) :
    - variante joueur `{ role: 'player'; pin: string; playerId: string; joinToken: string; nickname: string }`
    - variante écran `{ role: 'screen'; pin: string; sessionId: string; displayToken: string }`
- Produit (helpers internes au module) :
  - `resolveHostContext(socket): Promise<{ userId: string; context: { tenantId: string; ownerId?: string } }>` — réauth + résolution tenant/rôle/owner, exactement l'actuel début de `host:create`.
  - `buildHostedSession(socket, userId, context, quizId): Promise<{ session: GameSession }>` — charge les questions sous RLS, génère le PIN, crée la ligne `game_session`, la session moteur et sa `SessionMeta`, renseigne `sessionMetaByEngineId` et `pinToSessionId`. NE touche PAS `socket.data` ni les rooms. Lève en cas de quiz introuvable/droits insuffisants.

- [ ] **Step 1: Écrire les tests en échec** dans `game-gateway.test.ts`

Réutiliser `setupHostedSession` (crée hôte + quiz mono-mcq + session) et les helpers `ack`/`waitFor`/`raceNoEvent`/`connectClient`. Créer un 2ᵉ quiz via `POST /api/quizzes` + `.../questions` avec le même cookie (voir le corps de `setupHostedSession`).

```ts
// Amener la session au podium (quiz mono-question) : host:start → host:next.
// Puis host:relaunch sur le 2ᵉ quiz.
it('host:relaunch au podium crée une nouvelle partie et migre le joueur connecté', async () => {
  // setup hôte + quizA + session ; player:join ; host:start ; host:next → waitFor('podium')
  // le joueur s'abonne à 'session:relaunched'
  const relaunched = waitFor<{ role: string; pin: string; playerId: string; joinToken: string; nickname: string }>(player, 'session:relaunched')
  const res = await ack<{ sessionId?: string; pin?: string; error?: string }>(hostSocket, 'host:relaunch', { quizId: quizB })
  expect(res.error).toBeUndefined()
  const ev = await relaunched
  expect(ev.role).toBe('player')
  expect(ev.nickname).toBe('Ana')          // pseudo repris
  expect(ev.pin).toBe(res.pin)             // identité dans la NOUVELLE partie
  expect(res.pin).not.toBe(pinA)           // PIN distinct de l'ancien
})

it('host:relaunch hors podium est refusé (aucune nouvelle partie, aucune migration)', async () => {
  // setup ; player:join ; host:start (phase question, PAS podium)
  const noRelaunch = raceNoEvent(player, 'session:relaunched', 400)
  const res = await ack<{ error?: string; sessionId?: string }>(hostSocket, 'host:relaunch', { quizId: quizB })
  expect(res.error).toBeDefined()
  expect(res.sessionId).toBeUndefined()
  expect(await noRelaunch).toBe(true)
})

it('host:relaunch est refusé pour un socket non-hôte', async () => {
  // un joueur (mallory) tente host:relaunch
  const res = await ack<{ error?: string }>(mallory, 'host:relaunch', { quizId: quizB })
  expect(res.error).toBeDefined()
})

it("host:relaunch sur un quiz d'un autre tenant est refusé, aucune nouvelle partie", async () => {
  // quiz étranger (cf. test host:create existant) ; au podium ; relaunch → error, pas de session:relaunched
})

it('un joueur déconnecté au podium n’est pas migré, les connectés le sont', async () => {
  // 2 joueurs ; au podium ; player2.disconnect() ; relaunch ; player1 reçoit session:relaunched, player2 non (déjà parti)
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/server && npx vitest run src/game-gateway.test.ts -t relaunch`
Expected: FAIL (événement `host:relaunch` inexistant → ack `{}` / timeout).

- [ ] **Step 3: Factoriser `host:create`** en `resolveHostContext(socket)` et `buildHostedSession(socket, userId, context, quizId)`

Déplacer, sans changer le comportement, la réauth + résolution tenant/rôle/owner dans `resolveHostContext`, et la création (questions RLS → PIN → `createGameSession` → `engine.createSession` → `SessionMeta` → maps) dans `buildHostedSession`. Réécrire le handler `host:create` pour appeler les deux puis faire son binding socket (`socket.data`, `socket.join`) et son `reply` comme aujourd'hui.

- [ ] **Step 4: Implémenter le handler `host:relaunch`** dans `game-gateway.ts`

Ordre : `requireHost(socket)` → `engine.getSession(oldId)` → si `phase !== 'podium'` lever `new Error('host:relaunch : relance possible seulement en fin de partie')` → `resolveHostContext(socket)` → `buildHostedSession(...)` (les erreurs pré-vol remontent ici, avant toute migration) → migration (Step 5) → `reply({ sessionId: neu.id, pin: neu.pin })`. Tout dans un `try/catch` renvoyant `{ error }` comme les autres handlers.

- [ ] **Step 5: Implémenter la migration best-effort** (dans le handler ou un helper local `migrateRoom(oldId, oldSession, neu, newMeta)`)

```ts
const sockets = await io.in(roomName(oldId)).fetchSockets()
for (const s of sockets) {
  const sd = s.data as SocketData
  if (sd.role === 'player' && sd.playerId) {
    const oldPlayer = oldSession.players[sd.playerId]
    if (!oldPlayer) continue
    try {
      const { player } = await engine.addPlayer(neu.id, oldPlayer.nickname)
      const dbPlayer = await withTenantTx(appDb, { tenantId: newMeta.tenantId }, (scope) =>
        addSessionPlayer(scope.db, newMeta.dbSessionId, { nickname: oldPlayer.nickname, joinToken: player.joinToken }))
      newMeta.playerDbIds.set(player.id, dbPlayer.id)
      s.emit('session:relaunched', { role: 'player', pin: neu.pin, playerId: player.id, joinToken: player.joinToken, nickname: oldPlayer.nickname })
    } catch { /* best-effort : ce participant reste sur l'ancien podium */ }
  } else if (sd.role === 'screen') {
    const displayToken = crypto.randomUUID()
    screenTokenToSessionId.set(displayToken, neu.id)
    s.emit('session:relaunched', { role: 'screen', pin: neu.pin, sessionId: neu.id, displayToken })
  }
  // role 'host' (socket appelante) : ignorée ici, l'ack suffit (l'hôte recharge).
}
```

- [ ] **Step 6: Lancer la suite gateway, vérifier le vert**

Run: `cd apps/server && npx vitest run src/game-gateway.test.ts`
Expected: PASS (nouveaux tests + non-régression host:create/reconnexions/écran).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game-gateway.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(server): host:relaunch — relance d'une partie au podium avec migration des participants"
```

---

### Task 2: Web — adoption côté joueur (`session:relaunched`)

**Files:**
- Create: `apps/web/src/realtime/hardReload.ts`
- Modify: `apps/web/src/realtime/contracts.ts` (type partagé `SessionRelaunchedView`)
- Modify: `apps/web/src/screens/PlayerLive.tsx` (abonnement `session:relaunched`)
- Test: `apps/web/src/screens/PlayerLive.rejoin.test.tsx` (ajouter un describe)

**Interfaces:**
- Consomme : `session:relaunched` (Task 1) ; `savePlayerSession` (`realtime/playerSession`).
- Produit :
  - `contracts.ts` : `export type SessionRelaunchedView = { role: 'player'; pin: string; playerId: string; joinToken: string; nickname: string } | { role: 'screen'; pin: string; sessionId: string; displayToken: string }`
  - `hardReload.ts` : `export function hardReload(url: string): void` (enveloppe `window.location.assign(url)`, isolée pour être mockable sous jsdom).

- [ ] **Step 1: Écrire le test en échec** (nouveau describe dans `PlayerLive.rejoin.test.tsx`)

Mocker le module de rechargement : `vi.mock('../realtime/hardReload', () => ({ hardReload: vi.fn() }))` et importer le mock.

```ts
it('session:relaunched (joueur) : enregistre la nouvelle identité et recharge /play', async () => {
  renderPlayerLive()
  await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
  emitServerEvent('session:relaunched', { role: 'player', pin: '777777', playerId: 'p9', joinToken: 'tok9', nickname: 'Ana' })
  expect(loadPlayerSession()).toMatchObject({ pin: '777777', playerId: 'p9', joinToken: 'tok9', nickname: 'Ana' })
  expect(hardReload).toHaveBeenCalledWith('/play')
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/screens/PlayerLive.rejoin.test.tsx`
Expected: FAIL (aucun abonnement `session:relaunched`).

- [ ] **Step 3: Implémenter** `hardReload.ts`, le type dans `contracts.ts`, et l'abonnement dans PlayerLive

Dans l'effet unique de PlayerLive, ajouter `const offRelaunch = on<SessionRelaunchedView>('session:relaunched', (v) => { if (v.role !== 'player') return; savePlayerSession({ pin: v.pin, playerId: v.playerId, joinToken: v.joinToken, nickname: v.nickname }); hardReload('/play') })` et appeler `offRelaunch()` dans le cleanup. Importer `savePlayerSession` (déjà importé `clearPlayerSession`/`loadPlayerSession` du même module) et `hardReload`.

- [ ] **Step 4: Lancer les tests PlayerLive, vérifier le vert**

Run: `cd apps/web && npx vitest run src/screens/PlayerLive.rejoin.test.tsx src/screens/PlayerLive.arcade.test.tsx src/screens/PlayerLive.reading.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/realtime/hardReload.ts apps/web/src/realtime/contracts.ts apps/web/src/screens/PlayerLive.tsx apps/web/src/screens/PlayerLive.rejoin.test.tsx
git commit -m "feat(web): le joueur adopte la partie relancée (session:relaunched) et rejoint le nouveau lobby"
```

---

### Task 3: Web — bascule du grand écran (`session:relaunched`)

**Files:**
- Modify: `apps/web/src/screens/BigScreen.tsx` (abonnement `session:relaunched`, variante écran)
- Test: `apps/web/src/screens/BigScreen.motion.test.tsx` (ajouter un test) ou nouveau `BigScreen.relaunch.test.tsx` calqué dessus

**Interfaces:**
- Consomme : `session:relaunched` (Task 1, variante écran) ; `SessionRelaunchedView` (Task 2) ; `hardReload` (Task 2).

- [ ] **Step 1: Écrire le test en échec**

Rendre BigScreen sur une route `/screen/:sessionId?token=…&pin=…&title=…` (voir le harnais de `BigScreen.motion.test.tsx`), mocker `../realtime/hardReload`, émettre `session:relaunched` variante écran, et vérifier le rechargement :

```ts
it('session:relaunched (écran) : recharge vers la nouvelle URL grand écran', async () => {
  emitServerEvent('session:relaunched', { role: 'screen', pin: '777777', sessionId: 'sess-new', displayToken: 'tok-new' })
  expect(hardReload).toHaveBeenCalledWith(expect.stringContaining('/screen/sess-new'))
  const url = (hardReload as Mock).mock.calls[0][0] as string
  expect(url).toContain('token=tok-new')
  expect(url).toContain('pin=777777')
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/screens/BigScreen`
Expected: FAIL.

- [ ] **Step 3: Implémenter l'abonnement dans BigScreen**

Dans l'effet d'abonnements unique, ajouter `const offRelaunch = on<SessionRelaunchedView>('session:relaunched', (v) => { if (v.role !== 'screen') return; const u = new URL('/screen/' + v.sessionId, window.location.origin); u.searchParams.set('token', v.displayToken); u.searchParams.set('pin', v.pin); if (quizTitle) u.searchParams.set('title', quizTitle); hardReload(u.pathname + u.search) })` et l'ajouter au cleanup. (`quizTitle` est déjà lu depuis les searchParams au montage — on le reporte pour garder le titre à l'écran.)

- [ ] **Step 4: Lancer les tests BigScreen, vérifier le vert**

Run: `cd apps/web && npx vitest run src/screens/BigScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/BigScreen.tsx apps/web/src/screens/BigScreen*.test.tsx
git commit -m "feat(web): le grand écran suit la partie relancée (session:relaunched)"
```

---

### Task 4: Web — contrôle de relance au podium (HostLive)

**Files:**
- Modify: `apps/web/src/screens/HostLive.tsx` (sélecteur de quiz + bouton de relance dans la phase podium)
- Modify: `apps/web/src/prototype.css` (styles du bloc de relance, si nécessaire)
- Test: `apps/web/src/screens/HostLive.relaunch.test.tsx` (nouveau, calqué sur `HostLive.reading.test.tsx`)

**Interfaces:**
- Consomme : `host:relaunch` (Task 1, ack `{ sessionId, pin }`) ; `listQuizzes()` / `QuizListItem` (`api/quizzes`) ; `hardReload` (Task 2) ; `emitAck` (socket partagée).

- [ ] **Step 1: Écrire le test en échec** (`HostLive.relaunch.test.tsx`)

Mocker `../api/quizzes` (`listQuizzes` renvoie 2 quiz) et `../realtime/hardReload`. Rendre HostLive, l'amener au podium (émettre `podium`), vérifier la présence du sélecteur et du bouton, choisir un quiz, cliquer, puis :

```ts
it('podium : relancer sur un quiz choisi émet host:relaunch puis recharge /host/:nouvelId', async () => {
  // emit 'podium' ; attendre le sélecteur ; choisir quizB ; cliquer « Relancer »
  await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:relaunch', { quizId: 'quizB' }))
  // l'ack mocké renvoie { sessionId: 'sess-new', pin: '777777' }
  await waitFor(() => expect(hardReload).toHaveBeenCalledWith('/host/sess-new'))
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/screens/HostLive.relaunch.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter le bloc de relance** dans la phase podium de HostLive

Dans le bloc `{phase === 'podium' && (…)}`, sous `<PodiumView />`, ajouter un petit panneau : charger `listQuizzes()` (état chargement/erreur) au passage en podium (effet déclenché sur `phase === 'podium'`, chargé une fois), un `<select>` de quiz et un bouton « Relancer une partie ». Au clic : `const ack = await emitAck<{ sessionId: string; pin: string }>('host:relaunch', { quizId })` puis `hardReload('/host/' + ack.sessionId)`. Gérer l'état en cours/erreur avec les patterns déjà présents (`actionPending`/`actionError` ou équivalents locaux). Respecter la typographie (casse de phrase, pas de cadratin).

- [ ] **Step 4: Lancer les tests HostLive, vérifier le vert**

Run: `cd apps/web && npx vitest run src/screens/HostLive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/HostLive.tsx apps/web/src/screens/HostLive.relaunch.test.tsx apps/web/src/prototype.css
git commit -m "feat(web): bouton de relance au podium hôte (choix du quiz, host:relaunch)"
```

---

### Task 5: Vérification d'ensemble et type-check

**Files:** aucun code attendu ; correctifs mineurs seulement si un check échoue.

- [ ] **Step 1: Type-check + lint + tests complets**

Run (depuis la racine) : la commande du dépôt pour typecheck/lint/test (voir `package.json` racine : p. ex. `pnpm -r typecheck` / `pnpm -r test`). Ne PAS lancer `biome format --write`.
Expected: tout vert.

- [ ] **Step 2: Commit éventuel des correctifs**

```bash
git add -A && git commit -m "chore: type-check et correctifs de la relance de partie"
```
