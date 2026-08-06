import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      'react-native': fileURLToPath(new URL('./test/react-native.stub.ts', import.meta.url)),
    },
  },
});
