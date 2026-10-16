import { defineConfig } from 'vitest/config';
import path from 'path';

/** Two production server instances sharing PostgreSQL and Redis. Needs `next build` first. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/multi-instance/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
});
