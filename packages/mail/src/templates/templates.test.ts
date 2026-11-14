import type { Lang } from '@splootlabs/shared/i18n'
import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  invitationMail,
  passwordChangedMail,
  resetPasswordMail,
  trimBase,
  verifyEmailMail,
} from '../index.js'

const baseUrl = 'https://app.pengou.fr'
const url = 'https://app.pengou.fr/action/abc123'
const bad = 'https://evil.example/x'

const inv = (over: Partial<Parameters<typeof invitationMail>[0]> = {}) =>
  invitationMail({
    baseUrl,
    url,
    inviterName: 'Camille Martin',
    workspaceName: 'Lycée Victor Hugo, SVT',
    role: 'member',
    expiresAt: new Date('2026-11-11T10:00:00Z'),
    ...over,
  })

const cases = [
  {
    nom: 'invitation',
    make: (u: string) => inv({ url: u }),
    subject: 'Camille Martin vous invite sur Pengou',
    title: 'Une invitation vous attend !',
  },
  {
    nom: 'réinitialisation',
    make: (u: string) => resetPasswordMail({ baseUrl, url: u }),
    subject: 'Réinitialiser votre mot de passe Pengou',
    title: 'Choisir un nouveau mot de passe',
  },
  {
    nom: 'mot de passe modifié',
    make: (u: string) => passwordChangedMail({ baseUrl, url: u }),
    subject: 'Votre mot de passe Pengou a été modifié',
    title: 'Votre mot de passe a été modifié',
  },
  {
    nom: 'confirmation',
    make: (u: string) => verifyEmailMail({ baseUrl, url: u }),
    subject: 'Confirmez votre adresse e-mail Pengou',
    title: 'Confirmez votre adresse e-mail',
  },
]

describe.each(cases)('gabarit $nom', ({ make, subject, title }) => {
  const mail = make(url)
  it('a le bon sujet', () => expect(mail.subject).toBe(subject))
  it('a une structure HTML accessible', () => {
    expect(mail.html).toContain('lang="fr"')
    expect(mail.html).toContain('alt="Pengou"')
    expect(mail.html).toContain('role="presentation"')
    expect(mail.html.match(/<h1/g)).toHaveLength(1)
    expect(mail.html).toContain(`${baseUrl}/email/logo.png`)
  })
  it('contient le lien deux fois dans le HTML', () => {
    expect(mail.html.split(`href="${url}"`)).toHaveLength(3)
  })
  it('a un texte avec lien et titre', () => {
    expect(mail.text).toContain(url)
    expect(mail.text).toContain(title)
  })
  it('évite les caractères typographiques proscrits', () => {
    for (const s of [mail.text, mail.html, mail.subject]) expect(s).not.toMatch(/[·—–]/)
  })
  it('refuse une URL hors de baseUrl', () => {
    expect(() => make(bad)).toThrow()
  })
})

describe('invitation', () => {
  it('échappe le HTML mais pas le texte', () => {
    const name = '<script>alert(1)</script> & "Co"'
    const mail = inv({ inviterName: name })
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.html).toContain('&quot;')
    expect(mail.html).not.toContain('<script>')
    expect(mail.text).toContain(name)
  })
  it('affiche la date en français', () => {
    const mail = inv()
    expect(mail.html).toContain('11 novembre 2026')
    expect(mail.text).toContain('11 novembre 2026')
  })
  it("affiche le rôle et la lettre de l'espace", () => {
    expect(inv().html).toContain('Rôle : membre')
    expect(inv({ role: 'admin', workspaceName: 'école' }).html).toContain('Rôle : administrateur')
    expect(inv({ workspaceName: 'école' }).html).toMatch(/>É<\/td>/)
  })
})

describe('mot de passe modifié', () => {
  it("dit quoi faire si le changement n'est pas du titulaire, sans jeton dans le lien", () => {
    const lien = 'https://app.pengou.fr/forgot-password'
    const mail = passwordChangedMail({ baseUrl, url: lien })
    expect(mail.text).toContain("Si ce n'est pas vous")
    expect(mail.html).toContain('Si ce n&#39;est pas vous')
    expect(mail.text).toContain(lien)
  })
})

