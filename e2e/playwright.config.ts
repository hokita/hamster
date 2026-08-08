import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  reporter: [['html', { open: 'never' }]],
  webServer: [
    {
      command: `${path.resolve(__dirname, 'node_modules/.bin/firebase')} emulators:start --project demo-hamster-e2e --only auth,firestore`,
      cwd: path.resolve(__dirname, '..'),
      port: 8081,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run start:e2e',
      cwd: path.resolve(__dirname, '../backend'),
      port: 8090,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:e2e',
      cwd: path.resolve(__dirname, '../frontend'),
      port: 5174,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
