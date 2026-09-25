// Browser tests for the hub and every tool. Pages are served from the repo
// root by tests/serve.mjs, the same layout as the GitHub Pages deploy.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 8765;

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    acceptDownloads: true,
    // The offline service worker would cache pages between tests.
    serviceWorkers: 'block',
    viewport: { width: 1500, height: 950 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 950 } } }],
  webServer: {
    command: 'node tests/serve.mjs',
    url: `http://localhost:${PORT}/index.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
