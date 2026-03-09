/**
 * Tests targeting uncovered branches in server.ts.
 *
 * Uses STATIC imports (no vi.resetModules()) so that v8 coverage
 * properly tracks all executed lines and branches.
 */
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getQuoteMock,
  getTokenDecimalsMock,
  getTokenSymbolMock,
  getTokenNameMock,
  getGasPriceMock,
  getBlockNumberMock,
  getClientMock,
  findCurveQuoteMock,
  isCurveSupportedMock,
  captureExceptionMock,
  captureMessageMock,
  flags,
  ADDR_FROM,
  ADDR_TO,
  ADDR_ROUTER,
  ADDR_APPROVAL_TOKEN,
  ADDR_APPROVAL_SPENDER,
  ADDR_SENDER,
  ALL_WETH,
} = vi.hoisted(() => {
  const mkAddr = (c: string) => `0x${c.repeat(40)}`;
  return {
    getQuoteMock: vi.fn(),
    getTokenDecimalsMock: vi.fn(),
    getTokenSymbolMock: vi.fn(),
    getTokenNameMock: vi.fn(),
    getGasPriceMock: vi.fn(),
    getBlockNumberMock: vi.fn(),
    getClientMock: vi.fn(),
    findCurveQuoteMock: vi.fn(),
    isCurveSupportedMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    captureMessageMock: vi.fn(),
    flags: { compareEndpoint: true, metricsEndpoint: true },
    ADDR_FROM: mkAddr("1"),
    ADDR_TO: mkAddr("2"),
    ADDR_ROUTER: mkAddr("3"),
    ADDR_APPROVAL_TOKEN: mkAddr("4"),
    ADDR_APPROVAL_SPENDER: mkAddr("5"),
    ADDR_SENDER: mkAddr("6"),
    ALL_WETH: [
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "0x4200000000000000000000000000000000000006",
      "0x82aF49447D8a07e3340369C42921F5baB03F7D1D",
      "0x7ceB23bD638e8c21a3e6f28A20c2eE60b7E34F54",
      "0xbb4CdB9CBd36B01bD1cBaEB2Fe939D64f10c92b3",
      "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    ].map((a) => a.toLowerCase()),
  };
});

vi.mock("@spandex/core", () => ({
  getQuote: getQuoteMock,
  serializeWithBigInt: (data: unknown) =>
    JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
}));

vi.mock("../config.js", () => ({
  getSpandexConfig: vi.fn(() => ({ mocked: true })),
  getTokenDecimals: getTokenDecimalsMock,
  getTokenSymbol: getTokenSymbolMock,
  getTokenName: getTokenNameMock,
  getClient: getClientMock,
  getRpcUrl: vi.fn().mockReturnValue("https://mock-rpc.example.com"),
  SUPPORTED_CHAINS: {
    1: { name: "Ethereum", alchemySubdomain: "eth-mainnet" },
    8453: { name: "Base", alchemySubdomain: "base-mainnet" },
    42161: { name: "Arbitrum", alchemySubdomain: "arb-mainnet" },
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
  isCurveInitialized: vi.fn().mockReturnValue(true),
  getCurveInitError: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../feature-flags.js", () => ({
  isEnabled: (flag: string) => {
    if (flag === "compare_endpoint") return flags.compareEndpoint;
    if (flag === "metrics_endpoint") return flags.metricsEndpoint;
    if (flag === "curve_enabled") return true;
    return true;
  },
  getAllFlags: () => ({
    curve_enabled: true,
    compare_endpoint: flags.compareEndpoint,
    metrics_endpoint: flags.metricsEndpoint,
  }),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock("../sentry.js", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

// STATIC import so v8 coverage tracks all branches
import { handleRequest } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAddress = (char: string) => `0x${char.repeat(40)}`;

let blockCounter = 1000n;

function makeQuote(overrides?: {
  outputAmount?: bigint;
  inputAmount?: bigint;
  gasUsed?: bigint;
  provider?: string;
  txValue?: bigint;
}) {
  return {
    simulation: {
      outputAmount: overrides?.outputAmount ?? 2_500_000_000_000_000_000n,
      gasUsed: overrides?.gasUsed ?? 21000n,
    },
    inputAmount: overrides?.inputAmount ?? 1_000_000n,
    provider: overrides?.provider ?? "fabric",
    txData: {
      to: ADDR_ROUTER,
      data: "0xdeadbeef",
      ...(overrides?.txValue !== undefined ? { value: overrides.txValue } : {}),
    },
    approval: { token: ADDR_APPROVAL_TOKEN, spender: ADDR_APPROVAL_SPENDER },
  };
}

function makeCurveQuote(overrides?: { output?: string; input?: string; gas?: string }) {
  return {
    source: "curve",
    from: ADDR_FROM,
    from_symbol: "USDC",
    to: ADDR_TO,
    to_symbol: "WETH",
    amount: "1",
    input_amount: overrides?.input ?? "1000",
    output_amount: overrides?.output ?? "2.0",
    route: [],
    route_symbols: {},
    router_address: makeAddress("7"),
    router_calldata: "0xbeef",
    gas_used: overrides?.gas ?? "30000",
  };
}

function req(
  url: string,
  method = "GET"
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }
    );
    r.on("error", reject);
    r.end();
  });
}

/** Configure getQuoteMock to return `quote` for regular calls and optionally handle rate fetches. */
function mockQuoteWithRate(
  quote: ReturnType<typeof makeQuote> | null,
  rateResult: "success" | "null" | "error" = "success"
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQuoteMock.mockImplementation(async (params: any) => {
    const out: string = params.swap.outputToken?.toLowerCase() ?? "";
    if (ALL_WETH.includes(out)) {
      if (rateResult === "null") return null;
      if (rateResult === "error") throw new Error("Rate fetch failed");
      return {
        simulation: { outputAmount: 400_000_000_000_000n, gasUsed: 50000n },
        inputAmount: params.swap.inputAmount,
        provider: "fabric",
        txData: { to: ADDR_ROUTER, data: "0xdeadbeef" },
      };
    }
    return quote;
  });
}

function compareUrl(chainId: number, extra = "") {
  return `${baseUrl}/compare?chainId=${chainId}&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50${extra}`;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.ALCHEMY_API_KEY ??= "test-key";
  server = http.createServer((r, s) => void handleRequest(r, s));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const a = server.address();
  if (a && typeof a === "object") baseUrl = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  flags.compareEndpoint = true;
  flags.metricsEndpoint = true;
  blockCounter += 1n;

  getTokenDecimalsMock.mockImplementation(async (_c: number, token: string) =>
    token.toLowerCase() === ADDR_FROM.toLowerCase() ? 6 : 18
  );
  getTokenSymbolMock.mockImplementation(async (_c: number, token: string) =>
    token.toLowerCase() === ADDR_FROM.toLowerCase() ? "USDC" : "WETH"
  );
  getTokenNameMock.mockResolvedValue("Mock Token");
  getGasPriceMock.mockResolvedValue(1_000_000_000n); // 1 gwei
  getBlockNumberMock.mockResolvedValue(blockCounter);
  getClientMock.mockReturnValue({
    getGasPrice: getGasPriceMock,
    getBlockNumber: getBlockNumberMock,
  });
  isCurveSupportedMock.mockReturnValue(true);
});

// ===========================================================================
// 1. Static endpoints
// ===========================================================================

describe("static endpoints", () => {
  it("OPTIONS returns 204", async () => {
    const res = await req(`${baseUrl}/health`, "OPTIONS");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("GET /openapi.json returns spec", async () => {
    const res = await req(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body);
    expect(body.openapi).toBeDefined();
  });

  it("GET /openapi.yaml also returns JSON spec", async () => {
    const res = await req(`${baseUrl}/openapi.yaml`);
    expect(res.status).toBe(200);
  });

  it("GET /docs returns Swagger UI HTML", async () => {
    const res = await req(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("swagger-ui");
  });

  it("GET /.well-known/farcaster.json returns manifest", async () => {
    const res = await req(`${baseUrl}/.well-known/farcaster.json`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.miniapp.name).toBe("Compare DEX Routers");
  });

  it("GET /metrics returns prometheus data when enabled", async () => {
    flags.metricsEndpoint = true;
    const res = await req(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("GET /metrics returns 404 when disabled", async () => {
    flags.metricsEndpoint = false;
    const res = await req(`${baseUrl}/metrics`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 2. /quote handler
// ===========================================================================

describe("/quote handler", () => {
  it("returns successful quote with approval and router value", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ txValue: 42n }));
    const res = await req(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.provider).toBe("fabric");
    expect(body.router_value).toBe("42");
    expect(body.approval_token).toBe(ADDR_APPROVAL_TOKEN);
  });

  it("falls back to fallback account when sender quote is null", async () => {
    getQuoteMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeQuote({ provider: "fb" }));
    const res = await req(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50&sender=${ADDR_SENDER}`
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).provider).toBe("fb");
  });

  it("returns 500 when all sources fail", async () => {
    getQuoteMock.mockResolvedValue(null);
    const res = await req(
      `${baseUrl}/quote?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("returns 400 for bad params", async () => {
    const res = await req(`${baseUrl}/quote?chainId=1&from=bad&to=${ADDR_TO}&amount=1`);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 3. /quote-curve handler
// ===========================================================================

describe("/quote-curve handler", () => {
  it("returns successful curve quote", async () => {
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5" }));
    const res = await req(
      `${baseUrl}/quote-curve?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).source).toBe("curve");
  });

  it("returns 500 when curve fails", async () => {
    findCurveQuoteMock.mockRejectedValue(new Error("Curve routing failed"));
    const res = await req(
      `${baseUrl}/quote-curve?chainId=1&from=${ADDR_FROM}&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(500);
  });

  it("returns 400 for bad params", async () => {
    const res = await req(`${baseUrl}/quote-curve?chainId=999&from=bad&to=bad&amount=1`);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 4. /compare — exactIn with WETH output (gas-adjusted, default case)
// ===========================================================================

describe("/compare exactIn WETH output", () => {
  it("recommends curve when curve has higher net value", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("after gas");
    expect(b.gas_price_gwei).toBeDefined();
  });

  it("recommends spandex when spandex has higher net value", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 3_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).recommendation).toBe("spandex");
  });

  it("defaults to spandex when net values are equal", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000n, gasUsed: 30000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.0", gas: "30000" }));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal");
  });

  it("gas flip: high-gas route loses despite higher raw output", async () => {
    // Spandex: 1.50 ETH, 15M gas; Curve: 1.49 ETH, 10k gas
    // At 1 gwei: Spandex adjusted = 1.50 - 0.015 = 1.485, Curve adjusted = 1.49 - 0.00001 = 1.48999
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 1_500_000_000_000_000_000n, gasUsed: 15_000_000n })
    );
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "1.49", gas: "10000" }));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("after gas");
  });
});

// ===========================================================================
// 5. /compare — exactIn with non-ETH output (rate fetch path)
// ===========================================================================

describe("/compare exactIn non-ETH output", () => {
  beforeEach(() => {
    // Output token is DAI (not ETH/WETH)
    getTokenSymbolMock.mockImplementation(async (_c: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "USDC" : "DAI"
    );
  });

  it("gas-adjusted comparison with output->ETH rate", async () => {
    mockQuoteWithRate(makeQuote({ outputAmount: 2_500_000_000n, gasUsed: 20000n }));
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.output_to_eth_rate).toBeDefined();
    expect(b.recommendation_reason).toContain("ETH");
    expect(b.recommendation_reason).toContain("after gas");
  });

  it("!canDoGasAdjusted && bothHaveGas: Curve outputs more", async () => {
    // Use chainId=8453 to avoid rate cache from earlier tests
    // DAI is 18 decimals: 2000 DAI = 2_000e18
    mockQuoteWithRate(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000_000n, gasUsed: 20000n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("Gas costs");
    expect(b.recommendation_reason).toContain("rate unavailable");
  });

  it("!canDoGasAdjusted && bothHaveGas: Spandex outputs more", async () => {
    mockQuoteWithRate(
      makeQuote({ outputAmount: 3_000_000_000_000_000_000_000n, gasUsed: 20000n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("rate unavailable");
  });

  it("!canDoGasAdjusted && bothHaveGas: equal output", async () => {
    mockQuoteWithRate(
      makeQuote({ outputAmount: 2_600_000_000_000_000_000_000n, gasUsed: 20000n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal output");
  });

  it("no gas fallback: Curve outputs more, missing Spandex gas", async () => {
    mockQuoteWithRate(
      makeQuote({ outputAmount: 2_000_000_000_000_000_000_000n, gasUsed: 0n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("Gas estimates unavailable");
    expect(b.recommendation_reason).toContain("Spandex");
  });

  it("no gas fallback: Spandex outputs more, missing Curve gas", async () => {
    mockQuoteWithRate(
      makeQuote({ outputAmount: 3_000_000_000_000_000_000_000n, gasUsed: 20000n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600" }),
      to_symbol: "DAI",
      gas_used: undefined,
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Gas estimates unavailable");
    expect(b.recommendation_reason).toContain("Curve");
  });

  it("no gas fallback: equal output, both missing gas", async () => {
    mockQuoteWithRate(
      makeQuote({ outputAmount: 2_600_000_000_000_000_000_000n, gasUsed: 0n }),
      "null"
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600" }),
      to_symbol: "DAI",
      gas_used: undefined,
    });

    const res = await req(compareUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal output");
    expect(b.recommendation_reason).toContain("Gas estimates unavailable");
  });
});

// ===========================================================================
// 6. /compare — targetOut mode (both routers return results)
// ===========================================================================

describe("/compare targetOut both results", () => {
  const targetOutUrl = (chainId: number) => compareUrl(chainId, "&mode=targetOut");

  it("gas-adjusted: Curve wins, inputIsEth=true", async () => {
    // Input is ETH -> inputIsEth = true, canDoGasAdjusted = true
    // Both tokens treated as 18 decimals (WETH)
    getTokenSymbolMock.mockResolvedValue("WETH");
    getTokenDecimalsMock.mockResolvedValue(18);

    getQuoteMock.mockResolvedValue(
      makeQuote({ inputAmount: 1_010_000_000_000_000_000n, gasUsed: 15_000_000n })
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "1.0", gas: "10000" }),
      from_symbol: "WETH",
    });

    const res = await req(targetOutUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("ETH total");
    expect(b.recommendation_reason).toContain("Curve recommended");
    expect(b.mode).toBe("targetOut");
  });

  it("gas-adjusted: Spandex wins, inputIsEth=true", async () => {
    getTokenSymbolMock.mockResolvedValue("WETH");
    getTokenDecimalsMock.mockResolvedValue(18);

    getQuoteMock.mockResolvedValue(
      makeQuote({ inputAmount: 1_000_000_000_000_000_000n, gasUsed: 10000n })
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "1.01", gas: "15000000" }),
      from_symbol: "WETH",
    });

    const res = await req(targetOutUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Spandex");
  });

  it("gas-adjusted: Curve wins, non-ETH input (with rate)", async () => {
    // USDC input -> need inputToEthRate
    mockQuoteWithRate(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 20000n }));

    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2400", gas: "30000" }));

    const res = await req(targetOutUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.input_to_eth_rate).toBeDefined();
    expect(b.recommendation_reason).toContain("Rate:");
    expect(b.recommendation_reason).toContain("Curve recommended");
  });

  it("gas-adjusted: Spandex wins, non-ETH input (with rate)", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_400_000_000n, gasUsed: 20000n }));

    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2500", gas: "30000" }));

    const res = await req(targetOutUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Spandex");
  });

  it("gas-adjusted: equal total cost", async () => {
    getTokenSymbolMock.mockResolvedValue("WETH");
    getTokenDecimalsMock.mockResolvedValue(18);

    getQuoteMock.mockResolvedValue(
      makeQuote({ inputAmount: 1_000_000_000_000_000_000n, gasUsed: 30000n })
    );
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "1.0", gas: "30000" }),
      from_symbol: "WETH",
    });

    const res = await req(targetOutUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal total cost");
  });

  it("!canDoGasAdjusted && bothHaveGas: Curve requires less", async () => {
    // Rate fetch fails -> canDoGasAdjusted = false
    mockQuoteWithRate(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 20000n }), "null");
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2400", gas: "30000" }));

    const res = await req(targetOutUrl(42161));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("less");
    expect(b.recommendation_reason).toContain("rate unavailable");
  });

  it("!canDoGasAdjusted && bothHaveGas: Spandex requires less", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_400_000_000n, gasUsed: 20000n }), "null");
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2500", gas: "30000" }));

    const res = await req(targetOutUrl(42161));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("less");
  });

  it("!canDoGasAdjusted && bothHaveGas: equal input", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 20000n }), "null");
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2500", gas: "30000" }));

    const res = await req(targetOutUrl(42161));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal input");
  });

  it("no gas fallback: Curve requires less, missing gas", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 0n }), "null");
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "2400" }),
      gas_used: undefined,
    });

    const res = await req(targetOutUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("Gas estimates unavailable");
  });

  it("no gas fallback: Spandex requires less, missing gas", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_400_000_000n, gasUsed: 0n }), "null");
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "2500" }),
      gas_used: undefined,
    });

    const res = await req(targetOutUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
  });

  it("no gas fallback: equal input, missing gas", async () => {
    mockQuoteWithRate(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 0n }), "null");
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ input: "2500" }),
      gas_used: undefined,
    });

    const res = await req(targetOutUrl(8453));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Equal input");
  });
});

