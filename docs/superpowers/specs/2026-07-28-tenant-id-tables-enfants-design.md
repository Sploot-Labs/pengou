# Slice 0 — `tenant_id` sur les tables enfants

> Premier sous-projet du chantier **multi-tenancy réelle** (workspaces, RBAC, RLS Postgres).
> Découpage global : **Slice 0** (tenant_id enfants) → Slice 1 (RBAC & ownership) →
> Slice 2 (RLS Postgres) → Slice 3 (Workspaces bout-en-bout). Ordre retenu : défense d'abord.

## Contexte

L'isolation multi-tenant du produit est aujourd'hui 100 % applicative : chaque requête
ajoute manuellement `WHERE tenant_id = scope.tenantId`. Trois tables enfants —
`question`, `session_player`, `answer_record` — **n'ont pas de `tenant_id`** et ne sont
scopées que par jointure vers leur parent (`quiz` / `game_session`). C'est identifié comme
le risque de fuite n°1 : une lecture qui oublierait la jointure de scoping n'a aucun filet.

Ce Slice dénormalise `tenant_id` sur ces trois tables. C'est aussi le **prérequis** du RLS
(Slice 2) : une policy `USING (tenant_id = current_setting('app.tenant_id'))` suppose que la
colonne existe déjà et est peuplée sur toutes les lignes, y compris l'existant.

## Objectif

Chaque ligne enfant porte un `tenant_id` **non-null**, correct pour l'existant comme pour
le neuf, avec une **garantie au niveau base** qu'il est cohérent avec le parent. Zéro
régression fonctionnelle. Aucune signature du temps réel (passerelle Socket.IO / moteur)
modifiée.

## Décisions actées (brainstorming)

1. **Source de la valeur = dérivée du parent**, jamais prise d'un input client.
   - `question` : écrit avec un `TenantScope` disponible → `tenantId: scope.tenantId`
     (le quiz parent a déjà été vérifié dans le tenant par `assertQuizInTenant`).
   - `session_player` / `answer_record` : écrits avec un `Db` **nu** (aucun contexte tenant
     dans la couche temps réel) → dérivés du parent via **INSERT … SELECT**.
2. **Pas de trigger.** La cohérence est assurée côté app (INSERT … SELECT) *et* garantie
   côté base par une **FK composite** (voir §Garantie base).
3. **FK composite sur les 3 tables** (choix explicite : défense en profondeur, aligné sur
   l'esprit du chantier).
4. **GUC / `SET LOCAL` / policies RLS / rôle DB dédié = HORS SCOPE** (Slice 2).

## Périmètre

Trois tables, leur parent de rattachement pour le scoping tenant :

| Table enfant     | Parent de scoping | Colonne de liaison |
|------------------|-------------------|--------------------|
| `question`       | `quiz`            | `quiz_id`          |
| `session_player` | `game_session`    | `session_id`       |
| `answer_record`  | `game_session`    | `session_id`       |

`answer_record` référence aussi `question` et `session_player`, mais le parent de **scoping
tenant** retenu est `game_session` (une partie appartient à un tenant, toutes ses réponses
aussi). On ne pose qu'**une** FK composite par table, vers ce parent.

## Design

### 1. Schéma (`packages/db/src/schema.ts`)

Sur chacune des 3 tables :
- `tenantId: uuid('tenant_id').notNull().references(() => tenant.id)`
- un `index` sur `tenant_id` (convention existante : `quiz_tenant_idx`,
  `game_session_tenant_idx`).

### 2. Garantie base — FK composite

Pour que Postgres rejette physiquement toute ligne enfant dont le `tenant_id` ne colle pas
au parent (indépendamment de tout code futur) :

- sur chaque **parent**, un index **unique** `(id, tenant_id)` — requis pour que le couple
  soit référençable par une FK (l'`id` seul est déjà PK, mais une FK doit cibler une
  contrainte/idx unique couvrant exactement les colonnes référencées) ;
- sur chaque **enfant**, une FK `(parent_id, tenant_id) → parent(id, tenant_id)` portant le
  `onDelete: cascade`.

La FK composite couvre déjà l'intégrité référentielle sur `parent_id` : on **consolide**
avec la FK simple `parent_id` existante (une seule FK porte le cascade, pas de doublon).

### 3. Migration (backfill de l'existant)

`drizzle-kit generate` produit l'`ADD COLUMN` mais **pas** le backfill de données. On édite
le SQL généré pour intercaler, par table, une séquence en 3 temps qui ne laisse jamais de
trou NULL :

```sql
-- Exemple pour `question` (idem session_player/answer_record ← game_session)
alter table question add column tenant_id uuid references tenant(id);          -- 1. nullable
update question q set tenant_id = z.tenant_id from quiz z where z.id = q.quiz_id; -- 2. backfill dérivé du parent
alter table question alter column tenant_id set not null;                       -- 3. verrou NOT NULL

-- puis, par table :
create unique index <parent>_id_tenant_uidx on <parent> (id, tenant_id);
create index <enfant>_tenant_idx on <enfant> (tenant_id);
alter table <enfant> add constraint <enfant>_parent_tenant_fk
  foreign key (<parent_id>, tenant_id) references <parent> (id, tenant_id) on delete cascade;
```

**Sûreté du backfill** : les FK vers le parent sont `NOT NULL`, donc chaque ligne enfant a
un parent et le `UPDATE … FROM parent` peuple toujours une valeur → aucun `tenant_id` ne
reste NULL, le `SET NOT NULL` réussit sans échec de contrainte.

### 4. Écritures (`packages/db/src/repos/`)

- **`createQuestion`** (`question.ts`) : ajouter `tenantId: scope.tenantId` aux `.values(…)`.
  Aucun changement de signature.
- **`addSessionPlayer` / `recordAnswer`** (`session.ts`) : passer en **INSERT … SELECT**
  dérivant `tenant_id` du parent `game_session`, dans le même statement (atomique,
  impossible à désynchroniser). En Drizzle 0.45 :

  ```ts
  db.insert(schema.sessionPlayer).select(
    db.select({
      sessionId: sql`${sessionId}`,
      nickname: sql`${input.nickname}`,
      joinToken: sql`${input.joinToken}`,
      tenantId: schema.gameSession.tenantId,
    }).from(schema.gameSession).where(eq(schema.gameSession.id, sessionId)),
  )
  ```

  Les signatures `addSessionPlayer(db, sessionId, …)` / `recordAnswer(db, input)` restent
  identiques : **la passerelle Socket.IO et le moteur ne sont pas touchés**.

  *Fallback* si l'ergonomie `insert().select()` ne tient pas en Drizzle 0.45 (à vérifier à
  l'implémentation) : un `select tenant_id from game_session where id = …` juste avant, puis
  `.values({ tenantId, … })` — 2 allers-retours au lieu d'1, comportement identique.

### 5. Lectures — filtres directs (micro-arbitrage n°1 : **oui**)

Les lectures **scopées** ajoutent un filtre direct `tenant_id = scope.tenantId` sur les
tables enfants qu'elles touchent (ceinture + bretelles, cohérent avec l'objectif « repos qui
filtrent en direct ») :
- `reports.ts` : `getSessionReport` (agrégations sur `answer_record`, `session_player`),
  et jointures enfant de `listSessions`.
