import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Integration tests share one server + database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    globalSetup: ['tests/integration/globalSetup.ts'],
  },
});
