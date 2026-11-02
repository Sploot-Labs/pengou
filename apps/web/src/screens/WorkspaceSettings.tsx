import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../api/auth'
import { useWorkspaces } from '../api/workspace-context'
import { ApiError } from '../api/client'
import {
  fetchMembers, setMemberRole, removeMember, fetchInvitations, createInvitation,
  revokeInvitation, resendInvitation, createWorkspace,
  type Member, type PendingInvitation, type Role,
} from '../api/workspaces'
import { AppHeader } from '../ui/AppHeader'
import { WorkspaceSwitcher } from '../ui/WorkspaceSwitcher'
import { Button } from '../ui'

const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre' }

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur réseau est survenue.'
}

function invitationLink(token: string): string {
  return `${window.location.origin}/invitations/${token}`
}

/**
 * Écran de gestion d'un workspace (Slice 3c) : création de workspace, gestion des membres et des
 * invitations du workspace ACTIF. Les sections membres/invitations ne s'affichent que si l'on a la
 * capacité (`owner`/`admin`) — le serveur reste l'autorité (`requirePermission`), l'UI se contente
 * de masquer ce qui échouerait. `member` n'y voit que la création de workspace + le switcher.
 */
export function WorkspaceSettings() {
  const { tenancyMode, active, refresh, setActive } = useWorkspaces()

  if (tenancyMode !== 'multi') {
    return (
      <div className="ab-shell">
        <AppHeader />
        <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
          <section className="home-hero"><div><h1>Workspaces</h1></div></section>
          <p className="ab-empty-state">
            La gestion des workspaces est disponible uniquement en mode multi (cloud). En self-host
            mono-espace, il n'y a qu'un seul workspace.
          </p>
          <Link className="ab-button ab-button--ghost" to="/">Retour à l'accueil</Link>
        </main>
      </div>
    )
  }

  const canManage = active?.role === 'owner' || active?.role === 'admin'

  return (
    <div className="ab-shell">
      <AppHeader actions={<WorkspaceSwitcher />} />
      <main className="ab-shell__main" id="contenu-principal" tabIndex={-1}>
        <section className="home-hero">
          <div>
            <h1>Gérer les workspaces</h1>
            {active && <p className="home-hero__sub">Espace actif : <strong>{active.name}</strong></p>}
          </div>
          <Link className="ab-button ab-button--ghost" to="/">← Accueil</Link>
        </section>

        <CreateWorkspaceSection onCreated={async (tenantId) => { await refresh(); setActive(tenantId); window.location.assign('/workspace') }} />

        {active && canManage && <MembersSection tenantId={active.tenantId} actorRole={active.role} />}
        {active && canManage && <InvitationsSection tenantId={active.tenantId} />}
        {active && !canManage && (
          <p className="ab-empty-state" style={{ marginTop: 'var(--space-6)' }}>
            Vous êtes membre de cet espace. La gestion des membres est réservée aux administrateurs.
          </p>
        )}
      </main>
    </div>
  )
}

function CreateWorkspaceSection({ onCreated }: { onCreated: (tenantId: string) => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Le nom est requis.'); return }
    setPending(true); setError(null)
    try {
      const ws = await createWorkspace(trimmed)
      await onCreated(ws.tenantId)
    } catch (err) {
      setError(errorMessage(err)); setPending(false)
    }
  }

  return (
    <section aria-labelledby="ws-create-heading" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="home-section__header"><h2 id="ws-create-heading">Nouveau workspace</h2></div>
      <form className="home-inline-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && <p className="join-error" role="alert">{error}</p>}
        <div className="host-field">
          <label htmlFor="ws-name">Nom du workspace</label>
          <input id="ws-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Équipe Marketing" />
        </div>
        <Button variant="primary" type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer'}</Button>
      </form>
    </section>
  )
}

