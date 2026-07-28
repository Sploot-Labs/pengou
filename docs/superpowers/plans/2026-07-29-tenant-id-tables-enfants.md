# Slice 0 — `tenant_id` sur les tables enfants — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dénormaliser un `tenant_id` non-null et cohérent-avec-le-parent sur `question`, `session_player` et `answer_record`, sans casser le comportement existant ni toucher aux signatures du temps réel.

**Architecture:** Une table par tâche. Chaque tâche ajoute la colonne au schéma Drizzle (notNull + index + FK simple vers `tenant` + FK composite vers le parent), édite la migration générée pour intercaler le backfill dérivé du parent (add-nullable → backfill → set-not-null), câble l'écriture (scope pour `question`, dérivation en 2 temps du parent pour les tables temps réel) et ajoute les filtres `tenant_id` directs sur les lectures scopées. La cohérence enfant↔parent est garantie au niveau base par une FK composite `(parent_id, tenant_id) → parent(id, tenant_id)`.

**Tech Stack:** Drizzle ORM 0.45.2, Postgres, drizzle-kit 0.31 (migrations SQL dans `packages/db/drizzle/`, appliquées par `runMigrations` via le migrator postgres-js), Vitest + `@testcontainers/postgresql`.

## Global Constraints

- **Langue** : code, commentaires, messages de commit en français.
- **Aucune signature du temps réel modifiée** : `addSessionPlayer(db, sessionId, input)` et `recordAnswer(db, input)` gardent exactement leur signature actuelle (la passerelle `apps/server/src/game-gateway.ts` ne doit pas être touchée).
- **`tenant_id` jamais pris d'un input client** : toujours `scope.tenantId` (écriture scopée) ou dérivé du parent en base.
- **FK composite sur les 3 tables** : `(parent_id, tenant_id) → parent(id, tenant_id)`, action par défaut (NO ACTION) — le cascade de suppression est déjà porté par la FK simple `parent_id` existante ; on ne la touche pas (pas de double-cascade, pas de churn de contrainte).
- **Hors scope (Slice 2)** : aucun `SET LOCAL`/GUC, aucune `CREATE POLICY`/RLS, aucun rôle DB dédié.
- **Migrations** : `drizzle-kit generate` produit le fichier + met à jour le snapshot `meta/` ; on édite UNIQUEMENT le `.sql` pour le séquencement du backfill (on ne touche pas au snapshot).
- **Chaque tâche se termine verte** : `pnpm --filter @splootlabs/db test` et `pnpm --filter @splootlabs/server test` passent avant commit.
- **DB dev** : `arena-pg` sur port 5433, vars d'env exportées inline (dotenv non câblé).

---

## Structure des fichiers

- `packages/db/src/schema.ts` — ajout colonnes `tenantId` + index + FK composite (les 3 tâches).
- `packages/db/drizzle/00NN_*.sql` — une migration éditée par tâche (question, session_player, answer_record).
- `packages/db/src/repos/question.ts` — écriture scopée + filtres lecture (Tâche 1).
- `packages/db/src/repos/session.ts` — écritures temps réel en 2 temps (Tâches 2 & 3).
- `packages/db/src/repos/reports.ts` — filtres `tenant_id` directs sur lectures scopées (Tâches 1/2/3).
- `packages/db/src/repos/{question,session,reports}.test.ts` — nouveaux tests + fixtures corrigées.
- `apps/server/src/{reports-e2e,routes-sessions}.test.ts` — fixtures `insert(question)` corrigées (Tâche 1).

---

## Task 1 : `tenant_id` sur `question`

**Files:**
- Modify: `packages/db/src/schema.ts` (table `quiz` : + unique index ; table `question` : + colonne/index/FK composite)
- Create: `packages/db/drizzle/0011_*.sql` (généré puis édité)
- Modify: `packages/db/src/repos/question.ts` (`createQuestion`, `listQuestions`, `getQuestion`)
- Modify: `packages/db/src/repos/reports.ts` (`getSessionReport` : sous-requête `questions`)
- Modify (fixtures): `packages/db/src/repos/session.test.ts:26`, `packages/db/src/repos/reports.test.ts:31,36,41`, `apps/server/src/reports-e2e.test.ts:141`, `apps/server/src/routes-sessions.test.ts:58`
- Test: `packages/db/src/repos/question.test.ts`

