import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";

// Public offline fixtures. The private key belongs only to this loopback collector.
const fixture = (name: string) =>
  new URL(`./fixtures/sentry-localhost-${name}.pem`, import.meta.url);

it.each(["stalled headers", "stalled body", "HTTP redirect", "untrusted certificate"])(
  "the actual SDK enforces bounded verified HTTPS with %s",
  async (scenario) => {
    let plaintextRequests = 0;
    const plaintext = createHttpServer((_request, response) => {
      plaintextRequests += 1;
      response.end();
    });
    await new Promise<void>((resolve) => plaintext.listen(0, "127.0.0.1", resolve));
    const plaintextPort = (plaintext.address() as AddressInfo).port;
    const sockets = new Set<Socket>();
    let envelopes = 0;
    let authenticated = false;
    const observed = Promise.withResolvers<undefined>();
    const collector = createHttpsServer(
      { key: readFileSync(fixture("key")), cert: readFileSync(fixture("cert")) },
      (request, response) => {
        authenticated =
          typeof request.headers["x-sentry-auth"] === "string" ||
          new URL(request.url ?? "", "https://localhost").searchParams.get("sentry_key") ===
            "public";
        request.resume();
        request.on("end", () => {
          envelopes += 1;
          observed.resolve(undefined);
          if (scenario === "HTTP redirect") {
            response.writeHead(307, { Location: `http://127.0.0.1:${plaintextPort}/leak` });
            response.end();
          } else if (scenario === "stalled body") {
            response.writeHead(200, { "Content-Length": "100000" });
            response.write("unfinished");
          }
        });
      }
    );
    collector.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    collector.on("tlsClientError", () => observed.resolve(undefined));
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const port = (collector.address() as AddressInfo).port;
    const moduleUrl = new URL("../sentry-transport.ts", import.meta.url).href;
    const caPath = fixture("ca").pathname;
    const source = `
      import * as Sentry from '@sentry/node';
      import {readFileSync} from 'node:fs';
      import {createSentryTransport} from ${JSON.stringify(moduleUrl)};
      Sentry.init({dsn:'https://public@127.0.0.1:${port}/1',defaultIntegrations:false,
        skipOpenTelemetrySetup:true,sendClientReports:false,
        transport:options=>createSentryTransport({...options,
          caCerts:${scenario === "untrusted certificate" ? "undefined" : `readFileSync(${JSON.stringify(caPath)})`}})});
      Sentry.captureMessage('offline native SDK HTTPS fixture');
      await new Promise(resolve => process.once('message', resolve));
      process.disconnect();
      await Sentry.close(3000);
      console.log('SDK close returned');
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      {
        env: {
          PATH: process.env.PATH ?? "",
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          SSL_VERIFY: "false",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => (stdout += data.toString()));
    child.stderr?.on("data", (data: Buffer) => (stderr += data.toString()));
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }
    );
    const startupDeadline = setTimeout(() => child.kill("SIGKILL"), 10000);
    let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // First prove an upload reached the collector. Node/tsx/SDK cold startup
      // is outside the shutdown contract, including on the shared CI runner.
      await Promise.race([
        observed.promise,
        exited.then(() => {
          throw new Error(`SDK process exited before collector observation: ${stderr}`);
        }),
      ]);
      clearTimeout(startupDeadline);
      const started = performance.now();
      shutdownDeadline = setTimeout(() => child.kill("SIGKILL"), 6000);
      child.send({ shutdown: true });
      const exit = await exited;
      expect(exit, stderr).toEqual({ code: 0, signal: null });
      expect(stdout).toContain("SDK close returned");
      expect(performance.now() - started).toBeLessThan(4000);
      expect(envelopes).toBe(scenario === "untrusted certificate" ? 0 : 1);
      expect(authenticated).toBe(scenario !== "untrusted certificate");
      expect(plaintextRequests).toBe(0);
    } finally {
      clearTimeout(startupDeadline);
      clearTimeout(shutdownDeadline);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited.catch(() => {});
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => collector.close(() => resolve())),
        new Promise<void>((resolve) => plaintext.close(() => resolve())),
      ]);
    }
  },
  20000
);
