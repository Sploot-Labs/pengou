# Slice 1 — RBAC : accès croisé par rôle

> Deuxième sous-projet du chantier **multi-tenancy réelle**.
> Ordre global : Slice 0 (tenant_id enfants, ✅ mergé) → **Slice 1 (RBAC)** →
> Slice 2 (RLS Postgres) → Slice 3 (Workspaces bout-en-bout).

## Contexte (état réel à date, ≠ brief initial)

Le terrain a évolué depuis le cadrage du chantier, via le travail concurrent
`feat/audit-remediation` déjà présent sur `master` :

- **L'ownership est DÉJÀ appliqué.** `TenantScope = { db, tenantId, ownerId? }`. Quand
  `ownerId` est présent (« scope utilisateur »), les repos restreignent quiz/rapports au
  propriétaire (`scope.ownerId ? eq(quiz.ownerId, …) : undefined`, idem `gameSession.hostId`).
  `requestScope` (HTTP) et `host:create` (socket) construisent aujourd'hui
  `tenantScope(db, tenantId, user.id)` → **chaque utilisateur ne voit/gère que SON propre
  contenu**. C'est l'inverse du brief (« tout membre voit tout le tenant ») : la faille P0
  « accès intra-tenant » est fermée, mais par une privatisation totale, sans partage.
- **Le RBAC est toujours à zéro.** `membership.role` (`owner`/`admin`/`member`) n'est lu
  nulle part (vérifié par grep sur `packages/`). Les rôles sont stockés, jamais appliqués.

**Décision de coordination** : on construit **sur `master` tel quel**, en prenant
l'owner-scoping existant comme socle (pas d'attente de `feat/audit-remediation`).

## Objectif

Rendre les rôles réellement appliqués : un `owner`/`admin` accède à **tout le contenu de
son tenant** ; un `member` reste limité au sien. Le rôle **surcharge** l'owner-scoping
existant. Poser aussi le catalogue de capacités qui servira les endpoints d'administration
de Slice 3.

## Décisions actées (brainstorming)

1. **Modèle = accès croisé par rôle** (Option 1). owner/admin = accès **complet**
   (lecture ET écriture/suppression) à tout le contenu du tenant ; member = son contenu seul.
2. **Mécanisme = le rôle décide la présence de `scope.ownerId`** — on réutilise tel quel
   l'owner-scoping des repos, sans les modifier :
   - `owner`/`admin` → `ownerId = undefined` → tout le tenant ;
   - `member` → `ownerId = user.id` → le sien.
3. **Catalogue de capacités** (par capacité, pas seulement par rôle), dans `@splootlabs/shared`.
4. **Mode single = 1 workspace, RBAC uniforme** : aucune branche d'autorisation spéciale ;
   les mêmes règles qu'en multi s'appliquent au workspace unique.
5. **Rôle par défaut à l'inscription** : **1er membre du tenant = `owner`, suivants = `member`**.
6. **Reporté à Slice 3** : le preHandler `requirePermission(cap)` (rien à garder tant que les
   endpoints d'admin/membres n'existent pas) et toute la gestion des membres.

## Design

### 1. Catalogue de capacités — `@splootlabs/shared` (nouveau `authz.ts`)

Package pur (aucune dépendance), source unique de vérité du type `Role` (consommé aussi par
`@splootlabs/db`, qui dépend déjà de `@splootlabs/shared`).

```ts
export type Role = 'owner' | 'admin' | 'member'
export type Capability = 'content:access-all' | 'members:manage' | 'workspace:manage'

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner:  ['content:access-all', 'members:manage', 'workspace:manage'],
  admin:  ['content:access-all', 'members:manage'],
  member: [],
}

export function hasPermission(role: Role, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(cap)
}
```

- `content:access-all` (owner + admin) : voir/modifier/supprimer **tout** le contenu du tenant.
- `members:manage` / `workspace:manage` : **définis maintenant, consommés en Slice 3** (invitations, gestion des membres, renommage/facturation). `owner` a `workspace:manage` en plus d'`admin` — c'est leur seule différence.
- `Role` doit rester aligné avec `roleEnum` de `packages/db/src/schema.ts` (mêmes littéraux). `db` importe `Role` depuis `shared` (ex. signature de `ensureMembership`).

### 2. Résolution du rôle — `@splootlabs/db`

Nouveau helper :
```ts
export async function getMembershipRole(db: Db, userId: string, tenantId: string): Promise<Role | null>
```
Renvoie le rôle du membership `(userId, tenantId)`, ou `null` si absent. `null` est traité
par les appelants comme le rôle **le plus restrictif** (member) — jamais comme un accès élargi.

### 3. Scope role-aware — les deux sites de construction

