import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { browserPackageInventory } from "./browser-package-inventory.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../../", import.meta.url)), "PORT");
  const port = process.env.PORT || env.PORT || "3100";
  const inventory = process.env.CDR_BROWSER_PACKAGE_INVENTORY;
  const telemetry = loadEnv(
    mode,
    fileURLToPath(new URL("../../", import.meta.url)),
    "VITE_SENTRY_"
  );
  const dsn = process.env.VITE_SENTRY_DSN || telemetry.VITE_SENTRY_DSN;
  const release = process.env.VITE_SENTRY_RELEASE || telemetry.VITE_SENTRY_RELEASE;
  if (dsn && (URL.parse(dsn)?.protocol !== "https:" || !/^[a-f0-9]{40}$/.test(release || ""))) {
    throw new Error(
      "Browser Sentry requires an HTTPS DSN and a full VITE_SENTRY_RELEASE commit hash"
    );
  }
  return {
    envDir: fileURLToPath(new URL("../../", import.meta.url)),
    plugins: [svelte(), inventory ? browserPackageInventory(inventory) : false],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ""),
        },
      },
    },
  };
});
