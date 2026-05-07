// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,        // 1 min per test
  retries: 1,            // Retry once on failure (network flakiness)
  reporter: [['list'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'https://gurudas-sda.github.io/ca-link-finder/',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
