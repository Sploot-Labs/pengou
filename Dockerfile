# --- Stage build ---
FROM node:20-slim AS build
RUN corepack enable
# Outils de compilation requis pour les dépendances natives optionnelles résolues
# transitivement par drizzle-orm/drizzle-kit (ex. better-sqlite3, non utilisé au runtime
# — le projet utilise Postgres via `postgres` — mais dont le binding natif est bien
# compilé lors de `pnpm install` sur cette image `slim`).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Les primitives de marque sont vendorées dans apps/web/src/theme/brand-primitives.css
# (copie du dépôt Sploot Labs) et importées localement par tokens.brand.css : plus de
# dossier brand-kit/ à la racine, donc rien de plus à copier ici.
RUN pnpm install --frozen-lockfile
# Build tous les packages dans l'ordre topologique (pnpm) — robuste à l'ajout de nouveaux packages.
RUN pnpm -r build

# --- Stage runtime ---
FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
# `better-auth` déclare `better-sqlite3` en peer dependency optionnelle (adaptateur sqlite non
# utilisé ici — le projet est 100% Postgres) ; pnpm tente néanmoins de la compiler. Outils de
# compilation installés puis retirés dans la même couche pour ne pas alourdir l'image finale.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && pnpm install --prod --frozen-lockfile \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Le build du SPA est servi depuis ./public
COPY --from=build /app/apps/web/dist ./apps/server/public
ENV WEB_DIST=/app/apps/server/public
EXPOSE 3000

# Sonde de vie : `node --version`/curl ne sont pas garantis dans une image `slim` — le fetch
# global de Node (18+) est déjà disponible sans dépendance supplémentaire. Échoue (exit 1) si
# /health répond autre chose que 2xx ou si la requête échoue (serveur pas encore prêt/down).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exécution en non-root : l'image de base `node:20-slim` fournit déjà un utilisateur `node`
# (uid/gid 1000). Les fichiers copiés depuis le stage `build` appartiennent à root mais restent
# lisibles/exécutables par `node` (permissions par défaut d'un COPY, sans écriture requise au
# runtime — aucun fichier n'est modifié après le démarrage). `USER` doit venir APRÈS les étapes
# `apt-get`/`pnpm install --prod` ci-dessus (qui nécessitent root) et AVANT `CMD`.
USER node

CMD ["node", "apps/server/dist/index.js"]
