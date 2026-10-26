import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NodeOptions } from "@sentry/node";

type Envelope = Parameters<ReturnType<NonNullable<NodeOptions["transport"]>>["send"]>[0];

const sent = vi.hoisted(() => [] as Envelope[]);

// Use the real SDK pipeline with an in-memory transport. No telemetry leaves the test.
vi.mock("@sentry/node", async () => {
  const sdk = await vi.importActual<typeof import("@sentry/node")>("@sentry/node");
  return {
    ...sdk,
    init: (options: Parameters<typeof sdk.init>[0]) =>
      sdk.init({
        ...options,
        tracesSampleRate: 1,
        defaultIntegrations: false,
        integrations: [sdk.spanStreamingIntegration()],
        transport: () => ({
          send: async (envelope) => {
            sent.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      }),
  };
});

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
});

afterEach(async () => {
  const sdk = await import("@sentry/node");
  await sdk.close();
  vi.unstubAllEnvs();
});

it("redacts credentials in real Sentry 11 error and streamed span envelopes", async () => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
  const tracker = await import("../sentry.js");
  const sdk = await import("@sentry/node");
  const txHash = `0x${"a".repeat(64)}`;
  const secretUrl = "https://rpc-user:rpc-password@rpc.example/v2/path-secret?apiKey=query-secret";
  tracker.captureException(new Error(`RPC ${secretUrl}`), { txHash });
  sdk.startSpan(
    { name: `RPC ${secretUrl}`, attributes: { "http.url": secretUrl, txHash } },
    () => {}
  );
  expect(await sdk.flush(2_000)).toBe(true);

  const itemTypes = sent.flatMap(([, items]) => items.map(([header]) => header.type));
  expect(itemTypes).toContain("event");
  expect(itemTypes).toContain("span");
  const output = JSON.stringify(sent);
  for (const secret of ["rpc-user", "rpc-password", "path-secret", "query-secret"]) {
    expect(output).not.toContain(secret);
  }
  expect(output).toContain(txHash);
});
