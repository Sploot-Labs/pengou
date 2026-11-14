import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DELIVERABILITY_MESSAGES } from '@splootlabs/mail'
import { placeholders } from '@splootlabs/shared/i18n'
import { authErrorKeys, csvCatalog, INDIRECT_MESSAGES, serverCatalog } from './catalog.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const serverSrc = join(here, '..')
const gameSrc = join(here, '..', '..', '..', '..', 'packages', 'game', 'src')

/** Sources non-test, hors du dossier i18n lui-même. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (path === here.replace(/[\\/]$/, '')) continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

const LITERAL = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60)`
/** Propriétés `error:` et `reason:`, `new XxxError(`, `refusal(` (routes/demo.ts) et constantes `XXX_MESSAGE =`.
 * Angles morts : une constante dont le nom ne finit pas par `_MESSAGE`, un littéral qui n'est pas le
 * premier argument, et les messages des autres paquets (packages/db, packages/quiz…) ; ceux-là vont
 * dans `INDIRECT_MESSAGES` ou dans la liste du test des messages construits autrement. */
const PATTERNS = [
  new RegExp(String.raw`\berror:\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`\breason:\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`\bnew\s+(?:[A-Z]\w*)?Error\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`\brefusal\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`\bconst\s+[A-Z_]+_MESSAGE\s*=\s*${LITERAL}`, 'g'),
]

/** Littéral source → texte, `${…}` devenant `{}`. */
function literalText(literal: string): string {
  const body = literal.slice(1, -1)
  if (literal.startsWith('`')) return body.replace(/\$\{[^}]*\}/g, '{}')
  return body.replace(/\\(.)/g, '$1')
}

/** Marqueurs nommés `{nom}` ramenés à `{}` pour comparer une clé à un gabarit source. */
function normalize(text: string): string {
  return text.replace(/\{\w*\}/g, '{}')
}

/** Assertions de programmation levées dans une route HTTP : Fastify les rend en 500 générique,
 * leur texte n'atteint jamais l'écran. */
const NEVER_SENT = new Set([
  'resolveTenantContext requires requireUser preHandler',
  "POST /api/demo : la création de l'invité n'a rendu aucun compte",
  'Identifiant de tenant inattendu.',
])

function extractMessages(): { message: string; where: string }[] {
  const found: { message: string; where: string }[] = []
  for (const file of [...sourceFiles(serverSrc), ...sourceFiles(gameSrc)]) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        const message = literalText(m[1] as string)
        if (NEVER_SENT.has(message)) continue
        const line = text.slice(0, m.index).split('\n').length
        found.push({
          message,
          where: `${relative(join(serverSrc, '..', '..', '..'), file)
            .split(sep)
            .join('/')}:${line}`,
        })
      }
    }
  }
  return found
}

const keysByShape = new Map(Object.keys(serverCatalog.en).map((key) => [normalize(key), key]))

describe('catalogue du serveur', () => {
  it('extrait bien les messages des sources (garde-fou du garde-fou)', () => {
    const messages = extractMessages().map((m) => m.message)
    expect(messages).toContain('Non authentifié.')
    expect(messages).toContain('session introuvable : {}')
    expect(messages).toContain("action réservée à l'hôte de la session")
    expect(messages).toContain('réponse invalide pour ce type de question')
    expect(messages).toContain('La partie est complète.')
    expect(messages.length).toBeGreaterThan(150)
  })

  it('couvre chaque message émis par le serveur et le moteur de jeu', () => {
    const missing = extractMessages()
      .filter(({ message }) => !keysByShape.has(normalize(message)))
      .map(({ message, where }) => `${where} ${message}`)
    expect(missing).toEqual([])
  })

  it('couvre les messages construits autrement (ternaires, constantes importées, Better Auth)', () => {
    const indirect = [...INDIRECT_MESSAGES, ...Object.values(DELIVERABILITY_MESSAGES), ...Object.values(authErrorKeys)]
    const missing = indirect.filter((message) => !Object.hasOwn(serverCatalog.en, message))
    expect(missing).toEqual([])
  })

  it('garde les mêmes marqueurs dans les trois langues', () => {
    const mismatched: string[] = []
    for (const catalog of [serverCatalog, csvCatalog] as { en: Record<string, string>; es: Record<string, string> }[]) {
      for (const key of Object.keys(catalog.en)) {
        const expected = placeholders(key).join(',')
        for (const lang of ['en', 'es'] as const) {
          const value = catalog[lang][key] ?? ''
          if (placeholders(value).join(',') !== expected) mismatched.push(`${lang}: ${key} -> ${value}`)
        }
      }
    }
    expect(mismatched).toEqual([])
  })

  it('respecte la typographie : traduction non vide, ni tiret cadratin ni demi-cadratin, apostrophe droite', () => {
    const faulty: string[] = []
    for (const lang of ['en', 'es'] as const) {
      for (const [key, value] of [...Object.entries(serverCatalog[lang]), ...Object.entries(csvCatalog[lang])]) {
        if (!value.trim() || /[–—’]/.test(value)) faulty.push(`${lang}: ${key} -> ${value}`)
      }
    }
    expect(faulty).toEqual([])
  })
})
