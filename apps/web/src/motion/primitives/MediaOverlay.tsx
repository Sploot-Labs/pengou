import { useState } from 'react'

/** Fond animé / stinger vidéo. <video> muet + playsInline + loop (autoplay muet
 * autorisé). Fallback dégradé si la vidéo ne charge pas. aria-hidden : décoratif.
 * `src` = clé résolue vers /media/<src>.mp4 dans apps/web/public/media/. */
export function MediaOverlay({
  src,
  mode,
  active,
}: {
  src: string
  mode: 'overlay' | 'background'
  active: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (!active) return null

  const base = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    zIndex: mode === 'background' ? 0 : 5,
    pointerEvents: 'none' as const,
  }

  if (failed) {
    return <div aria-hidden="true" style={{ ...base, background: 'var(--grad-brand)' }} />
  }
  return (
    <video
      aria-hidden="true"
      autoPlay
      muted
      playsInline
      loop={mode === 'background'}
      onError={() => setFailed(true)}
      src={`/media/${src}.mp4`}
      style={base}
    />
  )
}
