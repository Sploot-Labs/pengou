import { useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { uploadMedia } from '../api/media'
import { UPLOAD_MAX_BYTES, prepareImageForUpload } from '../media/downscale'
import { Button } from '../ui'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const TOO_HEAVY = 'Image trop lourde, même après réduction (2 Mo max).'

type ParsedUrl = { ok: true; url: string } | { ok: false; error: string }

/** N'accepte que les adresses https (chaîne trimée, analysée par `new URL`). */
export function parseImageUrl(input: string): ParsedUrl {
  const trimmed = input.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Adresse invalide.' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Seules les adresses https sont acceptées.' }
  }
  return { ok: true, url: trimmed }
}

class TooHeavyError extends Error {
  constructor() {
    super(TOO_HEAVY)
  }
}

/** Réduit l'image, vérifie la taille localement, puis l'envoie ; renvoie l'URL publique. */
async function defaultUpload(file: File): Promise<string> {
  const blob = await prepareImageForUpload(file)
  if (blob.size > UPLOAD_MAX_BYTES) throw new TooHeavyError()
  // Le blob renvoyé peut avoir un autre type que le fichier d'origine (repli PNG du canvas).
  const ext = EXTENSIONS[blob.type] ?? 'png'
  const { url } = await uploadMedia(blob, `image.${ext}`)
  return url
}

export interface QuestionImageFieldProps {
  media: string | null
  mediaAlt: string | null
  onChange: (patch: { media?: string | null; mediaAlt?: string | null }) => void
  upload?: (file: File) => Promise<string>
}

export function QuestionImageField({
  media,
  mediaAlt,
  onChange,
  upload = defaultUpload,
}: QuestionImageFieldProps) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const urlId = `${id}-url`
  const urlErrorId = `${id}-url-error`
  const altId = `${id}-alt`
  const altHelpId = `${id}-alt-help`
  const uploadErrorId = `${id}-upload-error`

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const url = await upload(file)
      onChange({ media: url })
    } catch (err) {
      setUploadError(
        err instanceof ApiError || err instanceof TooHeavyError
          ? err.message
          : "L'envoi de l'image a échoué.",
      )
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function useUrl() {
    const result = parseImageUrl(urlInput)
    if (!result.ok) {
      setUrlError(result.error)
      return
    }
    setUrlError(null)
    setUrlInput('')
    onChange({ media: result.url })
  }

  return (
    <fieldset className="host-image">
      <legend>Image (facultative)</legend>

      {media && (
        <div className="host-image__preview">
          <img src={media} alt={mediaAlt ?? ''} />
          <Button variant="ghost" type="button" onClick={() => onChange({ media: null, mediaAlt: null })}>
            Retirer l'image
          </Button>
        </div>
      )}

      <div className="host-image__upload">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          data-testid="question-image-file"
          className="host-image__file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button
          variant="ghost"
          type="button"
          disabled={uploading}
          aria-describedby={uploadError ? uploadErrorId : undefined}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Envoi…' : 'Envoyer une image'}
        </Button>
        {uploadError && (
          <p className="host-inline-error" id={uploadErrorId} role="alert">
            {uploadError}
          </p>
        )}
      </div>

      <div className="host-field">
        <label htmlFor={urlId}>Ou coller l'adresse d'une image</label>
        <div className="host-image__url">
          <input
            id={urlId}
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? urlErrorId : undefined}
          />
          <Button variant="ghost" type="button" onClick={useUrl}>
            Utiliser
          </Button>
        </div>
        {urlError && (
          <p className="host-inline-error" id={urlErrorId}>
            {urlError}
          </p>
        )}
      </div>

      {media && (
        <div className="host-field">
          <label htmlFor={altId}>Texte alternatif</label>
          <p className="host-field__help" id={altHelpId}>
            Décrivez l'image pour les personnes qui ne la voient pas, sans donner la réponse.
          </p>
          <input
            id={altId}
            type="text"
            maxLength={200}
            value={mediaAlt ?? ''}
            onChange={(e) => onChange({ mediaAlt: e.target.value })}
            aria-describedby={altHelpId}
          />
        </div>
      )}
    </fieldset>
  )
}
