import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./apps/web/vitest.setup.ts'],
  },
})
