# Test de charge et plafond de joueurs, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesurer combien de joueurs une instance Pengou de la taille du VPS de production tient réellement, publier ce chiffre dans un rapport daté, et protéger le serveur par un plafond configurable de joueurs par partie.

**Architecture:** Un générateur de charge Node (`apps/server/charge/`), construit sur le modèle de `play-demo.mjs`, inscrit un hôte par l'API REST, ouvre une ou plusieurs parties, puis répartit les joueurs simulés sur des processus enfants (`child_process.fork`) qui parlent uniquement WebSocket. L'orchestrateur garde les sockets hôtes, échantillonne `/metrics` (et `docker stats` en option) et calcule un verdict par palier. La cible est l'image Docker de production lancée en local via un compose dédié, bridé aux ressources du VPS. Côté produit, une variable `MAX_PLAYERS_PER_SESSION` borne `player:join` sans jamais gêner `player:reconnect`.

**Tech Stack:** Node 24 (`node:child_process`, `node:perf_hooks`, `node:util` `parseArgs`), `socket.io-client` 4.8 (déjà en devDependency de `apps/server`), Fastify 5 et prom-client 15 côté serveur, zod (`packages/shared`), React + Vitest/Testing-Library (`apps/web`), Docker Compose.

## Décisions

Décisions prises par le propriétaire du produit, à appliquer telles quelles (pas de spec séparée).

