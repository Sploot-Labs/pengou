import { useState } from 'react'
import { getRanking, mockQuiz } from '../mockData'
import { Button, Logo } from '../ui'

export function Podium() {
  const ranking = getRanking()
  const [gold, silver, bronze] = ranking
  const rest = ranking.slice(3)
  const [message, setMessage] = useState<string | null>(null)

  /** Escape one CSV field: neutralise formula injection (= + - @) and quote
   *  fields containing a comma, quote or newline (doubling inner quotes). */
  function csvCell(value: string | number): string {
    let s = String(value)
    if (/^[=+\-@]/.test(s)) s = `'${s}`
    if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
    return s
  }

  function exportResults() {
    const header = 'rang,pseudo,score'
    const rows = ranking.map((p) =>
      [csvCell(p.rank), csvCell(p.pseudo), csvCell(p.score)].join(','),
    )
    // UTF-8 BOM so Excel renders accented pseudos correctly; CRLF line endings.
    const csv = '﻿' + [header, ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'resultats-partie.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setMessage('Export démarré : resultats-partie.csv')
  }

  function replay() {
    setMessage('Nouvelle partie lancée (démonstration).')
  }

  return (
    <main className="podium-screen" id="contenu-principal" tabIndex={-1}>
      <Logo />
      <div style={{ textAlign: 'center' }}>
        <h1 className="ab-hero-title">Classement final</h1>
        <p style={{ color: 'var(--ink-dim)' }}>{mockQuiz.title}</p>
      </div>

      {/* DOM order is 1-2-3 (logical reading/tab order); CSS `order` renders
          the classic 2-1-3 podium shape visually. */}
      <div className="podium-top3" aria-label="Podium des trois premiers">
        {gold && (
          <div className="podium-step podium-step--gold">
            <span className="visually-hidden">1ʳᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              1
            </div>
            <strong>{gold.pseudo}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{gold.score} pts</span>
          </div>
        )}
        {silver && (
          <div className="podium-step podium-step--silver">
            <span className="visually-hidden">2ᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              2
            </div>
            <strong>{silver.pseudo}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{silver.score} pts</span>
          </div>
        )}
        {bronze && (
          <div className="podium-step podium-step--bronze">
            <span className="visually-hidden">3ᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              3
            </div>
            <strong>{bronze.pseudo}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{bronze.score} pts</span>
          </div>
        )}
      </div>

      <section aria-label="Classement complet" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 'min(560px, 100%)' }}>
          <h2 style={{ marginBottom: 'var(--space-3)' }}>Classement complet</h2>
          <ol className="podium-list">
            {rest.map((p) => (
              <li
                key={p.id}
                className={`podium-list__item${p.id === 'you' ? ' podium-list__item--you' : ''}`}
              >
                <span className="podium-list__rank">{p.rank}</span>
                <span>
                  {p.pseudo}
                  {p.id === 'you' && <span className="ranking-you-tag">(vous)</span>}
                </span>
                <span className="podium-list__score">{p.score} pts</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="podium-actions">
        <Button variant="primary" type="button" onClick={replay}>
          Rejouer
        </Button>
        <Button variant="ghost" type="button" onClick={exportResults}>
          Exporter les résultats
        </Button>
      </div>

      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}

      {/* Two conversion doors: a frictionless cloud path for the non-technical
          host (teacher/animator), and the self-host path for the technical one.
          The verb matches each persona's real effort. */}
      <p className="podium-convert">
        <a href="#cloud" onClick={(e) => e.preventDefault()}>
          Créez votre quiz gratuitement — aucune installation
        </a>
        , ou{' '}
        <a href="#host" onClick={(e) => e.preventDefault()}>
          hébergez votre propre instance
        </a>
        , c’est open-source.{' '}
        <a href="#source" onClick={(e) => e.preventDefault()}>
          Voir le code
        </a>
      </p>
    </main>
  )
}
