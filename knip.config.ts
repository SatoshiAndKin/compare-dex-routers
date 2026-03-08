import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      project: ["src/**/*.ts"],
    },
    "packages/api": {
      project: ["src/**/*.ts"],
    },
    "packages/frontend": {
      project: ["src/**/*.ts", "src/**/*.svelte"],
    },
  },
  ignoreDependencies: ["pino-pretty"],
  ignoreExportsUsedInFile: true,
};

export default config;