**Interfaces:**
- Consumes: `TenantScope = { db, tenantId }` (existant, `tenant.ts`).
- Produces: `schema.question` gagne la colonne `tenantId: uuid notNull` ; unique index `quiz_id_tenant_uidx` sur `quiz(id, tenant_id)` (réutilisé par aucune autre tâche) ; `createQuestion` écrit `scope.tenantId`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `packages/db/src/repos/question.test.ts`, changer la ligne d'import drizzle-orm en tête pour disposer de `eq`/`sql` :

```ts
import { eq, sql } from 'drizzle-orm'
```

Puis ajouter, à la fin du `describe('repo question scopé par jointure sur quiz', () => {` (avant sa `})` finale) :

```ts
it('createQuestion écrit le tenant_id du scope', async () => {
  const q = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'TenantSet', timeLimit: 20, payload: validMcq })
  expect(q?.tenantId).toBe(tenantA)
})

it('la FK composite rejette une question dont le tenant_id ne colle pas au quiz parent', async () => {
  // quizA appartient à tenantA ; forcer tenantB viole (quiz_id, tenant_id) → quiz(id, tenant_id)
  await expect(
    ctx.db.insert(schema.question).values({
      quizId: quizA, tenantId: tenantB, type: 'mcq', prompt: 'Cross', timeLimit: 20, orderIndex: 999, payload: validMcq,
    }).returning(),
  ).rejects.toThrow()
})

it('la colonne tenant_id est NOT NULL (aucun insert sans tenant résoluble)', async () => {
  await expect(
    ctx.db.insert(schema.question).values({
      quizId: quizA, type: 'mcq', prompt: 'NoTenant', timeLimit: 20, orderIndex: 998, payload: validMcq,
    } as never).returning(),
  ).rejects.toThrow()
})

it('le backfill dérive tenant_id du quiz parent (simulation d\'une ligne legacy)', async () => {
  const created = await createQuestion(tenantScope(ctx.db, tenantA), quizA, { type: 'mcq', prompt: 'Legacy', timeLimit: 20, payload: validMcq })
  // Simuler une ligne d'avant la migration : relâcher NOT NULL, vider la colonne, rejouer le backfill.
  await ctx.db.execute(sql`ALTER TABLE question ALTER COLUMN tenant_id DROP NOT NULL`)
  await ctx.db.execute(sql`UPDATE question SET tenant_id = NULL WHERE id = ${created!.id}`)
  await ctx.db.execute(sql`UPDATE question q SET tenant_id = z.tenant_id FROM quiz z WHERE z.id = q.quiz_id AND q.tenant_id IS NULL`)
  await ctx.db.execute(sql`ALTER TABLE question ALTER COLUMN tenant_id SET NOT NULL`)
  const [row] = await ctx.db.select().from(schema.question).where(eq(schema.question.id, created!.id))
  expect(row.tenantId).toBe(tenantA)
})
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @splootlabs/db test -- question`
Expected: FAIL (colonne `tenantId` inconnue du schéma / propriété `tenantId` absente du type).

- [ ] **Step 3 : Ajouter la colonne + index + FK composite au schéma**

Dans `packages/db/src/schema.ts` :

1. Compléter l'import pg-core avec `foreignKey` :

```ts
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, foreignKey,
} from 'drizzle-orm/pg-core'
```

2. Sur la table `quiz`, ajouter un index unique `(id, tenant_id)` dans le callback :

```ts
}, (t) => ({
  tenantIdx: index('quiz_tenant_idx').on(t.tenantId),
  idTenantUq: uniqueIndex('quiz_id_tenant_uidx').on(t.id, t.tenantId),
}))
```

3. Sur la table `question`, ajouter la colonne `tenantId` (après `quizId`) et, dans le callback, l'index + la FK composite :

```ts
export const question = pgTable('question', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  quizId: uuid('quiz_id').notNull().references(() => quiz.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  type: questionTypeEnum('type').notNull(),
  prompt: text('prompt').notNull(),
  media: text('media'),
  timeLimit: integer('time_limit').notNull().default(20),
  readingTime: integer('reading_time').notNull().default(6),
  orderIndex: integer('order_index').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quizOrderIdx: index('question_quiz_order_idx').on(t.quizId, t.orderIndex),
  tenantIdx: index('question_tenant_idx').on(t.tenantId),
  quizTenantFk: foreignKey({
    columns: [t.quizId, t.tenantId],
    foreignColumns: [quiz.id, quiz.tenantId],
    name: 'question_quiz_tenant_fk',
  }),
}))
```

