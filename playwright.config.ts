import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.fork.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5180",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" } },
  ],
  webServer: [
    {
      command: "node --import tsx src/server.ts",
      cwd: "packages/api",
      env: { PORT: "3120", HOST: "127.0.0.1", NODE_ENV: "production" },
      url: "http://127.0.0.1:3120/health",
      timeout: 30_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 35_000 },
    },
    {
      command:
        "pnpm --filter @compare-dex/frontend exec vite preview --host 127.0.0.1 --port 5180 --strictPort",
      env: { PORT: "3120" },
      url: "http://127.0.0.1:5180",
      timeout: 30_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
