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
const getQuotesMock = vi.fn().mockResolvedValue([]);
const getTokenDecimalsMock = vi.fn();
const getTokenSymbolMock = vi.fn();
const getGasPriceMock = vi.fn();
const getBlockNumberMock = vi.fn();
const getClientMock = vi.fn();

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
  getQuotes: getQuotesMock,
  getQuotesMock,
  serializeWithBigInt: (data: unknown) =>
    JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
}));

vi.mock("../config.js", () => ({
  getSpandexConfig: vi.fn(() => ({ mocked: true, clientLookup: vi.fn().mockReturnValue({}) })),
  getTokenDecimals: getTokenDecimalsMock,
  getTokenSymbol: getTokenSymbolMock,
  getClient: getClientMock,
  getRpcUrl: vi.fn().mockReturnValue("https://mock-rpc.example.com"),
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
  initAllCurveInstances: vi.fn(),
  initCurveInstance: vi.fn(),
  isCurveInitialized: vi.fn().mockReturnValue(true),
  getCurveInitError: vi.fn().mockReturnValue(undefined),
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
  inputAmount?: bigint;
  gasUsed?: bigint;
  provider?: string;
  txValue?: bigint;
  approval?: boolean;
}) {
  const outputAmount = overrides?.outputAmount ?? 2_500_000_000_000_000_000n;
  const inputAmount = overrides?.inputAmount ?? 1_000_000n;
  const gasUsed = overrides?.gasUsed ?? 21000n;
  const provider = overrides?.provider ?? "fabric";
  const txValue = overrides?.txValue;
  const withApproval = overrides?.approval ?? true;

  return {
    success: true,
    simulation: {
      outputAmount,
      gasUsed,
    },
    inputAmount,
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
  input?: string;
  inputAmount?: bigint;
}) {
  const outputAmount = overrides?.output
    ? BigInt(parseFloat(overrides.output) * 1e18)
    : 2_000_000_000_000_000_000n;
  const gasUsed = overrides?.gas ? BigInt(overrides.gas) : 30000n;
  const inputAmount =
    overrides?.inputAmount ??
    (overrides?.input ? BigInt(parseFloat(overrides.input) * 1e6) : 1_000_000n);

  const quote = {
    success: true,
    simulation: { outputAmount, gasUsed },
    inputAmount,
    provider: "curve",
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
    txData: { to: makeAddress("7"), data: "0xbeef" },
    gas_used: overrides?.gas ?? "30000",
  };

  if (overrides?.approvalTarget) {
    return {
      ...quote,
      approval: { token: ADDR_APPROVAL_TOKEN, spender: overrides.approvalTarget },
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
    getBlockNumberMock.mockResolvedValue(1000n);
    getClientMock.mockReturnValue({
      getGasPrice: getGasPriceMock,
      getBlockNumber: getBlockNumberMock,
    });

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
    if (res.status !== 200) console.log(res.body);
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

    if (res.status !== 200) console.log(res.body);
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
    const sq_97794 = makeQuote({ outputAmount: 1_000_000_000_000_000_000n, gasUsed: 20000n });
    getQuoteMock.mockResolvedValue(sq_97794);
    getQuotesMock.mockResolvedValue([sq_97794, makeCurveQuote({ output: "2.5", gas: "30000" })]);

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // New format shows gas-adjusted comparison for WETH output
    expect(body.recommendation_reason).toContain("Curve returns");
    expect(body.recommendation_reason).toContain("after gas");
    expect(body.gas_price_gwei).toBe("1.0000");
  });

  it("GET /compare includes Curve approval fields when provided", async () => {
    const sq_13085 = makeQuote({ outputAmount: 1_000_000_000_000_000_000n });
    getQuoteMock.mockResolvedValue(sq_13085);
    getQuotesMock.mockResolvedValue([
      sq_13085,
      makeCurveQuote({
        output: "2.5",
        approvalTarget: ADDR_APPROVAL_SPENDER,
        approvalCalldata: "0xfeed",
      }),
    ]);

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.curve).toMatchObject({
      approval_spender: ADDR_APPROVAL_SPENDER,
    });
  });

  it("GET /compare handles single-source and no-source outcomes", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ outputAmount: 3_000_000_000_000_000_000n }));
    getQuotesMock.mockResolvedValue([makeQuote({ outputAmount: 3_000_000_000_000_000_000n })]);

    const spandexOnly = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(spandexOnly.status).toBe(200);
    expect(JSON.parse(spandexOnly.body).recommendation_reason).toContain(
      "Only Spandex returned a quote"
    );

    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    getQuotesMock.mockResolvedValue([makeCurveQuote({ output: "1.1" })]);

    const curveOnly = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(curveOnly.status).toBe(200);
    expect(JSON.parse(curveOnly.body).recommendation_reason).toContain(
      "Only Curve returned a quote"
    );

    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    getQuotesMock.mockRejectedValue(new Error("curve down"));

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
    const sq_30267 = makeQuote();
    getQuoteMock.mockResolvedValue(sq_30267);
    getQuotesMock.mockResolvedValue([sq_30267, makeCurveQuote()]);

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

  it("GET /compare factors gas into recommendation when output is WETH", async () => {
    // Spandex: 1.5 ETH output, 20000 gas
    // Curve: 1.49 ETH output, 10000 gas
    // Gas price: 1 gwei = 1e9 wei
    // Spandex gas cost: 20000 * 1e9 / 1e18 = 0.00002 ETH
    // Curve gas cost: 10000 * 1e9 / 1e18 = 0.00001 ETH
    // Adjusted Spandex: 1.5 - 0.00002 = 1.49998 ETH
    // Adjusted Curve: 1.49 - 0.00001 = 1.48999 ETH
    // Spandex should still win after gas adjustment
    const sq_45746 = makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 20000n });
    getQuoteMock.mockResolvedValue(sq_45746);
    getQuotesMock.mockResolvedValue([sq_45746, makeCurveQuote({ output: "1.49", gas: "10000" })]);

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("spandex");
    expect(body.recommendation_reason).toContain("after gas");
    expect(body.recommendation_reason).toContain("ETH");
  });

  it("GET /compare shows gas-adjusted comparison for non-ETH output with rate fetch", async () => {
    // Create a mock where output token is USDC (not ETH/WETH)
    getTokenSymbolMock.mockImplementation(async (_chainId: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "WETH" : "USDC"
    );

    // Mock getQuote to return different results based on the call:
    // 1st call (rate fetch): 1 USDC -> 0.0004 ETH (rate for gas-adjusted comparison)
    // 2nd call (Spandex quote): 2500 USDC output
    // 3rd call (fallback quote): same as 2nd
    const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    getQuoteMock.mockImplementation(
      async (params: {
        swap: { inputToken: string; outputToken: string; inputAmount: bigint };
      }) => {
        // Check if this is a rate fetch (output to WETH address)
        const isRateFetch = params.swap.outputToken.toLowerCase() === WETH_ADDRESS.toLowerCase();

        if (isRateFetch) {
          // Rate fetch: return 0.0004 ETH for 1 USDC (rate = 0.0004)
          return {
            simulation: {
              outputAmount: 400_000_000_000_000n, // 0.0004 ETH (18 decimals)
              gasUsed: 50000n,
            },
            inputAmount: params.swap.inputAmount, // Echo back the input amount
            provider: "fabric",
            txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
          };
        }

        // Regular quote: return 2500 USDC output
        return makeQuote({ outputAmount: 2_500_000_000n, gasUsed: 20000n });
      }
    );

    getQuotesMock.mockResolvedValue([
      {
        success: true,
        simulation: { outputAmount: 1_000_000_000_000_000_000n, gasUsed: 20000n },
        inputAmount: 2_500_000_000n,
        provider: "fabric",
        txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
      },
      makeCurveQuote({ inputAmount: 2_400_000_000n, gas: "30000", output: "1.0" }),
    ]);

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=targetOut`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // Should include input->ETH rate
    expect(body.input_to_eth_rate).toBeDefined();
    // Should show ETH conversion in reason
    expect(body.recommendation_reason).toContain("ETH");
  });

  it("GET /compare exactIn mode unchanged (baseline verification)", async () => {
    // Verify exactIn mode still works correctly (unchanged behavior)
    const sq_96669 = makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 20000n });
    getQuoteMock.mockResolvedValue(sq_96669);
    getQuotesMock.mockResolvedValue([sq_96669, makeCurveQuote({ output: "2.5", gas: "30000" })]);

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=exactIn`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // exactIn mode uses "returns ... more" wording
    expect(body.recommendation_reason).toContain("returns");
    expect(body.recommendation_reason).toContain("ETH");
    expect(body.mode).toBe("exactIn");
  });

  it("GET /quote-curve returns successful Curve quote", async () => {
    getQuotesMock.mockResolvedValue([makeCurveQuote({ output: "2.5", gas: "30000" })]);

    const res = await request(
      `${baseUrl}/quote-curve?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.source).toBe("curve");
    expect(body.output_amount).toBe("2.5");
    expect(body.gas_used).toBe("30000");
  });

  it("GET /quote-curve returns error when Curve is not supported for chain", async () => {
    getQuotesMock.mockResolvedValue([]);

    const res = await request(
      `${baseUrl}/quote-curve?chainId=8453&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("does not support or returned no quotes");
  });

  it("GET /quote-curve returns error when Curve quote fails", async () => {
    getQuotesMock.mockRejectedValue(new Error("Curve routing failed"));

    const res = await request(
      `${baseUrl}/quote-curve?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Curve routing failed");
  });

  it("GET /quote-curve returns 400 for invalid params", async () => {
    const res = await request(
      `${baseUrl}/quote-curve?chainId=999&from=bad&to=bad&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });
});
