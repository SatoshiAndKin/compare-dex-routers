import { mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenlistFiles } from "../tokenlists.js";

const token = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
};
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cdr-tokenlists-"));
  path = join(directory, "list.json");
  vi.stubEnv("DEFAULT_TOKENLISTS", path);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("token-list file refresh", () => {
  it("notices replacement without changing the configured path", async () => {
    const files = new TokenlistFiles();
    await writeFile(path, JSON.stringify({ name: "First", tokens: [token] }));
    expect(await files.load()).toEqual([{ name: "First", tokens: [token] }]);
    const replacement = join(directory, "replacement.json");
    await writeFile(
      replacement,
      JSON.stringify({ name: "Second", tokens: [{ ...token, symbol: "UPDATED" }] })
    );
    await rename(replacement, path);
    expect(await files.load()).toEqual([
      { name: "Second", tokens: [{ ...token, symbol: "UPDATED" }] },
    ]);
  });

  it("retains last valid data through malformed JSON, invalid tokens, and deletion, then recovers", async () => {
    const files = new TokenlistFiles();
    await writeFile(path, JSON.stringify({ name: "Good", tokens: [token] }));
    await files.load();
    for (const text of ["{", JSON.stringify({ tokens: [{ ...token, decimals: -1 }] })]) {
      await writeFile(path, text);
      expect(await files.load()).toEqual([
        { name: "Good", tokens: [token], error: "Refresh failed. Showing the last valid list." },
      ]);
    }
    await rm(path);
    expect((await files.load())[0]?.tokens).toEqual([token]);
    await writeFile(path, JSON.stringify({ name: "Recovered", tokens: [] }));
    expect(await files.load()).toEqual([{ name: "Recovered", tokens: [] }]);
  });

  it("shares concurrent loads and removes files no longer configured", async () => {
    const files = new TokenlistFiles();
    await writeFile(path, JSON.stringify({ name: "One", tokens: [token] }));
    const [first, second] = await Promise.all([files.load(), files.load()]);
    expect(first[0]).toBe(second[0]);
    const next = join(directory, "next.json");
    await writeFile(next, JSON.stringify({ name: "Two", tokens: [] }));
    vi.stubEnv("DEFAULT_TOKENLISTS", next);
    expect(await files.load()).toEqual([{ name: "Two", tokens: [] }]);
  });
});