// ===========================================================================
// 7. /compare — single router + neither router
// ===========================================================================

describe("/compare single-router enrichment", () => {
  it("only Spandex, exactIn mode", async () => {
    getQuoteMock.mockResolvedValue(
      makeQuote({ outputAmount: 3_000_000_000_000_000_000n, gasUsed: 20000n })
    );
    findCurveQuoteMock.mockRejectedValue(new Error("curve down"));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Only Spandex");
    expect(b.spandex.gas_cost_eth).toBeDefined();
  });

  it("only Spandex, targetOut mode", async () => {
    getQuoteMock.mockResolvedValue(makeQuote({ inputAmount: 2_500_000_000n, gasUsed: 20000n }));
    findCurveQuoteMock.mockRejectedValue(new Error("curve down"));

    const res = await req(compareUrl(1, "&mode=targetOut"));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("spandex");
    expect(b.recommendation_reason).toContain("Only Spandex");
    expect(b.spandex.gas_cost_eth).toBeDefined();
  });

  it("only Curve, exactIn mode", async () => {
    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ output: "2.5", gas: "30000" }));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("Only Curve");
    expect(b.curve.gas_cost_eth).toBeDefined();
  });

  it("only Curve, targetOut mode", async () => {
    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    findCurveQuoteMock.mockResolvedValue(makeCurveQuote({ input: "2400", gas: "30000" }));

    const res = await req(compareUrl(1, "&mode=targetOut"));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBe("curve");
    expect(b.recommendation_reason).toContain("Only Curve");
    expect(b.curve.gas_cost_eth).toBeDefined();
  });

  it("neither router returns a quote", async () => {
    getQuoteMock.mockRejectedValue(new Error("spandex down"));
    findCurveQuoteMock.mockRejectedValue(new Error("curve down"));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.recommendation).toBeNull();
    expect(b.recommendation_reason).toContain("Neither");
  });
});

