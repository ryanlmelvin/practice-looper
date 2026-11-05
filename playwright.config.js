import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317/practice-looper/',
    headless: true,
    launchOptions: existsSync(chrome) ? { executablePath:chrome } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: { command:'npm start',url:'http://127.0.0.1:4317/practice-looper/',reuseExistingServer:true,timeout:10000 }
});
