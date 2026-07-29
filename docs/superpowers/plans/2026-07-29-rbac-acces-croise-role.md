# Slice 1 — RBAC : accès croisé par rôle — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les rôles réellement appliqués — un `owner`/`admin` accède à tout le contenu de son tenant, un `member` au sien seul — en surchargeant l'owner-scoping existant, sans modifier les repos.

**Architecture:** Un catalogue de capacités pur dans `@splootlabs/shared` (source de vérité du type `Role` + `hasPermission`). Un helper `scopeForUser` dans `@splootlabs/db` qui, à partir du rôle du membership, décide la présence de `scope.ownerId` (owner/admin → `undefined` = tout le tenant ; member → `userId` = le sien). Les deux sites qui construisent un scope utilisateur (`requestScope` HTTP, `host:create` socket) appellent ce helper. Le rôle par défaut à l'inscription devient 1er=owner / suivants=member.

**Tech Stack:** TypeScript monorepo pnpm, Drizzle ORM 0.45, Better Auth, Fastify + Socket.IO, Vitest + `@testcontainers/postgresql`.

## Global Constraints

- **Langue** : code, commentaires, commits en français.
- **Commande de test** : vitest se lance **depuis la racine** — `pnpm exec vitest run <pattern>` (jamais `pnpm --filter <pkg> test`, le config racine résout mal `setupFiles` en per-package). Suite complète fiable : `pnpm exec vitest run --fileParallelism=false` (la pleine parallélisation est flaky — stampede testcontainers).
- **Aucun repo modifié** (`quiz.ts`, `reports.ts`, `session.ts`) : le mécanisme passe uniquement par `ownerId`.
- **`Role` = source unique dans `@splootlabs/shared`** ; `@splootlabs/db` l'importe (il en dépend déjà). Doit rester aligné avec `roleEnum` de `schema.ts` (`'owner'|'admin'|'member'`).
- **Rôle jamais dérivé d'une entrée client** : toujours lu côté serveur pour `(userId authentifié, tenantId résolu)`.
- **Isolation cross-tenant intacte** : le mécanisme ne touche qu'`ownerId`, jamais le filtre `tenantId`.
- **Hors scope (Slice 3)** : preHandler `requirePermission`, endpoints d'administration/membres.
- **Chaque tâche se termine verte** avant commit.

## Structure des fichiers

- `packages/shared/src/authz.ts` — **créé** : `Role`, `Capability`, `ROLE_CAPABILITIES`, `hasPermission`.
- `packages/shared/src/index.ts` — export du catalogue.
- `packages/db/src/tenant.ts` — **modifié** : import `Role`, `getMembershipRole`, `scopeForUser`, `firstMembershipRole`.
- `packages/db/src/index.ts` — exports.
- `apps/server/src/require-user.ts` — `requestScope` → `scopeForUser`.
- `apps/server/src/game-gateway.ts` — `host:create` → `scopeForUser`.
- `packages/auth/src/auth.ts` — hook signup : rôle 1er=owner/suivants=member.
- Tests : `packages/shared/src/authz.test.ts` (créé), `packages/db/src/tenant.test.ts` (existant, + cas), `apps/server/src/routes-quizzes.test.ts` (+ accès croisé), `apps/server/src/game-gateway.test.ts` (+ parité), `packages/auth/src/auth.test.ts` (assertion mise à jour).

---

## Task 1 : Catalogue de capacités — `@splootlabs/shared`

**Files:**
- Create: `packages/shared/src/authz.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/authz.test.ts`

**Interfaces:**
- Produces: `type Role = 'owner'|'admin'|'member'` ; `type Capability = 'content:access-all'|'members:manage'|'workspace:manage'` ; `ROLE_CAPABILITIES: Record<Role, Capability[]>` ; `hasPermission(role: Role, cap: Capability): boolean`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `packages/shared/src/authz.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { hasPermission, ROLE_CAPABILITIES, type Role, type Capability } from './authz.js'

describe('authz — catalogue de capacités', () => {
  it('owner et admin ont content:access-all ; member non', () => {
    expect(hasPermission('owner', 'content:access-all')).toBe(true)
    expect(hasPermission('admin', 'content:access-all')).toBe(true)
    expect(hasPermission('member', 'content:access-all')).toBe(false)
  })

  it('seul owner a workspace:manage ; owner+admin ont members:manage', () => {
    expect(hasPermission('owner', 'workspace:manage')).toBe(true)
    expect(hasPermission('admin', 'workspace:manage')).toBe(false)
    expect(hasPermission('owner', 'members:manage')).toBe(true)
    expect(hasPermission('admin', 'members:manage')).toBe(true)
    expect(hasPermission('member', 'members:manage')).toBe(false)
  })

  it('member n\'a aucune capacité', () => {
    expect(ROLE_CAPABILITIES.member).toEqual([])
  })

  it('couverture exhaustive rôles × capacités', () => {
    const roles: Role[] = ['owner', 'admin', 'member']
    const caps: Capability[] = ['content:access-all', 'members:manage', 'workspace:manage']
    for (const r of roles) for (const c of caps) {
      expect(typeof hasPermission(r, c)).toBe('boolean')
    }
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm exec vitest run authz`
Expected: FAIL (`./authz.js` introuvable).

