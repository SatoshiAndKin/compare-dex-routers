import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockSentry = {
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
};

vi.mock("../logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("@sentry/node", () => ({
  init: mockSentry.init,
  captureException: mockSentry.captureException,
  captureMessage: mockSentry.captureMessage,
}));

describe("observability modules", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("analytics tracks quote events, computes summary, and enforces max history", async () => {
    const { trackQuote, getAnalyticsSummary } = await import("../analytics.js");

    trackQuote({
      chainId: 8453,
      fromToken: "from-token-alpha",
      toToken: "to-token-beta",
      provider: "fabric",
      durationMs: 120,
      success: true,
      outputAmount: "1.0",
    });
    trackQuote({
      chainId: 1,
      fromToken: "from-token-alpha",
      toToken: "to-token-gamma",
      provider: "curve",
      durationMs: 280,
      success: false,
    });

    const summary = getAnalyticsSummary();
    expect(summary.totalQuotes).toBe(2);
    expect(summary.successRate).toBe(0.5);
    expect(summary.avgDurationMs).toBe(200);
    expect(summary.topChains).toEqual(
      expect.arrayContaining([
        { chainId: 8453, count: 1 },
        { chainId: 1, count: 1 },
      ])
    );
    expect(summary.topPairs[0]?.pair).toContain("from-token");
    expect(mockLogger.debug).toHaveBeenCalled();

    for (let i = 0; i < 10005; i++) {
      trackQuote({
        chainId: 8453,
        fromToken: "from-token-stress",
        toToken: "to-token-stress",
        provider: "stress",
        durationMs: 1,
        success: true,
      });
    }

    const capped = getAnalyticsSummary();
    expect(capped.totalQuotes).toBe(10000);
  });

  it("error insights tracks recurring patterns, unique contexts, and warning threshold", async () => {
    const { trackError, getErrorInsights } = await import("../error-insights.js");

    for (let i = 0; i < 12; i++) {
      trackError(new Error("RPC timeout while quoting"), `quote:context-${i}`);
    }

    const insights = getErrorInsights();
    expect(insights.totalPatterns).toBe(1);
    expect(insights.recurringPatterns).toBe(1);
    expect(insights.patterns[0]?.count).toBe(12);
    expect(insights.patterns[0]?.contexts).toHaveLength(10);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("metrics records totals and emits prometheus text output", async () => {
    const { recordRequest, getMetrics } = await import("../metrics.js");

    recordRequest("/quote", 100, false);
    recordRequest("/quote", 200, true);
    recordRequest("/health", 50, false);

    const metrics = getMetrics();
    expect(metrics).toContain("spandex_requests_total 3");
    expect(metrics).toContain("spandex_errors_total 1");
    expect(metrics).toContain('spandex_request_duration_ms{path="/quote"} 150');
    expect(metrics).toContain('spandex_request_count{path="/quote"} 2');
    expect(metrics).toContain('spandex_request_count{path="/health"} 1');
  });

  it("tracing reuses incoming request id and sets response header", async () => {
    const { getRequestId, setTraceHeaders } = await import("../tracing.js");

    const withRequestId = {
      headers: { "x-request-id": "req-123" },
    } as unknown as http.IncomingMessage;
    expect(getRequestId(withRequestId)).toBe("req-123");

    const withoutRequestId = { headers: {} } as unknown as http.IncomingMessage;
    expect(getRequestId(withoutRequestId)).toMatch(/[0-9a-f-]{36}/i);

    const setHeader = vi.fn();
    const res = { setHeader } as unknown as http.ServerResponse;
    setTraceHeaders(res, "trace-abc");
    expect(setHeader).toHaveBeenCalledWith("x-request-id", "trace-abc");
  });

  it("sentry wrapper is no-op without DSN and active with DSN", async () => {
    delete process.env.SENTRY_DSN;
    const noDsn = await import("../sentry.js");
    noDsn.captureException(new Error("no-op"), { area: "test" });
    noDsn.captureMessage("hello", "warning");
    expect(mockSentry.init).not.toHaveBeenCalled();
    expect(mockSentry.captureException).not.toHaveBeenCalled();
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();

    vi.resetModules();
    vi.clearAllMocks();
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";

    const withDsn = await import("../sentry.js");
    withDsn.captureException(new Error("boom"), { route: "/quote" });
    withDsn.captureMessage("warn", "warning");

    expect(mockSentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: process.env.SENTRY_DSN,
        environment: expect.any(String),
        tracesSampleRate: 0.1,
      })
    );
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { route: "/quote" } })
    );
    expect(mockSentry.captureMessage).toHaveBeenCalledWith("warn", "warning");
  });
});