- [ ] **Step 4 : Générer puis éditer la migration (backfill)**

Run: `pnpm --filter @splootlabs/db db:generate`

Cela crée `packages/db/drizzle/0011_*.sql` et met à jour `meta/`. Ouvrir le `.sql` et le **remplacer** par cette séquence ordonnée (add-nullable → FK tenant → backfill → set-not-null → index → unique index parent → FK composite) :

```sql
ALTER TABLE "question" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "question" q SET "tenant_id" = z."tenant_id" FROM "quiz" z WHERE z."id" = q."quiz_id";--> statement-breakpoint
ALTER TABLE "question" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "question_tenant_idx" ON "question" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_id_tenant_uidx" ON "quiz" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_quiz_tenant_fk" FOREIGN KEY ("quiz_id","tenant_id") REFERENCES "public"."quiz"("id","tenant_id") ON DELETE no action ON UPDATE no action;
```

> Le point crucial est de **retirer le `NOT NULL` inline** que drizzle-kit met sur `ADD COLUMN`, et d'intercaler l'`UPDATE` de backfill avant le `SET NOT NULL`. Sur une base vide (tests) le backfill met à jour 0 ligne ; sur la base dev/prod il rétro-remplit l'existant. Conserver les noms de contraintes/index exactement comme ci-dessus (ils correspondent au snapshot généré → pas de dérive au prochain `generate`).

- [ ] **Step 5 : Câbler l'écriture scopée**

Dans `packages/db/src/repos/question.ts`, `createQuestion` — ajouter `tenantId: scope.tenantId` aux `.values(…)` :

```ts
const [row] = await scope.db.insert(schema.question).values({
  quizId, tenantId: scope.tenantId, type: input.type, prompt: input.prompt, timeLimit: input.timeLimit,
  readingTime: input.readingTime ?? 6, payload: input.payload as never, media: input.media ?? null, orderIndex,
}).returning()
```

- [ ] **Step 6 : Ajouter les filtres `tenant_id` directs sur les lectures scopées**

Dans `packages/db/src/repos/question.ts` (défense en profondeur, en plus de `assertQuizInTenant`) :

`listQuestions` :
```ts
return scope.db.select().from(schema.question)
  .where(and(eq(schema.question.quizId, quizId), eq(schema.question.tenantId, scope.tenantId)))
  .orderBy(schema.question.orderIndex)
```

`getQuestion` :
```ts
const [row] = await scope.db.select().from(schema.question)
  .where(and(
    eq(schema.question.id, questionId),
    eq(schema.question.quizId, quizId),
    eq(schema.question.tenantId, scope.tenantId),
  ))
```

Dans `packages/db/src/repos/reports.ts`, `getSessionReport`, sous-requête `questions` — ajouter le filtre tenant sur `question` (le `.where` devient un `and`) :
```ts
.where(and(eq(schema.question.quizId, session.quizId), eq(schema.question.tenantId, scope.tenantId)))
```
(`and` est déjà importé dans `reports.ts`.)

- [ ] **Step 7 : Corriger les fixtures d'insert direct de `question`**

Ajouter `tenantId` (= tenant du quiz parent, sinon la FK composite rejette) à chaque `insert(schema.question)` direct :

- `packages/db/src/repos/session.test.ts:26` → `quizId: quizA, tenantId: tenantA,` (quizA est sous tenantA).
- `packages/db/src/repos/reports.test.ts` : `question1`/`question2` (quizA) → `tenantId: tenantA,` ; `questionB` (quizB) → `tenantId: tenantB,`.
- `apps/server/src/reports-e2e.test.ts:141` (`seedForeignSession`) → `quizId: quiz.id, tenantId: foreignTenant.id,`.
- `apps/server/src/routes-sessions.test.ts:58` (`seedFinishedSession`) → `quizId: quiz.id, tenantId,` (le param `tenantId` de la fonction).

