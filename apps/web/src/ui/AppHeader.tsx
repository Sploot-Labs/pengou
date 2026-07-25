import type { ReactNode } from 'react'
import { Logo } from '../ui'

export function AppHeader({ brandline, actions }: { brandline?: string; actions?: ReactNode }) {
  return (
    <header className="ab-shell__header">
      <Logo />
      {brandline && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="host-brandline">{brandline}</p>
        </div>
      )}
      {actions && <div className="ab-shell__actions">{actions}</div>}
    </header>
  )
}
