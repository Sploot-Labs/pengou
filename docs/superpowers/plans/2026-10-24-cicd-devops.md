# Plan CI/CD et DevOps GitHub (Pengou)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** doter le dépôt `Sploot-Labs/pengou` d'une CI durcie, de l'automatisation des dépendances et de l'analyse de sécurité, puis d'une chaîne de livraison qui publie l'image sur GHCR et déploie sur un VPS par SSH.

**Architecture :** on part de la CI existante (`.github/workflows/ci.yml`, jobs qualité et audit). On la durcit, on ajoute Dependabot, CodeQL et CODEOWNERS, puis deux workflows de livraison : `release.yml` (build et push de l'image GHCR, déclenché par tag de version) et `deploy.yml` (SSH vers le VPS, `docker compose pull/up`, gated par un environnement GitHub `production`). Les réglages de dépôt (protection de branche, environnement, secret scanning) complètent le tout hors fichiers.

**Stack visée :** GitHub Actions, pnpm (monorepo), Docker multi-stage existant, image `ghcr.io/sploot-labs/pengou`, VPS Linux avec Docker et Docker Compose.

**Spec :** l'analyse DevOps menée dans la conversation du 2026-10-24 et les décisions prises : SaaS auto-hébergé sur VPS en SSH, image GHCR privée pour l'instant puis publique, dépôt ouvert aux contributions externes.

## Contraintes globales

- Dépendance de séquencement : la branche `chore/upgrade-stack-node-lts` (mise à jour Node LTS en cours dans un autre worktree) modifie `engines.node`, le `Dockerfile` (les deux `FROM node:20-slim`) et le `node-version` de `ci.yml`. Fusionner cette branche AVANT ce plan, ou rebaser ce plan dessus. Partout où un workflow fixe `node-version`, utiliser la version LTS retenue par cette branche (24 par défaut), jamais 20.
- Ne JAMAIS lancer `biome format --write` ni `pnpm format` sur ce dépôt (il n'est pas au format Biome). `pnpm lint` en lecture seule reste autorisé.
- Ne pas committer de secret. Les secrets de déploiement vivent dans l'environnement GitHub `production` et le `.env` de prod vit sur le VPS, jamais dans le dépôt.
- Toute action tierce est épinglée à un SHA de commit immuable (pas un tag mobile). Résoudre le SHA courant de chaque action au moment de l'écriture et le commenter avec la version lisible.
- Tout workflow pose `permissions:` au plus juste au niveau workflow, et n'élargit qu'au niveau job qui en a besoin.
- Nom de l'image : `ghcr.io/sploot-labs/pengou`. Service applicatif Compose : `app`. Entrée des migrations dans le conteneur : `node apps/server/dist/migrate.js`.
- Messages de commit conventionnels en français, terminés par la ligne : `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Points de vigilance (à vérifier explicitement)

- Une PR issue d'un fork ne doit jamais accéder aux secrets ni déclencher un déploiement. Le job qualité tourne via `pull_request` (sûr) ; `release.yml` et `deploy.yml` ne se déclenchent que sur tag ou sur `main`, jamais sur `pull_request`.
- Un échec de migration doit interrompre le déploiement AVANT `docker compose up -d`, pas après. La migration est une étape distincte et bloquante.
- Tant que l'image GHCR est privée, le VPS doit s'authentifier (`docker login ghcr.io`) avec un token dédié ; ce besoin disparaît quand le paquet passe public.
- Le check requis par la protection de branche doit porter le nom de job exact (`quality`), sinon la règle ne s'applique à rien.
- La push protection doit bloquer un commit contenant un secret (ex. `BETTER_AUTH_SECRET`) avant l'envoi : à vérifier par un essai contrôlé.

---

### Task 1: durcir la CI existante

**Fichiers :**
- Modifier : `.github/workflows/ci.yml`

**Interfaces :**
- Produit : un job nommé exactement `quality` (réutilisé comme check requis en Tâche 7).

- [ ] **Étape 1 : ajouter les permissions minimales et le timeout**
  Ajouter au niveau workflow `permissions:\n  contents: read`. Ajouter `timeout-minutes: 20` au job `quality`.

- [ ] **Étape 2 : épingler les actions aux SHA**
  Remplacer `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` par leur SHA courant, avec en commentaire la version (`# v4.x.x`).

- [ ] **Étape 3 : sortir l'audit des PR**
  Retirer le job `audit` du déclencheur `pull_request`. Le replacer dans un job planifié hebdomadaire (`on: schedule: - cron: '0 6 * * 1'`), toujours `continue-on-error: true`. L'audit au fil de l'eau est délégué à Dependabot (Tâche 2).

- [ ] **Étape 4 : valider la syntaxe**
  Lancer `actionlint .github/workflows/ci.yml` (ou via Docker `rhysd/actionlint`). Attendu : aucune erreur.

- [ ] **Étape 5 : vérifier l'exécution réelle**
  Pousser sur une branche de test, ouvrir une PR, confirmer que le check `quality` apparaît et passe au vert. Attendu : statut succès sur GitHub.

- [ ] **Étape 6 : commit**
  `git commit -m "ci: durcit la CI (permissions, épinglage SHA, timeout, audit planifié)"`

---

### Task 2: automatiser les dépendances (Dependabot)

**Fichiers :**
- Créer : `.github/dependabot.yml`

- [ ] **Étape 1 : écrire la configuration trois écosystèmes**
  `version: 2` avec trois entrées `updates` : `package-ecosystem: npm` (racine, pnpm reconnu), `github-actions` (pour tenir à jour les SHA épinglés en Tâche 1), `docker` (image de base du `Dockerfile`). Pour `npm`, grouper les mises à jour mineures et patch dans un groupe unique pour limiter le bruit ; laisser les mises à jour de sécurité ouvrir des PR immédiates. `schedule.interval: weekly` partout.

- [ ] **Étape 2 : valider**
  Vérifier le YAML (indentation, champs). Après merge, confirmer dans l'onglet Insights / Dependency graph / Dependabot que les trois écosystèmes sont détectés.

- [ ] **Étape 3 : commit**
  `git commit -m "ci: ajoute Dependabot (npm, github-actions, docker)"`

---

### Task 3: revue automatique (CODEOWNERS)

**Fichiers :**
- Créer : `.github/CODEOWNERS`

- [ ] **Étape 1 : écrire les règles**
  Owner par défaut `* @<login-github-du-mainteneur>`. Optionnellement, owners plus stricts sur les zones sensibles (`/packages/auth/`, `/.github/`).

- [ ] **Étape 2 : vérifier**
  Ouvrir une PR de test, confirmer que la revue est demandée automatiquement aux owners.

- [ ] **Étape 3 : commit**
  `git commit -m "ci: ajoute CODEOWNERS pour la revue automatique"`

---

### Task 4: analyse de sécurité statique (CodeQL)

**Fichiers :**
- Créer : `.github/workflows/codeql.yml`

**Interfaces :**
- Consomme : rien. Indépendant de la CI qualité.

- [ ] **Étape 1 : écrire le workflow**
  Déclencheurs : `pull_request` sur `main`, `push` sur `main`, et `schedule` hebdomadaire. `permissions:` avec `security-events: write`, `contents: read`, `actions: read`. Langages : `javascript-typescript`. Étapes : checkout, `github/codeql-action/init`, `github/codeql-action/analyze` (actions épinglées au SHA). Pas de build custom nécessaire pour JS/TS (mode par défaut).

- [ ] **Étape 2 : valider la syntaxe**
  `actionlint .github/workflows/codeql.yml`. Attendu : aucune erreur.

- [ ] **Étape 3 : vérifier l'exécution**
  Après merge (ou sur la PR), confirmer que l'analyse CodeQL tourne et remonte ses résultats dans l'onglet Security / Code scanning. Attendu : analyse terminée, pas d'erreur de configuration.

- [ ] **Étape 4 : commit**
  `git commit -m "ci: ajoute l'analyse CodeQL (JavaScript/TypeScript)"`

---

### Task 5: publication de l'image sur GHCR

**Fichiers :**
- Créer : `.github/workflows/release.yml`

**Interfaces :**
- Consomme : le `Dockerfile` racine existant (multi-stage, build web + server).
- Produit : une image `ghcr.io/sploot-labs/pengou` taguée par version SemVer et par SHA, consommée par la Tâche 6.

- [ ] **Étape 1 : écrire le workflow**
  Déclencheur : `push` sur les tags `v*.*.*`. `permissions:` au niveau job avec `contents: read` et `packages: write`. Étapes : checkout ; `docker/login-action` vers `ghcr.io` avec `username: ${{ github.actor }}` et `password: ${{ secrets.GITHUB_TOKEN }}` ; `docker/metadata-action` pour générer les tags (`type=semver,pattern={{version}}` et `type=sha`) sur l'image `ghcr.io/sploot-labs/pengou` ; `docker/build-push-action` avec `context: .`, `push: true`, cache de layers GitHub (`cache-from/cache-to: type=gha`), `provenance: true`. Actions épinglées au SHA.

- [ ] **Étape 2 : valider la syntaxe**
  `actionlint .github/workflows/release.yml`. Attendu : aucune erreur.

- [ ] **Étape 3 : vérifier par un tag de test**
  Créer un tag `v0.0.1-test`, confirmer que le workflow build et pousse l'image, et que le paquet apparaît dans l'onglet Packages de l'org (privé). Attendu : image présente, tags corrects. Supprimer ensuite le tag de test.

- [ ] **Étape 4 : commit**
  `git commit -m "ci: publie l'image sur GHCR au tag de version"`

Décision humaine : rester privé pour l'instant. Le passage en public se fera plus tard via les réglages du paquet GHCR, sans modifier ce workflow.

---

### Task 6: compose de production et déploiement SSH

**Fichiers :**
- Créer : `docker-compose.prod.yml`
- Créer : `.github/workflows/deploy.yml`

**Interfaces :**
- Consomme : l'image publiée par la Tâche 5. Secrets d'environnement `production` : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT` (optionnel), `GHCR_PULL_TOKEN` (tant que l'image est privée).

- [ ] **Étape 1 : écrire le compose de prod**
  Reprendre `docker-compose.yml` mais remplacer le service `app` `build: .` par `image: ghcr.io/sploot-labs/pengou:${IMAGE_TAG:-latest}`. Garder le service `db` Postgres et le volume. Ne pas committer de secret : `BETTER_AUTH_SECRET` et les valeurs sensibles restent fournis par le `.env` de prod présent sur le VPS.

- [ ] **Étape 2 : écrire le workflow de déploiement**
  Déclencheur : `push` sur les tags `v*.*.*` (après la Tâche 5), ou `workflow_dispatch` pour rejouer. Job `deploy` avec `environment: production` (garde-fou d'approbation) et `permissions: contents: read`. Étape unique via une action SSH épinglée au SHA (ex. `appleboy/ssh-action`) qui exécute sur le VPS, dans l'ordre : `docker login ghcr.io` (avec `GHCR_PULL_TOKEN`, tant que privé) ; `export IMAGE_TAG=<version du tag>` ; `docker compose -f docker-compose.prod.yml pull` ; migration bloquante `docker compose -f docker-compose.prod.yml run --rm app node apps/server/dist/migrate.js` ; puis `docker compose -f docker-compose.prod.yml up -d` ; `docker image prune -f`.

- [ ] **Étape 3 : vérification post-déploiement**
  Ajouter en fin de script une sonde : interroger `/health` et sortir en échec si la réponse n'est pas 2xx (le `Dockerfile` expose déjà `/health`). Attendu : le job échoue si le conteneur ne répond pas.

- [ ] **Étape 4 : valider la syntaxe**
  `actionlint .github/workflows/deploy.yml`. Attendu : aucune erreur.

- [ ] **Étape 5 : répétition sèche**
  Déclencher manuellement (`workflow_dispatch`) vers le VPS, confirmer : pull réussi, migration passée, conteneur up, `/health` vert. Attendu : déploiement complet et sonde au vert.

- [ ] **Étape 6 : commit**
  `git commit -m "ci: déploiement SSH vers le VPS gated par l'environnement production"`

Décisions humaines : confirmer le nom d'utilisateur SSH et le chemin du projet sur le VPS, et fournir une clé SSH dédiée au déploiement (pas une clé personnelle). Relire toute migration destructive avant de taguer une release.

---

### Task 7: réglages du dépôt (hors fichiers)

**Fichiers :** aucun. Réglages via l'interface GitHub ou `gh`. Documenter les valeurs appliquées dans le commit de doc final.

- [ ] **Étape 1 : visibilité**
  Décider de la visibilité publique du dépôt (prérequis aux fonctions de sécurité gratuites). Si encore privé, c'est la première bascule.

- [ ] **Étape 2 : protection de `main`**
  Exiger le check `quality`, exiger au moins une revue avec CODEOWNERS, exiger la résolution des conversations, exiger la branche à jour avant merge, interdire le push forcé.

- [ ] **Étape 3 : environnement `production`**
  Créer l'environnement, y ajouter le relecteur requis (toi), y ranger les secrets de déploiement de la Tâche 6.

- [ ] **Étape 4 : fonctions de sécurité**
  Activer secret scanning, push protection, Dependabot alerts, et le signalement privé de vulnérabilité (`SECURITY.md` déjà présent).

- [ ] **Étape 5 : vérifier la push protection**
  Tenter de committer une fausse valeur ressemblant à un secret sur une branche jetable, confirmer le blocage à l'envoi. Attendu : push refusé par la protection.

- [ ] **Étape 6 : garde des primo-contributeurs**
  Confirmer que l'approbation d'un mainteneur reste requise avant d'exécuter les workflows d'un primo-contributeur (réglage Actions, activé par défaut, à ne pas désactiver).

- [ ] **Étape 7 : consigner**
  Noter les réglages appliqués dans un court fichier `docs/devops.md` (ou le README DevOps), et commit : `git commit -m "docs: consigne les réglages de sécurité du dépôt"`.
