import { escapeHtml } from './escape.js'
import type { RenderedMail } from './layout.js'
import { assertUrlUnderBase, P_STYLE, renderLayout, renderText, SMALL_STYLE } from './layout.js'

export type InvitationData = {
  baseUrl: string
  url: string
  inviterName: string
  workspaceName: string
  role: 'admin' | 'member'
  expiresAt: Date
}

const ROLE_LABEL = { admin: 'administrateur', member: 'membre' } as const
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(date)
}

export function invitationMail(d: InvitationData): RenderedMail {
  assertUrlUnderBase(d.baseUrl, d.url)
  const title = 'Une invitation vous attend !'
  const role = ROLE_LABEL[d.role]
  const intro = `${d.inviterName} vous propose de rejoindre son espace sur Pengou pour créer et animer des quiz ensemble.`
  const validity = `Invitation valable jusqu'au ${formatDate(d.expiresAt)}.`
  const ignore = `Vous ne connaissez pas ${d.inviterName} ? Ignorez simplement ce message.`
  const letter = escapeHtml(Array.from(d.workspaceName.trim())[0]?.toUpperCase() ?? '')

  const introHtml = `<p style="${P_STYLE}">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#EEF6FB;border-radius:12px;"><tr>
<td width="44" style="padding:12px 0 12px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-hidden="true"><tr><td width="44" height="44" align="center" bgcolor="#0A7188" style="width:44px;height:44px;background:#0A7188;border-radius:50%;font-family:${FONT};font-size:18px;font-weight:800;line-height:44px;color:#ffffff;">${letter}</td></tr></table></td>
<td style="padding:12px 14px 12px 12px;font-family:${FONT};"><div style="font-size:16px;font-weight:800;color:#0B2545;">${escapeHtml(d.workspaceName)}</div><div style="font-size:14px;color:#3d566b;">Rôle : ${role}</div></td>
</tr></table>`

  return {
    subject: `${d.inviterName} vous invite sur Pengou`,
    text: renderText({
      title,
      body: [intro, `Espace : ${d.workspaceName}`, `Rôle : ${role}`],
      url: d.url,
      after: [`${validity} ${ignore}`],
    }),
    html: renderLayout({
      baseUrl: d.baseUrl,
      preheader: `${d.inviterName} vous invite à rejoindre l'espace ${d.workspaceName}.`,
      title,
      introHtml,
      buttonLabel: "Rejoindre l'espace",
      url: d.url,
      afterHtml: `<p style="${SMALL_STYLE}">${escapeHtml(`${validity} ${ignore}`)}</p>`,
    }),
  }
}
