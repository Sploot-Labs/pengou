# Persistance des sessions de jeu — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Rendre les parties durables : l'état moteur (`GameSession`) est persisté dans Postgres et réhydraté au démarrage, de sorte qu'un redémarrage serveur ne casse plus les parties (hôte + joueurs reprennent où c'était).

**Architecture:** Le moteur passe déjà tout par `store.save(GameSession)` (interface `SessionStore` async). On remplace `MemorySessionStore` par un `PersistentSessionStore` (cache mémoire + write-through Postgres), on unifie l'id moteur/DB, et on réhydrate les sessions actives au boot (réhydratation du store + reconstruction de la `SessionMeta` gateway + re-ancrage des timers à neuf). Le moteur ne change pas.

**Tech Stack:** Drizzle/Postgres, TypeScript, Socket.IO, Vitest (DB tests = vrai Postgres via testcontainers/Docker).

## Global Constraints
- **Le moteur (`packages/game`) reste agnostique du store** : ne PAS lui ajouter de dépendance DB. Le store persistant vit dans `apps/server`, injecté via `createEngine({ store })`.
- **Reprise complète** ; **timer qui repart à neuf** à la réhydratation (re-ancre `readingStartedAt`/`questionStartedAt = now()`).
- **Anti-triche** : la réhydratation/reprise réutilise les helpers existants (`playerQuestionView`, jamais le payload brut) — jamais la bonne réponse avant l'heure.
- **Rétro-compat** : les tests moteur unitaires gardent `MemorySessionStore` ; le contrat `SessionStore` (`get/getByPin/save/delete`, tous async, retour clonné) est préservé.
- Runner : `pnpm vitest run <path>` ciblé. DB/serveur nécessitent Docker (Postgres de test). PAS `pnpm test` (lent).
- `GameSession` (forme, `packages/game/src/state.ts`) : `id, pin, quizId, tenantId, hostId, phase, questions[], currentIndex, questionStartedAt, readingStartedAt, players{}, answers{}, credited{}`. `answers`/`credited` sont indexés par **numéro de question** → clés string en JSON, à re-parser à la lecture.

## Structure des fichiers
- `packages/db/src/schema.ts` — colonne `engine_state jsonb` sur `game_session`.
- `packages/db/drizzle/0009_*.sql` — migration (générée).
- `packages/db/src/repos/session.ts` (+ `session.test.ts`) — helpers `engine_state` + resumable/stale.
- `packages/db/src/index.ts` — exports des nouveaux helpers.
- `packages/game/src/engine.ts` (+ tests) — `createSession` accepte un `id` optionnel.
- `apps/server/src/game-gateway.ts` (+ `game-gateway.test.ts`) — unification id (host:create/reconnect), `rehydrateActiveSessions`, reconstruction `SessionMeta`, re-ancrage timers.
- `apps/server/src/persistent-store.ts` (créé) + `persistent-store.test.ts` — `PersistentSessionStore`.
- `apps/server/src/index.ts` — injecte `PersistentSessionStore`, déclenche la réhydratation au boot.

---

