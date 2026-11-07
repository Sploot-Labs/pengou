// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/auth', () => ({ useSession: () => ({ user: null, refresh: vi.fn() }) }))
vi.mock('../api/workspace-context', () => ({ useWorkspaces: () => ({ setActive: vi.fn() }) }))
vi.mock('../api/workspaces', () => ({
  acceptInvitation: vi.fn(),
  fetchInvitationPreview: vi.fn(() =>
    Promise.resolve({
      email: 'camille@example.com',
      role: 'member',
      status: 'pending',
      workspaceName: 'Collège',
      workspaceSlug: 'college',
      expired: false,
      expiresAt: '2030-01-01T00:00:00Z',
    }),
  ),
}))

import { AcceptInvitation } from './AcceptInvitation'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invitations/:token" element={<AcceptInvitation />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AcceptInvitation (sans session)', () => {
  afterEach(cleanup)

  it("les liens de connexion et d'inscription ramènent sur l'invitation avec la preuve", async () => {
    renderAt('/invitations/tok123?v=preuve')
    const next = encodeURIComponent('/invitations/tok123?v=preuve')
    expect(await screen.findByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', `/login?next=${next}`)
    expect(screen.getByRole('link', { name: 'Créer un compte' })).toHaveAttribute('href', `/signup?next=${next}`)
  })

  it('sans preuve, ramène sur le lien nu', async () => {
    renderAt('/invitations/tok123')
    expect(await screen.findByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/invitations/tok123')}`,
    )
  })
})
