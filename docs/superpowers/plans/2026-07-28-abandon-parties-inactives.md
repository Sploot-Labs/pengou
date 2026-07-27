# Abandon automatique des parties inactives + liste « en cours » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire basculer automatiquement en statut terminal `abandoned` les parties devenues inactives (timeout), et réorganiser « Parties récentes » en deux sections (En cours / Historique).

**Architecture:** La bascule est autoritaire côté base : un `UPDATE` SQL sur une nouvelle colonne `last_activity_at`, estampillée à chaque write-through du store persistant. Un `setInterval` mono-instance dans la composition root (`index.ts`) appelle périodiquement un balayage exposé par la passerelle, qui fait la bascule DB puis nettoie l'état mémoire local (timers + caches). La liste filtre désormais par statut côté serveur ; le front affiche deux sections.

**Tech Stack:** TypeScript, Drizzle ORM + Postgres (drizzle-kit), Fastify, Socket.IO, React/Vite, Vitest (+ `@testcontainers/postgresql` pour les tests DB, `@testing-library/react` côté web).

## Global Constraints

- **Statut `abandoned` est TERMINAL** : même traitement que `ended` (pas de reprise, PIN libéré, `engine_state` nettoyé).
- **Déclencheur = inactivité** mesurée par `last_activity_at`, PAS l'âge (`created_at`) ni la déconnexion socket. (Le balayage au boot conserve son critère `created_at`, existant.)
- **Mono-instance** : `setInterval` simple, aucun advisory lock ni coordination inter-réplicas. Le nettoyage mémoire suppose que la session vit dans CE process.
- **Anti-triche & persistance existantes inchangées** : ne jamais modifier les projections moteur (`playerQuestionView`/`readingView`) ni la logique de réhydratation, sauf le renommage/statut décrit en Task 3.
- **Défauts** : inactivité 30 min, période de balayage 5 min (configurables via env).
- **Langue** : commentaires et libellés en français, cohérents avec le code existant.
- **Rétro-compat de `listSessions`** : sans filtre de statut, comportement identique à aujourd'hui.

---

### Task 1: Migration — statut `abandoned`, colonne `last_activity_at`, index PIN

**Files:**
- Modify: `packages/db/src/schema.ts:10` (enum), `:57-74` (table `gameSession` : colonne + index partiel)
- Create: `packages/db/drizzle/00NN_*.sql` (généré par drizzle-kit) + snapshot `packages/db/drizzle/meta/*`
- Test: `packages/db/src/schema.test.ts:34` (assertion sur l'indexdef partiel)

**Interfaces:**
- Produces: la valeur d'enum `'abandoned'` sur `session_status` ; la colonne `game_session.last_activity_at timestamptz NOT NULL DEFAULT now()` exposée en Drizzle par `schema.gameSession.lastActivityAt` ; l'index unique partiel `game_session_active_pin_uidx` restreint à `status IN ('lobby','active')`.

- [ ] **Step 1: Modifier l'enum et la table dans le schéma**

Dans `packages/db/src/schema.ts`, remplacer la ligne 10 :

```ts
export const sessionStatusEnum = pgEnum('session_status', ['lobby', 'active', 'ended', 'abandoned'])
```

Dans le `pgTable('game_session', …)` (lignes 57-74), ajouter la colonne juste après `createdAt` (ligne 66) :

```ts
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
```

Et remplacer la définition de l'index partiel (ligne 72) pour exclure aussi `abandoned` (une partie abandonnée libère son PIN) :

```ts
  activePinUnique: uniqueIndex('game_session_active_pin_uidx').on(t.pin).where(sql`${t.status} in ('lobby', 'active')`),
```

- [ ] **Step 2: Générer la migration**

Run: `pnpm --filter @splootlabs/db db:generate`
Expected: un nouveau fichier `packages/db/drizzle/00NN_*.sql` est créé, contenant (dans cet ordre) un `ALTER TYPE "public"."session_status" ADD VALUE 'abandoned';`, un `ALTER TABLE "game_session" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;`, un `DROP INDEX "game_session_active_pin_uidx";` et un `CREATE UNIQUE INDEX … WHERE "game_session"."status" in ('lobby', 'active');`.

Ouvrir le fichier généré et vérifier ces 4 instructions. Le littéral `'abandoned'` n'est PAS utilisé dans la migration (l'index ne référence que `lobby`/`active`), donc l'`ADD VALUE` et son usage ne sont jamais dans la même transaction — la migration s'applique en un seul fichier.

- [ ] **Step 3: Écrire le test d'application de migration + valeur d'enum**

