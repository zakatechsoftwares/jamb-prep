import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The integration tests share one database, and the queue tests
    // TRUNCATE to clear the append-only tables between cases. Running the
    // files in parallel would let one wipe another's fixtures mid-test.
    fileParallelism: false,
  },
});
