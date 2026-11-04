import { describe, expect, it } from 'vitest'
import { escapeHtml, invitationMail, resetPasswordMail, verifyEmailMail } from '../index.js'

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

describe('escapeHtml', () => {
  it('échappe les cinq caractères sensibles', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
})
