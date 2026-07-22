# Data + Multi-tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bâtir la couche Data du produit : un package `@splootlabs/db` (Drizzle sur Postgres) avec le schéma complet, les migrations, un guard de scoping tenant à isolation prouvée, et le câblage self-host (`docker compose` avec un service Postgres + migrations auto).

**Architecture:** Un package `@splootlabs/db` isolé expose un client Drizzle Postgres créé depuis `AppConfig.databaseUrl`, le schéma (9 tables + enums), un runner de migrations, et un helper `tenantScope` que toute requête tenant-scoped traverse. Postgres PARTOUT (décision 2026-07-22) : self-host = conteneur Postgres dans `docker compose`, cloud = Postgres managé. Les tests d'intégration tournent contre un Postgres jetable via testcontainers.

**Tech Stack:** TypeScript, Drizzle ORM (`drizzle-orm/postgres-js`), `postgres` (postgres.js), `drizzle-kit` (migrations), `@testcontainers/postgresql` (tests), Vitest.

## Global Constraints

- **Postgres partout** : un seul dialecte (`drizzle-orm/pg-core`). Pas de SQLite, pas de dual-dialecte.
- **`tenant_id` au niveau ligne** sur toutes les tables tenant-scoped (`tenant` lui-même exclu). Un guard `tenantScope` filtre toutes les requêtes tenant-scoped ; **aucune fuite inter-tenant** (prouvé par test).
- **`user` = identité globale** (pas de `tenant_id`) ; la table `membership` relie `user`↔`tenant`. (Raffinement du spec §7 qui doublonnait.)
- **ESM / NodeNext** : imports relatifs avec extension `.js`. TypeScript strict.
- **Node ≥ 20**, pnpm workspaces, scope `@splootlabs/*`, Vitest.
- **Les tests d'intégration exigent un démon Docker** (testcontainers lance `postgres:16-alpine`).
- Consomme `AppConfig` de `@splootlabs/shared` : `databaseUrl`, `tenancyMode`.
- Image Postgres épinglée : **`postgres:16-alpine`** (tests ET compose).

---

## File Structure

```
packages/db/
├─ package.json
├─ tsconfig.json
├─ drizzle.config.ts            # config drizzle-kit (dialect pg, schema, out)
├─ drizzle/                     # migrations SQL générées (committées)
└─ src/
   ├─ index.ts                  # exports publics
   ├─ schema.ts                 # enums + 9 tables (pg-core)
   ├─ client.ts                 # createDb(databaseUrl) -> { db, client }
   ├─ migrate.ts                # runMigrations(db)
   ├─ tenant.ts                 # tenantScope(db, tenantId) + ensureDefaultTenant + resolveTenantId
   ├─ repos/quiz.ts             # repo quiz scoped (pattern de référence)
   ├─ test-helpers.ts           # startTestDb() via testcontainers
   ├─ client.test.ts
   ├─ schema.test.ts
   ├─ migrate.test.ts
   ├─ tenant.test.ts
   └─ repos/quiz.test.ts
apps/server/                    # Task 6 : câblage
docker-compose.yml              # Task 6 : + service db
```

---

### Task 1: Package `@splootlabs/db` + client Postgres + smoke test testcontainers

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/client.ts`, `packages/db/src/test-helpers.ts`, `packages/db/src/index.ts`, `packages/db/src/client.test.ts`

**Interfaces:**
- Consumes: rien (nouveau package).
- Produces:
  - `createDb(databaseUrl: string): { db: PostgresJsDatabase<typeof schema>; client: Sql }`
  - `startTestDb(): Promise<{ db; client; url: string; stop(): Promise<void> }>` (helper de test)

- [ ] **Step 1: Écrire le smoke test qui échoue**

`packages/db/src/client.test.ts`
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('createDb', () => {
  it('se connecte à Postgres et exécute une requête', async () => {
    const rows = await ctx.db.execute(sql`select 1 as one`)
    expect(rows[0]).toMatchObject({ one: 1 })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test`
Expected: FAIL — modules `./test-helpers` / `./client` introuvables.