- [ ] **Step 8 : Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/db test`
Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (dont les 4 nouveaux tests question).

- [ ] **Step 9 : Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ packages/db/src/repos/question.ts packages/db/src/repos/reports.ts packages/db/src/repos/question.test.ts packages/db/src/repos/session.test.ts packages/db/src/repos/reports.test.ts apps/server/src/reports-e2e.test.ts apps/server/src/routes-sessions.test.ts
git commit -m "feat(db): tenant_id sur question (backfill + FK composite quiz)"
```

---

## Task 2 : `tenant_id` sur `session_player`

**Files:**
- Modify: `packages/db/src/schema.ts` (table `game_session` : + unique index `(id, tenant_id)` ; table `session_player` : + colonne/index/FK composite)
- Create: `packages/db/drizzle/0012_*.sql` (généré puis édité)
- Modify: `packages/db/src/repos/session.ts` (`addSessionPlayer` → dérivation en 2 temps)
- Modify: `packages/db/src/repos/reports.ts` (`listSessions` join joueur, `getSessionReport` sous-requête `players`)
- Test: `packages/db/src/repos/session.test.ts`

**Interfaces:**
- Consumes: `schema.gameSession.tenantId` (existant) ; `Db` (client).
- Produces: `schema.sessionPlayer` gagne `tenantId: uuid notNull` ; unique index `game_session_id_tenant_uidx` sur `game_session(id, tenant_id)` (**réutilisé par la Tâche 3**) ; `addSessionPlayer` signature **inchangée**, pose `tenant_id` = celui de la session parente.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `packages/db/src/repos/session.test.ts`, ajouter dans le `describe` (avant sa `})` finale) :

```ts
it('addSessionPlayer pose le tenant_id de la session parente (signature inchangée)', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '242424' })
  const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Tenanted', joinToken: 'tok-tenanted' })
  expect(player.tenantId).toBe(tenantA)
})

it('la FK composite rejette un session_player dont le tenant_id ne colle pas à la session', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '252525' })
  await expect(
    ctx.db.insert(schema.sessionPlayer).values({
      sessionId: session!.id, tenantId: tenantB, nickname: 'Cross', joinToken: 'tok-cross',
    }).returning(),
  ).rejects.toThrow()
})
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @splootlabs/db test -- session`
Expected: FAIL (`tenantId` absent du type `SessionPlayer` / colonne inconnue).

- [ ] **Step 3 : Ajouter la colonne + index + FK composite au schéma**

Dans `packages/db/src/schema.ts` :

1. Sur `game_session`, ajouter l'unique index `(id, tenant_id)` dans le callback (à côté de `activePinUnique`/`tenantIdx`) :

```ts
idTenantUq: uniqueIndex('game_session_id_tenant_uidx').on(t.id, t.tenantId),
```

2. Sur `session_player`, ajouter la colonne + index + FK composite :

```ts
export const sessionPlayer = pgTable('session_player', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nickname: text('nickname').notNull(),
  joinToken: text('join_token').notNull(),
  totalScore: integer('total_score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('session_player_session_idx').on(t.sessionId),
  tenantIdx: index('session_player_tenant_idx').on(t.tenantId),
  sessionTenantFk: foreignKey({
    columns: [t.sessionId, t.tenantId],
    foreignColumns: [gameSession.id, gameSession.tenantId],
    name: 'session_player_session_tenant_fk',
  }),
}))
```

- [ ] **Step 4 : Générer puis éditer la migration (backfill)**

Run: `pnpm --filter @splootlabs/db db:generate`

Ouvrir `packages/db/drizzle/0012_*.sql` et le remplacer par :

