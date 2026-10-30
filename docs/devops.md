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
BETTER_AUTH_URL=https://pengou.example.com      # https obligatoire
```

Points d'attention :

Le service app n'écoute que sur `127.0.0.1:3000`. Un reverse proxy TLS (Caddy, nginx ou Traefik) doit donc être installé devant, et c'est lui qui porte le nom de domaine de `BETTER_AUTH_URL`.

`POSTGRES_PASSWORD` est interpolé dans `DATABASE_URL`. Choisir un mot de passe sans caractères problématiques pour une URL (`@`, `/`, `:`), ou l'URL-encoder. Un mot de passe alphanumérique généré avec `openssl rand -hex 24` convient.

Le volume `db-data` fige le mot de passe de la base au premier démarrage. Changer `POSTGRES_PASSWORD` ensuite dans `.env` ne modifie pas la base existante : il faut soit changer le mot de passe dans PostgreSQL, soit supprimer le volume (perte de données).

Tant que le paquet GHCR est privé, l'hôte doit s'authentifier (`docker login ghcr.io`) avec un jeton disposant du scope `read:packages` pour tirer l'image.

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
