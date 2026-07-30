# Slice 2 — RLS Postgres — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le RLS Postgres comme filet base d'isolation tenant (défense en profondeur), via 2 rôles (systemDb privilégié + appDb restreint auto-provisionné) et un GUC `app.tenant_id` posé par transaction, sans toucher aux repos ni casser le comportement existant.

**Architecture:** `systemDb` (rôle privilégié = `DATABASE_URL`, propriétaire, bypass RLS) sert migrations + ops cross-tenant (boot, sweep, résolution membership, store moteur, lookup PIN). `appDb` (rôle `app_role` `NOBYPASSRLS`, auto-provisionné) sert les opérations scopées via `withTenantTx(appDb, {tenantId}, fn)` = transaction + `SET LOCAL app.tenant_id`. Policies `USING`+`WITH CHECK` fail-loud sur les 5 tables de contenu.

**Tech Stack:** Drizzle 0.45 + postgres.js, Postgres 16, Fastify + Socket.IO, Vitest + testcontainers.

## Global Constraints

- **Langue** : code, commentaires, commits en français.
- **Tests** : `pnpm exec vitest run <pattern>` depuis la racine ; suite complète fiable `pnpm exec vitest run --fileParallelism=false`. **`pnpm -r build` AVANT `pnpm -r typecheck`** (dist inter-packages). Ne pas masquer l'exit code derrière `| tail`.
- **Repos inchangés** : le filtrage applicatif tenant + owner-scoping (Slices 0/1) reste ; RLS s'ajoute dessous.
- **Fail-loud** : policies en `current_setting('app.tenant_id')::uuid` strict.
- **`app_role`** : nom fixe, `NOSUPERUSER NOBYPASSRLS`. La migration garantit son existence + GRANTs (sans mot de passe) ; le mot de passe est posé hors migration (boot / harness de test).
- **Split systemDb/appDb** (voir §Répartition ci-dessous) : opérations de CONTENU scopées → `appDb`+GUC ; ops système/cross-tenant (migrations, boot rehydration, sweep, store moteur `engine_state`, lookup PIN, résolution membership) → `systemDb`.
- **Chaque tâche se termine verte** avant commit.

## Répartition systemDb / appDb (référence pour T3/T4)

| Opération | Voie | Handle |
|---|---|---|
| Migrations, provisioning | boot | systemDb |
| resolveTenantId / getMembershipRole / ensureMembership / ensureDefaultTenant / firstMembershipRole | pré-contexte | systemDb |
| Routes éditeur/rapports (quiz/question/session reads+writes) | HTTP | **appDb + withTenantTx** |
| host:create : listQuestions + createGameSession | socket | **appDb + withTenantTx** |
| player:join : addSessionPlayer | socket | **appDb + withTenantTx** |
| player:answer : recordAnswer ; scoring : setPlayerScore/setSessionStatus | socket | **appDb + withTenantTx** |
| host:reconnect : getGameSessionById (check host_id) | socket | **appDb + withTenantTx** (tenant connu via meta) |
| PersistentSessionStore (saveEngineState/loadEngineState/clearEngineState/loadEngineStateByPin) | moteur | systemDb (composant système, clé id/pin sans tenant) |
| Boot rehydration (abandonStaleSessions, listResumableSessions, listSessionPlayers) | boot | systemDb |
| Sweep (abandonInactiveSessions) | timer | systemDb |

> **Décision documentée** : le store moteur `engine_state`, le lookup PIN et le boot/sweep sont des composants **système** (clé = id/pin de session, pas de contexte tenant disponible sans refonte de l'interface moteur↔store). Ils tournent sur `systemDb`. Le RLS enforce les opérations de **contenu** (quiz/question/session_player/answer_record écrits en réponse à une action utilisateur). Resserrer le store sous RLS (threader le tenant dans l'interface `SessionStore`) est un durcissement futur possible, hors scope ici.

## Structure des fichiers

