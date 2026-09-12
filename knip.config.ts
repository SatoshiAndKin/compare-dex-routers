import type { KnipConfig } from "knip";

const config: KnipConfig = {
  exclude: ["types"],
  ignoreBinaries: ["anvil"], // Foundry is an external tool, not an npm package.
  workspaces: {
    ".": {
      entry: ["e2e/**/*.spec.ts", "playwright*.config.ts"],
      project: ["*.ts", "*.js", "scripts/**/*.ts", "e2e/**/*.ts"],
    },
    "packages/api": {
      entry: ["src/__tests__/**/*.test.ts"],
      project: ["src/**/*.ts"],
      ignoreDependencies: ["pino-pretty"],
      vitest: {
        config: ["vitest.config.ts"],
      },
    },
    "packages/frontend": {
      entry: ["src/__tests__/**/*.test.ts"],
      project: ["src/**/*.{ts,svelte}"],
      svelte: {
        config: ["svelte.config.js"],
      },
      vite: {
        config: ["vite.config.ts"],
      },
      vitest: {
        config: ["vitest.config.ts"],
      },
    },
  },
};

export default config;
