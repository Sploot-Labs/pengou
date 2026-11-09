import { and, count, eq, like, or } from 'drizzle-orm'
import type { Role } from '@splootlabs/shared'
import type { Db } from './client.js'
import type { TenantScope } from './tenant.js'
import { schema } from './index.js'

/**
 * Gestion des workspaces (tenants) — Slice 3. Ces opérations sont intrinsèquement PRÉ-contexte
 * (créer un workspace, lister les siens) ou cross-tenant : elles tournent sur `systemDb`
 * (bypass RLS), jamais sous `withTenantTx`. L'isolation est garantie par le filtre explicite
 * sur `userId`/`slug`, pas par le GUC RLS.
 */

export type Workspace = typeof schema.tenant.$inferSelect
export type UserWorkspace = { tenantId: string; slug: string; name: string; role: Role }

/** Slugifie un nom en identifiant URL-safe : minuscules, caractères non `[a-z0-9]` compactés en
 * tirets, sans tiret de bord. Volontairement SANS translittération d'accents (parité avec le
 * regexp du backfill SQL `0016_workspaces`). Peut renvoyer '' (nom entièrement non-ascii). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Slug LIBRE dérivé de `name` : la base si disponible, sinon désambiguïsée `base-2`, `base-3`…
 * Base de repli `workspace` si le nom ne produit aucun slug. Non transactionnel : `createWorkspace`
 * gère la course résiduelle (insert avec retry sur collision de slug).
 */
export async function generateUniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || 'workspace'
  const rows = await db
    .select({ slug: schema.tenant.slug })
    .from(schema.tenant)
    .where(or(eq(schema.tenant.slug, base), like(schema.tenant.slug, `${base}-%`)))
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Crée un workspace et sa membership `owner` pour `ownerId`, dans une transaction. Slug lisible
 * dérivé du nom ; en cas de collision concurrente sur le slug, on suffixe un jeton court et on
 * retente (borné). Renvoie la ligne tenant créée.
 */
export async function createWorkspace(db: Db, input: { name: string; ownerId: string }): Promise<Workspace> {
  const name = input.name.trim()
  for (let attempt = 0; attempt < 5; attempt++) {
    let slug = await generateUniqueSlug(db, name)
    if (attempt > 0) slug = `${slug}-${Math.floor(performance.now()).toString(36).slice(-4)}`
    try {
      return await db.transaction(async (tx) => {
        const [tenant] = await tx.insert(schema.tenant).values({ name, slug }).returning()
        await tx.insert(schema.membership).values({ userId: input.ownerId, tenantId: tenant.id, role: 'owner' })
        return tenant
      })
    } catch (e) {
      // 23505 = unique_violation (course sur le slug) → régénérer et retenter.
      if (isUniqueViolation(e) && attempt < 4) continue
      throw e
    }
  }
  // Inatteignable en pratique (retour/relance dans la boucle) ; garde le typage exhaustif.
  throw new Error('createWorkspace: impossible de générer un slug unique')
}

/** Workspaces dont `userId` est membre, avec son rôle, du plus ancien au plus récent. */
export async function listUserWorkspaces(db: Db, userId: string): Promise<UserWorkspace[]> {
  const rows = await db
    .select({
      tenantId: schema.tenant.id,
      slug: schema.tenant.slug,
      name: schema.tenant.name,
      role: schema.membership.role,
      createdAt: schema.tenant.createdAt,
    })
    .from(schema.membership)
    .innerJoin(schema.tenant, eq(schema.tenant.id, schema.membership.tenantId))
    .where(eq(schema.membership.userId, userId))
    .orderBy(schema.tenant.createdAt)
  return rows.map((r) => ({ tenantId: r.tenantId, slug: r.slug, name: r.name, role: r.role as Role }))
}

export async function getWorkspaceBySlug(db: Db, slug: string): Promise<Workspace | null> {
  const [row] = await db.select().from(schema.tenant).where(eq(schema.tenant.slug, slug)).limit(1)
  return row ?? null
}

/** Vrai si l'utilisateur est membre du tenant (n'importe quel rôle). */
export async function isMember(db: Db, userId: string, tenantId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, tenantId)))
    .limit(1)
  return Boolean(m)
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

// --- Gestion des membres (Slice 3b) — opèrent sur un TenantScope (appDb sous RLS dans les
//     routes ; systemDb dans les tests). Le filtre explicite sur `tenantId` double le RLS. ---

export type Member = { userId: string; email: string; name: string; role: Role; createdAt: Date }

/** Membres du workspace (jointure user), du plus ancien au plus récent. */
export async function listMembers(scope: TenantScope): Promise<Member[]> {
  const rows = await scope.db
    .select({
      userId: schema.membership.userId,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.membership.role,
      createdAt: schema.membership.createdAt,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(eq(schema.membership.tenantId, scope.tenantId))
    .orderBy(schema.membership.createdAt)
  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role as Role,
    createdAt: r.createdAt,
  }))
}

/** Rôle d'un membre dans le workspace, ou null s'il n'en est pas membre. */
export async function getMemberRole(scope: TenantScope, userId: string): Promise<Role | null> {
  const [m] = await scope.db
    .select({ role: schema.membership.role })
    .from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, scope.tenantId)))
    .limit(1)
  return m ? (m.role as Role) : null
}

/** Nombre d'owners du workspace — base de la garde « au moins un owner ». */
export async function countOwners(scope: TenantScope): Promise<number> {
  const [row] = await scope.db
    .select({ n: count() })
    .from(schema.membership)
    .where(and(eq(schema.membership.tenantId, scope.tenantId), eq(schema.membership.role, 'owner')))
  return Number(row?.n ?? 0)
}

/** Change le rôle d'un membre. Renvoie le membership mis à jour, ou null s'il n'existe pas. */
export async function setMemberRole(
  scope: TenantScope,
  userId: string,
  role: Role,
): Promise<{ userId: string; role: Role } | null> {
  const [row] = await scope.db
    .update(schema.membership)
    .set({ role })
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, scope.tenantId)))
    .returning({ userId: schema.membership.userId, role: schema.membership.role })
  return row ? { userId: row.userId, role: row.role as Role } : null
}

/** Retire un membre du workspace. Renvoie true si une ligne a été supprimée. */
export async function removeMember(scope: TenantScope, userId: string): Promise<boolean> {
  const rows = await scope.db
    .delete(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.tenantId, scope.tenantId)))
    .returning({ id: schema.membership.id })
  return rows.length > 0
}
