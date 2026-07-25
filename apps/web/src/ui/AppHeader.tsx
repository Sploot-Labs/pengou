import type { ReactNode } from 'react'
import { Logo } from '../ui'

export function AppHeader({ brandline, actions }: { brandline?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ab-shell__header">
      <Logo />
      {brandline && (
        <div className="host-brandline" style={{ flex: 1, minWidth: 0 }}>
          {brandline}
        </div>
      )}
      {actions && <div className="ab-shell__actions">{actions}</div>}
    </header>
  )
}
