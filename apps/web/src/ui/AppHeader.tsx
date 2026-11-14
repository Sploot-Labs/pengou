import type { ReactNode } from 'react'
import { LanguageSelect } from '../i18n/LanguageSelect'
import { Logo } from '../ui'

export function AppHeader({ brandline, actions }: { brandline?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ab-shell__header">
      <Logo to="/" />
      {brandline && (
        <div className="host-brandline" style={{ flex: 1, minWidth: 0 }}>
          {brandline}
        </div>
      )}
      <div className="ab-shell__actions">
        <LanguageSelect />
        {actions}
      </div>
    </header>
  )
}
