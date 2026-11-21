import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', acceptDownloads: true, trace: 'off', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 },
    // local copy of the cloud sync Worker (fresh empty database on every run)
    { command: 'node worker/e2e-server.mjs', url: 'http://localhost:8787/status', reuseExistingServer: false, timeout: 180_000 },
  ],
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-size', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' }, grep: /@smoke/ },
  ],
});
