import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium when available (e.g. sandboxed CI); otherwise Playwright's own.
const localChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
