import { describe, expect, it, vi } from 'vitest'
import { SoundManager } from './SoundManager.js'
import { sounds } from './sounds.js'

describe('SoundManager', () => {
  it('ne joue rien avant unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.play('correct')
    expect(play).not.toHaveBeenCalled()
  })

  it('joue après unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.play('correct')
    expect(play).toHaveBeenCalledWith('correct')
  })

  it('loop() passe l’option loop au playFn', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.loop('lobby')
    expect(play).toHaveBeenCalledWith('lobby', { loop: true })
  })

  it('muted coupe la lecture même après unlock', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.setMuted(true)
    sm.play('correct')
    expect(play).not.toHaveBeenCalled()
    expect(sm.muted).toBe(true)
  })

  it('le catalogue expose les clés de sons attendues', () => {
    expect(sounds.correct).toBeDefined()
    expect(sounds.question).toBeDefined()
    expect(Object.keys(sounds)).toContain('podium')
  })
})
