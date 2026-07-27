# Abandon automatique des parties inactives + liste « en cours » — design

Date : 2026-07-28
Statut : design validé, prêt pour le plan d'implémentation.

## Contexte & besoin

Une partie vivante porte un `game_session.status` DB à **3 valeurs** :
`sessionStatusEnum = ['lobby', 'active', 'ended']` (`packages/db/src/schema.ts:10`). Le statut
DB n'avance qu'à deux points du gateway : `→ 'active'` au premier `host:startQuestion`
(`apps/server/src/game-gateway.ts:607`) et `→ 'ended'` au podium (`:677`).

Problème : une partie **abandonnée en plein jeu** (l'hôte ferme l'onglet, personne ne finit)
**reste `active` indéfiniment**. Le seul filet est `endStaleSessions(maxAge)`
(`packages/db/src/repos/session.ts:174`), qui ne tourne **qu'une fois au boot**
(`game-gateway.ts:917`, fenêtre 12 h) — aucun balayage périodique en fonctionnement.

Côté affichage, la liste « Parties récentes » (`GET /api/sessions` →
`listSessions`, `packages/db/src/repos/reports.ts:49`) renvoie **toutes** les sessions du
tenant (lobby + active + ended), triées par `createdAt`. Le filtrage par statut est **purement
client** (chips `all/active/lobby/ended`, `apps/web/src/screens/Home.tsx`). Résultat : les
parties zombies polluent la liste et rien ne distingue « terminée proprement » d'« abandonnée ».

Besoin :
1. Faire **basculer automatiquement** une partie devenue inactive vers un statut distinct.
2. Réorganiser « Parties récentes » pour **mettre en avant ce qui est en cours** et ranger le
   reste dans un historique.

## Décisions validées

1. **Déclencheur = inactivité (timeout).** Une partie sans activité depuis `SESSION_INACTIVITY_TIMEOUT`
   (défaut **30 min**) bascule. (Pas l'âge absolu, pas la déconnexion socket.)
2. **Statut cible = nouvelle valeur `abandoned`**, distincte de `ended` (stats/rapports propres,
   filtre net).
3. **`abandoned` est terminal** (comme `ended`) : pas de reprise, le PIN est libéré,
   l'`engine_state` est nettoyé.
4. **Liste = deux sections** : « En cours » (`lobby` + `active`) et « Historique »
   (`ended` + `abandoned`).
5. **Mono-instance assumé** : balayage par `setInterval` simple, **sans** advisory lock ni
   coordination inter-réplicas. Le multi-instance est explicitement reporté (voir « Suite »).

## Principe architectural

La bascule est **autoritaire côté base** : un `UPDATE` SQL sur `lastActivityAt < cutoff`, pas une
décision en mémoire. Le moteur (`packages/game`) ne change pas. On s'appuie sur le fait que
`PersistentSessionStore.save()` (`apps/server/src/persistent-store.ts:60`) est **déjà** appelé à
chaque mutation d'état du moteur — c'est le point naturel où estampiller l'activité.

## Composants

### 1. Modèle de données (migration Drizzle additive)

- **Enum** : `session_status` gagne `'abandoned'` →
  `['lobby', 'active', 'ended', 'abandoned']` (`packages/db/src/schema.ts:10`). Ajout de valeur
  d'enum Postgres (`ALTER TYPE … ADD VALUE`).
- **Colonne** : `game_session.lastActivityAt timestamp NOT NULL DEFAULT now()`
  (`schema.ts:57-74`). Signal d'inactivité. Backfill des lignes existantes à `now()` (ou
  `COALESCE(started_at, created_at)`) dans la migration.
