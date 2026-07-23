# Brancher le front (jeu jouable) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le jeu **réellement jouable dans un navigateur** : fusionner le prototype UI « Arena » dans `master` et câbler ses 6 écrans sur le vrai back (REST + Socket.IO), en supprimant toutes les données mockées — un hôte se connecte, crée un quiz, lance une partie ; des joueurs rejoignent par PIN depuis leur téléphone ; le grand écran projette ; le podium tombe.

**Architecture:** Le SPA React (servi par le même processus Fastify, donc **même origine** → cookies de session et `Origin` corrects sans bricolage) gagne : un **client API typé** (`src/api/`) pour l'auth et le CRUD quiz/questions, un **hook socket** (`src/realtime/`) encapsulant le contrat d'événements du jeu, et un **routeur** remplaçant le sélecteur d'écrans de démo. Chaque écran du prototype passe de mockData à l'état réel piloté par le serveur. Le design (tokens, RGAA) est conservé tel quel.

**Tech Stack:** React + Vite, react-router-dom, socket.io-client, Better Auth client, TypeScript strict.

## Global Constraints

- **Zéro donnée mockée à la fin** : `mockData.ts` et les « contrôles de démonstration » disparaissent des écrans réels.
- **Le design et le plancher RGAA du prototype sont préservés** (tokens, formes+labels, focus, live regions, `prefers-reduced-motion`). Ne pas régresser l'accessibilité en câblant.
- **Anti-triche côté client aussi** : le front n'affiche jamais la bonne réponse avant l'événement `question:reveal` (le serveur ne l'envoie pas — le front ne doit pas la deviner ni la stocker).
- **Même origine en prod** (le serveur sert le SPA) ; **en dev**, Vite (5173) doit **proxy** `/api` et `/socket.io` vers `http://localhost:3000` pour que cookies et sockets marchent.
- Contrat d'événements serveur (Plan 5) : hôte `host:create {quizId}` → `{sessionId, pin}`, `host:start|reveal|next|skip`, `host:createScreenToken` → `{displayToken}` ; joueur `player:join {pin, nickname}` → `{playerId, joinToken}`, `player:answer {answer}`, `player:reconnect {pin, joinToken}` ; écran `screen:join {displayToken}` ; émissions `lobby:update`, `question:show`, `question:reveal`, `scoreboard`, `podium`, `timer {timeLimit,startedAt}`, `screen:progress {answered,total}`.
- Formes de réponse : mcq `{optionIndex}`, truefalse `{value}`, text `{text}`, slider `{value}`.
- ESM/TS strict. Le package web est `@splootlabs/web`.

---

## File Structure

```
apps/web/src/
├─ main.tsx / App.tsx           # routeur (remplace le sélecteur de démo)
├─ routes.tsx                   # définition des routes
├─ api/
│  ├─ client.ts                 # fetch typé (quizzes, questions) + gestion d'erreurs
│  └─ auth.ts                   # client Better Auth (signUp/signIn/signOut/session)
├─ realtime/
│  └─ useGameSocket.ts          # hook socket typé (emit+ack, abonnements)
├─ screens/                     # les écrans du prototype, câblés (déplacés de prototype/)
│  ├─ Login.tsx / Signup.tsx    # NOUVEAUX (le prototype n'avait pas d'auth)
│  ├─ HostEditor.tsx / HostLive.tsx / Join.tsx / PlayerLive.tsx / BigScreen.tsx / Podium.tsx
├─ ui.tsx, tokens.css, app.css  # conservés du prototype
└─ (mockData.ts supprimé en fin de plan)
apps/web/vite.config.ts          # + proxy dev /api et /socket.io
```

**Routes** : `/login`, `/signup`, `/` (éditeur, protégé), `/host/:sessionId` (protégé), `/join`, `/play`, `/screen/:sessionId?token=…`.

---

### Task 1: Fusionner le prototype dans `master` + routeur + proxy dev

**Files:** merge de `feat/ui-prototype` ; `apps/web/vite.config.ts`, `apps/web/src/{main,App}.tsx`, `apps/web/src/routes.tsx`, `apps/web/package.json`

**Interfaces:** Produces — une app qui build et sert les 6 écrans **via des routes réelles** (encore en mock), + proxy dev fonctionnel.

- [ ] **Step 1: Merger la branche prototype**

```bash
git merge feat/ui-prototype
```
Conflits attendus (la branche part de `ad1b983`, avant le renommage `@splootlabs` et les Plans 2-5) :
- `apps/web/package.json` → **garder la version de `master`** (`"name": "@splootlabs/web"`), y ajouter ensuite les nouvelles deps.
- `apps/web/index.html` → **fusionner** : garder le `<title>`/`lang="fr"` de `master` ET les `<link>` de polices du prototype.
- `pnpm-lock.yaml` → régénérer (`pnpm install`) plutôt que résoudre à la main.
- `apps/web/src/App.tsx` → prendre la version du prototype (elle sera remplacée au Step 3).
Les 11 fichiers `apps/web/src/prototype/**` sont nouveaux → aucun conflit.
Après merge : `pnpm install`, `pnpm --filter @splootlabs/web build` doit passer.

- [ ] **Step 2: Proxy dev Vite**

`apps/web/vite.config.ts` — ajouter :
```ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:3000', changeOrigin: false },
    '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
  },
},
```
(`changeOrigin: false` pour que l'`Origin` reste celui du navigateur — Better Auth vérifie le CSRF.)

- [ ] **Step 3: Routeur réel (remplace le sélecteur de démo)**

Ajouter `react-router-dom` aux deps de `@splootlabs/web`. Créer `src/routes.tsx` avec les routes listées plus haut, `App.tsx` = `<RouterProvider>`. Déplacer `src/prototype/screens/*` → `src/screens/*` et `src/prototype/{ui.tsx,tokens.css,prototype.css}` → `src/` (garder les noms de classes CSS). **Supprimer `Prototype.tsx`** (le sélecteur de démo) — mais garder temporairement `mockData.ts` (les écrans s'en servent encore ; il partira Task 6).
Les écrans protégés (`/`, `/host/:id`) redirigent vers `/login` si pas de session (implémenté Task 2 ; pour l'instant un placeholder qui rend l'écran).

- [ ] **Step 4: Vérifier + Commit**

`pnpm --filter @splootlabs/web build` OK ; `pnpm test` (suite existante) verte ; `pnpm -r typecheck` propre.
```bash
git add -A && git commit -m "feat(web): fusionner le prototype + routeur réel + proxy dev"
```

---

### Task 2: Client API + auth (écrans connexion/inscription)

**Files:** `apps/web/src/api/{client,auth}.ts`, `apps/web/src/screens/{Login,Signup}.tsx`, garde de route protégée.

**Interfaces:**
- `api.get/post/patch/del(path, body?)` → JSON typé ; lève une `ApiError {status, message}` sur non-2xx (les appels incluent `credentials: 'same-origin'`).
- `authClient` : `signUp(email, password, name)`, `signIn(email, password)`, `signOut()`, `useSession()` → `{user|null, loading}` (via `GET /api/me`).
- `<RequireAuth>` : redirige vers `/login` si pas de session.

- [ ] **Steps** : TDD léger (tests de composant optionnels ; le vrai filet est l'e2e Task 6). Implémenter le client (fetch same-origin), le client auth (Better Auth expose `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out` ; la session se lit via `GET /api/me` déjà en place). Écrans Login/Signup **on-brand** (réutiliser `ui.tsx`, tokens, labels associés, erreurs textuelles, focus — plancher RGAA). Après connexion → redirection vers `/`. Vérifier manuellement contre le serveur qui tourne. Commit `feat(web): client API + auth (connexion/inscription) + garde de route`.

---

### Task 3: HostEditor câblé (CRUD réel)

**Files:** `apps/web/src/screens/HostEditor.tsx`, `apps/web/src/api/quizzes.ts`

**Interfaces:** `listQuizzes()`, `createQuiz({title})`, `updateQuiz(id,patch)`, `deleteQuiz(id)`, `listQuestions(quizId)`, `createQuestion(quizId, {type,prompt,timeLimit,payload})`, `updateQuestion(quizId,qId,patch)`, `deleteQuestion(quizId,qId)`, `reorderQuestions(quizId, orderedIds)`.

- [ ] **Steps** : remplacer l'état mocké par des appels réels (chargement, création, édition, suppression, réordonnancement). Gérer les états **chargement / vide / erreur** (le prototype a déjà les visuels). La validation par type existante côté client reste, mais **le serveur fait foi** : afficher son 400 si le payload est refusé. « Lancer la partie » → `POST`/socket `host:create` puis navigation vers `/host/:sessionId` (câblé Task 5). Vérifier à la main contre le serveur. Commit `feat(web): éditeur de quiz câblé sur l'API réelle`.

---

### Task 4: Parcours joueur câblé (Join + PlayerLive)

**Files:** `apps/web/src/realtime/useGameSocket.ts`, `apps/web/src/screens/{Join,PlayerLive}.tsx`

**Interfaces:** `useGameSocket()` → `{ socket, emitAck(ev, payload), on(ev, cb) }` (socket.io-client, même origine).

- [ ] **Steps** :
  - **Join** : formulaire PIN+pseudo → `player:join` → stocker `{sessionId, playerId, joinToken, pin}` en `localStorage` → naviguer vers `/play`. Erreur serveur (PIN inconnu) → message textuel existant.
  - **PlayerLive** : à l'arrivée, si un `joinToken` est stocké → `player:reconnect {pin, joinToken}` (récupère phase+score). S'abonner à `question:show` (rendre **exactement** ce que le serveur envoie — jamais de bonne réponse), `timer`, `question:reveal` (afficher bon/mauvais + points), `scoreboard`, `podium`. Envoyer `player:answer {answer}` selon le type (formes ci-dessus), puis état « réponse enregistrée » jusqu'au reveal.
  - Retirer les contrôles de démo de ces deux écrans.
  Commit `feat(web): parcours joueur câblé (join, réponses, reveal, reconnexion)`.

---

### Task 5: Hôte live + Grand écran câblés

**Files:** `apps/web/src/screens/{HostLive,BigScreen,Podium}.tsx`

- [ ] **Steps** :
  - **HostLive** : reçoit `sessionId` par la route ; s'abonne à `lobby:update` (joueurs qui affluent), `screen:progress` (X/N ont répondu), `question:reveal` (distribution), `scoreboard`, `podium`, `timer`. Boutons → `host:start` / `host:reveal` / `host:next` / `host:skip`. Bouton « Grand écran » → `host:createScreenToken` → affiche/copie l'URL `/screen/:sessionId?token=…`.
  - **BigScreen** : lit `token` dans l'URL → `screen:join {displayToken}` → rend lobby (PIN + joueurs), question (via ce que le serveur envoie), `timer`, distribution au reveal, scoreboard, podium. **Lecture seule.**
  - **Podium** : alimenté par l'événement `podium` (classement réel) ; l'export CSV réel viendra au plan Dashboard — garder le bouton désactivé ou masqué plutôt que de mentir.
  Commit `feat(web): hôte live + grand écran câblés sur les événements réels`.

---

### Task 6: Suppression des mocks + e2e navigateur (partie réelle)

**Files:** suppression de `mockData.ts` + reliquats de contrôles de démo ; test e2e.

- [ ] **Steps** :
  - Supprimer `mockData.ts` et **toute** référence restante ; `grep -r "mock\|démonstration"` dans `apps/web/src` doit être vide (hors commentaires légitimes).
  - **e2e navigateur** : avec le serveur + Postgres lancés, piloter un vrai parcours dans un navigateur (Chrome DevTools MCP / Playwright selon ce qui est dispo) : inscription hôte → création d'un quiz avec 2 questions → lancement → **un second contexte** rejoint par PIN → l'hôte démarre → le joueur voit la question **sans la bonne réponse** (assertion anti-triche dans le DOM) → répond → l'hôte révèle → podium. **Capturer des screenshots** des écrans clés.
  - Vérifier : `pnpm --filter @splootlabs/web build`, `pnpm test`, `pnpm -r typecheck` verts.
  Commit `feat(web): supprimer les mocks + e2e navigateur d'une partie réelle`.

---

## Self-Review

**1. Couverture :** merge+routeur (T1), auth (T2), éditeur (T3), joueur (T4), hôte+écran (T5), dé-mock + e2e (T6) → les 6 écrans câblés + les 2 écrans d'auth manquants. ✅
**2. Placeholders :** T2-T6 décrivent le câblage écran par écran avec les contrats d'événements/API explicites plutôt que le corps complet des composants — assumé (ce sont des composants UI existants à re-brancher, pas de la logique nouvelle) ; T1 a les commandes/config exactes. Le filet de sécurité est l'e2e navigateur de T6.
**3. Cohérence :** contrat d'événements repris **verbatim** du Plan 5 ; formes de réponse alignées ; `@splootlabs/web` ; routes cohérentes entre T1 et T3-T5.

---

## Notes
- **Le serveur et Postgres tournent déjà** (`localhost:3000`, conteneur `arena-pg` port 5433) — pratique pour développer et vérifier chaque tâche à la main.
- `apps/server/play-demo.mjs` reste comme démo/smoke en ligne de commande.
- Le **dashboard/rapports** (ex-Plan 6) devient le plan suivant, puis scaling cloud et plans.
