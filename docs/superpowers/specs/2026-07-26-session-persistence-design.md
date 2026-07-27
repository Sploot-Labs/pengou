# Persistance des sessions de jeu (survie au redémarrage) — design

Date : 2026-07-26
Statut : design validé, prêt pour le plan d'implémentation.

## Contexte & besoin

L'état d'une partie en cours (`GameSession` : phase, joueurs, scores, question courante,
réponses, timers) vit **uniquement en mémoire** côté serveur (`MemorySessionStore`). Un
**redémarrage du serveur** (déploiement, crash, `tsx watch` en dev) efface tout : la ligne
`game_session` persiste en base mais l'état vif est perdu, et `host:reconnect` /
`player:reconnect` répondent « session introuvable » sur une partie qui semblait active.

Besoin : rendre les parties **durables** — un redémarrage ne casse plus rien, l'hôte ET les
joueurs se reconnectent et la partie reprend là où elle en était.

## Décisions validées

1. **Reprise complète** : tout l'état est persisté ; hôte + joueurs se reconnectent, la partie
   continue (pas juste « ne pas casser »).
2. **Chrono qui repart à neuf** : à la reprise, le timer de la phase courante (lecture OU
   question) redémarre de zéro (re-ancre `readingStartedAt`/`questionStartedAt = now()`). Les
   joueurs ayant déjà répondu gardent leur réponse (garde « déjà répondu » inchangée).
3. **Store persistant Postgres** (write-through), pas de Redis (infra optionnelle, hors sujet).

## Principe architectural

Le moteur (`packages/game`) passe DÉJÀ tout son état par `store.save(GameSession)` et
`SessionStore` est DÉJÀ une interface async (`get/getByPin/save/delete`). `GameSession` est un
objet plein-données **entièrement sérialisable** (JSON). Donc : on **remplace
l'implémentation** du store (mémoire → persistant Postgres) et on **réhydrate au démarrage**.
**Le moteur ne change pas.**

## Composants

### 1. Nettoyage préalable — unifier les ids
Aujourd'hui l'**id moteur** (`genId()` dans `engine.createSession`) ≠ l'**id `game_session`**
DB, d'où la map `dbSessionIdToEngineId` et sa complexité (ajoutée en T8/reprise). On unifie :
- `engine.createSession(input)` accepte un `id` optionnel (sinon `genId()` comme avant — rétro-compat des tests).
- Dans `game-gateway.ts` `host:create` : créer la ligne `game_session` DB **d'abord**, puis
  `engine.createSession({ id: dbSession.id, … })`. Un seul id partout.
