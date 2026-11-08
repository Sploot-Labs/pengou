/**
 * Synthèse Web Audio « banquise » : chaque son est généré à la volée
 * (oscillateurs + enveloppes + filtres), aucun fichier mp3 à héberger. Marche
 * hors ligne, zéro question de licence, et toute la palette (clochettes de
 * glace, souffle de vent, plouf feutré, fanfare manchot) se règle ICI.
 * Confiné à motion/ comme le reste de la Web Audio (voir architecture.test.ts).
 *
 * Une recette reçoit le contexte audio et un nœud de destination (le master
 * gain du SoundManager), planifie ses nœuds relativement à `ctx.currentTime`,
 * et retourne un handle `{ stop }`. Pour un one-shot, les oscillateurs
 * s'arrêtent seuls et le bus se déconnecte via un minuteur ; `stop()` ne sert
 * qu'à couper net. Pour une boucle (ambiance lobby), `stop()` applique un
 * fondu et libère les oscillateurs.
 */
import type { SoundId } from './sounds.js'

export interface SoundHandle {
  stop: () => void
}

export type SoundRecipe = (ctx: AudioContext, destination: AudioNode, opts: { loop?: boolean }) => SoundHandle

/** Fréquence d'une note tempérée, en demi-tons depuis le La3 (220 Hz). */
function hz(semitonesFromA3: number): number {
  return 220 * 2 ** (semitonesFromA3 / 12)
}

interface VoiceOpts {
  type?: OscillatorType
  freq: number
  /** Glissando optionnel vers cette fréquence sur la durée de la voix. */
  freqTo?: number
  start: number
  dur: number
  attack?: number
  /** Gain crête de l'enveloppe. */
  peak?: number
  detune?: number
}

/**
 * Une voix : un oscillateur à travers sa propre enveloppe de gain, planifié de
 * `start` à `start + dur`. Enveloppe percussive (attaque courte, descente
 * exponentielle) adaptée aux clochettes et aux mallets.
 */
function voice(ctx: AudioContext, dest: AudioNode, o: VoiceOpts): void {
  const { type = 'sine', freq, freqTo, start, dur, attack = 0.008, peak = 0.3, detune = 0 } = o
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + dur)
  if (detune) osc.detune.setValueAtTime(detune, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g).connect(dest)
  osc.start(start)
  osc.stop(start + dur + 0.03)
}

/** Souffle filtré (bruit blanc passé en passe-bas), pour les « plouf » feutrés. */
function noise(
  ctx: AudioContext,
  dest: AudioNode,
  o: { start: number; dur: number; peak?: number; cutoff?: number },
): void {
  const { start, dur, peak = 0.2, cutoff = 800 } = o
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(cutoff, start)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(lp).connect(g).connect(dest)
  src.start(start)
  src.stop(start + dur + 0.03)
}

/** Bus local d'une recette (un gain → destination), avec son nettoyage. */
function openBus(ctx: AudioContext, dest: AudioNode, gain = 0.9): GainNode {
  const b = ctx.createGain()
  b.gain.value = gain
  b.connect(dest)
  return b
}

/** Handle d'un one-shot : auto-déconnexion après `life` s, `stop()` coupe net. */
function oneShot(ctx: AudioContext, bus: GainNode, life: number): SoundHandle {
  setTimeout(
    () => {
      try {
        bus.disconnect()
      } catch {
        /* déjà déconnecté */
      }
    },
    (life + 0.2) * 1000,
  )
  return {
    stop() {
      const now = ctx.currentTime
      try {
        bus.gain.cancelScheduledValues(now)
        bus.gain.setTargetAtTime(0.0001, now, 0.03)
        setTimeout(() => {
          try {
            bus.disconnect()
          } catch {
            /* idem */
          }
        }, 120)
      } catch {
        /* contexte fermé */
      }
    },
  }
}

