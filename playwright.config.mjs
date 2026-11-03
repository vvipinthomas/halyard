import { defineConfig, devices } from '@playwright/test';
const PORT = Number(process.env.E2E_PORT) || 8790;
const chrome = process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {};
export default defineConfig({
  testDir: 'tests/e2e', timeout: 60_000, fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...chrome },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], ...chrome } }, { name: 'mobile', use: { ...devices['Pixel 7'], ...chrome } }],
  webServer: {
    command: 'node src/node.js', url: `http://localhost:${PORT}/api/health`, reuseExistingServer: false, timeout: 30_000,
    env: { PORT: String(PORT), DATABASE_PATH: ':memory:', ENCRYPTION_KEY: Buffer.from('e2e-test-key-not-for-production!').toString('base64'), PBKDF2_ITERATIONS: '20000', LOGIN_RATE_PER_15MIN: '1000', FACTORY_TICK_SECONDS: '0' },
  },
});