1. Outil : un script Node sans nouvelle dépendance lourde, à côté de `play-demo.mjs`, qui pilote un hôte et N joueurs en WebSocket seul (`transports: ['websocket']`), répartis sur plusieurs processus enfants pour ne pas saturer le générateur lui-même. Paramètres : nombre de joueurs, nombre de parties simultanées, nombre de questions, cadence d'arrivée, URL cible. Sortie : un résumé JSON et un tableau lisible.
2. Mesures : taux de succès des `player:join` ; latence d'ack de `player:join` et `player:answer` (p50, p95, p99, max) ; latence de diffusion, c'est-à-dire le délai entre l'action de l'hôte et la réception de `question:show` par le dernier joueur (p95 et max) ; erreurs et déconnexions ; côté serveur, échantillonnage de `/metrics` pendant le test (event loop lag, mémoire RSS, CPU).
3. Critères de réussite d'un palier : 100 % des joueurs ont rejoint, zéro déconnexion, ack `player:answer` p95 sous 300 ms, diffusion `question:show` p95 sous 1 s, event loop lag p99 sous 200 ms. Paliers : 50, 100, 200, 300, 500, 750, 1000 joueurs dans une partie, puis un scénario « établissement » de 10 parties de 30 joueurs simultanées.
4. Environnement : l'image Docker de prod lancée en local avec des limites `cpus` et `mem_limit` égales à celles du VPS de production, via un fichier compose dédié au test. La taille du VPS est relevée sur le serveur (`nproc`, `free -m`) avant de fixer ces limites, sans inventer de valeur.
5. Plafond : nouvelle variable `MAX_PLAYERS_PER_SESSION` (défaut provisoire 300, à ajuster après le test), vérifiée dans `player:join` avant `engine.addPlayer`, avec le message « La partie est complète. » côté joueur (`apps/web/src/screens/Join.tsx`). Une reconnexion d'un joueur déjà inscrit n'est jamais bloquée par le plafond.
6. Livrable : un rapport `docs/charge/AAAA-MM-JJ-resultats.md` (date réelle au moment de l'exécution) avec la configuration, les résultats par palier, le goulot identifié, et le chiffre annoncé : le plus haut palier réussi, arrondi vers le bas, avec une marge. Le plan s'arrête au rapport ; corriger les goulots trouvés fera l'objet d'autres plans, sauf si une correction triviale (par exemple coalescer les `lobby:update` en rafale) débloque un palier, auquel cas le plan prévoit une tâche optionnelle clairement séparée (Task 7).
7. Ne jamais lancer le test contre la production publique.
8. Confirmé par le propriétaire le 2026-10-30 : le test se fait en local, sans VPS de préproduction. Les biais (cœurs du poste plus rapides, Postgres non bridé à part, proxy TLS absent) sont documentés dans le rapport. La marge de 20 % sur le chiffre annoncé et un plafond par défaut aligné sur ce chiffre sont retenus.

## Global Constraints

- Cible du générateur : uniquement une adresse de boucle locale (`localhost`, `127.0.0.1`, `::1`). Toute autre cible fait sortir le script avec le code 2, sans aucune requête émise.
- Aucune nouvelle dépendance npm. Le générateur n'utilise que Node 24 et `socket.io-client` (déjà présent dans `apps/server/package.json`).
- Sockets joueurs : `io(cible, { transports: ['websocket'], reconnection: false, forceNew: true })`. `reconnection: false` pour qu'une coupure compte comme déconnexion au lieu d'être masquée ; `forceNew: true` pour une connexion TCP par joueur.
- Toutes les mesures de temps croisées entre processus utilisent `Date.now()` sur la même machine. `performance.now()` n'est permis que pour des durées mesurées dans un seul processus (latence d'ack).
- Seuils de verdict, en constantes nommées dans le générateur : `REPONSE_P95_MAX_MS = 300`, `DIFFUSION_P95_MAX_MS = 1000`, `LAG_SERVEUR_P99_MAX_MS = 200`, `LAG_GENERATEUR_P99_MAX_MS = 100`.
- Message de plafond, texte exact côté serveur et côté joueur : `La partie est complète.`
- `MAX_PLAYERS_PER_SESSION` : entier strictement positif, défaut `300`. Les joueurs déconnectés mais inscrits comptent dans le plafond (ils peuvent revenir par `player:reconnect`).
- Le compose de test reprend les variables de `docker-compose.prod.yml` (même `NODE_ENV=production` de l'image, même `RATE_LIMIT_MAX` par défaut, même `LOG_LEVEL` par défaut) ; seules différences autorisées : build local, `MAX_PLAYERS_PER_SESSION: "5000"` pour que le plafond ne fausse pas les paliers, limites de ressources, port et nom de projet.
- Ne jamais lancer `biome format --write` ni `pnpm format` sur ce dépôt. `pnpm lint` (lecture seule) reste autorisé.
- Aucun secret commité : `BETTER_AUTH_SECRET`, `SESSION_SECRET` et les limites viennent du `.env` local (déjà ignoré par git).
- Texte destiné à l'utilisateur (UI, rapport, commits) : pas de tiret cadratin ni demi-cadratin comme ponctuation, pas de gras d'emphase, casse de phrase dans les titres, apostrophe droite, pas de point médian, pas d'émoji.
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Arrivée de 500 joueurs en quelques secondes : chaque `player:join` diffuse `lobby:update` avec la liste complète à toute la room, soit un volume en O(N²) octets par arrivée et O(N³) sur la rafale, côté serveur comme côté générateur. Attendu : le rapport isole ce cas par un passage « rafale » dédié (Task 6, étape 5) et dit si c'est lui qui casse le palier ; la tâche optionnelle 7 le traite si c'est le cas.
- Rate limit qui fausse les mesures : Better Auth plafonne `/api/auth/*` à 20 requêtes par minute et Fastify à `RATE_LIMIT_MAX` (1000 par minute et par IP), alors que tout le générateur sort de la même IP. Attendu : une seule inscription par exécution, aucune requête HTTP par joueur (Socket.IO passe hors Fastify), un 429 fait échouer l'exécution avec un message explicite au lieu d'être compté comme latence. Vérifié en Task 3, étape 5 (deux exécutions enchaînées sans 429).
- Générateur qui sature avant le serveur : des centaines de sockets par processus qui parsent chacune chaque `lobby:update`. Attendu : chaque processus mesure son propre event loop lag ; au-delà de `LAG_GENERATEUR_P99_MAX_MS`, le verdict vaut `invalide` et non `echoue`. Vérifié en Task 4, étape 4 (saturation provoquée volontairement avec `--processus 1`).
- Horloges entre processus pour la diffusion : `t0` est pris dans l'orchestrateur, la réception dans les enfants. Attendu : tout en `Date.now()` sur une seule machine, aucune répartition du générateur sur plusieurs machines, et un compteur `horlogeIncoherente` des délais négatifs qui doit rester à 0. Vérifié en Task 3, étape 4.
- Écriture Postgres coalescée sous charge : chaque arrivée change l'ensemble des joueurs, donc déclenche une écriture immédiate (non coalescée) de tout `engine_state` plus un `INSERT session_player`, avec un pool de 10 connexions ; seules les réponses sont coalescées à 250 ms. Attendu : après chaque palier, la base est cohérente avec ce que le générateur a vu (lignes `session_player`, clés de `engine_state->'players'`, lignes `answer_record`), et le CPU du conteneur Postgres figure au rapport. Vérifié en Task 6, étape 3.

---

### Task 1: Plafond serveur `MAX_PLAYERS_PER_SESSION`

**Files:**
- Modify: `packages/shared/src/config.ts` (schéma `EnvSchema`, type `AppConfig`, `loadConfig`)
- Modify: `.env.example` (section « Durcissement », une entrée commentée `# MAX_PLAYERS_PER_SESSION=300` avec une phrase d'explication)
- Modify: `apps/server/src/game-gateway.ts` (type `SessionMeta`, `buildHostedSession` vers la ligne 385, réhydratation vers la ligne 775, migration de `host:relaunch` vers la ligne 901, handler `player:join` vers la ligne 1086)
- Test: `packages/shared/src/config.test.ts`
- Test: `apps/server/src/game-gateway.test.ts`

**Interfaces:**
- Produces: `AppConfig.maxPlayersPerSession: number`, lu depuis `MAX_PLAYERS_PER_SESSION` (`z.coerce.number().int().positive().default(300)`).
- Produces: constante exportée `SESSION_FULL_MESSAGE = 'La partie est complète.'` dans `apps/server/src/game-gateway.ts`.
- Produces (fil Socket.IO) : `player:join` répond `{ error: 'La partie est complète.' }` quand la partie est pleine ; aucun `lobby:update`, aucune entrée dans la room, `socket.data` inchangé.
- Produces (interne) : champ `seatsTaken: number` de `SessionMeta`, compteur synchrone des places prises (voir étape 5).

- [ ] **Step 1: Écrire les tests de configuration en échec** dans `config.test.ts`

```ts
it('MAX_PLAYERS_PER_SESSION vaut 300 par défaut', () => {
  expect(loadConfig({}).maxPlayersPerSession).toBe(300)
})
it('MAX_PLAYERS_PER_SESSION est coercé en nombre', () => {
  expect(loadConfig({ MAX_PLAYERS_PER_SESSION: '1200' }).maxPlayersPerSession).toBe(1200)
})
it('MAX_PLAYERS_PER_SESSION refuse 0, un négatif et un décimal', () => {
  for (const v of ['0', '-5', '2.5']) expect(() => loadConfig({ MAX_PLAYERS_PER_SESSION: v })).toThrow()
})
```

- [ ] **Step 2: Écrire les tests de passerelle en échec** dans `game-gateway.test.ts`

Ajouter un second paramètre optionnel à `buildApp` : `buildApp(store = new MemorySessionStore(), env: Record<string, string> = {})`, fusionné dans l'appel `loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single', ...env })`. Réutiliser `setupHostedSession`, `connectClient`, `ack`, `raceNoEvent`.

```ts
it('player:join refuse le joueur de trop avec « La partie est complète. »', async () => {
  // buildApp(undefined, { MAX_PLAYERS_PER_SESSION: '2' }) ; setupHostedSession ; Ana et Bob rejoignent
  const noLobby = raceNoEvent(carl, 'lobby:update', 400)
  const res = await ack<{ error?: string; playerId?: string }>(carl, 'player:join', { pin, nickname: 'Carl' })
  expect(res.error).toBe('La partie est complète.')
  expect(res.playerId).toBeUndefined()
  expect(await noLobby).toBe(true)
})

