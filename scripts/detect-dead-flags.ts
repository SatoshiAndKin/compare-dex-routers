#!/usr/bin/env tsx
/**
 * Detects feature flags that may be dead (always enabled or never referenced outside feature-flags.ts).
 * Run: npx tsx scripts/detect-dead-flags.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = join(import.meta.dirname, "..", "packages", "api", "src");
const FLAG_FILE = "feature-flags.ts";

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts") && !full.includes("__tests__")) {
      files.push(full);
    }
  }
  return files;
}

const flagFileContent = readFileSync(join(SRC_DIR, FLAG_FILE), "utf-8");

// Extract flag names from the type definition
const flagTypeMatch = flagFileContent.match(/type FeatureFlag\s*=\s*([^;]+)/);
if (!flagTypeMatch) {
  console.error("Could not parse FeatureFlag type");
  process.exit(1);
}

const flags = flagTypeMatch[1]
  .split("|")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean);

console.log(`Found ${flags.length} feature flags: ${flags.join(", ")}\n`);

const sourceFiles = collectTsFiles(SRC_DIR).filter(
  (f) => !f.endsWith(FLAG_FILE),
);

let deadCount = 0;

for (const flag of flags) {
  const references: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    if (content.includes(`"${flag}"`) || content.includes(`'${flag}'`)) {
      references.push(relative(SRC_DIR, file));
    }
  }

  if (references.length === 0) {
    console.log(`DEAD FLAG: "${flag}" - not referenced outside ${FLAG_FILE}`);
    deadCount++;
  } else {
    console.log(`OK: "${flag}" - used in: ${references.join(", ")}`);
  }
}

console.log(
  `\n${deadCount === 0 ? "No dead flags found." : `${deadCount} dead flag(s) detected!`}`,
);
process.exit(deadCount > 0 ? 1 : 0);
