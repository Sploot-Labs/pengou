import { useMotion } from '../MotionProvider.js'
import type { SoundManager } from './SoundManager.js'

/** Accès au SoundManager partagé du MotionProvider. */
export function useSound(): SoundManager {
  return useMotion().sound
}
