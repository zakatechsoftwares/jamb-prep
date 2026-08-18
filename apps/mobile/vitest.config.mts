import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      'react-native': fileURLToPath(new URL('./test/react-native.stub.ts', import.meta.url)),
      'expo-router': fileURLToPath(new URL('./test/expo-router.stub.ts', import.meta.url)),
      'expo-sqlite': fileURLToPath(new URL('./test/expo-sqlite.stub.ts', import.meta.url)),
    },
  },
});
