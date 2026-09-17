import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './ui-tests/tests',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'work/browser-results.json' }]
  ],
  use: {
    viewport: { width: 1280, height: 850 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /@compat/
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@compat/
    }
  ],
  webServer: [
    {
      command:
        (process.env.FORTITUDO_LOCAL_COMMAND ?? 'python -m fortitudo') +
        ' --no-browser --port 8767',
      url: 'http://127.0.0.1:8767/',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'python ui-tests/server.py',
      url: 'http://127.0.0.1:8765/dist/standalone/',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'jupyter lab --config=ui-tests/jupyter_server_test_config.py',
      env: {
        JUPYTER_CONFIG_DIR: resolve(import.meta.dirname, 'work/jupyter-config'),
        JUPYTER_RUNTIME_DIR: resolve(import.meta.dirname, '.cache/jupyter')
      },
      url: 'http://127.0.0.1:8766/fortitudo/lab',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