- `packages/shared/src/config.ts` — `APP_DATABASE_URL`, `APP_DB_PASSWORD`.
- `packages/db/src/client.ts` — `createAppDb`, `deriveAppUrl`.
- `packages/db/src/role-provisioning.ts` — **créé** : `ensureAppRole`, `setAppRolePassword`.
- `packages/db/src/tenant.ts` — `withTenantTx` ; `scopeForUser`/`getMembershipRole`/… restent (utilisés avec systemDb).
- `packages/db/src/index.ts` — exports.
- `packages/db/drizzle/00NN_*.sql` — migration RLS (généré `--custom` puis écrit à la main).
- `packages/db/src/test-helpers.ts` — deux handles (systemDb + appDb).
- `apps/server/src/require-user.ts` — `resolveTenantContext` (résout via systemDb, renvoie `{tenantId, ownerId}`), plus helper de wrap.
- `apps/server/src/routes/{quizzes,questions,sessions}.ts` — handlers enveloppés dans `withTenantTx(appDb)`.
- `apps/server/src/editor.ts` — deps `{ systemDb, appDb, auth, config }`.
- `apps/server/src/game-gateway.ts` — split systemDb/appDb.
- `apps/server/src/index.ts` — bootstrap 2 handles + provisioning.

---

## Task 1 : Infra connexion (additive, rien de câblé)

**Files:**
- Modify: `packages/shared/src/config.ts`
- Modify: `packages/db/src/client.ts`
- Create: `packages/db/src/role-provisioning.ts`
- Modify: `packages/db/src/tenant.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/rls-infra.test.ts` (créé)

**Interfaces produites:**
- `createAppDb(url): { db: Db; client: Sql }`
- `deriveAppUrl(databaseUrl: string, opts: { user: string; password: string }): string`
- `ensureAppRole(systemClient: Sql, role: string): Promise<void>` (crée le rôle `NOSUPERUSER NOBYPASSRLS LOGIN` si absent, idempotent)
- `setAppRolePassword(systemClient: Sql, role: string, password: string): Promise<void>` (`ALTER ROLE … PASSWORD`)
- `withTenantTx<T>(appDb: Db, ctx: { tenantId: string; ownerId?: string }, fn: (scope: TenantScope) => Promise<T>): Promise<T>`
- config : `appDatabaseUrl?: string`, `appDbPassword: string`

