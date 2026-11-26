import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { NodeOptions } from "@sentry/node";
import pino from "pino";

type Envelope = Parameters<ReturnType<NonNullable<NodeOptions["transport"]>>["send"]>[0];

type Sdk = typeof import("@sentry/node");
const capture = vi.hoisted(() => ({
  envelopes: [] as Envelope[],
  client: undefined as ReturnType<Sdk["init"]>,
}));
const release = "0123456789abcdef0123456789abcdef01234567";
let sdk: Sdk;
let logger: (typeof import("../logger.js"))["logger"];

// Use the real SDK pipeline with an in-memory transport. No telemetry leaves the test.
vi.mock("@sentry/node", async () => {
  const sdk = await vi.importActual<typeof import("@sentry/node")>("@sentry/node");
  return {
    ...sdk,
    init: (options: Parameters<typeof sdk.init>[0]) => {
      const client = sdk.init({
        ...options,
        tracesSampleRate: 1,
        defaultIntegrations: false,
        integrations: [
          ...(Array.isArray(options?.integrations) ? options.integrations : []),
          sdk.spanStreamingIntegration(),
        ],
        transport: () => ({
          send: async (envelope) => {
            capture.envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      });
      capture.client = client;
      return client;
    },
  };
});

beforeAll(async () => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
  vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SENTRY_RELEASE", release);
  await import("../sentry.js");
  ({ logger } = await import("../logger.js"));
  sdk = await import("@sentry/node");
}, 10_000);

beforeEach(() => {
  capture.envelopes.length = 0;
});

afterAll(async () => {
  try {
    await capture.client?.close(2_000);
  } finally {
    vi.unstubAllEnvs();
  }
}, 10_000);

it("reports only API warnings and errors while scrubbing log and span envelopes", async () => {
  const envelopes = capture.envelopes;
  const txHash = `0x${"a".repeat(64)}`;
  const secretUrl = "https://rpc-user:rpc-password@rpc.example/v2/path-secret?apiKey=query-secret";
  logger.error({ err: new Error(`RPC ${secretUrl}`), txHash }, "Request failed");
  logger.warn({ endpoint: secretUrl }, "Token list refresh failed");
  logger.info("API info stays local");
  pino().error("Untracked logger stays local");
  sdk.startSpan(
    { name: `RPC ${secretUrl}`, attributes: { "http.url": secretUrl, txHash } },
    () => {}
  );
  expect(await sdk.flush(2_000)).toBe(true);

  const items = envelopes.flatMap<Envelope[1][number]>(([, items]) => items);
  const itemTypes = items.map(([header]) => header.type);
  const events = items.filter(([header]) => header.type === "event").map(([, event]) => event);
  expect(events).toHaveLength(2);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ level: "error", release, logger: "pino" }),
      expect.objectContaining({
        level: "warning",
        release,
        logger: "pino",
        message: "Token list refresh failed",
      }),
    ])
  );
  expect(itemTypes).not.toContain("log");
  expect(itemTypes).toContain("span");
  const output = JSON.stringify(envelopes);
  for (const secret of ["rpc-user", "rpc-password", "path-secret", "query-secret"]) {
    expect(output).not.toContain(secret);
  }
  expect(output).toContain(txHash);
});
