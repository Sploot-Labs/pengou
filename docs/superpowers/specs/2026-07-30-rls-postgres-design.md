# Slice 2 — RLS Postgres

> Troisième sous-projet du chantier **multi-tenancy réelle**.
> Ordre global : Slice 0 (tenant_id enfants, ✅) → Slice 1 (RBAC accès croisé, ✅) →
> **Slice 2 (RLS Postgres)** → Slice 3 (Workspaces bout-en-bout).

## Contexte

Après Slices 0 et 1, l'isolation tenant tient par le **filtrage applicatif** : `tenant_id` sur
toutes les tables (Slice 0) + `WHERE tenant_id = scope.tenantId` dans les repos + owner-scoping
role-aware (Slice 1). Il n'y a **aucun filet base** : un seul pool, un seul rôle
(`DATABASE_URL`, superuser/propriétaire), zéro `SET LOCAL`/GUC, zéro policy. L'isolation ne
tient donc que par la discipline applicative — c'est le blocage P0 « accès intra-tenant » de
l'audit.

Slice 2 ajoute le **Row-Level Security Postgres** comme **défense en profondeur** SOUS le
filtrage applicatif (qui reste inchangé).

## Décisions actées (brainstorming)

1. **RLS complet maintenant** : voies HTTP **et** temps réel.
2. **Fail-loud** : policies en `current_setting('app.tenant_id')` strict → une requête app sur
   une table tenant **sans** contexte lève une erreur (tripwire, pas un silence).
3. **Ceinture + bretelles** : le filtrage tenant applicatif des repos **reste** ; le RLS
   s'ajoute dessous. Aucun repo modifié. Le owner-scoping de Slice 1 reste (le RLS-par-tenant
   ne l'exprime pas).
4. **Modèle de rôles C — 2 rôles, 1 URL** :
   - `systemDb` (rôle privilégié = `DATABASE_URL`, propriétaire des tables) : migrations,
     bypass RLS, ops cross-tenant (boot, sweep), future connexion plateforme.
   - `appDb` (rôle `app_role` auto-provisionné, `NOSUPERUSER NOBYPASSRLS`, GRANTs DML) :
     requêtes/sockets scopées, soumis au RLS, GUC par transaction. Override `APP_DATABASE_URL`.
5. **Transaction + `SET LOCAL`** pour poser le GUC (pas de connexion réservée → zéro fuite de
   GUC entre requêtes du pool).
6. **RLS sur les tables de contenu uniquement** (`quiz`, `question`, `game_session`,
   `session_player`, `answer_record`). `tenant`/`membership` : accès via `systemDb`
   (résolution pré-contexte), RLS repoussé à Slice 3. Tables Better Auth (globales) : jamais de RLS.

## Design

### 1. Couche connexion — deux handles (`packages/db`)

`createDb` reste (usage `systemDb`). Nouveau constructeur pour l'app role :

```ts
// client.ts
export type Db = PostgresJsDatabase<typeof schema>
export function createDb(databaseUrl: string): { db: Db; client: Sql }         // systemDb (existant)
export function createAppDb(databaseUrl: string): { db: Db; client: Sql }       // appDb (identique, nom explicite)
```

`appDb` et `systemDb` partagent le même schéma Drizzle ; seule diffère la chaîne (rôle).

### 2. Provisioning du rôle app — au boot, idempotent (`packages/db`)

```ts
// role-provisioning.ts (nouveau)
export async function ensureAppRole(systemClient: Sql, opts: { role: string; password: string }): Promise<void>
```
Exécuté par `systemDb` au boot AVANT de créer `appDb` :
- `CREATE ROLE app_role LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS` (si absent).
- Les GRANTs DML sont posés par **migration** (voir §5) — le rôle doit exister d'abord.
Password : `config.appDbPassword` (env `APP_DB_PASSWORD`, défaut dev documenté).
La chaîne `appDb` est dérivée de `DATABASE_URL` (mêmes host/port/db) en substituant
user=`app_role`/password, sauf si `APP_DATABASE_URL` est fourni explicitement.

### 3. Pose du contexte tenant — `withTenantTx` (`packages/db`)