- **Supprimer `dbSessionIdToEngineId`** et simplifier `host:reconnect` (plus de double espace
  d'id à résoudre) + `emitReconnectSnapshot`.

### 2. Stockage
Colonne **`engine_state jsonb`** (nullable) sur la table `game_session` (migration additive).
`null` = pas/plus d'état vif ; sinon = snapshot JSON complet du `GameSession`. Indexer ce dont
`getByPin` a besoin (le `pin` est déjà une colonne `game_session`).

### 3. `PersistentSessionStore` (dans `apps/server`, injecté au moteur au boot)
Implémente `SessionStore` avec un **cache mémoire (rapide) + write-through Postgres** :
- `get(id)` : cache, sinon lit `engine_state` par id (réhydrate le cache), sinon `undefined`.
- `getByPin(pin)` : cache, sinon lit `engine_state` de la `game_session` de ce PIN **non
  terminée** (exclut `phase === 'podium'` / status ended), réhydrate le cache.
- `save(s)` : met à jour le cache ET UPSERT `engine_state = <json(s)>` (+ maj `updated_at`).
- `delete(id)` / fin de partie (`podium`) : retire du cache + met `engine_state = null`.
- Sérialisation : `JSON` (attention aux clés numériques de `answers`/`credited` — objets JSON à
  clés string ; reconvertir à la lecture). Conserver la sémantique `structuredClone` (jamais
  retourner une référence partagée mutable).

Le moteur reçoit ce store au lieu de `MemorySessionStore` (point d'injection : là où l'`engine`
et le store sont construits pour la passerelle, `apps/server`).

### 4. Réhydratation au démarrage
Après `runMigrations`, au boot serveur, AVANT/à l'enregistrement de la passerelle :
- Charger les `game_session` de status `active`/`lobby` avec `engine_state` non nul et
  **récentes** (`updated_at`/`created_at` dans la fenêtre `SESSION_MAX_AGE` — ex. 12 h). Les
  plus vieilles → `status = 'ended'` + `engine_state = null` (plus d'orphelines « reprenables »).
- Pour chaque session réhydratée :
  - Réhydrater le cache du store (déjà via `PersistentSessionStore.get` au premier accès — ou
    warm explicite).
  - **Reconstruire la `SessionMeta` de la passerelle** : `dbSessionId` = l'id (unifié) ;
    `playerDbIds` reconstruit depuis les `session_player` (match par `join_token` ↔
    `session.players[*].joinToken`) ; `revealedRounds`/`autoRevealedRounds` depuis
    `session.credited` (les manches créditées sont déjà révélées) ; `statusActiveSet` =
    (`status === 'active'`) ; `readingTimeout` = null (reprogrammé ci-dessous).
  - **Re-ancrer le timer à neuf** selon `phase` : `reading` → `readingStartedAt = now()` +
    reprogrammer le `setTimeout` de révélation pour `readingTime` complet + ré-émettre
    `question:reading` à la room ; `question` → `questionStartedAt = now()` + ré-émettre
    `question:show` + `timer` à la room. Persister ce re-ancrage (`store.save`).

### 5. Reconnexion — déjà en place (T8)
Aucun nouveau chemin de reconnexion : `host:reconnect` (et `player:reconnect`) trouvent la
session via le store réhydraté et renvoient le snapshot existant. Les joueurs se reconnectent
via `joinToken`.

### 6. Cycle de vie / nettoyage
- Fin de partie (`podium`) : `engine_state = null` (le rapport reste lisible via les tables
  `session_player`/`answer` inchangées).
- Startup : sessions périmées → `ended`.
- Réutilisation de PIN : inchangée (`getByPin` exclut déjà les sessions terminées).

## Isolement & interfaces
- `PersistentSessionStore` : une seule responsabilité (persister/réhydrater `GameSession`),
  testable seule contre Postgres, remplace `MemorySessionStore` sans toucher au moteur.
- Repo DB : helpers `saveEngineState(id, json)`, `loadEngineState(id)`,
  `loadEngineStateByPin(pin)`, `clearEngineState(id)`, `listResumableSessions(maxAge)`,
  `endStaleSessions(maxAge)` — dans `packages/db`.
- Réhydratation + reconstruction de `SessionMeta` : fonction dédiée dans `apps/server`
  (passerelle), appelée au boot.

## Tests
- **Store** (`PersistentSessionStore`, Postgres) : `save` puis `get`/`getByPin` relisent depuis
  la base après vidage du cache (simule un process neuf) ; `delete`/podium vide l'état ; clés
  numériques de `answers`/`credited` correctement re-parsées.
- **Id unifié** : `host:create` → `engine.session.id === game_session.id` ; `host:reconnect`
  fonctionne avec ce seul id ; `dbSessionIdToEngineId` retirée sans régression.
- **Réhydratation au boot** (intégration) : créer une session (lobby + 1 joueur, puis en
  `question`) → construire un NOUVEAU store/gateway sur la même base (simule le restart) →
  la session est retrouvée, la `SessionMeta` reconstruite, le timer ré-émis ; `host:reconnect`
  renvoie le bon snapshot ; un joueur se reconnecte via joinToken.
- **Périmées** : une `active` trop vieille est marquée `ended` au boot, pas réhydratée.
- **Rétro-compat** : `readingTime`/flux existants inchangés ; les tests moteur (store mémoire en
  unité) restent verts (le moteur reste agnostique du store).

## Risques & points d'attention
- **Fréquence d'écriture** : `save` à chaque mutation → UPSERT Postgres. Volume faible (quelques
  transitions par question, une poignée de joueurs) → acceptable. Le cache mémoire évite les
  lectures répétées.
- **Cohérence à la reprise** : re-ancrer le timer et RÉ-ÉMETTRE les événements à toute la room
  au boot, pour que les clients déjà connectés (ou qui se reconnectent) soient synchronisés.
- **Sérialisation** : les clés numériques (`answers[index]`, `credited[index]`) deviennent des
  strings en JSON — reconvertir à la lecture pour préserver le contrat `GameSession`.
- **Anti-triche** : la réhydratation ré-émet via les mêmes helpers (`playerQuestionView`, pas de
  payload brut) — jamais la bonne réponse avant l'heure.
- **Id unification** : refactor de `host:create`/`host:reconnect` — couvrir par tests avant/après
  pour ne rien régresser (c'est le socle de tout le reste).
