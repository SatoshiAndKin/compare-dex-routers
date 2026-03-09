import type { KnipConfig } from "knip";

const config: KnipConfig = {
  exclude: ["types"],
  workspaces: {
    ".": {
      project: ["*.ts", "*.js"],
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
