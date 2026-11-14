// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseSessionResult } from './auth'

const session: { current: Pick<UseSessionResult, 'user' | 'loading'> } = {
  current: { user: null, loading: true },
}
vi.mock('./auth', () => ({ useSession: () => session.current }))

const fetchWorkspaces = vi.fn()
vi.mock('./workspaces', () => ({ fetchWorkspaces: () => fetchWorkspaces() }))

import { getActiveTenantId, setActiveTenantId } from './activeTenant'
import { WorkspaceProvider } from './workspace-context'

const user = { id: 'u1', email: 'hote@example.org', name: 'Hôte' } as unknown as NonNullable<UseSessionResult['user']>

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { user: null, loading: true }
  setActiveTenantId('tenant-a')
  fetchWorkspaces.mockResolvedValue({
    tenancyMode: 'multi',
    workspaces: [{ tenantId: 'tenant-a', slug: 'a', name: 'A', role: 'owner' }],
  })
})
afterEach(() => {
  cleanup()
  setActiveTenantId(null)
})

describe('WorkspaceProvider', () => {
  it("garde l'espace actif pendant le chargement de la session", async () => {
    const { rerender } = render(<WorkspaceProvider>{null}</WorkspaceProvider>)
    // La socket lit l'espace actif à sa poignée de main : il ne doit jamais disparaître entre-temps.
    expect(getActiveTenantId()).toBe('tenant-a')

    session.current = { user, loading: false }
    await act(async () => {
      rerender(<WorkspaceProvider>{null}</WorkspaceProvider>)
    })
    expect(getActiveTenantId()).toBe('tenant-a')
    expect(fetchWorkspaces).toHaveBeenCalledTimes(1)
  })

  it("oublie l'espace actif quand la session est confirmée absente", () => {
    session.current = { user: null, loading: false }
    render(<WorkspaceProvider>{null}</WorkspaceProvider>)
    expect(getActiveTenantId()).toBeNull()
  })
})