- [ ] **Step 1 : Test qui échoue** — créer `packages/db/src/rls-infra.test.ts`

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import { withTenantTx, deriveAppUrl } from './index.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('RLS infra', () => {
  it('deriveAppUrl substitue user/password en gardant host/port/db', () => {
    const out = deriveAppUrl('postgres://owner:pw@db.host:5433/kahoot', { user: 'app_role', password: 's3cret' })
    expect(out).toBe('postgres://app_role:s3cret@db.host:5433/kahoot')
  })

  it('withTenantTx pose app.tenant_id (SET LOCAL) dans la transaction', async () => {
    const seen = await withTenantTx(ctx.db, { tenantId: '11111111-1111-1111-1111-111111111111' }, async (scope) => {
      const [row] = await scope.db.execute(sql`select current_setting('app.tenant_id', true) as t`)
      return (row as { t: string }).t
    })
    expect(seen).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('withTenantTx : le GUC ne fuit pas hors de la transaction', async () => {
    await withTenantTx(ctx.db, { tenantId: '22222222-2222-2222-2222-222222222222' }, async () => {})
    const [row] = await ctx.db.execute(sql`select current_setting('app.tenant_id', true) as t`)
    expect((row as { t: string | null }).t).toBeFalsy() // null/'' hors transaction
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run rls-infra` → FAIL (exports absents).

- [ ] **Step 3 : `deriveAppUrl` + `createAppDb`** dans `packages/db/src/client.ts`

```ts
/** Dérive une chaîne de connexion pour un autre rôle (même host/port/db). */
export function deriveAppUrl(databaseUrl: string, opts: { user: string; password: string }): string {
  const u = new URL(databaseUrl)
  u.username = opts.user
  u.password = opts.password
  return u.toString()
}

/** Handle du rôle applicatif restreint (soumis au RLS). Identique à createDb ; nom explicite. */
export function createAppDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}
```

- [ ] **Step 4 : `role-provisioning.ts`**

```ts
import type { Sql } from 'postgres'

/** Crée le rôle applicatif restreint s'il n'existe pas (idempotent). NOSUPERUSER NOBYPASSRLS
 * = soumis au RLS. LOGIN pour que `appDb` puisse s'y connecter. Sans mot de passe ici
 * (posé par setAppRolePassword / la migration pose les GRANTs). */
export async function ensureAppRole(systemClient: Sql, role: string): Promise<void> {
  await systemClient.unsafe(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS', '${role}');
       END IF;
     END $$;`,
  )
}

export async function setAppRolePassword(systemClient: Sql, role: string, password: string): Promise<void> {
  await systemClient.unsafe(`ALTER ROLE ${'"' + role + '"'} PASSWORD ${systemClient.escapeLiteral ? systemClient.escapeLiteral(password) : `'${password.replace(/'/g, "''")}'`}`)
}
```
> Note sécurité : `role` est une constante interne (`'app_role'`), jamais une entrée utilisateur — l'interpolation est sûre. Le mot de passe est échappé (doublage des quotes).

- [ ] **Step 5 : `withTenantTx`** dans `packages/db/src/tenant.ts` (ajouter `import { sql } from 'drizzle-orm'` — déjà `and, eq` présents ; ajouter `sql`)

```ts
/**
 * Exécute `fn` dans une transaction sur `appDb` avec `app.tenant_id` posé en SET LOCAL
 * (scopé à la transaction → aucune fuite de GUC entre requêtes du pool). Le scope fourni
 * porte la transaction comme `db` : les repos restent inchangés.
 */
export async function withTenantTx<T>(
  appDb: Db,
  ctx: { tenantId: string; ownerId?: string },
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`)
    return fn({ db: tx as unknown as Db, tenantId: ctx.tenantId, ownerId: ctx.ownerId })
  })
}
```

- [ ] **Step 6 : config** — dans `EnvSchema` ajouter `APP_DATABASE_URL: z.string().min(1).optional()` et `APP_DB_PASSWORD: z.string().min(1).default('app-dev-password-change-me')` ; dans `AppConfig` ajouter `appDatabaseUrl?: string`, `appDbPassword: string` ; les mapper dans `loadConfig`.

- [ ] **Step 7 : exports** — `packages/db/src/index.ts` : ajouter `createAppDb, deriveAppUrl` (from client), `withTenantTx` (from tenant), et `export { ensureAppRole, setAppRolePassword } from './role-provisioning.js'`.

- [ ] **Step 8 : Vérifier** — `pnpm exec vitest run rls-infra` → PASS. Puis `pnpm --filter @splootlabs/shared --filter @splootlabs/db build`.

- [ ] **Step 9 : Commit**
```bash
git add packages/shared/src/config.ts packages/db/src/client.ts packages/db/src/role-provisioning.ts packages/db/src/tenant.ts packages/db/src/index.ts packages/db/src/rls-infra.test.ts
git commit -m "feat(db): infra connexion RLS (createAppDb, withTenantTx, provisioning app_role)"
```

---

## Task 2 : Migration RLS + policies + harness deux handles

**Files:**
- Create: `packages/db/drizzle/00NN_rls.sql` (+ snapshot via generate `--custom`)
- Modify: `packages/db/src/test-helpers.ts`
- Test: `packages/db/src/rls.test.ts` (créé)

**Interfaces produites:**
- `startTestDb()` renvoie en plus `appDb: Db`, `appClient: Sql` (connecté comme `app_role`).

- [ ] **Step 1 : Générer une migration custom vide**

Run: `pnpm --filter @splootlabs/db exec drizzle-kit generate --custom --name rls`
→ crée `packages/db/drizzle/00NN_rls.sql` (vide) + entrée snapshot. Écrire dedans :

```sql
-- Rôle applicatif : garantir l'existence (le mot de passe est posé hors migration).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_role;--> statement-breakpoint

-- Tables globales (Better Auth) : app_role a besoin d'y accéder (sessions), PAS de RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "account", "verification" TO app_role;--> statement-breakpoint
-- Tables tenant/membership : accès app_role (lecture), résolution via systemDb (pas de RLS ici, Slice 3).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant", "membership" TO app_role;--> statement-breakpoint

-- Tables de contenu : GRANT + RLS + policy USING/WITH CHECK fail-loud.
GRANT SELECT, INSERT, UPDATE, DELETE ON "quiz", "question", "game_session", "session_player", "answer_record" TO app_role;--> statement-breakpoint

ALTER TABLE "quiz" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quiz_tenant_isolation" ON "quiz" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "question_tenant_isolation" ON "question" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "game_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "game_session_tenant_isolation" ON "game_session" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "session_player" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "session_player_tenant_isolation" ON "session_player" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER TABLE "answer_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "answer_record_tenant_isolation" ON "answer_record" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```
> Le GRANT sur les tables globales/tenant permet à `app_role` de servir Better Auth (sessions) et de laisser passer la résolution éventuelle. `game_session.engine_state` (store moteur) est écrit par systemDb → OK. Le propriétaire (systemDb) n'a pas `FORCE RLS` → bypass voulu.

- [ ] **Step 2 : test-helpers deux handles**

Modifier `startTestDb` : après avoir créé `systemDb` et **avant** de renvoyer, provisionner l'app role + mot de passe et créer `appDb`. IMPORTANT : les migrations (qui créent le rôle + GRANTs) doivent tourner d'abord — mais `startTestDb` ne lance pas les migrations (les tests le font). Donc : exposer aussi un helper, ou provisionner le rôle dans `startTestDb` puis laisser le test lancer les migrations (le `CREATE ROLE` de la migration est idempotent). Approche retenue : `startTestDb` crée le rôle + password AVANT migrations (via `ensureAppRole`/`setAppRolePassword` sur le client système), construit `appDb` avec `deriveAppUrl`. Les GRANTs viendront quand le test appellera `runMigrations`.

```ts
// dans startTestDb, après createDb(url) :
const APP_ROLE = 'app_role'
const APP_PW = 'test-app-pw'
await ensureAppRole(client, APP_ROLE)
await setAppRolePassword(client, APP_ROLE, APP_PW)
const appUrl = deriveAppUrl(url, { user: APP_ROLE, password: APP_PW })
const { db: appDb, client: appClient } = createAppDb(appUrl)
// renvoyer db, client, appDb, appClient, url, container, stop (stop ferme aussi appClient)
```
(Ajouter `ensureAppRole, setAppRolePassword, createAppDb, deriveAppUrl` aux imports de test-helpers ; fermer `appClient` dans `stop()`.)

- [ ] **Step 3 : Tests RLS** — `packages/db/src/rls.test.ts`

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb, runMigrations, schema, tenantScope, withTenantTx, createQuiz } from './index.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string, tenantB: string, ownerA: string, ownerB: string
beforeAll(async () => {
  ctx = await startTestDb(); await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'B' }).returning()
  const [uA] = await ctx.db.insert(schema.user).values({ id: crypto.randomUUID(), email: 'a@x.fr', name: 'A', emailVerified: false }).returning()
  const [uB] = await ctx.db.insert(schema.user).values({ id: crypto.randomUUID(), email: 'b@x.fr', name: 'B', emailVerified: false }).returning()
  tenantA = tA.id; tenantB = tB.id; ownerA = uA.id; ownerB = uB.id
  // systemDb (bypass) crée du contenu dans A et B.
  await createQuiz(tenantScope(ctx.db, tenantA), { ownerId: ownerA, title: 'Quiz A' })
  await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B' })
}, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('RLS Postgres', () => {
  it('appDb SANS contexte tenant → erreur (fail-loud)', async () => {
    await expect(ctx.appDb.select().from(schema.quiz)).rejects.toThrow()
  })
  it('appDb dans le contexte A ne voit que les quiz de A', async () => {
    const rows = await withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) => s.db.select().from(schema.quiz))
    expect(rows.length).toBeGreaterationalthan?0:0 // placeholder remplacé ci-dessous
    expect(rows.every((q) => q.tenantId === tenantA)).toBe(true)
    expect(rows.some((q) => q.title === 'Quiz B')).toBe(false)
  })
  it('appDb : INSERT avec un tenant_id ≠ contexte est rejeté (WITH CHECK)', async () => {
    await expect(
      withTenantTx(ctx.appDb, { tenantId: tenantA }, (s) =>
        s.db.insert(schema.quiz).values({ tenantId: tenantB, ownerId: ownerA, title: 'X' }).returning()),
    ).rejects.toThrow()
  })
  it('systemDb voit tous les tenants (bypass)', async () => {
    const rows = await ctx.db.select().from(schema.quiz)
    expect(rows.some((q) => q.tenantId === tenantA)).toBe(true)
    expect(rows.some((q) => q.tenantId === tenantB)).toBe(true)
  })
})
```
> Corriger la ligne placeholder en `expect(rows.length).toBeGreaterThan(0)`.

- [ ] **Step 4 : Vérifier** — `pnpm exec vitest run rls.test rls-infra` → PASS. Puis relancer une suite repo existante (`pnpm exec vitest run quiz.test`) pour confirmer que le RLS (systemDb bypass) ne casse rien.

- [ ] **Step 5 : Commit**
```bash
git add packages/db/drizzle/ packages/db/src/test-helpers.ts packages/db/src/rls.test.ts
git commit -m "feat(db): migration RLS (policies fail-loud) + harness de test deux handles"
```

---

## Task 3 : Câblage HTTP (routes sur appDb + withTenantTx)

**Files:**
- Modify: `apps/server/src/require-user.ts`, `apps/server/src/editor.ts`
- Modify: `apps/server/src/routes/{quizzes,questions,sessions}.ts`
- Modify (harness): `apps/server/src/routes-quizzes.test.ts`, `routes-questions.test.ts`, `routes-sessions.test.ts`, `editor-e2e.test.ts`, `reports-e2e.test.ts`, `auth-e2e.test.ts` (buildApp → passer `{ systemDb, appDb }`)

**Interfaces produites:**
- `resolveTenantContext(request, systemDb, config): Promise<{ tenantId: string; ownerId?: string }>` (résout via systemDb : tenant + rôle → ownerId ; lève `TenantAccessDeniedError` si pas de membership).
- `resolveContextOr403(request, reply, systemDb, config): Promise<Context | null>`.
- deps routes : `{ systemDb: Db; appDb: Db; config: AppConfig }`.

- [ ] **Step 1 : Test qui échoue** — dans `routes-quizzes.test.ts`, adapter `buildApp` pour fournir `{ systemDb: ctx.db, appDb: ctx.appDb }` à `registerEditor`, et **ajouter** un test prouvant que le RLS est actif sur la voie HTTP :

```ts
it('RLS actif sur la voie HTTP : un quiz créé est bien lu (contexte tenant posé)', async () => {
  const app = await buildApp()
  const cookie = await signUp(app, 'rls-http@example.com')
  const create = await app.inject({ method: 'POST', url: '/api/quizzes', payload: { title: 'RLS quiz' }, headers: { 'content-type': 'application/json', cookie } })
  expect(create.statusCode).toBe(201)
  const list = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie } })
  expect((list.json() as { title: string }[]).some((q) => q.title === 'RLS quiz')).toBe(true)
  await app.close()
})
```
Ce test échoue tant que `registerEditor`/routes n'acceptent pas `appDb` (ou que les handlers ne posent pas le GUC → fail-loud sur le SELECT de la route sous app_role).

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run routes-quizzes` → FAIL (signature deps / GUC absent).