Dans `packages/db/src/schema.test.ts`, ajouter ce test (il prouve que la nouvelle valeur d'enum et la colonne existent après migration) :

```ts
it('accepte le statut abandoned et défaut last_activity_at', async () => {
  const [t] = await ctx.db.insert(schema.tenant).values({ name: 'AbandonEnum' }).returning()
  const [u] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'ab-enum@x.fr', name: 'AB', emailVerified: false }).returning()
  const [q] = await ctx.db.insert(schema.quiz).values({ tenantId: t.id, ownerId: u.id, title: 'Q' }).returning()
  const [s] = await ctx.db.insert(schema.gameSession)
    .values({ tenantId: t.id, quizId: q.id, hostId: u.id, pin: '909090', status: 'abandoned' }).returning()
  expect(s.status).toBe('abandoned')
  expect(s.lastActivityAt).toBeInstanceOf(Date)
})
```

- [ ] **Step 4: Mettre à jour l'assertion d'indexdef existante**

Le test `schema.test.ts:34` affirme encore l'ancien prédicat. Lancer d'abord la suite pour lire l'`indexdef` réel produit par Postgres, puis fixer la chaîne attendue.

Run: `pnpm --filter @splootlabs/db test -- schema`
Expected: le test de l'index partiel ÉCHOUE en montrant l'`indexdef` réel (Postgres normalise `in (...)` — typiquement `where (status = any (array['lobby'::session_status, 'active'::session_status]))`).

Remplacer la ligne 34 par l'assertion correspondant EXACTEMENT à la sortie observée, par ex. :

```ts
    expect((info[0] as { indexdef: string }).indexdef.toLowerCase()).toContain("where (status = any (array['lobby'::session_status, 'active'::session_status]))")
```

- [ ] **Step 5: Lancer les tests DB**

Run: `pnpm --filter @splootlabs/db test`
Expected: PASS (toutes les suites DB appliquent la nouvelle migration au démarrage du conteneur ; aucune régression).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/src/schema.test.ts
git commit -m "feat(db): statut abandoned + colonne last_activity_at + index PIN restreint aux parties vivantes"
```

---

### Task 2: Estampiller `last_activity_at` à chaque write-through

**Files:**
- Modify: `packages/db/src/repos/session.ts:128-132` (`saveEngineState`)
- Test: `packages/db/src/repos/session.test.ts`

**Interfaces:**
- Consumes: `schema.gameSession.lastActivityAt` (Task 1).
- Produces: `saveEngineState(db, id, state)` met désormais aussi `last_activity_at = now()`. (Seul appelant : `PersistentSessionStore.save`, `apps/server/src/persistent-store.ts:67` — donc toute mutation moteur rafraîchit l'activité.)

- [ ] **Step 1: Écrire le test qui échoue**

Dans `packages/db/src/repos/session.test.ts`, ajouter :

```ts
it('saveEngineState rafraîchit last_activity_at', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '717171' })
  await ctx.db.update(schema.gameSession)
    .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
    .where(eq(schema.gameSession.id, session!.id))
  await saveEngineState(ctx.db, session!.id, { phase: 'question' })
  const [row] = await ctx.db.select({ last: schema.gameSession.lastActivityAt })
    .from(schema.gameSession).where(eq(schema.gameSession.id, session!.id))
  expect(row.last.getTime()).toBeGreaterThan(new Date('2021-01-01T00:00:00Z').getTime())
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test -- session`
Expected: FAIL (`last_activity_at` reste à 2020, non rafraîchi).

- [ ] **Step 3: Implémenter le bump**

Dans `packages/db/src/repos/session.ts`, remplacer le corps de `saveEngineState` (lignes 128-132) :

```ts
export async function saveEngineState(db: Db, sessionId: string, state: unknown): Promise<void> {
  await db.update(schema.gameSession)
    .set({ engineState: state as never, lastActivityAt: new Date() })
    .where(eq(schema.gameSession.id, sessionId))
}
```

- [ ] **Step 4: Lancer le test**

Run: `pnpm --filter @splootlabs/db test -- session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repos/session.ts packages/db/src/repos/session.test.ts
git commit -m "feat(db): saveEngineState estampille last_activity_at (signal d'inactivité)"
```

---

### Task 3: `abandonInactiveSessions` + renommer le balayage boot vers `abandoned`

**Files:**
- Modify: `packages/db/src/repos/session.ts` (ajout `abandonInactiveSessions` ; renommer `endStaleSessions` → `abandonStaleSessions`, statut `abandoned`)
- Modify: `packages/db/src/index.ts:18` (exports)
- Modify: `apps/server/src/game-gateway.ts:6` (import) et `:424` (appel)
- Test: `packages/db/src/repos/session.test.ts` (import ligne 9 + tests)

**Interfaces:**
- Consumes: `schema.gameSession.lastActivityAt` (Task 1).
- Produces:
  - `abandonInactiveSessions(db: Db, inactivityMs: number): Promise<string[]>` — bascule `lobby`/`active` dont `last_activity_at < now()-inactivityMs` vers `abandoned` (pose `ended_at`, efface `engine_state`), retourne les ids basculés.
  - `abandonStaleSessions(db: Db, maxAgeMs: number): Promise<string[]>` — remplace `endStaleSessions` : même bascule mais critère `created_at < now()-maxAgeMs` (usage boot), statut cible `abandoned`, retourne les ids.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `packages/db/src/repos/session.test.ts`, mettre à jour l'import (ligne 9) en remplaçant `endStaleSessions` par `abandonStaleSessions` et en ajoutant `abandonInactiveSessions`. Si un test référence `endStaleSessions`, le renommer en `abandonStaleSessions` et remplacer son assertion de statut `'ended'` par `'abandoned'`. Puis ajouter :

```ts
it('abandonInactiveSessions bascule les parties inactives vers abandoned et libère le PIN', async () => {
  const s = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '818181' })
  await setSessionStatus(ctx.db, s!.id, 'active')
  await saveEngineState(ctx.db, s!.id, { phase: 'question' })
  await ctx.db.update(schema.gameSession)
    .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
    .where(eq(schema.gameSession.id, s!.id))

  const ids = await abandonInactiveSessions(ctx.db, 30 * 60_000)
  expect(ids).toContain(s!.id)

  const [row] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, s!.id))
  expect(row.status).toBe('abandoned')
  expect(row.endedAt).not.toBeNull()
  expect(row.engineState).toBeNull()

  // PIN réutilisable : une nouvelle session peut reprendre le même PIN sans violer l'index partiel.
  const reuse = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '818181' })
  expect(reuse).not.toBeNull()
})

