import { sounds, type SoundId } from './sounds.js'

const MUTE_STORAGE_KEY = 'arena.sound.muted'

interface SoundManagerOptions {
  /** Injection pour les tests : remplace la vraie lecture <audio>. */
  playFn?: (id: SoundId, opts?: { loop?: boolean }) => void
}

/**
 * Gestion du son opt-in. L'autoplay policy interdit le son avant interaction :
 * rien n'est émis avant `unlock()` (appelé au 1er geste utilisateur). Muet
 * persistant via localStorage.
 */
export class SoundManager {
  private unlocked = false
  private _muted: boolean
  private readonly playFn: (id: SoundId, opts?: { loop?: boolean }) => void
  private readonly elements = new Map<SoundId, HTMLAudioElement>()

  constructor(opts: SoundManagerOptions = {}) {
    this._muted = readStoredMuted()
    this.playFn = opts.playFn ?? ((id, o) => this.playViaAudio(id, o))
  }

  get muted(): boolean {
    return this._muted
  }

  unlock(): void {
    this.unlocked = true
  }

  setMuted(m: boolean): void {
    this._muted = m
    if (typeof localStorage !== 'undefined') localStorage.setItem(MUTE_STORAGE_KEY, m ? '1' : '0')
  }

  play(id: SoundId): void {
    if (!this.unlocked || this._muted) return
    this.playFn(id)
  }

  loop(id: SoundId, _opts: { fade?: number } = {}): void {
    if (!this.unlocked || this._muted) return
    this.playFn(id, { loop: true })
  }

  stop(id: SoundId): void {
    const el = this.elements.get(id)
    if (el) {
      el.pause()
      el.currentTime = 0
    }
  }

  private playViaAudio(id: SoundId, opts: { loop?: boolean } = {}): void {
    if (typeof Audio === 'undefined') return
    let el = this.elements.get(id)
    if (!el) {
      el = new Audio(sounds[id])
      this.elements.set(id, el)
    }
    el.loop = opts.loop ?? false
    el.currentTime = 0
    void el.play().catch(() => {
      /* geste utilisateur requis / fichier absent : silence, jamais de crash */
    })
  }
}

function readStoredMuted(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(MUTE_STORAGE_KEY) === '1'
}