- [ ] **Step 3 : `require-user.ts` — résolution via systemDb + contexte**

Remplacer `requestScope`/`resolveScopeOr403` par une résolution de **contexte** (plus de `db` dans le retour) :

```ts
export type TenantContext = { tenantId: string; ownerId?: string }

export async function resolveTenantContext(request: FastifyRequest, systemDb: Db, config: AppConfig): Promise<TenantContext> {
  if (!request.user?.id) throw new Error('resolveTenantContext requires requireUser preHandler')
  const explicitTenantId = typeof request.headers['x-tenant-id'] === 'string' ? (request.headers['x-tenant-id'] as string) : undefined
  const tenantId = await resolveTenantId(systemDb, config, { userId: request.user.id, explicitTenantId })
  const role = (await getMembershipRole(systemDb, tenantId ? request.user.id : request.user.id, tenantId)) ?? 'member'
  const ownerId = hasPermission(role, 'content:access-all') ? undefined : request.user.id
  return { tenantId, ownerId }
}

export async function resolveContextOr403(request, reply, systemDb, config): Promise<TenantContext | null> {
  try { return await resolveTenantContext(request, systemDb, config) }
  catch (e) { if (e instanceof TenantAccessDeniedError) { reply.code(403).send({ error: 'Accès refusé à ce tenant.' }); return null } throw e }
}
```
(Importer `getMembershipRole` de `@splootlabs/db` et `hasPermission` de `@splootlabs/shared`. `scopeForUser` n'est plus utilisé côté serveur — le laisser dans db pour les tests/rétro-compat, ou le retirer si plus référencé.)

- [ ] **Step 4 : Handlers — envelopper dans `withTenantTx(appDb)`**

Patron (appliqué à CHAQUE handler des 3 fichiers de routes) — exemple `POST /api/quizzes` :

```ts
app.post('/api/quizzes', { preHandler: requireUser }, async (request, reply) => {
  const context = await resolveContextOr403(request, reply, systemDb, config)
  if (!context) return
  const body = request.body as { title?: unknown; description?: unknown } | undefined
  if (!isNonEmptyString(body?.title)) return reply.code(400).send({ error: 'Le titre est requis.' })
  const description = isNonEmptyString(body?.description) ? body.description : undefined
  return withTenantTx(appDb, context, async (scope) => {
    const quiz = await createQuiz(scope, { ownerId: request.user.id, title: body.title as string, description })
    return reply.code(201).send(quiz)
  })
})
```
Règles d'application :
- Résolution `resolveContextOr403` + validation d'entrée **hors** `withTenantTx` (400/403 avant d'ouvrir la transaction).
- Tout appel repo (`createQuiz`, `getQuiz`, `listQuizzes`, `updateQuiz`, `deleteQuiz`, `createQuestion`, `listQuestions`, `getQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions`, `listSessions`, `getSessionReport`) passe `scope` fourni par `withTenantTx`.
- `reply.code().send()` peut se faire dans le callback (retourné) ; renvoyer la valeur de `withTenantTx`.
- `deps` devient `{ systemDb, appDb, config }` dans les 3 `register*Routes` ; `editor.ts` passe `{ systemDb, appDb, auth, config }`.

