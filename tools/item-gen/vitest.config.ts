import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests share the same Postgres database as packages/db's
    // own suite and truncate between cases — see packages/db/vitest.config.ts
    // for why this must stay false.
    fileParallelism: false,
  },
});
