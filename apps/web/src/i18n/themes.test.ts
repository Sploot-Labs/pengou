import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { builtInThemeLabels, themeLabel } from './catalog/themes'

const themesJson = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'library',
  'catalog',
  'themes.json',
)
const builtIn = JSON.parse(readFileSync(themesJson, 'utf8')) as { id: string; label: string }[]

describe('libellés des thèmes intégrés de la bibliothèque', () => {
  it('traduit chaque thème de packages/library/catalog/themes.json en anglais et en espagnol', () => {
    const ids = builtIn.map((theme) => theme.id).sort()
    expect(Object.keys(builtInThemeLabels.en).sort()).toEqual(ids)
    expect(Object.keys(builtInThemeLabels.es).sort()).toEqual(ids)
    for (const lang of ['en', 'es'] as const) {
      for (const label of Object.values(builtInThemeLabels[lang])) expect(label).not.toMatch(/^\s*$|[–—’]/)
    }
  })

  it('garde le libellé enregistré en français et pour un thème inconnu', () => {
    expect(themeLabel('histoire', 'Histoire', 'fr')).toBe('Histoire')
    expect(themeLabel('histoire', 'Histoire', 'en')).toBe('History')
    expect(themeLabel('histoire', 'Histoire', 'es')).toBe('Historia')
    expect(themeLabel('astronomie-locale', 'Astronomie locale', 'en')).toBe('Astronomie locale')
    expect(themeLabel('toString', 'Divers', 'en')).toBe('Divers')
  })
})
