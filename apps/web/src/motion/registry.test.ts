import { describe, expect, it } from 'vitest'
import { registry } from './registry.js'
import { sounds } from './sound/sounds.js'

describe('registre de cues (moments de jeu)', () => {
  it('couvre les moments de jeu clés', () => {
    for (const cue of [
      'phase.enter:reading',
      'phase.enter:question',
      'phase.enter:reveal',
      'phase.enter:scoreboard',
      'phase.enter:podium',
      'answer.submit',
      'answer.correct',
      'answer.incorrect',
      'timer.urgent',
    ]) {
      expect(registry[cue], `manque: ${cue}`).toBeDefined()
    }
  })

  it('chaque sound référencé existe dans le catalogue', () => {
    for (const effect of Object.values(registry)) {
      if (effect?.sound) expect(sounds[effect.sound]).toBeDefined()
    }
  })
})
