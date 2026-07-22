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
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @splootlabs/web build
RUN pnpm --filter @splootlabs/shared build
RUN pnpm --filter @splootlabs/db build
RUN pnpm --filter @splootlabs/auth build
RUN pnpm --filter @splootlabs/server build

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
CMD ["node", "apps/server/dist/index.js"]