- [ ] **Step 3: Créer le package et implémenter le client + le helper de test**

`packages/db/package.json`
```json
{
  "name": "@splootlabs/db",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@splootlabs/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "@testcontainers/postgresql": "^10.13.0"
  }
}
```

`packages/db/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "module": "NodeNext", "moduleResolution": "NodeNext" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/db/src/client.ts`
```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(databaseUrl: string): { db: Db; client: Sql } {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, { schema })
  return { db, client }
}
```

`packages/db/src/test-helpers.ts`
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createDb, type Db } from './client.js'
import type { Sql } from 'postgres'

export async function startTestDb(): Promise<{
  db: Db
  client: Sql
  url: string
  container: StartedPostgreSqlContainer
  stop: () => Promise<void>
}> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  const { db, client } = createDb(url)
  return {
    db,
    client,
    url,
    container,
    async stop() {
      await client.end({ timeout: 5 })
      await container.stop()
    },
  }
}
```

`packages/db/src/index.ts`
```ts
export { createDb, type Db } from './client.js'
```

Note : `client.test.ts` importe `./test-helpers.js` qui importe `./schema.js` — créer un `schema.ts` minimal provisoire pour que l'import résolve :

`packages/db/src/schema.ts` (provisoire, complété en Task 2)
```ts
// Schéma complété en Task 2.
export {}
```

- [ ] **Step 4: Installer et vérifier que le smoke test passe**

Run: `pnpm install && pnpm --filter @splootlabs/db test`
Expected: PASS — le conteneur Postgres démarre, `select 1` renvoie `{ one: 1 }`. (Premier run : téléchargement de l'image `postgres:16-alpine`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): package @splootlabs/db + client Postgres + smoke test testcontainers"
```

---

### Task 2: Schéma complet (enums + 9 tables) + config drizzle-kit + migration initiale

**Files:**
- Modify: `packages/db/src/schema.ts` (remplace le provisoire)
- Create: `packages/db/drizzle.config.ts`, `packages/db/src/schema.test.ts`
- Modify: `packages/db/src/index.ts` (exporte le schéma)
- Generated: `packages/db/drizzle/0000_*.sql` (via drizzle-kit)

**Interfaces:**
- Consumes: `startTestDb` (Task 1).
- Produces: le schéma exporté (`tenant`, `user`, `oauthAccount`, `membership`, `quiz`, `question`, `gameSession`, `sessionPlayer`, `answerRecord`) + enums (`planEnum`, `roleEnum`, `questionTypeEnum`, `sessionStatusEnum`).

- [ ] **Step 1: Écrire le schéma**

`packages/db/src/schema.ts`
```ts
import { sql } from 'drizzle-orm'
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core'

export const planEnum = pgEnum('plan', ['free', 'pro'])
export const roleEnum = pgEnum('role', ['owner', 'admin', 'member'])
export const questionTypeEnum = pgEnum('question_type', ['mcq', 'truefalse', 'text', 'slider'])
export const sessionStatusEnum = pgEnum('session_status', ['lobby', 'active', 'ended'])

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  plan: planEnum('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const user = pgTable('user', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'), // null pour un compte OAuth-only
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const oauthAccount = pgTable('oauth_account', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerUnique: uniqueIndex('oauth_provider_account_uidx').on(t.provider, t.providerAccountId),
}))

export const membership = pgTable('membership', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userTenantUnique: uniqueIndex('membership_user_tenant_uidx').on(t.userId, t.tenantId),
}))

export const quiz = pgTable('quiz', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  description: text('description'),
  cover: text('cover'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('quiz_tenant_idx').on(t.tenantId),
}))

export const question = pgTable('question', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  media: text('media'),
  timeLimit: integer('time_limit').notNull().default(20),
  orderIndex: integer('order_index').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quizOrderIdx: index('question_quiz_order_idx').on(t.quizId, t.orderIndex),
}))

export const gameSession = pgTable('game_session', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id),
  hostId: uuid('host_id').notNull().references(() => user.id),
  pin: text('pin').notNull(),
  status: sessionStatusEnum('status').notNull().default('lobby'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // PIN unique PARMI les sessions actives (index partiel Postgres)
  activePinUnique: uniqueIndex('game_session_active_pin_uidx').on(t.pin).where(sql`${t.status} <> 'ended'`),
  tenantIdx: index('game_session_tenant_idx').on(t.tenantId),
}))

export const sessionPlayer = pgTable('session_player', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  nickname: text('nickname').notNull(),
  joinToken: text('join_token').notNull(),
  totalScore: integer('total_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('session_player_session_idx').on(t.sessionId),
}))

export const answerRecord = pgTable('answer_record', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => question.id),
  playerId: uuid('player_id').notNull().references(() => sessionPlayer.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').notNull(),
  timeMs: integer('time_ms').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  points: integer('points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionQuestionIdx: index('answer_session_question_idx').on(t.sessionId, t.questionId),
}))
```

