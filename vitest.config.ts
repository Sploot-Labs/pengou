import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    environment: 'node',
    setupFiles: ['./apps/web/vitest.setup.ts'],
    // De nombreuses suites DB/e2e démarrent chacune leur propre conteneur Postgres
    // (@testcontainers). Sans plafond, ~toutes démarrent d'un coup → contention (démarrage lent,
    // « CONNECTION_ENDED »). On plafonne le parallélisme de fichiers et on tolère un démarrage de
    // conteneur lent (hookTimeout). Les tests eux-mêmes restent rapides (testTimeout modéré).
    maxWorkers: 4,
    minWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
})
