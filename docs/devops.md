# DevOps : réglages du dépôt et auto-hébergement

Ce document consigne les réglages à appliquer par un humain sur GitHub. Ils ne peuvent pas être versionnés dans le dépôt. Les commandes `gh` supposent un dépôt `Sploot-Labs/pengou` (adapter `OWNER/REPO` si besoin) et une session authentifiée avec des droits d'administration.

```sh
export REPO=Sploot-Labs/pengou
```

## 1. Séquencement

Fusionner d'abord la branche `chore/upgrade-stack-node-lts`, qui fixe la version de Node LTS dans `.github/workflows/ci.yml`. À défaut, rebaser `chore/cicd-devops` dessus. Sans cela, un conflit sur `node-version` est probable.

## 2. Visibilité du dépôt

CodeQL, le secret scanning et la push protection sont gratuits sur un dépôt public. Si le dépôt est encore privé, décider de la visibilité en premier, car la suite en dépend.

```sh
gh repo edit $REPO --visibility public --accept-visibility-change-consequences
```

## 3. Protection de la branche main

Réglages à appliquer : check de statut `quality` exigé (nom exact du job dans `ci.yml`), au moins une revue approuvée avec revue des CODEOWNERS, résolution des conversations, branche à jour avant merge, push forcé interdit.

