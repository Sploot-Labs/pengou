import { DEFAULT_LANG, type Lang } from '@splootlabs/shared/i18n'
import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

const TEXT: Record<
  Lang,
  { subject: string; title: string; intro: string; after: string; preheader: string; button: string }
> = {
  fr: {
    subject: 'Confirmez votre adresse e-mail Pengou',
    title: 'Confirmez votre adresse e-mail',
    intro:
      'Bienvenue sur Pengou ! Un clic pour confirmer que cette adresse est bien la vôtre. Vous pourrez ensuite créer autant de quiz que vous voulez.',
    after: "Lien valable 24 heures. Vous n'avez pas créé de compte ? Ignorez ce message.",
    preheader: 'Un clic pour confirmer votre adresse et créer autant de quiz que vous voulez.',
    button: 'Confirmer mon adresse',
  },
  en: {
    subject: 'Confirm your Pengou email address',
    title: 'Confirm your email address',
    intro:
      'Welcome to Pengou! One click to confirm that this address is yours. You can then create as many quizzes as you like.',
    after: "Link valid for 24 hours. Didn't create an account? Just ignore this message.",
    preheader: 'One click to confirm your address and create as many quizzes as you like.',
    button: 'Confirm my address',
  },
  es: {
    subject: 'Confirma tu dirección de correo en Pengou',
    title: 'Confirma tu dirección de correo',
    intro:
      '¡Te damos la bienvenida a Pengou! Un clic para confirmar que esta dirección es tuya. Después podrás crear todos los quiz que quieras.',
    after: 'Enlace válido durante 24 horas. ¿No has creado una cuenta? Ignora este mensaje.',
    preheader: 'Un clic para confirmar tu dirección y crear todos los quiz que quieras.',
    button: 'Confirmar mi dirección',
  },
}

export function verifyEmailMail(d: { baseUrl: string; url: string; lang?: Lang }): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const lang = d.lang ?? DEFAULT_LANG
  const t = TEXT[lang]
  return {
    subject: t.subject,
    text: renderText({ title: t.title, body: [t.intro], url: d.url, after: [t.after], lang }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: t.preheader,
      title: t.title,
      introHtml: `<p style="${P_STYLE}">${escapeHtml(t.intro)}</p>`,
      buttonLabel: t.button,
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(t.after)}</p>`,
      lang,
    }),
  }
}
