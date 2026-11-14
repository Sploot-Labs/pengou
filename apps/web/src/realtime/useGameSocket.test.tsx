// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n/lang'

/** Socket factice : on enregistre les émissions et les (re)connexions, sans réseau. */
const mockSocket = {
  connected: true,
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