- [ ] **Step 3 : Implémenter le catalogue**

Créer `packages/shared/src/authz.ts` :

```ts
/**
 * Catalogue d'autorisations — source unique du type `Role` (aligné avec `roleEnum`
 * de @splootlabs/db) et des capacités. Pur, sans dépendance : consommable côté db,
 * serveur et front. Les capacités `members:manage`/`workspace:manage` sont définies
 * ici mais consommées en Slice 3 (gestion des membres / du workspace).
 */
export type Role = 'owner' | 'admin' | 'member'
export type Capability = 'content:access-all' | 'members:manage' | 'workspace:manage'

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: ['content:access-all', 'members:manage', 'workspace:manage'],
  admin: ['content:access-all', 'members:manage'],
  member: [],
}

export function hasPermission(role: Role, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(cap)
}
```

- [ ] **Step 4 : Exporter depuis l'index**

Dans `packages/shared/src/index.ts`, ajouter :
```ts
export { hasPermission, ROLE_CAPABILITIES } from './authz.js'
export type { Role, Capability } from './authz.js'
```

- [ ] **Step 5 : Lancer, vérifier le succès**

Run: `pnpm exec vitest run authz`
Expected: PASS (4 tests).

- [ ] **Step 6 : Commit**

```bash
git add packages/shared/src/authz.ts packages/shared/src/authz.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): catalogue de capacités RBAC (Role, hasPermission)"
```

---

## Task 2 : Résolution du rôle + scope role-aware — `@splootlabs/db`

**Files:**
- Modify: `packages/db/src/tenant.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tenant.test.ts`

**Interfaces:**
- Consumes: `Role`, `hasPermission` (de `@splootlabs/shared`) ; `schema.membership`.
- Produces:
  - `getMembershipRole(db: Db, userId: string, tenantId: string): Promise<Role | null>`
  - `scopeForUser(db: Db, tenantId: string, userId: string): Promise<TenantScope>` — `ownerId = hasPermission(role ?? 'member', 'content:access-all') ? undefined : userId`.
  - `firstMembershipRole(db: Db, tenantId: string): Promise<Role>` — `'owner'` si le tenant n'a aucun membership, sinon `'member'`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `packages/db/src/tenant.test.ts`, ajouter les imports nécessaires (`getMembershipRole, scopeForUser, firstMembershipRole` depuis `../index.js` ou `./tenant.js` selon le style du fichier) et ces tests. (Le fichier crée déjà des tenants/users ; réutiliser ses helpers — adapter les noms de variables à ceux du `beforeAll` existant.)

