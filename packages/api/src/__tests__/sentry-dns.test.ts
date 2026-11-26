import { Resolver } from "node:dns/promises";
import { createSocket, type Socket } from "node:dgram";
import { spawn } from "node:child_process";
import type { LookupAddress } from "node:dns";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { boundedLookup } from "../sentry-transport.js";

async function fixture(answers: readonly number[]): Promise<{
  socket: Socket;
  resolver: Resolver;
  questions: Set<number>;
  port: number;
}> {
  const socket = createSocket("udp4");
  const questions = new Set<number>();
  socket.on("message", (query, peer) => {
    const family = query.readUInt16BE(query.length - 4);
    questions.add(family);
    if (!answers.includes(family)) return;
    const address =
      family === 1
        ? Buffer.from([127, 0, 0, 1])
        : Buffer.from("00000000000000000000000000000001", "hex");
    const header = Buffer.from(query.subarray(0, 12));
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 6);
    const answer = Buffer.alloc(12);
    answer.writeUInt16BE(0xc00c);
    answer.writeUInt16BE(family, 2);
    answer.writeUInt16BE(1, 4);
    answer.writeUInt32BE(1, 6);
    answer.writeUInt16BE(address.length, 10);
    socket.send(
      Buffer.concat([header, query.subarray(12), answer, address]),
      peer.port,
      peer.address
    );
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  const resolver = new Resolver({ timeout: 1_000, tries: 1 });
  resolver.setServers([`127.0.0.1:${port}`]);
  return { socket, resolver, questions, port };
}

it.each([
  { answers: [1], families: [4] },
  { answers: [28], families: [6] },
  { answers: [1, 28], families: [4, 6] },
])(
  "keeps usable DNS families $families inside the HTTP deadline",
  async ({ answers, families }) => {
    const { socket, resolver, questions } = await fixture(answers);
    try {
      const started = performance.now();
      const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
        boundedLookup(AbortSignal.timeout(2_000), resolver)(
          "collector.fixture",
          { all: true },
          (error, address) => {
            if (error) reject(error);
            else resolve(address as LookupAddress[]);
          }
        )
      );
      expect(performance.now() - started).toBeLessThan(1_500);
      expect(addresses.map((address) => address.family).sort()).toEqual(families);
      expect([...questions].sort((a, b) => a - b)).toEqual([1, 28]);
    } finally {
      resolver.cancel();
      await new Promise<void>((resolve) => socket.close(resolve));
    }
  }
);

it("the actual SDK process exits when neither DNS family answers", async () => {
  const { socket, resolver, questions, port } = await fixture([]);
  const moduleUrl = new URL("../sentry-transport.ts", import.meta.url).href;
  const source = `
    import * as Sentry from '@sentry/node';
    import { Resolver } from 'node:dns/promises';
    import { boundedLookup, createSentryTransport } from ${JSON.stringify(moduleUrl)};
    const resolver=new Resolver({timeout:1000,tries:1});
    resolver.setServers(['127.0.0.1:${port}']);
    Sentry.init({dsn:'https://public@collector.fixture/1',defaultIntegrations:false,
      skipOpenTelemetrySetup:true,sendClientReports:false,
      transport:options=>createSentryTransport(options,signal=>boundedLookup(signal,resolver))});
    Sentry.captureMessage('offline native SDK DNS fixture');
    await Sentry.close(100);
    console.log('SDK close returned');
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    env: { PATH: process.env.PATH ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
  child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
  const deadline = setTimeout(() => child.kill("SIGKILL"), 6_000);
  try {
    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }
    );
    expect(exit, stderr).toEqual({ code: 0, signal: null });
    expect(stdout).toContain("SDK close returned");
    expect([...questions].sort((a, b) => a - b)).toEqual([1, 28]);
  } finally {
    clearTimeout(deadline);
    resolver.cancel();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise<void>((resolve) => socket.close(resolve));
  }
}, 10_000);
