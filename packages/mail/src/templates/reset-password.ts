import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

export function resetPasswordMail(d: { baseUrl: string; url: string }): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const title = 'Choisir un nouveau mot de passe'
  const intro =
    "Quelqu'un (probablement vous) a demandé à réinitialiser le mot de passe du compte associé à cette adresse."
  const after =
    "Ce lien est valable 1 heure et ne sert qu'une fois. Si vous n'êtes pas à l'origine de la demande, ignorez ce message : votre mot de passe ne change pas."
  return {
    subject: 'Réinitialiser votre mot de passe Pengou',
    text: renderText({ title, body: [intro], url: d.url, after: [after] }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: 'Choisissez un nouveau mot de passe pour votre compte Pengou.',
      title,
      introHtml: `<p style="${P_STYLE}">${escapeHtml(intro)}</p>`,
      buttonLabel: 'Choisir un mot de passe',
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(after)}</p>`,
    }),
  }
}
