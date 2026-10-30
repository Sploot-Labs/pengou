# Exclusion d'un joueur par l'hôte, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'animateur de retirer un joueur de la partie (pseudo injurieux, élève perturbateur), sans trace du pseudo dans les rapports, avec un message clair côté joueur et sans possibilité de reprendre la place exclue par reconnexion.

**Architecture:** Le moteur gagne `kickPlayer` et une liste de jetons exclus persistée dans `engine_state` ; `reconnect` lève une erreur typée `PlayerKickedError` pour un jeton exclu. La passerelle expose `host:kick`, supprime la ligne `session_player` (cascade sur `answer_record`), détache le socket du joueur, rediffuse `lobby:update` (et `screen:progress` en phase question) puis relance la même logique d'auto-révélation que `player:answer`. Côté web, l'hôte exclut depuis la liste du lobby et le tableau en jeu ; les tableaux hôte et grand écran ne montrent que les joueurs présents dans le dernier `lobby:update` ; le joueur exclu voit un écran dédié.

**Tech Stack:** TypeScript, moteur pur `packages/game`, Socket.IO (`apps/server`), Postgres/Drizzle sous RLS (`packages/db`), React + react-router + Vitest/Testing-Library (`apps/web`).

**Décisions** (prises par le propriétaire du produit, il n'y a pas de spec) :

1. Nouvel événement `host:kick { playerId }` avec ack, réservé à l'hôte de la session, utilisable dans toutes les phases sauf podium.
2. Moteur : `kickPlayer(sessionId, playerId)` retire le joueur de `players` et ses réponses de la manche non encore créditée, et mémorise son `joinToken` dans une liste de jetons exclus de la session. `reconnect` avec un jeton exclu échoue avec une raison distincte, pour que le client affiche le bon message. Le joueur peut revenir avec un nouveau pseudo en ressaisissant le PIN (choix assumé : en classe, l'élève revient sous son vrai prénom ; pas de bannissement par appareil ou IP).
3. Base : la ligne `session_player` est supprimée (cascade sur ses `answer_record`), pour que le pseudo injurieux ne reste ni dans les rapports ni dans l'historique.
4. Passerelle : après exclusion, émettre `player:kicked` au seul socket du joueur exclu, le faire sortir de la room, nettoyer `socket.data`, `activeSocketIdByPlayerId` et `meta.playerDbIds`, diffuser `lobby:update` (et ce dont le tableau de l'hôte et le grand écran ont besoin), puis si on est en phase question et que tous les joueurs connectés restants ont répondu, déclencher la révélation automatique comme le fait `player:answer`.
5. Front hôte : un bouton « Exclure » par joueur dans la liste du lobby et dans le tableau en jeu, avec confirmation (« Exclure <pseudo> de la partie ? »), libellé accessible incluant le pseudo. Front joueur : sur `player:kicked` (ou reconnexion refusée pour exclusion), effacer la session locale et afficher « L'animateur t'a retiré de la partie. » avec un lien vers `/join`.
6. Grand écran : le joueur disparaît de la liste, rien de plus (pas d'annonce publique de l'exclusion).
7. Confirmé par le propriétaire le 2026-10-30 : exclure un joueur en cours de partie efface aussi ses réponses aux manches déjà jouées, et les statistiques du rapport changent en conséquence. Un exclu peut revenir avec le même pseudo ; on ne le bloque pas (l'hôte peut l'exclure de nouveau).

Choix d'implémentation tirés de ces décisions (à valider en relecture) :

- La garde « sauf podium » vit dans le moteur (`kickPlayer` lève au podium) : une seule source de vérité, la passerelle la relaie.
- Le tableau en jeu de l'hôte n'existait qu'à partir du premier `scoreboard` (« Le classement s'affichera après la première question. »). Pour pouvoir exclure pendant la toute première question, le tableau fusionne le classement connu et les joueurs présents absents du classement (helper `boardEntries`), et l'encart latéral s'affiche aussi en phase lecture.
- Le serveur ne rediffuse pas `scoreboard` après une exclusion (cet événement pilote des transitions de phase chez les clients) ; ce sont l'hôte et le grand écran qui filtrent leur classement sur la liste de `lobby:update`.

## Global Constraints

- Le serveur est seul maître de l'état ; la bonne réponse n'existe côté client qu'après `question:reveal` (aucune nouvelle projection ne doit l'exposer).
- Tout nouveau champ de `GameSession` est optionnel et toléré absent : un `engine_state` écrit avant cette fonctionnalité doit se réhydrater et se jouer sans erreur.
- Écritures base sous RLS via `withTenantTx(appDb, { tenantId: meta.tenantId }, ...)`, comme le reste de la passerelle.
- Libellés exacts : bouton « Exclure », `aria-label` « Exclure <pseudo> », confirmation « Exclure <pseudo> de la partie ? », message joueur « L'animateur t'a retiré de la partie. », lien « Rejoindre une partie » vers `/join`.
- Aucune annonce publique de l'exclusion (ni grand écran, ni autres joueurs, ni région `aria-live` partagée).
- Code d'erreur d'ack pour l'exclusion : `code: 'kicked'` (constante partagée côté web `KICKED_ACK_CODE`).
- Ne jamais lancer `biome format --write` sur ce dépôt (il n'est pas au format Biome).
- Typographie des textes utilisateur et des messages de commit : pas de tiret cadratin ni demi-cadratin comme ponctuation, pas de gras d'emphase, apostrophe droite, pas d'émoji.

## Review Focus

- Exclusion en phase question alors que tous les autres joueurs connectés ont déjà répondu : la manche doit s'auto-révéler une seule fois (pas de double `question:reveal`), et le compteur du grand écran doit retomber à « n / n ». Testé en Task 3.
- Jeton exclu présenté après un redémarrage serveur : la reconnexion doit être refusée avec `code: 'kicked'` (jeton persisté dans `engine_state`), et non retomber sur un « joinToken invalide » générique ni, pire, réintégrer le joueur. Testé en Task 3 (bloc réhydratation) et en Task 1 (état ancien sans le champ).
- Double clic sur « Exclure » ou deux `host:kick` concurrents : le second doit répondre `{ ok: true }` sans erreur, sans seconde diffusion ni seconde suppression en base. Testé en Tasks 1 et 3 ; le bouton est en plus désactivé pendant l'ack (Task 4).
- Exclusion d'un joueur déconnecté (aucun socket actif) : la ligne disparaît quand même de la liste et de la base, et sa reconnexion ultérieure est refusée pour exclusion. Testé en Task 3.
- Relance depuis le podium après une exclusion : l'exclu ne doit recevoir aucun `session:relaunched` (il n'est plus dans `players` et son socket a quitté la room). Testé en Task 3. Également vérifié en Task 3 : un hôte reconnecté après rechargement (`host:reconnect` sur un nouveau socket) peut exclure, et `host:kick` en phase lecture fonctionne.

Risque connu, non couvert par un test : une exclusion pendant qu'un `persistRound` est en cours pour la même manche peut faire échouer l'insertion `answer_record` du joueur supprimé (violation de FK, pas un conflit) et annuler la transaction de cette manche. L'ordre imposé en Task 3 (moteur, puis `meta.playerDbIds.delete`, puis suppression en base) réduit la fenêtre au strict trajet aller-retour d'une transaction déjà commencée ; la cicatrisation au redémarrage ne rattrape pas ce cas. À surveiller en relecture.

---

### Task 1: Moteur, `kickPlayer` et jetons exclus

**Files:**
- Modify: `packages/game/src/state.ts` (champ optionnel sur `GameSession`)
- Modify: `packages/game/src/engine.ts` (interface `Engine`, `kickPlayer`, garde dans `reconnect`, classe d'erreur)
- Modify: `packages/game/src/index.ts` (exports)
- Test: `packages/game/src/engine.test.ts` (nouveau `describe('exclusion (kickPlayer)')` dans le describe principal, qui fournit `engine`, `clock`, `store`, `mcqQuestion`)

**Interfaces:**
- Consomme : rien de nouveau.
- Produit :
  - `GameSession.kickedJoinTokens?: string[]` (absent sur un état ancien, à lire `?? []`).
  - `Engine.kickPlayer(sessionId: string, playerId: string): Promise<{ session: GameSession; kicked: Player | null }>` : `kicked` vaut `null` si le joueur n'est pas (ou plus) dans `players`, sans `store.save` (idempotent). Lève `Error('exclusion impossible au podium')` si `phase === 'podium'`.
  - `export class PlayerKickedError extends Error { readonly code = 'kicked' }`, message `'joueur exclu de la partie'`, exportée par `@splootlabs/game`.
  - `Engine.reconnect` lève `PlayerKickedError` si `joinToken` figure dans `kickedJoinTokens` (le contrat `null` pour un jeton inconnu est inchangé).

- [ ] **Step 1: Écrire les tests en échec**

```ts
describe('exclusion (kickPlayer)', () => {
  it('retire le joueur, ses réponses de la manche non créditée, et mémorise son jeton', async () => {
    const session = await engine.createSession({ quizId: 'q', tenantId: 't', hostId: 'h', questions: [mcqQuestion] })
    const { player: ana } = await engine.addPlayer(session.id, 'Ana')
    const { player: bob } = await engine.addPlayer(session.id, 'Bob')
    await engine.startQuestion(session.id)
    await engine.submitAnswer(session.id, ana.id, { optionIndex: 1 })
    const { session: after, kicked } = await engine.kickPlayer(session.id, ana.id)
    expect(kicked?.id).toBe(ana.id)
    expect(after.players[ana.id]).toBeUndefined()
    expect(after.players[bob.id]).toBeDefined()
    expect(after.answers[0]?.[ana.id]).toBeUndefined()
    expect(after.kickedJoinTokens).toEqual([ana.joinToken])
    expect(await engine.progress(session.id)).toEqual({ answered: 0, total: 1 })
  })

  it('ne touche pas aux réponses d\'une manche déjà créditée', async () => {
    // addPlayer Ana + Bob ; startQuestion ; Ana et Bob répondent ; reveal() ; kickPlayer(Ana)
    // expect(after.answers[0]?.[ana.id]).toBeDefined() ; score de Bob inchangé
  })

  it('est idempotent : un second appel renvoie kicked=null sans dupliquer le jeton', async () => {
    // kickPlayer(Ana) deux fois → second.kicked === null ; kickedJoinTokens === [ana.joinToken]
  })

  it('refuse au podium', async () => {
    // addPlayer ; startQuestion ; podium() ; await expect(engine.kickPlayer(id, ana.id)).rejects.toThrow('exclusion impossible au podium')
  })

  it('reconnect avec un jeton exclu lève PlayerKickedError (code kicked)', async () => {
    // kickPlayer(Ana) ; await expect(engine.reconnect(id, ana.joinToken)).rejects.toBeInstanceOf(PlayerKickedError)
    // et .rejects.toMatchObject({ code: 'kicked' })
  })

  it('tolère un état ancien sans kickedJoinTokens', async () => {
    // createSession + addPlayer Ana ; const raw = await store.get(id) ; delete raw!.kickedJoinTokens ; await store.save(raw!)
    // expect(await engine.reconnect(id, 'jeton-inexistant')).toBeNull()
    // const { kicked } = await engine.kickPlayer(id, ana.id) ; expect(kicked).not.toBeNull()
  })

  it('allConnectedAnswered devient vrai quand le seul joueur sans réponse est exclu', async () => {
    // Ana et Bob ; startQuestion ; Bob répond ; allConnectedAnswered === false ; kickPlayer(Ana) ; === true
  })
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd packages/game && npx vitest run src/engine.test.ts -t "exclusion"`
Expected: FAIL (`engine.kickPlayer is not a function`, `PlayerKickedError` non exporté).

- [ ] **Step 3: Implémenter** le champ dans `state.ts` (commentaire : optionnel pour tolérer un `engine_state` antérieur), `PlayerKickedError`, `kickPlayer` et la garde de `reconnect` dans `engine.ts`, les exports dans `index.ts`

`kickPlayer` : `requireSession` ; garde podium ; joueur absent → `{ session, kicked: null }` sans save ; sinon `delete session.players[playerId]`, et si `!session.credited[session.currentIndex]` alors `delete session.answers[session.currentIndex]?.[playerId]` ; `session.kickedJoinTokens = [...(session.kickedJoinTokens ?? []), player.joinToken]` ; `store.save`. Ne pas initialiser `kickedJoinTokens` dans `createSession` (le champ reste absent tant qu'aucune exclusion n'a eu lieu, ce qui garde la forme des états existants). `reconnect` : tester `kickedJoinTokens` avant la recherche du joueur.

- [ ] **Step 4: Lancer la suite moteur, vérifier le vert**

Run: `cd packages/game && npx vitest run`
Expected: PASS (nouveaux tests et non-régression).

- [ ] **Step 5: Commit**

```bash
git add packages/game/src/state.ts packages/game/src/engine.ts packages/game/src/index.ts packages/game/src/engine.test.ts
git commit -m "feat(game): exclusion d'un joueur (kickPlayer) et refus de reconnexion des jetons exclus"
```

---

### Task 2: Base, suppression d'un `session_player`

**Files:**
- Modify: `packages/db/src/repos/session.ts`
- Modify: `packages/db/src/index.ts` (export)
- Test: `packages/db/src/repos/session.test.ts`

**Interfaces:**
- Produit : `deleteSessionPlayer(db: Db, playerId: string): Promise<boolean>` (vrai si une ligne a été supprimée). Les `answer_record` du joueur partent par la cascade existante (`answer_record.player_id ON DELETE CASCADE`), aucune migration. À ajouter à la liste d'exports nominatifs du repo session dans `packages/db/src/index.ts`.

- [ ] **Step 1: Écrire les tests en échec** (ajouter `deleteSessionPlayer` et `withTenantTx` aux imports)

```ts
it('deleteSessionPlayer supprime le joueur et, en cascade, ses answer_record', async () => {
  const session = await createGameSession(tenantScope(ctx.db, tenantA), { quizId: quizA, hostId: ownerA, pin: '777001' })
  const player = await addSessionPlayer(ctx.db, session!.id, { nickname: 'Injure', joinToken: 'tok-kick' })
  await recordAnswer(ctx.db, { sessionId: session!.id, questionId: questionA, playerId: player.id, answer: { choice: 0 }, timeMs: 1000, isCorrect: true, points: 900 })
  expect(await deleteSessionPlayer(ctx.db, player.id)).toBe(true)
  expect(await ctx.db.select().from(schema.sessionPlayer).where(eq(schema.sessionPlayer.id, player.id))).toHaveLength(0)
  expect(await ctx.db.select().from(schema.answerRecord).where(eq(schema.answerRecord.playerId, player.id))).toHaveLength(0)
  expect(await deleteSessionPlayer(ctx.db, player.id)).toBe(false)
})

it('deleteSessionPlayer sous RLS ne supprime rien dans le contexte d\'un autre tenant', async () => {
  // session + joueur sur tenantA ; withTenantTx(ctx.appDb, { tenantId: tenantB }, (s) => deleteSessionPlayer(s.db, player.id)) → false
  // la ligne existe toujours ; puis dans le contexte tenantA → true
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd packages/db && npx vitest run src/repos/session.test.ts -t deleteSessionPlayer`
Expected: FAIL (`deleteSessionPlayer` non exporté).

- [ ] **Step 3: Implémenter `deleteSessionPlayer`** : `db.delete(schema.sessionPlayer).where(eq(schema.sessionPlayer.id, playerId)).returning({ id: schema.sessionPlayer.id })`, renvoie `rows.length > 0`. Commentaire : sert à l'exclusion, pour que le pseudo ne subsiste dans aucun rapport.

- [ ] **Step 4: Lancer la suite du repo, vérifier le vert**

Run: `cd packages/db && npx vitest run src/repos/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repos/session.ts packages/db/src/repos/session.test.ts packages/db/src/index.ts
git commit -m "feat(db): suppression d'un joueur de session (deleteSessionPlayer)"
```

---

### Task 3: Passerelle, événement `host:kick`

**Files:**
- Modify: `apps/server/src/game-gateway.ts` (import de `deleteSessionPlayer` et `PlayerKickedError`, helper `maybeAutoReveal`, handler `host:kick`, catch de `player:reconnect`)
- Test: `apps/server/src/game-gateway.test.ts` (nouveau `describe('host:kick (exclusion d\'un joueur)')` et un test dans le bloc « Task 4, réhydratation au boot »)

**Interfaces:**
- Consomme : `engine.kickPlayer`, `PlayerKickedError` (Task 1) ; `deleteSessionPlayer` (Task 2).
- Produit (fil Socket.IO) :
  - `host:kick` (hôte vers serveur), payload `{ playerId: string }`, ack `{ ok: true } | { error: string }`.
  - `player:kicked` (serveur vers le seul socket du joueur exclu), payload `{}`.
  - `player:reconnect` sur jeton exclu : ack `{ error: 'joueur exclu de la partie', code: 'kicked' }`.
- Produit (interne) : `maybeAutoReveal(sessionId: string, meta: SessionMeta): Promise<void>`, extrait tel quel du bloc best-effort de `player:answer` (getSession, `allConnectedAnswered`, garde `autoRevealedRounds`, `doRevealBySession`) ; `player:answer` l'appelle désormais.

- [ ] **Step 1: Écrire les tests en échec**

Réutiliser `buildApp`, `setupHostedSession`, `connectClient`, `ack`, `waitFor`, `raceNoEvent`, et le `setupRelaunch`/`toPodium` du bloc `host:relaunch` (le remonter au niveau du describe parent s'il n'est pas accessible).

```ts
describe("host:kick (exclusion d'un joueur)", () => {
  it('au lobby : retire le joueur, prévient son seul socket, met à jour la liste et supprime la ligne en base', async () => {
    // setupHostedSession ; Ana et Bob player:join
    const kickedAna = waitFor(ana, 'player:kicked')
    const noKickBob = raceNoEvent(bob, 'player:kicked', 400)
    const lobby = waitFor<{ players: Array<{ id: string }> }>(hostSocket, 'lobby:update')
    expect(await ack(hostSocket, 'host:kick', { playerId: anaId })).toEqual({ ok: true })
    await kickedAna
    expect(await noKickBob).toBe(true)
    expect((await lobby).players.map((p) => p.id)).toEqual([bobId])
    // ligne session_player d'Ana absente (ctx.db, filtre sur sessionId + nickname 'Ana')
    // le socket d'Ana ne reçoit plus les diffusions de la room : raceNoEvent(ana, 'lobby:update', 400) après un player:join de Carl → true
    // player:answer depuis le socket d'Ana → ack { accepted: false, error: 'joueur non rattaché à une session' }
  })

  it('reconnexion avec le jeton exclu refusée avec code kicked ; nouveau player:join accepté', async () => {
    // après host:kick : ack(ana2, 'player:reconnect', { pin, joinToken: anaToken }) → { error: 'joueur exclu de la partie', code: 'kicked' }
    // ack(ana2, 'player:join', { pin, nickname: 'Anaïs' }).error === undefined
  })

  it('double host:kick : le second répond ok sans nouvelle diffusion', async () => {
    // premier host:kick ; puis const noLobby = raceNoEvent(hostSocket, 'lobby:update', 400) ; second ack → { ok: true } ; await noLobby → true
  })

  it('refusé pour un socket non hôte et au podium', async () => {
    // ack(bob, 'host:kick', { playerId: anaId }).error défini, Ana toujours dans la liste
    // quiz mono-question : host:start, host:next jusqu'au podium ; host:kick → error 'exclusion impossible au podium'
  })

  it('en phase question : exclure le seul joueur sans réponse déclenche une seule révélation et met à jour le compteur', async () => {
    // Ana et Bob ; host:start ; Bob répond
    const progress = waitFor<{ answered: number; total: number }>(hostSocket, 'screen:progress')
    const reveal = waitFor(hostSocket, 'question:reveal')
    await ack(hostSocket, 'host:kick', { playerId: anaId })
    expect(await progress).toEqual({ answered: 1, total: 1 })
    await reveal
    expect(await raceNoEvent(hostSocket, 'question:reveal', 400)).toBe(true)
  })

  it('en phase lecture : exclusion acceptée, aucune révélation', async () => {
    // setupHostedSession(app, url, email, 20, 2) ; host:start (phase reading) ; host:kick → ok ; raceNoEvent(hostSocket, 'question:reveal', 400) → true
  })

  it("exclusion d'un joueur déconnecté : retiré de la liste et de la base, reconnexion refusée", async () => {
    // Ana join puis ana.disconnect() ; attendre le lobby:update ou un court délai ; host:kick → ok ; liste sans Ana ; ligne absente
    // nouveau client : player:reconnect avec le jeton d'Ana → code 'kicked'
  })

  it('un hôte reconnecté après rechargement peut exclure', async () => {
    // hostSocket.disconnect() ; host2 = connectClient(url, { cookie }) ; host:reconnect { sessionId } ; host:kick → ok
  })

  it("après exclusion, host:relaunch au podium ne migre pas l'exclu", async () => {
    // setupRelaunch ; Ana et Bob join ; host:kick Ana ; toPodium(hostSocket, bob)
    // const noRelaunch = raceNoEvent(ana, 'session:relaunched', 400) ; host:relaunch quizB ; Bob reçoit session:relaunched ; await noRelaunch → true
  })
})

// Dans describe('Task 4, réhydratation au boot') :
it('un jeton exclu reste refusé après redémarrage serveur', async () => {
  // store1 = new PersistentSessionStore(ctx.db) ; app1 : hôte, Ana et Bob join, host:kick Ana ; fermer app1
  // store2 + app2 : client neuf, player:reconnect { pin, joinToken: anaToken } → { code: 'kicked' } ; Bob se reconnecte normalement
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/server && npx vitest run src/game-gateway.test.ts -t "host:kick|jeton exclu"`
Expected: FAIL (`host:kick` inexistant, ack vide ou timeout).

- [ ] **Step 3: Extraire `maybeAutoReveal(sessionId, meta)`** depuis `player:answer`, sans changer son comportement ; `player:answer` l'appelle dans son `try/catch` best-effort existant.

- [ ] **Step 4: Implémenter le handler `host:kick`**

Ordre, dans le `try/catch` habituel renvoyant `{ error }` :
1. `requireHost(socket)` ; `playerId` chaîne non vide sinon `Error('playerId requis')`.
2. `const { session, kicked } = await engine.kickPlayer(sessionId, playerId)` ; si `kicked === null`, `reply({ ok: true })` et sortir (idempotence, aucune diffusion).
3. `const dbPlayerId = meta.playerDbIds.get(playerId)` puis `meta.playerDbIds.delete(playerId)` avant toute I/O, puis, si `dbPlayerId`, `withTenantTx(appDb, { tenantId: meta.tenantId }, (scope) => deleteSessionPlayer(scope.db, dbPlayerId))`.
4. Pour chaque socket local `io.of('/').sockets.values()` dont `data.sessionId === sessionId && data.playerId === playerId` (couvre un ancien socket encore ouvert) : `s.emit('player:kicked', {})`, `s.leave(roomName(sessionId))`, puis `data.role`, `data.sessionId`, `data.playerId` à `undefined` (garder les champs de throttle). `activeSocketIdByPlayerId.delete(playerId)`.
5. `io.to(roomName(sessionId)).emit('lobby:update', { players: playersPayload(session) })`.
6. Si `session.phase === 'question'` : `io.to(room).emit('screen:progress', await engine.progress(sessionId))` puis `await maybeAutoReveal(sessionId, meta).catch(() => {})`.
7. `reply({ ok: true })`.

Commentaire au-dessus du handler : rappeler l'ordre moteur, `playerDbIds`, base, et le risque `persistRound` concurrent noté en Review Focus.

- [ ] **Step 5: Distinguer l'exclusion dans `player:reconnect`** : dans son `catch`, `reply(e instanceof PlayerKickedError ? { error: e.message, code: e.code } : { error: message(e) })`.

- [ ] **Step 6: Lancer les suites serveur, vérifier le vert**

Run: `cd apps/server && npx vitest run src/game-gateway.test.ts src/game-e2e.test.ts`
Expected: PASS (nouveaux tests et non-régression de `player:answer`, relance, réhydratation).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game-gateway.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(server): host:kick, exclusion d'un joueur par l'hôte"
```

---

### Task 4: Web hôte, boutons « Exclure »

**Files:**
- Create: `apps/web/src/realtime/board.ts` (helper pur)
- Create: `apps/web/src/realtime/board.test.ts`
- Modify: `apps/web/src/screens/HostLive.tsx` (bouton dans `hostlive-players` et dans `renderLeaderboard`, encart latéral aussi en phase `reading`)
- Modify: `apps/web/src/prototype.css` (bouton compact dans la puce et la ligne du tableau)
- Test: `apps/web/src/screens/HostLive.kick.test.tsx` (nouveau, même harnais de mock que `HostLive.relaunch.test.tsx`)

**Interfaces:**
- Consomme : `host:kick` (Task 3) ; `RankingEntry` (`realtime/contracts.ts`).
- Produit : `boardEntries(ranking: RankingEntry[], players: Array<{ id: string; nickname: string; score: number }>): RankingEntry[]` : les entrées de `ranking` dont `playerId` figure dans `players`, dans l'ordre du classement, suivies des joueurs présents absents du classement (`{ playerId: id, nickname, score }`) dans l'ordre de `players`.

- [ ] **Step 1: Écrire les tests en échec**

`board.test.ts` :

```ts
it('retire les entrées absentes de la liste des joueurs et complète avec les présents non classés', () => {
  const ranking = [{ playerId: 'a', nickname: 'Ana', score: 900 }, { playerId: 'x', nickname: 'Exclu', score: 500 }]
  const players = [{ id: 'a', nickname: 'Ana', score: 900 }, { id: 'c', nickname: 'Carl', score: 0 }]
  expect(boardEntries(ranking, players)).toEqual([
    { playerId: 'a', nickname: 'Ana', score: 900 },
    { playerId: 'c', nickname: 'Carl', score: 0 },
  ])
})
it('liste vide si aucun joueur présent', () => { expect(boardEntries(ranking, [])).toEqual([]) })
```

`HostLive.kick.test.tsx` (stub `window.confirm` avec `vi.spyOn(window, 'confirm')`) :

```ts
it('lobby : confirmer « Exclure Ana » émet host:kick { playerId }', async () => {
  renderHostLive()
  emitServerEvent('lobby:update', { players: [{ id: 'p1', nickname: 'Ana', score: 0, connected: true }] })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(await screen.findByRole('button', { name: 'Exclure Ana' }))
  expect(window.confirm).toHaveBeenCalledWith('Exclure Ana de la partie ?')
  await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('host:kick', { playerId: 'p1' }))
})
it('annuler la confirmation n\'émet rien', async () => { /* confirm → false ; pas d'appel host:kick */ })
it('en jeu (première question) : le tableau liste les joueurs présents avec un bouton Exclure', async () => {
  // lobby:update Ana + Bob ; question:show (payload de HostLive.reading.test.tsx) ; bouton 'Exclure Bob' présent
})
it('le joueur exclu disparaît du tableau au lobby:update suivant, même s\'il reste dans le dernier scoreboard', async () => {
  // lobby:update Ana + Bob ; question:show ; scoreboard [Ana, Bob] ; lobby:update [Ana] ; queryByText('Bob') === null
})
it('une erreur d\'ack est affichée', async () => {
  // mockEmitAck rejette pour host:kick avec Error('exclusion impossible au podium') ; le message apparaît (même zone que actionError)
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/realtime/board.test.ts src/screens/HostLive.kick.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `boardEntries`** dans `board.ts`.

- [ ] **Step 4: Implémenter l'exclusion dans HostLive**

Fonction `kickPlayer(playerId: string, nickname: string)` : `window.confirm(\`Exclure ${nickname} de la partie ?\`)`, sinon sortie ; état `kickPendingId: string | null` qui désactive le bouton concerné pendant l'ack ; `emitAck('host:kick', { playerId })` ; erreur dans `setActionError(message)`. Pas de retrait optimiste : la liste suit `lobby:update`. Bouton `<Button variant="ghost" type="button" aria-label={\`Exclure ${nickname}\`}>Exclure</Button>` dans chaque puce `hostlive-players__chip` et dans chaque ligne `hostlive-board__row`. `renderLeaderboard` itère `boardEntries(ranking, players).slice(0, limit)`. L'encart `hostlive-aside` s'affiche pour `reading`, `question` et `reveal`. Pas de bouton dans `PodiumView`. Aucune annonce `aria-live` dédiée (la mise à jour de la liste suffit).

- [ ] **Step 5: Lancer les tests HostLive, vérifier le vert**

Run: `cd apps/web && npx vitest run src/realtime/board.test.ts src/screens/HostLive`
Expected: PASS (dont `HostLive.reading.test.tsx` et `HostLive.relaunch.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/realtime/board.ts apps/web/src/realtime/board.test.ts apps/web/src/screens/HostLive.tsx apps/web/src/screens/HostLive.kick.test.tsx apps/web/src/prototype.css
git commit -m "feat(web): bouton Exclure dans le lobby et le tableau de l'hôte"
```

---

### Task 5: Web joueur, écran d'exclusion

**Files:**
- Create: `apps/web/src/realtime/ackError.ts`
- Modify: `apps/web/src/realtime/useGameSocket.ts` (rejet avec `AckError` portant `code`)
- Modify: `apps/web/src/realtime/contracts.ts` (constante `KICKED_ACK_CODE`)
- Modify: `apps/web/src/screens/PlayerLive.tsx`
- Test: `apps/web/src/screens/PlayerLive.rejoin.test.tsx` (nouveau describe)

**Interfaces:**
- Consomme : `player:kicked` et `code: 'kicked'` sur `player:reconnect` (Task 3).
- Produit :
  - `contracts.ts` : `export const KICKED_ACK_CODE = 'kicked'`.
  - `ackError.ts` : `export class AckError extends Error { constructor(message: string, readonly code?: string) }` et `export function isKickedError(err: unknown): boolean` (vrai si `err` est un objet dont `code === KICKED_ACK_CODE` ; test par propriété et non par `instanceof`, car les tests de PlayerLive mockent `useGameSocket`). Fichier séparé de `useGameSocket.ts` pour la même raison.
  - `useGameSocket.ts` : un ack `{ error, code? }` rejette avec `new AckError(ack.error, typeof ack.code === 'string' ? ack.code : undefined)` (le message reste celui d'aujourd'hui).

- [ ] **Step 1: Écrire les tests en échec**

```ts
describe('PlayerLive : exclusion par l\'animateur', () => {
  it('player:kicked : efface la session locale et affiche le message avec un lien vers /join', async () => {
    savePlayerSession({ pin: '1234', playerId: 'p1', joinToken: 't1', nickname: 'Ana' })
    renderPlayerLive()
    await waitFor(() => expect(mockEmitAck).toHaveBeenCalledWith('player:reconnect', expect.anything()))
    emitServerEvent('player:kicked', {})
    expect(await screen.findByText("L'animateur t'a retiré de la partie.")).toBeTruthy()
    expect(loadPlayerSession()).toBeNull()
    expect(screen.getByRole('link', { name: 'Rejoindre une partie' }).getAttribute('href')).toBe('/join')
  })

  it('reconnexion refusée pour exclusion : même écran, pas de redirection silencieuse', async () => {
    mockEmitAck.mockImplementation(async (event: string) => {
      if (event === 'player:reconnect') throw new AckError('joueur exclu de la partie', 'kicked')
      return {}
    })
    // render ; findByText("L'animateur t'a retiré de la partie.") ; loadPlayerSession() === null ; queryByText('Rejoindre') de la route /join absent
  })

  it('autre échec de reconnexion : comportement inchangé (redirection vers /join)', async () => {
    // reject Error('joinToken invalide') ; findByText('Rejoindre') (élément de la route /join du harnais)
  })
})
```

Restaurer l'implémentation par défaut de `mockEmitAck` dans le `beforeEach` du describe.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/screens/PlayerLive.rejoin.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter** `ackError.ts`, la constante, le rejet typé dans `useGameSocket.ts`, puis PlayerLive

PlayerLive : état `kicked: boolean`. Abonnement `player:kicked` dans l'effet unique (désabonnement au nettoyage) : `clearPlayerSession()` puis `setKicked(true)`. Dans le `catch` de `resync` : si `isKickedError(err)`, même traitement, sinon comportement actuel. Le rendu `kicked` passe avant la garde `if (!stored) return <Navigate ...>` : un `<main>` avec un titre focalisable contenant « L'animateur t'a retiré de la partie. » et un `<Link to="/join">Rejoindre une partie</Link>`. Une fois exclu, ignorer les événements de jeu qui arriveraient encore (le serveur a déjà retiré le socket de la room, pas de garde supplémentaire nécessaire au-delà du rendu prioritaire).

- [ ] **Step 4: Lancer les tests web joueur, vérifier le vert**

Run: `cd apps/web && npx vitest run src/screens/PlayerLive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/realtime/ackError.ts apps/web/src/realtime/useGameSocket.ts apps/web/src/realtime/contracts.ts apps/web/src/screens/PlayerLive.tsx apps/web/src/screens/PlayerLive.rejoin.test.tsx
git commit -m "feat(web): écran joueur après exclusion par l'animateur"
```

---

### Task 6: Grand écran, classement sans l'exclu et vérification finale

**Files:**
- Modify: `apps/web/src/screens/BigScreen.tsx` (classement filtré)
- Test: `apps/web/src/screens/BigScreen.kick.test.tsx` (nouveau, harnais de `BigScreen.relaunch.test.tsx`)

**Interfaces:**
- Consomme : `boardEntries` (Task 4).

- [ ] **Step 1: Écrire les tests en échec**

```ts
it('lobby : le joueur exclu disparaît de la liste, sans annonce', async () => {
  // lobby:update [Ana, Bob] puis [Ana] ; queryByText('Bob') === null ; aucun texte contenant « exclu » ou « retiré »
})
it('classement : le joueur exclu n\'apparaît plus après le lobby:update suivant', async () => {
  // lobby:update [Ana, Bob] ; question:show ; question:reveal ; scoreboard [Bob, Ana] (bascule en phase scoreboard)
  // lobby:update [Ana] ; dans la liste big-scoreboard, Ana est 1re et Bob absent
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/web && npx vitest run src/screens/BigScreen.kick.test.tsx`
Expected: FAIL sur le second test (le premier peut déjà passer, la liste suivant `lobby:update`).

- [ ] **Step 3: Implémenter** : le rendu `big-scoreboard__list` itère `boardEntries(ranking, players).slice(0, 5)`. Ne pas toucher l'effet de bascule `reveal` vers `scoreboard`, qui doit continuer à lire `ranking` brut.

- [ ] **Step 4: Vérification complète du dépôt**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tout vert (481 tests initiaux plus les nouveaux), aucune erreur de typage ni de lint.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/BigScreen.tsx apps/web/src/screens/BigScreen.kick.test.tsx
git commit -m "feat(web): le grand écran retire le joueur exclu du lobby et du classement"
```