- [ ] **Step 2: Config drizzle-kit + export du schéma**

`packages/db/drizzle.config.ts`
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
})
```

`packages/db/src/index.ts`
```ts
export { createDb, type Db } from './client.js'
export * as schema from './schema.js'
```

- [ ] **Step 3: Générer la migration initiale**

Run: `pnpm --filter @splootlabs/db db:generate`
Expected: crée `packages/db/drizzle/0000_*.sql` + `packages/db/drizzle/meta/`. Le SQL contient `CREATE TYPE ... plan`, les 9 `CREATE TABLE`, et l'index partiel `game_session_active_pin_uidx ... WHERE status <> 'ended'`.

- [ ] **Step 4: Écrire le test de schéma**

`packages/db/src/schema.test.ts`
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
}, 120_000)

afterAll(async () => {
  await ctx?.stop()
})

describe('schéma', () => {
  it('crée les 9 tables attendues', async () => {
    const rows = await ctx.db.execute(sql`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name
    `)
    const names = rows.map((r) => (r as { table_name: string }).table_name)
    for (const t of ['answer_record', 'game_session', 'membership', 'oauth_account', 'question', 'quiz', 'session_player', 'tenant', 'user']) {
      expect(names).toContain(t)
    }
  })

  it('applique l\'unicité du PIN uniquement aux sessions non terminées', async () => {
    // Deux sessions "ended" avec le même PIN sont permises ; deux "lobby" avec le même PIN non.
    const info = await ctx.db.execute(sql`
      select indexdef from pg_indexes where indexname = 'game_session_active_pin_uidx'
    `)
    expect((info[0] as { indexdef: string }).indexdef.toLowerCase()).toContain("where (status <> 'ended')")
  })
})
```

(Ce test dépend de `runMigrations` de la Task 3. Si tu exécutes les tâches dans l'ordre, écris d'abord la Task 3 Step 3, ou marque ce test `it.todo` jusqu'à la Task 3 puis active-le.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): schéma complet (9 tables + enums) + migration initiale"
```

---

### Task 3: Runner de migrations

**Files:**
- Create: `packages/db/src/migrate.ts`, `packages/db/src/migrate.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), les migrations `drizzle/` (Task 2).
- Produces: `runMigrations(db: Db): Promise<void>`.

- [ ] **Step 1: Écrire le test qui échoue**

