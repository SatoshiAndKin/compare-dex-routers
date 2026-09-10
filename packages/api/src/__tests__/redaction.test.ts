import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redact, redactText } from "../redaction.js";
const pinoMock = vi.hoisted(() => ({
  options: undefined as
    | undefined
    | { hooks: { logMethod(args: unknown[], method: (...args: unknown[]) => void): void } },
}));
vi.mock("pino", () => ({
  default: (options: typeof pinoMock.options) => {
    pinoMock.options = options;
    return {};
  },
}));
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/node", () => sentry);
const HASH = `0x${"a".repeat(64)}`;
const ADDRESS = `0x${"b".repeat(40)}`;
const message = `RPC https://rpc-user:rpc-password@rpc.example/v2/path-secret?apiKey=query-secret authorization: Bearer bearer-secret API_KEY=inline-secret ${HASH} ${ADDRESS}`;
function safe(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [
    "rpc-user",
    "rpc-password",
    "path-secret",
    "query-secret",
    "bearer-secret",
    "inline-secret",
    "environment-secret",
  ])
    expect(text).not.toContain(secret);
  return text;
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("ALCHEMY_API_KEY", "environment-secret");
});
afterEach(() => vi.unstubAllEnvs());
describe("credential removal before reporting", () => {
  it("redacts URL credentials, RPC paths, query keys, bearer tokens and configured secrets", () => {
    const text = safe(redactText(`${message} environment-secret`));
    expect(text).toContain(HASH);
    expect(text).toContain(ADDRESS);
  });
  it("handles nested errors, headers, cycles, and non-enumerable Error fields", () => {
    const error = new Error(message, { cause: new Error("environment-secret") });
    const nested: Record<string, unknown> = {
      error,
      headers: { authorization: "hidden", "x-api-key": "hidden" },
      txHash: HASH,
    };
    nested.self = nested;
    const output = redact(nested);
    const text = safe(output);
    expect(text).not.toContain("hidden");
    expect(text).toContain("[Circular]");
    expect(text).toContain(HASH);
  });
  it("scrubs pino log arguments before invoking the output method", async () => {
    await import("../logger.js");
    const output = vi.fn();
    pinoMock.options?.hooks.logMethod([{ err: new Error(message), txHash: HASH }, message], output);
    expect(output).toHaveBeenCalledTimes(1);
    expect(safe(output.mock.calls)).toContain(HASH);
  });
  it("stores scrubbed error messages and contexts before /errors reads them", async () => {
    const { trackError, getErrorInsights } = await import("../error-insights.js");
    trackError(new Error(message), `context ${message}`);
    expect(safe(getErrorInsights())).toContain(HASH);
  });
  it("scrubs Sentry exceptions, contexts, messages and automatic events", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    const tracker = await import("../sentry.js");
    tracker.captureException(new Error(message), { endpoint: message });
    tracker.captureMessage(message);
    safe(sentry.captureException.mock.calls);
    safe(sentry.captureMessage.mock.calls);
    const options = sentry.init.mock.calls[0]?.[0];
    const event = {
      exception: { values: [{ value: message }] },
      request: { headers: { authorization: "hidden" }, url: message },
    };
    safe(options.beforeSend(event));
    safe(options.beforeSendTransaction(event));
  });
});