```sh
gh api -X PUT repos/$REPO/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["quality"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Optionnel : exiger aussi CodeQL en ajoutant `"Analyze (javascript-typescript)"` au tableau `contexts`. Ce check n'existe qu'une fois le workflow exécuté au moins une fois sur le dépôt.

Le workflow `release.yml` ne se déclenche que sur des tags. Son check ne peut donc pas être exigé sur une PR.

Avec un seul mainteneur, la revue obligatoire bloque ses propres PR. Soit ajouter un second relecteur, soit passer `required_approving_review_count` à 0 et garder les autres règles, soit utiliser le contournement administrateur (`enforce_admins` à `false`, comme ci-dessus).

## 4. CODEOWNERS

Dans `.github/CODEOWNERS`, remplacer le placeholder `@OWNER-A-DEFINIR` par le login GitHub réel du mainteneur ou par une équipe `@Sploot-Labs/<equipe>`. Tant que le placeholder reste, GitHub signale un owner invalide et la revue n'est pas assignée automatiquement. Cette modification se fait par une PR ordinaire, et il faut la fusionner avant d'activer l'exigence de revue des CODEOWNERS, sous peine de bloquer toute PR.

## 5. Déploiement de l'instance officielle

L'instance officielle est déployée depuis un dépôt d'exploitation séparé. Aucun environnement `production` ni secret de déploiement n'est nécessaire dans ce dépôt, et il ne contient plus de workflow de déploiement. Si un environnement `production` et ses secrets de déploiement ont été créés auparavant, les supprimer dans Settings, Environments, puis Settings, Secrets and variables, Actions.

## 6. Auto-hébergement

Le fichier `docker-compose.prod.yml` permet de faire tourner Pengou sur n'importe quel hôte Docker, à partir de l'image publiée sur GHCR par `release.yml`. Dans le répertoire qui contient ce fichier, créer un fichier `.env` non versionné contenant :

```sh
POSTGRES_PASSWORD=<mot de passe sans @ / :>
SESSION_SECRET=<openssl rand -base64 32>
BETTER_AUTH_SECRET=<openssl rand -base64 32>   # 32 caractères minimum
APP_DB_PASSWORD=<openssl rand -base64 24>       # mot de passe du rôle app_role
BETTER_AUTH_URL=https://pengou.example.com      # https obligatoire
TRUSTED_PROXIES=172.16.0.0/12                   # IP ou CIDR du reverse proxy vu depuis le conteneur
```

Avant le prochain déploiement : `APP_DB_PASSWORD` et `TRUSTED_PROXIES` sont désormais obligatoires. Le compose de production refuse de démarrer tant qu'elles ne figurent pas dans le `.env`.

Points d'attention :

`TRUSTED_PROXIES` liste les proxys dont le serveur croit l'en-tête `X-Forwarded-For` (IP, CIDR ou mots-clés `loopback`, `uniquelocal`). Il sert à retrouver l'IP réelle des clients pour les limites de débit. Derrière un reverse proxy installé sur l'hôte, qui joint l'app par `127.0.0.1:3000`, le conteneur ne voit pas `127.0.0.1` mais la passerelle du réseau Docker : relever son adresse avec `docker network inspect <réseau>` (champ `Gateway`), ou indiquer la plage `172.16.0.0/12` qui couvre les réseaux Docker par défaut. Avec une valeur fausse, tous les clients partagent la même IP pour les limites de débit, et le serveur le signale une fois dans ses journaux.

Le service app n'écoute que sur `127.0.0.1:3000`. Un reverse proxy TLS (Caddy, nginx ou Traefik) doit donc être installé devant, et c'est lui qui porte le nom de domaine de `BETTER_AUTH_URL`.

`POSTGRES_PASSWORD` est interpolé dans `DATABASE_URL`. Choisir un mot de passe sans caractères problématiques pour une URL (`@`, `/`, `:`), ou l'URL-encoder. Un mot de passe alphanumérique généré avec `openssl rand -hex 24` convient.

Le volume `db-data` fige le mot de passe de la base au premier démarrage. Changer `POSTGRES_PASSWORD` ensuite dans `.env` ne modifie pas la base existante : il faut soit changer le mot de passe dans PostgreSQL, soit supprimer le volume (perte de données).

Tant que le paquet GHCR est privé, l'hôte doit s'authentifier (`docker login ghcr.io`) avec un jeton disposant du scope `read:packages` pour tirer l'image.

### Contenu de bibliothèque propre à l'instance

La bibliothèque de questions contient un catalogue livré avec l'image. Un auto-hébergeur peut y ajouter ses propres quiz et questions, sans reconstruire l'image, en pointant la variable `LIBRARY_EXTRA_DIR` vers un dossier. Le serveur lit ce dossier à chaque démarrage, en plus du catalogue livré, et synchronise la base.

Chaque fichier `*.json` du dossier (sous-dossiers compris, hors `themes.json`) est un pack :

```json
{
  "source": { "name": "Mon club", "license": "CC0", "url": "https://example.org" },
  "questions": [
    {
      "id": "club-001",
      "type": "mcq",
      "prompt": "Quelle est la capitale de la France ?",
      "payload": { "options": [{ "label": "Paris", "correct": true }, { "label": "Lyon", "correct": false }] },
      "theme": "geographie",
      "difficulty": "facile",
      "language": "fr",
      "audience": "tous",
      "timeLimit": 20,
      "readingTime": 6
    }
  ],
  "quizzes": [
    {
      "id": "club-quiz-1",
      "title": "Géographie pour débuter",
      "description": "Optionnel.",
      "theme": "geographie",
      "difficulty": "facile",
      "language": "fr",
      "audience": "tous",
      "questionIds": ["club-001"]
    }
  ]
}
```

Les champs `source`, `questions` et `quizzes` sont obligatoires (les deux listes peuvent être vides). La source (`name`, `license`, `url` facultatif) s'applique à tout le pack et s'affiche dans la bibliothèque et l'éditeur. Les identifiants de questions et de quiz doivent être uniques dans tout le catalogue, livré compris : préfixer les siens évite les collisions. Le `payload` suit le format de l'éditeur pour le type choisi (`mcq`, `truefalse`, `text` ou `slider`) et il est validé comme pour une question créée à la main. `timeLimit` (20 par défaut) et `readingTime` (6 par défaut) sont facultatifs, ainsi que `description`. Les critères prennent leurs valeurs dans des listes fixes : `difficulty` vaut `facile`, `moyen` ou `difficile`, `audience` vaut `enfants`, `adultes` ou `tous`, `language` est un code ISO 639-1 en minuscules (`fr`, `en`) et `theme` est l'identifiant d'un thème existant. Un quiz ne référence que des questions du même pack. Il n'y a pas de média dans le catalogue.

Un fichier `themes.json` à la racine du dossier ajuste la liste des thèmes :

```json
{
  "add": [{ "id": "geographie", "label": "Géographie" }],
  "relabel": { "cinema": "Cinéma et séries" },
  "hide": ["sport"]
}
```

`add` crée des thèmes (identifiant en minuscules, chiffres et tirets), `relabel` change le libellé d'un thème existant et `hide` le masque. Un thème masqué retire ses questions et ses quiz de toutes les réponses de l'API. Un thème ne se supprime pas : pour le retirer, on le masque. Les entrées de `relabel` ou `hide` qui visent un thème inconnu sont ignorées et journalisées.

Un fichier invalide (JSON mal formé, champ hors format, payload refusé, identifiant déjà pris, thème ou question inconnus) est écarté en entier : l'erreur est journalisée au démarrage avec le nom du fichier et la raison, les lignes que ce fichier avait déjà fournies restent en base dans leur version précédente, et le serveur démarre normalement. C'est valable aussi pour un `themes.json` invalide. Un dossier absent ou illisible est journalisé et ignoré : seul le catalogue livré est utilisé. Une question ou un quiz qui disparaît d'un fichier valide est supprimé de la base au démarrage suivant.

Le contenu ajouté relève de la responsabilité de l'hébergeur : il doit avoir le droit de le diffuser et indiquer la licence exacte dans `source.license`. Les copies faites par les utilisateurs conservent cette attribution. La licence `CC BY-SA 4.0` est reconnue par l'interface, qui y ajoute un lien vers son texte.

Avec Docker, monter le dossier en lecture seule dans le conteneur et le rendre lisible par l'utilisateur `node` (l'image ne tourne pas en root). Dans `docker-compose.prod.yml`, décommenter le volume et la variable d'environnement du service `app` :

```yaml
    environment:
      LIBRARY_EXTRA_DIR: /data/library
    volumes:
      - ./library:/data/library:ro