Le scope dérivé de l'utilisateur authentifié devient role-aware **aux deux endroits** qui le
construisent (aujourd'hui `tenantScope(db, tenantId, user.id)`) :

- `apps/server/src/require-user.ts` → `requestScope` (routes HTTP éditeur/rapports) ;
- `apps/server/src/game-gateway.ts` → `host:create` (socket, ~L668).

Nouvelle logique commune :
```ts
const tenantId = /* résolu comme aujourd'hui (resolveTenantId) */
const role = (await getMembershipRole(db, userId, tenantId)) ?? 'member'
const ownerId = hasPermission(role, 'content:access-all') ? undefined : userId
return tenantScope(db, tenantId, ownerId)
```
Aucune modification des repos : ils savent déjà gérer `ownerId` présent/absent. La création
continue de stamper `ownerId = user.id` (routes) / `hostId = user.id` (socket).

**Sécurité** : le rôle est toujours lu côté serveur pour `(userId authentifié, tenantId
résolu)`. En mode multi, `resolveTenantId` valide déjà l'appartenance avant ; le rôle n'est
jamais dérivé d'une entrée client.

### 4. Rôle par défaut à l'inscription — `@splootlabs/auth` (+ helper db)

Le hook `databaseHooks.user.create.after` (`packages/auth/src/auth.ts`) crée aujourd'hui, en
mode single, un membership `owner` pour tout le monde. Nouvelle règle : **1er membre du tenant
= `owner`, suivants = `member`**.

Implémentation : `ensureMembership` (ou un helper `firstMembershipRole(db, tenantId)`)
calcule le rôle = `owner` s'il n'existe aucun membership pour ce tenant, sinon `member`.
Petite course possible sur deux tout premiers signups simultanés (self-host) — acceptable ;
l'unicité `(userId, tenantId)` reste garantie par l'index existant.

### 5. Mode single = 1 workspace, uniforme

Aucune branche d'autz spéciale : le workspace par défaut obéit exactement au même mécanisme
que le multi. Conséquence assumée : un self-host frais aura son 1er inscrit `owner` (voit
tout) et les suivants `member` (privés), promouvables ensuite (manuellement / Slice 3).

## Hors scope (Slice 1)

- `requirePermission(cap)` preHandler et endpoints d'administration / gestion des membres → **Slice 3**.
- Toute modification des repos (`quiz.ts`/`reports.ts`) : inutile, le mécanisme passe par `ownerId`.
- RLS / GUC / rôle DB → Slice 2.

## Migration des données existantes

Le changement de défaut de rôle n'affecte que les **nouveaux** signups. Les memberships
existants restent tels quels (tous `owner` aujourd'hui) → sur un déploiement existant, tous
les utilisateurs actuels deviennent « voit tout le tenant » (puisque tous `owner` et que le
rôle est désormais lu). Comportement assumé pour ce stade pré-1.0 ; pas de migration de
données requise. (Une éventuelle rétro-attribution de rôles est du ressort de Slice 3.)

## Tests

- **`hasPermission`** (unitaire, `shared`) : table rôles × capacités complète (owner/admin/member × content:access-all/members:manage/workspace:manage).
- **`getMembershipRole`** (repo, db) : renvoie le bon rôle ; `null` si pas de membership.
- **Accès croisé HTTP** : un `admin` du tenant lit/modifie/supprime le quiz d'un **autre** membre du même tenant ; un `member` ne voit/modifie que le sien (403/404 sur celui d'autrui).
- **Accès croisé socket** : `host:create` d'un `admin` peut démarrer une partie sur le quiz d'un autre membre du tenant ; un `member` ne le peut pas (parité avec HTTP).
- **Isolation cross-tenant préservée** : un `owner`/`admin` ne voit **jamais** le contenu d'un autre tenant (le mécanisme ne touche qu'`ownerId`, jamais le filtre `tenantId`).
- **Défaut de rôle** : 1er signup d'un tenant → `owner` ; 2e → `member`.

## Critères d'acceptation

1. `@splootlabs/shared` expose `Role`, `Capability`, `ROLE_CAPABILITIES`, `hasPermission`.
2. `getMembershipRole` disponible dans `@splootlabs/db`.
3. `requestScope` et `host:create` construisent un `ownerId` fonction du rôle (owner/admin → undefined, member → user.id).
4. Le rôle par défaut à l'inscription est `owner` pour le 1er membre du tenant, `member` ensuite.
5. Aucun repo modifié ; aucune régression fonctionnelle (suites existantes vertes).
6. Isolation cross-tenant intacte ; parité de comportement HTTP ↔ socket.
7. Suite complète verte (`pnpm exec vitest run --fileParallelism=false`), typecheck monorepo clean.
