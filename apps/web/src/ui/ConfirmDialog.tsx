import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../i18n/useT'
import { Button, type ButtonVariant } from '../ui'

/**
 * Boîte de confirmation modale, même motif accessible que le dialogue « Changer le type de
 * question ? » de `HostEditor` : `role="dialog"` + `aria-modal`, focus posé sur l'action
 * principale à l'ouverture, Tab piégé entre les boutons, Échap ferme, et le focus revient à
 * l'élément qui avait ouvert le dialogue (s'il existe encore ; sinon l'appelant le place).
 * Pendant `pending`, l'action est verrouillée et Échap n'annule plus.
 */
export function ConfirmDialog({
  id,
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmVariant = 'danger',
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  /** Préfixe des ids `-title`/`-desc`, unique dans la page. */
  id: string
  title: string
  description: ReactNode
  confirmLabel: string
  pendingLabel?: string
  confirmVariant?: ButtonVariant
  pending?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmRef.current?.focus()
    return () => {
      // Le bouton d'origine peut avoir disparu (carte retirée après archivage) : rien à restaurer.
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <div className="host-dialog__backdrop">
      <div
        className="host-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        ref={dialogRef}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (!pending) onCancel()
            return
          }
          if (e.key !== 'Tab') return
          const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
          if (!nodes || nodes.length === 0) return
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-desc`} style={{ color: 'var(--ink-dim)' }}>
          {description}
        </p>
        {error && (
          <p className="join-error" role="alert">
            {error}
          </p>
        )}
        <div className="host-dialog__actions">
          <Button variant="ghost" type="button" onClick={onCancel} disabled={pending}>
            {t('Annuler')}
          </Button>
          <Button
            variant={confirmVariant}
            type="button"
            onClick={() => {
              if (!pending) onConfirm()
            }}
            aria-disabled={pending || undefined}
            ref={confirmRef}
          >
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
