/** Catalogue de sons : les cues référencent une clé, jamais une URL. Changer un
 * son = éditer ce fichier. Les fichiers vivent dans apps/web/public/sfx/. */
export const sounds = {
  ding: '/sfx/ding.mp3',
  buzz: '/sfx/buzz.mp3',
  tick: '/sfx/tick.mp3',
  fanfare: '/sfx/fanfare.mp3',
  lobby: '/sfx/lobby-loop.mp3',
} as const

export type SoundId = keyof typeof sounds