it('abandonInactiveSessions ignore les parties récentes et déjà terminées', async () => {
  const fresh = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '828282' })
  await setSessionStatus(ctx.db, fresh!.id, 'active') // last_activity_at = now (défaut/insert récent)
  const ids = await abandonInactiveSessions(ctx.db, 30 * 60_000)
  expect(ids).not.toContain(fresh!.id)
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test -- session`
Expected: FAIL (`abandonInactiveSessions`/`abandonStaleSessions` non définis).

- [ ] **Step 3: Implémenter dans le repo**

Dans `packages/db/src/repos/session.ts`, ajouter `abandonInactiveSessions` et remplacer `endStaleSessions` (lignes 174-184) par `abandonStaleSessions` :

```ts
// Bascule vers le statut terminal `abandoned` les parties encore vivantes (lobby/active) restées
// inactives au-delà de `inactivityMs` (aucune mutation moteur — donc aucun `saveEngineState` —
// depuis ce délai). Efface le checkpoint (`engine_state`) et pose `ended_at`. Retourne les ids
// basculés pour permettre à l'appelant (passerelle) de nettoyer son état mémoire (timers/caches).
export async function abandonInactiveSessions(db: Db, inactivityMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - inactivityMs)
  const rows = await db.update(schema.gameSession)
    .set({ status: 'abandoned', endedAt: new Date(), engineState: null })
    .where(and(
      inArray(schema.gameSession.status, ['active', 'lobby']),
      lt(schema.gameSession.lastActivityAt, cutoff),
    ))
    .returning({ id: schema.gameSession.id })
  return rows.map((r) => r.id)
}

// Ménage au (re)démarrage : les parties lobby/active trop ANCIENNES (created_at) pour être
// reprises sont marquées `abandoned` (plus `ended` : une partie coupée par un long arrêt n'a
// jamais atteint son podium) et leur checkpoint effacé.
export async function abandonStaleSessions(db: Db, maxAgeMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const rows = await db.update(schema.gameSession)
    .set({ status: 'abandoned', endedAt: new Date(), engineState: null })
    .where(and(
      inArray(schema.gameSession.status, ['active', 'lobby']),
      lt(schema.gameSession.createdAt, cutoff),
    ))
    .returning({ id: schema.gameSession.id })
  return rows.map((r) => r.id)
}
```

- [ ] **Step 4: Mettre à jour les exports et l'appelant boot**

Dans `packages/db/src/index.ts` (ligne 18), remplacer `endStaleSessions` par `abandonStaleSessions, abandonInactiveSessions`.

Dans `apps/server/src/game-gateway.ts` : à la ligne 6, remplacer l'import `endStaleSessions` par `abandonStaleSessions` (et ajouter `abandonInactiveSessions` — utilisé en Task 6). À la ligne 424 (dans `rehydrateActiveSessions`), remplacer :

```ts
    await endStaleSessions(db, maxAgeMs)
```

par :

```ts
    await abandonStaleSessions(db, maxAgeMs)
