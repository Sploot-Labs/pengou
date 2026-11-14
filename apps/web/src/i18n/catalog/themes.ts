import type { Lang } from '@splootlabs/shared/i18n'

/**
 * Libellés traduits des thèmes intégrés de la bibliothèque (packages/library/catalog/themes.json),
 * par identifiant : la base les enregistre en français. Un thème ajouté par une instance n'y figure
 * pas et garde son libellé enregistré. Le garde-fou `themes.test.ts` vérifie que chaque thème
 * intégré y est.
 */
export const builtInThemeLabels = {
  en: {
    cinema: 'Movies',
    musique: 'Music',
    sport: 'Sports',
    histoire: 'History',
    geographie: 'Geography',
    sciences: 'Science',
    litterature: 'Literature',
    art: 'Art',
    nature: 'Nature',
    gastronomie: 'Food',
    'jeux-video': 'Video games',
    'culture-generale': 'General knowledge',
    television: 'Television',
    people: 'Celebrities',
  },
  es: {
    cinema: 'Cine',
    musique: 'Música',
    sport: 'Deportes',
    histoire: 'Historia',
    geographie: 'Geografía',
    sciences: 'Ciencias',
    litterature: 'Literatura',
    art: 'Arte',
    nature: 'Naturaleza',
    gastronomie: 'Gastronomía',
    'jeux-video': 'Videojuegos',
    'culture-generale': 'Cultura general',
    television: 'Televisión',
    people: 'Famosos',
  },
} satisfies Record<Exclude<Lang, 'fr'>, Record<string, string>>

/** Libellé d'un thème dans la langue demandée : en français, le libellé enregistré ; sinon la
 * traduction d'un thème intégré, ou à défaut le libellé enregistré. */
export function themeLabel(id: string, storedLabel: string, lang: Lang): string {
  if (lang === 'fr') return storedLabel
  const labels: Record<string, string> = builtInThemeLabels[lang]
  return Object.hasOwn(labels, id) ? (labels[id] as string) : storedLabel
}