`packages/db/src/migrate.test.ts`
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => { ctx = await startTestDb() }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('runMigrations', () => {
  it('applique les migrations sur une base vierge (table tenant présente)', async () => {
    await runMigrations(ctx.db)
    const rows = await ctx.db.execute(sql`select to_regclass('public.tenant') as t`)
    expect((rows[0] as { t: string | null }).t).toBe('tenant')
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test`
Expected: FAIL — `./migrate` / `runMigrations` introuvable.

- [ ] **Step 3: Implémenter le runner**

`packages/db/src/migrate.ts`
```ts
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.js'

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder })
}
```

`packages/db/src/index.ts`
```ts
export { createDb, type Db } from './client.js'
export { runMigrations } from './migrate.js'
export * as schema from './schema.js'
```

Note : en dev/test (tsx/vitest, condition `development`), `import.meta.url` pointe vers `src/`, donc `../drizzle` résout bien vers `packages/db/drizzle`. En prod (`dist/`), le build doit embarquer `drizzle/` au même niveau relatif — géré au Task 6 (copie dans l'image + chemin `../drizzle` depuis `dist/`).

- [ ] **Step 4: Vérifier que les tests passent (et activer le test schéma de Task 2)**

Si tu avais mis `it.todo` en Task 2, remplace-le par le vrai test maintenant.
Run: `pnpm --filter @splootlabs/db test`
Expected: PASS — migrate + schema + client verts.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): runner de migrations Drizzle"
```

---

### Task 4: Guard de scoping tenant + repo quiz + tests d'isolation

**Files:**
- Create: `packages/db/src/tenant.ts`, `packages/db/src/repos/quiz.ts`, `packages/db/src/repos/quiz.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/tenant.ts` (voir Task 5 pour les ajouts)

**Interfaces:**
- Consumes: `Db`, `schema` (Tasks 1-2).
- Produces:
  - `tenantScope(db: Db, tenantId: string)` → `{ tenantId, db }` (contexte scoped, passé aux repos)
  - `createQuiz(scope, input: { ownerId: string; title: string; description?: string }): Promise<Quiz>`
  - `listQuizzes(scope): Promise<Quiz[]>` (seulement le tenant du scope)
  - `getQuiz(scope, id: string): Promise<Quiz | null>` (null si autre tenant)
  - `type Quiz = typeof schema.quiz.$inferSelect`

- [ ] **Step 1: Écrire les tests d'isolation qui échouent**

`packages/db/src/repos/quiz.test.ts`
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb } from '../test-helpers.js'
import { runMigrations } from '../migrate.js'
import { schema } from '../index.js'
import { tenantScope } from '../tenant.js'
import { createQuiz, listQuizzes, getQuiz } from './quiz.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>
let tenantA: string
let tenantB: string
let ownerA: string
let ownerB: string

beforeAll(async () => {
  ctx = await startTestDb()
  await runMigrations(ctx.db)
  const [tA] = await ctx.db.insert(schema.tenant).values({ name: 'Tenant A' }).returning()
  const [tB] = await ctx.db.insert(schema.tenant).values({ name: 'Tenant B' }).returning()
  const [uA] = await ctx.db.insert(schema.user).values({ email: 'a@x.fr' }).returning()
  const [uB] = await ctx.db.insert(schema.user).values({ email: 'b@x.fr' }).returning()
  tenantA = tA.id; tenantB = tB.id; ownerA = uA.id; ownerB = uB.id
}, 120_000)

afterAll(async () => { await ctx?.stop() })