Fichiers/handlers à convertir : `quizzes.ts` (POST, GET liste, GET :id, PATCH, DELETE), `questions.ts` (POST, GET, PATCH, DELETE, PUT order), `sessions.ts` (GET liste, GET :id, GET csv).

- [ ] **Step 5 : Harnais de test HTTP** — dans chaque `buildApp` des fichiers listés, remplacer `registerEditor(app, { db: ctx.db, auth, config })` par `registerEditor(app, { systemDb: ctx.db, appDb: ctx.appDb, auth, config })`. (Better Auth garde `ctx.db` = systemDb.)

- [ ] **Step 6 : Vérifier** — `pnpm exec vitest run routes-quizzes routes-questions routes-sessions editor-e2e reports-e2e auth-e2e` → PASS. Corriger tout fail-loud (= un handler oublié sans `withTenantTx`).

- [ ] **Step 7 : Commit**
```bash
git add apps/server/src/require-user.ts apps/server/src/editor.ts apps/server/src/routes/ apps/server/src/*.test.ts
git commit -m "feat(server): routes HTTP sous RLS (résolution systemDb + withTenantTx appDb)"
```

---

## Task 4 : Câblage temps réel (game-gateway)

**Files:**
- Modify: `apps/server/src/game-gateway.ts`
- Modify (harness): `apps/server/src/game-gateway.test.ts`, `game-e2e.test.ts`, `sweep-e2e.test.ts`, `persistent-store.test.ts` (buildApp/deps → `{ systemDb, appDb }`)

