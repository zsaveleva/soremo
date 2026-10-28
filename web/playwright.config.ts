import { defineConfig } from '@playwright/test';

// Сквозной сценарий против запущенного стека: `docker compose up` или make dev-api + make dev-web.
export default defineConfig({
  testDir: 'e2e',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
