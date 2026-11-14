// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveTenantId } from '../api/activeTenant'
import { setLang } from '../i18n/lang'

/** Socket factice : on enregistre les émissions et les (re)connexions, sans réseau. */
const mockSocket = {
  connected: true,
  active: true,
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}
const mockIo = vi.fn(() => mockSocket)
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...(args as [])) }))

import { useGameSocket } from './useGameSocket'

beforeEach(() => {
  setLang('fr')
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('useGameSocket et la langue', () => {
  it('émet lang:set une fois au changement de langue, sans reconnexion ni nouvelle socket', () => {
    const { unmount } = renderHook(() => useGameSocket())
    expect(mockIo).toHaveBeenCalledTimes(1)
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)

    act(() => setLang('en'))

    const langEmits = mockSocket.emit.mock.calls.filter(([event]) => event === 'lang:set')
    expect(langEmits).toEqual([['lang:set', 'en']])
    // Ni nouvelle poignée de main ni nouvelle socket : la partie en cours continue.
    expect(mockSocket.disconnect).not.toHaveBeenCalled()
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)
    expect(mockIo).toHaveBeenCalledTimes(1)
    // Aucun autre événement (pas de nouveau player:join ni player:reconnect).
    expect(mockSocket.emit).toHaveBeenCalledTimes(1)

    unmount()
    mockSocket.emit.mockClear()
    act(() => setLang('es'))
    // Démontée : plus d'émission.
    expect(mockSocket.emit).not.toHaveBeenCalled()
  })
})

describe("useGameSocket et l'espace actif", () => {
  afterEach(() => {
    setActiveTenantId(null)
  })

  it("refait la poignée de main quand l'espace actif change, pour qu'elle le porte", () => {
    mockSocket.active = true
    renderHook(() => useGameSocket())
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)

    // Session résolue après la connexion : l'espace actif arrive après la première poignée de main.
    act(() => setActiveTenantId('tenant-a'))

    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1)
    expect(mockSocket.connect).toHaveBeenCalledTimes(2)
    expect(mockIo).toHaveBeenCalledTimes(1)
  })

  it('ne relance pas une socket fermée ni démontée', () => {
    mockSocket.active = false
    const { unmount } = renderHook(() => useGameSocket())
    act(() => setActiveTenantId('tenant-a'))
    expect(mockSocket.disconnect).not.toHaveBeenCalled()
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)

    mockSocket.active = true
    unmount()
    mockSocket.disconnect.mockClear()
    mockSocket.connect.mockClear()
    act(() => setActiveTenantId('tenant-b'))
    expect(mockSocket.connect).not.toHaveBeenCalled()
  })
})
