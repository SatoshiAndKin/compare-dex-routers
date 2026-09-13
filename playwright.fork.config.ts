import { defineConfig } from "@playwright/test";
import common from "./playwright.config.js";

export default defineConfig({
  ...common,
  testIgnore: [],
  testMatch: "**/*.fork.spec.ts",
  timeout: 120_000,
  globalTimeout: 10 * 60_000,
  projects: common.projects?.filter((project) => project.name === "desktop"),
});
