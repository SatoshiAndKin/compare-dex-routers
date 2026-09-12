import "../packages/api/src/env.js";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { redactText } from "../packages/api/src/redaction.js";

const children: ChildProcess[] = [];
const env = { ...process.env };
const manifest: { chainId: number; blockNumber: string; blockHash: string; anvil: string }[] = [];
const version = execFileSync("anvil", ["--version"], { encoding: "utf8" }).trim();

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate fork port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function startFork(chainId: number, url: string) {
  const upstream = createPublicClient({ transport: http(url, { timeout: 20_000, retryCount: 0 }) });
  if ((await upstream.getChainId()) !== chainId)
    throw new Error(`Wrong upstream chain for ${chainId}`);
  const pinned = process.env[`FORK_BLOCK_${chainId}`];
  const block = await upstream.getBlock(
    pinned ? { blockNumber: BigInt(pinned) } : { blockTag: "latest" }
  );
  const localPort = await port();
  const child = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(localPort),
      "--chain-id",
      String(chainId),
      "--fork-url",
      url,
      "--fork-block-number",
      String(block.number),
      "--silent",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  children.push(child);
  let startupError: Error | undefined;
  child.on("error", (error) => {
    startupError = error;
  });
  child.stderr?.on("data", (data: Buffer) => process.stderr.write(redactText(data.toString())));
  const local = `http://127.0.0.1:${localPort}`;
  const client = createPublicClient({ transport: http(local, { retryCount: 0, timeout: 1_000 }) });
  const deadline = Date.now() + 30_000;
  while (true) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Anvil exited for chain ${chainId}`);
    try {
      if ((await client.getChainId()) === chainId) break;
    } catch {
      /* Wait for the new listener. */
    }
    if (Date.now() >= deadline) throw new Error(`Anvil startup timed out for chain ${chainId}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  env[`RPC_URL_${chainId}`] = local;
  env[`FORK_TEST_RPC_${chainId}`] = local;
  manifest.push({
    chainId,
    blockNumber: String(block.number),
    blockHash: block.hash,
    anvil: version,
  });
  console.log(`Fork ${chainId} pinned at block ${block.number} (${block.hash})`);
}

async function stopChildren() {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(deadline);
      }
    })
  );
}

try {
  const base =
    process.env.FORK_RPC_URL_8453 ||
    process.env.RPC_URL_8453 ||
    (process.env.ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : "");
  if (!base) throw new Error("Set ALCHEMY_API_KEY or FORK_RPC_URL_8453 for Base fork tests");
  await startFork(
    1,
    process.env.FORK_RPC_URL_1 || "https://ski-lambo-1.shorthair-fir.ts.net:18544"
  );
  await startFork(8453, base);
  execFileSync("pnpm", ["--filter", "@compare-dex/frontend", "build"], { stdio: "inherit", env });
  const runner = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.fork.config.ts",
      ...process.argv.slice(2).filter((arg) => arg !== "--"),
    ],
    { stdio: "inherit", env }
  );
  children.push(runner);
  process.exitCode = await new Promise<number>((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(redactText(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await stopChildren();
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/fork-manifest.json", JSON.stringify(manifest, null, 2));
}