describe('repo quiz scoped par tenant', () => {
  it('createQuiz écrit le tenant_id du scope', async () => {
    const scope = tenantScope(ctx.db, tenantA)
    const q = await createQuiz(scope, { ownerId: ownerA, title: 'Quiz A1' })
    expect(q.tenantId).toBe(tenantA)
  })

  it('listQuizzes ne renvoie que les quiz du tenant du scope', async () => {
    await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B1' })
    const listA = await listQuizzes(tenantScope(ctx.db, tenantA))
    const listB = await listQuizzes(tenantScope(ctx.db, tenantB))
    expect(listA.every((q) => q.tenantId === tenantA)).toBe(true)
    expect(listB.every((q) => q.tenantId === tenantB)).toBe(true)
    expect(listA.some((q) => q.title === 'Quiz B1')).toBe(false)
  })

  it('getQuiz renvoie null pour un quiz d\'un autre tenant (pas de fuite)', async () => {
    const qb = await createQuiz(tenantScope(ctx.db, tenantB), { ownerId: ownerB, title: 'Quiz B2' })
    const leaked = await getQuiz(tenantScope(ctx.db, tenantA), qb.id)
    expect(leaked).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test`
Expected: FAIL — `../tenant` / `./quiz` introuvables.

- [ ] **Step 3: Implémenter le scope et le repo**

`packages/db/src/tenant.ts`
```ts
import type { Db } from './client.js'

export type TenantScope = { db: Db; tenantId: string }

export function tenantScope(db: Db, tenantId: string): TenantScope {
  return { db, tenantId }
}
```

`packages/db/src/repos/quiz.ts`
```ts
import { and, eq } from 'drizzle-orm'
import { schema } from '../index.js'
import type { TenantScope } from '../tenant.js'

export type Quiz = typeof schema.quiz.$inferSelect

export async function createQuiz(
  scope: TenantScope,
  input: { ownerId: string; title: string; description?: string },
): Promise<Quiz> {
  const [row] = await scope.db
    .insert(schema.quiz)
    .values({
      tenantId: scope.tenantId, // toujours le tenant du scope, jamais depuis l'input
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
    })
    .returning()
  return row
}

export async function listQuizzes(scope: TenantScope): Promise<Quiz[]> {
  return scope.db.select().from(schema.quiz).where(eq(schema.quiz.tenantId, scope.tenantId))
}

export async function getQuiz(scope: TenantScope, id: string): Promise<Quiz | null> {
  const [row] = await scope.db
    .select()
    .from(schema.quiz)
    .where(and(eq(schema.quiz.id, id), eq(schema.quiz.tenantId, scope.tenantId)))
    .limit(1)
  return row ?? null
}
```

`packages/db/src/index.ts` (ajouts)
```ts
export { createDb, type Db } from './client.js'
export { runMigrations } from './migrate.js'
export { tenantScope, type TenantScope } from './tenant.js'
export * as schema from './schema.js'
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @splootlabs/db test`
Expected: PASS — les 3 tests d'isolation + tous les précédents. **Aucune fuite inter-tenant.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): guard tenantScope + repo quiz + tests d'isolation inter-tenant"
```

---

### Task 5: Bootstrap tenant par défaut (mode single) + résolution de tenant

**Files:**
- Modify: `packages/db/src/tenant.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/tenant.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema`, `AppConfig` (`@splootlabs/shared`).
- Produces:
  - `ensureDefaultTenant(db: Db): Promise<string>` — crée (si absent) le tenant par défaut du mode single et renvoie son id. Idempotent.
  - `resolveTenantId(db: Db, config: Pick<AppConfig, 'tenancyMode'>, explicitTenantId?: string): Promise<string>` — en `single` renvoie le tenant par défaut ; en `multi` exige `explicitTenantId` (sinon lève).

Constante : `DEFAULT_TENANT_NAME = 'default'` (le tenant single implicite est repéré par ce name unique).

- [ ] **Step 1: Écrire les tests qui échouent**

`packages/db/src/tenant.test.ts`
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { startTestDb } from './test-helpers.js'
import { runMigrations } from './migrate.js'
import { ensureDefaultTenant, resolveTenantId } from './tenant.js'

let ctx: Awaited<ReturnType<typeof startTestDb>>

beforeAll(async () => { ctx = await startTestDb(); await runMigrations(ctx.db) }, 120_000)
afterAll(async () => { await ctx?.stop() })

describe('ensureDefaultTenant', () => {
  it('est idempotent : deux appels renvoient le même id', async () => {
    const a = await ensureDefaultTenant(ctx.db)
    const b = await ensureDefaultTenant(ctx.db)
    expect(a).toBe(b)
  })
})

describe('resolveTenantId', () => {
  it('mode single : renvoie le tenant par défaut', async () => {
    const def = await ensureDefaultTenant(ctx.db)
    const resolved = await resolveTenantId(ctx.db, { tenancyMode: 'single' })
    expect(resolved).toBe(def)
  })

  it('mode multi : exige un tenant explicite, sinon lève', async () => {
    await expect(resolveTenantId(ctx.db, { tenancyMode: 'multi' })).rejects.toThrow()
    const ok = await resolveTenantId(ctx.db, { tenancyMode: 'multi' }, 'some-uuid')
    expect(ok).toBe('some-uuid')
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test`
Expected: FAIL — `ensureDefaultTenant` / `resolveTenantId` non exportés.

- [ ] **Step 3: Implémenter**

`packages/db/src/tenant.ts` (ajouts sous le code existant)
```ts
import { eq } from 'drizzle-orm'
import type { AppConfig } from '@splootlabs/shared'
import { schema } from './index.js'

export const DEFAULT_TENANT_NAME = 'default'

export async function ensureDefaultTenant(db: Db): Promise<string> {
  const [existing] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.name, DEFAULT_TENANT_NAME))
    .limit(1)
  if (existing) return existing.id
  const [created] = await db
    .insert(schema.tenant)
    .values({ name: DEFAULT_TENANT_NAME })
    .onConflictDoNothing()
    .returning({ id: schema.tenant.id })
  if (created) return created.id
  // course concurrente : relire
  const [row] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.name, DEFAULT_TENANT_NAME))
    .limit(1)
  return row.id
}

export async function resolveTenantId(
  db: Db,
  config: Pick<AppConfig, 'tenancyMode'>,
  explicitTenantId?: string,
): Promise<string> {
  if (config.tenancyMode === 'single') return ensureDefaultTenant(db)
  if (!explicitTenantId) throw new Error('mode multi : un tenant explicite est requis')
  return explicitTenantId
}
```

Pour que `onConflictDoNothing` sur le name fonctionne comme garde-fou d'idempotence, ajoute une contrainte d'unicité sur `tenant.name` dans le schéma (Task 2) : dans `tenant`, remplace `name: text('name').notNull()` par `name: text('name').notNull().unique()`, puis régénère la migration (`pnpm --filter @splootlabs/db db:generate`) et commit le nouveau SQL. (Fais-le dans cette tâche pour rester cohérent.)

- [ ] **Step 4: Régénérer la migration et vérifier les tests**

Run: `pnpm --filter @splootlabs/db db:generate && pnpm --filter @splootlabs/db test`
Expected: PASS — tenant + tous les tests verts. (La nouvelle migration ajoute l'unicité sur `tenant.name`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): tenant par défaut (mode single) idempotent + resolveTenantId"
```

---

### Task 6: Câblage serveur + service Postgres compose + migrations auto + /health readiness

**Files:**
- Modify: `apps/server/package.json` (dép `@splootlabs/db`), `apps/server/src/app.ts` (health readiness), `apps/server/src/index.ts` (créer db + migrer + ensureDefaultTenant), `apps/server/src/app.test.ts` (health)
- Modify: `docker-compose.yml` (service `db`), `Dockerfile` (copier `packages/db/drizzle` dans l'image), `packages/shared/src/config.ts` (défaut `DATABASE_URL`)
- Modify: `packages/shared/src/config.test.ts` (nouveau défaut)

**Interfaces:**
- Consumes: `createDb`, `runMigrations`, `ensureDefaultTenant` (`@splootlabs/db`), `AppConfig`.
- Produces: le serveur crée un client db au démarrage, applique les migrations, et (mode single) garantit le tenant par défaut ; `GET /health` renvoie `{ status, db: 'up' | 'down', ... }`.

- [ ] **Step 1: Réviser le défaut DATABASE_URL (Postgres) + son test**

Dans `packages/shared/src/config.ts`, change le défaut :
```ts
  DATABASE_URL: z.string().min(1).default('postgres://kahoot:kahoot@localhost:5432/kahoot'),
```
Dans `packages/shared/src/config.test.ts`, remplace l'assertion SQLite :
```ts
  it('par défaut : single-tenant, Postgres local, scaling mémoire', () => {
    const cfg = loadConfig({})
    expect(cfg.tenancyMode).toBe('single')
    expect(cfg.databaseUrl).toBe('postgres://kahoot:kahoot@localhost:5432/kahoot')
    expect(cfg.scaling).toBe('memory')
    expect(cfg.port).toBe(3000)
  })
```

- [ ] **Step 2: Écrire le test de readiness /health (échoue)**

Dans `apps/server/src/app.test.ts`, ajoute (le health prend maintenant un statut db injecté pour rester testable sans vraie base) :
```ts
import { describe, it, expect } from 'vitest'
import { buildServer } from './app.js'
import { loadConfig } from '@splootlabs/shared'

describe('GET /health', () => {
  it('renvoie ok + statut db', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }), { dbStatus: () => 'up' })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up', tenancyMode: 'single', scaling: 'memory' })
    await app.close()
  })
})
```

- [ ] **Step 3: Lancer pour vérifier l'échec**

Run: `pnpm --filter @splootlabs/server test`
Expected: FAIL — `buildServer` n'accepte pas de 2e argument / `db` absent de la réponse.

- [ ] **Step 4: Implémenter le health readiness**

`apps/server/src/app.ts`
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from '@splootlabs/shared'

export type ServerDeps = { dbStatus?: () => 'up' | 'down' }

export function buildServer(config: AppConfig, deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== 'test' })
  app.get('/health', async () => ({
    status: 'ok',
    db: deps.dbStatus ? deps.dbStatus() : 'unknown',
    tenancyMode: config.tenancyMode,
    scaling: config.scaling,
  }))
  return app
}
```

- [ ] **Step 5: Câbler l'entrypoint (db + migrations + tenant par défaut)**

`apps/server/package.json` → `dependencies` : ajoute `"@splootlabs/db": "workspace:*"`.

`apps/server/src/index.ts` (remplace le contenu wiring existant, en gardant static + realtime)
```ts
import { join } from 'node:path'
import { loadConfig } from '@splootlabs/shared'
import { createDb, runMigrations, ensureDefaultTenant } from '@splootlabs/db'
import { buildServer } from './app.js'
import { attachRealtime } from './realtime.js'
import { registerStatic } from './static.js'

const config = loadConfig()
const { db, client } = createDb(config.databaseUrl)

await runMigrations(db)
if (config.tenancyMode === 'single') await ensureDefaultTenant(db)

let dbUp = true
const app = buildServer(config, { dbStatus: () => (dbUp ? 'up' : 'down') })
attachRealtime(app)
const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'public')
registerStatic(app, webDist)

app.addHook('onClose', async () => { await client.end({ timeout: 5 }) })

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`serveur démarré sur :${config.port} (${config.tenancyMode}/${config.scaling})`))
  .catch((err) => { app.log.error(err); dbUp = false; process.exit(1) })
