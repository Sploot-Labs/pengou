/** Formats d'image acceptés à l'envoi ; la valeur sert aussi d'extension de fichier. */
export type ImageKind = 'png' | 'jpg' | 'webp' | 'gif'

function startsWith(buf: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false
  return sig.every((byte, i) => buf[offset + i] === byte)
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] // "GIF87a"
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] // "WEBP", à l'octet 8

/**
 * Détecte le format d'une image par ses octets magiques uniquement. Le nom de fichier et le
 * Content-Type envoyés par le client ne sont jamais consultés : un SVG ou un HTML renommé
 * `.png` renvoie `null`.
 */
export function sniffImageType(buf: Uint8Array): ImageKind | null {
  if (startsWith(buf, PNG)) return 'png'
  if (startsWith(buf, JPEG)) return 'jpg'
  if (startsWith(buf, GIF87A) || startsWith(buf, GIF89A)) return 'gif'
  if (startsWith(buf, RIFF) && startsWith(buf, WEBP, 8)) return 'webp'
  return null
}
