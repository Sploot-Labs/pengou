// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeholders } from '@splootlabs/shared/i18n'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createBrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../api/client'
import { catalog } from './catalog'
import { LanguageSelect } from './LanguageSelect'
import { getLang, LANG_STORAGE_KEY, setLang } from './lang'
import { t, tc, tp } from './t'
import { useT } from './useT'

type LangModule = typeof import('./lang')

/** Charge une copie neuve du module pour rejouer l'initialisation de la première lecture. */
async function freshLang(): Promise<LangModule> {
  vi.resetModules()
  return import('./lang')
}

function setNavigatorLanguages(languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
}

// vi.resetModules() fait vivre des copies du module ; on remet à zéro celle que ce fichier importe.
beforeEach(() => setLang('fr'))
afterEach(cleanup)

describe('détection de la langue', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
    window.localStorage.clear()
  })

  it("?lang=es l'emporte sur le stockage et est enregistré", async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en')
    window.history.replaceState(null, '', '/join?lang=es')
    const mod = await freshLang()
    expect(mod.getLang()).toBe('es')
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('es')
  })

  it("retire ?lang= de l'adresse en gardant les autres paramètres et le fragment", async () => {
    window.history.replaceState(null, '', '/join?lang=es&from=x#h')
    const mod = await freshLang()
    expect(mod.getLang()).toBe('es')
    expect(window.location.search).toBe('?from=x')
    expect(window.location.hash).toBe('#h')
    expect(window.location.pathname).toBe('/join')
  })

  it("le routeur créé après l'import de lang ne voit plus ?lang=", async () => {
    window.history.replaceState(null, '', '/x?lang=es&y=1')
    await freshLang()
    const router = createBrowserRouter([{ path: '/x', element: null }])
    expect(router.state.location.search).toBe('?y=1')
    router.dispose()
  })

  it('?lang=de est ignoré', async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'en')
    window.history.replaceState(null, '', '/join?lang=de')
    const mod = await freshLang()
    expect(mod.getLang()).toBe('en')
  })

  it('lit le stockage', async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'es')
    expect((await freshLang()).getLang()).toBe('es')
  })

  it('se rabat sur navigator.languages', async () => {
    setNavigatorLanguages(['en-US'])
    expect((await freshLang()).getLang()).toBe('en')
  })

  it('reste en français quand le stockage lève et que le navigateur est en allemand', async () => {
    setNavigatorLanguages(['de-DE'])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect((await freshLang()).getLang()).toBe('fr')
  })

  it('setLang pose <html lang> même quand setItem lève', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => setLang('en')).not.toThrow()
    expect(document.documentElement.lang).toBe('en')
    expect(getLang()).toBe('en')
  })
})

describe("titre de l'onglet", () => {
  it('suit la langue, et reste en français exactement celui de index.html', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8')
    const frenchTitle = /<title>(.*)<\/title>/.exec(html)?.[1]
    setLang('en')
    expect(document.title).toBe('Pengou, the app: join or host a game')
    setLang('es')
    expect(document.title).toBe('Pengou, la aplicación: únete a una partida u organiza una')
    setLang('fr')
    expect(document.title).toBe(frenchTitle)
    expect(document.title).toBe("Pengou, l'application : rejoindre ou animer une partie")
  })
})

function Probe() {
  const { t: tr } = useT()
  return <p>{tr('Annuler')}</p>
}

describe('traduction', () => {
  it('le composant se retraduit via LanguageSelect sans démontage', () => {
    render(
      <>
        <LanguageSelect />
        <Probe />
      </>,
    )
    expect(screen.getByText('Annuler')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByLabelText('Interface language')).toBeInTheDocument()
  })

  it('le sélecteur propose les trois langues avec leur attribut lang', () => {
    render(<LanguageSelect />)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Français', 'English', 'Español'])
    expect(options.map((o) => o.getAttribute('lang'))).toEqual(['fr', 'en', 'es'])
  })

  it('tp donne le singulier à zéro en français et le pluriel en anglais', () => {
    expect(tp(0, '{n} joueur', '{n} joueurs')).toBe('0 joueur')
    act(() => setLang('en'))
    expect(tp(0, '{n} joueur', '{n} joueurs')).toBe('0 players')
    expect(tp(1, '{n} joueur', '{n} joueurs')).toBe('1 player')
    act(() => setLang('es'))
    expect(tp(0, '{n} joueur', '{n} joueurs')).toBe('0 jugadores')
  })

  it('t interpole et garde le français en français', () => {
    expect(t('Erreur {status}', { status: 418 })).toBe('Erreur 418')
    act(() => setLang('es'))
    expect(t('Annuler')).toBe('Cancelar')
  })

  it('tc distingue « Annuler » (défaire) de « Annuler » (renoncer)', () => {
    expect(tc('Annuler', 'undo')).toBe('Annuler')
    act(() => setLang('en'))
    expect(tc('Annuler', 'undo')).toBe('Undo')
    expect(t('Annuler')).toBe('Cancel')
    act(() => setLang('es'))
    expect(tc('Annuler', 'undo')).toBe('Deshacer')
    expect(t('Annuler')).toBe('Cancelar')
  })
})

describe('Accept-Language', () => {
  afterEach(() => vi.restoreAllMocks())

  it('apiGet envoie la langue courante', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    setLang('es')
    await apiGet('/api/x')
    const init = spy.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('es')
  })

  it('le message de repli est traduit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    setLang('en')
    await expect(apiGet('/api/x')).rejects.toThrow('Item not found.')
  })
})

describe('catalogues', () => {
  it('chaque clé garde les mêmes marqueurs en en et en es', () => {
    for (const key of Object.keys(catalog.en) as (keyof typeof catalog.en)[]) {
      expect(placeholders(catalog.en[key]), key).toEqual(placeholders(key))
      expect(placeholders(catalog.es[key]), key).toEqual(placeholders(key))
    }
  })
})
