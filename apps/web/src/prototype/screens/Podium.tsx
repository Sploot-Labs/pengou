import { useState } from 'react'
import { getRanking, mockQuiz } from '../mockData'
import { Button, Logo } from '../ui'

export function Podium() {
  const ranking = getRanking()
  const [gold, silver, bronze] = ranking
  const rest = ranking.slice(3)
  const [message, setMessage] = useState<string | null>(null)

  function exportResults() {
    const header = 'rang,pseudo,score'
    const rows = ranking.map((p) => `${p.rank},${p.pseudo},${p.score}`)
    const csv = [header, ...rows].join('\n')
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
    <div className="podium-screen">
      <Logo />
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--fs-display)' }}>Classement final</h1>
        <p style={{ color: 'var(--ink-dim)' }}>{mockQuiz.title}</p>
      </div>

      <div className="podium-top3" aria-label="Podium des trois premiers">
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
          <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-3)' }}>Classement complet</h2>
          <ol className="podium-list">
            {rest.map((p) => (
              <li key={p.id} className="podium-list__item">
                <span className="podium-list__rank">{p.rank}</span>
                <span>{p.pseudo}</span>
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
    </div>
  )
}
