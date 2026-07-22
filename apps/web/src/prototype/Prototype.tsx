import { useState } from 'react'
import './tokens.css'
import './prototype.css'
import { BigScreen } from './screens/BigScreen'
import { HostEditor } from './screens/HostEditor'
import { Join } from './screens/Join'
import { Podium } from './screens/Podium'
import { PlayerLive } from './screens/PlayerLive'

type ScreenKey = 'host' | 'join' | 'player' | 'big' | 'podium'

const SCREENS: { key: ScreenKey; label: string; render: () => JSX.Element }[] = [
  { key: 'host', label: 'Éditeur (backstage)', render: () => <HostEditor /> },
  { key: 'join', label: 'Rejoindre', render: () => <Join /> },
  { key: 'player', label: 'Joueur (mobile)', render: () => <PlayerLive /> },
  { key: 'big', label: 'Grand écran', render: () => <BigScreen /> },
  { key: 'podium', label: 'Podium', render: () => <Podium /> },
]

export function Prototype() {
  const [active, setActive] = useState<ScreenKey>('host')
  const current = SCREENS.find((s) => s.key === active) ?? SCREENS[0]

  return (
    <div className="prototype-root">
      <a className="ab-skip-link" href="#contenu-principal">
        Aller au contenu
      </a>
      <nav className="ab-switcher" aria-label="Sélecteur de prototype">
        <span className="ab-switcher__label">Prototype</span>
        <ul className="ab-switcher__nav">
          {SCREENS.map((screen) => (
            <li key={screen.key}>
              <button
                type="button"
                className={`ab-switcher__link${screen.key === active ? ' ab-switcher__link--active' : ''}`}
                aria-current={screen.key === active ? 'page' : undefined}
                onClick={() => setActive(screen.key)}
              >
                {screen.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ab-switcher__stage">{current.render()}</div>
    </div>
  )
}
