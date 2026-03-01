import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const makeAddress = (char: string) => `0x${char.repeat(40)}`;
const ADDR_FROM = makeAddress("1");
const ADDR_TO = makeAddress("2");
const ADDR_ROUTER = makeAddress("3");
const ADDR_APPROVAL_TOKEN = makeAddress("4");
const ADDR_APPROVAL_SPENDER = makeAddress("5");
const ADDR_SENDER = makeAddress("6");
const FALLBACK_ACCOUNT = `0x${"Ee7aE85f2Fe2239E27D9c1E2" + "3fFFe168D63b4055"}`;

const getQuoteMock = vi.fn();
const getTokenDecimalsMock = vi.fn();
const getTokenSymbolMock = vi.fn();
const getGasPriceMock = vi.fn();
const getClientMock = vi.fn();
const findCurveQuoteMock = vi.fn();
const isCurveSupportedMock = vi.fn();

const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();

const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

let compareEndpointEnabled = true;
let metricsEndpointEnabled = true;
let curveEnabled = true;

vi.mock("@spandex/core", () => ({
  getQuote: getQuoteMock,
  serializeWithBigInt: (data: unknown) =>
    JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
}));

vi.mock("../config.js", () => ({
  getSpandexConfig: vi.fn(() => ({ mocked: true })),
  getTokenDecimals: getTokenDecimalsMock,
  getTokenSymbol: getTokenSymbolMock,
  getClient: getClientMock,
  SUPPORTED_CHAINS: {
    1: { name: "Ethereum", alchemySubdomain: "eth-mainnet" },
    8453: { name: "Base", alchemySubdomain: "base-mainnet" },
  },
  DEFAULT_TOKENS: {
    1: { from: ADDR_FROM, to: ADDR_TO },
    8453: { from: ADDR_FROM, to: ADDR_TO },
  },
}));

vi.mock("../curve.js", () => ({
  initCurve: vi.fn(),
  findCurveQuote: findCurveQuoteMock,
  isCurveSupported: isCurveSupportedMock,
}));

vi.mock("../feature-flags.js", () => ({
  isEnabled: (flag: string) => {
    if (flag === "compare_endpoint") return compareEndpointEnabled;
    if (flag === "metrics_endpoint") return metricsEndpointEnabled;
    if (flag === "curve_enabled") return curveEnabled;
    return true;
  },
  getAllFlags: () => ({
    curve_enabled: curveEnabled,
    compare_endpoint: compareEndpointEnabled,
    metrics_endpoint: metricsEndpointEnabled,
  }),
}));

vi.mock("../logger.js", () => ({
  logger: loggerMock,
}));

vi.mock("../sentry.js", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

function makeQuote(overrides?: {
  outputAmount?: bigint;
  gasUsed?: bigint;
  provider?: string;
  txValue?: bigint;
  approval?: boolean;
}) {
  const outputAmount = overrides?.outputAmount ?? 2_500_000_000_000_000_000n;
  const gasUsed = overrides?.gasUsed ?? 21000n;
  const provider = overrides?.provider ?? "fabric";
  const txValue = overrides?.txValue;
  const withApproval = overrides?.approval ?? true;

  return {
    simulation: {
      outputAmount,
      gasUsed,
    },
    inputAmount: 1_000_000n,
    provider,
    txData: {
      to: ADDR_ROUTER,
      data: "0xdeadbeef",
      ...(txValue !== undefined ? { value: txValue } : {}),
    },
    ...(withApproval
      ? {
          approval: {
            token: ADDR_APPROVAL_TOKEN,
            spender: ADDR_APPROVAL_SPENDER,
          },
        }
      : {}),
  };
}

function makeCurveQuote(overrides?: {
  output?: string;
  gas?: string;
  approvalTarget?: string;
  approvalCalldata?: string;
}) {
  const quote = {
    source: "curve",
    from: ADDR_FROM,
    from_symbol: "USDC",
    to: ADDR_TO,
    to_symbol: "WETH",
    amount: "1",
    output_amount: overrides?.output ?? "2.0",
    route: [],
    route_symbols: {},
    router_address: makeAddress("7"),
    router_calldata: "0xbeef",
    gas_used: overrides?.gas ?? "30000",
  };

  if (overrides?.approvalTarget) {
    return {
      ...quote,
      approval_target: overrides.approvalTarget,
      approval_calldata: overrides.approvalCalldata ?? "0xcafe",
    };
  }

  return quote;
}

function request(
  url: string
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      })
      .on("error", reject);
  });
}

