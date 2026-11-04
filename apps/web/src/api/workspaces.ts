import { apiGet, apiPost, apiPatch, apiDelete } from './client'

/** Rôles du catalogue partagé (aligné sur `@splootlabs/shared`). */
export type Role = 'owner' | 'admin' | 'member'

export interface Workspace {
  tenantId: string
  slug: string
  name: string
  role: Role
}

export interface WorkspacesResponse {
  tenancyMode: 'single' | 'multi'
  workspaces: Workspace[]
}

export interface Member {
  userId: string
  email: string
  name: string
  role: Role
  createdAt: string
}

export interface Invitation {
  id: string
  tenantId: string
  email: string
  role: Role
  token: string
  status: 'pending' | 'accepted' | 'revoked'
  expiresAt: string
  createdAt: string
}

/** Invitation telle que listée : le jeton n'est renvoyé qu'à la création et au renvoi. */
export type PendingInvitation = Omit<Invitation, 'token'>

/** Réponse de création et de renvoi : `emailSent` dit si l'e-mail est réellement parti,
 * `emailSkipped` pourquoi il n'a pas été tenté (invitant à l'adresse non confirmée, mode multi). */
export interface InvitationResult {
  invitation: Invitation
  emailSent: boolean
  emailSkipped?: 'inviter_unverified'
}

export interface InvitationPreview {
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'revoked'
  workspaceName: string
  workspaceSlug: string
  expired: boolean
  expiresAt: string
}

export function fetchWorkspaces(): Promise<WorkspacesResponse> {
  return apiGet<WorkspacesResponse>('/api/workspaces')
}

export function createWorkspace(name: string): Promise<Workspace> {
  return apiPost<Workspace>('/api/workspaces', { name })
}

export function fetchMembers(tenantId: string): Promise<{ members: Member[] }> {
  return apiGet(`/api/workspaces/${tenantId}/members`)
}

export function setMemberRole(tenantId: string, userId: string, role: Role): Promise<{ userId: string; role: Role }> {
  return apiPatch(`/api/workspaces/${tenantId}/members/${userId}`, { role })
}

export function removeMember(tenantId: string, userId: string): Promise<{ ok: true }> {
  return apiDelete(`/api/workspaces/${tenantId}/members/${userId}`)
}

export function fetchInvitations(tenantId: string): Promise<{ invitations: PendingInvitation[] }> {
  return apiGet(`/api/workspaces/${tenantId}/invitations`)
}

export function createInvitation(tenantId: string, email: string, role: Role): Promise<InvitationResult> {
  return apiPost(`/api/workspaces/${tenantId}/invitations`, { email, role })
}

export function resendInvitation(tenantId: string, id: string): Promise<InvitationResult> {
  return apiPost(`/api/workspaces/${tenantId}/invitations/${id}/resend`)
}

export function revokeInvitation(tenantId: string, id: string): Promise<{ ok: true }> {
  return apiDelete(`/api/workspaces/${tenantId}/invitations/${id}`)
}

export function fetchInvitationPreview(token: string): Promise<InvitationPreview> {
  return apiGet(`/api/invitations/${token}`)
}

/** `v` : preuve portée par le lien reçu par e-mail ; elle permet de confirmer l'adresse. */
export function acceptInvitation(token: string, v?: string | null): Promise<{ tenantId: string; role: Role }> {
  return apiPost(`/api/invitations/${token}/accept`, v ? { v } : undefined)
}
