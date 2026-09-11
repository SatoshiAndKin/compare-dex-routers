import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../../", import.meta.url)), "PORT");
  const port = process.env.PORT || env.PORT || "3100";
  return {
    plugins: [svelte()],
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