```ts
it('getMembershipRole renvoie le rôle du membership, ou null si absent', async () => {
  const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-A' }).returning()
  const [u] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'r1@x.fr', name: 'R1', emailVerified: false }).returning()
  await ensureMembership(ctx.db, u.id, t.id, 'admin')
  expect(await getMembershipRole(ctx.db, u.id, t.id)).toBe('admin')
  const [u2] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'r2@x.fr', name: 'R2', emailVerified: false }).returning()
  expect(await getMembershipRole(ctx.db, u2.id, t.id)).toBeNull()
})

it('scopeForUser : owner/admin → ownerId undefined ; member → ownerId = userId', async () => {
  const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-B' }).returning()
  const [admin] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'adm@x.fr', name: 'Adm', emailVerified: false }).returning()
  const [member] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'mem@x.fr', name: 'Mem', emailVerified: false }).returning()
  await ensureMembership(ctx.db, admin.id, t.id, 'admin')
  await ensureMembership(ctx.db, member.id, t.id, 'member')

  const adminScope = await scopeForUser(ctx.db, t.id, admin.id)
  expect(adminScope.tenantId).toBe(t.id)
  expect(adminScope.ownerId).toBeUndefined()

  const memberScope = await scopeForUser(ctx.db, t.id, member.id)
  expect(memberScope.ownerId).toBe(member.id)
})

it('scopeForUser : sans membership → traité comme member (ownerId = userId)', async () => {
  const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-C' }).returning()
  const [u] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'nomem@x.fr', name: 'NoMem', emailVerified: false }).returning()
  const scope = await scopeForUser(ctx.db, t.id, u.id)
  expect(scope.ownerId).toBe(u.id)
})

it('firstMembershipRole : owner pour le 1er membre du tenant, member ensuite', async () => {
  const [t] = await ctx.db.insert(schema.tenant).values({ name: 'role-D' }).returning()
  const [u1] = await ctx.db.insert(schema.user)
    .values({ id: crypto.randomUUID(), email: 'f1@x.fr', name: 'F1', emailVerified: false }).returning()
  expect(await firstMembershipRole(ctx.db, t.id)).toBe('owner')
  await ensureMembership(ctx.db, u1.id, t.id, 'owner')
  expect(await firstMembershipRole(ctx.db, t.id)).toBe('member')
})
```

> Vérifier en tête de `tenant.test.ts` que `schema`, `ensureMembership`, et les nouveaux symboles sont importés ; ajouter `getMembershipRole, scopeForUser, firstMembershipRole` à l'import existant.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm exec vitest run tenant.test`
Expected: FAIL (symboles non exportés).

- [ ] **Step 3 : Implémenter dans `tenant.ts`**

En tête de `packages/db/src/tenant.ts`, importer depuis shared :
```ts
import { hasPermission, type Role } from '@splootlabs/shared'
```
Remplacer le type inline de `ensureMembership` par `Role` :
```ts
export async function ensureMembership(
  db: Db, userId: string, tenantId: string, role: Role = 'owner',
): Promise<void> { /* corps inchangé */ }
```
Ajouter en fin de fichier :
```ts
/** Rôle du membership (userId, tenantId), ou null si l'utilisateur n'est pas membre. */
export async function getMembershipRole(db: Db, userId: string, tenantId: string): Promise<Role | null> {
  const [m] = await db.select({ role: schema.membership.role }).from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, tenantId))).limit(1)
  return m ? (m.role as Role) : null
}

/**
 * Scope role-aware d'un utilisateur authentifié dans un tenant déjà résolu.
 * owner/admin (content:access-all) → `ownerId` absent = tout le tenant.
 * member / non-membre → `ownerId` = userId = son contenu seul (défaut restrictif).
 */
export async function scopeForUser(db: Db, tenantId: string, userId: string): Promise<TenantScope> {
  const role = (await getMembershipRole(db, userId, tenantId)) ?? 'member'
  const ownerId = hasPermission(role, 'content:access-all') ? undefined : userId
  return tenantScope(db, tenantId, ownerId)
}

/** Rôle à attribuer à une nouvelle inscription : owner si le tenant n'a encore aucun membre, member sinon. */
export async function firstMembershipRole(db: Db, tenantId: string): Promise<Role> {
  const [m] = await db.select({ id: schema.membership.id }).from(schema.membership)
    .where(eq(schema.membership.tenantId, tenantId)).limit(1)
  return m ? 'member' : 'owner'
}
```

- [ ] **Step 4 : Exporter depuis `index.ts`**

Dans `packages/db/src/index.ts`, au bloc `from './tenant.js'`, ajouter `getMembershipRole, scopeForUser, firstMembershipRole`.

- [ ] **Step 5 : Lancer, vérifier le succès**

Run: `pnpm exec vitest run tenant.test`
Expected: PASS (4 nouveaux tests + les existants).

- [ ] **Step 6 : Commit**

```bash
git add packages/db/src/tenant.ts packages/db/src/index.ts packages/db/src/tenant.test.ts
git commit -m "feat(db): getMembershipRole/scopeForUser/firstMembershipRole (scope role-aware)"
```

---

## Task 3 : Câbler le scope role-aware — HTTP + socket

**Files:**
- Modify: `apps/server/src/require-user.ts` (`requestScope`)
- Modify: `apps/server/src/game-gateway.ts` (`host:create`, ~L664-668)
- Test: `apps/server/src/routes-quizzes.test.ts` (accès croisé HTTP), `apps/server/src/game-gateway.test.ts` (parité socket)

