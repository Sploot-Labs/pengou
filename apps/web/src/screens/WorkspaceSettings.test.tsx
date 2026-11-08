// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mailEnabled = true
vi.mock('../api/features', () => ({ useAuthFeatures: () => ({ mailEnabled, loading: false }) }))
vi.mock('../api/auth', () => ({ signOut: vi.fn(), useSession: () => ({ user: { id: 'u' }, refresh: vi.fn() }) }))
const mockWorkspaceContext = {
  tenancyMode: 'multi',
  workspaces: [{ tenantId: 't1', slug: 'college', name: 'Collège', role: 'owner' }],
  active: { tenantId: 't1', slug: 'college', name: 'Collège', role: 'owner' },
  setActive: vi.fn(),
  refresh: vi.fn(),
  ready: true,
}
vi.mock('../api/workspace-context', () => ({
  useWorkspaces: () => mockWorkspaceContext,
  useWorkspacesOptional: () => mockWorkspaceContext,
}))
vi.mock('../api/workspaces', () => ({
  fetchMembers: vi.fn(() => Promise.resolve({ members: [] })),
  fetchInvitations: vi.fn(() => Promise.resolve({ invitations: [] })),
  createInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  createWorkspace: vi.fn(),
}))

import * as ws from '../api/workspaces'
import { WorkspaceSettings } from './WorkspaceSettings'

const invitation = (token = 'tok') => ({
  id: 'i1',
  tenantId: 't1',
  email: 'camille@example.com',
  role: 'member',
  token,
  status: 'pending',
  expiresAt: '2030-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
})

function renderScreen() {
  return render(
    <MemoryRouter>
      <WorkspaceSettings />
    </MemoryRouter>,
  )
}

async function invite(email = 'camille@example.com') {
  renderScreen()
  const field = await screen.findByLabelText('E-mail à inviter')
  fireEvent.change(field, { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Inviter' }))
}

describe('WorkspaceSettings, invitations', () => {
  beforeEach(() => {
    mailEnabled = true
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('e-mail parti : confirme et garde le lien copiable', async () => {
    vi.mocked(ws.createInvitation).mockResolvedValue({ invitation: invitation(), emailSent: true } as never)
    await invite()
    expect(await screen.findByText('Invitation envoyée à camille@example.com')).toBeInTheDocument()
    expect(screen.getByText(/\/invitations\/tok/)).toBeInTheDocument()
  })

  it('e-mail non parti avec envoi activé : invite à copier le lien', async () => {
    vi.mocked(ws.createInvitation).mockResolvedValue({ invitation: invitation(), emailSent: false } as never)
    await invite()
    expect(await screen.findByText("L'e-mail n'a pas pu partir, copiez le lien ci-dessous")).toBeInTheDocument()
    expect(screen.getByText(/\/invitations\/tok/)).toBeInTheDocument()
  })

  it("invitant à l'adresse non confirmée : demande de confirmer, lien copiable", async () => {
    vi.mocked(ws.createInvitation).mockResolvedValue({
      invitation: invitation(),
      emailSent: false,
      emailSkipped: 'inviter_unverified',
    } as never)
    await invite()
    expect(
      await screen.findByText(
        'Confirmez votre adresse pour envoyer les invitations par e-mail. En attendant, copiez le lien ci-dessous.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/n'a pas pu partir/)).not.toBeInTheDocument()
    expect(screen.getByText(/\/invitations\/tok/)).toBeInTheDocument()
  })

  it('sans envoi configuré : écran inchangé, aucune note, lien présent', async () => {
    mailEnabled = false
    vi.mocked(ws.createInvitation).mockResolvedValue({ invitation: invitation(), emailSent: false } as never)
    await invite()
    await waitFor(() => expect(screen.getByText(/\/invitations\/tok/)).toBeInTheDocument())
    expect(screen.queryByText(/Invitation envoyée/)).not.toBeInTheDocument()
    expect(screen.queryByText(/n'a pas pu partir/)).not.toBeInTheDocument()
  })

  it('suggère un domaine courant sous le champ e-mail', async () => {
    renderScreen()
    const field = await screen.findByLabelText('E-mail à inviter')
    fireEvent.change(field, { target: { value: 'camille@gmial.com' } })
    fireEvent.blur(field)
    fireEvent.click(screen.getByRole('button', { name: 'camille@gmail.com' }))
    expect(field).toHaveValue('camille@gmail.com')
  })
})
