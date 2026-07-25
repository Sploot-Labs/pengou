import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    environment: 'node',
    setupFiles: ['./apps/web/vitest.setup.ts'],
  },
})