export const SOUND_RECIPES: Record<SoundId, SoundRecipe> = {
  // Ambiance lobby : nappe froide qui respire, en boucle continue jusqu'à stop().
  lobby(ctx, dest) {
    const b = openBus(ctx, dest, 0.0001)
    const t = ctx.currentTime
    b.gain.setValueAtTime(0.0001, t)
    b.gain.exponentialRampToValueAtTime(0.14, t + 1.4)
    const oscs: OscillatorNode[] = []
    const pad = (freq: number, detune: number, gain: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      o.detune.value = detune
      g.gain.value = gain
      o.connect(g).connect(b)
      o.start(t)
      oscs.push(o)
    }
    pad(hz(-9), 0, 0.5) // C3, fondation
    pad(hz(-2), 5, 0.3) // G3 légèrement désaccordé, battement lent
    pad(hz(15), -4, 0.1) // C5, nappe aigüe discrète
    // Respiration : LFO lent additionné au gain du bus.
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.08
    lfoGain.gain.value = 0.05
    lfo.connect(lfoGain).connect(b.gain)
    lfo.start(t)
    oscs.push(lfo)
    return {
      stop() {
        const now = ctx.currentTime
        try {
          b.gain.cancelScheduledValues(now)
          b.gain.setTargetAtTime(0.0001, now, 0.4)
          for (const o of oscs) {
            try {
              o.stop(now + 1.3)
            } catch {
              /* déjà arrêté */
            }
          }
          setTimeout(() => {
            try {
              b.disconnect()
            } catch {
              /* idem */
            }
          }, 1500)
        } catch {
          /* contexte fermé */
        }
      },
    }
  },

  // Nouvelle question : souffle glacé qui monte + petit mallet clair.
  question(ctx, dest) {
    const b = openBus(ctx, dest, 0.9)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'triangle', freq: hz(3), freqTo: hz(22), start: t, dur: 0.42, peak: 0.16, attack: 0.03 })
    voice(ctx, b, { type: 'sine', freq: hz(15), start: t + 0.16, dur: 0.5, peak: 0.26 })
    voice(ctx, b, { type: 'sine', freq: hz(22), start: t + 0.24, dur: 0.5, peak: 0.18 })
    return oneShot(ctx, b, 0.8)
  },

  // Phase de lecture : swell grave d'anticipation, discret (« préparez-vous »).
  reading(ctx, dest) {
    const b = openBus(ctx, dest, 0.8)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'sine', freq: hz(3), start: t, dur: 0.9, peak: 0.14, attack: 0.3 })
    voice(ctx, b, { type: 'sine', freq: hz(-2), start: t, dur: 0.9, peak: 0.1, attack: 0.3 })
    return oneShot(ctx, b, 1.1)
  },

  // Révélation : chime doux à deux notes.
  reveal(ctx, dest) {
    const b = openBus(ctx, dest, 0.9)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'sine', freq: hz(22), start: t, dur: 0.5, peak: 0.22 })
    voice(ctx, b, { type: 'sine', freq: hz(27), start: t + 0.12, dur: 0.6, peak: 0.2 })
    return oneShot(ctx, b, 0.9)
  },

  // Classement : petit scintillement montant.
  scoreboard(ctx, dest) {
    const b = openBus(ctx, dest, 0.85)
    const t = ctx.currentTime
    const steps = [15, 19, 22, 27]
    steps.forEach((s, i) => {
      voice(ctx, b, { type: 'sine', freq: hz(s), start: t + i * 0.07, dur: 0.4, peak: 0.16 })
    })
    return oneShot(ctx, b, 0.8)
  },

  // Podium : fanfare manchot, arpège montant puis accord tenu avec vibrato.
  podium(ctx, dest) {
    const b = openBus(ctx, dest, 1)
    const t = ctx.currentTime
    const arp = [3, 7, 10, 15]
    arp.forEach((s, i) => {
      voice(ctx, b, { type: 'triangle', freq: hz(s), start: t + i * 0.1, dur: 0.5, peak: 0.24 })
    })
    // Accord tenu (do-mi-sol) qui s'installe après l'arpège.
    const chordAt = t + 0.4
    for (const s of [15, 19, 22]) {
      voice(ctx, b, { type: 'sine', freq: hz(s), start: chordAt, dur: 0.8, peak: 0.18, attack: 0.04 })
    }
    // Scintillement final.
    voice(ctx, b, { type: 'sine', freq: hz(34), start: t + 0.8, dur: 0.5, peak: 0.1 })
    return oneShot(ctx, b, 1.4)
  },

  // Bonne réponse : arpège cristallin montant.
  correct(ctx, dest) {
    const b = openBus(ctx, dest, 0.95)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'sine', freq: hz(15), start: t, dur: 0.45, peak: 0.26 })
    voice(ctx, b, { type: 'sine', freq: hz(19), start: t + 0.07, dur: 0.45, peak: 0.24 })
    voice(ctx, b, { type: 'sine', freq: hz(22), start: t + 0.14, dur: 0.6, peak: 0.26 })
    voice(ctx, b, { type: 'triangle', freq: hz(27), start: t + 0.14, dur: 0.5, peak: 0.07 })
    return oneShot(ctx, b, 0.8)
  },

  // Mauvaise réponse : descente feutrée + petit plouf, jamais un buzzer agressif.
  incorrect(ctx, dest) {
    const b = openBus(ctx, dest, 0.9)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'triangle', freq: hz(2), freqTo: hz(-5), start: t, dur: 0.35, peak: 0.2, attack: 0.01 })
    noise(ctx, b, { start: t + 0.02, dur: 0.22, peak: 0.12, cutoff: 500 })
    return oneShot(ctx, b, 0.6)
  },

  // Tic du chrono (5 dernières secondes) : clic de glace court et discret.
  tick(ctx, dest) {
    const b = openBus(ctx, dest, 0.8)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'triangle', freq: hz(27), start: t, dur: 0.06, peak: 0.14, attack: 0.004 })
    return oneShot(ctx, b, 0.2)
  },

  // Validation de réponse (côté joueur) : tap doux et bref.
  tap(ctx, dest) {
    const b = openBus(ctx, dest, 0.8)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'sine', freq: hz(10), start: t, dur: 0.12, peak: 0.2, attack: 0.004 })
    return oneShot(ctx, b, 0.25)
  },

  // Arrivée d'un joueur : petite bulle qui remonte.
  join(ctx, dest) {
    const b = openBus(ctx, dest, 0.85)
    const t = ctx.currentTime
    voice(ctx, b, { type: 'sine', freq: hz(10), freqTo: hz(17), start: t, dur: 0.16, peak: 0.2, attack: 0.006 })
    return oneShot(ctx, b, 0.3)
  },
}