```sql
ALTER TABLE "session_player" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "session_player" ADD CONSTRAINT "session_player_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "session_player" sp SET "tenant_id" = gs."tenant_id" FROM "game_session" gs WHERE gs."id" = sp."session_id";--> statement-breakpoint
ALTER TABLE "session_player" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "session_player_tenant_idx" ON "session_player" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_id_tenant_uidx" ON "game_session" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "session_player" ADD CONSTRAINT "session_player_session_tenant_fk" FOREIGN KEY ("session_id","tenant_id") REFERENCES "public"."game_session"("id","tenant_id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 5 : Câbler l'écriture temps réel (dérivation en 2 temps)**

Dans `packages/db/src/repos/session.ts`, remplacer `addSessionPlayer` (signature identique) :

```ts
export async function addSessionPlayer(
  db: Db,
  sessionId: string,
  input: { nickname: string; joinToken: string },
): Promise<SessionPlayer> {
  // Pas de scope tenant dans la couche temps réel : on dérive le tenant_id de la session parente.
  const [parent] = await db.select({ tenantId: schema.gameSession.tenantId })
    .from(schema.gameSession).where(eq(schema.gameSession.id, sessionId))
  if (!parent) throw new Error(`addSessionPlayer: session introuvable (${sessionId})`)
  const [row] = await db.insert(schema.sessionPlayer).values({
    sessionId, tenantId: parent.tenantId, nickname: input.nickname, joinToken: input.joinToken,
  }).returning()
  return row
}
```

- [ ] **Step 6 : Ajouter les filtres `tenant_id` sur les lectures scopées de `reports.ts`**

Dans `packages/db/src/repos/reports.ts` :

`listSessions` — le left join joueur porte aussi le tenant :
```ts
.leftJoin(schema.sessionPlayer, and(
  eq(schema.sessionPlayer.sessionId, schema.gameSession.id),
  eq(schema.sessionPlayer.tenantId, scope.tenantId),
))
```

`getSessionReport` — sous-requête `players` :
```ts
.where(and(eq(schema.sessionPlayer.sessionId, sessionId), eq(schema.sessionPlayer.tenantId, scope.tenantId)))
```

- [ ] **Step 7 : Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/db test`
Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (dont les 2 nouveaux tests session_player ; la passerelle et les tests e2e restent verts, signature inchangée).

- [ ] **Step 8 : Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ packages/db/src/repos/session.ts packages/db/src/repos/reports.ts packages/db/src/repos/session.test.ts
git commit -m "feat(db): tenant_id sur session_player (dérivé de la session, FK composite)"
```

---

## Task 3 : `tenant_id` sur `answer_record`

**Files:**
- Modify: `packages/db/src/schema.ts` (table `answer_record` : + colonne/index/FK composite ; réutilise `game_session_id_tenant_uidx` de la Tâche 2)
- Create: `packages/db/drizzle/0013_*.sql` (généré puis édité)
- Modify: `packages/db/src/repos/session.ts` (`recordAnswer` → dérivation en 2 temps)
- Modify: `packages/db/src/repos/reports.ts` (`getSessionReport` : joins `answer_record` des sous-requêtes `questions` et `players`)
- Test: `packages/db/src/repos/session.test.ts`

**Interfaces:**
- Consumes: `schema.gameSession.tenantId` ; l'unique index `game_session_id_tenant_uidx` (créé en Tâche 2).
- Produces: `schema.answerRecord` gagne `tenantId: uuid notNull` ; `recordAnswer` signature **inchangée**, pose `tenant_id` = celui de la session parente.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `packages/db/src/repos/session.test.ts`, ajouter :

```ts
it('recordAnswer pose le tenant_id de la session parente (signature inchangée)', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '262626' })
  const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Ans', joinToken: 'tok-ans' })
  await recordAnswer(ctx.db, {
    sessionId: session!.id, questionId: questionA, playerId: player.id,
    answer: { choice: 0 }, timeMs: 1000, isCorrect: true, points: 500,
  })
  const [row] = await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.playerId, player.id))
  expect(row.tenantId).toBe(tenantA)
})

