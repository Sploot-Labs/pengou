import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

export function passwordChangedMail(d: { baseUrl: string; url: string }): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const title = 'Votre mot de passe a été modifié'
  const intro = 'Le mot de passe du compte Pengou associé à cette adresse vient de changer.'
  const action =
    "Si c'est vous, vous n'avez rien à faire. Si ce n'est pas vous, choisissez sans attendre un nouveau mot de passe."
  const after = 'Par sécurité, tous les appareils connectés à ce compte ont été déconnectés.'
  return {
    subject: 'Votre mot de passe Pengou a été modifié',
    text: renderText({ title, body: [intro, action], url: d.url, after: [after] }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: "Si vous n'êtes pas à l'origine de ce changement, sécurisez votre compte.",
      title,
      introHtml: `<p style="${P_STYLE}">${escapeHtml(intro)}</p><p style="${P_STYLE}">${escapeHtml(action)}</p>`,
      buttonLabel: 'Choisir un nouveau mot de passe',
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(after)}</p>`,
    }),
  }
}
