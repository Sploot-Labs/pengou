# Rapport d'audit technique — Arena (open-source-saas)

**Date :** 2026-07-28
**Périmètre :** monorepo pnpm TypeScript (~19k LOC) — Arena, plateforme de quiz en direct open-source (self-host + SaaS multi-tenant). Stack : Fastify 4 + Socket.IO 4 + Drizzle/Postgres + React (Vite) + better-auth.
**Méthode :** revue par 5 profils (Architecte, DevOps, DevSecOps, Lead Dev, Expert Open Source), lecture réelle du code, constats sourcés `fichier:ligne`.

---

## 0. Verdict express

Arena est un **produit techniquement solide et étonnamment mûr pour son âge** : moteur de jeu pur et déterministe, autorité serveur anti-triche réelle, isolation cross-tenant correcte, hardening des secrets exemplaire, ~0,67 fichier de test par fichier source, code sans `any`/`@ts-ignore`/`dangerouslySetInnerHTML`. C'est une base saine.

**Mais il n'est pas encore prêt à être partagé publiquement ni déployé en multi-utilisateurs**, pour trois raisons bloquantes qui font consensus dans l'équipe :

1. **🔴 Sécurité — faille d'accès intra-tenant (P0).** En mode `single` (le défaut self-host), l'inscription est ouverte et **aucun contrôle de propriété** n'existe : tout visiteur qui s'inscrit peut lire/modifier/supprimer les quiz et rapports de *tous* les autres utilisateurs.
2. **🔴 Légal/OSS — pas de `LICENSE`, pas de `README` (P0).** Sans licence, le code est « tous droits réservés » : personne ne peut légalement forker ou contribuer. Positionnement « clone Kahoot » = risque marque.
3. **🔴 Scaling annoncé mais non implémenté (P0).** `scaling: 'redis'` est exposé par `/health` alors que l'adaptateur Redis n'est jamais branché et que tout l'état de la passerelle est local au process → le système est **strictement mono-instance** aujourd'hui.

Aucun de ces points n'est structurellement coûteux à corriger. Le chemin vers un partage public propre est court et bien balisé (voir §5, feuille de route).

### Scorecard par domaine

| Domaine | Note | Synthèse |
|---|---|---|
| Architecture | 🟢 B+ | Frontières nettes, moteur pur injecté, DAG sans cycle. Dette : couche passerelle non scalable, blob write-through O(n²). |
| Sécurité | 🟠 C | Cross-tenant et anti-triche solides ; **trou intra-tenant P0**, aucun rate-limit, PINs `Math.random`. |
| DevOps | 🟠 C+ | Dockerfile & compose de qualité pro ; **aucune CI**, scaling non branché, observabilité minimale. |
| Qualité code | 🟢 B+ | Typage strict, tests riches et pertinents ; **aucun lint/format**, contrats socket « stringly-typed », fichiers-Dieu. |
| Maturité OSS | 🟠 C | Brand-kit & docs de specs excellents ; **fichiers OSS de base absents** ; licence tranchée (Apache-2.0, voir §6). |

---

## 1. Points forts (à préserver et à mettre en avant)

Ces points sont des atouts réels ; plusieurs sont **au-dessus de la moyenne des projets OSS**.

**Architecture & moteur**
- **Séparation moteur / stockage exemplaire.** `packages/game` ne dépend d'aucune persistance ; l'accès passe par l'interface `SessionStore` (`packages/game/src/store.ts:3`), effets injectés (`now`, `genPin`, `genId` — `engine.ts:56`). Zéro `Date.now`/`Math.random` dans le moteur → timing déterministe et testable. **Meilleure frontière du repo.**
- **DAG de dépendances propre, sans cycle.** Feuilles `shared`/`quiz` ; `game` ne dépend que de `quiz`.
- **Anti-triche par construction.** La bonne réponse n'est jamais dans les projections joueur ; `questionResult` n'est calculé qu'après `engine.reveal()` (`game-gateway.ts:214`). Scoring 100 % horloge serveur avec clamp, échec *fermé* si l'horodatage est corrompu (`engine.ts:236`).
- **Idempotence rigoureuse** des transitions (triple garde `credited[]` / `revealedRounds` / `autoRevealedRounds`) : un `reveal` rejoué ne recrédite jamais.
- **Reconnexion soignée** (hôte/joueur/écran) avec gardes de course (`activeSocketIdByPlayerId`).

