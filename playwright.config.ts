import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3200);
const DB = process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /field\.spec|console-mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /field\.spec|console-mobile\.spec/ },
  ],
  webServer: {
    // Production build: what actually ships (and free of dev-mode HMR noise).
    command: process.env.E2E_SERVER_MODE === 'development' ? 'npx tsx server.ts' : 'npx next build && npx tsx server.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 400_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: DB,
      JWT_SECRET: 'e2e-test-secret-0123456789-abcdefghijklmnopqrstuv',
      NODE_ENV: process.env.E2E_SERVER_MODE === 'development' ? 'development' : 'production',
      DISABLE_RATE_LIMIT: 'true',
      COOKIE_SECURE: 'false',
      UPLOAD_DIR: './.test-uploads',
    },
  },
});