it('player:join concurrents : exactement MAX_PLAYERS_PER_SESSION places accordées', async () => {
  // MAX_PLAYERS_PER_SESSION = '3' ; 5 clients connectés d'abord, puis les 5 join lancés ensemble
  const results = await Promise.all(clients.map((c, i) =>
    ack<{ error?: string; playerId?: string }>(c, 'player:join', { pin, nickname: `J${i}` })))
  expect(results.filter((r) => r.playerId).length).toBe(3)
  expect(results.filter((r) => r.error === 'La partie est complète.').length).toBe(2)
})

it('player:reconnect d’un joueur inscrit passe même quand la partie est pleine', async () => {
  // MAX_PLAYERS_PER_SESSION = '1' ; Ana rejoint (garde joinToken) puis ferme sa socket
  // une nouvelle socket fait player:reconnect { pin, joinToken }
  expect(reconnected.error).toBeUndefined()
  // et un nouveau player:join reste refusé
  expect(refused.error).toBe('La partie est complète.')
})

it('un player:join refusé pour une autre raison ne consomme pas de place', async () => {
  // MAX_PLAYERS_PER_SESSION = '1' ; un join avec pseudo de 33 caractères échoue,
  // puis un join valide réussit
  expect(ok.playerId).toBeDefined()
})
```

- [ ] **Step 3: Lancer les tests et constater l'échec**

Run: `pnpm vitest run packages/shared/src/config.test.ts apps/server/src/game-gateway.test.ts -t "MAX_PLAYERS_PER_SESSION|complète|pleine|consomme"`
Expected: FAIL (`maxPlayersPerSession` undefined, le 3e joueur est accepté).

- [ ] **Step 4: Ajouter `MAX_PLAYERS_PER_SESSION` à `EnvSchema`, `maxPlayersPerSession` à `AppConfig` et à `loadConfig`**, avec un commentaire d'une ligne au style du fichier (plafond provisoire, ajusté d'après `docs/charge/`). Documenter la variable dans `.env.example`.

- [ ] **Step 5: Implémenter le contrôle dans `player:join`**

Le contrôle doit tenir face à des `player:join` concurrents : entre `engine.getSession` et `engine.addPlayer` il y a des `await`, un simple « compter puis ajouter » laisse passer N+1 joueurs. D'où un compteur synchrone dans `SessionMeta` :

```ts
// SessionMeta
/** Places prises (joueurs inscrits + arrivées en cours), lu et incrémenté sans await entre les deux. */
seatsTaken: number
```

Initialisation : `0` dans `buildHostedSession` ; `Object.keys(session.players).length` à la réhydratation ; `+1` par joueur migré dans `host:relaunch` (pas de contrôle de plafond dans la relance : la partie d'origine le respectait déjà). Dans `player:join`, juste après la récupération de `meta` et avant tout `await` :

```ts
if (meta.seatsTaken >= config.maxPlayersPerSession) throw new Error(SESSION_FULL_MESSAGE)
meta.seatsTaken += 1
let added = false
try {
  const { session, player } = await engine.addPlayer(sessionId, nickname)
  added = true
  // ... suite inchangée
} catch (e) {
  if (!added) meta.seatsTaken -= 1
  throw e
}
```

Les validations de pin et de pseudo restent avant ce bloc (elles ne prennent pas de place). `player:reconnect` n'est pas modifié.

- [ ] **Step 6: Lancer les tests ciblés, puis toute la suite**

Run: `pnpm vitest run packages/shared/src/config.test.ts apps/server/src/game-gateway.test.ts`
Expected: PASS.
Run: `pnpm test` puis `pnpm --filter @splootlabs/server typecheck` puis `pnpm lint`
Expected: tout vert (485 tests ou plus), aucune erreur de type ni de lint.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config.ts packages/shared/src/config.test.ts .env.example apps/server/src/game-gateway.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(server): plafond de joueurs par partie (MAX_PLAYERS_PER_SESSION)"
```

### Task 2: Message « La partie est complète. » côté joueur

