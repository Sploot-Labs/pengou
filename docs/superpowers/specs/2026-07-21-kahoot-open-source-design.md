# Design — Kahoot! open-source (auto-hébergeable & cloud multi-tenant)

**Date :** 2026-07-21
**Statut :** Design validé (brainstorming) — en attente de relecture avant plan d'implémentation
**Nom de code projet :** `open-source-saas` (premier produit d'une « usine logicielle »)

---

## 1. Vision & contexte

Construire un **clone de Kahoot! open-source** :

- **Auto-hébergeable** par n'importe qui (`docker compose up`, zéro config).
- **Disponible en cloud** en mode **multi-tenant** (SaaS).

Ce produit est le **premier d'une « usine logicielle »** : l'objectif méta est de publier ensuite plein d'applications simples à forte valeur. On construit donc cette app à fond, en soignant les frontières de modules, pour en **extraire plus tard des briques réutilisables** (socle auth+tenant, shell applicatif, packaging dual-mode, pattern moteur temps réel). Cette extraction n'est **pas** dans le périmètre de ce spec — elle viendra après, comme travail dédié.

### Principe directeur : axes de configuration orthogonaux

Toute la machinerie (y compris multi-tenant) est **construite d'un bloc**. Les déploiements ne sont que des **combinaisons** de trois axes indépendants :

| Axe | Valeurs | Défaut self-host |
|---|---|---|
| `TENANCY_MODE` | `single` \| `multi` | `single` |
| `DATABASE_URL` | SQLite \| Postgres | SQLite (fichier) |
| Scaling (`REDIS_URL` présent ?) | mémoire (mono-instance) \| Redis (multi-instance) | mémoire |

Combinaisons cibles :

- **Self-host simple** (défaut) : `single` + SQLite + mémoire.
- **Self-host multi-tenant** : `multi` + SQLite/Postgres + mémoire (ex. une académie hébergeant plusieurs écoles).
- **Cloud** : `multi` + Postgres + Redis + multi-instance.

---

## 2. Stack technique

- **Langage** : TypeScript full-stack (un seul langage front + back, écosystème riche, vélocité — cohérent avec l'objectif d'usine).
- **Backend** : monolithe Node **modulaire**, packagé en **une seule image Docker** (un seul processus à lancer = self-host trivial).
- **Temps réel** : **Socket.IO**. Les *rooms* correspondent exactement à une partie (1 code PIN = 1 room). Reconnexion et gestion des déconnexions intégrées. Adaptateur **Redis** pour le fan-out multi-instance en cloud.
- **ORM / BDD** : **Drizzle ORM**, même code pour **SQLite** (self-host, BDD = un fichier, zéro service) et **Postgres** (cloud/multi-tenant robuste).
- **Frontend** : **React** (SPA via Vite), servi par le même processus Node (une image, un port). Choix optimisé pour le **vivier de contributeurs open-source** et l'écosystème de briques.
- **Auth** : **Lucia** (email/mot de passe + OAuth), hash **argon2**.

### Rejeté explicitement (et pourquoi)

- **Rust / Go** : la performance n'est pas le facteur limitant d'un quiz temps réel ; l'objectif d'usine privilégie la **vélocité** et l'**écosystème**. Rust juste « un moyen », pas un but → TypeScript gagne.
- **Micro-services** : nuisent à l'auto-hébergement (plusieurs processus). Monolithe modulaire = un seul déployable, frontières internes nettes.
- **Next.js/SvelteKit avec rendu serveur** : un SPA + API + serveur WebSocket dans un seul processus Node est plus simple pour le temps réel persistant et le self-host.

---

## 3. Architecture — modules

Monolithe découpé en modules isolés (frontières nettes, testables séparément) :

### 3.1 Module Web/API
CRUD et plan de gestion : comptes & OAuth, organisations/tenants, quiz & questions (éditeur), home dashboard, rapports post-partie, garde-fous de plan. Expose une API HTTP consommée par le SPA React.

### 3.2 Module Game-engine (temps réel)
Le cœur de valeur. **Sans dépendance à l'UI**, testable seul. Gère les sessions live, les rooms PIN, le chrono serveur, le scoring, le classement, les projections par rôle. État **autoritatif en mémoire**, derrière une **interface de store de session** (implémentations : mémoire / Redis).

### 3.3 Module Data
Schéma, migrations, accès BDD via Drizzle. Applique le **scoping tenant** (guard) sur toutes les requêtes. Abstrait SQLite/Postgres.

### 3.4 Frontend (SPA React)
Trois expériences distinctes (voir §5), consommant l'API HTTP + les événements Socket.IO.

---

## 4. Moteur de jeu (détaillé)

### 4.1 Machine à états d'une session

```
LOBBY → QUESTION_ACTIVE → REVEAL → SCOREBOARD → (boucle) → PODIUM
```

- **LOBBY** : l'hôte crée une session → génération d'un **code PIN** (unique parmi les sessions actives). Les joueurs rejoignent (PIN + pseudo) et apparaissent en direct côté hôte et grand écran.
- **QUESTION_ACTIVE** : question affichée, **chrono serveur** lancé, les joueurs soumettent. Transition quand le chrono expire **ou** que tous ont répondu.
- **REVEAL** : bonne réponse révélée + distribution/stats de la question.
- **SCOREBOARD** : classement cumulé entre deux questions.
- **PODIUM** : top 3 et fin ; les résultats sont persistés.

### 4.2 État & persistance

- **En mémoire (autoritatif)** pendant la partie : joueurs connectés, question courante, chrono, réponses reçues. Rapide et éphémère.
- **Persisté en BDD** : définition du quiz (déjà) + **résultats finaux et par question** (`game_session`, `session_player`, `answer_record`) pour les rapports post-partie.
- **Interface `SessionStore`** : implémentation mémoire (mono-instance) ou Redis (multi-instance). La logique de jeu ne dépend pas de l'implémentation.

### 4.3 Chrono & scoring — serveur autoritaire

- Le serveur horodate les réponses. **Aucune confiance au timing client.**
- Score par question = **justesse + bonus de rapidité** (plus vite = plus de points), formule type Kahoot. Calculé par la **stratégie du type de question**.

### 4.4 Anti-triche de base

- La **bonne réponse n'est jamais envoyée** aux clients joueurs avant `REVEAL`. Les joueurs n'envoient que leur choix ; le serveur valide.

### 4.5 Reconnexion

- Chaque joueur reçoit un **`join_token`** (localStorage). En cas de coupure, il re-rejoint la même session et **retrouve son score**. Reconnexion socket gérée par Socket.IO.

### 4.6 Types de questions — système de stratégies branchables

Un **type de question = une stratégie** implémentant une interface commune. Le moteur ne connaît que l'interface ; il itère génériquement sur les questions.

```ts
interface QuestionType {
  key: 'mcq' | 'truefalse' | 'text' | 'slider' | string
  validateDefinition(payload: unknown): void          // à l'édition
  playerView(question): PlayerPayload                  // sans la bonne réponse
  isCorrect(question, answer): boolean
  score(question, answer, timeMs, maxMs): number
}
```

- Enregistrées dans un **registre** (map par `key`). **Ajouter un type = ajouter un module**, sans toucher au moteur.
- Le **payload spécifique** au type est stocké en **JSON** dans `question.payload` → **aucune migration** pour un nouveau type.
- **MVP** : `mcq` (QCM 4 choix), `truefalse`, `text` (réponse libre courte, normalisation/comparaison), `slider` (estimation numérique, score par proximité).
- **Post-MVP (déjà prévus par l'architecture)** : sondage/poll (sans score), remise en ordre, association de paires, nuage de mots, hotspot image.

---

## 5. Écrans & rôles

Une session a **3 types de clients** connectés à la même room, recevant des **projections par rôle** différentes du même moteur :

### 5.1 Contrôleur hôte (authentifié)
La « télécommande » (laptop/téléphone). Pilote le flux (démarrer, question suivante, passer) et voit le **monitoring live** : nb de joueurs connectés, qui a répondu, distribution des réponses en temps réel, classement courant.

### 5.2 Grand écran / présentateur (lecture seule)
Sur le vidéoprojecteur. Affiche le PIN + le lobby, la question et les réponses (**sans surligner la bonne avant `REVEAL`**), le chrono, le scoreboard et le podium. Rejoint la session via un **token d'affichage à usage unique** généré par l'hôte (pas besoin de reconnecter le compte hôte sur le projecteur).

### 5.3 Joueurs (anonymes)
Téléphones. Rejoignent avec **PIN + pseudo**, un socket chacun, soumettent leurs réponses. **Aucun compte** ; identité éphémère limitée à la session.

---

## 6. Dashboard de suivi

Trois briques (le **suivi longitudinal inter-parties est explicitement hors périmètre** → joueurs anonymes, pas d'identité persistante) :

1. **Monitoring live en partie** — la vue de l'hôte pendant la session (voir §5.1), alimentée par le moteur temps réel.
2. **Rapports post-partie** — après le jeu : résultats détaillés d'une session, questions les plus ratées, score par joueur, **export CSV**. Lecture des données persistées.
3. **Home dashboard de l'hôte** — écran d'accueil après connexion : ses quiz, ses dernières parties, raccourcis de création.

---

## 7. Modèle de données

`tenant_id` présent **partout où pertinent** dès le départ (coût quasi nul, gros refactor évité).

- **tenant** — `id, name, plan, created_at`. En `TENANCY_MODE=single` : une ligne unique implicite.
- **user** (hôte/créateur) — `id, tenant_id, email, password_hash?, role, created_at`.
- **oauth_account** — `id, user_id, provider, provider_account_id`. (Google, GitHub par défaut.)
- **membership** — `id, user_id, tenant_id, role`. Support d'un utilisateur appartenant à ≥1 organisation ; base du **sélecteur d'organisation**.
- **quiz** — `id, tenant_id, owner_id, title, description, cover?, created_at, updated_at`.
- **question** — `id, quiz_id, type, prompt, media?, time_limit, order_index, payload(JSON)`. Le **payload JSON** contient le spécifique au type → aucune migration pour un nouveau type.
- **game_session** — `id, tenant_id, quiz_id, host_id, pin, status, started_at, ended_at`. PIN **unique parmi les sessions actives**.
- **session_player** — `id, session_id, nickname, join_token, total_score`. Anonyme, persisté pour les rapports.
- **answer_record** — `id, session_id, question_id, player_id, answer(JSON), time_ms, is_correct, points`.

---

## 8. Multi-tenancy

- **Scoping au niveau ligne** via `tenant_id` + un **guard** appliquant le filtre tenant sur toutes les requêtes du module Data.
- **Résolution du tenant** : via l'**organisation de l'utilisateur connecté** (table `membership`), avec un **sélecteur d'organisation** après login. Robuste sans sous-domaine (indispensable pour le self-host multi-tenant).
- **Sous-domaine** (`ecole.app.com`) : **option** en cloud, jamais un prérequis.
- **Jonction joueur (PIN)** : indépendante du tenant côté saisie ; la session résolue par le PIN porte son `tenant_id`. PIN globalement unique parmi les sessions actives.

---

## 9. Authentification

- **Hôtes** : email + mot de passe (**argon2**, cookie de session via **Lucia**) **+ OAuth** (Google, GitHub par défaut). En self-host, un **compte admin** est créé au premier lancement (setup initial).
- **Joueurs** : aucun compte ; `join_token` pour la reconnexion.
- **Grand écran** : token d'affichage à usage unique.

---

## 10. Plans & facturation

- **Plans modélisés** (`tenant.plan`, ex. `free` / `pro`) avec des **limites** (ex. nb de quiz, joueurs/partie) et des **garde-fous appliqués** dans le module Web/API.
- **Facturation Stripe NON branchée** au départ (choix produit). Le module paiement se connectera plus tard sur des plans **déjà modélisés** — connexion triviale, sans refactor.

---

## 11. Déploiement

- **Une image Docker unique** ; le SPA React (build Vite) est servi par le processus Node.
- **Config par variables d'environnement** : `TENANCY_MODE`, `DATABASE_URL`, `REDIS_URL?`, secrets (session, OAuth).
- **Self-host** : `docker compose up` avec SQLite (volume) = complet, zéro config. Reco : passer `DATABASE_URL` vers Postgres si multi-tenant à charge élevée (même code Drizzle).
- **Cloud** : Postgres + Redis (adaptateur Socket.IO + `SessionStore` Redis) + plusieurs instances.

---

## 12. Tests

- **Module Game-engine** : testé **isolément** (sans UI ni réseau) — machine à états, chrono/scoring déterministe, chaque **stratégie de type de question** (`isCorrect`, `score`, normalisation `text`, proximité `slider`).
- **Multi-tenancy** : tests garantissant l'**isolation** (aucune fuite de données entre tenants via le guard).
- **Module Data** : mêmes tests contre SQLite et Postgres (parité Drizzle).
- **Temps réel** : tests d'intégration Socket.IO (jonction, soumission, reconnexion, projections par rôle — la bonne réponse ne fuit pas avant `REVEAL`).
- **E2E** : un parcours de partie complet (hôte + grand écran + ≥2 joueurs → podium + rapport).

---

## 13. Périmètre

### Dans ce spec (tout conçu et construit d'un bloc)
Moteur de jeu temps réel · 4 types de questions (stratégies branchables) · 3 écrans · monitoring live + rapports post-partie + home dashboard · auth email-mdp + OAuth · multi-tenant activable partout (self-host inclus) · SQLite/Postgres · Redis/multi-instance · plans & limites modélisés.

### Hors périmètre (travaux dédiés ultérieurs)
- **Extraction des briques « usine »** (après ce produit).
- **Branchement Stripe** (plans déjà modélisés).
- **Suivi longitudinal** inter-parties / identité joueur persistante.
- Types de questions post-MVP (poll, ordre, paires, nuage de mots, hotspot).

### Ordre d'implémentation
Pas de portes « on s'arrête et on livre », mais l'implémentation se **séquence par dépendances** (ex. moteur mono-instance avant Redis ; comptes avant garde-fous de plan). Cet ordre sera détaillé dans le plan d'implémentation.

---

## 14. Décisions verrouillées (récap)

| Sujet | Décision |
|---|---|
| Langage | TypeScript full-stack |
| Backend | Monolithe Node modulaire, une image Docker |
| Temps réel | Socket.IO (+ adaptateur Redis en cloud) |
| ORM/BDD | Drizzle — SQLite (self-host) / Postgres (cloud) |
| Frontend | React (SPA Vite) |
| Auth | Lucia, argon2, OAuth Google + GitHub |
| Multi-tenancy | `tenant_id` niveau ligne + guard ; résolution par organisation + sélecteur ; sous-domaine optionnel |
| Tenancy | Axe orthogonal `TENANCY_MODE=single\|multi`, activable même en self-host |
| Types de questions | Registre de stratégies + payload JSON ; MVP : mcq, truefalse, text, slider |
| Écrans | Contrôleur hôte · grand écran (token d'affichage) · joueurs anonymes |
| Dashboard | Monitoring live · rapports post-partie (export CSV) · home hôte |
| Facturation | Plans + limites modélisés ; Stripe non branché |
