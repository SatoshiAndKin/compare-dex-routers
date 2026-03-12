/**
 * Tests for env.ts — the .env file parser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const _dirname = dirname(fileURLToPath(import.meta.url));

describe("env.ts", () => {
  // Match the path env.ts resolves: __tests__/ -> src/ -> api/ -> packages/ -> root
  const envPath = resolve(_dirname, "../../../../.env");
  let hadExistingEnv = false;
  let existingContent = "";

  beforeEach(() => {
    vi.resetModules();
    hadExistingEnv = existsSync(envPath);
    if (hadExistingEnv) {
      existingContent = readFileSync(envPath, "utf-8");
    }
  });

  afterEach(() => {
    if (hadExistingEnv) {
      writeFileSync(envPath, existingContent, "utf-8");
    } else if (existsSync(envPath)) {
      unlinkSync(envPath);
    }
    delete process.env.ENV_TEST_A;
    delete process.env.ENV_TEST_B;
    delete process.env.ENV_TEST_C;
    delete process.env.ENV_TEST_D;
    delete process.env.ENV_TEST_VALID;
    delete process.env.ENV_TEST_EXISTING;
  });

  it("parses .env file and sets variables not already in process.env", async () => {
    writeFileSync(
      envPath,
      "ENV_TEST_A=hello\nENV_TEST_B=\"quoted\"\nENV_TEST_C='single'\n# comment\nENV_TEST_D=with spaces\n"
    );

    delete process.env.ENV_TEST_A;
    delete process.env.ENV_TEST_B;
    delete process.env.ENV_TEST_C;
    delete process.env.ENV_TEST_D;

    await import("../env.js");

    expect(process.env.ENV_TEST_A).toBe("hello");
    expect(process.env.ENV_TEST_B).toBe("quoted");
    expect(process.env.ENV_TEST_C).toBe("single");
    expect(process.env.ENV_TEST_D).toBe("with spaces");
  });

  it("does not overwrite existing environment variables", async () => {
    writeFileSync(envPath, "ENV_TEST_EXISTING=fromfile\n");
    process.env.ENV_TEST_EXISTING = "original";

    await import("../env.js");

    expect(process.env.ENV_TEST_EXISTING).toBe("original");
  });

  it("skips blank lines and lines without =", async () => {
    writeFileSync(envPath, "\n\nNO_EQUALS\n\nENV_TEST_VALID=yes\n");
    delete process.env.ENV_TEST_VALID;

    await import("../env.js");

    expect(process.env.ENV_TEST_VALID).toBe("yes");
    expect(process.env.NO_EQUALS).toBeUndefined();
  });
});
