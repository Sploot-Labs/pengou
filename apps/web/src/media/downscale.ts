/** Côté le plus long d'une image envoyée ; au-delà, elle est réduite dans le navigateur. */
export const MAX_UPLOAD_WIDTH = 1600

/** Taille maximale acceptée par le serveur (2 Mo). */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** Qualité des réencodages JPEG et WebP. */
const QUALITY = 0.85

/** Dimensions cibles, côté le plus long ramené à `maxSide`, en conservant le ratio ; n'agrandit jamais. */
export function targetSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  if (Math.max(width, height) <= maxSide) return { width, height }
  if (width >= height) return { width: maxSide, height: Math.round((height * maxSide) / width) }
  return { width: Math.round((width * maxSide) / height), height: maxSide }
}

/** Image prête à l'envoi ; `transformed` indique qu'une réduction ou un réencodage a été tenté. */
export interface PreparedImage {
  blob: Blob
  transformed: boolean
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}

/**
 * Prépare une image pour l'envoi. Un GIF est renvoyé tel quel (le canvas aplatirait l'animation).
 * Sinon, une image dont le côté le plus long dépasse 1600 px est redessinée à la taille cible dans
 * le même type MIME, et si le résultat (ou l'original) dépasse encore 2 Mo, il est réencodé en
 * JPEG (qualité 0,85, fond blanc sous la transparence).
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (file.type === 'image/gif') return { blob: file, transformed: false }
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height, MAX_UPLOAD_WIDTH)
    const resize = width !== bitmap.width || height !== bitmap.height
    if (!resize && file.size <= UPLOAD_MAX_BYTES) return { blob: file, transformed: false }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { blob: file, transformed: false }
    ctx.drawImage(bitmap, 0, 0, width, height)
    let blob: Blob = resize ? ((await encode(canvas, file.type)) ?? file) : file
    if (blob.size > UPLOAD_MAX_BYTES) {
      // Le JPEG n'a pas de transparence : fond blanc glissé sous l'image plutôt que noir.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      blob = (await encode(canvas, 'image/jpeg')) ?? blob
    }
    return { blob, transformed: true }
  } finally {
    bitmap.close()
  }
}
