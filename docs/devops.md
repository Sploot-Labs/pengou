# DevOps : réglages du dépôt et du déploiement

Ce document consigne les réglages à appliquer par un humain sur GitHub et sur le VPS. Ils ne peuvent pas être versionnés dans le dépôt. Les commandes `gh` supposent un dépôt `Sploot-Labs/Pengou` (adapter `OWNER/REPO` si besoin) et une session authentifiée avec des droits d'administration.

```sh
export REPO=Sploot-Labs/Pengou
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

Les workflows `release.yml` et `deploy.yml` ne se déclenchent que sur des tags (ou en manuel pour le déploiement). Leurs checks ne peuvent donc pas être exigés sur une PR.

Avec un seul mainteneur, la revue obligatoire bloque ses propres PR. Soit ajouter un second relecteur, soit passer `required_approving_review_count` à 0 et garder les autres règles, soit utiliser le contournement administrateur (`enforce_admins` à `false`, comme ci-dessus).

## 4. CODEOWNERS

Dans `.github/CODEOWNERS`, remplacer le placeholder `@OWNER-A-DEFINIR` par le login GitHub réel du mainteneur ou par une équipe `@Sploot-Labs/<equipe>`. Tant que le placeholder reste, GitHub signale un owner invalide et la revue n'est pas assignée automatiquement. Cette modification se fait par une PR ordinaire, et il faut la fusionner avant d'activer l'exigence de revue des CODEOWNERS, sous peine de bloquer toute PR.

## 5. Environnement production

Créer l'environnement, y placer un relecteur requis, puis restreindre son déploiement. Sans restriction, un `workflow_dispatch` lancé depuis une branche quelconque déploierait le compose de cette branche.

```sh
# ID numérique du relecteur (utilisateur) :
REVIEWER_ID=$(gh api users/<LOGIN> --jq .id)

gh api -X PUT repos/$REPO/environments/production --input - <<EOF
{
  "reviewers": [ { "type": "User", "id": $REVIEWER_ID } ],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF

# Autoriser uniquement main et les tags de version :
gh api -X POST repos/$REPO/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
gh api -X POST repos/$REPO/environments/production/deployment-branch-policies \
  -f name='v*' -f type=tag
```

Alternative en interface : Settings, Environments, production, puis "Deployment branches and tags" avec "Selected branches and tags" et les règles `main` (branche) et `v*` (tag).

Les secrets vont dans l'environnement, pas dans les secrets de dépôt.

```sh
gh secret set VPS_HOST         --env production --repo $REPO   # hôte ou IP du VPS
gh secret set VPS_USER         --env production --repo $REPO   # utilisateur SSH de déploiement
gh secret set VPS_SSH_KEY      --env production --repo $REPO < ~/.ssh/pengou_deploy   # clé privée
gh secret set VPS_SSH_PORT     --env production --repo $REPO   # optionnel, 22 par défaut
gh secret set VPS_DEPLOY_PATH  --env production --repo $REPO   # ex. /opt/pengou
gh secret set GHCR_USERNAME    --env production --repo $REPO   # compte GitHub du PAT
gh secret set GHCR_TOKEN       --env production --repo $REPO   # PAT avec le scope read:packages
```

Sans valeur en argument, `gh secret set` la demande en saisie masquée. `VPS_SSH_PORT` peut être omis.

## 6. Préparation du VPS

Dans le répertoire `VPS_DEPLOY_PATH`, créer un fichier `.env` non versionné contenant :

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

Tant que le paquet GHCR est privé, le VPS doit pouvoir tirer l'image. Le workflow de déploiement fait le `docker login` avec `GHCR_USERNAME` et `GHCR_TOKEN`.

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
- [ ] Répéter le déploiement à blanc via `workflow_dispatch` vers le VPS et confirmer le pull, la migration, le up et la sonde `/health`. N'approuver `production` qu'après que Release a publié l'image.
- [ ] Sur une branche jetable, tenter de committer une fausse valeur ressemblant à un secret et confirmer que la push protection bloque l'envoi.
- [ ] Quand souhaité, passer le paquet GHCR en public (Package settings, Danger zone, Change visibility). Le `docker login` côté VPS devient alors inutile.

Rappel : une release se déclenche par `git tag vX.Y.Z && git push origin vX.Y.Z`.
