import { describe, it, expect } from 'vitest'
import { toCsv } from './csv.js'

const CRLF = '\r\n'
const BOM = '﻿'

describe('toCsv — échappement RFC4180', () => {
  it('laisse un champ simple tel quel', () => {
    expect(toCsv([['a', 'b', 'c']])).toBe(`a,b,c${CRLF}`)
  })

  it('entoure de guillemets un champ contenant une virgule', () => {
    expect(toCsv([['a,b', 'c']])).toBe(`"a,b",c${CRLF}`)
  })

  it('entoure de guillemets et double les guillemets internes', () => {
    expect(toCsv([['he said "hi"']])).toBe(`"he said ""hi"""${CRLF}`)
  })

  it('entoure de guillemets un champ contenant un saut de ligne', () => {
    expect(toCsv([['line1\nline2']])).toBe(`"line1\nline2"${CRLF}`)
  })

  it('plusieurs lignes sont séparées par CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe(`a,b${CRLF}c,d${CRLF}`)
  })
})

describe('toCsv — neutralisation de l\'injection de formule', () => {
  it('préfixe une apostrophe devant une cellule string commençant par =', () => {
    expect(toCsv([['=1+1']])).toBe(`"'=1+1"${CRLF}`)
  })

  it('préfixe une apostrophe devant une cellule string commençant par @', () => {
    expect(toCsv([['@SUM(A1)']])).toBe(`"'@SUM(A1)"${CRLF}`)
  })

  it('préfixe une apostrophe devant une cellule string commençant par -', () => {
    expect(toCsv([['-5+3']])).toBe(`"'-5+3"${CRLF}`)
  })

  it('préfixe une apostrophe devant une cellule string commençant par +', () => {
    expect(toCsv([['+1']])).toBe(`"'+1"${CRLF}`)
  })

  it('préfixe une apostrophe devant une cellule string commençant par une tabulation', () => {
    expect(toCsv([['\tcmd']])).toBe(`"'\tcmd"${CRLF}`)
  })

  it('préfixe une apostrophe devant une cellule string commençant par un retour chariot', () => {
    expect(toCsv([['\rcmd']])).toBe(`"'\rcmd"${CRLF}`)
  })

  it('la neutralisation survit à l\'échappement : le contenu reste lisible comme texte pur', () => {
    // "'=1+1" une fois désérialisé par un lecteur CSV redonne exactement la cellule
    // neutralisée `'=1+1` — jamais interprétée comme une formule.
    const csv = toCsv([['=1+1', 'normal']])
    expect(csv).toBe(`"'=1+1",normal${CRLF}`)
    // Le guillemet ouvrant/fermant encadre bien tout le contenu neutralisé (apostrophe incluse).
    expect(csv.startsWith('"\'=')).toBe(true)
  })

  it('un nombre négatif (type number) n\'est PAS neutralisé — règle : seules les cellules string sont neutralisées', () => {
    expect(toCsv([[-5]])).toBe(`-5${CRLF}`)
    expect(toCsv([[-5.5]])).toBe(`-5.5${CRLF}`)
  })

  it('une chaîne qui ressemble à un nombre négatif reste une string et EST neutralisée', () => {
    // Si le nombre négatif arrive en string (ex: saisie utilisateur sérialisée), la règle
    // documentée s'applique quand même : neutralisation par préfixe (choix assumé, cf. rapport).
    expect(toCsv([['-5']])).toBe(`"'-5"${CRLF}`)
  })
})

