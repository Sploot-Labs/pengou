# Réponse à coût constant, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'une réponse de joueur coûte la même chose côté serveur quelle que soit la taille de la partie, pour dépasser le palier de 200 joueurs mesuré le 2026-10-31.

**Architecture:** Aujourd'hui, chaque `player:answer` fait au moins quatre `structuredClone` de l'état complet de la partie (lecture dans `submitAnswer`, sauvegarde, `engine.progress`, `engine.getSession` pour l'auto-révélation) plus un tri des identifiants de joueurs pour la signature de persistance. On ajoute au `SessionStore` une lecture sans copie (`peek`, réservée aux lectures) et une écriture ciblée d'une réponse (`recordAnswer`, qui modifie l'état en cache sans le copier et programme l'écriture coalescée). Le moteur et la passerelle utilisent ces deux chemins pour la réponse uniquement ; toutes les autres opérations gardent leurs copies.

**Tech Stack:** TypeScript, Vitest (Postgres de test pour `apps/server`), le générateur de charge de `apps/server/charge/` et `docker-compose.charge.yml`.

**Spec:** pas de spec séparée. Source : rapport `docs/charge/2026-10-31-resultats.md` (section « Après correction » : à 300 joueurs l'event loop sature pendant les questions) et la décision du propriétaire du 2026-10-31 (« go pour implémenter le 1 », piste « supprimer les copies complètes de l'état à chaque réponse, tenir un compteur »).

## Global Constraints

- Comportement fonctionnel inchangé : mêmes refus de `submitAnswer` (mêmes `reason`), même calcul de score, même anti-triche (`screen:progress` ne transporte que `answered`/`total`), même auto-révélation, même persistance (une réponse reste un changement « answers-only » coalescé à 250 ms, flush à l'arrêt gracieux).
- `peek` renvoie l'objet en cache, typé en lecture seule (`Readonly<GameSession>` au minimum) ; aucun appelant ne le modifie. Aucun `await` entre la lecture par `peek` et l'appel de `recordAnswer` dans `submitAnswer`, pour que la vérification « déjà répondu » et l'insertion soient atomiques sur la boucle d'événements.
- `recordAnswer` ne copie que la réponse soumise (`structuredClone` de l'objet `SubmittedAnswer`), jamais la session.
- Les autres méthodes du store et du moteur gardent leur contrat de copie.
- Ne jamais lancer `biome format --write` ni `pnpm format`. Lint de référence : 84 avertissements (`npx biome lint apps packages --max-diagnostics=500`), pas de hausse.
- Tests web et serveur lancés depuis la racine du dépôt. Échec isolé connu sous charge : `setupRelaunch` de `game-gateway.test.ts` (le rejouer seul).
- Texte destiné à l'utilisateur (commentaires de code en français comme le reste du fichier, rapport, commits) : pas de tiret cadratin ni demi-cadratin comme ponctuation, pas de gras d'emphase, casse de phrase dans les titres, apostrophe droite, « », pas de point médian, pas d'émoji.
- Fichiers en UTF-8, pas de sed global. Commits conventionnels en français terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.
- Test de charge : uniquement contre la pile locale `pengou-charge` (`http://localhost:3000`), jamais contre la production.

## Review Focus

- Deux réponses du même joueur arrivant dans le même tick : une seule acceptée.
- Réponse reçue pendant qu'une autre opération (révélation, passage à la question suivante) est en cours : la réponse est refusée ou comptée exactement comme avant, jamais créditée deux fois.
- Session absente du cache (après redémarrage) : `peek` la charge depuis Postgres comme `get`.
- Arrêt gracieux juste après une rafale de réponses : `flushAll` persiste toutes les réponses enregistrées par `recordAnswer`.
- Appelant qui modifie un objet obtenu par `getSession` : le cache n'est pas touché (contrat de copie conservé).

---

### Task 1: `peek` et `recordAnswer` dans les deux stores

**Files:**
- Modify: `packages/game/src/store.ts` (interface `SessionStore`, `MemorySessionStore`)
- Modify: `apps/server/src/persistent-store.ts`
- Test: `packages/game/src/store.test.ts`, `apps/server/src/persistent-store.test.ts`

**Interfaces:**
- Produces: `SessionStore.peek(id: string): Promise<Readonly<GameSession> | undefined>` (objet en cache, sans copie ; charge depuis la base si absent du cache, comme `get`) et `SessionStore.recordAnswer(id: string, round: number, playerId: string, submitted: SubmittedAnswer): Promise<void>` (insère une copie de `submitted` dans `answers[round][playerId]` de l'objet en cache ; erreur si la session n'est pas en cache ; côté persistant, programme `scheduleFlush` sans recalculer la signature, puisque l'ensemble des joueurs, la phase, la manche et les crédits ne changent pas).

- [ ] Step 1 : tests en échec. Pour chaque store : `peek` renvoie le même objet à deux appels successifs (`toBe`) et reflète une `save` ultérieure ; `recordAnswer` rend la réponse visible par `get` et `peek`, et une modification ultérieure de l'objet `submitted` passé ne change pas le store ; `recordAnswer` sur un id inconnu rejette. Côté persistant : après `recordAnswer`, la base n'est pas écrite immédiatement mais l'est après `flushAll()` (relecture par un store neuf : la réponse est là) ; `peek` sur un store neuf charge depuis la base.
- [ ] Step 2 : lancer, constater l'échec.
- [ ] Step 3 : implémenter.
- [ ] Step 4 : `pnpm vitest run packages/game/src/store.test.ts apps/server/src/persistent-store.test.ts` depuis la racine, vert.
- [ ] Step 5 : commit `perf(game): lecture sans copie et enregistrement ciblé d'une réponse dans le store`.

### Task 2: chemin de réponse sans copie de la session

**Files:**
- Modify: `packages/game/src/engine.ts` (`submitAnswer`, `progress`, nouvelle `peekSession`)
- Modify: `apps/server/src/game-gateway.ts` (handler `player:answer` uniquement)
- Test: `packages/game/src/engine.test.ts`, `apps/server/src/game-gateway.test.ts`

**Interfaces:**
- Consumes: `peek`, `recordAnswer` de la Task 1.
- Produces: `GameEngine.peekSession(sessionId: string): Promise<Readonly<GameSession>>` (lève la même erreur que `getSession` si la session est introuvable). `submitAnswer` lit par `peek` et écrit par `recordAnswer` ; `progress` lit par `peek` ; le handler `player:answer` utilise `peekSession` pour `allConnectedAnswered`. `allConnectedAnswered` accepte une `Readonly<GameSession>`.

- [ ] Step 1 : tests en échec dans `engine.test.ts` avec un store espion (enveloppe de `MemorySessionStore` qui compte les appels) : une réponse acceptée n'appelle ni `get` ni `save`, et appelle `recordAnswer` une fois ; `progress` n'appelle pas `get`. Tests de comportement (ajouter ceux qui manquent) : deux `submitAnswer` du même joueur lancés sans attendre (`Promise.all`) donnent une seule acceptation ; réponse hors phase `question` refusée avec la même `reason` qu'avant ; une réponse puis `reveal` crédite les points une seule fois.
- [ ] Step 2 : lancer, constater l'échec.
- [ ] Step 3 : implémenter. Ne pas toucher aux autres méthodes du moteur.
- [ ] Step 4 : `pnpm vitest run packages/game apps/server/src/game-gateway.test.ts` depuis la racine, puis `pnpm test` ; `npx biome lint apps packages --max-diagnostics=500` sans hausse.
- [ ] Step 5 : commit `perf(game): réponse de joueur sans copie de l'état de la partie`.

### Task 3: campagne de mesure et rapport

**Files:**
- Modify: `docs/charge/2026-10-31-resultats.md` (nouvelle section « Réponse à coût constant », chiffre annoncé)
- Create: `docs/charge/brut/<libelle>.json`
- Modify (si le chiffre annoncé change, pré-approuvé par le propriétaire) : `packages/shared/src/config.ts`, `packages/shared/src/config.test.ts`, `.env.example`, et la valeur par défaut `${MAX_PLAYERS_PER_SESSION:-160}` de `docker-compose.prod.yml` et `docker-compose.yml`

Protocole identique à la campagne précédente (voir la section « Configuration » du rapport et `.env` local) : `docker compose -p pengou-charge -f docker-compose.charge.yml down -v` puis `up -d --build` sur le code de cette branche, `/health` puis 30 s, un seul générateur à la fois au premier plan, `--questions 10 --cadence 25 --docker pengou-charge --cible http://localhost:3000` (ou l'option équivalente de `--help`), environ un processus générateur par 100 joueurs, deux passages par palier, libellés suffixés `-cc` (« coût constant »).

- [ ] Step 1 : paliers 200, 300, 500, 750, 1000, arrêt au premier palier en échec confirmé plus un passage du suivant. Si l'écart entre le plus haut réussi et le premier en échec dépasse 100, jouer les paliers intermédiaires de 100 en 100 (2 passages).
- [ ] Step 2 : `etab-cc` (10 × 30, 2 passages) et `rafale-cc` au plus haut palier réussi.
- [ ] Step 3 : si le plus haut palier réussi atteint 1000, ajouter un passage `etab1000-cc` (`--parties 30 --joueurs 35`, 2 passages) pour la question « 1000 personnes en plusieurs parties ».
- [ ] Step 4 : rapport. Section « Réponse à coût constant » : ce qui a changé, tableau au format des précédents, goulot du nouveau premier échec en une phrase (arrivées ou questions, CPU app et db, RSS), puis « Chiffre annoncé » recalculé avec la même règle (plus haut palier réussi arrondi vers le bas à la centaine, moins 20 %), anciennes valeurs (80 puis 160) gardées comme historique.
- [ ] Step 5 : défaut du plafond aligné sur le nouveau chiffre dans les cinq emplacements listés ; `pnpm test`.
- [ ] Step 6 : commits `docs(charge): résultats avec réponse à coût constant` puis, si le défaut change, `feat(server): plafond de joueurs aligné sur la réponse à coût constant`.
