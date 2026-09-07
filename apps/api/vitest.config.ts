import { defineConfig } from 'vitest/config';

// Integration tests against a disposable Postgres database (jeviops_test on
// the dev container). global-setup rebuilds it from schema-selfhost.sql +
// seed.sql once per run; setup.ts points the API's env at it per worker.
// Files run serially — they share one database.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