**Sécurité (déjà durci)**
- **Isolation cross-tenant solide** : tous les repos filtrent par `tenantId` du *scope*, jamais depuis l'input client ; membership vérifié en mode multi ; erreurs typées (pas de match sous-chaîne).
- **Hardening des secrets exemplaire** : garde de prod (`config.ts:44`), `${BETTER_AUTH_SECRET:?...}` qui fait échouer `docker compose up` (`docker-compose.yml:33`), aucun secret committé, commentaires pédagogiques.
- **SQL 100 % paramétré** (Drizzle), **aucun XSS** (0 `dangerouslySetInnerHTML`), CORS Socket.IO durci en liste blanche.

**DevOps**
- **Dockerfile multi-stage** propre, non-root (`USER node`), HEALTHCHECK sans dépendance (fetch natif), image runtime allégée (`--prod`), arrêt gracieux SIGTERM/SIGINT.
- Migrations versionnées appliquées au boot, testées sur base vierge via testcontainers.

**Qualité & tests**
- `strict: true` partout, **0 `any` / 0 `@ts-ignore` / 0 `TODO-FIXME`** dans le code de prod.
- **60 fichiers de test / 89 source** — pas du remplissage : e2e réels (game, editor, reports, auth), Postgres jetable via testcontainers, tests React (motion, focus a11y).
- Documentation d'intention exceptionnelle (le *pourquoi* est écrit).

**Open Source**
- **Brand-kit quasi prêt** (tokens, assets SVG, `voice-and-tone.md`, `DEV-HANDOFF.md`) + templates OSS déjà rédigés.
- **Docs de conception riches** (13 plans, 5 specs, screenshots) — base parfaite pour une doc publique.
- Nommage produit **« Arena »** déjà distinct de Kahoot (bon réflexe anti-marque).

---

## 2. Constats critiques (P0) — à traiter avant tout partage/déploiement

> **P0 = bloquant.** Chaque item est soit une faille exploitable, soit un blocage légal, soit un mensonge de configuration.

### P0-1 · Sécurité — Broken Access Control intra-tenant + inscription ouverte
`ownerId` est stocké (`schema.ts:32`) mais **jamais utilisé comme filtre** : `listQuizzes`/`getQuiz`/`updateQuiz`/`deleteQuiz` filtrent **uniquement par `tenantId`** (`packages/db/src/repos/quiz.ts:45,53,61,69`). Les rôles `owner/admin/member` sont stockés mais **aucun RBAC ne les vérifie**. En mode `single` (défaut), `ensureDefaultTenant` place **tous** les comptes dans le tenant unique, et l'inscription est **ouverte sans vérification d'e-mail** (`auth.ts:18`).
**Exploit :** `sign-up` anonyme → `DELETE /api/quizzes/{id_d_autrui}` réussit ; `GET /api/quizzes` renvoie les quiz de tout le monde ; les rapports (scores, pseudos, réponses) sont lisibles par tous.
**Effort : M.** Filtrer par `ownerId` sur les routes éditeur/rapports **ou** implémenter un RBAC exploitant `membership.role` ; vérifier la propriété du quiz dans `host:create`. Fermer l'inscription par défaut en self-host (`requireEmailVerification` ou allowlist).
*Convergence : DevSecOps (P0).*

