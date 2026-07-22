# --- Stage build ---
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @splootlabs/web build
RUN pnpm --filter @splootlabs/shared build
RUN pnpm --filter @splootlabs/server build

# --- Stage runtime ---
FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
RUN pnpm install --prod --frozen-lockfile
# Le build du SPA est servi depuis ./public
COPY --from=build /app/apps/web/dist ./apps/server/public
ENV WEB_DIST=/app/apps/server/public
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
