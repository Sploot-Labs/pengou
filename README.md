<div align="center">

# Pengou 🐧

### Le quiz en direct, open source. Chez vous ou dans le cloud.

Une alternative open source à Kahoot : créez des quiz, lancez des parties en temps réel,
projetez le grand écran, jouez depuis n'importe quel téléphone. Auto-hébergeable en une commande.

[![CI](https://github.com/Sploot-Labs/pengou/actions/workflows/ci.yml/badge.svg)](https://github.com/Sploot-Labs/pengou/actions/workflows/ci.yml)
[![Licence Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-3F7D57?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-3F7D57?style=flat-square)](https://nodejs.org)
[![Étoiles GitHub](https://img.shields.io/github/stars/Sploot-Labs/pengou?style=flat-square&color=D9772B)](https://github.com/Sploot-Labs/pengou/stargazers)
[![PRs bienvenues](https://img.shields.io/badge/PRs-bienvenues%20%F0%9F%90%BE-D9772B?style=flat-square)](./CONTRIBUTING.md)
![Par Sploot Labs](https://img.shields.io/badge/par-sploot%20labs-1E5F60?style=flat-square)

[Démarrer](#démarrer-en-une-commande-docker) | [Fonctionnalités](#ce-que-fait-pengou) | [Contribuer](#contribuer) | [Contributeurs](#contributeurs)

</div>

---

## En deux phrases

Pengou fait tourner un quiz multijoueur en direct : l'hôte pilote la partie, le grand écran
affiche la question à toute la salle, et chaque joueur répond depuis son téléphone. Le score est
calculé côté serveur avec un bonus de rapidité, donc impossible à truquer depuis le navigateur.

<div align="center">

| Lobby (hôte) | Question (grand écran) | Podium (joueur) |
|---|---|---|
| ![Lobby](docs/superpowers/design/screenshots/01-host-live-lobby.png) | ![Question](docs/superpowers/design/screenshots/04-bigscreen-question.png) | ![Podium](docs/superpowers/design/screenshots/09-player-podium.png) |

</div>

## Ce que fait Pengou

- Quiz en direct multijoueur : QCM, vrai ou faux, réponse libre, curseur numérique.
- Scoring serveur-autoritaire avec bonus de rapidité, impossible à tricher côté client.
- Trois vues synchronisées : hôte (pilotage), grand écran (projection), joueur (mobile).
- Phase de lecture optionnelle (l'énoncé seul quelques secondes avant les réponses).
- Parties qui survivent au redémarrage du serveur (état persistant en Postgres).
- Rapports de partie : scores, réponses, export CSV.
- Multi-tenant : mode `single` pour le self-host, mode `multi` pour le SaaS.
- Authentification intégrée : e-mail et mot de passe, plus OAuth Google, GitHub et Facebook en option.

## Démarrer en une commande (Docker)

Prérequis : Docker et Docker Compose.

```bash
# Un secret de signature de session est requis (jamais committé, voir .env.example).
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)

docker compose up
```

Ouvrez ensuite http://localhost:3000. Compose lève Postgres et l'app, applique les migrations
au démarrage, et sert le SPA depuis le serveur. C'est tout.

## Développement local

Monorepo pnpm (Node ≥ 20). Le serveur (Fastify et Socket.IO) tourne sur `:3000`, le SPA (Vite)
sur `:5173` et proxifie `/api` et `/socket.io` vers le serveur.

```bash
pnpm install

# 1. Une base Postgres (exemple jetable via Docker)
docker run --name pengou-pg -e POSTGRES_USER=pengou -e POSTGRES_PASSWORD=pengou \
  -e POSTGRES_DB=pengou -p 5433:5432 -d postgres:16-alpine
export DATABASE_URL=postgres://pengou:pengou@localhost:5433/pengou
# En dev, BETTER_AUTH_SECRET est optionnel (repli toléré). Il devient requis en production.

# 2. Serveur (migrations appliquées au boot), port 3000
pnpm dev

# 3. Dans un autre terminal : le SPA, port 5173
pnpm --filter @splootlabs/web dev
```

Copiez `.env.example` vers `.env` pour ajuster la configuration (toutes les variables sont
documentées et lues par `packages/shared/src/config.ts`).

### Commandes utiles

```bash
pnpm test        # suite vitest (les tests DB et e2e utilisent testcontainers, Docker requis)
pnpm typecheck   # tsc --noEmit sur tous les packages
pnpm lint        # Biome
pnpm build       # build de tous les packages
```

## Architecture (survol)

```
apps/
  server/   Fastify et Socket.IO : API REST, passerelle temps réel, service du SPA
  web/      React (Vite) : éditeur de quiz, vues hôte, grand écran et joueur
packages/
  game/     moteur de jeu pur (machine à phases, scoring), sans dépendance de stockage
  quiz/     types de questions, validation (zod) et scoring
  db/       schéma Drizzle, migrations et repos (Postgres)
  auth/     Better Auth (sessions, OAuth)
  shared/   configuration (zod) partagée
```

Le moteur de jeu (`packages/game`) est pur et déterministe : ses effets (`now`, génération de
PIN et d'ids, stockage) sont injectés, ce qui rend le scoring testable et l'anti-triche fiable
par construction. Voir les specs de conception dans [`docs/superpowers/`](docs/superpowers/).

## Déploiement

- Image Docker : `Dockerfile` multi-stage, exécution non-root, healthcheck intégré.
- Base de données : Postgres (migrations appliquées au démarrage).
- Secrets : injectez `BETTER_AUTH_SECRET` et `DATABASE_URL` via votre gestionnaire de secrets.
  En production, servez derrière HTTPS et fixez `BETTER_AUTH_URL` en `https://`.
- Multi-instance : le passage à l'échelle horizontale (Redis, état de jeu partagé) est en cours.
  Le déploiement actuel est mono-instance. Voir [`docs/audit/`](docs/audit/).

## Contribuer

Les contributions, surtout les premières, sont célébrées ici. Voir
[CONTRIBUTING.md](./CONTRIBUTING.md), le [code de conduite](./CODE_OF_CONDUCT.md) et la
politique de [sécurité](./SECURITY.md).

Ta première PR open source ? Dis-le dans la description, on te déroule le tapis.

## Contributeurs

Merci à toutes les personnes qui posent leurs pattes sur Pengou. Cette galerie se met à jour
toute seule à chaque contribution mergée sur `main`.

<div align="center">

<a href="https://github.com/Sploot-Labs/pengou/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Sploot-Labs/pengou" alt="Contributeurs de Pengou" />
</a>

</div>

## Licence

[Apache-2.0](./LICENSE) © Sploot Labs. Voir [LICENSING.md](./LICENSING.md) pour ce que ça
autorise en clair (en résumé : à peu près tout).

<div align="center"><sub>Un projet <a href="https://github.com/Sploot-Labs">Sploot Labs</a>, à hauteur de pattes 🐾</sub></div>