describe("garde d'URL et sujet", () => {
  it('refuse les hôtes qui ressemblent à la base', () => {
    expect(() => inv({ url: 'https://app.pengou.fr.evil.com/x' })).toThrow()
    expect(() => inv({ url: 'https://app.pengou.frevil.com/x' })).toThrow()
  })
  it('accepte une base avec barre finale', () => {
    expect(() => inv({ baseUrl: 'https://app.pengou.fr/', url: 'https://app.pengou.fr/invitations/abc' })).not.toThrow()
  })
  it('retire les sauts de ligne du sujet', () => {
    const mail = inv({ inviterName: 'Camille\r\nBcc: x@y' })
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.subject).toBe('Camille Bcc: x@y vous invite sur Pengou')
  })
})

describe('trimBase', () => {
  it.each([
    ['https://app.pengou.fr', 'https://app.pengou.fr'],
    ['https://app.pengou.fr/', 'https://app.pengou.fr'],
    ['https://app.pengou.fr/pengou///', 'https://app.pengou.fr/pengou'],
    ['///', ''],
    ['', ''],
  ])('réduit %j à %j', (entree, attendu) => {
    expect(trimBase(entree)).toBe(attendu)
  })
  it('garde les barres qui ne sont pas finales, même très nombreuses', () => {
    const entree = `${'/'.repeat(100_000)}x`
    expect(trimBase(entree)).toBe(entree)
  })
})

describe('escapeHtml', () => {
  it('échappe les cinq caractères sensibles', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
})

describe('langues des gabarits', () => {
  const makers = {
    verify: (lang: Lang) => verifyEmailMail({ baseUrl, url, lang }),
    reset: (lang: Lang) => resetPasswordMail({ baseUrl, url, lang }),
    changed: (lang: Lang) => passwordChangedMail({ baseUrl, url, lang }),
    invitation: (lang: Lang) => inv({ lang }),
  }
  const expected: Record<keyof typeof makers, Record<Lang, { subject: string; title: string }>> = {
    verify: {
      fr: { subject: 'Confirmez votre adresse e-mail Pengou', title: 'Confirmez votre adresse e-mail' },
      en: { subject: 'Confirm your Pengou email address', title: 'Confirm your email address' },
      es: { subject: 'Confirma tu dirección de correo en Pengou', title: 'Confirma tu dirección de correo' },
    },
    reset: {
      fr: { subject: 'Réinitialiser votre mot de passe Pengou', title: 'Choisir un nouveau mot de passe' },
      en: { subject: 'Reset your Pengou password', title: 'Choose a new password' },
      es: { subject: 'Restablece tu contraseña de Pengou', title: 'Elige una contraseña nueva' },
    },
    changed: {
      fr: { subject: 'Votre mot de passe Pengou a été modifié', title: 'Votre mot de passe a été modifié' },
      en: { subject: 'Your Pengou password was changed', title: 'Your password was changed' },
      es: { subject: 'Tu contraseña de Pengou ha cambiado', title: 'Tu contraseña ha cambiado' },
    },
    invitation: {
      fr: { subject: 'Camille Martin vous invite sur Pengou', title: 'Une invitation vous attend !' },
      en: { subject: 'Camille Martin invites you to Pengou', title: 'An invitation is waiting for you!' },
      es: { subject: 'Camille Martin te invita a Pengou', title: '¡Te espera una invitación!' },
    },
  }
  const cases = (Object.keys(makers) as (keyof typeof makers)[]).flatMap((nom) =>
    (['fr', 'en', 'es'] as const).map((lang) => ({ nom, lang, ...expected[nom][lang] })),
  )
  it.each(cases)('$nom en $lang', ({ nom, lang, subject, title }) => {
    const mail = makers[nom](lang)
    expect(mail.subject).toBe(subject)
    expect(mail.text).toContain(title)
    expect(mail.html).toContain(title.replace(/'/g, '&#39;'))
    expect(mail.html).toContain(`<html lang="${lang}">`)
    for (const s of [mail.text, mail.html, mail.subject]) expect(s).not.toMatch(/[·—–]/)
  })
  it('sans langue, le français', () => {
    expect(verifyEmailMail({ baseUrl, url }).html).toContain('<html lang="fr">')
  })
  it("date et rôle de l'invitation dans la langue", () => {
    expect(inv({ lang: 'en' }).text).toContain('November 11, 2026')
    expect(inv({ lang: 'es' }).text).toContain('11 de noviembre de 2026')
    expect(inv({ lang: 'en' }).html).toContain('Role: member')
    expect(inv({ lang: 'es', role: 'admin' }).html).toContain('Rol: administrador')
  })
})
