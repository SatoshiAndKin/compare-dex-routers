import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const packageRoot = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//;

export function browserPackageInventory(output: string): Plugin {
  return {
    name: "browser-package-inventory",
    apply: "build",
    writeBundle({ dir }, bundle) {
      if (!dir) this.error("Browser package inventory requires an output directory");
      const chunks = new Set(
        Object.values(bundle)
          .filter((item) => item.type === "chunk")
          .map(({ fileName }) => fileName)
      );
      for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
        if (/\.(?:[cm]?js|wasm)$/i.test(file) && !chunks.has(file)) {
          this.error(`Cannot inventory browser executable asset ${file}`);
        }
      }

      const packages = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        for (const dependency of [...item.imports, ...item.dynamicImports]) {
          if (!chunks.has(dependency)) this.error(`Cannot inventory browser import ${dependency}`);
        }

        for (const id of item.moduleIds) {
          const match = packageRoot.exec(id.replace(/^\0/, ""));
          if (!match) continue;
          const [, root, pathName] = match;
          const manifest = join(root, "package.json");
          // Published packages can preserve dependency directories without their manifests.
          if (!existsSync(manifest)) {
            packages.add(`${pathName}@*`);
            continue;
          }
          const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
          if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
            this.error(`Missing package identity for browser module ${id}`);
          }
          packages.add(`${name}@${version}`);
        }
      }
      if (!packages.size) this.error("Browser package inventory is empty");
      writeFileSync(output, JSON.stringify([...packages].sort()));
    },
  };
}