// ===========================================================================
// 8. /compare feature flag & validation
// ===========================================================================

describe("/compare edge cases", () => {
  it("returns 404 when compare_endpoint is disabled", async () => {
    flags.compareEndpoint = false;
    const res = await req(compareUrl(1));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid params", async () => {
    const res = await req(
      `${baseUrl}/compare?chainId=1&from=bad&to=${ADDR_TO}&amount=1&slippageBps=50`
    );
    expect(res.status).toBe(400);
  });

  it("handles compare error gracefully (500 from unhandled throw)", async () => {
    // Both quotes succeed, but getTokenDecimals throws on the rate fetch call
    // (3rd call), making compareQuotes throw unhandled
    getTokenSymbolMock.mockImplementation(async (_c: number, token: string) =>
      token.toLowerCase() === ADDR_FROM.toLowerCase() ? "USDC" : "DAI"
    );
    getQuoteMock.mockResolvedValue(makeQuote({ outputAmount: 2_000_000_000n, gasUsed: 20000n }));
    findCurveQuoteMock.mockResolvedValue({
      ...makeCurveQuote({ output: "2600", gas: "30000" }),
      to_symbol: "DAI",
    });
    // First two getTokenDecimals calls succeed (findQuote), third throws (rate fetch)
    getTokenDecimalsMock
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(18)
      .mockRejectedValueOnce(new Error("decimals failed"));

    const res = await req(compareUrl(1));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toContain("decimals failed");
  });
});