**Files:**
- Modify: `apps/web/src/screens/Join.tsx`
- Create: `apps/web/src/screens/Join.test.tsx`

**Interfaces:**
- Consumes: l'ack `{ error: 'La partie est complète.' }` de `player:join` (Task 1), qui arrive dans `Join.tsx` comme une `Error` levée par `emitAck` avec ce message.
- Produces: rien pour les autres tâches.

Aujourd'hui toute erreur serveur s'affiche sous le champ PIN, qui passe en `aria-invalid` et prend le focus. Pour une partie pleine le PIN est juste : le message doit s'afficher au niveau du formulaire, sans marquer le PIN invalide.

- [ ] **Step 1: Écrire les tests en échec** dans `Join.test.tsx`

Environnement `// @vitest-environment jsdom`, rendu sous `MemoryRouter`, mock de `../realtime/useGameSocket` sur le modèle de `PlayerLive.rejoin.test.tsx` (`emitAck` en `vi.fn`).

```ts
it('partie pleine : affiche « La partie est complète. » sans invalider le PIN', async () => {
  mockEmitAck.mockRejectedValueOnce(new Error('La partie est complète.'))
  // saisir PIN 123456 et pseudo Plume, soumettre
  expect(await screen.findByRole('alert')).toHaveTextContent('La partie est complète.')
  expect(screen.getByLabelText('Code banquise')).not.toHaveAttribute('aria-invalid')
})

it('PIN invalide : le message reste attaché au champ PIN', async () => {
  mockEmitAck.mockRejectedValueOnce(new Error('PIN invalide'))
  // soumettre
  expect(await screen.findByRole('alert')).toHaveTextContent('PIN invalide')
  expect(screen.getByLabelText('Code banquise')).toHaveAttribute('aria-invalid', 'true')
})
```

- [ ] **Step 2: Lancer les tests et constater l'échec**

Run: `pnpm vitest run apps/web/src/screens/Join.test.tsx`
Expected: FAIL sur le premier test (le PIN porte `aria-invalid="true"`).

- [ ] **Step 3: Implémenter dans `Join.tsx`**

Constante `const PARTIE_COMPLETE = 'La partie est complète.'`. Ajouter un champ `form?: string` à `FieldErrors`. Dans le `catch` de `handleSubmit`, si `err.message === PARTIE_COMPLETE`, poser `errors.form` (et ne pas toucher `errors.pin` ni le focus du PIN) ; sinon comportement actuel. Rendre `errors.form` dans un `<p className="join-error" role="alert">` placé juste au-dessus du bouton « Rejoindre la colonie ». Effacer `errors.form` à la prochaine soumission (déjà le cas via `setErrors(next)`).

- [ ] **Step 4: Lancer les tests web**

Run: `pnpm vitest run apps/web/src/screens/Join.test.tsx` puis `pnpm test`
Expected: PASS, suite complète verte.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Join.tsx apps/web/src/screens/Join.test.tsx
git commit -m "feat(web): message partie complète à l'écran de connexion joueur"
```

### Task 3: Générateur de charge (hôte, joueurs, mesures côté client)

**Files:**
- Create: `apps/server/charge/charge.mjs` (orchestrateur : arguments, garde de cible, préparation REST, sockets hôtes, fork des processus, agrégation, sortie)
- Create: `apps/server/charge/joueurs.mjs` (processus enfant : sockets joueurs)
- Create: `apps/server/charge/stats.mjs` (fonctions pures)
- Modify: `apps/server/package.json` (script `"charge": "node charge/charge.mjs"`)

**Interfaces:**
- Produces (CLI) : `pnpm --filter @splootlabs/server charge -- [options]` avec
  `--cible` (défaut `http://localhost:3000`), `--joueurs` (par partie, défaut 50), `--parties` (défaut 1), `--questions` (défaut 10), `--cadence` (arrivées par seconde, toutes parties confondues, défaut 25), `--processus` (défaut `Math.ceil(total / 100)`), `--libelle` (défaut `${parties}x${joueurs}`), `--json` (chemin du résumé, défaut `charge-<libelle>-<horodatage>.json` dans le dossier courant), `--docker` (nom de projet compose, utilisé en Task 4).
- Produces (`stats.mjs`) :
  - `percentile(valeurs: number[], p: number): number` (rang le plus proche sur copie triée, `NaN` si vide)
  - `resumer(valeurs: number[]): { n: number; p50: number; p95: number; p99: number; max: number }` (ms arrondies au dixième)
  - `estCibleLocale(url: string): boolean` (`localhost`, `127.0.0.1`, `::1`, `[::1]`)
- Produces (IPC parent vers enfant) : `{ type: 'demarrer', cible, debutEpochMs, joueurs: Array<{ pin, pseudo, decalageMs }>, reponseMs: [500, 3000] }` puis `{ type: 'terminer' }`.
- Produces (IPC enfant vers parent) : `{ type: 'arrivees', rejointsParPin: Record<string, number>, refus: Record<string, number> }` une fois tous les join tentés, puis `{ type: 'resultat', joinMs: number[], reponseMs: number[], acceptesParPin: Record<string, number>, receptions: Array<{ pin, index, epochMs }>, erreurs: { ackTimeout, reponseRefusee, connexion }, deconnexions: number, lagP99Ms: number }`.
- Produces (JSON, champs utilisés par les Tasks 4 à 6) : `{ libelle, horodatage, cible, parametres, parties: Array<{ pin, sessionId, rejoints, reponsesAcceptees }>, joueurs: { tentes, rejoints, refus }, latences: { join, reponse, diffusion: { n, p95, max } }, erreurs, deconnexions, horlogeIncoherente, generateur: { lagP99MaxMs } }`. La Task 4 y ajoute `serveur`, `docker`, `criteres`, `verdict`.