describe('toCsv — contournement par espaces de tête (régression adversariale)', () => {
  it('neutralise "=1+1" précédé d\'un espace normal', () => {
    expect(toCsv([[' =1+1']])).toBe(`"' =1+1"${CRLF}`)
  })

  it('neutralise "=1+1" précédé d\'un espace insécable (NBSP)', () => {
    expect(toCsv([[' =1+1']])).toBe(`"' =1+1"${CRLF}`)
  })

  it('neutralise "=1+1" précédé d\'une tabulation (déjà couvert par le déclencheur brut de tête)', () => {
    expect(toCsv([['\t=1+1']])).toBe(`"'\t=1+1"${CRLF}`)
  })

  it('neutralise "@SUM(A1)" précédé d\'un espace', () => {
    expect(toCsv([[' @SUM(A1)']])).toBe(`"' @SUM(A1)"${CRLF}`)
  })

  it('neutralise "-2+3" précédé d\'un espace', () => {
    expect(toCsv([[' -2+3']])).toBe(`"' -2+3"${CRLF}`)
  })

  it('neutralise "+1" précédé d\'un espace', () => {
    expect(toCsv([[' +1']])).toBe(`"' +1"${CRLF}`)
  })

  it('neutralise une charge DDE précédée d\'un espace', () => {
    const payload = " =cmd|'/c calc'!A1"
    expect(toCsv([[payload]])).toBe(`"'${payload.replace(/"/g, '""')}"${CRLF}`)
  })

  it('une chaîne DÉJÀ préfixée par une apostrophe n\'est pas re-neutralisée (pas de double apostrophe)', () => {
    // Le premier caractère non-blanc est "'", qui n'est pas un déclencheur : le tableur
    // traite déjà la cellule comme du texte littéral, donc round-trip inchangé, sans quoting
    // forcé superflu (aucune virgule/guillemet/saut de ligne dans ce cas précis).
    expect(toCsv([["'=1+1"]])).toBe(`'=1+1${CRLF}`)
  })
})

describe('toCsv — nombres non-neutralisés (garde-fou de régression)', () => {
  it('-0 numérique se rend en "0", jamais neutralisé', () => {
    expect(toCsv([[-0]])).toBe(`0${CRLF}`)
  })

  it('1e21 numérique se rend en "1e+21", jamais neutralisé', () => {
    expect(toCsv([[1e21]])).toBe(`1e+21${CRLF}`)
  })

  it('NaN numérique se rend en "NaN", jamais neutralisé', () => {
    expect(toCsv([[NaN]])).toBe(`NaN${CRLF}`)
  })

  it('Infinity numérique se rend en "Infinity", jamais neutralisé', () => {
    expect(toCsv([[Infinity]])).toBe(`Infinity${CRLF}`)
  })
})

describe('toCsv — valeurs null et numériques', () => {
  it('null devient une cellule vide', () => {
    expect(toCsv([[null, 'x', null]])).toBe(`,x,${CRLF}`)
  })

  it('un nombre est rendu sans guillemets', () => {
    expect(toCsv([[42, 3.14]])).toBe(`42,3.14${CRLF}`)
  })

  it('un nombre entouré par ailleurs de champs à guillemets ne force pas ses propres guillemets', () => {
    expect(toCsv([[1, 'a,b', 2]])).toBe(`1,"a,b",2${CRLF}`)
  })
})

describe('toCsv — BOM UTF-8', () => {
  it('absent par défaut', () => {
    const csv = toCsv([['a']])
    expect(csv.startsWith(BOM)).toBe(false)
  })

  it('absent quand bom: false', () => {
    const csv = toCsv([['a']], { bom: false })
    expect(csv.startsWith(BOM)).toBe(false)
  })

  it('présent en tête quand bom: true', () => {
    const csv = toCsv([['a']], { bom: true })
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv).toBe(`${BOM}a${CRLF}`)
  })
})

describe('toCsv — cas limites', () => {
  it('une ligne sans cellule produit une ligne vide (juste CRLF)', () => {
    expect(toCsv([[]])).toBe(CRLF)
  })

  it('aucune ligne produit une chaîne vide', () => {
    expect(toCsv([])).toBe('')
  })

  it('une valeur composée uniquement d\'espaces est conservée telle quelle (pas de trim)', () => {
    expect(toCsv([['   ']])).toBe(`   ${CRLF}`)
  })

  it('une chaîne vide reste une chaîne vide non quotée', () => {
    expect(toCsv([['']])).toBe(`${CRLF}`)
  })
})
