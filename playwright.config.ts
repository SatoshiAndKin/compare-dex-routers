import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";

function ciWorkerCount(): number {
  const available = availableParallelism();
  if (process.platform !== "linux") return available;

  // Linux CPU affinity alone does not report the container's cgroup CPU quota.
  try {
    const [quota, period] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    const quotaWorkers = Number(quota) / Number(period);
    if (Number.isFinite(quotaWorkers) && quotaWorkers > 0) {
      return Math.min(available, Math.ceil(quotaWorkers));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return available;
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.fork.spec.ts",
  fullyParallel: false,
  workers: process.env.CI ? ciWorkerCount() : 1,
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
    // Use the bundled full Chromium browser for both headed and headless tests.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
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