```

Sur l'hôte, `chmod -R a+rX ./library` suffit si le dossier n'appartient pas à l'utilisateur d'uid 1000 (celui de `node`).

## 7. Fonctions de sécurité

À activer dans Settings, Code security (valable pour un dépôt public).

```sh
gh api -X PATCH repos/$REPO --input - <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF

gh api -X PUT repos/$REPO/vulnerability-alerts          # alertes Dependabot
gh api -X PUT repos/$REPO/private-vulnerability-reporting   # signalement privé
```

Le fichier `SECURITY.md` existe déjà et décrit la procédure de signalement. Interface seulement : vérifier dans Settings, Actions, General, "Fork pull request workflows from outside collaborators" que l'approbation d'un mainteneur reste requise pour les primo-contributeurs (activé par défaut, ne pas le désactiver).

## 8. Vérifications à faire en conditions réelles

Ces vérifications n'ont pas pu être exécutées depuis le worktree.

- [ ] Pousser la branche, ouvrir une PR, confirmer que le check `quality` passe au vert.
- [ ] Créer un tag de test `v0.0.1-test` (`git tag v0.0.1-test && git push origin v0.0.1-test`), confirmer que l'image apparaît dans GHCR (privée), puis supprimer le tag de test (`git push origin :refs/tags/v0.0.1-test`, `git tag -d v0.0.1-test`) et la version de paquet correspondante.
- [ ] Sur un hôte de test, lancer `docker compose -f docker-compose.prod.yml up -d` avec un `.env` valide et confirmer que `/health` répond.
- [ ] Sur une branche jetable, tenter de committer une fausse valeur ressemblant à un secret et confirmer que la push protection bloque l'envoi.
- [ ] Quand souhaité, passer le paquet GHCR en public (Package settings, Danger zone, Change visibility). Le `docker login` côté hôte devient alors inutile.

Rappel : une release se déclenche par `git tag vX.Y.Z && git push origin vX.Y.Z`.