- **Index PIN** : l'index unique partiel `game_session_active_pin_uidx`
  (`schema.ts:72`, aujourd'hui `WHERE status <> 'ended'`) passe à **exclure aussi `abandoned`**
  (`WHERE status IN ('lobby','active')`) → une partie abandonnée **libère son PIN** (réutilisable),
  cohérent avec « terminal ». Recréer l'index dans la migration.
- **Type FE** : `SessionStatus = 'lobby' | 'active' | 'ended' | 'abandoned'`
  (`apps/web/src/api/sessions.ts:13`).

### 2. Suivi d'activité

`lastActivityAt` est estampillé à **chaque mutation du moteur**, dans
`PersistentSessionStore.save()` : le write-through pose `last_activity_at = now()` en même temps
que `engine_state`. Ça couvre sans instrumentation supplémentaire toutes les activités réelles
qui passent par le moteur (action hôte, réponse joueur, transition de phase), puisque toutes
appellent `save()`.

Helper DB dédié plutôt que d'élargir la signature du store : `touchSessionActivity(db, id)` (ou
inclusion du champ dans l'UPSERT `saveEngineState`). Détail d'implémentation à trancher au plan ;
le contrat est : **une écriture `engine_state` ⇒ `lastActivityAt = now()`**.

### 3. Balayage périodique + bascule

- **`setInterval`** enregistré au boot du serveur (là où le gateway est enregistré,
  `apps/server/src/game-gateway.ts:917` / `apps/server/src/index.ts`). Période :
  `SESSION_SWEEP_INTERVAL` (défaut ~ 5 min). Nettoyer l'intervalle à l'arrêt (unref + clear).
- **`abandonInactiveSessions(db, cutoffMs)`** (`packages/db/src/repos/session.ts`, à côté de
  `endStaleSessions`) :
  ```sql
  UPDATE game_session
     SET status = 'abandoned', ended_at = now(), engine_state = null
   WHERE status IN ('lobby', 'active')
     AND last_activity_at < now() - <cutoff>
  RETURNING id;
  ```
  Retourne les ids basculés (pour le nettoyage mémoire ci-dessous).
- **Nettoyage mémoire** (mono-instance, tout est dans ce process) : pour chaque id retourné,
  évincer du cache `PersistentSessionStore` (`byId` / `pinToId`) et **clear les timers** du
  gateway (`meta.readingTimeout`, `game-gateway.ts:308,472`) → pas de timer fantôme ni de fuite.
- **Config** : `SESSION_INACTIVITY_TIMEOUT` (défaut 30 min) et `SESSION_SWEEP_INTERVAL`
  (défaut 5 min) dans `packages/shared/src/config.ts`.
- **Boot** : `endStaleSessions` au démarrage (`game-gateway.ts:917`) est **recalé sur `abandoned`**
  au lieu de `ended` (une partie coupée par un long arrêt est « abandonnée », pas « terminée »).
  Fusionner sa logique avec `abandonInactiveSessions` (même bascule, critère d'âge au boot).

### 4. Liste « Parties récentes » → deux sections

- **Serveur** : `GET /api/sessions` (`apps/server/src/routes/sessions.ts:50`) accepte un filtre
  `status` (jeu de valeurs, ex. `?status=lobby,active`). `listSessions`
  (`packages/db/src/repos/reports.ts:49`) applique ce filtre en base (en plus du `tenantId`)
  au lieu de tout renvoyer.
- **Web** (`apps/web/src/screens/Home.tsx`) : deux sections distinctes —
  - **« En cours »** (`lobby` + `active`) : mise en avant ; CTA « Reprendre → » ;
    `sessionHref` → `/host/:id` (inchangé pour ces statuts).
  - **« Historique »** (`ended` + `abandoned`) : paginée (réutilise `SESSIONS_PAGE_SIZE = 8`) ;
    CTA « Voir le rapport → » ; `sessionHref` → `/sessions/:id`. `abandoned` porte un **badge
    visuel** « Abandonnée » (label ajouté à côté de `lobby→"En attente"`, etc., `Home.tsx:31`).
  - On **retire le filtrage client-side** (chips `all/active/lobby/ended`) au profit du filtrage
    serveur + des deux sections.
- **Client API** : `listSessions(opts)` (`apps/web/src/api/sessions.ts:62`) transmet le filtre
  `status`.

## Isolement & interfaces

- **`abandonInactiveSessions` / bascule** : une responsabilité (marquer inactives → `abandoned`
  + libérer PIN), testable seule contre Postgres. Vit dans `packages/db`.
- **Estampillage activité** : contenu dans le write-through du store — le moteur reste agnostique.
- **Boucle de balayage** : fonction dédiée dans `apps/server` (enregistre/clear l'intervalle,
  orchestre bascule DB + nettoyage mémoire local). Ne fait pas de logique métier elle-même.
- **Filtrage liste** : paramètre optionnel de `listSessions` (rétro-compatible : sans filtre =
  comportement actuel).

## Tests

- **`abandonInactiveSessions`** (Postgres) : une session `active`/`lobby` avec
  `last_activity_at` au-delà du cutoff → passe `abandoned`, `ended_at` posé, `engine_state` null,
  ids retournés ; une session récente n'est pas touchée ; une `ended`/`abandoned` est ignorée
  (idempotent).
- **Libération de PIN** : après bascule `abandoned`, un nouveau `host:create` peut réutiliser le
  même PIN (l'index partiel ne bloque plus).
- **Estampillage `lastActivityAt`** : un `save()` du store met à jour `last_activity_at` ; une
  session qui progresse ne se fait pas abandonner tant qu'elle bouge.
- **Nettoyage mémoire** : après bascule, la session est évincée du cache et le
  `readingTimeout` est cleared (pas de ré-émission fantôme).
- **Course sweep ↔ activité** : une action hôte pile avant le cutoff bumpe `lastActivityAt` →
  la session survit au tick suivant ; le filtre `status IN ('lobby','active')` empêche toute
  double-bascule.
- **Filtrage serveur `listSessions`** : `?status=lobby,active` ne renvoie que les vivantes ;
  `?status=ended,abandoned` que l'historique ; sans filtre = tout (rétro-compat).
- **Boot** : une session inactive au démarrage est marquée `abandoned` (plus `ended`), pas
  réhydratée.
- **Non-reprise** : `sessionHref('abandoned')` route vers le rapport, pas `/host`.

## Risques & points d'attention

- **`ALTER TYPE … ADD VALUE`** n'est pas transactionnel de la même façon selon la version PG
  (contrainte historique « ne peut pas être utilisé dans le même bloc transactionnel que
  l'usage de la valeur »). Vérifier que la migration Drizzle passe (au besoin, séparer l'ajout de
  valeur d'enum de son usage / du recréation d'index).
- **Seuil trop court** : 30 min doit couvrir un lobby qui attend + une lecture/question longue.
  Comme `lastActivityAt` bouge à chaque mutation moteur, une partie réellement jouée ne risque
  rien ; le risque n'existe que pour une partie sans **aucune** interaction pendant 30 min.
  Valeur configurable pour ajuster.
- **Cohérence mémoire/DB** : le nettoyage mémoire local suppose que la session vit dans **ce**
  process (vrai en mono-instance). En multi-instance, le sweep DB basculerait bien le statut mais
  ne pourrait pas clear les timers d'un autre réplica — d'où le report explicite ci-dessous.
- **Rétro-compat** : `listSessions` sans filtre garde son comportement ; les rapports figés
  (`/sessions/:id`) et la persistance/réhydratation existante ne changent pas.

## Suite (hors scope de ce spec)

Rendre le **moteur temps réel multi-instance / réplicas** — épic séparé à cadrer dans son propre
spec :
- Adaptateur Socket.IO partagé (Redis ou pub/sub Postgres) pour que hôte/joueurs/écran sur des
  réplicas différents reçoivent les broadcasts.
- Propriété de session (routage sticky par PIN **ou** verrou de session distribué) pour éviter
  que deux réplicas pilotent la même partie.
- Durcir le balayage : `pg_try_advisory_lock` pour un seul runner + signal inter-réplicas pour le
  clear des timers du réplica propriétaire.
- Advisory lock à la migration au boot (déjà identifié comme manquant dans le plan multi-tenant).