### P0-2 · OSS/Légal — pas de `LICENSE`, pas de `README` racine, positionnement marque
Sans `LICENSE`, le code est **« tous droits réservés »** : forker/contribuer/déployer est illégal, quelle que soit l'intention affichée. Aucun `README` racine (premier contact GitHub). Le positionnement « clone Kahoot » (nom de dossier, specs, commentaires) expose à une réclamation — **Kahoot! est une marque déposée**.
**Effort : S→M.** Déposer `LICENSE`, écrire un `README` produit (pitch Arena + screenshots existants + quickstart `docker compose up`), purger le vocabulaire « clone », renommer le repo public `arena`, décrire par la **catégorie** (« alternative open-source à Kahoot », factuel).
*Convergence : Expert OSS (P0), corroboré par Lead Dev & DevOps sur le README/CI.*

### P0-3 · Architecture/DevOps — scaling `redis` annoncé mais non implémenté (mensonge de config)
`config.scaling` bascule sur `'redis'` dès que `REDIS_URL` est présent (`config.ts:58`) et `/health` l'affiche (`app.ts:13`), **mais rien ne le consomme** : `attachRealtime` crée `new Server(...)` **sans `io.adapter(...)`** (`realtime.ts:24`), aucune dépendance `@socket.io/redis-adapter`. De plus, **tout l'état de routage de la passerelle est local au process** (`pinToSessionId`, `screenTokenToSessionId`, `activeSocketIdByPlayerId`, timers `setTimeout` — `game-gateway.ts:96`). En multi-instance, un `player:join` sur le pod B avec un PIN créé sur A → « PIN invalide ». **Le système est strictement mono-instance.**
**Effort : L** (vraie correction) ou **S** (honnêteté immédiate : retirer `redis` de `/health` + documenter « mono-instance »). Correction : brancher l'adaptateur Redis + sortir les index de routage vers Postgres/Redis + modèle d'*ownership* de session pour les timers.
*Convergence : Architecte (P0-A1), DevOps (P0).*

### P0-4 · DevOps — aucune CI/CD
Pas de `.github/`. Les scripts `typecheck`/`test`/`build` existent mais ne tournent jamais sur PR → régressions non détectées, image jamais construite/publiée, badge « build passing » des templates mensonger. **L'outillage existe déjà** — il ne manque que les workflows.
**Effort : M.** Workflow qualité (install pnpm → typecheck → lint → test → build ; Docker dispo sur `ubuntu-latest` pour les testcontainers) + workflow release (build/push image GHCR taggée SemVer, scan Trivy, `pnpm audit`).
*Convergence : DevOps (P0), Lead Dev (P1), Expert OSS (P1) — 3 experts.*

### P0-5 · Architecture — write-through du blob complet à chaque réponse (amplification O(n²))
`submitAnswer` appelle `store.save` à **chaque** réponse (`engine.ts:260`), et `save` sérialise **toute** la `GameSession` dans `UPDATE game_session SET engine_state = <blob>` (`persistent-store.ts:60`) — une **ligne unique très chaude** (hot-row jsonb) réécrite en ~O(N²) par manche, plus un `structuredClone` de session entière à chaque `get`/`save`. Point de contention garanti à fort trafic.
**Effort : M.** Checkpoint/débounce plutôt qu'à chaque réponse (les `answer_record` individuels sont déjà persistés au reveal), ou séparer le noyau léger (phase/index) des `answers` volumineux ; à terme, `SessionStore` Redis.
*Source : Architecte (P0-A2).*

---

## 3. Constats importants (P1)

