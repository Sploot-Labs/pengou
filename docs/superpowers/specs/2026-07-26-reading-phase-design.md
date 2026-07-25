# Temps de lecture de la question (phase « reading ») — design

Date : 2026-07-26
Statut : design validé, prêt pour le plan d'implémentation.

## Contexte & besoin

Aujourd'hui, quand l'hôte démarre une question (`host:start`/`host:next`), le serveur passe
la session en phase `'question'` et diffuse `question:show` (énoncé + options, sans la bonne
réponse) **et** `timer` d'un coup à toute la room : le grand écran et les joueurs voient tout
immédiatement et peuvent répondre aussitôt.

Besoin : donner un **temps de lecture** — la question s'affiche d'abord **seule** (sans les
réponses) pendant ~6 s sur le grand écran, personne ne peut répondre, **puis** l'affichage
change (les réponses apparaissent) et le chrono de réponse démarre. C'est le « question
reading time » façon Kahoot.

## Décisions (validées)

1. **Phase serveur-autoritaire** : une vraie phase de jeu, pas un effet visuel local. Les
   joueurs voient l'énoncé mais **ne peuvent pas répondre** pendant la lecture ; tous les
   écrans sont synchronisés par le serveur.
2. **Chrono après la lecture** : le chrono de réponse (`timeLimit`, ex. 20 s) démarre au
   moment où les réponses apparaissent — le temps de lecture s'**ajoute**.
3. **Paramétrable par question** : un champ « temps de lecture » (secondes) par question,
   `0` = pas de phase de lecture (comportement actuel, rétro-compatible).

## Flux cible

Question avec `readingTime > 0` :

```
host:start / host:next
      │  engine.startQuestion → phase 'reading', readingStartedAt = now()
      │  gateway émet  question:reading  (énoncé seul, index/total, durée)  à la room
      │  gateway planifie setTimeout(readingTime * 1000) côté serveur
      ▼  (après readingTime s, OU annulé par une action manuelle anticipée)
engine.revealAnswers → phase 'question', questionStartedAt = now()
      │  gateway émet  question:show (options) + timer  à la room
      ▼
saisie ouverte, chrono timeLimit démarre ICI → reveal / scoreboard / …
```

Question avec `readingTime === 0` : `startQuestion` passe directement en `'question'` et le
gateway émet `question:show` + `timer` immédiatement — **flux actuel strictement inchangé**.

## Architecture

### 1. Données (`packages/db`)
- Ajouter `readingTime integer('reading_time') NOT NULL DEFAULT 0` à la table `question`
  (migration Drizzle). Les questions existantes prennent `0` → pas de régression.
- Exposer `readingTime` dans les types/repos de questions (lecture + écriture), aligné sur
  `timeLimit` (`time_limit`, default 20).
- L'éditeur écrit `readingTime` via l'API de questions existante (PATCH question).

### 2. Moteur (`packages/game`)
- Union de phases : ajouter **`'reading'`** (`'lobby' | 'reading' | 'question' | 'reveal' |
  'scoreboard' | 'podium'`).