Déroulé d'une exécution, à suivre dans `charge.mjs` :

1. Refuser toute cible non locale (`estCibleLocale`) : message `Cible refusée : le test de charge ne vise que localhost.` et `process.exit(2)` avant toute requête.
2. Préparation REST reprise de `play-demo.mjs` (`api()` avec en-tête `origin`, cookie de session) : une seule inscription par exécution (`charge-<horodatage>@pengou.test`), un seul quiz de `--questions` QCM à 4 options, `timeLimit: 20`, `readingTime: 0`. Toute réponse HTTP 429 arrête l'exécution avec `Rate limit atteint sur <chemin> : résultat non exploitable.` et le code 3.
3. Pour chaque partie : une socket hôte (cookie, `transports: ['websocket']`), `host:create { quizId }`, puis `host:setAuto { enabled: false }` pour que seul l'orchestrateur fasse avancer la partie.
4. Pseudos `J<partie>-<n>` (moins de 32 caractères). Joueur global k arrive à `decalageMs = k * 1000 / cadence`, répartition des joueurs entre processus en tourniquet. `debutEpochMs = Date.now() + 2000`.
5. Quand tous les enfants ont envoyé `arrivees` : pour chaque partie et chaque question, `t0 = Date.now()` juste avant `host:start` (1re question) ou `host:next` (suivantes), attendre `question:reveal` sur la socket hôte (délai max 25 s), pause de 1 s, question suivante. Après la dernière, un `host:next` mène au podium. Les parties se jouent en parallèle.
6. Envoyer `terminer`, collecter les `resultat`, calculer. Diffusion : pour chaque couple (pin, index), `max(epochMs) - t0` est un échantillon ; tout délai individuel négatif incrémente `horlogeIncoherente`. Écrire le JSON, afficher le tableau (`console.table` d'une ligne par métrique : n, p50, p95, p99, max), sortir avec le code 0 si l'exécution est allée au bout.

Dans `joueurs.mjs` : connexion de chaque joueur à son `decalageMs`, `player:join` avec ack chronométré (`performance.now()`, délai max 10 s, au-delà `ackTimeout`) ; un ack `{ error }` est compté dans `refus[error]`. À chaque `question:show`, noter `Date.now()` avec `pin` et `index`, puis répondre `{ optionIndex: aléatoire 0..3 }` après un délai tiré dans `reponseMs`, ack chronométré ; `accepted: false` compte dans `reponseRefusee`. Tout `disconnect` avant `terminer` incrémente `deconnexions`, tout `connect_error` incrémente `erreurs.connexion`. Mesurer son propre lag avec `monitorEventLoopDelay({ resolution: 10 })` du début à `terminer`. À `terminer`, fermer les sockets puis envoyer `resultat`.

- [ ] **Step 1: Écrire `stats.mjs`, `joueurs.mjs`, `charge.mjs` et le script `charge`** selon les interfaces et le déroulé ci-dessus.

- [ ] **Step 2: Vérifier la garde de cible**

Run: `pnpm --filter @splootlabs/server charge -- --cible https://example.org --joueurs 5`
Expected: `Cible refusée : le test de charge ne vise que localhost.`, code de sortie 2, aucun processus enfant lancé.

- [ ] **Step 3: Démarrer un serveur local de développement**

Run: `docker compose up -d db` puis, dans un autre terminal, `pnpm dev`
Expected: `/health` répond 200 sur `http://localhost:3000`.

- [ ] **Step 4: Exécution courte**

Run: `pnpm --filter @splootlabs/server charge -- --joueurs 20 --parties 2 --questions 2 --cadence 20 --processus 2`
Expected: tableau affiché, JSON écrit, `joueurs.rejoints` = 40, `deconnexions` = 0, `horlogeIncoherente` = 0, `latences.diffusion.n` = 4, `latences.reponse.n` = 80.

- [ ] **Step 5: Vérifier l'absence de 429 sur deux exécutions enchaînées**

Run: relancer immédiatement la commande de l'étape 4 une seconde fois.
Expected: elle se termine normalement (le Better Auth de développement limite aussi à 20 par minute ; une inscription par exécution reste dessous).

- [ ] **Step 6: Lint et commit**

Run: `pnpm lint`
Expected: aucune erreur sur `apps/server/charge/`.

```bash
git add apps/server/charge apps/server/package.json
git commit -m "test(charge): générateur de charge hôte et joueurs WebSocket"
```

### Task 4: Mesures côté serveur et verdict de palier

**Files:**
- Create: `apps/server/charge/metriques.mjs`
- Modify: `apps/server/charge/charge.mjs` (échantillonnage pendant l'exécution, critères, verdict, colonnes du tableau)
- Modify: `apps/server/charge/stats.mjs` (fonction de verdict)

**Interfaces:**
- Consumes: le JSON et l'IPC de la Task 3.
- Produces (`metriques.mjs`) :
  - `lireMetriques(texte: string): { lagP99Ms: number; rssMo: number; heapMo: number; cpuSecondes: number }` à partir de `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `process_cpu_seconds_total`.
  - `echantillonnerServeur(cible: string, periodeMs: number): { arreter(): Promise<{ lagP99MaxMs, rssMaxMo, heapMaxMo, cpuMoyenPct, cpuMaxPct, echantillons }> }`, période 1000 ms. CPU en pourcentage d'un cœur : delta de `process_cpu_seconds_total` sur delta de temps, fois 100.
  - `echantillonnerDocker(projet: string, periodeMs: number)` : même forme, via `docker stats --no-stream --format "{{json .}}"` toutes les 5000 ms, restreint aux conteneurs du projet ; renvoie `Record<conteneur, { cpuMaxPct, memMaxMo }>`. Lancé seulement avec `--docker`.
- Produces (`stats.mjs`) : `verdict(resume): { criteres: { rejointTous, zeroDeconnexion, reponseP95, diffusionP95, lagServeurP99 }, verdict: 'reussi' | 'echoue' | 'invalide' }`. `invalide` si `generateur.lagP99MaxMs > LAG_GENERATEUR_P99_MAX_MS` ou si `horlogeIncoherente > 0` ; sinon `reussi` si les cinq critères sont vrais, `echoue` sinon.

prom-client 15 remet l'histogramme d'event loop à zéro à chaque lecture de `/metrics` (`lib/metrics/eventLoopLag.js`, `histogram.reset()`) : chaque échantillon est donc le p99 de la seconde écoulée. Le critère « event loop lag p99 sous 200 ms » s'évalue sur le plus haut de ces échantillons entre le premier `player:join` et le podium. Personne d'autre ne doit lire `/metrics` pendant un palier, sinon les fenêtres rétrécissent. Une lecture par seconde reste très en dessous de `RATE_LIMIT_MAX`.

- [ ] **Step 1: Écrire `metriques.mjs`, `verdict` et le branchement dans `charge.mjs`**, l'échantillonnage démarrant juste avant `debutEpochMs` et s'arrêtant au podium. Le tableau gagne une ligne par mesure serveur et une ligne finale `verdict`.

- [ ] **Step 2: Exécution courte contre le serveur de développement**

Run: `pnpm --filter @splootlabs/server charge -- --joueurs 20 --parties 1 --questions 2`
Expected: JSON avec `serveur.echantillons` supérieur à 0, `serveur.rssMaxMo` plausible (au-dessus de 50), `verdict` = `reussi`.

- [ ] **Step 3: Vérifier le rapport d'un critère non atteint**

Run: arrêter `pnpm dev`, le relancer avec `MAX_PLAYERS_PER_SESSION=10`, puis `pnpm --filter @splootlabs/server charge -- --joueurs 20 --questions 1`
Expected: `joueurs.refus` contient `"La partie est complète.": 10`, `criteres.rejointTous` = false, `verdict` = `echoue`. Cette étape valide aussi la Task 1 de bout en bout.

- [ ] **Step 4: Vérifier la détection de saturation du générateur**

Run: `pnpm --filter @splootlabs/server charge -- --joueurs 400 --cadence 400 --processus 1 --questions 1` (serveur relancé sans plafond)
Expected: `generateur.lagP99MaxMs` au-dessus de 100 et `verdict` = `invalide`. Si le poste est assez puissant pour ne pas saturer, monter à `--joueurs 800` ; noter dans le message de commit le seuil observé.

- [ ] **Step 5: Commit**

```bash
git add apps/server/charge
git commit -m "test(charge): échantillonnage /metrics et verdict par palier"
```

### Task 5: Environnement de test aux dimensions du VPS

**Files:**
- Create: `docker-compose.charge.yml`

**Interfaces:**
- Consumes: le générateur des Tasks 3 et 4.
- Produces: projet compose `pengou-charge` (services `db` et `app`), app joignable sur `http://localhost:3000`, variables lues dans le `.env` local : `BETTER_AUTH_SECRET`, `SESSION_SECRET`, `PENGOU_CHARGE_CPUS`, `PENGOU_CHARGE_MEM`, `PENGOU_CHARGE_MEMSWAP`, chacune obligatoire (`${VAR:?message}`).

- [ ] **Step 1: Relever la taille réelle du VPS (à faire par le propriétaire, en lecture seule sur le serveur)**

Run, en SSH sur le VPS : `nproc`, `free -m`, `lscpu | grep -E 'Model name|MHz'`, `docker info --format '{{.NCPU}} {{.MemTotal}}'`, `docker stats --no-stream`
Expected: valeurs notées telles quelles dans un brouillon du rapport (Task 6). Aucune valeur n'est supposée : si le relevé manque, la tâche s'arrête ici. `docker stats` montre ce que consomment déjà Postgres, le reverse proxy et tout autre service.

- [ ] **Step 2: Renseigner le `.env` local**

`PENGOU_CHARGE_CPUS` = sortie de `nproc` ; `PENGOU_CHARGE_MEM` = colonne `total` de la ligne `Mem:` de `free -m`, suffixée `m` ; `PENGOU_CHARGE_MEMSWAP` = `Mem` total plus `Swap` total, suffixé `m`. Générer `BETTER_AUTH_SECRET` et `SESSION_SECRET` par `openssl rand -base64 32`. Le `.env` n'est pas commité.

- [ ] **Step 3: Écrire `docker-compose.charge.yml`**

Copie de `docker-compose.prod.yml` avec ces seules différences : `app.build: .` au lieu de `image:`, port `"127.0.0.1:3000:3000"`, `BETTER_AUTH_URL: http://localhost:3000`, `MAX_PLAYERS_PER_SESSION: "5000"`, `POSTGRES_PASSWORD` fixé à `pengou` (base jetable), volume `charge-db-data`, et sur `app` comme sur `db` : `cpus: ${PENGOU_CHARGE_CPUS:?...}`, `mem_limit: ${PENGOU_CHARGE_MEM:?...}`, `memswap_limit: ${PENGOU_CHARGE_MEMSWAP:?...}`. Commentaire d'en-tête : fichier réservé au test de charge local, jamais déployé, et rappel que les deux conteneurs reçoivent chacun la taille du VPS alors qu'en production ils la partagent (biais optimiste à mentionner au rapport).

- [ ] **Step 4: Vérifier les ressources de Docker Desktop**

Run: `docker info --format '{{.NCPU}} {{.MemTotal}}'` sur le poste local
Expected: au moins 2 fois `PENGOU_CHARGE_CPUS` et 2 fois `PENGOU_CHARGE_MEM`, sinon augmenter les ressources de la VM WSL2 avant de continuer (sans ça les limites ne sont pas atteignables et le résultat est faux).

- [ ] **Step 5: Lancer et contrôler les limites**

Run: `docker compose -p pengou-charge -f docker-compose.charge.yml up -d --build`, puis `docker inspect pengou-charge-app-1 --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'`
Expected: `/health` répond 200, `NanoCpus` = `PENGOU_CHARGE_CPUS` fois 1e9, `Memory` = la valeur en octets de `PENGOU_CHARGE_MEM`.

- [ ] **Step 6: Palier de fumée**

Run: `pnpm --filter @splootlabs/server charge -- --joueurs 50 --docker pengou-charge --libelle fumee`
Expected: `verdict` = `reussi` (ou un échec clairement attribué à un critère), section `docker` remplie pour `app` et `db`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.charge.yml
git commit -m "test(charge): compose local bridé aux ressources du VPS"
```

### Task 6: Campagne de mesure et rapport

**Files:**
- Create: `docs/charge/AAAA-MM-JJ-resultats.md` (date réelle du jour d'exécution)
- Create: `docs/charge/brut/*.json` (un résumé JSON par passage, nommé par libellé)
- Modify (si le propriétaire valide le chiffre) : `packages/shared/src/config.ts` et `packages/shared/src/config.test.ts` (défaut de `MAX_PLAYERS_PER_SESSION`), `.env.example`

**Interfaces:**
- Consumes: JSON des Tasks 3 et 4, environnement de la Task 5.
- Produces: le chiffre annoncé, repris tel quel par le site.

Protocole commun à chaque passage : base neuve (`docker compose -p pengou-charge -f docker-compose.charge.yml down -v` puis `up -d`), 30 s d'attente après `/health`, aucune autre charge sur le poste, `--questions 10 --docker pengou-charge --json docs/charge/brut/<libelle>.json`. Chaque palier est joué 2 fois ; il est réussi si les deux passages ont `verdict` = `reussi`. Un passage `invalide` est rejoué avec plus de processus, il ne compte ni pour ni contre.

- [ ] **Step 1: Paliers à une partie, dans l'ordre**

Run: pour N dans 50, 100, 200, 300, 500, 750, 1000 : `pnpm --filter @splootlabs/server charge -- --joueurs N --cadence 25 --libelle p<N>-<essai> ...`
Expected: un JSON par passage. S'arrêter au premier palier en échec confirmé (deux passages `echoue`), plus un passage du palier suivant pour documenter la dégradation.

- [ ] **Step 2: Scénario établissement**

Run: `pnpm --filter @splootlabs/server charge -- --parties 10 --joueurs 30 --cadence 25 --libelle etab-<essai> ...`
Expected: deux JSON ; verdict consigné à part des paliers.

- [ ] **Step 3: Cohérence de la base après chaque palier réussi le plus haut et après le premier en échec**

Run, pour chaque `sessionId` du JSON : `docker compose -p pengou-charge -f docker-compose.charge.yml exec db psql -U pengou -d pengou -c "select (select count(*) from session_player where session_id = '<id>') as lignes, (select count(*) from jsonb_object_keys((select engine_state->'players' from game_session where id = '<id>'))) as moteur, (select count(*) from answer_record where session_id = '<id>') as reponses"`
Expected: `lignes` = `moteur` = `joueurs.rejoints` de la partie ; `reponses` égal au nombre d'acks `player:answer` acceptés pour cette partie (le générateur doit donc compter les acks acceptés par pin). Tout écart est un résultat à inscrire au rapport.

- [ ] **Step 4: Identifier le goulot du premier palier en échec**

Croiser critère en échec, CPU `app` et `db` (section `docker`), lag serveur et moment où il monte (pendant les arrivées ou pendant les questions). Conclure en une phrase : event loop de l'app, CPU Postgres, mémoire, ou réseau.

- [ ] **Step 5: Passage rafale (informatif)**

Run: `pnpm --filter @splootlabs/server charge -- --joueurs <plus haut palier réussi> --cadence 250 --libelle rafale ...`
Expected: JSON consigné à part. Il ne change pas le chiffre annoncé, il dit si une arrivée en masse (QR projeté dans un amphithéâtre) dégrade le lobby.

- [ ] **Step 6: Rédiger le rapport**

Sections, en casse de phrase : « Configuration » (relevé du VPS de la Task 5, limites appliquées, version de l'image et commit, poste générateur, biais connus : conteneurs bridés séparément, pas de reverse proxy TLS, cœurs locaux possiblement plus rapides que ceux du VPS) ; « Résultats par palier » (un tableau : palier, essai, rejoints, déconnexions, réponse p95, diffusion p95 et max, lag serveur p99 max, RSS max, CPU app et db max, verdict) ; « Scénario établissement » ; « Rafale » ; « Cohérence de la base » ; « Goulot identifié » ; « Chiffre annoncé ». Le chiffre annoncé est le plus haut palier réussi, arrondi vers le bas à la centaine (à la cinquantaine sous 100), moins une marge de 20 %, valeur et calcul écrits en clair. Exemple de forme seulement : palier réussi 500, annoncé 400.

- [ ] **Step 7: Ajuster le défaut du plafond, après accord du propriétaire**

Si le propriétaire valide que le plafond suit le chiffre annoncé : remplacer `300` par ce chiffre dans `EnvSchema`, dans le test « vaut 300 par défaut » et dans `.env.example`. Sinon, laisser 300 et le noter dans le rapport.
Run: `pnpm test`
Expected: suite verte.

- [ ] **Step 8: Commit**

```bash
git add docs/charge
git commit -m "docs(charge): résultats du test de charge et chiffre annoncé"
```

(et, si l'étape 7 a modifié le défaut, un commit séparé `feat(server): plafond de joueurs aligné sur le test de charge` avec les trois fichiers.)

### Task 7 (optionnelle): Coalescer les `lobby:update` en rafale

À n'exécuter que si le rapport de la Task 6 montre que le premier palier en échec casse pendant les arrivées (lag serveur ou générateur qui monte avant `host:start`) et pas pendant les questions. Sinon, la consigner comme piste dans le rapport et s'arrêter.

**Files:**
- Modify: `apps/server/src/game-gateway.ts` (handler `player:join` ; `SessionMeta` ; nettoyage de fin de session vers la ligne 311)
- Test: `apps/server/src/game-gateway.test.ts`
- Modify: `docs/charge/AAAA-MM-JJ-resultats.md` (section « Après correction »)

**Interfaces:**
- Produces (interne) : `scheduleLobbyUpdate(sessionId: string, meta: SessionMeta): void`, constante `LOBBY_UPDATE_THROTTLE_MS = 250`, champs `SessionMeta.lobbyUpdateTimer: ReturnType<typeof setTimeout> | null` et `lobbyUpdateDirty: boolean`.
- Comportement : envoi immédiat si aucun minuteur n'est en cours (une arrivée isolée se voit sans délai, comme aujourd'hui), sinon un seul envoi à la fin de la fenêtre avec la liste à jour lue dans `engine.getSession`. `player:reconnect` et les déconnexions gardent leur envoi immédiat. Le minuteur est annulé à l'éviction de la session.

- [ ] **Step 1: Écrire les tests en échec**

```ts
it('20 arrivées simultanées : moins de 20 lobby:update, le dernier liste les 20 joueurs', async () => {
  const updates = collect<{ players: unknown[] }>(hostSocket, 'lobby:update')
  await Promise.all(clients.map((c, i) => ack(c, 'player:join', { pin, nickname: `J${i}` })))
  await new Promise((r) => setTimeout(r, 400))
  expect(updates.count()).toBeLessThan(20)
  expect(updates.last().players).toHaveLength(20)
})

it('une arrivée isolée produit un lobby:update immédiat', async () => {
  const update = waitFor<{ players: unknown[] }>(hostSocket, 'lobby:update')
  await ack(ana, 'player:join', { pin, nickname: 'Ana' })
  expect((await update).players).toHaveLength(1)  // reçu sans attendre la fenêtre
})
```

Si `collect` n'expose pas `count()` et `last()`, les ajouter au helper existant du fichier de test.

- [ ] **Step 2: Constater l'échec**

Run: `pnpm vitest run apps/server/src/game-gateway.test.ts -t "lobby:update"`
Expected: FAIL sur le premier test (20 envois).

- [ ] **Step 3: Implémenter `scheduleLobbyUpdate` et l'utiliser dans `player:join`** à la place de l'émission directe.

- [ ] **Step 4: Suite complète**

Run: `pnpm test`, `pnpm --filter @splootlabs/server typecheck`, `pnpm lint`
Expected: tout vert, y compris les tests existants qui attendent un `lobby:update` après un join.

- [ ] **Step 5: Rejouer le palier bloqué**

Run: reconstruire l'image (`docker compose -p pengou-charge -f docker-compose.charge.yml up -d --build`) puis rejouer deux fois le premier palier en échec et la rafale, avec le protocole de la Task 6.
Expected: JSON dans `docs/charge/brut/` suffixés `-coalesce`. Ajouter la section « Après correction » au rapport ; ne relever le chiffre annoncé que si les deux passages sont `reussi`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/game-gateway.ts apps/server/src/game-gateway.test.ts docs/charge
git commit -m "perf(server): coalescer les lobby:update lors des arrivées en rafale"
```