| # | Constat | Fichier clé | Effort | Source |
|---|---|---|---|---|
| P1-1 | **Aucun rate-limit** (HTTP ni socket) → brute-force auth, credential stuffing, spam de comptes, énumération de parties. `helmet`/`@fastify/rate-limit` absents. | `app.ts`, `auth-plugin.ts:20` | M | DevSecOps |
| P1-2 | **PINs prédictibles** : `Math.floor(Math.random()*1e6)` (`pin.ts:8`) → énumération de parties live (aggravé par l'absence de throttle sur `player:join`). | `packages/game/src/pin.ts:8` | M | DevSecOps |
| P1-3 | **Aucun lint/format** (ESLint/Prettier/Biome absents). Indice : `exhaustive-deps` désactivé inline alors que la règle n'existe nulle part (`useGameSocket.ts:91`). Manque n°1 pour un projet ouvert aux contributions. | racine | M | Lead Dev, DevOps, OSS |
| P1-4 | **Contrat Socket.IO « stringly-typed »** : littéraux non vérifiés serveur+client, `emitAck<T>` caste en aveugle, `socket.data as SocketData` répété. Une faute de frappe ne casse pas la compilation. | `game-gateway.ts`, `useGameSocket.ts:104` | L | Architecte, Lead Dev |
| P1-5 | **Contrats client dupliqués à la main** : ~80 lignes de types moteur re-déclarés verbatim dans chaque écran (`PlayerLive.tsx:21`, idem Host/BigScreen) + 14 casts `as McqCorrect…`. Dérive garantie. | `apps/web/src/screens/*` | M | Architecte, Lead Dev |
| P1-6 | **Fuite mémoire** : registres de la passerelle et cache `byId` **jamais purgés** après podium (`store.delete()` jamais appelé). Serveur long-running accumule toutes les parties jouées. | `game-gateway.ts:96,685` | S→M | Architecte, Lead Dev |
| P1-7 | **Pas de timer serveur autoritatif en phase `question`** : seule `reading` a un `setTimeout`. Hôte déconnecté + un joueur qui ne répond jamais → manche ouverte indéfiniment ; `timeLimit` n'est qu'un décompte client. | `game-gateway.ts:280` | M | Architecte |
| P1-8 | **Fenêtre de crash reveal()/persistRound** : crash entre les deux `await` → détail par-question du rapport perdu pour la manche. Documenté, non résolu. | `game-gateway.ts:200` | M | Architecte, Lead Dev, DevOps, DevSecOps |
| P1-9 | **Migrations couplées au boot de chaque instance** → course multi-replica. Pas de script `db:migrate` de déploiement dédié. | `index.ts:17` | S | DevOps |
| P1-10 | **Observabilité minimale** : pino non configuré prod (pas de redact des secrets/cookies), aucune métrique/tracing, `/health` unique (pas de readiness distincte, ne ping pas réellement la DB). | `app.ts:7,9` | S→M | DevOps |
| P1-11 | **Fichiers OSS manquants** (au-delà de LICENSE/README) : `CONTRIBUTING`/`CODE_OF_CONDUCT`/`SECURITY` à la racine, templates `.github` issues/PR ; templates du brand-kit à instancier (placeholders non résolus) ; repo `splootlabs/.github` inexistant → images des READMEs en 404. | — | S→M | Expert OSS |
| P1-12 | **Dérive doc ↔ code** : specs & mémoire annoncent Lucia + argon2, le code utilise **better-auth**. Une doc publique reprenant le spec induirait en erreur. | `packages/auth` | S | Expert OSS |

---

## 4. Constats de confort (P2) et divers

- **Sécurité :** chaînes non bornées (nickname/prompt/title, aucune `.max()` — DoS/abus stockage + XSS latent sur `media` non validé) · pas de `@fastify/helmet`/CSP · cookies dépendant des seuls défauts better-auth avec `BETTER_AUTH_URL` en `http` (flag `Secure` non posé si laissé en prod) · hosting **cassé en mode multi** (`resolveTenantId` sans tenant explicite dans `host:create`) · messages d'erreur de join différenciés (aide l'énumération).
- **Qualité :** `tsconfig` sans `noUncheckedIndexedAccess`/`noUnusedLocals` · fichiers-Dieu (`HostEditor.tsx` 1519 l./33 hooks, `registerGameGateway` ~830 l.) · erreurs avalées `.catch(() => {})` sans log (trou d'observabilité) · pas de mesure de couverture · code mort dans le système motion (`media`/`MediaOverlay` sans consommateur) · commentaires « Task N » qui vieilliront mal · `play-demo.mjs` untracked.
- **Architecture :** `basePoints` câblé en dur à 1000 (absent du schéma) · collision de nom `GameSession` (db vs game) · pool pg `max:10` partagé · réhydratation synchrone au boot qui retarde l'acceptation des connexions.
- **DevOps :** `pnpm install` complet au runtime (recompile `better-sqlite3` inutile) · pas de cache pnpm BuildKit · `.dockerignore` minimal (risque de fuite `.env`, pas de `**/*.test.ts`) · versions `0.0.0` partout, pas de SemVer/CHANGELOG/labels OCI · `BETTER_AUTH_URL` en dur dans compose.
- **OSS :** pas de CHANGELOG/tags/releases · découvrabilité (topics, description, social preview) · Google Fonts via CDN vs self-host prôné par le DEV-HANDOFF · **vérifier `git ls-files .env`** (présent dans l'arbre ; s'il est suivi, `git rm --cached` + scan historique).

---

## 5. Feuille de route d'action

Découpée en jalons livrables. L'ordre privilégie : *ne rien exposer d'exploitable ou d'illégal* → *ne pas mentir sur les capacités* → *fiabiliser* → *ouvrir proprement à la contribution*.

### 🚦 Jalon 0 — « Ne pas se blesser » (avant tout push public) — ~2-4 j
Objectif : rendre le repo légalement partageable et non trivialement exploitable.
- [ ] **P0-1** Contrôle de propriété intra-tenant (filtre `ownerId` ou RBAC) + fermeture de l'inscription par défaut (`requireEmailVerification`/allowlist).
- [ ] **P0-2** `LICENSE` + `README` produit + purge du vocabulaire « clone » + renommage repo `arena`.
- [ ] **P0-3 (variante honnêteté)** Retirer `redis` de `/health` **ou** documenter explicitement « mono-instance » tant que l'adaptateur n'est pas branché.
- [ ] Vérifier/retirer `.env` du suivi git, scanner l'historique.
- [ ] Bornes `.max()` sur les chaînes + validation d'URL `media` (P2 sécurité, effort S mais anti-DoS/XSS).

### 🚦 Jalon 1 — Filet qualité & CI — ~2-3 j
- [ ] **P0-4** CI GitHub Actions : `typecheck` + `lint` + `test` + `build` sur PR (Docker pour testcontainers), merge bloqué sur échec.
- [ ] **P1-3** ESLint (typescript-eslint strict + react-hooks + jsx-a11y) + Prettier + `no-floating-promises` ; husky + lint-staged.
- [ ] **P1-1 / P1-2** `@fastify/rate-limit` sur `/api/*` (surtout `/api/auth/*`) + throttle socket `player:join` ; `crypto.randomInt` pour les PINs.
- [ ] **P2** `@fastify/helmet` + CSP ; cookies `secure/httpOnly/sameSite` explicites + `https` imposé en prod.

### 🚦 Jalon 2 — Contrats & fiabilité — ~4-6 j
- [ ] **P1-4 / P1-5** Package `contracts` (zod) partagé : noms d'events + payloads, `Server<...>`/`Socket<...>` typés côté serveur, types moteur importés (fin de la duplication + des 14 casts). *Corrige deux P1 d'un coup.*
- [ ] **P1-6** Éviction des sessions closes (Map gateway + cache `byId`) au podium/ended.
- [ ] **P1-7** Timer serveur autoritatif en phase `question`, reprogrammé à la réhydratation.
- [ ] **P1-8** Rendre atomique reveal/persist (écrire `answer_record` avant de créditer, ou flag « persisté » distinct de `credited`).
- [ ] **P1-10** pino prod (JSON + redact), `/health` → readiness qui ping la DB, `/metrics`.

### 🚦 Jalon 3 — Ouvrir la contribution (OSS complet) — ~2-3 j
- [ ] **P1-11** `CONTRIBUTING`/`CODE_OF_CONDUCT`/`SECURITY` instanciés à la racine + templates `.github` issues/PR + repo `splootlabs/.github` (assets).
- [ ] **P1-12** Réconcilier la doc (better-auth, pas Lucia) ; doc dev « run local < 10 min » (serveur + vite proxy) ; doc d'architecture publique (dériver du spec) ; guide de déploiement prod.
- [ ] SemVer + CHANGELOG + première release taguée ; topics/description/social preview.

### 🚦 Jalon 4 — Vrai scale-out (quand le cloud SaaS le justifie) — ~1-2 sem
- [ ] **P0-3 (vraie correction)** Adaptateur Redis Socket.IO + index de routage (PIN/token) en Postgres/Redis + ownership de session pour timers.
- [ ] **P0-5** Fin du write-through blob à chaque réponse (checkpoint/débounce, ou `SessionStore` Redis) ; réduire les `structuredClone`.
- [ ] **P1-9** Migrations en étape dédiée (Job/initContainer), serveur qui échoue vite si schéma non à jour.
- [ ] Readiness distincte pour rolling updates ; dimensionner le pool pg ; découper `game-gateway.ts` et `HostEditor.tsx`.

---

## 6. Licence — DÉCISION PRISE ET IMPLÉMENTÉE (2026-07-28)

> **Cheminement.** Trois options ont été explorées à mesure que l'intention se précisait :
> (1) AGPL-3.0 (protège le SaaS mais copyleft contamine les intégrateurs) ; (2) source-available
> pour bloquer le SaaS concurrent — BSL 1.1 (sunset 4 ans) puis Elastic-2.0 (perpétuel) ;
> (3) **finalement Apache-2.0**, une fois l'objectif prioritaire clarifié : **« que le plus grand
> nombre puisse en profiter »**. L'ouverture maximale l'emporte sur la protection du SaaS.

**Décision retenue : Apache License 2.0 (`Apache-2.0`) — vrai open source, permissif.**
- **Tout est autorisé** : self-host, modification, fork, usage commercial, intégration dans un
  produit tiers, redistribution — y compris héberger Arena en service (concurrence assumée).
- **Obligations légères** : joindre la licence, conserver les mentions d'attribution
  (`NOTICE`), signaler les fichiers modifiés, ne pas usurper la marque « Arena »/« Sploot Labs ».
- **Marque** : « open source » est désormais **exact** (Apache-2.0 est OSI-approuvé).
- **Monétisation** (compatible, à décider plus tard) : cloud hébergé managé, édition entreprise
  (SSO/SAML, audit…) en add-on ou **open core**, support/formation. Levier = service, pas licence.
- **DCO** (`git commit -s`) recommandé ; pas de CLA lourd nécessaire en permissif.

**Livré :** `LICENSE` (texte Apache-2.0 + notice de copyright Sploot Labs), `NOTICE` (attribution),
`LICENSING.md` (FAQ en clair + obligations + pistes business), champ `"license": "Apache-2.0"`
dans les 8 `package.json`, templates brand-kit realignés sur Apache-2.0.

**Reste à faire :** relecture juridique conseillée mais **risque faible** (Apache-2.0 = standard
éprouvé) ; (optionnel) en-têtes de licence par fichier ; formaliser le modèle de monétisation
(cloud / open core) si/quand pertinent.

---

## 7. Points de défaillance unique actuels (à surveiller)

1. Instance serveur unique de fait (P0-3).
2. Ligne `game_session.engine_state` hot-row (P0-5).
3. Pool pg `max:10` partagé HTTP + auth + gateway + réhydratation.
4. Réhydratation synchrone au boot qui retarde l'acceptation des connexions à grand nombre de sessions reprenables.

---

*Rapport consolidé à partir de 5 revues indépendantes (Architecte, DevOps, DevSecOps, Lead Dev, Expert OSS). Les constats marqués « convergence » ont été relevés par plusieurs profils — confiance élevée.*