- Champ session `readingStartedAt: number | null` (miroir de `questionStartedAt`).
- `startQuestion(sessionId)` : lit le `readingTime` de la question courante. Si `> 0` →
  `phase = 'reading'`, `readingStartedAt = now()`, `questionStartedAt = null`. Sinon →
  `phase = 'question'`, `questionStartedAt = now()` (comme aujourd'hui).
- Nouvelle méthode **`revealAnswers(sessionId)`** : garde `phase === 'reading'` ; transition
  → `'question'`, `questionStartedAt = now()`. Idempotence/garde : hors `'reading'` → no-op
  sûr ou erreur explicite (à préciser au plan, cohérent avec les autres gardes du moteur).
- `submitAnswer` : **inchangé** — gate déjà sur `phase === 'question'`, donc les réponses
  sont rejetées pendant `'reading'` sans code supplémentaire.
- **`readingView(session)`** : projection énoncé seul — `{ prompt, index, total, readingTime }`,
  **sans les options** (anti-triche : ne divulgue pas les réponses avant l'heure).
- `playerQuestionView` : inchangé (utilisé à l'entrée en `'question'`).

### 3. Passerelle (`apps/server/src/game-gateway.ts`) — planification serveur
- Helper `startQuestionFlow(sessionId, meta)` factorisant `host:start` et `host:next` :
  appelle `engine.startQuestion`, puis :
  - phase `'reading'` → émet `question:reading` (via `readingView`) à la room + planifie
    `meta.readingTimeout = setTimeout(...)` qui, à échéance : `engine.revealAnswers` →
    `question:show` (player view) + `emitTimer` à la room. Idempotent (l'échéance vérifie que
    la phase est toujours `'reading'`).
  - phase `'question'` (readingTime 0) → émet `question:show` + `timer` immédiatement (flux
    actuel).
- **Annulation** : toute transition manuelle anticipée (`host:reveal`, `host:skip`,
  `host:next`) et la fin de session **clear** `meta.readingTimeout` s'il est en attente, pour
  ne pas déclencher une révélation fantôme après coup. (Un `host:reveal` pendant `'reading'`
  doit être géré proprement — au minimum ignoré/gardé, au mieux : révèle les réponses
  immédiatement puis suit le flux normal ; comportement précis fixé au plan.)
- **Snapshot reconnect (feature T8 existante, `emitReconnectSnapshot`)** : ajouter le cas
  `'reading'` → émettre `question:reading` avec le **temps de lecture restant** (calculé
  depuis `readingStartedAt` + `readingTime`), pour qu'un hôte qui reprend pendant la lecture
  voie l'énoncé et le décompte cohérent.

### 4. Écrans (`apps/web`)
- **BigScreen** : nouvel abonnement `question:reading` → affiche l'énoncé seul (grand, centré)
  + un décompte de lecture discret ; `question:show` → réponses + chrono (rendu actuel). Le
  crossfade de phase existant (PhaseTransition) s'applique.
- **PlayerLive** : `question:reading` → énoncé + « Préparez-vous… », tuiles de réponse
  masquées/désactivées ; `question:show` → saisie activée (rendu actuel). Annonces RGAA
  (`aria-live`) pour le changement de phase.
- **HostLive** : afficher l'état lecture (énoncé + « Lecture en cours… » + décompte) puis le
  pilotage normal. Cohérent avec le snapshot reconnect.
- Le contrat temps réel côté client (types d'événements) gagne `question:reading` +
  `ReadingView`.

### 5. Éditeur (`apps/web/src/screens/HostEditor.tsx`)
- Champ « Temps de lecture (s) » à côté de « Durée (s) », écrit via l'API question existante
  (mirror du champ `timeLimit`). `0` autorisé (= pas de lecture). Validation ≥ 0.

## Accessibilité & i18n
- Le changement `reading → question` est annoncé aux lecteurs d'écran (`role="status"` /
  `aria-live="polite"`), comme les autres transitions de phase.
- Décompte de lecture : valeur textuelle toujours présente (jamais la couleur/anim seule).
- Copie FR cohérente (« Lecture en cours », « Préparez-vous… »), voix sobre.

## Tests
- **Moteur** : `startQuestion` route vers `'reading'` si `readingTime>0` sinon `'question'` ;
  `revealAnswers` transitionne et pose `questionStartedAt` ; `submitAnswer` rejeté en
  `'reading'` ; `readingView` ne contient pas les options.
- **Passerelle** : `host:start` d'une question avec lecture émet `question:reading` puis, après
  échéance, `question:show`+`timer` ; une action manuelle anticipée **annule** le timeout ;
  `emitReconnectSnapshot` en `'reading'` émet `question:reading` avec temps restant. (Éviter
  les timers réels lents dans les tests : injecter/mocker le scheduler, ou fake timers.)
- **Éditeur** : le champ lecture se saisit et persiste (mirror du test `timeLimit`).
- **Écrans** : BigScreen/PlayerLive rendent l'état lecture puis l'état réponse ; a11y du
  changement de phase.

## Risques & points d'attention
- **`setTimeout` serveur** = nouvelle infra de planification autoritaire : nettoyage rigoureux
  (annulation anticipée, fin de session, une seule échéance par manche → idempotence via une
  garde de phase + clear systématique), et testabilité (scheduler injectable / fake timers,
  pas d'attente réelle de 6 s en test).
- **Reprise (reconnect) pendant la lecture** : le temps restant doit être recalculé serveur
  (`readingStartedAt`), jamais fabriqué par le client. Le timeout serveur, lui, continue de
  courir indépendamment des reconnexions client.
- **Rétro-compatibilité** : `readingTime` défaut `0` ⟹ aucune partie/quiz existant ne change
  de comportement. Le flux `readingTime===0` doit rester bit-pour-bit l'actuel.
- **Anti-triche** : `question:reading`/`readingView` ne doivent JAMAIS contenir les options ni
  la bonne réponse. Les réponses restent rejetées tant que la phase n'est pas `'question'`
  (déjà garanti par `submitAnswer`).
