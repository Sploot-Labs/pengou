/** Largeur maximale d'une image envoyée ; au-delà, elle est réduite dans le navigateur. */
export const MAX_UPLOAD_WIDTH = 1600

/** Taille maximale acceptée par le serveur (2 Mo). */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** Dimensions cibles en conservant le ratio ; n'agrandit jamais. */
export function targetSize(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height }
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) }
}

/**
 * Prépare une image pour l'envoi : renvoyée telle quelle si elle fait 1600 px de large au plus
 * ou si c'est un GIF (le canvas aplatirait l'animation), sinon redessinée à la taille cible
 * dans le même type MIME (JPEG et WebP en qualité 0,85).
 */
export async function prepareImageForUpload(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width <= MAX_UPLOAD_WIDTH) return file
    const { width, height } = targetSize(bitmap.width, bitmap.height, MAX_UPLOAD_WIDTH)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.85),
    )
    return blob ?? file
  } finally {
    bitmap.close()
  }
}