- [ ] **Step 1 : Adapter la signature des deps** — `GameGatewayDeps` : remplacer `db: Db` par `systemDb: Db; appDb: Db`. Le `store` (PersistentSessionStore) reste construit avec **systemDb** (voir Répartition). Better Auth : systemDb.

- [ ] **Step 2 : Router chaque opération** (voir tableau Répartition) :
- `host:create` : `resolveTenantId(systemDb, …)` puis contexte role-aware (systemDb) ; `listQuestions` + `createGameSession` dans `withTenantTx(appDb, { tenantId, ownerId }, scope => …)`.
- `player:join` : `addSessionPlayer` dans `withTenantTx(appDb, { tenantId: meta.tenantId }, …)`.
- `player:answer`/persistRound : `recordAnswer` dans `withTenantTx(appDb, { tenantId: meta.tenantId }, …)`.
- scoring : `setPlayerScore`, `setSessionStatus` dans `withTenantTx(appDb, { tenantId: meta.tenantId }, …)`.
- `host:reconnect` : `getGameSessionById` dans `withTenantTx(appDb, { tenantId: meta.tenantId }, …)` (meta connu) — sinon (meta absent, cas limite) systemDb.
- Boot rehydration (`abandonStaleSessions`, `listResumableSessions`, `listSessionPlayers`) et sweep (`abandonInactiveSessions`) : **systemDb** (inchangé, juste renommer `db` → `systemDb`).
- Store (déjà systemDb) : inchangé.

> Le `tenantId` par session est déjà dans `sessionMetaByEngineId` (`meta.tenantId`) et dans l'objet session moteur. Là où seul l'id de session est connu sans meta, récupérer le tenant depuis le store/session avant le `withTenantTx`.