describe("server /quote and /compare", () => {
  const originalEnv = { ...process.env };
  let server: http.Server;
  let baseUrl = "";

  beforeEach(async () => {
    process.env = { ...originalEnv, ALCHEMY_API_KEY: "test-key" };
    compareEndpointEnabled = true;
    metricsEndpointEnabled = true;
    curveEnabled = true;

    vi.resetModules();
    vi.clearAllMocks();

    getTokenDecimalsMock.mockImplementation(async (_chainId: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? 6 : 18
    );
    getTokenSymbolMock.mockImplementation(async (_chainId: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "USDC" : "WETH"
    );
    getGasPriceMock.mockResolvedValue(1_000_000_000n);
    getClientMock.mockReturnValue({
      getGasPrice: getGasPriceMock,
    });
    isCurveSupportedMock.mockReturnValue(true);

    const { handleRequest } = await import("../server.js");

    server = http.createServer((req, res) => {
      void handleRequest(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address && typeof address === "object") {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterEach(async () => {
    process.env = originalEnv;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /quote returns successful quote with approval and router value", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ txValue: 123n, provider: "fabric" }));

    const res = await request(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);

    expect(body).toMatchObject({
      chainId: 1,
      from: ADDR_FROM,
      to: ADDR_TO,
      provider: "fabric",
      slippage_bps: 50,
      router_address: ADDR_ROUTER,
      router_calldata: "0xdeadbeef",
      router_value: "123",
      approval_token: ADDR_APPROVAL_TOKEN,
      approval_spender: ADDR_APPROVAL_SPENDER,
      from_symbol: "USDC",
      to_symbol: "WETH",
    });
    expect(getQuoteMock).toHaveBeenCalledTimes(1);
  });

  it("GET /quote prefers sender quote and falls back when sender quote is null", async () => {
    getQuoteMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeQuote({ provider: "fallback" }));

    const res = await request(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&sender=${ADDR_SENDER}`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.provider).toBe("fallback");

    expect(getQuoteMock).toHaveBeenCalledTimes(2);
    const firstCall = getQuoteMock.mock.calls[0]?.[0];
    const secondCall = getQuoteMock.mock.calls[1]?.[0];
    expect(firstCall.swap.swapperAccount).toBe(ADDR_SENDER);
    expect(secondCall.swap.swapperAccount).toBe(FALLBACK_ACCOUNT);
  });

  it("GET /quote returns 500 when all quote sources fail", async () => {
    getQuoteMock.mockResolvedValue(null);

    const res = await request(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toContain("No providers returned a successful quote");
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("GET /quote returns 400 for invalid params", async () => {
    const res = await request(`${baseUrl}/quote?chainId=1&from=USDC&to=${ADDR_TO}&amount=1`);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Invalid 'from' address");
  });

  it("GET /compare recommends curve when curve output is better", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_reason).toContain("Curve outputs");
    expect(body.gas_price_gwei).toBe("1.0000");
  });

  it("GET /compare includes Curve approval fields when provided", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ outputAmount: 1_000_000_000_000_000_000n }));
    findCurveQuoteMock.mockResolvedValue(
      makeCurveQuote({
        output: "2.5",
        approvalTarget: ADDR_APPROVAL_SPENDER,
        approvalCalldata: "0xfeed",
      })
    );

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.curve).toMatchObject({
      approval_target: ADDR_APPROVAL_SPENDER,
      approval_calldata: "0xfeed",
    });
  });

  it("GET /compare handles single-source and no-source outcomes", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ outputAmount: 3_000_000_000_000_000_000n }));
    findCurveQuoteMock.mockRejectedValue(new Error("curve down"));

    const spandexOnly = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(spandexOnly.status).toBe(200);
    expect(JSON.parse(spandexOnly.body).recommendation_reason).toContain(
      "Only Spandex returned a quote"
    );

    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "1.1" }));

    const curveOnly = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(curveOnly.status).toBe(200);
    expect(JSON.parse(curveOnly.body).recommendation_reason).toContain(
      "Only Curve returned a quote"
    );

    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    findCurveQuoteMock.mockRejectedValue(new Error("curve down"));

    const none = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(none.status).toBe(200);
    const noneBody = JSON.parse(none.body);
    expect(noneBody.recommendation).toBeNull();
    expect(noneBody.recommendation_reason).toContain("Neither source returned a quote");
  });

  it("GET /compare honors compare endpoint flag and validates params", async () => {
    const invalid = await request(`${baseUrl}/compare?chainId=1&from=bad&to=${ADDR_TO}&amount=1`);
    expect(invalid.status).toBe(400);

    compareEndpointEnabled = false;
    const disabled = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(disabled.status).toBe(404);
  });

  it("GET /metrics, /analytics, and /errors remain available", async () => {
    getQuoteMock.mockResolvedValue(makeQuote());
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote());

    await request(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    const metrics = await request(`${baseUrl}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toContain("spandex_requests_total");

    const analytics = await request(`${baseUrl}/analytics`);
    expect(analytics.status).toBe(200);
    expect(JSON.parse(analytics.body).totalQuotes).toBeGreaterThanOrEqual(1);

    const errors = await request(`${baseUrl}/errors`);
    expect(errors.status).toBe(200);
    expect(JSON.parse(errors.body)).toMatchObject({
      patterns: expect.any(Array),
      totalPatterns: expect.any(Number),
      recurringPatterns: expect.any(Number),
    });
  });

  it("GET /metrics respects feature flag", async () => {
    metricsEndpointEnabled = false;

    const metrics = await request(`${baseUrl}/metrics`);
    expect(metrics.status).toBe(404);
    expect(JSON.parse(metrics.body).error).toBe("Not found");
  });
});
