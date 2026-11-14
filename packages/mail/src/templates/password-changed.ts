import { DEFAULT_LANG, type Lang } from '@splootlabs/shared/i18n'
import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

const TEXT: Record<
  Lang,
  { subject: string; title: string; intro: string; action: string; after: string; preheader: string; button: string }
> = {
  fr: {
    subject: 'Votre mot de passe Pengou a été modifié',
    title: 'Votre mot de passe a été modifié',
    intro: 'Le mot de passe du compte Pengou associé à cette adresse vient de changer.',
    action:
      "Si c'est vous, vous n'avez rien à faire. Si ce n'est pas vous, choisissez sans attendre un nouveau mot de passe.",
    after: 'Par sécurité, tous les appareils connectés à ce compte ont été déconnectés.',
    preheader: "Si vous n'êtes pas à l'origine de ce changement, sécurisez votre compte.",
    button: 'Choisir un nouveau mot de passe',
  },
  en: {
    subject: 'Your Pengou password was changed',
    title: 'Your password was changed',
    intro: 'The password of the Pengou account linked to this address has just changed.',
    action: "If it was you, there is nothing to do. If it wasn't, choose a new password right away.",
    after: 'For security, all devices signed in to this account have been signed out.',
    preheader: "If you didn't make this change, secure your account.",
    button: 'Choose a new password',
  },
  es: {
    subject: 'Tu contraseña de Pengou ha cambiado',
    title: 'Tu contraseña ha cambiado',
    intro: 'La contraseña de la cuenta de Pengou asociada a esta dirección acaba de cambiar.',
    action: 'Si has sido tú, no tienes que hacer nada. Si no has sido tú, elige una contraseña nueva cuanto antes.',
    after: 'Por seguridad, se ha cerrado la sesión en todos los dispositivos conectados a esta cuenta.',
    preheader: 'Si no has hecho este cambio, protege tu cuenta.',
    button: 'Elegir una contraseña nueva',
  },
}

export function passwordChangedMail(d: { baseUrl: string; url: string; lang?: Lang }): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const lang = d.lang ?? DEFAULT_LANG
  const t = TEXT[lang]
  return {
    subject: t.subject,
    text: renderText({ title: t.title, body: [t.intro, t.action], url: d.url, after: [t.after], lang }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: t.preheader,
      title: t.title,
      introHtml: `<p style="${P_STYLE}">${escapeHtml(t.intro)}</p><p style="${P_STYLE}">${escapeHtml(t.action)}</p>`,
      buttonLabel: t.button,
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(t.after)}</p>`,
      lang,
    }),
  }
}