- [ ] **Step 3 : Harnais** — `game-gateway.test.ts` etc. : `registerGameGateway(io, { engine, systemDb: ctx.db, appDb: ctx.appDb, auth, config, store })` ; `store = new PersistentSessionStore(ctx.db)` (systemDb). Les seeds directs de contenu dans les tests continuent via `ctx.db` (systemDb, bypass).

- [ ] **Step 4 : Vérifier** — `pnpm exec vitest run game-gateway game-e2e sweep-e2e persistent-store` → PASS (relancer game-gateway seul si flaky). Corriger tout fail-loud.

- [ ] **Step 5 : Commit**
```bash
git add apps/server/src/game-gateway.ts apps/server/src/*.test.ts
git commit -m "feat(server): temps réel sous RLS (ops scopées appDb, système/store/boot sur systemDb)"
```

---

## Task 5 : Bootstrap serveur + vérification globale + merge

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1 : Bootstrap deux handles**

```ts
const { db: systemDb, client: systemClient } = createDb(config.databaseUrl)
await ensureAppRole(systemClient, 'app_role')
await setAppRolePassword(systemClient, 'app_role', config.appDbPassword)
if (config.migrateOnBoot) await runMigrations(systemDb)   // crée rôle (idempotent) + GRANTs + RLS
if (config.tenancyMode === 'single') await ensureDefaultTenant(systemDb)
const appUrl = config.appDatabaseUrl ?? deriveAppUrl(config.databaseUrl, { user: 'app_role', password: config.appDbPassword })
const { db: appDb, client: appClient } = createAppDb(appUrl)
```
- `registerEditor(app, { systemDb, appDb, auth, config })`.
- `store = new PersistentSessionStore(systemDb)`.
- `registerGameGateway(io, { engine, systemDb, appDb, auth, config, store })`.
- boot/sweep déjà sur systemDb (via gateway).
- `onClose` : fermer `appClient` **et** `systemClient`.
- `pingDb` : garder sur `systemClient`.

- [ ] **Step 2 : Typecheck monorepo** — `pnpm -r build && pnpm -r typecheck` → PASS.

- [ ] **Step 3 : Suite complète** — `pnpm exec vitest run --fileParallelism=false` → tout vert (sans troncature ; grep FAIL). Corriger tout fail-loud résiduel.

- [ ] **Step 4 : Vérif base dev (optionnel mais recommandé)** — démarrer le serveur sur `arena-pg`, vérifier : `app_role` créé (`\du`), RLS actif (`SELECT relrowsecurity FROM pg_class WHERE relname='quiz'` → t), et une requête app scopée fonctionne. Puis Ctrl-C.

- [ ] **Step 5 : Merge** — via superpowers:finishing-a-development-branch (option merge local vers master ; résoudre les conflits éventuels avec le travail concurrent sur `client.ts`/`index.ts`).

---

## Self-Review (auteur du plan)

**Couverture du spec :** 2 rôles auto-provisionnés 1 URL (T1/T5) ; RLS USING+WITH CHECK fail-loud sur 5 tables (T2) ; GUC via withTenantTx transaction+SET LOCAL (T1) ; voies HTTP (T3) + temps réel (T4) scopées ; systemDb pour migrations/boot/sweep/store/PIN/membership (T4/T5, tableau Répartition) ; repos inchangés ; tests deux handles + fail-loud + isolation + WITH CHECK + systemDb bypass (T2).

**Écart documenté vs spec :** le spec disait « temps réel → appDb+withTenantTx » de façon globale ; le plan précise que le **store moteur `engine_state` + lookup PIN + boot/sweep** restent sur systemDb (composants système, clé id/pin sans tenant), et que ce sont les **opérations de contenu** (host:create quiz read/create, join, answer, scoring) qui passent sous RLS. Resserrer le store est un durcissement futur.

**Placeholders :** un placeholder volontairement marqué dans le test RLS (Step T2.3, `toBeGreaterThan`) à corriger en écrivant — signalé inline.

**Cohérence types/noms :** `withTenantTx(appDb, ctx, fn)`, `resolveTenantContext(req, systemDb, config)`, deps `{ systemDb, appDb, config }` cohérents T3/T4/T5 ; `app_role` littéral partout ; `deriveAppUrl` signature stable.