## Task 1 : DB — colonne `engine_state` + helpers repo

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/src/repos/session.ts`, `packages/db/src/repos/session.test.ts`, `packages/db/src/index.ts`. Create migration `packages/db/drizzle/0009_*.sql`.

**Interfaces:**
- Produces (repo, `packages/db`) :
  - `saveEngineState(db: Db, sessionId: string, state: unknown): Promise<void>` — UPSERT `engine_state = state`.
  - `clearEngineState(db: Db, sessionId: string): Promise<void>` — `engine_state = null`.
  - `loadEngineState(db: Db, sessionId: string): Promise<unknown | null>`.
  - `loadEngineStateByPin(db: Db, pin: string): Promise<unknown | null>` — état de la session de ce PIN dont `status <> 'ended'`.
  - `listResumableSessions(db: Db, maxAgeMs: number): Promise<Array<{ id: string; engineState: unknown }>>` — status `active`/`lobby`, `engine_state` non nul, `created_at >= now - maxAgeMs`.
  - `endStaleSessions(db: Db, maxAgeMs: number): Promise<number>` — status `active`/`lobby` avec `created_at < now - maxAgeMs` → `status='ended'`, `engine_state=null`. Renvoie le nb de lignes.

- [ ] **Step 1 — schéma** : dans `schema.ts`, table `game_session`, ajouter `engineState: jsonb('engine_state')` (nullable, sans default). (Importer `jsonb` de `drizzle-orm/pg-core` s'il ne l'est pas déjà.)
- [ ] **Step 2 — migration** : `pnpm --filter @splootlabs/db db:generate` → `0009_*.sql` = `ALTER TABLE "game_session" ADD COLUMN "engine_state" jsonb;`. Vérifier (additif, nullable), committer.
- [ ] **Step 3 — test (échoue d'abord)** : dans `session.test.ts`, ajouter :
```ts
it('engine_state : save/load/clear + resumable/stale', async () => {
  const scope = tenantScope(ctx.db, tenantA)
  const s = await createGameSession(scope, { quizId: quizA, hostId: ownerA, pin: '900001' })
  await setSessionStatus(ctx.db, s!.id, 'active')
  await saveEngineState(ctx.db, s!.id, { id: s!.id, phase: 'question', answers: { 0: {} } })
  expect(await loadEngineState(ctx.db, s!.id)).toMatchObject({ phase: 'question' })
  expect(await loadEngineStateByPin(ctx.db, '900001')).toMatchObject({ phase: 'question' })
  const resumable = await listResumableSessions(ctx.db, 60_000)
  expect(resumable.map((r) => r.id)).toContain(s!.id)
  await clearEngineState(ctx.db, s!.id)
  expect(await loadEngineState(ctx.db, s!.id)).toBeNull()
  // stale : une session dont created_at est ancien → endStaleSessions la clôt.
  // (créer une session, forcer created_at ancien via un UPDATE de test, puis endStaleSessions)
})
```
(Adapter au harness du fichier — `ctx.db`, `tenantScope`, `createGameSession`, `setSessionStatus` existent déjà. Pour le cas "stale", forcer `created_at` en base via `ctx.db.execute(sql\`UPDATE game_session SET created_at = now() - interval '2 days' WHERE id = ${id}\`)` puis `endStaleSessions(ctx.db, 3600_000)` et asserter le status `ended`.)
- [ ] **Step 4 — implémenter les helpers** dans `session.ts` (Drizzle : `update(schema.gameSession).set({ engineState: state }).where(eq(id))` ; `select` pour load ; pour `loadEngineStateByPin`, join/filter `pin` + `status <> 'ended'` ; `listResumableSessions` : `where(and(inArray(status,['active','lobby']), isNotNull(engineState), gte(createdAt, cutoff)))` ; `endStaleSessions` : `update().set({ status:'ended', engineState:null }).where(and(inArray(status,['active','lobby']), lt(createdAt, cutoff)))` renvoyant le rowCount). Exporter depuis `packages/db/src/index.ts`.
- [ ] **Step 5 — tests** : `pnpm vitest run packages/db/src/repos/session.test.ts` (Docker). Vert.
- [ ] **Step 6 — commit** : `git add packages/db && git commit -m "feat(db): colonne engine_state + helpers persistance/résumé de session"`

---

## Task 2 : Unifier l'id moteur ↔ DB

