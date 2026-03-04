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
const getBlockNumberMock = vi.fn();
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
  findCurveQuote: findCurveQuoteMock,
  isCurveSupported: isCurveSupportedMock,
  isCurveInitialized: vi.fn().mockReturnValue(true), // All chains initialized by default
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
    getBlockNumberMock.mockResolvedValue(1000n);
    getClientMock.mockReturnValue({
      getGasPrice: getGasPriceMock,
      getBlockNumber: getBlockNumberMock,
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
    // New format shows gas-adjusted comparison for WETH output
    expect(body.recommendation_reason).toContain("Curve returns");
    expect(body.recommendation_reason).toContain("after gas");
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

  it("GET /compare factors gas into recommendation when output is WETH", async () => {
    // Spandex: 1.5 ETH output, 20000 gas
    // Curve: 1.49 ETH output, 10000 gas
    // Gas price: 1 gwei = 1e9 wei
    // Spandex gas cost: 20000 * 1e9 / 1e18 = 0.00002 ETH
    // Curve gas cost: 10000 * 1e9 / 1e18 = 0.00001 ETH
    // Adjusted Spandex: 1.5 - 0.00002 = 1.49998 ETH
    // Adjusted Curve: 1.49 - 0.00001 = 1.48999 ETH
    // Spandex should still win after gas adjustment
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "1.49", gas: "10000" }));

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

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

    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "USDC",
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // Should show gas-adjusted comparison with ETH conversion
    expect(body.recommendation_reason).toContain("ETH");
    expect(body.recommendation_reason).toContain("after gas");
    // Should include the rate used
    expect(body.output_to_eth_rate).toBeDefined();
    // Quotes should have gas cost in ETH
    expect(body.spandex.gas_cost_eth).toBeDefined();
    expect(body.curve.gas_cost_eth).toBeDefined();
  });

  it("GET /compare falls back to raw output when gas unavailable for one router", async () => {
    // Spandex has gas, Curve doesn't
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "1.6" }),
      gas_used: undefined, // No gas estimate for Curve
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_reason).toContain("Gas estimates unavailable");
    expect(body.recommendation_reason).toContain("Curve");
    expect(body.recommendation_reason).toContain("comparing raw output only");
  });

  it("GET /compare falls back to raw output when gas unavailable for both routers", async () => {
    // Neither has gas estimates
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 0n })
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "1.6" }),
      gas_used: undefined,
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_reason).toContain("Gas estimates unavailable");
    expect(body.recommendation_reason).toContain("Spandex");
    expect(body.recommendation_reason).toContain("Curve");
  });

  it("GET /compare shows gas price in response when available", async () => {
    getQuoteMock.mockResolvedValue(makeQuote());
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote());

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.gas_price_gwei).toBe("1.0000");
  });

  it("GET /compare recommendation flips when gas costs reverse the output advantage", async () => {
    // This tests the core value proposition of gas-adjusted comparison:
    // Router A has higher raw output but much higher gas, so Router B wins after adjustment.
    //
    // Spandex: 1.50 ETH output, 15M gas (complex multi-hop route)
    // Curve: 1.49 ETH output, 10k gas (direct pool swap)
    // Gas price: 1 gwei = 1e9 wei
    //
    // Spandex gas cost: 15,000,000 * 1e9 / 1e18 = 0.015 ETH
    // Curve gas cost: 10,000 * 1e9 / 1e18 = 0.00001 ETH
    //
    // Adjusted outputs:
    // Spandex: 1.50 - 0.015 = 1.485 ETH
    // Curve: 1.49 - 0.00001 = 1.48999 ETH
    //
    // Curve wins after gas adjustment!
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 15_000_000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "1.49", gas: "10000" }));

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    // Spandex has higher raw output but Curve wins after gas adjustment
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_reason).toContain("after gas");
    expect(body.recommendation_reason).toContain("Curve");
    // Verify the reason shows both raw and adjusted values
    expect(body.recommendation_reason).toMatch(/1\.50.*ETH.*1\.485.*ETH.*after gas/i);
  });

  // === TARGET_OUT MODE TESTS ===

  it("GET /compare targetOut mode compares input amounts (lower = better)", async () => {
    // In targetOut mode, user specifies desired output amount.
    // Quotes return required INPUT amount. Lower input = better deal.
    //
    // Spandex: requires 1050 USDC input for 1 WETH output
    // Curve: requires 1000 USDC input for 1 WETH output
    // Curve should win (requires less input)
    getQuoteMock.mockResolvedValue({
      simulation: {
        outputAmount: 1_000_000_000_000_000_000n, // 1 WETH (the desired output)
        gasUsed: 20000n,
      },
      inputAmount: 1_050_000_000n, // 1050 USDC (6 decimals)
      provider: "fabric",
      txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
    });
    findCurveQuoteMock.mockResolvedValue({
      source: "curve",
      from: ADDR_FROM,
      from_symbol: "USDC",
      to: ADDR_TO,
      to_symbol: "WETH",
      amount: "1",
      input_amount: "1000", // Curve requires 1000 USDC (less input = better)
      output_amount: "1.0", // The desired output (same for both)
      route: [],
      route_symbols: {},
      router_address: makeAddress("7"),
      router_calldata: "0xbeef",
      gas_used: "30000",
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=targetOut`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // Should say "requires less" not "outputs more"
    expect(body.recommendation_reason).toContain("requires");
    expect(body.recommendation_reason).toContain("less");
    expect(body.recommendation_reason).not.toContain("outputs more");
    expect(body.mode).toBe("targetOut");
  });

  it("GET /compare targetOut gas-adjusted: lower total cost wins", async () => {
    // TargetOut gas-adjusted: total cost = input_in_ETH + gas_cost_in_ETH (lower = better)
    //
    // Spandex: requires 1.0 ETH input, 15M gas (expensive route)
    // Curve: requires 1.01 ETH input, 10k gas (efficient direct route)
    // Gas price: 1 gwei
    //
    // Spandex gas cost: 15,000,000 * 1e9 / 1e18 = 0.015 ETH
    // Curve gas cost: 10,000 * 1e9 / 1e18 = 0.00001 ETH
    //
    // Spandex total: 1.0 + 0.015 = 1.015 ETH
    // Curve total: 1.01 + 0.00001 = 1.01001 ETH
    //
    // Curve wins (lower total cost) even though Spandex requires less raw input!
    getQuoteMock.mockResolvedValue({
      simulation: {
        outputAmount: 1_000_000_000_000_000_000n, // 1 ETH desired output
        gasUsed: 15_000_000n,
      },
      inputAmount: 1_000_000_000_000_000_000n, // 1.0 ETH input
      provider: "fabric",
      txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
    });
    findCurveQuoteMock.mockResolvedValue({
      source: "curve",
      from: ADDR_FROM,
      from_symbol: "USDC",
      to: ADDR_TO,
      to_symbol: "WETH",
      amount: "1",
      input_amount: "1.01", // 1.01 ETH input (more raw input)
      output_amount: "1.0",
      route: [],
      route_symbols: {},
      router_address: makeAddress("7"),
      router_calldata: "0xbeef",
      gas_used: "10000", // Much less gas
    });

    // For ETH input, no rate fetch needed
    getTokenSymbolMock.mockImplementation(async (_chainId: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "WETH" : "WETH"
    );

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=targetOut`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_reason).toContain("total");
    expect(body.recommendation_reason).toContain("gas");
    expect(body.recommendation_reason).toContain("Curve");
  });

  it("GET /compare targetOut recommendation uses 'requires less' wording", async () => {
    // Verify the recommendation reason wording for targetOut mode
    getQuoteMock.mockResolvedValue({
      simulation: {
        outputAmount: 1_000_000_000_000_000_000n,
        gasUsed: 20000n,
      },
      inputAmount: 1_100_000_000n, // 1100 USDC (higher input = worse)
      provider: "fabric",
      txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
    });
    findCurveQuoteMock.mockResolvedValue({
      source: "curve",
      from: ADDR_FROM,
      from_symbol: "USDC",
      to: ADDR_TO,
      to_symbol: "WETH",
      amount: "1",
      input_amount: "1000", // 1000 USDC (lower input = better)
      output_amount: "1.0",
      route: [],
      route_symbols: {},
      router_address: makeAddress("7"),
      router_calldata: "0xbeef",
      gas_used: "30000",
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=targetOut`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // Wording should say "requires X less" not "outputs X more"
    expect(body.recommendation_reason).toMatch(/requires.*less/i);
    expect(body.recommendation_reason).not.toMatch(/outputs.*more/i);
  });

  it("GET /compare targetOut with non-ETH input fetches input->ETH rate", async () => {
    // For targetOut with non-ETH input (e.g., USDC), need to fetch USDC->ETH rate
    // to compute total cost in ETH for gas-adjusted comparison
    const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

    getTokenSymbolMock.mockImplementation(async (_chainId: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "USDC" : "WETH"
    );

    // Mock getQuote for rate fetch (USDC -> WETH) and regular quote
    getQuoteMock.mockImplementation(
      async (params: {
        swap: { inputToken: string; outputToken: string; inputAmount: bigint };
      }) => {
        const isRateFetch = params.swap.outputToken.toLowerCase() === WETH_ADDRESS.toLowerCase();

        if (isRateFetch) {
          // Rate fetch: 1 USDC -> 0.0004 ETH
          return {
            simulation: {
              outputAmount: 400_000_000_000_000n, // 0.0004 ETH
              gasUsed: 50000n,
            },
            inputAmount: params.swap.inputAmount,
            provider: "fabric",
            txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
          };
        }

        // Regular quote: targetOut mode
        return {
          simulation: {
            outputAmount: 1_000_000_000_000_000_000n, // 1 WETH output
            gasUsed: 20000n,
          },
          inputAmount: 2_500_000_000n, // 2500 USDC input
          provider: "fabric",
          txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
        };
      }
    );

    findCurveQuoteMock.mockResolvedValue({
      source: "curve",
      from: ADDR_FROM,
      from_symbol: "USDC",
      to: ADDR_TO,
      to_symbol: "WETH",
      amount: "1",
      input_amount: "2400", // 2400 USDC (less input = better)
      output_amount: "1.0",
      route: [],
      route_symbols: {},
      router_address: makeAddress("7"),
      router_calldata: "0xbeef",
      gas_used: "30000",
    });

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=targetOut`
    );

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
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));

    const res = await request(
      `${baseUrl}/compare?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&mode=exactIn`
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).toBe("curve");
    // exactIn mode uses "returns ... more" wording
    expect(body.recommendation_reason).toContain("returns");
    expect(body.recommendation_reason).toContain("ETH");
    expect(body.mode).toBe("exactIn");
  });

  it("GET /compare-stream returns SSE events with Content-Type: text/event-stream", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));
    isCurveSupportedMock.mockReturnValue(true);

    const res = await request(
      `${baseUrl}/compare-stream?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("GET /compare-stream sends quote events for each router", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));
    isCurveSupportedMock.mockReturnValue(true);

    const res = await request(
      `${baseUrl}/compare-stream?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);

    // Parse SSE events
    const events = parseSSEEvents(res.body);

    // Should have quote events for both routers
    const quoteEvents = events.filter((e) => e.event === "quote");
    expect(quoteEvents.length).toBeGreaterThanOrEqual(2);

    // Should have complete event with recommendation
    const completeEvents = events.filter((e) => e.event === "complete");
    expect(completeEvents.length).toBe(1);
    const completeEvent = completeEvents[0];
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.recommendation).toBeDefined();

    // Should have done event
    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents.length).toBe(1);
  });

  it("GET /compare-stream handles single-router mode (Curve unavailable)", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    isCurveSupportedMock.mockReturnValue(false);

    const res = await request(
      `${baseUrl}/compare-stream?chainId=8453&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);

    const events = parseSSEEvents(res.body);

    // Should have error event for Curve (unavailable)
    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    const curveError = errorEvents.find((e) => e.data.router === "curve");
    expect(curveError).toBeDefined();
    expect(curveError?.data.error).toContain("does not support chain");

    // Should still have complete event
    const completeEvents = events.filter((e) => e.event === "complete");
    expect(completeEvents.length).toBe(1);
    const completeEvent = completeEvents[0];
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.single_router_mode).toBe(true);
  });

  it("GET /compare-stream handles Spandex error", async () => {
    getQuoteMock.mockRejectedValue(new Error("Spandex API error"));
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));
    isCurveSupportedMock.mockReturnValue(true);

    const res = await request(
      `${baseUrl}/compare-stream?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );

    expect(res.status).toBe(200);

    const events = parseSSEEvents(res.body);

    // Should have error event for Spandex
    const spandexError = events.find((e) => e.event === "error" && e.data.router === "spandex");
    expect(spandexError).toBeDefined();
    expect(spandexError?.data.error).toContain("Spandex API error");

    // Should still recommend Curve
    const completeEvents = events.filter((e) => e.event === "complete");
    const completeEvent = completeEvents[0];
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.recommendation).toBe("curve");
  });
});

// Helper to parse SSE events from response body
function parseSSEEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const lines = body.split("\n");

  let currentEvent = "";
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6).trim();
    } else if (line === "" && currentEvent && currentData) {
      try {
        events.push({
          event: currentEvent,
          data: JSON.parse(currentData),
        });
      } catch {
        // Ignore parse errors
      }
      currentEvent = "";
      currentData = "";
    }
  }

  return events;
}
