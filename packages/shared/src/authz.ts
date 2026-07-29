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