- `question.ts` : `listQuestions` / `getQuestion` peuvent filtrer `question.tenant_id`
  en plus de la garde `assertQuizInTenant` existante.

Les lectures **sans scope** de la couche temps réel (`listSessionPlayers`,
`listSessionPlayersByScore`, `loadEngineState`, `recordAnswer` interne, etc.) restent
**inchangées** : elles sont clés par un UUID de session non devinable et n'ont pas de scope
tenant à disposition. Leur défense de fond viendra du RLS (Slice 2).

### 6. Hors scope explicite (micro-arbitrage n°2 : **hors Slice 0**)

- Aucun `SET LOCAL app.tenant_id` / GUC de connexion.
- Aucune `CREATE POLICY` / activation de RLS.
- Aucun rôle Postgres applicatif dédié.

Tout cela est le cœur de Slice 2. Slice 0 se limite à installer et fiabiliser la colonne.

## Tests (TDD — testcontainers + vitest, déjà en place)

- **Backfill** : après migration sur un jeu de données seedé (quiz + questions, session +
  players + answers), chaque ligne enfant porte le `tenant_id` de son parent.
- **Écriture scopée** : `createQuestion` pose `scope.tenantId`.
- **Écriture temps réel** : `addSessionPlayer` / `recordAnswer` posent le `tenant_id` du
  `game_session` parent, sans changement d'appelant.
- **Garantie base** : une insertion enfant forcée avec un `tenant_id` ≠ parent est
  **rejetée** par la FK composite (erreur de contrainte).
- **NOT NULL** : impossible d'insérer une ligne enfant sans `tenant_id` résoluble.

## Critères d'acceptation

1. Les 3 tables enfants ont une colonne `tenant_id` `NOT NULL` indexée.
2. La migration backfill peuple 100 % des lignes existantes sans échec de `SET NOT NULL`.
3. Une FK composite par table empêche toute incohérence tenant enfant↔parent au niveau base.
4. Les nouvelles écritures dérivent `tenant_id` du parent ; aucune signature du temps réel
   modifiée.
5. Les lectures scopées filtrent `tenant_id` en direct sur les tables enfants.
6. `pnpm --filter @splootlabs/db test` vert ; aucun changement de comportement fonctionnel.

## Notes de séquencement

Slice 0 est volontairement placé **avant** le RLS : la colonne doit exister et être
backfillée pour que les policies puissent la référencer, et le backfill de l'existant est de
toute façon une dérivation depuis le parent qu'aucune connexion GUC ne fera. Pour
`session_player` / `answer_record`, la dérivation depuis le parent n'est pas un pansement en
attendant le RLS : la couche temps réel n'ayant jamais de scope tenant HTTP, c'est le
mécanisme **permanent** de peuplement de leur `tenant_id`.
