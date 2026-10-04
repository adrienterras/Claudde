// Tests de bout en bout d'Atelier Gribouille : npm test (voir tests/README.md)
const { defineConfig } = require('@playwright/test');

const port = 8781;
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    viewport: { width: 1440, height: 1000 },
    launchOptions,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tests/serve.js ${port}`,
    url: `http://localhost:${port}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
