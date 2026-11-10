import { escapeHtml } from './escape.js'

export type RenderedMail = { subject: string; text: string; html: string }

const NAVY = '#0B2545'
const MUTED = '#3d566b'
const LINK = '#0A7188'
export const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Retire les barres finales de l'adresse de base. */
export function trimBase(baseUrl: string): string {
  let end = baseUrl.length
  while (end > 0 && baseUrl[end - 1] === '/') end--
  return baseUrl.slice(0, end)
}

/** Refuse tout lien d'action qui ne part pas de l'adresse publique de l'app. */
export function assertUrlUnderBase(baseUrl: string, url: string): void {
  const erreur = new Error("Le lien d'action ne part pas de l'adresse de base")
  let base: URL
  let cible: URL
  try {
    base = new URL(baseUrl)
    cible = new URL(url)
  } catch {
    throw erreur
  }
  const prefixe = base.pathname.replace(/\/+$/, '')
  const dansLeChemin = cible.pathname === prefixe || cible.pathname.startsWith(`${prefixe}/`)
  if (cible.origin !== base.origin || !dansLeChemin) throw erreur
}

export const P_STYLE = `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.55;color:${NAVY};`
export const SMALL_STYLE = `margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED};`

export const FOOTER_TEXT = 'Pengou, des quiz en direct pour la classe. Une question ? Répondez à cet e-mail.'

function shape(color: string, radius: string): string {
  return `<td width="22" height="22" bgcolor="${color}" style="width:22px;height:22px;background:${color};font-size:0;line-height:0;${radius}">&nbsp;</td>`
}

/** Quatre formes de réponse décoratives, en cellules de tableau (carré, carré arrondi, rond, losange). */
function shapes(): string {
  const gap = '<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>'
  const diamond = `<td width="22" height="22" align="center" style="width:22px;height:22px;font-size:20px;line-height:22px;color:#ff9ec4;">&#9670;</td>`
  return `<div aria-hidden="true"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>${shape('#5b4bd6', '')}${gap}${diamond}${gap}${shape('#007a99', 'border-radius:50%;')}${gap}${shape('#bdebf7', 'border-radius:5px;')}</tr></table></div>`
}

export type LayoutInput = {
  baseUrl: string
  preheader: string
  title: string
  /** HTML déjà échappé, placé entre le titre et le bouton. */
  introHtml: string
  buttonLabel: string
  url: string
  /** HTML déjà échappé, placé sous le lien de secours. */
  afterHtml: string
}

export function renderLayout(i: LayoutInput): string {
  const url = escapeHtml(i.url)
  const logo = escapeHtml(`${trimBase(i.baseUrl)}/email/logo.png`)
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(i.title)}</title>
</head>
<body style="margin:0;padding:0;background:#EEF6FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#EEF6FB;">${escapeHtml(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF6FB;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #d6e6ef;border-radius:16px;">
<tr><td style="padding:24px 26px 6px;"><img src="${logo}" alt="Pengou" width="154" height="40" style="display:block;width:154px;height:40px;border:0;"></td></tr>
<tr><td style="padding:14px 26px 26px;font-family:${FONT};color:${NAVY};">
${shapes()}
<h1 style="margin:0 0 12px;font-family:${FONT};font-size:23px;line-height:1.25;font-weight:800;color:${NAVY};">${escapeHtml(i.title)}</h1>
${i.introHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td bgcolor="#0B2545" style="background:#0B2545;border-radius:999px;"><a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;">${escapeHtml(i.buttonLabel)}</a></td></tr></table>
<p style="${SMALL_STYLE}">Le bouton ne fonctionne pas ? Copiez ce lien :<br><a href="${url}" style="color:${LINK};text-decoration:underline;word-break:break-all;">${url}</a></p>
${i.afterHtml}
</td></tr>
<tr><td style="padding:16px 26px;background:#f6fafc;border-top:1px solid #e3eef4;border-radius:0 0 16px 16px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(FOOTER_TEXT)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`
}

/** Version texte commune : titre, corps, lien, mentions, pied. */
export function renderText(parts: { title: string; body: string[]; url: string; after: string[] }): string {
  return [
    parts.title,
    '',
    ...parts.body.flatMap((l) => [l, '']),
    'Ouvrez ce lien :',
    parts.url,
    '',
    ...parts.after.flatMap((l) => [l, '']),
    '--',
    FOOTER_TEXT,
    '',
  ].join('\n')
}