function MembersSection({ tenantId, actorRole }: { tenantId: string; actorRole: Role }) {
  const { user } = useSession()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetchMembers(tenantId)
      .then((r) => setMembers(r.members))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [tenantId])

  useEffect(() => { load() }, [load])

  // owner seul peut attribuer/retirer le rôle owner (workspace:manage) ; un admin gère admin/member.
  const assignable: Role[] = actorRole === 'owner' ? ['owner', 'admin', 'member'] : ['admin', 'member']

  async function changeRole(userId: string, role: Role) {
    setRowError(null)
    try { await setMemberRole(tenantId, userId, role); load() }
    catch (err) { setRowError(errorMessage(err)) }
  }
  async function remove(userId: string) {
    setRowError(null)
    try { await removeMember(tenantId, userId); load() }
    catch (err) { setRowError(errorMessage(err)) }
  }

  return (
    <section aria-labelledby="ws-members-heading" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="home-section__header"><h2 id="ws-members-heading">Membres</h2></div>
      {rowError && <p className="join-error" role="alert">{rowError}</p>}
      {loading ? <p role="status">Chargement des membres…</p>
        : error ? <div className="ab-empty-state"><p role="alert">{error}</p><Button variant="primary" onClick={load}>Réessayer</Button></div>
        : (
          <ul className="home-list ab-members">
            {members.map((m) => {
              const isSelf = m.userId === user?.id
              // Un admin ne peut pas modifier un owner ; le serveur refuserait de toute façon.
              const editable = actorRole === 'owner' || m.role !== 'owner'
              return (
                <li key={m.userId} className="ab-member-row">
                  <span className="home-list__title">{m.name || m.email}</span>
                  <span className="home-list__meta">{m.email}{isSelf ? ' (vous)' : ''}</span>
                  <span className="ab-member-row__controls">
                    <label className="visually-hidden" htmlFor={`role-${m.userId}`}>Rôle de {m.email}</label>
                    <select
                      id={`role-${m.userId}`}
                      className="ab-workspace-switcher__select"
                      value={m.role}
                      disabled={!editable}
                      onChange={(e) => void changeRole(m.userId, e.target.value as Role)}
                    >
                      {/* Le rôle courant reste affiché même s'il n'est pas ré-assignable par l'acteur. */}
                      {Array.from(new Set([m.role, ...assignable])).map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                    <Button variant="danger" type="button" disabled={!editable} onClick={() => void remove(m.userId)}>
                      Retirer
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}

function InvitationsSection({ tenantId }: { tenantId: string }) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [lastLink, setLastLink] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetchInvitations(tenantId)
      .then((r) => setInvitations(r.invitations))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) { setFormError('E-mail requis.'); return }
    setPending(true); setFormError(null)
    try {
      const { invitation } = await createInvitation(tenantId, trimmed, role)
      setLastLink(invitationLink(invitation.token))
      setEmail('')
      load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }
  async function handleRevoke(id: string) {
    try { await revokeInvitation(tenantId, id); load() } catch (err) { setError(errorMessage(err)) }
  }
  async function handleResend(id: string) {
    try {
      const { invitation } = await resendInvitation(tenantId, id)
      setLastLink(invitationLink(invitation.token))
      load()
    } catch (err) { setError(errorMessage(err)) }
  }

  return (
    <section aria-labelledby="ws-invites-heading" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="home-section__header"><h2 id="ws-invites-heading">Invitations</h2></div>

      <form className="home-inline-form" onSubmit={(e) => void handleInvite(e)} noValidate>
        {formError && <p className="join-error" role="alert">{formError}</p>}
        <div className="host-field">
          <label htmlFor="invite-email">E-mail à inviter</label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collegue@exemple.fr" />
        </div>
        <div className="host-field">
          <label htmlFor="invite-role">Rôle</label>
          <select id="invite-role" className="ab-workspace-switcher__select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Membre</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>
        <Button variant="primary" type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Inviter'}</Button>
      </form>

      {lastLink && (
        <p className="ab-invite-link" role="status">
          Lien d'invitation (à transmettre) : <code>{lastLink}</code>
        </p>
      )}

      {loading ? <p role="status">Chargement des invitations…</p>
        : error ? <p role="alert" className="join-error">{error}</p>
        : invitations.length === 0 ? <p className="ab-empty-state">Aucune invitation en attente.</p>
        : (
          <ul className="home-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="ab-member-row">
                <span className="home-list__title">{inv.email}</span>
                <span className="home-list__meta">
                  {ROLE_LABEL[inv.role]}, expire le {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
                </span>
                <span className="ab-member-row__controls">
                  <Button variant="ghost" type="button" onClick={() => void handleResend(inv.id)}>Renvoyer</Button>
                  <Button variant="danger" type="button" onClick={() => void handleRevoke(inv.id)}>Révoquer</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