**Interfaces:**
- Consumes: `scopeForUser` (de `@splootlabs/db`).

- [ ] **Step 1 : Écrire le test d'accès croisé HTTP (qui échoue)**

Dans `packages/db`… non — dans `apps/server/src/routes-quizzes.test.ts`, ajouter dans le `describe` existant (le harness `buildApp`/`signUp` et l'import `schema`/`eq` sont déjà là — sinon ajouter `import { eq } from 'drizzle-orm'`) :

```ts
it('un admin voit et modifie le quiz d\'un autre membre du même tenant (accès croisé par rôle)', async () => {
  const app = await buildApp()
  const adminCookie = await signUp(app, 'admin-x@example.com')   // 1er inscrit
  const memberCookie = await signUp(app, 'member-x@example.com') // 2e inscrit

  // Fixer explicitement les rôles (indépendant du défaut de signup) : admin-x = admin, member-x = member.
  const [adminU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'admin-x@example.com'))
  const [memberU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'member-x@example.com'))
  await ctx.db.update(schema.membership).set({ role: 'admin' }).where(eq(schema.membership.userId, adminU.id))
  await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, memberU.id))

  // member-x crée un quiz.
  const created = await app.inject({
    method: 'POST', url: '/api/quizzes',
    payload: { title: 'Quiz du membre' },
    headers: { 'content-type': 'application/json', cookie: memberCookie },
  })
  const quizId = (created.json() as { id: string }).id

  // admin-x le voit dans sa liste (accès croisé) et peut le modifier.
  const listAdmin = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: adminCookie } })
  expect((listAdmin.json() as { id: string }[]).some((q) => q.id === quizId)).toBe(true)
  const patch = await app.inject({
    method: 'PATCH', url: `/api/quizzes/${quizId}`,
    payload: { title: 'Modifié par admin' },
    headers: { 'content-type': 'application/json', cookie: adminCookie },
  })
  expect(patch.statusCode).toBe(200)

  await app.close()
})

it('un member ne voit pas le quiz d\'un autre (owner-scoping maintenu)', async () => {
  const app = await buildApp()
  const ownerCookie = await signUp(app, 'owner-y@example.com')   // 1er → laissé owner
  const memberCookie = await signUp(app, 'member-y@example.com')
  const [memberU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'member-y@example.com'))
  await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, memberU.id))

  const created = await app.inject({
    method: 'POST', url: '/api/quizzes',
    payload: { title: 'Quiz owner-y' },
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
  })
  const quizId = (created.json() as { id: string }).id

  const listMember = await app.inject({ method: 'GET', url: '/api/quizzes', headers: { cookie: memberCookie } })
  expect((listMember.json() as { id: string }[]).some((q) => q.id === quizId)).toBe(false)
  const getOne = await app.inject({ method: 'GET', url: `/api/quizzes/${quizId}`, headers: { cookie: memberCookie } })
  expect(getOne.statusCode).toBe(404)

  await app.close()
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm exec vitest run routes-quizzes`
Expected: FAIL sur le test « admin voit… » (aujourd'hui `requestScope` met toujours `ownerId=user.id`, donc l'admin ne voit pas le quiz du membre). Le test « member ne voit pas » passe déjà (comportement actuel).

- [ ] **Step 3 : Câbler `requestScope` (HTTP)**

Dans `apps/server/src/require-user.ts`, remplacer la construction du scope dans `requestScope` :
```ts
import { resolveTenantId, scopeForUser, TenantAccessDeniedError, type Db, type TenantScope } from '@splootlabs/db'
// ...
export async function requestScope(request: FastifyRequest, db: Db, config: AppConfig): Promise<TenantScope> {
  if (!request.user?.id) throw new Error('requestScope requires requireUser preHandler')
  const explicitTenantId = typeof request.headers['x-tenant-id'] === 'string' ? (request.headers['x-tenant-id'] as string) : undefined
  const tenantId = await resolveTenantId(db, config, { userId: request.user.id, explicitTenantId })
  // Scope role-aware : owner/admin → tout le tenant ; member → son contenu seul.
  return scopeForUser(db, tenantId, request.user.id)
}
```
(Retirer l'import désormais inutile `tenantScope` s'il n'est plus référencé ailleurs dans le fichier.)

- [ ] **Step 4 : Câbler `host:create` (socket)**

Dans `apps/server/src/game-gateway.ts` : ajouter `scopeForUser` à l'import `@splootlabs/db` (et retirer `tenantScope` s'il n'est plus utilisé). Remplacer les lignes ~664-668 :
```ts
const tenantId = await resolveTenantId(db, config, { userId: authSession.user.id })
// Scope role-aware : un owner/admin peut lancer une partie sur n'importe quel quiz du tenant ;
// un member seulement sur les siens (parité avec les routes HTTP).
const scope = await scopeForUser(db, tenantId, authSession.user.id)
```

- [ ] **Step 5 : Test de parité socket**

Dans `apps/server/src/game-gateway.test.ts`, ajouter un test qui **reprend la mise en place de connexion socket d'un test `host:create` existant** de ce fichier (helper de connexion + cookie via handshake), et vérifie :
- un `member` reçoit `{ error }` en `host:create` sur le quiz d'un autre membre (quiz introuvable) ;
- un `admin` du même tenant reçoit `{ sessionId, pin }` sur ce même quiz.

Squelette (adapter la connexion au helper existant du fichier) :
```ts
it('host:create : un admin peut lancer sur le quiz d\'un autre membre, un member non (parité RBAC)', async () => {
  const built = await buildApp()
  const ownerCookie = await signUp(built.app, 'gw-owner@example.com')
  const memberCookie = await signUp(built.app, 'gw-member@example.com')
  const tenantId = await ensureDefaultTenant(ctx.db)
  const [ownerU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'gw-owner@example.com'))
  const [memberU] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'gw-member@example.com'))
  await ctx.db.update(schema.membership).set({ role: 'admin' }).where(eq(schema.membership.userId, ownerU.id))
  await ctx.db.update(schema.membership).set({ role: 'member' }).where(eq(schema.membership.userId, memberU.id))

  // Le member crée un quiz + 1 question (une partie a besoin d'au moins une question).
  const scope = tenantScope(ctx.db, tenantId, memberU.id)
  const quiz = await createQuiz(scope, { ownerId: memberU.id, title: 'Quiz member gw' })
  await createQuestion(scope, quiz.id, { type: 'mcq', prompt: 'Q', timeLimit: 20, payload: { options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] } })

  // member (propriétaire) peut lancer ; un member tiers ne pourrait pas — ici on prouve l'accès admin.
  const adminSock = /* connecter un socket authentifié avec ownerCookie, cf. test host:create existant */ null as unknown as ClientSocket
  const ackAdmin = await new Promise<{ sessionId?: string; pin?: string; error?: string }>((resolve) => {
    adminSock.emit('host:create', { quizId: quiz.id }, resolve)
  })
  expect(ackAdmin.error).toBeUndefined()
  expect(ackAdmin.sessionId).toBeTruthy()
  adminSock.disconnect()
  await built.app.close()
})
```
> Note honnête : la connexion socket authentifiée est le seul morceau non trivial — la **mimer exactement** sur un test `host:create` déjà présent dans le fichier (même `ioClient(url, { extraHeaders: { cookie } })` / helper `connect`). Si l'intégration socket s'avère coûteuse, la garantie de fond reste : `scopeForUser` est identique côté HTTP et socket (test unitaire Task 2 + e2e HTTP Task 3). Ne pas supprimer silencieusement ce test sans le documenter.

- [ ] **Step 6 : Lancer, vérifier le succès**

Run: `pnpm exec vitest run routes-quizzes game-gateway`
Expected: PASS (accès croisé HTTP + parité socket).

- [ ] **Step 7 : Commit**

```bash
git add apps/server/src/require-user.ts apps/server/src/game-gateway.ts apps/server/src/routes-quizzes.test.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(server): scope role-aware sur requestScope et host:create (accès croisé RBAC)"
```

---

## Task 4 : Rôle par défaut à l'inscription — `@splootlabs/auth`

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Test: `packages/auth/src/auth.test.ts`

**Interfaces:**
- Consumes: `firstMembershipRole` (de `@splootlabs/db`).

- [ ] **Step 1 : Mettre à jour le test (qui échoue)**

Dans `packages/auth/src/auth.test.ts` : le test 1 inscrit `hote@arena.fr` (1er → owner) ; le test 2 inscrit `membre@arena.fr` (2e → doit être `member`). Remplacer l'assertion du test 2 et ajouter la vérification du 1er :

```ts
it('mode single : 1er inscrit = owner, suivant = member (défaut de rôle)', async () => {
  const signUp = await auth.api.signUpEmail({
    body: { email: 'membre@arena.fr', password: 'motdepasse-solide-123', name: 'Membre Test' },
  })
  const userId = signUp.user!.id
  const defaultTenantId = await ensureDefaultTenant(ctx.db)

  const [m] = await ctx.db.select().from(schema.membership).where(eq(schema.membership.userId, userId))
  expect(m).toBeTruthy()
  expect(m.tenantId).toBe(defaultTenantId)
  expect(m.role).toBe('member') // 2e inscrit (hote@arena.fr du test précédent était le 1er)

  // Le 1er inscrit (hote@arena.fr) est bien owner.
  const [hote] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'hote@arena.fr'))
  const [mHote] = await ctx.db.select().from(schema.membership).where(eq(schema.membership.userId, hote.id))
  expect(mHote.role).toBe('owner')
})
```
> `schema.user` doit être disponible (déjà via `schema`). L'ordre des `it` est garanti dans un fichier vitest ; le test « inscrit puis connecte un hôte » (1er signup) tourne avant.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm exec vitest run auth.test`
Expected: FAIL (le 2e inscrit est aujourd'hui `owner`, le test attend `member`).

- [ ] **Step 3 : Câbler le défaut de rôle dans le hook**

Dans `packages/auth/src/auth.ts`, importer `firstMembershipRole` et l'utiliser dans le hook :
```ts
import { schema, ensureDefaultTenant, ensureMembership, firstMembershipRole } from '@splootlabs/db'
// ...
after: async (user) => {
  if ((config.tenancyMode ?? 'single') === 'single') {
    const tenantId = await ensureDefaultTenant(db)
    const role = await firstMembershipRole(db, tenantId)
    await ensureMembership(db, user.id, tenantId, role)
  }
},
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `pnpm exec vitest run auth.test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/auth/src/auth.ts packages/auth/src/auth.test.ts
git commit -m "feat(auth): rôle par défaut à l'inscription (1er=owner, suivants=member)"
```

---

## Task 5 : Vérification globale

**Files:** aucun (vérification ; correctif seulement si un test casse).

- [ ] **Step 1 : Typecheck monorepo**

Run: `pnpm -r typecheck`
Expected: PASS (notamment `Role` importé depuis `shared` dans `db`/`auth`, cohérent partout).

- [ ] **Step 2 : Suite complète (séquentielle, fiable)**

Run: `pnpm exec vitest run --fileParallelism=false`
Expected: PASS (tous fichiers). Vérifier en particulier qu'aucun test existant supposant l'owner-scoping strict ne régresse (les scopes systèmes des tests de repo restent `ownerId=undefined`, inchangés).

- [ ] **Step 3 : Commit (si correctif)**

```bash
git commit -am "test: vérification globale RBAC Slice 1" # seulement si des fichiers ont changé
```

---

## Self-Review (auteur du plan)

**Couverture du spec :**
- Catalogue `Role`/`Capability`/`ROLE_CAPABILITIES`/`hasPermission` dans shared → Task 1.
- `getMembershipRole` + scope role-aware (`scopeForUser`) → Task 2, câblés HTTP+socket → Task 3.
- Défaut d'inscription 1er=owner/suivants=member (`firstMembershipRole`) → Task 2 (helper) + Task 4 (hook).
- Single = 1 workspace uniforme → aucune branche spéciale ; le hook single utilise la même règle.
- Aucun repo modifié → respecté (mécanisme via `ownerId` uniquement).
- Isolation cross-tenant préservée → `scopeForUser` ne touche qu'`ownerId`, `tenantId` inchangé ; couvert par les suites existantes + assertion implicite des tests d'accès croisé (admin ne voit que SON tenant).
- Reporté à Slice 3 (`requirePermission`, membres) → aucune tâche n'y touche.

**Scan placeholders :** un seul point non littéral assumé — la mise en place de connexion socket du test de parité (Task 3 Step 5), explicitement à mimer sur un test existant du fichier, avec repli documenté. Tout le reste est du code concret.

**Cohérence des types/noms :** `Role` unique dans `shared`, importé par `db`/`auth`. `scopeForUser(db, tenantId, userId)` / `getMembershipRole(db, userId, tenantId)` / `firstMembershipRole(db, tenantId)` — signatures utilisées de façon cohérente entre Task 2 (définition), Task 3 et Task 4 (consommation). `content:access-all` : même littéral dans le catalogue et dans `scopeForUser`.
