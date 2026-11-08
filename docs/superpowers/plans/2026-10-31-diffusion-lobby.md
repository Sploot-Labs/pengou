# Diffusion du lobby coalescée, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'une arrivée de joueur ne coûte plus une diffusion de la liste complète des joueurs à toute la partie, pour lever le goulot des arrivées mesuré à 300 joueurs le 2026-10-31.

**Architecture:** Aujourd'hui, `player:join` et `player:reconnect` émettent `lobby:update` (liste complète, O(N)) à toute la room `session:<id>` (N sockets) : remplir une salle de N joueurs coûte O(N²) en sérialisation et en envois. On remplace ces deux émissions par un appel à `scheduleLobbyBroadcast(sessionId)`, une diffusion coalescée par session (déclenchement immédiat si rien n'a été diffusé depuis 250 ms, sinon une seule diffusion différée à la fin de la fenêtre, qui relit l'état courant). Chaque diffusion envoie la liste complète `lobby:update` à la seule room `viewers:<id>` (hôte et grand écran) et un événement léger `lobby:count` `{ count }` (joueurs connectés) à la room `session:<id>`. Le joueur (`PlayerLive`) consomme `lobby:count` au lieu de `lobby:update`.

**Tech Stack:** TypeScript, Socket.IO, React, Vitest (Postgres de test pour `apps/server`), le générateur de charge de `apps/server/charge/` et `docker-compose.charge.yml`.

**Spec:** pas de spec séparée. Source : rapport `docs/charge/2026-10-31-resultats.md` (section « Réponse à coût constant » : nouveau goulot aux arrivées, `lobby:update` suspecté) et la décision du propriétaire du 2026-10-31 (« vas y go pour la piste deux » : `lobby:update` réservé à l'hôte et à l'écran, cadencé à 250 ms).

## Global Constraints

- Fenêtre de coalescence : 250 ms (constante nommée `LOBBY_BROADCAST_INTERVAL_MS` dans `game-gateway.ts`).
- Les joueurs ne reçoivent plus jamais `lobby:update` par diffusion. Ils reçoivent `lobby:count` avec `{ count: number }`, nombre de joueurs `connected !== false`, la même valeur que `PlayerLive` calculait jusque-là.
- Inchangés : le snapshot `lobby:update` émis immédiatement à un seul socket par `emitReconnectSnapshot` (hôte qui se reconnecte, grand écran qui rejoint) ; le contenu de `playersPayload` ; `screen:progress`.
- La diffusion différée relit la session au moment où elle part (`engine.peekSession`) : la dernière diffusion d'une rafale reflète toujours l'état final. Si la session n'existe plus, rien n'est émis et aucune erreur ne remonte.
- Le minuteur de coalescence vit dans `SessionMeta` et est annulé partout où les autres minuteurs de la session le sont à la fin de session (fin de partie, nettoyage, balayage des sessions abandonnées). Pas de minuteur qui survit à sa session.
- Ne jamais lancer `biome format --write` ni `pnpm format`. Lint de référence : 84 avertissements (`npx biome lint apps packages --max-diagnostics=500`), pas de hausse.
- Tests lancés depuis la racine du dépôt. Échecs intermittents connus sous charge : `setupRelaunch` et délais en cascade de `game-gateway.test.ts`, score lu trop tôt dans `game-e2e.test.ts:373` (les rejouer seuls).
- Texte destiné à l'utilisateur (commentaires de code en français comme le reste du fichier, rapport, commits) : pas de tiret cadratin ni demi-cadratin comme ponctuation, pas de gras d'emphase, casse de phrase dans les titres, apostrophe droite, « », pas de point médian, pas d'émoji.
- Fichiers en UTF-8, pas de sed global. Commits conventionnels en français terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push.
- Test de charge : uniquement contre la pile locale `pengou-charge` (`http://localhost:3000`), jamais contre la production.

## Review Focus

- Rafale de 30 arrivées en moins de 250 ms : l'hôte reçoit au plus 3 `lobby:update` et le dernier contient les 30 joueurs.
- Arrivée isolée après un calme de plus de 250 ms : l'hôte la voit sans délai (diffusion immédiate), pas 250 ms plus tard.
- Session terminée ou balayée pendant qu'une diffusion différée est en attente : aucune émission, aucune erreur non gérée, aucun minuteur restant.
- Joueur qui se reconnecte : il reçoit un `lobby:count` à jour, et l'hôte voit `connected: true` dans le `lobby:update` suivant.
- Un joueur n'a aucun moyen d'obtenir la liste des pseudos par `lobby:update` (vérifié par un test qui écoute `lobby:update` sur un socket joueur).

---

### Task 1: diffusion coalescée côté serveur et compteur côté joueur

**Files:**
- Modify: `apps/server/src/game-gateway.ts` (`SessionMeta`, nouvelle `scheduleLobbyBroadcast`, handlers `player:join` et `player:reconnect`, nettoyage de fin de session)
- Modify: `apps/web/src/screens/PlayerLive.tsx` (abonnement `lobby:count` à la place de `lobby:update`, commentaires associés, suppression de `LobbyPlayer` si elle devient inutile)
- Test: `apps/server/src/game-gateway.test.ts`, `apps/server/src/game-e2e.test.ts`, `apps/server/src/reports-e2e.test.ts` (adapter les attentes qui comptent les `lobby:update`), `apps/web/src/screens/PlayerLive.arcade.test.tsx`

