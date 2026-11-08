import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

export function verifyEmailMail(d: { baseUrl: string; url: string }): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const title = 'Confirmez votre adresse e-mail'
  const intro =
    'Bienvenue sur Pengou ! Un clic pour confirmer que cette adresse est bien la vôtre. Vous pourrez ensuite créer autant de quiz que vous voulez.'
  const after = "Lien valable 24 heures. Vous n'avez pas créé de compte ? Ignorez ce message."
  return {
    subject: 'Confirmez votre adresse e-mail Pengou',
    text: renderText({ title, body: [intro], url: d.url, after: [after] }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: 'Un clic pour confirmer votre adresse et créer autant de quiz que vous voulez.',
      title,
      introHtml: `<p style="${P_STYLE}">${escapeHtml(intro)}</p>`,
      buttonLabel: 'Confirmer mon adresse',
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(after)}</p>`,
    }),
  }
}
