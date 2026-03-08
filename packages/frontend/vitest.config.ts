import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: !process.env["VITEST"] })],
  resolve: {
    conditions: ["browser"],
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
    globals: true,
    pool: "threads",
    isolate: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