**Interfaces:**
- Produces: événement serveur `lobby:count` `{ count: number }` vers `session:<id>` ; `lobby:update` `{ players }` diffusé uniquement vers `viewers:<id>` ; `scheduleLobbyBroadcast(sessionId: string): void` interne à `registerGameGateway`.

- [ ] Step 1 : tests en échec dans `game-gateway.test.ts` : (a) un socket joueur qui rejoint ne reçoit aucun `lobby:update` pendant 400 ms après l'arrivée d'un second joueur, mais reçoit `lobby:count` avec `count: 2` ; (b) 30 `player:join` lancés sans attendre : l'hôte reçoit au plus 3 `lobby:update` dans les 600 ms qui suivent la dernière réponse, et le dernier liste 30 joueurs ; (c) arrivée isolée après 400 ms de calme : le `lobby:update` arrive à l'hôte en moins de 100 ms après l'ack du join ; (d) reconnexion d'un joueur : le `lobby:update` suivant reçu par l'hôte le montre `connected: true` et le joueur reçoit un `lobby:count`. Dans `PlayerLive.arcade.test.tsx`, le compteur « manchots sur la glace » est alimenté par `lobby:count`.
- [ ] Step 2 : lancer, constater l'échec.
- [ ] Step 3 : implémenter. Adapter les tests existants qui attendent un `lobby:update` par arrivée (`atLeast(n)`) pour qu'ils attendent l'état final (dernier payload avec n joueurs) ; ne pas affaiblir ce qu'ils vérifient d'autre. Ne pas toucher à `emitReconnectSnapshot`.
- [ ] Step 4 : `pnpm vitest run apps/server/src/game-gateway.test.ts apps/server/src/game-e2e.test.ts apps/server/src/reports-e2e.test.ts apps/web/src/screens` depuis la racine, puis `pnpm test` ; `npx biome lint apps packages --max-diagnostics=500` sans hausse ; `pnpm -r typecheck` (ou la commande de typecheck du dépôt) vert.
- [ ] Step 5 : commit `perf(server): diffusion du lobby coalescée et réservée à l'hôte et à l'écran`.

### Task 2: campagne de mesure et rapport

**Files:**
- Modify: `docs/charge/2026-10-31-resultats.md` (nouvelle section « Diffusion du lobby coalescée » avant « Chiffre annoncé », puis « Chiffre annoncé » recalculé)
- Create: `docs/charge/brut/<libelle>.json`
- Modify (si le chiffre annoncé change, pré-approuvé par le propriétaire) : `packages/shared/src/config.ts`, `packages/shared/src/config.test.ts`, `.env.example`, et la valeur par défaut `${MAX_PLAYERS_PER_SESSION:-160}` de `docker-compose.prod.yml` et `docker-compose.yml`

Protocole identique aux campagnes précédentes (voir la section « Configuration » du rapport et `.env` local) : `docker compose -p pengou-charge -f docker-compose.charge.yml down -v` puis `up -d --build` sur le code de cette branche, `/health` puis 30 s, un seul générateur à la fois au premier plan, `--questions 10 --cadence 25 --docker pengou-charge --cible http://localhost:3000` (ou l'option équivalente de `--help`), environ un processus générateur par 100 joueurs, deux passages par palier, libellés suffixés `-lb`.

- [ ] Step 1 : paliers 300, 500, 750, 1000, arrêt au premier palier en échec confirmé plus un passage du suivant. Si l'écart entre le plus haut réussi et le premier en échec dépasse 100, jouer les paliers intermédiaires de 100 en 100 (2 passages). Si 300 échoue, jouer 200 (2 passages) pour confirmer qu'il n'y a pas de régression.
- [ ] Step 2 : `etab-lb` (10 × 30, 2 passages) et `rafale-lb` au plus haut palier réussi.
- [ ] Step 3 : si le plus haut palier réussi atteint 1000, ajouter `etab1000-lb` (`--parties 30 --joueurs 35`, 2 passages).
- [ ] Step 4 : rapport. Section « Diffusion du lobby coalescée » : ce qui a changé, tableau au format des précédents, goulot du nouveau premier échec en une phrase (arrivées ou questions, CPU app et db, RSS), puis « Chiffre annoncé » recalculé avec la même règle (plus haut palier réussi arrondi vers le bas à la centaine, moins 20 %), anciennes valeurs (80 puis 160) gardées comme historique.
- [ ] Step 5 : défaut du plafond aligné sur le nouveau chiffre dans les cinq emplacements listés ; `pnpm test`.
- [ ] Step 6 : commits `docs(charge): résultats avec diffusion du lobby coalescée` puis, si le défaut change, `feat(server): plafond de joueurs aligné sur la diffusion du lobby coalescée`.
