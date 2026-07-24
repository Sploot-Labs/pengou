import { describe, expect, it, vi } from 'vitest'
import { SoundManager } from './SoundManager.js'
import { sounds } from './sounds.js'

describe('SoundManager', () => {
  it('ne joue rien avant unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.play('ding')
    expect(play).not.toHaveBeenCalled()
  })

  it('joue après unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.play('ding')
    expect(play).toHaveBeenCalledWith('ding')
  })

  it('muted coupe la lecture même après unlock', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.setMuted(true)
    sm.play('ding')
    expect(play).not.toHaveBeenCalled()
    expect(sm.muted).toBe(true)
  })

  it('le catalogue résout chaque clé vers une URL', () => {
    expect(sounds.ding).toMatch(/\.mp3$/)
    expect(Object.keys(sounds)).toContain('fanfare')
  })
})
