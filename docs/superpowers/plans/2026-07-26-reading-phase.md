# Temps de lecture (phase « reading ») — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Afficher la question seule pendant un temps de lecture paramétrable (serveur-autoritaire) avant de révéler les réponses et démarrer le chrono. Rétro-compatible (`readingTime=0` = flux actuel).

**Architecture:** DB (colonne `reading_time`) → moteur (phase `'reading'` + `revealAnswers` + `readingView`) → passerelle (planification `setTimeout` serveur + événement `question:reading` + annulation + snapshot reconnect) → écrans (BigScreen/PlayerLive/HostLive) → éditeur (champ). Spec : `docs/superpowers/specs/2026-07-26-reading-phase-design.md`.

**Tech Stack:** Drizzle/Postgres, TS, Socket.IO, React, Vitest.

## Global Constraints
- **Rétro-compat stricte** : `readingTime === 0` ⟹ flux `startQuestion → 'question'` + `question:show`+`timer` **bit-pour-bit l'actuel**. Aucune partie/quiz existant ne change.
- **Anti-triche** : `question:reading`/`readingView` ne contiennent JAMAIS les options ni la bonne réponse. Réponses rejetées tant que `phase !== 'question'` (déjà garanti par `submitAnswer` — ne pas l'affaiblir).
- **Timing 100% serveur** : temps de lecture/restant calculé depuis `readingStartedAt` côté serveur, jamais fourni par le client.
- **Tests sans attente réelle** : ne PAS attendre de vrais 6 s — fake timers Vitest (`vi.useFakeTimers`) ou scheduler injectable dans la passerelle.
- Runner : `pnpm vitest run <path>` (ciblé). Web complet `pnpm vitest run apps/web/src`. Serveur `pnpm vitest run apps/server/src/<file>`. DB `pnpm vitest run packages/db/...`. PAS `pnpm test` (lent).
- Colonnes couleur/token : sans objet ici. RGAA : changement de phase annoncé (`role="status"`/`aria-live`), décompte toujours textuel.

## Structure des fichiers
- `packages/db/src/schema.ts` — `readingTime` sur `question`.
- `packages/db/drizzle/0007_*.sql` — migration générée.
- `packages/db/src/repos/question.ts` (+ `question.test.ts`) — read/write `readingTime`.
- `packages/game/src/engine.ts` (+ types + tests) — phase `reading`, `revealAnswers`, `readingView`, routing `startQuestion`.
- `apps/server/src/game-gateway.ts` (+ `game-gateway.test.ts`) — flow + planification + annulation + snapshot.
- `apps/web/src/realtime/*` (contrat d'événements) — `question:reading` + `ReadingView`.
- `apps/web/src/screens/BigScreen.tsx`, `PlayerLive.tsx`, `HostLive.tsx` — rendu phase lecture.
- `apps/web/src/screens/HostEditor.tsx` — champ « Temps de lecture ».

---

## Task 1 : DB — colonne `reading_time` + repo + migration

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/src/repos/question.ts`, `packages/db/src/repos/question.test.ts`. Create migration `packages/db/drizzle/0007_*.sql` (générée).

**Interfaces:**
- Produces: `question.readingTime: number` (colonne `reading_time`, default 0). `createQuestion`/`updateQuestion` acceptent `readingTime`. `listQuestions`/`getQuestion` le renvoient.

- [ ] **Step 1 — schéma** : dans `schema.ts`, table `question`, après `timeLimit`, ajouter :
```ts
  readingTime: integer('reading_time').notNull().default(0),
```
- [ ] **Step 2 — repo** : dans `repos/question.ts`, ajouter `readingTime` aux types d'entrée de `createQuestion` (optionnel, défaut 0 si absent) et `updateQuestion` (patch optionnel), et s'assurer qu'il est bien sélectionné en lecture (si la sélection est explicite ; sinon `select()` le renvoie déjà). Mirror exact du traitement de `timeLimit`.
- [ ] **Step 3 — test repo (échoue d'abord)** : dans `question.test.ts`, ajouter :
```ts
it('createQuestion/updateQuestion gèrent readingTime (défaut 0)', async () => {
  const scope = tenantScope(ctx.db, tenantA)
  const def = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'D', timeLimit: 20, payload: validMcq })
  expect(def!.readingTime).toBe(0) // défaut
  const withReading = await createQuestion(scope, quizA, { type: 'mcq', prompt: 'R', timeLimit: 20, readingTime: 6, payload: validMcq })
  expect(withReading!.readingTime).toBe(6)
  const patched = await updateQuestion(scope, quizA, def!.id, { readingTime: 4 })
  expect(patched!.readingTime).toBe(4)
})
```
- [ ] **Step 4 — générer la migration** : `pnpm --filter @splootlabs/db db:generate` → produit `drizzle/0007_*.sql` (ADD COLUMN reading_time … DEFAULT 0 NOT NULL). Vérifier le SQL généré (ADD COLUMN non destructif, default 0). Committer le fichier généré.
- [ ] **Step 5 — tests** : `pnpm vitest run packages/db/src/repos/question.test.ts` (Postgres de test via Docker, comme les autres tests db). Vert.
- [ ] **Step 6 — commit** : `git add packages/db && git commit -m "feat(db): colonne reading_time sur question (temps de lecture, défaut 0)"`

---

## Task 2 : Moteur — phase `reading` + `revealAnswers` + `readingView`

**Files:** Modify `packages/game/src/engine.ts` (+ le fichier de types de phase/session s'il est séparé), `packages/game/src/*engine*.test.ts`.

**Interfaces:**
- Consumes: `question.readingTime` (Task 1).
- Produces: phase `'reading'` ; `session.readingStartedAt: number | null` ; `engine.revealAnswers(sessionId): Promise<GameSession>` (garde `'reading'` → `'question'`, pose `questionStartedAt`) ; `engine.readingView(session): { prompt, index, total, readingTime }` (SANS options).

- [ ] **Step 1 — tests (échouent d'abord)** : dans le test du moteur, ajouter :
```ts
it("startQuestion entre en 'reading' quand readingTime>0, sinon 'question'", async () => {
  // question 0 : readingTime 0 → 'question' (questionStartedAt posé)
  // question 1 : readingTime 6 → 'reading' (readingStartedAt posé, questionStartedAt null)
  // (construire une session 2 questions avec ces readingTime ; asserter phase + timestamps)
})
it("revealAnswers passe 'reading' → 'question' et pose questionStartedAt", async () => { /* … */ })
it("submitAnswer est rejeté en phase 'reading'", async () => {
  // après startQuestion en 'reading' : submitAnswer → { accepted: false }
})
it("readingView ne contient pas les options", async () => {
  const v = engine.readingView(session)
  expect(v).not.toHaveProperty('options'); expect(v.prompt).toBeDefined()
})
```
- [ ] **Step 2 — lancer, échec.** `pnpm vitest run packages/game`
- [ ] **Step 3 — implémenter** :
  - Union de phases : ajouter `'reading'`.
  - `GameSession` : ajouter `readingStartedAt: number | null` (init `null` à la création, à côté de `questionStartedAt`).
  - `startQuestion` : après `session.currentIndex = nextIndex`, lire `const q = session.questions[nextIndex]`. Si `q.readingTime > 0` → `session.phase = 'reading'`, `session.readingStartedAt = now()`, `session.questionStartedAt = null`. Sinon → `session.phase = 'question'`, `session.questionStartedAt = now()`, `session.readingStartedAt = null`. (Conserver le reste identique.)
  - `revealAnswers(sessionId)` : `requireSession` ; garde `if (session.phase !== 'reading') return session` (no-op sûr — idempotent, cohérent avec les autres gardes) ; `session.phase = 'question'` ; `session.questionStartedAt = now()` ; `store.save` ; return.
  - `readingView(session)` : `const q = currentQuestion(session)` → `{ prompt: q.prompt, index: session.currentIndex, total: session.questions.length, readingTime: q.readingTime }`. NE PAS inclure les options.
  - Ajouter `revealAnswers`/`readingView` à l'interface `GameEngine`.
  - `submitAnswer` : inchangé (le gate `phase === 'question'` fait déjà le rejet en `'reading'`).
- [ ] **Step 4 — tests** `pnpm vitest run packages/game` vert.
- [ ] **Step 5 — commit** : `git commit -am "feat(game): phase reading + revealAnswers + readingView (temps de lecture)"`

---

## Task 3 : Passerelle — planification serveur + événement `question:reading` + annulation + snapshot

**Files:** Modify `apps/server/src/game-gateway.ts`, `apps/server/src/game-gateway.test.ts`.

**Interfaces:**
- Consumes: `engine.revealAnswers`, `engine.readingView` (Task 2).
- Produces: événement client `question:reading` (payload = `readingView` + `startedAt`) ; le flux `host:start`/`host:next` planifie la révélation ; `meta.readingTimeout` géré/annulé.

**Contexte:** handlers actuels — `host:start` (~L420), `host:reveal` (~L445), `host:skip` (~L463 → `doSkip`), `host:next` (~L465). `doRevealBySession` (~L172). `emitTimer`/`timerPayload` (~L239-248). `replayCurrentQuestionTo`/`emitReconnectSnapshot` (~L257/236, feature reprise). `SessionMeta` défini vers le haut du fichier (y ajouter `readingTimeout`).

- [ ] **Step 1 — tests (échouent d'abord)** avec fake timers :
```ts
it('host:start avec temps de lecture émet question:reading puis, à échéance, question:show+timer', async () => {
  vi.useFakeTimers()
  // session avec question readingTime=6 ; host:start
  // → le socket room reçoit 'question:reading' (avec prompt, sans options)
  // → PAS encore de 'question:show'
  // vi.advanceTimersByTime(6000)
  // → reçoit 'question:show' + 'timer'
  vi.useRealTimers()
})
it('une révélation manuelle anticipée (host:reveal) pendant la lecture annule le timeout', async () => {
  // host:start (reading) → host:reveal avant échéance → advanceTimers → PAS de double question:show fantôme
})
it('emitReconnectSnapshot en phase reading émet question:reading avec le temps restant', async () => { /* … */ })
```
(Suivre le harness de test socket existant du fichier. Attention : `engine.startQuestion` etc. sont async — combiner `await` et `vi.advanceTimersByTimeAsync` si nécessaire.)
- [ ] **Step 2 — lancer, échec.** `pnpm vitest run apps/server/src/game-gateway.test.ts`
- [ ] **Step 3 — implémenter** :
  - `SessionMeta` : ajouter `readingTimeout: ReturnType<typeof setTimeout> | null` (init `null`).
  - Helper `function clearReadingTimeout(meta) { if (meta.readingTimeout) { clearTimeout(meta.readingTimeout); meta.readingTimeout = null } }`.
  - Helper `async function startQuestionFlow(sessionId, meta)` (factorise host:start & host:next après `engine.startQuestion`) :
    ```ts
    const session = await engine.startQuestion(sessionId)
    if (session.phase === 'reading') {
      io.to(roomName(sessionId)).emit('question:reading', { ...engine.readingView(session), startedAt: session.readingStartedAt })
      clearReadingTimeout(meta)
      meta.readingTimeout = setTimeout(() => { void revealAnswersFlow(sessionId, meta) }, currentReadingMs(session))
    } else {
      const view = engine.playerQuestionView(session)
      io.to(roomName(sessionId)).emit('question:show', view)
      emitTimer(sessionId, session)
    }
    return session
    ```
    où `currentReadingMs(session) = readingTime*1000` (ou temps restant si repris — ici toujours plein car on vient de démarrer).
  - Helper `async function revealAnswersFlow(sessionId, meta)` :
    ```ts
    clearReadingTimeout(meta)
    const session = await engine.revealAnswers(sessionId)
    if (session.phase !== 'question') return // garde idempotence
    const view = engine.playerQuestionView(session)
    io.to(roomName(sessionId)).emit('question:show', view)
    emitTimer(sessionId, session)
    ```
  - `host:start` et `host:next` : remplacer leur `engine.startQuestion` + emit `question:show`/`emitTimer` par un appel à `startQuestionFlow(sessionId, meta)`. Conserver le reste (statut active/ended, gardes, ack). Pour `host:next`, garder la logique de reveal préalable + fin de partie inchangée ; seul le DÉMARRAGE de la nouvelle question passe par `startQuestionFlow`.
  - **Annulation** : au début de `doRevealBySession`, `doSkip`, et de `host:next`/fin de session, appeler `clearReadingTimeout(meta)` (une action manuelle anticipée annule la révélation planifiée). Cohérent avec l'idempotence existante (`revealedRounds`).
  - **`emitReconnectSnapshot`** : ajouter le cas `case 'reading':` → `socket.emit('question:reading', { ...engine.readingView(session), startedAt: session.readingStartedAt })`. (Le `lobby:update` initial reste émis comme pour les autres phases.)
  - Fin de session / nettoyage `meta` : `clearReadingTimeout(meta)` là où les autres ressources de session sont libérées.
- [ ] **Step 4 — tests** `pnpm vitest run apps/server/src/game-gateway.test.ts` vert (fake timers). Vérifier aussi qu'aucune régression sur le flux `readingTime=0` (question:show immédiat).
- [ ] **Step 5 — commit** : `git commit -am "feat(game): planification serveur de la phase reading (question:reading + révélation différée + annulation + reconnect)"`

---

## Task 4 : Contrat client + BigScreen (grand écran)

**Files:** Modify le module de contrat temps réel côté web (types d'événements — repérer où `question:show`/`QuestionShowPayload` est typé, ex. `apps/web/src/realtime/*` ou `apps/web/src/constants.ts`), `apps/web/src/screens/BigScreen.tsx` (+ son test motion existant).

**Interfaces:**
- Consumes: événement `question:reading` (Task 3).
- Produces: BigScreen affiche l'énoncé seul en phase lecture, puis les réponses.

- [ ] **Step 1 — type d'événement** : ajouter `ReadingView = { prompt: string; index: number; total: number; readingTime: number; startedAt: number | null }` et le mapping de l'événement `question:reading` dans le typage socket client (mirror de `question:show`).
- [ ] **Step 2 — BigScreen** : ajouter un abonnement `on('question:reading', (v) => { setPhase('reading'); setReading(v) })`. Rendre une phase `reading` : grand énoncé centré + un décompte de lecture textuel (dérivé de `startedAt`+`readingTime`, décompte local, valeur toujours affichée). À la réception de `question:show` (déjà géré) → bascule en phase question (réponses + chrono) comme aujourd'hui. Réutiliser le `PhaseTransition`/crossfade existant.
- [ ] **Step 3 — test** : étendre `BigScreen.motion.test.tsx` (ou ajouter un test) : émettre `question:reading` → l'énoncé est rendu, les libellés d'options ne le sont PAS ; puis `question:show` → options rendues. Focus RGAA au montage de la phase conservé.
- [ ] **Step 4 — tests** `pnpm vitest run apps/web/src` vert.
- [ ] **Step 5 — commit** : `git commit -am "feat(web): BigScreen affiche la question seule pendant la lecture puis les réponses"`

---

## Task 5 : PlayerLive + HostLive — état lecture

**Files:** Modify `apps/web/src/screens/PlayerLive.tsx`, `apps/web/src/screens/HostLive.tsx` (+ tests existants impactés).

**Interfaces:**
- Consumes: `question:reading`.
- Produces: joueurs voient l'énoncé sans pouvoir répondre pendant la lecture ; hôte voit l'état lecture.

- [ ] **Step 1 — PlayerLive** : abonnement `question:reading` → phase locale « lecture » : afficher l'énoncé + « Préparez-vous… », **tuiles de réponse masquées/désactivées** (aucune saisie possible — cohérent avec le rejet serveur). `aria-live` annonce l'entrée en lecture. `question:show` → activer la saisie (rendu actuel).
- [ ] **Step 2 — HostLive** : abonnement `question:reading` → afficher l'énoncé + « Lecture en cours… » + décompte ; `question:show` → pilotage normal. Doit être cohérent avec le snapshot reconnect en phase reading (Task 3) — un hôte qui reprend pendant la lecture voit cet écran.
- [ ] **Step 3 — tests** : ajouter des assertions ciblées (PlayerLive : pas de tuile cliquable en lecture ; HostLive : état lecture rendu). Ne pas casser les tests existants (auto-reveal, focus RGAA, etc.).
- [ ] **Step 4 — tests** `pnpm vitest run apps/web/src` vert.
- [ ] **Step 5 — commit** : `git commit -am "feat(web): PlayerLive/HostLive gèrent la phase lecture (saisie bloquée, énoncé affiché)"`

---

## Task 6 : Éditeur — champ « Temps de lecture »

**Files:** Modify `apps/web/src/screens/HostEditor.tsx` (+ `apps/web/src/api/questions.ts` si le type question web n'a pas `readingTime`), test éditeur existant s'il y en a un.

**Interfaces:**
- Consumes: `readingTime` sur le type question web + l'API PATCH question (Task 1 côté serveur route questions — vérifier que `apps/server/src/routes/questions.ts` accepte/relaie `readingTime` ; sinon l'ajouter, mirror de `timeLimit`).

- [ ] **Step 1 — API/type web** : s'assurer que le type `Question` web (`apps/web/src/api/questions.ts`) porte `readingTime: number` et que le PATCH l'envoie. Côté serveur, vérifier `routes/questions.ts` : si la validation/whitelist des champs PATCH est explicite, y ajouter `readingTime` (entier ≥ 0), mirror de `timeLimit`.
- [ ] **Step 2 — éditeur** : à côté du champ « Durée (secondes) » (`timeLimit`), ajouter un champ numérique « Temps de lecture (s) » lié à `readingTime` de la question sélectionnée, écrit via le même flux d'autosave/patch que `timeLimit`. `min=0`. Aide contextuelle courte (« 0 = pas de temps de lecture »).
- [ ] **Step 3 — test** : si un test HostEditor existe, ajouter une assertion que le champ se saisit et déclenche le patch avec `readingTime`. Sinon, test focalisé minimal.
- [ ] **Step 4 — tests** `pnpm vitest run apps/web/src` vert. Vérifier `routes-questions.test.ts` serveur si le champ PATCH a été touché : `pnpm vitest run apps/server/src/routes-questions.test.ts`.
- [ ] **Step 5 — commit** : `git commit -am "feat(admin): champ Temps de lecture par question dans l'éditeur"`

---

## Task 7 : QA d'intégration navigateur (manuelle, contrôleur)

Non-TDD — vérification bout-en-bout par le contrôleur (stack lancée) :
- [ ] Éditer un quiz : mettre readingTime=6 sur une question, sauver.
- [ ] Lancer la partie + rejoindre en joueur (2e onglet) + ouvrir le grand écran.
- [ ] `host:start` : le grand écran montre l'énoncé SEUL ~6 s (décompte), le joueur ne peut pas répondre ; après 6 s, les réponses apparaissent partout et le chrono démarre ; le joueur peut répondre.
- [ ] Reprendre la partie depuis Home pendant la lecture → l'écran hôte montre l'état lecture avec un temps restant cohérent.
- [ ] Une question avec readingTime=0 → comportement inchangé (réponses immédiates).

---

## Self-review (couverture spec)
- Spec §1 (données) → Task 1. §2 (moteur) → Task 2. §3 (passerelle/planification/annulation/reconnect) → Task 3. §4 (écrans) → Tasks 4-5. §5 (éditeur) → Task 6. Tests → chaque task + Task 7 (QA manuelle). Risques (setTimeout, reconnect, rétro-compat, anti-triche) → contraintes globales + Tasks 2/3.
- **Edge-cases fixés ici** (renvoyés par le spec) : `revealAnswers` hors `'reading'` = no-op sûr (idempotent) ; `host:reveal` pendant la lecture = annule le timeout puis suit le flux reveal normal (la garde de phase du reveal gère le reste). Ces choix privilégient « échouer/fermer proprement » plutôt que fabriquer un état.
