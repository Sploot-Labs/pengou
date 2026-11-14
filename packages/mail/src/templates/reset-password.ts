import { DEFAULT_LANG, type Lang } from '@splootlabs/shared/i18n'
import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

const TEXT: Record<
  Lang,
  { subject: string; title: string; intro: string; after: string; preheader: string; button: string }
> = {
  fr: {
    subject: 'Réinitialiser votre mot de passe Pengou',
    title: 'Choisir un nouveau mot de passe',
    intro: "Quelqu'un (probablement vous) a demandé à réinitialiser le mot de passe du compte associé à cette adresse.",
    after:
      "Ce lien est valable 1 heure et ne sert qu'une fois. Si vous n'êtes pas à l'origine de la demande, ignorez ce message : votre mot de passe ne change pas.",
    preheader: 'Choisissez un nouveau mot de passe pour votre compte Pengou.',
    button: 'Choisir un mot de passe',
  },
  en: {
    subject: 'Reset your Pengou password',
    title: 'Choose a new password',
    intro: 'Someone (probably you) asked to reset the password of the account linked to this address.',
    after:
      "This link is valid for 1 hour and can only be used once. If you didn't make this request, ignore this message: your password won't change.",
    preheader: 'Choose a new password for your Pengou account.',
    button: 'Choose a password',
  },
  es: {
    subject: 'Restablece tu contraseña de Pengou',
    title: 'Elige una contraseña nueva',
    intro: 'Alguien (probablemente tú) ha pedido restablecer la contraseña de la cuenta asociada a esta dirección.',
    after:
      'Este enlace es válido durante 1 hora y solo sirve una vez. Si no has hecho esta solicitud, ignora este mensaje: tu contraseña no cambiará.',
    preheader: 'Elige una contraseña nueva para tu cuenta de Pengou.',
    button: 'Elegir una contraseña',
  },
}

export function resetPasswordMail(d: { baseUrl: string; url: string; lang?: Lang }): RenderedMail {
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
