import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the generated spec from the API package
const { openapiDocument } = await import("../packages/api/src/openapi.js");

const specPath = resolve(__dirname, "../packages/api/openapi.json");
const typesPath = resolve(__dirname, "../packages/frontend/src/generated/api-types.d.ts");

writeFileSync(specPath, JSON.stringify(openapiDocument, null, 2));
console.log(`Wrote OpenAPI spec to ${specPath}`);

execSync(`npx openapi-typescript ${specPath} -o ${typesPath}`, {
  cwd: resolve(__dirname, "../packages/frontend"),
  stdio: "inherit",
});

console.log(`Generated types at ${typesPath}`);