```ts
// tenant.ts
export async function withTenantTx<T>(
  appDb: Db,
  ctx: { tenantId: string; ownerId?: string },
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`) // is_local = true
    return fn({ db: tx, tenantId: ctx.tenantId, ownerId: ctx.ownerId })
  })
}
```
`set_config(..., true)` = `SET LOCAL` (scopé transaction). `scope.db` devient la transaction ;
**les repos sont inchangés**.

### 4. Câblage des voies scopées

- **HTTP** (`apps/server`) : `requestScope` résout `tenantId`+`ownerId`+role comme aujourd'hui
  (via `systemDb` pour la résolution membership, voir §6), puis le **handler enveloppe son
  travail DB** dans `withTenantTx(appDb, { tenantId, ownerId }, async (scope) => { … })`. La
  garde 403 (membership) reste **avant** l'ouverture de la transaction.
- **Temps réel** (`game-gateway`) : chaque opération scopée (host:create, addSessionPlayer,
  recordAnswer, listSessionPlayers du flux live, etc.) passe par `withTenantTx(appDb, …)` — le
  `tenantId` est déjà connu (`sessionMeta.tenantId`, ou dérivé de la session à host:create).
- **Ops cross-tenant** (boot rehydration, `abandonInactiveSessions`/`abandonStaleSessions`,
  résolution membership) : sur **`systemDb`** (bypass, pas de GUC).

### 5. Migrations (sur `systemDb`)

Nouvelle migration :
```sql
-- pour chaque table de contenu :
ALTER TABLE quiz ENABLE ROW LEVEL SECURITY;
CREATE POLICY quiz_tenant_isolation ON quiz
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
-- + GRANT SELECT, INSERT, UPDATE, DELETE ON quiz TO app_role;
-- (idem question, game_session, session_player, answer_record)
GRANT USAGE ON SCHEMA public TO app_role;
```
- `USING` (lecture) **et** `WITH CHECK` (écriture) → un INSERT/UPDATE ne peut poser un
  `tenant_id` ≠ contexte. `current_setting` strict = fail-loud.
- Le propriétaire des tables (`systemDb`) **n'a PAS** `FORCE ROW LEVEL SECURITY` → il bypasse
  (voulu, pour les ops système).

### 6. Résolution membership via `systemDb`

`resolveTenantId`, `getMembershipRole`, `ensureMembership`, `ensureDefaultTenant`,
`firstMembershipRole`, `scopeForUser` interrogent `membership`/`tenant` **avant** tout contexte
tenant → ils reçoivent/utilisent `systemDb`. `requestScope`/`host:create` reçoivent donc **deux**
handles : `systemDb` (résolution) + `appDb` (travail scopé via `withTenantTx`).

### 7. Bootstrap serveur (`apps/server/src/index.ts`)

```
systemDb ← createDb(DATABASE_URL)
await ensureAppRole(systemClient, { role, password })
if (migrateOnBoot) await runMigrations(systemDb)      // migrations + policies + GRANTs
appDb ← createAppDb(APP_DATABASE_URL ?? derived)
// requestScope/gateway reçoivent { systemDb, appDb }
// boot rehydration + sweep utilisent systemDb
```

## Hors scope (Slice 2)

- RLS sur `tenant`/`membership` → Slice 3 (avec la gestion des membres).
- Connexion « plateforme manager » exposée en tant que fonctionnalité (dashboard) → future ;
  seule la **capacité** (systemDb bypass) existe, utilisée par boot/sweep.
- Lock de migration multi-instance → hors scope ici (mono-instance ; `MIGRATE_ON_BOOT=false`
  + étape dédiée existent déjà pour le multi-instance).
- Retrait des `WHERE tenant_id` des repos → non (ceinture+bretelles).

## Tests

`startTestDb` étendu pour fournir **deux handles** : `systemDb` (superuser du conteneur) +
`appDb` (connecté comme `app_role` provisionné dans le conteneur, RLS actif). Migrations +
provisioning joués dans le harness.

- **Fail-loud** : une requête `appDb` sur `quiz`/`question`/… **sans** `withTenantTx` (GUC absent) → **erreur**.
- **Isolation lecture** : `appDb` dans le contexte tenant A ne voit que les lignes de A ; jamais celles de B (sur les 5 tables de contenu).
- **Isolation écriture** (`WITH CHECK`) : un INSERT/UPDATE tentant un `tenant_id` ≠ contexte est **rejeté**.
- **systemDb bypass** : `systemDb` voit toutes les lignes tous tenants (boot/sweep OK).
- **Provisioning idempotent** : `ensureAppRole` rejouable sans erreur ; `app_role` bien `NOSUPERUSER NOBYPASSRLS`.
- **Parité voies** : un scénario HTTP et un scénario socket écrivent/lisent correctement sous RLS (le GUC est bien posé sur les deux voies).
- **Cross-tenant boot/sweep** : la réhydratation et le balayage (systemDb) fonctionnent sur plusieurs tenants.
- **Non-régression** : suites existantes vertes (le filtrage applicatif inchangé + RLS transparent quand le contexte est correctement posé).

## Critères d'acceptation

1. Deux rôles : `systemDb` (privilégié) + `appDb` (`app_role` NOBYPASSRLS), le second auto-provisionné depuis une seule `DATABASE_URL` (override `APP_DATABASE_URL`).
2. RLS actif (USING + WITH CHECK) sur les 5 tables de contenu ; fail-loud sur GUC absent.
3. Toutes les voies scopées (HTTP + temps réel) posent `app.tenant_id` via `withTenantTx` sur `appDb` ; les ops cross-tenant utilisent `systemDb`.
4. Repos inchangés ; filtrage applicatif + owner-scoping intacts.
5. `appDb` ne peut PAS voir/écrire hors de son tenant ; `systemDb` voit tout.
6. Suite complète verte (`pnpm exec vitest run --fileParallelism=false`), typecheck monorepo clean (build avant typecheck).

## Risques / notes

- **Chevauchement `feat/audit-remediation`** : `client.ts`, `index.ts`, la couche connexion sont
  touchés par le travail concurrent → risque de conflit au merge. Travailler sur la branche
  `feat/mt-slice2-rls`, résoudre au merge.
- **Pool** : deux pools (systemDb + appDb) → surveiller `max` (baisser si besoin, ex. 10 + 10).
- **`withTenantTx` = transaction par opération** : léger surcoût (BEGIN/COMMIT) ; acceptable,
  et `SET LOCAL` garantit zéro fuite de GUC (vs connexion réservée).
