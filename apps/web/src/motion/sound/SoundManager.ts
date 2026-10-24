import { SOUND_RECIPES, type SoundHandle } from './synth.js'
import type { SoundId } from './sounds.js'

const MUTE_STORAGE_KEY = 'pingou.sound.muted'

interface SoundManagerOptions {
  /** Injection pour les tests : remplace la vraie synthèse Web Audio. */
  playFn?: (id: SoundId, opts?: { loop?: boolean }) => void
}

/**
 * Gestion du son opt-in, synthétisé en Web Audio (voir `synth.ts`). L'autoplay
 * policy interdit le son avant interaction : rien n'est émis avant `unlock()`
 * (appelé au 1er geste utilisateur, cf. MotionProvider). L'`AudioContext` est
 * créé paresseusement à `unlock()` (donc sur un geste) et repris s'il était
 * suspendu. Muet persistant via localStorage.
 */
export class SoundManager {
  private unlocked = false
  private _muted: boolean
  private readonly playFn?: (id: SoundId, opts?: { loop?: boolean }) => void
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  /** Boucles en cours (ex. ambiance lobby), pour pouvoir les arrêter. */
  private readonly loops = new Map<SoundId, SoundHandle>()

  constructor(opts: SoundManagerOptions = {}) {
    this._muted = readStoredMuted()
    this.playFn = opts.playFn
  }

  get muted(): boolean {
    return this._muted
  }

  /** Marque le son comme déverrouillé et amorce le contexte audio (geste requis). */
  unlock(): void {
    this.unlocked = true
    if (!this.playFn) this.ensureContext()
  }

  setMuted(m: boolean): void {
    this._muted = m
    if (typeof localStorage !== 'undefined') localStorage.setItem(MUTE_STORAGE_KEY, m ? '1' : '0')
    // Couper le son coupe aussi les boucles déjà lancées (ambiance lobby) :
    // sans ça, la nappe continuerait malgré le bouton « muet ».
    if (m) this.stopAll()
  }

  play(id: SoundId): void {
    if (!this.unlocked || this._muted) return
    if (this.playFn) {
      this.playFn(id)
      return
    }
    this.trigger(id, false)
  }

  loop(id: SoundId): void {
    if (!this.unlocked || this._muted) return
    if (this.playFn) {
      this.playFn(id, { loop: true })
      return
    }
    // Une seule instance d'une boucle donnée à la fois.
    this.stop(id)
    this.trigger(id, true)
  }

  stop(id: SoundId): void {
    const handle = this.loops.get(id)
    if (handle) {
      handle.stop()
      this.loops.delete(id)
    }
  }

  private stopAll(): void {
    for (const id of [...this.loops.keys()]) this.stop(id)
  }

  private ensureContext(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
      return
    }
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined
    if (!Ctor) return // pas de Web Audio (jsdom, très vieux navigateur) : silence, jamais de crash
    try {
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
    } catch {
      this.ctx = null
      this.master = null
    }
  }

  private trigger(id: SoundId, loop: boolean): void {
    this.ensureContext()
    if (!this.ctx || !this.master) return
    const recipe = SOUND_RECIPES[id]
    if (!recipe) return
    try {
      const handle = recipe(this.ctx, this.master, { loop })
      if (loop) this.loops.set(id, handle)
    } catch {
      /* un son qui échoue ne doit jamais casser le jeu */
    }
  }
}

function readStoredMuted(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(MUTE_STORAGE_KEY) === '1'
}
