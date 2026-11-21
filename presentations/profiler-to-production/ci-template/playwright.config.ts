import { defineConfig } from '@playwright/test'

const port = Number(process.env.PORT ?? 4361)
export default defineConfig({
  testDir: 'web',
  retries: 0, // a behaviour check must not need retries
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.CI ? undefined : 'chrome' },
  webServer: { command: 'node web/server.mjs', url: `http://127.0.0.1:${port}/client.js`, reuseExistingServer: false, env: { SCRIPT: process.env.SCRIPT ?? 'async', PORT: String(port) } },
})