**Files:** Modify `packages/game/src/engine.ts`, `packages/game/src/index.ts` (si le type d'input est exporté), `apps/server/src/game-gateway.ts`, `apps/server/src/game-gateway.test.ts`. Tests moteur si présents.

**Interfaces:**
- Consumes: `createGameSession` (repo), `engine.createSession`.
- Produces: après `host:create`, `engine session.id === game_session.id`. `dbSessionIdToEngineId` supprimée.

**⚠️ Ordre imposé par le store persistant (Task 3/4)** : `store.save(session)` écrit dans la colonne `engine_state` de la ligne `game_session` (`UPDATE … WHERE id = session.id`). La ligne DB doit donc **exister AVANT** le premier `engine.createSession` (qui appelle `store.save`), sinon l'UPDATE ne persiste rien. → **DB d'abord**, ce qui impose de connaître le PIN (généré par le moteur) avant la ligne DB. On expose donc un générateur de PIN unique et on passe `id` + `pin` au moteur.

- [ ] **Step 1 — test moteur (échoue)** : asserter que `createSession({ id: 'fixed-id', pin: '424242', … })` produit `session.id === 'fixed-id'` et `session.pin === '424242'` ; et que sans `id`/`pin`, le comportement (genId/uniquePin) est inchangé. Asserter aussi que `engine.generateUniquePin()` renvoie un PIN non déjà pris (créer une session avec un PIN, puis vérifier que `generateUniquePin` ne le renvoie pas — ou au moins qu'il renvoie une string de PIN valide).
- [ ] **Step 2 — moteur** :
  - `CreateSessionInput` gagne `id?: string` et `pin?: string`. Corps : `id: input.id ?? genId()` ; `const pin = input.pin ?? await uniquePin()`.
  - Exposer `generateUniquePin(): Promise<string>` sur l'interface `Engine` → délègue à `uniquePin()` (l'helper interne existant).
- [ ] **Step 3 — test gateway (échoue)** : dans `game-gateway.test.ts`, après un `host:create`, asserter que l'ack `sessionId` est **égal à l'id de la ligne `game_session`** créée (récupérer la ligne par PIN ou via le retour, comparer). Suivre le harness existant.
- [ ] **Step 4 — gateway host:create (réordonner, DB d'abord)** :
  1. `const pin = await engine.generateUniquePin()`.
  2. `const dbSession = await createGameSession(scope, { quizId, hostId, pin })` → `dbSession.id` (createGameSession génère l'id DB canonique).
  3. `const session = await engine.createSession({ id: dbSession.id, pin, quizId, tenantId, hostId, questions })` — le `store.save` interne persiste alors dans la ligne DB déjà existante.
  4. Ack inchangé : `{ sessionId: session.id, pin: session.pin }` (session.id === dbSession.id).
  Conserver le reste (résolution du scope, garde d'auth, `meta` initiale avec `readingTimeout: null`).
- [ ] **Step 5 — supprimer `dbSessionIdToEngineId`** : retirer la map, son remplissage (host:create), et son usage dans `host:reconnect` (le `rawSessionId` EST maintenant l'id unifié → `sessionMetaByEngineId.get(sessionId)` directement). Mettre à jour `emitReconnectSnapshot` si besoin (plus de résolution d'id). Mettre à jour les commentaires périmés.
- [ ] **Step 6 — tests** : `pnpm vitest run apps/server/src/game-gateway.test.ts` + `pnpm vitest run apps/server/src/game-e2e.test.ts`. Vert (adapter les tests qui supposaient des ids distincts). Typecheck serveur si besoin (rebuild dist des packages modifiés).
- [ ] **Step 7 — commit** : `git commit -am "refactor(game): id de session unifié moteur↔DB (supprime dbSessionIdToEngineId)"`

---

## Task 3 : `PersistentSessionStore` (cache + write-through Postgres)

**Files:** Create `apps/server/src/persistent-store.ts`, `apps/server/src/persistent-store.test.ts`.

**Interfaces:**
- Consumes: `SessionStore`/`GameSession` de `@splootlabs/game` ; helpers `saveEngineState/loadEngineState/loadEngineStateByPin/clearEngineState` (Task 1) ; `Db`.
- Produces: `class PersistentSessionStore implements SessionStore` (`new PersistentSessionStore(db)`).

- [ ] **Step 1 — test (échoue)** : `persistent-store.test.ts` (Docker/Postgres) :
```ts
it('persiste et relit depuis la base après vidage du cache (simule un process neuf)', async () => {
  // Pré-créer une game_session (pour la FK) puis :
  const store = new PersistentSessionStore(ctx.db)
  const s = /* un GameSession complet avec answers:{0:{...}}, credited:{0:true} */
  await store.save(s)
  const fresh = new PersistentSessionStore(ctx.db) // cache vide → lit la base
  const got = await fresh.get(s.id)
  expect(got).toBeDefined()
  expect(got!.answers[0]).toBeDefined()      // clé numérique re-parsée
  expect(got!.credited[0]).toBe(true)
  expect(await fresh.getByPin(s.pin)).toMatchObject({ id: s.id })
  await fresh.delete(s.id)
  expect(await new PersistentSessionStore(ctx.db).get(s.id)).toBeUndefined()
})
```
(La `game_session` doit exister en base pour la FK `engine_state` — créer via `createGameSession` + `setSessionStatus('active')` avec le MÊME id que le `GameSession` moteur — d'où l'unification Task 2, id partagé.)
- [ ] **Step 2 — lancer, échec.**
- [ ] **Step 3 — implémenter** `PersistentSessionStore` : cache `Map<string, GameSession>` + `Map<pin,id>`. 
  - `save(s)` : `structuredClone` en cache (comme `MemorySessionStore`) + `saveEngineState(db, s.id, serialize(s))`.
  - `get(id)` : cache (clone) ; sinon `loadEngineState(db,id)` → `deserialize` → mettre en cache → clone ; sinon `undefined`.
  - `getByPin(pin)` : cache (clone, exclut `phase==='podium'`) ; sinon `loadEngineStateByPin(db,pin)` → deserialize → cache → clone ; sinon `undefined`.
  - `delete(id)` : retirer du cache + `clearEngineState(db,id)`.
  - `serialize(s)` = `s` tel quel (jsonb accepte l'objet) ; `deserialize(raw)` : reconstruire les Records à **clés numériques** — `answers`/`credited` : `Object.fromEntries(Object.entries(raw.answers).map(([k,v]) => [Number(k), v]))`. (Le reste est déjà correct.)
  - Réutiliser le patron de clonage de `MemorySessionStore` (jamais retourner une réf mutable partagée).
- [ ] **Step 4 — tests** : `pnpm vitest run apps/server/src/persistent-store.test.ts`. Vert.
- [ ] **Step 5 — commit** : `git commit -m "feat(server): PersistentSessionStore (cache + write-through Postgres)"`

---

## Task 4 : Réhydratation au boot + reconstruction SessionMeta + re-ancrage timers

**Files:** Modify `apps/server/src/game-gateway.ts`, `apps/server/src/index.ts`, `apps/server/src/game-gateway.test.ts`.

**Interfaces:**
- Consumes: `PersistentSessionStore` (Task 3) ; `listResumableSessions`/`endStaleSessions` (Task 1) ; les `session_player` (join_token) via un helper de lecture (ajouter `listSessionPlayers(db, dbSessionId)` si absent — repo session).
- Produces: `registerGameGateway` réhydrate les sessions actives au montage (ou expose `rehydrateActiveSessions()` appelée par `index.ts`).

- [ ] **Step 1 — test intégration (échoue)** : dans `game-gateway.test.ts`, un test « survit à un redémarrage » : monter un 1er `engine`(`PersistentSessionStore(ctx.db)`)+gateway, `host:create` + un joueur rejoint + passer en `question`. Puis construire un **NOUVEAU** `engine`(nouveau `PersistentSessionStore` sur la MÊME `ctx.db`)+gateway et lancer sa réhydratation → asserter : `host:reconnect {sessionId}` (même id) réussit, l'ack a la bonne `phase`, le socket reçoit le snapshot (joueurs + question). (Suivre le harness socket existant ; fake timers si besoin pour le re-ancrage lecture.)
- [ ] **Step 2 — lancer, échec.**
- [ ] **Step 3 — implémenter la réhydratation** dans `game-gateway.ts`. Ajouter une fonction (interne, appelée à l'enregistrement OU exposée) `async function rehydrateActiveSessions(maxAgeMs)` :
  - `await endStaleSessions(db, maxAgeMs)`.
  - `const rows = await listResumableSessions(db, maxAgeMs)`.
  - Pour chaque `row` : `const session = await engine.getSession(row.id)` (via le store persistant → charge depuis `row.engineState`). Si absent, continuer.
    - **Reconstruire `SessionMeta`** dans `sessionMetaByEngineId` : `dbSessionId = row.id` (unifié) ; `playerDbIds` : lire les `session_player` de `row.id` et matcher `join_token` ↔ `session.players[*].joinToken` → `Map(engineId → dbPlayerId)` ; `revealedRounds = new Set(Object.keys(session.credited).filter(k=>session.credited[+k]).map(Number))` ; `autoRevealedRounds = new Set(revealedRounds)` ; `statusActiveSet = (session.phase !== 'lobby')` ; `readingTimeout = null` ; `revealedRounds` etc. selon la forme réelle de `SessionMeta`. Réinsérer `pinToSessionId.set(session.pin, row.id)`.
    - **Re-ancrer le timer à neuf** selon `session.phase` :
      - `reading` → `session.readingStartedAt = now()` ; `await store.save(session)` ; ré-émettre `question:reading` à la room (harmless au boot) ; **reprogrammer** `meta.readingTimeout = setTimeout(() => void revealAnswersFlow(row.id, meta).catch(()=>{}), session.readingTime*1000)` (réutiliser `startQuestionFlow`/`revealAnswersFlow` existants — factoriser si utile).
      - `question` → `session.questionStartedAt = now()` ; `await store.save(session)` ; ré-émettre `question:show`(playerQuestionView) + `emitTimer` à la room.
      - autres phases (`reveal`/`scoreboard`/`podium`/`lobby`) → rien à reprogrammer (l'état est déjà bon ; la reconnexion enverra le snapshot).
  - Appeler `rehydrateActiveSessions(SESSION_MAX_AGE)` à la fin de `registerGameGateway` (ou l'exposer et l'appeler dans `index.ts` après `registerGameGateway`). `SESSION_MAX_AGE` = constante (ex. `12 * 3600_000`).
  - Ajouter `listSessionPlayers(db, dbSessionId)` au repo si absent (retourne `{ id, joinToken, nickname }[]`).
- [ ] **Step 4 — brancher le store persistant** dans `apps/server/src/index.ts` : remplacer `new MemorySessionStore()` par `new PersistentSessionStore(db)` dans `createEngine({ store: … })`. (La réhydratation se déclenche via `registerGameGateway`.) Mettre à jour le commentaire « voir Plan 7 … Redis ».
- [ ] **Step 5 — clôture podium** : là où une partie atteint `podium` (fin), s'assurer que `engine_state` est vidé (soit le store `delete`, soit `clearEngineState`) — vérifier le flux `host:next`→podium et appeler le nettoyage.
- [ ] **Step 6 — tests** : `pnpm vitest run apps/server/src/game-gateway.test.ts apps/server/src/game-e2e.test.ts`. Vert.
- [ ] **Step 7 — commit** : `git commit -am "feat(game): réhydratation des sessions au boot (store persistant + reconstruction meta + re-ancrage timers)"`

---

## Task 5 : QA d'intégration (contrôleur)

Non-TDD — vérification bout-en-bout par le contrôleur (stack lancée) :
- [ ] Lancer une partie (quiz avec temps de lecture), un joueur rejoint, passer en question.
- [ ] **Redémarrer le serveur** (`tsx watch` restart / kill+relaunch).
- [ ] Recharger l'hôte (`/host/:id`) → `host:reconnect` retrouve la partie (plus de « session introuvable ») ; le joueur se reconnecte ; l'état est cohérent (joueurs, phase, question, scores).
- [ ] Vérifier qu'une session très ancienne (forcer `created_at` en base) est marquée `ended` au boot et n'apparaît plus comme reprenable.

---

## Self-review (couverture spec)
- Spec §1 (unifier ids) → Task 2. §2 (colonne `engine_state`) → Task 1. §3 (`PersistentSessionStore`) → Task 3. §4 (réhydratation/reconstruction/re-ancrage) → Task 4. §5 (reconnexion T8 existante) → réutilisée en Task 4/5. §6 (cycle de vie/nettoyage podium + périmées) → Task 4 (podium clear) + Task 1/4 (endStaleSessions). Tests → chaque task + Task 5. Risques (fréquence d'écriture, cohérence reprise, sérialisation clés numériques, anti-triche, refactor id) → contraintes globales + Tasks 2/3/4.
- **Décision explicite** : re-ancrage des timers **au boot** (pas à la reconnexion) — simple et conforme à « repart à neuf depuis le redémarrage » ; les clients reçoivent le timer re-ancré via le snapshot de reconnexion.
