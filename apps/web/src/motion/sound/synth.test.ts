import { describe, expect, it } from 'vitest'
import { SOUND_RECIPES } from './synth.js'
import { sounds } from './sounds.js'

/**
 * On ne teste pas le rendu audio (impossible hors navigateur), mais deux
 * garanties structurelles : chaque clé du catalogue a une recette (et
 * réciproquement), et chaque recette s'exécute contre un `AudioContext` factice
 * sans lever et rend bien un handle `{ stop }`. Le faux contexte implémente la
 * surface Web Audio réellement utilisée par `synth.ts` ; toute méthode oubliée
 * ferait échouer ce test.
 */

function fakeParam() {
  const p = {
    value: 0,
    setValueAtTime: () => p,
    linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p,
    setTargetAtTime: () => p,
    cancelScheduledValues: () => p,
  }
  return p
}

function fakeNode() {
  return {
    gain: fakeParam(),
    frequency: fakeParam(),
    detune: fakeParam(),
    type: 'sine',
    buffer: null as unknown,
    connect: (next: unknown) => next,
    disconnect: () => {},
    start: () => {},
    stop: () => {},
  }
}

function fakeCtx() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    destination: fakeNode(),
    createGain: () => fakeNode(),
    createOscillator: () => fakeNode(),
    createBiquadFilter: () => fakeNode(),
    createBufferSource: () => fakeNode(),
    createBuffer: (_ch: number, frames: number) => ({ getChannelData: () => new Float32Array(frames) }),
  } as unknown as AudioContext
}

describe('synthèse des sons', () => {
  it('chaque clé du catalogue a une recette (et réciproquement)', () => {
    expect(Object.keys(SOUND_RECIPES).sort()).toEqual(Object.keys(sounds).sort())
  })

  it('chaque recette s’exécute et rend un handle arrêtable', () => {
    const ctx = fakeCtx()
    const dest = ctx.createGain()
    for (const [id, recipe] of Object.entries(SOUND_RECIPES)) {
      const loop = id === 'lobby'
      const handle = recipe(ctx, dest, { loop })
      expect(typeof handle.stop, `recette ${id}`).toBe('function')
      expect(() => handle.stop()).not.toThrow()
    }
  })
})