```

- [ ] **Step 5: Lancer les tests DB**

Run: `pnpm --filter @splootlabs/db test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/session.ts packages/db/src/index.ts packages/db/src/repos/session.test.ts apps/server/src/game-gateway.ts
git commit -m "feat(db): abandonInactiveSessions + boot recalé sur statut abandoned"
```

---

### Task 4: Config — timeout d'inactivité + période de balayage

**Files:**
- Modify: `packages/shared/src/config.ts` (`EnvSchema`, `AppConfig`, `loadConfig`)
- Modify: `.env.example`
- Test: `packages/shared/src/config.test.ts` (créer si absent)

**Interfaces:**
- Produces: `config.sessionInactivityTimeoutMs: number` et `config.sessionSweepIntervalMs: number` (dérivés d'env en minutes).

- [ ] **Step 1: Écrire le test qui échoue**

Créer (ou compléter) `packages/shared/src/config.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig — inactivité/balayage', () => {
  it('défauts : 30 min d\'inactivité, 5 min de balayage (en ms)', () => {
    const c = loadConfig({ NODE_ENV: 'test' })
    expect(c.sessionInactivityTimeoutMs).toBe(30 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(5 * 60_000)
  })

  it('surcharge via env (minutes → ms)', () => {
    const c = loadConfig({ NODE_ENV: 'test', SESSION_INACTIVITY_TIMEOUT_MINUTES: '10', SESSION_SWEEP_INTERVAL_MINUTES: '1' })
    expect(c.sessionInactivityTimeoutMs).toBe(10 * 60_000)
    expect(c.sessionSweepIntervalMs).toBe(1 * 60_000)
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/shared test -- config`
Expected: FAIL (`sessionInactivityTimeoutMs` absent).

- [ ] **Step 3: Étendre la config**

Dans `packages/shared/src/config.ts`, ajouter dans `EnvSchema` (après `REDIS_URL`) :

```ts
  SESSION_INACTIVITY_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_SWEEP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
```

Ajouter à `AppConfig` (après `scaling`) :

```ts
  sessionInactivityTimeoutMs: number
  sessionSweepIntervalMs: number
```

Ajouter au retour de `loadConfig` (après `scaling`) :

```ts
    sessionInactivityTimeoutMs: parsed.SESSION_INACTIVITY_TIMEOUT_MINUTES * 60_000,
    sessionSweepIntervalMs: parsed.SESSION_SWEEP_INTERVAL_MINUTES * 60_000,
```

- [ ] **Step 4: Documenter dans .env.example**

Dans `.env.example`, sous la section multi-tenancy/sessions, ajouter :

```
# --- Cycle de vie des parties ---
# Une partie sans activité (aucune interaction/transition moteur) depuis ce délai est
# automatiquement basculée en statut terminal `abandoned` (mono-instance).
SESSION_INACTIVITY_TIMEOUT_MINUTES=30
# Période du balayage serveur qui applique la bascule ci-dessus.
SESSION_SWEEP_INTERVAL_MINUTES=5
```

- [ ] **Step 5: Lancer le test**

Run: `pnpm --filter @splootlabs/shared test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config.ts packages/shared/src/config.test.ts .env.example
git commit -m "feat(shared): config inactivité/balayage des parties (défauts 30 min / 5 min)"
```

---

### Task 5: `evict(id)` sur le store (éviction cache pure)

**Files:**
- Modify: `packages/game/src/store.ts` (interface `SessionStore` + `MemorySessionStore`)
- Modify: `apps/server/src/persistent-store.ts` (`PersistentSessionStore.evict`)
- Test: `apps/server/src/persistent-store.test.ts`

**Interfaces:**
- Produces: `SessionStore.evict(id: string): string | undefined` — retire une session du cache mémoire SANS écrire en base, retourne le PIN évincé (ou `undefined` si absente du cache). L'appelant (Task 6) l'utilise après que l'`UPDATE` d'abandon a déjà mis `engine_state` à null.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `apps/server/src/persistent-store.test.ts`, ajouter :

```ts
it('evict retire la session du cache sans toucher la base et retourne le PIN', async () => {
  const store = new PersistentSessionStore(ctx.db)
  const s = await createGameSession(tenantScope(ctx.db, tenantId), { quizId, hostId: ownerId, pin: '767676' })
  const session = makeSession(s!.id, '767676')
  await store.save(session)

  const pin = store.evict(s!.id)
  expect(pin).toBe('767676')

  // Le cache est vide : getByPin ne doit PAS ressusciter la session (engine_state existe encore
  // en base ici, mais getByPin exclut les sessions non vivantes — la ligne est toujours 'lobby',
  // donc on vérifie plutôt via un second evict qui ne retrouve rien en cache).
  expect(store.evict(s!.id)).toBeUndefined()
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/server test -- persistent-store`
Expected: FAIL (`store.evict` n'est pas une fonction).

- [ ] **Step 3: Ajouter `evict` à l'interface + MemorySessionStore**

Dans `packages/game/src/store.ts`, ajouter à l'interface `SessionStore` (après `delete`) :

```ts
  /** Retire une session du cache mémoire SANS persistance (retourne le PIN évincé, ou undefined).
   * Distinct de `delete` qui, lui, efface aussi l'état persistant. */
  evict(id: string): string | undefined
```

Et implémenter dans `MemorySessionStore` (après `delete`) :

```ts
  evict(id: string): string | undefined {
    const session = this.byId.get(id)
    if (!session) return undefined
    this.byId.delete(id)
    this.pinToId.delete(session.pin)
    return session.pin
  }
```

- [ ] **Step 4: Implémenter dans PersistentSessionStore**

Dans `apps/server/src/persistent-store.ts`, ajouter (après `delete`, avant `private index`) :

```ts
  /** Éviction cache uniquement : le balayage d'abandon (`sweepAbandonedSessions`, game-gateway)
   * a déjà mis `engine_state` à null via l'UPDATE SQL — inutile de réécrire en base ici. */
  evict(id: string): string | undefined {
    const session = this.byId.get(id)
    if (!session) return undefined
    this.byId.delete(id)
    this.pinToId.delete(session.pin)
    return session.pin
  }
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @splootlabs/game test && pnpm --filter @splootlabs/server test -- persistent-store`
Expected: PASS (les deux : MemorySessionStore satisfait toujours l'interface, PersistentSessionStore évince bien).

- [ ] **Step 6: Commit**

```bash
git add packages/game/src/store.ts apps/server/src/persistent-store.ts apps/server/src/persistent-store.test.ts
git commit -m "feat(store): evict(id) — éviction cache pure (sans écriture DB)"
```

---

### Task 6: Balayage périodique — passerelle + composition root

**Files:**
- Modify: `apps/server/src/game-gateway.ts` (deps `store`, fonction `sweepAbandonedSessions`, valeur de retour de `registerGameGateway`)
- Modify: `apps/server/src/index.ts` (hisser `store`, passer aux deps, `setInterval` + `clearInterval` dans `onClose`)
- Modify: harnais de test qui construisent la passerelle (`apps/server/src/game-e2e.test.ts`, `apps/server/src/game-gateway.test.ts`, et tout autre `registerGameGateway(...)` dans les tests) : passer `store` aux deps
- Test: `apps/server/src/sweep-e2e.test.ts` (créer)

**Interfaces:**
- Consumes: `abandonInactiveSessions` (Task 3), `SessionStore.evict` (Task 5), `config.sessionInactivityTimeoutMs`/`sessionSweepIntervalMs` (Task 4).
- Produces: `registerGameGateway(io, deps)` retourne `{ sweepAbandonedSessions: () => Promise<void> }`. `GameGatewayDeps` gagne `store: SessionStore`. `sweepAbandonedSessions()` : bascule DB via `abandonInactiveSessions`, puis pour chaque id basculé, `clearReadingTimeout` + suppression de `sessionMetaByEngineId`/`pinToSessionId`/`screenTokenToSessionId` + `store.evict`.

- [ ] **Step 1: Écrire le test d'intégration qui échoue**

Créer `apps/server/src/sweep-e2e.test.ts`. Réutiliser le patron de `game-e2e.test.ts` mais construire le moteur avec `PersistentSessionStore` (le balayage exige l'éviction cache + `last_activity_at` posé par `saveEngineState`). Le test crée une partie via socket (`host:create` puis `host:start`), force `last_activity_at` à une date ancienne en base, appelle `sweepAbandonedSessions()`, et vérifie la bascule + le nettoyage :

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { eq } from 'drizzle-orm'
import { startTestDb, runMigrations, schema } from '@splootlabs/db'
import { createAuth } from '@splootlabs/auth'
import { loadConfig } from '@splootlabs/shared'
import { createEngine, generatePin } from '@splootlabs/game'
import { buildServer } from './app.js'
import { registerAuth } from './auth-plugin.js'
import { registerEditor } from './editor.js'
import { attachRealtime } from './realtime.js'
import { registerGameGateway } from './game-gateway.js'
import { PersistentSessionStore } from './persistent-store.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

// NB : réutiliser les helpers signUp/seedQuiz/connectHost du fichier game-e2e voisin (les copier
// ici ou les extraire dans un helper partagé si déjà factorisés). Le cœur du test :
it('sweepAbandonedSessions bascule une partie inactive et nettoie mémoire + cache', async () => {
  const config = loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single' })
  const app = buildServer(config, { dbStatus: () => 'up' })
  const auth = createAuth(ctx.db, { secret: config.sessionSecret, baseURL: config.authUrl, tenancyMode: 'single' })
  await registerAuth(app, auth)
  registerEditor(app, { db: ctx.db, auth, config })
  const io = attachRealtime(app, config)
  const store = new PersistentSessionStore(ctx.db)
  const engine = createEngine({ store, now: () => Date.now(), genPin: generatePin, genId: () => crypto.randomUUID() })
  const gateway = await registerGameGateway(io, { engine, db: ctx.db, auth, config, store })
  await app.listen({ port: 0, host: '127.0.0.1' })

  // … via socket host : host:create (obtenir sessionId + pin), host:start (passe active + save) …
  // (voir game-e2e.test.ts pour le détail de connexion/ack)

  // Rendre la partie « inactive » :
  await ctx.db.update(schema.gameSession)
    .set({ lastActivityAt: new Date('2020-01-01T00:00:00Z') })
    .where(eq(schema.gameSession.id, sessionId))

  await gateway.sweepAbandonedSessions()

  const [row] = await ctx.db.select().from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
  expect(row.status).toBe('abandoned')
  expect(row.engineState).toBeNull()
  // Le PIN est libéré côté cache : getByPin ne retrouve plus rien.
  expect(await store.getByPin(pin)).toBeUndefined()

  await app.close()
})
```

(Copier les helpers de connexion socket depuis `game-e2e.test.ts`. Le point vérifié n'est pas le détail socket mais l'effet de `sweepAbandonedSessions`.)

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/server test -- sweep-e2e`
Expected: FAIL (`GameGatewayDeps` n'a pas `store` ; `gateway.sweepAbandonedSessions` n'existe pas).

- [ ] **Step 3: Étendre les deps et exposer le balayage**

Dans `apps/server/src/game-gateway.ts` :

Ajouter l'import du type `SessionStore` (ligne 11, à côté de `Engine`/`GameSession`) :

```ts
import type { Engine, EngineQuestion, GameSession, SessionStore } from '@splootlabs/game'
```

Ajouter à `GameGatewayDeps` (après `config`) :

```ts
  store: SessionStore
```

Déstructurer `store` (ligne 91) :

```ts
  const { engine, db, auth, config, store } = deps
```

Ajouter la fonction de balayage juste avant `await rehydrateActiveSessions(...)` (vers ligne 912), et la retourner. `sessionMetaByEngineId` est clé par l'id moteur == id `game_session` (unification Task 2), donc les ids renvoyés par `abandonInactiveSessions` s'y indexent directement :

```ts
  /** Balayage d'abandon (mono-instance) : bascule en base les parties inactives (autoritatif via
   * `abandonInactiveSessions`), puis nettoie l'état mémoire LOCAL de CE process pour chacune —
   * annule le minuteur de fin de lecture (sinon révélation fantôme), retire les entrées de
   * correspondance, et évince le cache du store (le PIN redevient réutilisable). Best-effort :
   * une session déjà absente de la mémoire (ex. jamais pilotée par ce process) est simplement
   * ignorée par les `get`/`delete` de Map. Appelé périodiquement par la composition root. */
  async function sweepAbandonedSessions(): Promise<void> {
    const ids = await abandonInactiveSessions(db, config.sessionInactivityTimeoutMs)
    for (const id of ids) {
      const meta = sessionMetaByEngineId.get(id)
      if (meta) clearReadingTimeout(meta)
      sessionMetaByEngineId.delete(id)
      const pin = store.evict(id)
      if (pin) pinToSessionId.delete(pin)
      for (const [token, sid] of screenTokenToSessionId) {
        if (sid === id) screenTokenToSessionId.delete(token)
      }
    }
  }
```

Changer la signature de retour de `registerGameGateway` (ligne 90) de `Promise<void>` à `Promise<{ sweepAbandonedSessions: () => Promise<void> }>`, et terminer la fonction (après `await rehydrateActiveSessions(SESSION_MAX_AGE)`, ligne 917) par :

```ts
  return { sweepAbandonedSessions }
```

- [ ] **Step 4: Câbler le setInterval dans la composition root**

Dans `apps/server/src/index.ts` :

Hisser le store (remplacer les lignes 42-47) :

```ts
const store = new PersistentSessionStore(db)
const engine = createEngine({
  store,
  now: () => Date.now(),
  genPin: generatePin,
  genId: () => crypto.randomUUID(),
})
const gateway = await registerGameGateway(io, { engine, db, auth, config, store })

// Balayage périodique des parties inactives (mono-instance). `.unref()` : ne maintient jamais le
// process en vie à lui seul. Erreurs loggées, jamais propagées (un tick ne doit pas tuer le serveur).
const sweepTimer = setInterval(() => {
  gateway.sweepAbandonedSessions().catch((err) => app.log.error(err, 'balayage des parties inactives échoué'))
}, config.sessionSweepIntervalMs)
sweepTimer.unref()
```

Mettre à jour le hook `onClose` (lignes 54-56) pour arrêter le timer :

```ts
app.addHook('onClose', async () => {
  clearInterval(sweepTimer)
  await client.end({ timeout: 5 })
})
```

- [ ] **Step 5: Mettre à jour les harnais de test de la passerelle**

Dans chaque test qui appelle `registerGameGateway(...)` (`apps/server/src/game-e2e.test.ts`, `apps/server/src/game-gateway.test.ts`, et repérer les autres via recherche), hisser le store hors du `createEngine` et le passer aux deps. Exemple de transformation :

```ts
// avant : createEngine({ store: new MemorySessionStore(), ... }) ; registerGameGateway(io, { engine, db, auth, config })
const store = new MemorySessionStore()
const engine = createEngine({ store, now: () => Date.now(), genPin: generatePin, genId: () => crypto.randomUUID() })
await registerGameGateway(io, { engine, db: ctx.db, auth, config, store })
```

(La valeur de retour de `registerGameGateway` peut être ignorée dans ces tests — ils ne balaient pas.)

Run (repérer les appelants) : `grep -rn "registerGameGateway(" apps/server/src`
Expected: chaque appelant passe désormais `store` dans les deps.

- [ ] **Step 6: Lancer la suite serveur**

Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (sweep-e2e inclus ; aucune régression des e2e existants).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game-gateway.ts apps/server/src/index.ts apps/server/src/sweep-e2e.test.ts apps/server/src/game-e2e.test.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(server): balayage périodique des parties inactives (bascule DB + nettoyage mémoire local)"
```

---

### Task 7: Filtrer la liste par statut côté serveur

**Files:**
- Modify: `packages/db/src/repos/reports.ts:49-69` (`listSessions` accepte `status`)
- Modify: `apps/server/src/routes/sessions.ts` (parser `?status=`)
- Test: `packages/db/src/repos/reports.test.ts`, `apps/server/src/routes-sessions.test.ts`

**Interfaces:**
- Consumes: la valeur d'enum `abandoned` (Task 1).
- Produces: `listSessions(scope, opts?: { limit?: number; status?: SessionSummary['status'][] })` — filtre en base sur `status` si fourni (sinon tous). La route accepte `?status=lobby,active` (valeurs invalides ignorées ; aucune valeur valide ⇒ pas de filtre).

- [ ] **Step 1: Écrire le test repo qui échoue**

Dans `packages/db/src/repos/reports.test.ts`, ajouter (le `beforeAll` crée déjà `sessionOld` en `ended` et `sessionRecent` ; s'appuyer dessus) :

```ts
it('listSessions filtre par statut quand `status` est fourni', async () => {
  const ended = await listSessions(tenantScope(ctx.db, tenantA), { status: ['ended', 'abandoned'] })
  expect(ended.every((s) => s.status === 'ended' || s.status === 'abandoned')).toBe(true)
  expect(ended.some((s) => s.id === sessionOld)).toBe(true)

  const live = await listSessions(tenantScope(ctx.db, tenantA), { status: ['lobby', 'active'] })
  expect(live.some((s) => s.id === sessionOld)).toBe(false)
})

it('listSessions sans `status` renvoie tous les statuts (rétro-compat)', async () => {
  const all = await listSessions(tenantScope(ctx.db, tenantA))
  expect(all.some((s) => s.id === sessionOld)).toBe(true)
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test -- reports`
Expected: FAIL (le filtre `status` est ignoré).

- [ ] **Step 3: Implémenter le filtre dans le repo**

Dans `packages/db/src/repos/reports.ts`, ajouter `inArray` à l'import drizzle (ligne 1) :

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
```

Remplacer la signature et le `where` de `listSessions` (lignes 49-68) :

```ts
export async function listSessions(
  scope: TenantScope,
  opts?: { limit?: number; status?: SessionSummary['status'][] },
): Promise<SessionSummary[]> {
  const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
  const conditions = [eq(schema.gameSession.tenantId, scope.tenantId)]
  if (opts?.status && opts.status.length > 0) {
    conditions.push(inArray(schema.gameSession.status, opts.status))
  }
  return scope.db
    .select({
      id: schema.gameSession.id,
      pin: schema.gameSession.pin,
      status: schema.gameSession.status,
      startedAt: schema.gameSession.startedAt,
      endedAt: schema.gameSession.endedAt,
      quizId: schema.gameSession.quizId,
      quizTitle: schema.quiz.title,
      playerCount: sql<number>`count(distinct ${schema.sessionPlayer.id})`.mapWith(Number),
    })
    .from(schema.gameSession)
    .innerJoin(schema.quiz, eq(schema.quiz.id, schema.gameSession.quizId))
    .leftJoin(schema.sessionPlayer, eq(schema.sessionPlayer.sessionId, schema.gameSession.id))
    .where(and(...conditions))
    .groupBy(schema.gameSession.id, schema.quiz.title)
    .orderBy(desc(schema.gameSession.createdAt))
    .limit(limit)
}
```

- [ ] **Step 4: Écrire le test de route qui échoue**

Dans `apps/server/src/routes-sessions.test.ts`, ajouter un cas vérifiant que `?status=` restreint le résultat (réutiliser le patron d'auth/seed du fichier ; créer au moins une session `ended` et une `lobby`) :

```ts
it('GET /api/sessions?status=ended ne renvoie que les parties terminées', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sessions?status=ended', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const rows = res.json() as { status: string }[]
  expect(rows.every((r) => r.status === 'ended')).toBe(true)
})
```

- [ ] **Step 5: Parser `?status=` dans la route**

Dans `apps/server/src/routes/sessions.ts`, ajouter un parseur (sous `parseLimit`) :

```ts
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
```

Mettre à jour le handler `GET /api/sessions` (lignes 50-56) :

```ts
  app.get('/api/sessions', { preHandler: requireUser }, async (request, reply) => {
    const scope = await resolveScopeOr403(request, reply, db, config)
    if (!scope) return
    const query = request.query as { limit?: unknown; status?: unknown } | undefined
    const limit = parseLimit(query?.limit)
    const status = parseStatuses(query?.status)
    return listSessions(scope, { limit, status })
  })
```

(Note : passer `{ limit: undefined, status: undefined }` est équivalent à `undefined` — le repo retombe sur ses défauts pour chaque champ absent.)

- [ ] **Step 6: Lancer les tests**

Run: `pnpm --filter @splootlabs/db test -- reports && pnpm --filter @splootlabs/server test -- routes-sessions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repos/reports.ts apps/server/src/routes/sessions.ts packages/db/src/repos/reports.test.ts apps/server/src/routes-sessions.test.ts
git commit -m "feat(server): filtrage des parties par statut sur GET /api/sessions"
```

---

### Task 8: Client API web — statut `abandoned` + filtre

**Files:**
- Modify: `apps/web/src/api/sessions.ts:13` (type) et `:62-65` (`listSessions`)
- Test: `apps/web/src/api/sessions.test.ts`

**Interfaces:**
- Produces: `SessionStatus` inclut `'abandoned'` ; `listSessions(opts?: { limit?: number; status?: SessionStatus[] }): Promise<SessionSummary[]>` — construit `?limit=`/`?status=a,b`.

- [ ] **Step 1: Mettre à jour les tests**

Dans `apps/web/src/api/sessions.test.ts`, remplacer l'appel `listSessions(10)` (test ligne ~34) par `listSessions({ limit: 10 })`, et ajouter :

```ts
it('listSessions({ status }) → GET /api/sessions?status=a,b', async () => {
  mockFetchOnce(200, [])
  await listSessions({ status: ['lobby', 'active'] })
  const url = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
  expect(String(url)).toContain('/api/sessions?')
  expect(decodeURIComponent(String(url))).toContain('status=lobby,active')
})
```

(Adapter l'accès au mock au style déjà utilisé dans le fichier pour lire l'URL appelée.)

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/web test -- api/sessions`
Expected: FAIL (`listSessions({ limit: 10 })` ne produit pas encore `?limit=10` ; pas de support `status`).

- [ ] **Step 3: Implémenter**

Dans `apps/web/src/api/sessions.ts`, remplacer la ligne 13 :

```ts
export type SessionStatus = 'lobby' | 'active' | 'ended' | 'abandoned'
```

Remplacer `listSessions` (lignes 58-65) :

```ts
/** `GET /api/sessions` — sessions du tenant, plus récentes d'abord. `limit` et `status` sont
 * omis de la query quand non fournis (le serveur applique ses propres défauts). */
export function listSessions(opts?: { limit?: number; status?: SessionStatus[] }): Promise<SessionSummary[]> {
  const params = new URLSearchParams()
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.status && opts.status.length > 0) params.set('status', opts.status.join(','))
  const qs = params.toString()
  return apiGet<SessionSummary[]>(`/api/sessions${qs ? `?${qs}` : ''}`)
}
```

- [ ] **Step 4: Lancer le test**

Run: `pnpm --filter @splootlabs/web test -- api/sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/sessions.ts apps/web/src/api/sessions.test.ts
git commit -m "feat(web): client listSessions par statut + statut abandoned"
```

---

### Task 9: Home — deux sections (En cours / Historique) + badge « Abandonnée »

**Files:**
- Modify: `apps/web/src/screens/Home.tsx` (sections, libellés, routage/CTA)
- Modify: `apps/web/src/prototype.css` (variante `.host-badge--abandoned`)

**Interfaces:**
- Consumes: `listSessions({ status })` (Task 8), `SessionStatus` incluant `'abandoned'`.

- [ ] **Step 1: Statut abandoned — libellé, routage, CTA**

Dans `apps/web/src/screens/Home.tsx` :

Étendre `STATUS_LABEL` (lignes 31-35) :

```ts
const STATUS_LABEL: Record<SessionStatus, string> = {
  lobby: 'En attente',
  active: 'En cours',
  ended: 'Terminée',
  abandoned: 'Abandonnée',
}
```

`abandoned` est terminal ⇒ il se comporte comme `ended` pour le routage et l'affordance. Remplacer `sessionHref` (lignes 44-46) et `sessionCtaLabel` (lignes 52-54) :

```ts
function sessionHref(s: SessionSummary): string {
  const terminal = s.status === 'ended' || s.status === 'abandoned'
  return terminal ? `/sessions/${s.id}` : `/host/${s.id}`
}
```

```ts
function sessionCtaLabel(s: SessionStatus): string {
  const terminal = s === 'ended' || s === 'abandoned'
  return terminal ? 'Voir le rapport →' : 'Reprendre →'
}
```

- [ ] **Step 2: Remplacer l'état « parties » par deux jeux (live / historique)**

Supprimer les chips et le filtre client : retirer `type SessionFilter`, `SESSION_FILTERS` (lignes 56-66), `sessionFilter`/`showAllSessions` et `filteredSessions`/`visibleSessions`/`hiddenSessionCount`/`selectSessionFilter` (lignes 171-186). Remplacer l'état + le chargement (lignes 168-204) par deux jeux indépendants :

```ts
  // --- Parties : En cours (lobby+active) et Historique (ended+abandoned) --------
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>([])
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)

  function loadSessions() {
    setSessionsLoading(true)
    setSessionsError(null)
    Promise.all([
      listSessions({ status: ['lobby', 'active'] }),
      listSessions({ status: ['ended', 'abandoned'] }),
    ])
      .then(([live, history]) => {
        setLiveSessions(live)
        setHistorySessions(history)
        setSessionsLoading(false)
      })
      .catch((err) => {
        setSessionsLoading(false)
        setSessionsError(errorMessage(err))
      })
  }

  useEffect(() => {
    loadSessions()
  }, [])

  const visibleHistory = showAllHistory ? historySessions : historySessions.slice(0, SESSIONS_PAGE_SIZE)
  const hiddenHistoryCount = historySessions.length - visibleHistory.length
```

- [ ] **Step 3: Remplacer le JSX de la section « Parties récentes »**

Remplacer toute la `<section aria-labelledby="home-sessions-heading">` (lignes 353-420) par deux sections. Factoriser le rendu d'une ligne en helper local pour ne pas dupliquer le markup :

```tsx
        {(() => {
          const renderRow = (s: SessionSummary) => (
            <li key={s.id}>
              <Link className="home-list__item" to={sessionHref(s)}>
                <span className="home-list__title">{s.quizTitle}</span>
                <span className="home-list__meta">
                  PIN {s.pin} · {formatDate(s.startedAt)} · {s.playerCount} joueur
                  {s.playerCount > 1 ? 's' : ''}
                </span>
                <span className={`host-badge host-badge--${s.status}`}>{STATUS_LABEL[s.status]}</span>
                <span className="home-list__cta" aria-hidden="true">{sessionCtaLabel(s.status)}</span>
              </Link>
            </li>
          )
          if (sessionsLoading) return <p role="status">Chargement des parties…</p>
          if (sessionsError && liveSessions.length === 0 && historySessions.length === 0) {
            return (
              <div className="ab-empty-state">
                <p role="alert">{sessionsError}</p>
                <Button variant="primary" type="button" onClick={loadSessions}>Réessayer</Button>
              </div>
            )
          }
          return (
            <>
              <section aria-labelledby="home-live-heading" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="home-section__header"><h2 id="home-live-heading">En cours</h2></div>
                {liveSessions.length === 0 ? (
                  <p className="ab-empty-state">Aucune partie en cours — lancez-en une depuis un quiz.</p>
                ) : (
                  <ul className="home-list">{liveSessions.map(renderRow)}</ul>
                )}
              </section>

              <section aria-labelledby="home-history-heading">
                <div className="home-section__header"><h2 id="home-history-heading">Historique</h2></div>
                {historySessions.length === 0 ? (
                  <p className="ab-empty-state">Aucune partie terminée pour l'instant.</p>
                ) : (
                  <>
                    <ul className="home-list">{visibleHistory.map(renderRow)}</ul>
                    {hiddenHistoryCount > 0 && (
                      <Button variant="ghost" type="button" onClick={() => setShowAllHistory(true)}>
                        Voir tout l'historique ({historySessions.length})
                      </Button>
                    )}
                  </>
                )}
              </section>
            </>
          )
        })()}
```

Remplacer l'ancienne unique `<section …home-sessions-heading…>` par un conteneur neutre englobant ce bloc, ex. `<section aria-label="Parties">{…}</section>`. Vérifier que les imports inutilisés (aucun désormais lié aux chips) sont retirés pour satisfaire le lint.

- [ ] **Step 4: Ajouter le style du badge abandoned**

Dans `apps/web/src/prototype.css`, étendre les règles de badges pour inclure `abandoned` (teinte proche de `ended`, plus sourde). Ajouter `--abandoned` aux sélecteurs groupés (lignes 464-476) puis, après le bloc `.host-badge--ended::before` (ligne 506), ajouter :

```css
.host-badge--abandoned {
  color: var(--ink-strong);
}

.host-badge--abandoned {
  background: color-mix(in srgb, var(--ink-dim) 10%, transparent);
  border-color: var(--ink-dim);
  border-style: dashed;
}

.host-badge--abandoned::before {
  content: '•';
  margin-right: 4px;
  line-height: 1;
  color: var(--ink-dim);
}
```

(Le trait `dashed` distingue visuellement « abandonnée » de « terminée » sans reposer sur la seule couleur — le mot « Abandonnée » reste le contenu textuel réel.)

- [ ] **Step 5: Vérifier build + lint + tests web**

Run: `pnpm --filter @splootlabs/web build && pnpm --filter @splootlabs/web test`
Expected: PASS (typecheck OK — plus de références aux symboles supprimés ; aucune régression des tests existants).

- [ ] **Step 6: Vérification manuelle**

Lancer la stack (Postgres `arena-pg` :5433, serveur :3000, web :5173 — vars inline, voir mémoire « Lancement stack dev »). Sur `/` : confirmer deux sections « En cours » et « Historique », le badge « Abandonnée » (trait pointillé) sur une partie basculée, et le CTA « Voir le rapport → » qui route vers `/sessions/:id`. Pour provoquer un abandon sans attendre 30 min : lancer avec `SESSION_INACTIVITY_TIMEOUT_MINUTES=1 SESSION_SWEEP_INTERVAL_MINUTES=1`, créer une partie, la laisser inactive ~1 min.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/Home.tsx apps/web/src/prototype.css
git commit -m "feat(web): Home en deux sections (En cours / Historique) + badge Abandonnée"
```

---

## Notes de fin

- **Ordre des tâches** : 1 → 9 dans l'ordre (Task 6 dépend de 3/4/5 ; Task 9 dépend de 7/8). Chaque tâche est livrable et testable indépendamment.
- **Hors scope (rappel du spec)** : rendre le moteur temps réel multi-instance (adaptateur Socket.IO partagé, propriété de session, advisory lock sur le balayage + à la migration). Épic séparé — le nettoyage mémoire de Task 6 suppose explicitement le mono-instance.
- **Vérification finale avant merge** : `pnpm -r test` (toute la monorepo verte) puis suivre `superpowers:finishing-a-development-branch`.
