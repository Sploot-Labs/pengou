/**
 * Catalogue de sons « banquise ». Les cues (registry.ts) référencent une CLÉ,
 * jamais une recette directement. Les sons sont synthétisés en Web Audio (voir
 * `synth.ts`, qui fournit une recette par clé de ce catalogue) : rien à
 * héberger, pas de fichier mp3. Ce fichier ne garde que les métadonnées
 * (libellé lisible, boucle ou non) partagées par le moteur et la page de démo.
 */
export const sounds = {
  lobby: { label: 'Ambiance lobby', loop: true },
  question: { label: 'Nouvelle question' },
  reading: { label: 'Lecture (préparez-vous)' },
  reveal: { label: 'Révélation' },
  scoreboard: { label: 'Classement' },
  podium: { label: 'Podium (fanfare)' },
  correct: { label: 'Bonne réponse' },
  incorrect: { label: 'Mauvaise réponse' },
  tick: { label: 'Tic du chrono' },
  tap: { label: 'Validation' },
  join: { label: 'Arrivée joueur' },
} as const

export type SoundId = keyof typeof sounds
