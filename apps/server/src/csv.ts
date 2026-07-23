/**
 * Sérialisation CSV sûre (RFC4180 + neutralisation de l'injection de formule).
 *
 * Règle d'ordre des opérations pour chaque cellule STRING (déterminante pour la sécurité) :
 *   1. Neutralisation d'abord : si la cellule commence par un caractère qu'un tableur
 *      interprète comme un déclencheur de formule/commande (`=`, `+`, `-`, `@`, TAB, CR),
 *      on préfixe une apostrophe `'`. Cette apostrophe force l'ouverture d'un texte littéral
 *      dans Excel/Sheets/LibreOffice : la cellule ne sera jamais évaluée.
 *   2. Échappement RFC4180 ensuite : toute cellule neutralisée est TOUJOURS entourée de
 *      guillemets (défense en profondeur — certains parseurs pourraient sinon perdre
 *      l'apostrophe de tête si elle apparaît en clair) ; les guillemets internes éventuels
 *      sont doublés comme d'habitude.
 *   Faire l'inverse (échapper puis neutraliser) casserait le format : l'apostrophe se
 *   retrouverait après l'éventuel guillemet ouvrant plutôt qu'en tête réelle du contenu.
 *
 * Seules les cellules de type `string` sont neutralisées. Un `number` négatif légitime
 * (ex: score de -5) n'est JAMAIS neutralisé : il est rendu via `String(n)` sans jamais
 * passer par la neutralisation ni le quoting, puisqu'un nombre ne peut contenir ni virgule,
 * ni guillemet, ni saut de ligne. C'est l'appelant qui décide du typage (repos de rapport :
 * les scores/compteurs doivent être passés en `number`, jamais en `string`, pour rester
 * lisibles tels quels dans le tableur).
 *
 * **Contournement par espaces de tête (corrigé)** : un déclencheur de formule précédé
 * d'espace(s) — espace normal, NBSP, tab non-déclencheur, etc. — reste un déclencheur pour
 * Excel/Sheets, qui ignorent les blancs de tête avant d'évaluer une cellule. On détecte donc
 * `=`/`+`/`-`/`@` après avoir retiré les blancs de tête (`\s` JS couvre espace, NBSP, tab...),
 * tandis que TAB/CR ne comptent que s'ils sont le tout premier caractère brut (ce sont eux-
 * mêmes des déclencheurs bruts pour certains tableurs, pas seulement des blancs à ignorer).
 * L'apostrophe de neutralisation est toujours préfixée à la valeur ORIGINALE (non trimée) :
 * on ne modifie jamais le contenu, seulement son statut d'évaluation.
 */

const FORMULA_TRIGGER_AFTER_TRIM = /^[=+\-@]/
const LEADING_TAB_OR_CR = /^[\t\r]/
const NEEDS_QUOTING = /["\n\r]/

function isFormulaLike(value: string): boolean {
  const trimmed = value.replace(/^\s+/, '')
  return FORMULA_TRIGGER_AFTER_TRIM.test(trimmed) || LEADING_TAB_OR_CR.test(value)
}

function formatCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value)

  const neutralized = isFormulaLike(value) ? `'${value}` : value
  const forceQuote = neutralized !== value // une neutralisation a eu lieu
  const needsQuoting = forceQuote || value.includes(',') || NEEDS_QUOTING.test(neutralized)

  if (!needsQuoting) return neutralized
  return `"${neutralized.replace(/"/g, '""')}"`
}

export function toCsv(rows: (string | number | null)[][], opts?: { bom?: boolean }): string {
  const bom = opts?.bom ? '﻿' : ''
  if (rows.length === 0) return bom

  const lines = rows.map((row) => row.map(formatCell).join(','))
  return bom + lines.join('\r\n') + '\r\n'
}
