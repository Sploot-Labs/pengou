# Dashboard & rapports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'hôte la valeur d'après-partie : un **accueil** qui liste ses quiz et ses parties récentes, un **rapport détaillé** par partie (questions les plus ratées, résultats par joueur) et un **export CSV** réel — le tout lu depuis les données déjà persistées par le moteur (Plan 5).

**Architecture:** Le moteur persiste déjà `game_session` / `session_player` / `answer_record`. Ce plan ajoute une couche **lecture** : des repos d'agrégation tenant-scopés dans `@splootlabs/db`, des routes REST protégées (`/api/sessions…`) dont une qui **génère le CSV côté serveur** (échappement, BOM, neutralisation des formules — la génération côté client serait plus fragile), et deux écrans front (accueil hôte + rapport de partie). L'écran d'édition déménage de `/` vers `/quizzes/:quizId` pour libérer l'accueil.

**Tech Stack:** Drizzle/Postgres (agrégations SQL), Fastify, React + react-router, Vitest + testcontainers.

## Global Constraints

- **Tenant-scoping non négociable** : tout rapport passe par le scope serveur (session → membership), jamais par un id fourni par le client sans vérification. Une session d'un autre tenant → **404** (jamais 403, pas d'oracle d'existence).
- **Lecture seule** : ce plan n'écrit rien dans les données de jeu.
- **CSV généré côté serveur** : `text/csv; charset=utf-8`, **BOM UTF-8**, guillemets/échappement corrects, et **neutralisation de l'injection de formule** (`=`, `+`, `-`, `@` en tête de cellule) — l'audit du prototype avait déjà relevé ce point.
- **Pas de faux** : si une métrique n'est pas calculable, on ne l'affiche pas (pas de valeur inventée).
- **A11y** : mêmes exigences que les écrans existants (tableaux avec en-têtes liés, pas d'info portée par la seule couleur, focus/live regions cohérents).
- ESM/NodeNext, `.js`, TS strict, scope `@splootlabs/*`, tests testcontainers (Docker requis).
- Rappels API : `user.id` est `text` ; `requireUser` + `resolveScopeOr403` sont le pattern des routes protégées ; le front utilise `apiGet` (même origine) et le contexte de session partagé.

---

## File Structure

```
packages/db/src/repos/
├─ reports.ts                 # agrégations lecture (listSessions, getSessionReport)
└─ reports.test.ts
apps/server/src/routes/
├─ sessions.ts                # GET /api/sessions, /api/sessions/:id, /api/sessions/:id/export.csv
└─ routes-sessions.test.ts
apps/server/src/csv.ts        # sérialisation CSV sûre (+ csv.test.ts)
apps/web/src/
├─ api/sessions.ts            # client typé
├─ screens/Home.tsx           # NOUVEL accueil hôte (quiz + parties récentes)
├─ screens/SessionReport.tsx  # NOUVEL écran rapport
└─ routes.tsx                 # `/` → Home ; `/quizzes/:quizId` → HostEditor ; `/sessions/:id` → rapport
```

---

### Task 1: Repos de rapport (agrégations tenant-scopées)

**Files:** `packages/db/src/repos/reports.ts`, `packages/db/src/repos/reports.test.ts`, export dans `packages/db/src/index.ts`

**Interfaces:**
- `listSessions(scope, opts?: { limit?: number }): Promise<SessionSummary[]>` — sessions du tenant, plus récentes d'abord : `{ id, pin, status, startedAt, endedAt, quizId, quizTitle, playerCount }`.
- `getSessionReport(scope, sessionId): Promise<SessionReport | null>` — **null si la session n'est pas dans le tenant** :
  ```ts
  type SessionReport = {
    session: { id; pin; status; startedAt; endedAt; quizId; quizTitle }
    questions: { questionId; prompt; type; orderIndex; answerCount; correctCount; avgTimeMs: number | null }[]
    players:   { playerId; nickname; totalScore; correctCount; answerCount }[]
  }
  ```

- [ ] **Steps** : TDD. Écrire d'abord `reports.test.ts` : monter un testcontainer + migrations, créer 2 tenants, un quiz + 2 questions + une session avec 3 joueurs et des `answer_record` variés (corrects/incorrects, temps différents), puis assert :
  - `listSessions` ne renvoie que les sessions du tenant du scope (isolation : session de l'autre tenant absente), triées récentes d'abord, avec `quizTitle` et `playerCount` corrects ;
  - `getSessionReport` renvoie les agrégats justes (`answerCount`/`correctCount`/`avgTimeMs` par question, `totalScore`/`correctCount` par joueur, joueurs triés par score décroissant) ;
  - `getSessionReport` sur une session d'un **autre tenant** → `null` (pas de fuite).
  Puis implémenter avec des agrégations SQL Drizzle (`count`, `avg`, jointures), en scopant par `game_session.tenant_id = scope.tenantId`. Vérifier `pnpm --filter @splootlabs/db test`, `pnpm -r typecheck`. Commit `feat(db): repos de rapport (liste des parties + rapport détaillé) scopés`.

---

### Task 2: Sérialisation CSV sûre

**Files:** `apps/server/src/csv.ts`, `apps/server/src/csv.test.ts`

**Interfaces:** `toCsv(rows: (string | number | null)[][], opts?: { bom?: boolean }): string`

- [ ] **Steps** : TDD pur (pas de Docker). Tests d'abord :
  - échappe les champs contenant `,`, `"`, `\n` (guillemets doublés, champ entouré) ;
  - **neutralise l'injection de formule** : une cellule commençant par `=`, `+`, `-`, `@` (ou tab/CR) est préfixée d'une apostrophe `'` ;
  - `null` → cellule vide ; nombres non quotés sauf nécessité ;
  - fins de ligne **CRLF** ; **BOM UTF-8** en tête quand `bom: true`.
  Puis implémenter. Commit `feat(server): sérialisation CSV sûre (échappement, BOM, anti-injection)`.

---

### Task 3: Routes REST des rapports

**Files:** `apps/server/src/routes/sessions.ts`, `apps/server/src/routes-sessions.test.ts`, câblage dans `editor.ts` (ou un `registerReports`)

**Interfaces (toutes derrière `requireUser` + `resolveScopeOr403`) :**
- `GET /api/sessions?limit=` → `SessionSummary[]`
- `GET /api/sessions/:sessionId` → `SessionReport` | **404**
- `GET /api/sessions/:sessionId/export.csv` → `text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="arena-partie-<pin>.csv"`, corps = CSV du rapport (une section joueurs + une section questions, ou deux blocs clairement titrés — documente ton choix) | **404**

- [ ] **Steps** : TDD comme les autres routes (`routes-quizzes.test.ts` sert de modèle) : inscription hôte → cookie → jouer/seeder une session → GET liste (contient la session), GET détail (agrégats), GET csv (content-type + BOM + une ligne attendue), **session d'un autre tenant → 404 sur les trois**, **sans cookie → 401**. Implémenter en réutilisant le pattern route existant. Vérifier, commit `feat(server): routes de rapport (/api/sessions) + export CSV`.

---

### Task 4: Accueil hôte (`Home`) + déménagement de l'éditeur

**Files:** `apps/web/src/screens/Home.tsx`, `apps/web/src/api/sessions.ts`, `apps/web/src/routes.tsx`, ajustements `HostEditor.tsx` (lecture du `quizId` depuis la route)

- [ ] **Steps** :
  - `api/sessions.ts` : `listSessions()`, `getSessionReport(id)`, et l'URL de l'export CSV.
  - **Routage** : `/` → `Home` (protégé) ; `/quizzes/:quizId` → `HostEditor` (protégé, lit `quizId` via `useParams` au lieu de son état interne de sélection) ; `/quizzes/new` ou un bouton « Nouveau quiz » sur l'accueil qui crée puis navigue. `/sessions/:sessionId` → rapport (Task 5).
  - `Home` : deux sections on-brand — **Mes quiz** (liste, création, lien vers l'éditeur) et **Parties récentes** (liste depuis `listSessions` : quiz, PIN, date, nb de joueurs, statut, lien vers le rapport). États chargement / vide (« Aucune partie pour l'instant — lancez-en une depuis un quiz. ») / erreur.
  - Garder l'a11y (listes sémantiques, liens explicites, focus).
  - Vérifier build/typecheck/tests + **à la main** dans le navigateur (serveur lancé) : l'accueil liste bien les quiz et la partie jouée précédemment.
  Commit `feat(web): accueil hôte (quiz + parties récentes) + éditeur déplacé sur /quizzes/:quizId`.

---

### Task 5: Écran de rapport de partie + export CSV

**Files:** `apps/web/src/screens/SessionReport.tsx`, route `/sessions/:sessionId`, bouton d'export

- [ ] **Steps** :
  - `SessionReport` : en-tête (quiz, PIN, date, durée si calculable), **tableau des joueurs** (pseudo, score, réponses correctes/total) trié par score, **tableau des questions** avec le taux de réussite et le temps moyen, et une mise en évidence des **questions les plus ratées** (tri ou badge — pas de couleur seule : ajouter le chiffre/texte).
  - Tableaux accessibles : `<table>` avec `<caption>`, `<th scope="col">`, pas d'info portée par la seule couleur.
  - **Export CSV** : un lien/bouton vers `/api/sessions/:id/export.csv` (téléchargement natif, même origine → le cookie part tout seul). Remplace le bouton retiré au Plan 6 — cette fois il est réel.
  - États chargement / 404 (« Partie introuvable. ») / erreur.
  - Vérifier build/typecheck/tests + **à la main** : ouvrir le rapport d'une vraie partie jouée, télécharger le CSV, vérifier son contenu.
  Commit `feat(web): écran de rapport de partie + export CSV réel`.

---

### Task 6: e2e — jouer puis consulter le rapport

**Files:** `apps/server/src/reports-e2e.test.ts` (ou extension d'un e2e existant)

- [ ] **Steps** : un e2e (testcontainer) qui **joue une vraie partie** (réutiliser le montage de `game-e2e.test.ts` : hôte, 2-3 joueurs, 2 questions, réponses variées, jusqu'au podium) puis, via l'API REST authentifiée :
  - `GET /api/sessions` contient la partie (bon `quizTitle`, bon `playerCount`) ;
  - `GET /api/sessions/:id` : les agrégats **correspondent au déroulé** (le joueur le plus rapide a le meilleur score ; les compteurs correct/total par question collent aux réponses envoyées) ;
  - `GET /api/sessions/:id/export.csv` : 200, `content-type` CSV, BOM présent, contient les pseudos et les scores ;
  - une session d'un **autre tenant** → 404 sur les trois routes.
  Vérifier `pnpm test` + `pnpm -r typecheck` verts. Commit `feat(server): e2e rapports (partie jouée → liste, détail, CSV, isolation)`.

---

## Self-Review

**1. Couverture (spec §6)** : monitoring live = déjà livré par HostLive (Plan 6) ; **rapports post-partie** → Tasks 1,3,5,6 ; **CSV** → Tasks 2,3,5 ; **home dashboard hôte** → Task 4. ✅
**2. Placeholders** : Tasks 4-5 décrivent les écrans en prose avec les contrats d'API et les états attendus (pattern déjà établi aux Plans 4/6) ; Tasks 1-3 ont des contrats de fonctions/routes explicites. Le filet est l'e2e Task 6 + la vérification navigateur.
**3. Cohérence** : `SessionSummary`/`SessionReport` définis en Task 1 et consommés tels quels en Tasks 3-5 ; routes protégées avec le pattern existant ; isolation testée aux trois niveaux (repo, route, e2e).

---

## Notes pour la suite
- **Lot robustesse temps réel** (mis en file, prioritaire selon moi avant une vraie démo) : `host:reconnect`, `connectionStateRecovery` / token d'écran re-joignable, replay `question:show` sur `player:join`/`screen:join`, vrai `host:skip` serveur, flag « a déjà répondu » au reconnect.
- Ensuite : scaling cloud (Redis — **doit couvrir aussi les Maps in-memory de la gateway**, pas seulement le SessionStore), puis plans & limites (Stripe non branché).
- Le `points` par question n'existe pas en base (le moteur applique 1000) — à ajouter si l'on veut pondérer les questions.
