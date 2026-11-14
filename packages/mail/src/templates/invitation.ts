import { DEFAULT_LANG, type Lang } from '@splootlabs/shared/i18n'
import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, FONT, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

export type InvitationData = {
  baseUrl: string
  url: string
  inviterName: string
  workspaceName: string
  role: 'admin' | 'member'
  expiresAt: Date
  lang?: Lang
}

const TEXT: Record<
  Lang,
  {
    locale: string
    roles: Record<'admin' | 'member', string>
    rolePrefix: string
    workspacePrefix: string
    title: string
    subject: (inviter: string) => string
    intro: (inviter: string) => string
    validity: (date: string) => string
    ignore: (inviter: string) => string
    preheader: (inviter: string, workspace: string) => string
    button: string
  }
> = {
  fr: {
    locale: 'fr-FR',
    roles: { admin: 'administrateur', member: 'membre' },
    rolePrefix: 'Rôle : ',
    workspacePrefix: 'Espace : ',
    title: 'Une invitation vous attend !',
    subject: (i) => `${i} vous invite sur Pengou`,
    intro: (i) => `${i} vous propose de rejoindre son espace sur Pengou pour créer et animer des quiz ensemble.`,
    validity: (d) => `Invitation valable jusqu'au ${d}.`,
    ignore: (i) => `Vous ne connaissez pas ${i} ? Ignorez simplement ce message.`,
    preheader: (i, w) => `${i} vous invite à rejoindre l'espace ${w}.`,
    button: "Rejoindre l'espace",
  },
  en: {
    locale: 'en-US',
    roles: { admin: 'admin', member: 'member' },
    rolePrefix: 'Role: ',
    workspacePrefix: 'Workspace: ',
    title: 'An invitation is waiting for you!',
    subject: (i) => `${i} invites you to Pengou`,
    intro: (i) => `${i} invites you to join their workspace on Pengou to create and host quizzes together.`,
    validity: (d) => `Invitation valid until ${d}.`,
    ignore: (i) => `Don't know ${i}? Just ignore this message.`,
    preheader: (i, w) => `${i} invites you to join the workspace ${w}.`,
    button: 'Join the workspace',
  },
  es: {
    locale: 'es',
    roles: { admin: 'administrador', member: 'miembro' },
    rolePrefix: 'Rol: ',
    workspacePrefix: 'Espacio de trabajo: ',
    title: '¡Te espera una invitación!',
    subject: (i) => `${i} te invita a Pengou`,
    intro: (i) => `${i} te invita a unirte a su espacio de trabajo en Pengou para crear quiz y lanzar partidas juntos.`,
    validity: (d) => `Invitación válida hasta el ${d}.`,
    ignore: (i) => `¿No conoces a ${i}? Ignora este mensaje.`,
    preheader: (i, w) => `${i} te invita a unirte al espacio de trabajo ${w}.`,
    button: 'Unirme al espacio de trabajo',
  },
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(date)
}

export function invitationMail(d: InvitationData): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const lang = d.lang ?? DEFAULT_LANG
  const t = TEXT[lang]
  const title = t.title
  const role = t.roles[d.role]
  const intro = t.intro(d.inviterName)
  const validity = t.validity(formatDate(d.expiresAt, t.locale))
  const ignore = t.ignore(d.inviterName)
  const letter = escapeHtml(Array.from(d.workspaceName.trim())[0]?.toUpperCase() ?? '')

  const introHtml = `<p style="${P_STYLE}">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#EEF6FB;border-radius:12px;"><tr>
<td width="44" style="padding:12px 0 12px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-hidden="true"><tr><td width="44" height="44" align="center" bgcolor="#0A7188" style="width:44px;height:44px;background:#0A7188;border-radius:50%;font-family:${FONT};font-size:18px;font-weight:800;line-height:44px;color:#ffffff;">${letter}</td></tr></table></td>
<td style="padding:12px 14px 12px 12px;font-family:${FONT};"><div style="font-size:16px;font-weight:800;color:#0B2545;">${escapeHtml(d.workspaceName)}</div><div style="font-size:14px;color:#3d566b;">${t.rolePrefix}${role}</div></td>
</tr></table>`

  return {
    subject: t.subject(d.inviterName).replace(/[\r\n]+/g, ' '),
    text: renderText({
      title,
      body: [intro, `${t.workspacePrefix}${d.workspaceName}`, `${t.rolePrefix}${role}`],
      url: d.url,
      after: [`${validity} ${ignore}`],
      lang,
    }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: t.preheader(d.inviterName, d.workspaceName),
      title,
      introHtml,
      buttonLabel: t.button,
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(`${validity} ${ignore}`)}</p>`,
      lang,
    }),
  }
}
