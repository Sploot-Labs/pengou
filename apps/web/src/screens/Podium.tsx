import type { Ref } from 'react'

/**
 * `PodiumView` — composant de PRÉSENTATION pur, alimenté par l'événement
 * `podium` réel (`{ top: RankingEntry[] }`, 3 entrées maximum — voir
 * `packages/game/src/engine.ts`, `ranking()`). Plus de route `/podium/:id`
 * autonome ni de `mockData` : voir la note dans `routes.tsx` sur pourquoi un
 * montage à froid de cette page n'aurait aucune source de données (aucun
 * rôle « spectateur » dans le contrat socket). Rendu inline par `HostLive`
 * et `BigScreen`, qui sont déjà dans la room de session au moment où
 * `podium` arrive.
 *
 * `fullRanking`, s'il est fourni (le dernier `scoreboard` connu, reçu juste
 * avant `podium`), étend la liste au-delà du top 3 — sinon seul le podium
 * est affiché. Aucun classement n'est recalculé côté client : les deux
 * proviennent tels quels d'événements serveur.
 *
 * Pas de bouton « Exporter les résultats » : l'export CSV n'a pas encore de
 * backend (voir le plan Dashboard à venir) — plutôt que de fabriquer un
 * export qui ne correspondrait à rien de réel, le bouton est simplement
 * absent ici (aucune mention masquée/désactivée qui laisserait croire à une
 * fonctionnalité en préparation immédiate).
 */

export interface PodiumEntry {
  playerId: string
  nickname: string
  score: number
}

export interface PodiumViewProps {
  quizTitle?: string
  /** Les 3 premiers, tels que reçus dans l'événement `podium`. */
  top: PodiumEntry[]
  /** Classement complet le plus récent connu (dernier `scoreboard`), pour la
   * section « Classement complet » au-delà du podium. Omis si indisponible
   * (ex. un grand écran qui aurait rejoint juste avant `podium` sans avoir
   * vu le `scoreboard` précédent). */
  fullRanking?: PodiumEntry[]
  /** Cible du focus RGAA 2.4.3 au passage à cette phase — posée par l'appelant.
   * Accepte aussi bien un `RefObject` (HostLive) qu'une callback ref (grand
   * écran — voir `useFocusOnMount`, qui focalise au montage plutôt que sur
   * le changement de `phase`). */
  headingRef?: Ref<HTMLHeadingElement>
  /** Pitch de conversion en bas d'écran (grand écran / audience) — absent sur
   * le contrôleur hôte, qui est déjà un utilisateur inscrit. */
  showConversionFooter?: boolean
}

export function PodiumView({ quizTitle, top, fullRanking, headingRef, showConversionFooter = false }: PodiumViewProps) {
  const [gold, silver, bronze] = top
  // Le reste du classement complet, au-delà des 3 déjà montrés sur le podium.
  const rest = (fullRanking ?? top).slice(3)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 className="ab-hero-title" ref={headingRef} tabIndex={-1}>
          Classement final
        </h1>
        {quizTitle && <p style={{ color: 'var(--ink-dim)' }}>{quizTitle}</p>}
      </div>

      {/* Ordre DOM 1-2-3 (lecture/tabulation logique) ; `order` CSS dessine la
          forme classique 2-1-3 du podium. */}
      <div className="podium-top3" aria-label="Podium des trois premiers">
        {gold && (
          <div className="podium-step podium-step--gold">
            <span className="visually-hidden">1ʳᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              1
            </div>
            <strong>{gold.nickname}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{gold.score} pts</span>
          </div>
        )}
        {silver && (
          <div className="podium-step podium-step--silver">
            <span className="visually-hidden">2ᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              2
            </div>
            <strong>{silver.nickname}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{silver.score} pts</span>
          </div>
        )}
        {bronze && (
          <div className="podium-step podium-step--bronze">
            <span className="visually-hidden">3ᵉ place</span>
            <div className="podium-step__block" aria-hidden="true">
              3
            </div>
            <strong>{bronze.nickname}</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{bronze.score} pts</span>
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <section aria-label="Classement complet" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 'min(560px, 100%)' }}>
            <h2 style={{ marginBottom: 'var(--space-3)' }}>Classement complet</h2>
            <ol className="podium-list">
              {rest.map((p, index) => (
                <li key={p.playerId} className="podium-list__item">
                  <span className="podium-list__rank">{index + 4}</span>
                  <span>{p.nickname}</span>
                  <span className="podium-list__score">{p.score} pts</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {showConversionFooter && (
        <p className="podium-convert">
          <a href="#cloud" onClick={(e) => e.preventDefault()}>
            Créez votre quiz gratuitement, aucune installation
          </a>
          , ou{' '}
          <a href="#host" onClick={(e) => e.preventDefault()}>
            hébergez votre propre instance
          </a>
          , c'est open-source.{' '}
          <a href="#source" onClick={(e) => e.preventDefault()}>
            Voir le code
          </a>
        </p>
      )}
    </div>
  )
}