it('la FK composite rejette un answer_record dont le tenant_id ne colle pas à la session', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '272727' })
  const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'X', joinToken: 'tok-x2' })
  await expect(
    ctx.db.insert(schema.answerRecord).values({
      sessionId: session!.id, tenantId: tenantB, questionId: questionA, playerId: player.id,
      answer: { choice: 0 } as never, timeMs: 1, isCorrect: false, points: 0,
    }).returning(),
  ).rejects.toThrow()
})
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @splootlabs/db test -- session`
Expected: FAIL (`tenantId` absent du type `AnswerRecord` / colonne inconnue).

- [ ] **Step 3 : Ajouter la colonne + index + FK composite au schéma**

Dans `packages/db/src/schema.ts`, table `answer_record` :

```ts
export const answerRecord = pgTable('answer_record', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid('session_id').notNull().references(() => gameSession.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  questionId: uuid('question_id').notNull().references(() => question.id),
  playerId: uuid('player_id').notNull().references(() => sessionPlayer.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').notNull(),
  timeMs: integer('time_ms').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  points: integer('points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionQuestionIdx: index('answer_session_question_idx').on(t.sessionId, t.questionId),
  tenantIdx: index('answer_record_tenant_idx').on(t.tenantId),
  sessionTenantFk: foreignKey({
    columns: [t.sessionId, t.tenantId],
    foreignColumns: [gameSession.id, gameSession.tenantId],
    name: 'answer_record_session_tenant_fk',
  }),
}))
```

- [ ] **Step 4 : Générer puis éditer la migration (backfill)**

Run: `pnpm --filter @splootlabs/db db:generate`

Ouvrir `packages/db/drizzle/0013_*.sql` et le remplacer par (pas de nouvel unique index parent : `game_session_id_tenant_uidx` existe déjà depuis la Tâche 2) :

```sql
ALTER TABLE "answer_record" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "answer_record" ADD CONSTRAINT "answer_record_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "answer_record" ar SET "tenant_id" = gs."tenant_id" FROM "game_session" gs WHERE gs."id" = ar."session_id";--> statement-breakpoint
ALTER TABLE "answer_record" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "answer_record_tenant_idx" ON "answer_record" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "answer_record" ADD CONSTRAINT "answer_record_session_tenant_fk" FOREIGN KEY ("session_id","tenant_id") REFERENCES "public"."game_session"("id","tenant_id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 5 : Câbler l'écriture temps réel (dérivation en 2 temps)**

Dans `packages/db/src/repos/session.ts`, remplacer `recordAnswer` (signature identique) :

```ts
export async function recordAnswer(
  db: Db,
  input: {
    sessionId: string
    questionId: string
    playerId: string
    answer: unknown
    timeMs: number
    isCorrect: boolean
    points: number
  },
): Promise<void> {
  // Pas de scope tenant dans la couche temps réel : on dérive le tenant_id de la session parente.
  const [parent] = await db.select({ tenantId: schema.gameSession.tenantId })
    .from(schema.gameSession).where(eq(schema.gameSession.id, input.sessionId))
  if (!parent) throw new Error(`recordAnswer: session introuvable (${input.sessionId})`)
  await db.insert(schema.answerRecord).values({
    sessionId: input.sessionId, tenantId: parent.tenantId, questionId: input.questionId, playerId: input.playerId,
    answer: input.answer as never, timeMs: input.timeMs, isCorrect: input.isCorrect, points: input.points,
  })
}
```

- [ ] **Step 6 : Ajouter les filtres `tenant_id` sur les joins `answer_record` de `getSessionReport`**

Dans `packages/db/src/repos/reports.ts`, `getSessionReport` :

Sous-requête `questions` — le left join `answerRecord` porte aussi le tenant :
```ts
.leftJoin(
  schema.answerRecord,
  and(
    eq(schema.answerRecord.questionId, schema.question.id),
    eq(schema.answerRecord.sessionId, sessionId),
    eq(schema.answerRecord.tenantId, scope.tenantId),
  ),
)
```

Sous-requête `players` — le left join `answerRecord` :
```ts
.leftJoin(schema.answerRecord, and(
  eq(schema.answerRecord.playerId, schema.sessionPlayer.id),
  eq(schema.answerRecord.tenantId, scope.tenantId),
))
```

- [ ] **Step 7 : Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/db test`
Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (dont les 2 nouveaux tests answer_record ; les agrégats de `getSessionReport` restent identiques).

- [ ] **Step 8 : Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ packages/db/src/repos/session.ts packages/db/src/repos/reports.ts packages/db/src/repos/session.test.ts
git commit -m "feat(db): tenant_id sur answer_record (dérivé de la session, FK composite)"
```

---

## Task 4 : Vérification globale + backfill sur la base dev

**Files:** aucun changement de code attendu (tâche de vérification ; correctif seulement si un test casse).

**Interfaces:** aucune.

- [ ] **Step 1 : Typecheck de tout le monorepo**

Run: `pnpm -r typecheck`
Expected: PASS (aucune régression de types — notamment `$inferInsert` des 3 tables exige désormais `tenantId`, fourni partout).

- [ ] **Step 2 : Suite complète**

Run: `pnpm --filter @splootlabs/db test`
Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (tous les fichiers, y compris `game-e2e`, `sweep-e2e`, `persistent-store`, `routes-*`).

- [ ] **Step 3 : Backfill vérifié sur la base dev `arena-pg`**

Appliquer les migrations à la base dev (le serveur exécute `runMigrations` au boot — `apps/server/src/index.ts:17`). Exporter les vars inline (dotenv non câblé) puis démarrer une fois :

```bash
# adapter le DATABASE_URL à la base dev arena-pg (port 5433) selon le lancement stack dev
export DATABASE_URL="postgres://<user>:<pass>@localhost:5433/<db>"
export AUTH_SECRET="dev-secret-at-least-32-chars-long!!" BASE_URL="http://localhost:3000"
pnpm --filter @splootlabs/server dev
# attendre le log de démarrage (migrations appliquées), puis Ctrl-C
```

Spot-check qu'aucune ligne enfant n'a de `tenant_id` NULL et qu'il colle au parent :

```sql
SELECT 'question' t, count(*) FILTER (WHERE tenant_id IS NULL) AS nulls FROM question
UNION ALL SELECT 'session_player', count(*) FILTER (WHERE tenant_id IS NULL) FROM session_player
UNION ALL SELECT 'answer_record', count(*) FILTER (WHERE tenant_id IS NULL) FROM answer_record;
-- attendu : 0 partout

SELECT count(*) AS incohérences FROM question q JOIN quiz z ON z.id = q.quiz_id WHERE q.tenant_id <> z.tenant_id;
SELECT count(*) FROM session_player sp JOIN game_session gs ON gs.id = sp.session_id WHERE sp.tenant_id <> gs.tenant_id;
SELECT count(*) FROM answer_record ar JOIN game_session gs ON gs.id = ar.session_id WHERE ar.tenant_id <> gs.tenant_id;
-- attendu : 0 partout
```

> Si la base dev est vierge, le backfill est trivialement satisfait (0 ligne) ; la couverture de la logique de jointure du backfill vient alors du test « simulation legacy » de la Tâche 1 (question←quiz). Les jointures backfill de `session_player`/`answer_record` (depuis `game_session`) ne sont pas testées en isolation automatisée — ce spot-check dev les couvre sur données réelles.

- [ ] **Step 4 : Commit (si un correctif a été nécessaire ; sinon rien)**

```bash
git commit -am "test(db): vérification globale multi-tenancy Slice 0" # seulement si des fichiers ont changé
```

---

## Self-Review (auteur du plan)

**Couverture du spec :**
- Colonne `tenant_id` NOT NULL indexée sur les 3 tables → Tâches 1/2/3, Steps 3.
- Backfill dérivé du parent en 3 temps → Steps 4 de chaque tâche + test legacy (T1) + spot-check dev (T4).
- FK composite `(parent_id, tenant_id) → parent(id, tenant_id)` sur les 3 tables → Steps 3/4, tests de rejet.
- Écriture scopée (`question`) / dérivée du parent (`session_player`, `answer_record`) sans changer les signatures temps réel → T1 Step 5, T2 Step 5, T3 Step 5.
- Filtres `tenant_id` directs sur lectures scopées (micro-arbitrage n°1 = oui) → T1 Step 6, T2 Step 6, T3 Step 6.
- Hors scope GUC/RLS/rôle DB (micro-arbitrage n°2) → respecté, aucune tâche n'y touche.
- Critère « aucun changement de comportement fonctionnel » → suites e2e/passerelle inchangées, vérifiées T2/T3 Step 7 et T4 Step 2.

**Scan placeholders :** aucun TBD/TODO ; tout le code (schéma, SQL, repos, tests) est explicite.

**Cohérence des types/noms :** `tenantId` (camelCase Drizzle) / `tenant_id` (SQL) cohérents ; noms de contraintes (`question_quiz_tenant_fk`, `session_player_session_tenant_fk`, `answer_record_session_tenant_fk`) et d'index (`quiz_id_tenant_uidx`, `game_session_id_tenant_uidx`, `*_tenant_idx`) uniques et réutilisés correctement (l'unique index `game_session_id_tenant_uidx` créé en T2 est consommé en T3). Signatures `addSessionPlayer`/`recordAnswer` strictement identiques avant/après.