```

(Top-level `await` est autorisé : le paquet serveur est ESM.)

- [ ] **Step 6: Service Postgres dans docker-compose + copie des migrations dans l'image**

`docker-compose.yml`
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kahoot
      POSTGRES_PASSWORD: kahoot
      POSTGRES_DB: kahoot
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kahoot"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      TENANCY_MODE: single
      DATABASE_URL: postgres://kahoot:kahoot@db:5432/kahoot
      SESSION_SECRET: change-me-in-production-please!!
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
```

Dans le `Dockerfile`, stage runtime : copie les migrations à côté de `dist/` pour que `../drizzle` (depuis `apps/server/dist` → non ; depuis `packages/db/dist`) résolve. Ajoute :
```dockerfile
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
```
(place-le après la copie de `packages`, avant le `CMD`). Le runner `migrate.ts` résout `../drizzle` depuis `packages/db/dist/migrate.js` → `packages/db/drizzle`, présent dans l'image.

- [ ] **Step 7: Vérifier tests unitaires + bout-en-bout Docker**

Run: `pnpm test` → tous verts (config révisée, health readiness).
Run: `pnpm -r typecheck` → propre.
Run: `docker compose up -d --build` puis attends la santé et : `curl -s localhost:3000/health`
Expected: `{"status":"ok","db":"up","tenancyMode":"single","scaling":"memory"}`. Puis `docker compose down`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(server): câblage @splootlabs/db (migrations auto + tenant par défaut) + service Postgres compose + /health readiness"
```

---

## Self-Review

**1. Spec coverage (Plan 2 = couche Data + tenancy) :**
- Postgres partout (dialecte unique) → Tasks 1-6. ✅
- Schéma complet 9 tables + enums (user sans tenant_id, membership comme jointure) → Task 2. ✅
- PIN unique parmi les sessions actives (index partiel) → Task 2 + test. ✅
- Migrations (drizzle-kit + runner) → Tasks 2, 3. ✅
- Guard tenantScope + isolation prouvée → Task 4. ✅
- Tenant par défaut (mode single) + resolveTenantId → Task 5. ✅
- Self-host `docker compose` avec service Postgres + migrations auto → Task 6. ✅
- Tests contre Postgres jetable (testcontainers) → toutes les tâches db. ✅
- Auth/OAuth, éditeur, moteur, dashboard → **hors périmètre** (Plans 3-8). ✅ (attendu)

**2. Placeholder scan :** aucun TBD ; code complet et commandes exactes à chaque step. ✅ (Note : le test schéma de Task 2 dépend de `runMigrations` de Task 3 — la dépendance et la parade (`it.todo`) sont explicitées.)

**3. Type consistency :** `createDb`→`{db,client}`, `Db`, `runMigrations(db)`, `tenantScope(db,tenantId)`→`TenantScope`, `createQuiz/listQuizzes/getQuiz(scope,...)`, `ensureDefaultTenant(db)`, `resolveTenantId(db,config,explicit?)`, `buildServer(config, deps)` — noms/signatures cohérents entre définition et usage. ✅

---

## Notes pour les plans suivants
- **Plan 3 (Auth)** ajoutera la création d'utilisateurs/OAuth/memberships et la résolution du tenant en mode `multi` (via l'organisation de l'utilisateur connecté), en s'appuyant sur `resolveTenantId(..., explicitTenantId)`.
- **Plan 4 (Éditeur)** ajoutera les repos `question` (payload par type) sur le même pattern `TenantScope` que `quiz`.
- Le pattern repo scoped (toujours filtrer/écrire `tenantId` depuis le scope, jamais depuis l'input client) est la règle de sécurité multi-tenant à répliquer partout.

### ⚠️ Points remontés par la revue finale de branche (à traiter aux plans indiqués)
- **[Plan 4 — CRITIQUE pour la sécurité]** Les tables **`question`, `session_player`, `answer_record` n'ont PAS de `tenant_id`** : elles ne sont atteignables que via `quiz.tenant_id` / `game_session.tenant_id`. Leurs repos DOIVENT scoper par **jointure** sur le parent (ex. `getQuestion` doit joindre `quiz` et filtrer `quiz.tenant_id = scope.tenantId`). Un repo enfant non-joint serait la première vraie fuite inter-tenant. Étendre le pattern `TenantScope` avec une variante « join-based » avant d'écrire ces repos.
- **[Plan 3 — Auth]** `resolveTenantId` en mode `multi` renvoie `explicitTenantId` **sans vérifier l'existence ni l'appartenance** (membership). C'est voulu : la sécurité de la résolution multi-tenant repose entièrement sur le Plan 3 qui doit dériver ce `tenantId` d'une ligne `membership` validée. Précondition à documenter.
- **[Plan 3]** Ajouter `onDelete` sur `quiz.owner_id` / `game_session.host_id` (sinon un user ayant créé un quiz/hébergé une partie est indéboulonnable) ; valider que `createQuiz.ownerId` appartient au tenant du scope.
- **[Plan 8 / cloud]** `runMigrations` tourne à chaque démarrage : en multi-instance, garder les migrations concurrentes (verrou/advisory lock) pour éviter la course du migrator.
- **[polish, quand le repo session arrive]** Tester l'index partiel PIN par un **INSERT runtime** (deux sessions non-`ended` même PIN → violation), pas seulement au niveau DDL.
- **[polish]** Casser l'import circulaire `tenant.ts`↔`index.ts` (importer `* as schema from './schema.js'` directement) ; `/health` = liveness de boot statique (envisager un `SELECT 1` on-demand) ; logger les erreurs de démarrage (createDb/runMigrations) via `app.log` avant `exit(1)`.
