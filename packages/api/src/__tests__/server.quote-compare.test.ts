import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompareSchema, QuoteSchema } from "../quote-response.js";
const mocks = vi.hoisted(() => ({
  quotes: vi.fn(),
  rate: vi.fn(),
  decimals: vi.fn(),
  gas: vi.fn(),
  flags: { curve_enabled: true, compare_endpoint: true, metrics_endpoint: true },
}));
vi.mock("@spandex/core", async (original) => ({
  ...(await original<typeof import("@spandex/core")>()),
  getQuotes: mocks.quotes,
  getQuote: mocks.rate,
}));
vi.mock("../config.js", async (original) => {
  const actual = await original<typeof import("../config.js")>();
  return {
    ...actual,
    getTokenDecimals: mocks.decimals,
    getTokenSymbol: vi.fn(async () => "TOKEN"),
    getClient: () => ({ getGasPrice: mocks.gas, getBlockNumber: async () => 100n }),
  };
});
vi.mock("../feature-flags.js", () => ({
  isEnabled: (key: keyof typeof mocks.flags) => mocks.flags[key],
  getAllFlags: () => mocks.flags,
}));
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const SENDER = "0x3333333333333333333333333333333333333333";
const ROUTER = "0x4444444444444444444444444444444444444444";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
function quote(
  provider = "fabric",
  input = 1000000n,
  output = 10n ** 18n,
  gasUsed: bigint | undefined = 10000n
) {
  return {
    success: true,
    provider,
    inputAmount: input,
    outputAmount: output,
    simulation: { success: true, outputAmount: output, gasUsed },
    txData: { to: ROUTER, data: "0xabcdef", value: 0n },
    approval: { token: FROM, spender: ROUTER },
    route: {
      nodes: [{ address: FROM }, { address: TO }],
      edges: [{ key: "pool", source: FROM, target: TO, value: 1 }],
    },
  };
}
let server: http.Server;
let baseUrl: string;
async function call(path = "/compare", query: Record<string, string | number> = {}) {
  const params = new URLSearchParams(
    Object.entries({
      chainId: 1,
      from: FROM,
      to: WETH,
      amount: "1",
      slippageBps: 50,
      ...query,
    }).map(([key, value]) => [key, String(value)])
  );
  const response = await fetch(`${baseUrl}${path}?${params}`);
  return { response, body: await response.json() };
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.flags.curve_enabled = true;
  mocks.flags.compare_endpoint = true;
  mocks.decimals.mockImplementation(async (_chain: number, token: string) =>
    token === FROM ? 6 : 18
  );
  mocks.gas.mockResolvedValue(1000000000n);
  mocks.rate.mockResolvedValue(null);
  mocks.quotes.mockResolvedValue([quote(), quote("curve")]);
  const { handleRequest } = await import("../server.js");
  server = http.createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("quote execution and response contract", () => {
  it.each(["/quote", "/quote-curve", "/compare"])(
    "%s keeps sender simulation failures non-executable without retrying another account",
    async (endpoint) => {
      mocks.quotes.mockResolvedValue([
        { ...quote(), simulation: { success: false, error: "sender simulation reverted" } },
      ]);
      const { response, body } = await call(endpoint, { sender: SENDER });
      expect(response.status).toBe(endpoint === "/compare" ? 200 : 500);
      if (endpoint === "/compare")
        expect(body).toMatchObject({ spandex: null, curve: null, recommendation: null });
      expect(mocks.quotes).toHaveBeenCalledTimes(1);
      expect(mocks.quotes.mock.calls[0]?.[0].swap.swapperAccount).toBe(SENDER);
      expect(mocks.rate).not.toHaveBeenCalled();
    }
  );
  it.each(["/quote", "/quote-curve", "/compare"])(
    "%s exposes preview amounts without calldata or an approval",
    async (endpoint) => {
      const { response, body } = await call(endpoint);
      expect(response.status).toBe(200);
      const result = endpoint === "/compare" ? body.spandex : body;
      expect(QuoteSchema.parse(result)).toMatchObject({
        sender: null,
        execution: null,
        input_amount_raw: "1000000",
        output_amount_raw: "1000000000000000000",
      });
      if (endpoint === "/compare") expect(CompareSchema.safeParse(body).success).toBe(true);
    }
  );
  it.each(["/quote", "/quote-curve", "/compare"])(
    "%s returns the same account-bound execution schema",
    async (endpoint) => {
      const { response, body } = await call(endpoint, { sender: SENDER });
      expect(response.status).toBe(200);
      const result = endpoint === "/compare" ? body.curve : body;
      expect(QuoteSchema.parse(result)).toMatchObject({
        sender: SENDER,
        execution: {
          to: ROUTER,
          data: "0xabcdef",
          value: "0",
          approval: { token: FROM, spender: ROUTER },
        },
        route: { edges: [{ key: "pool" }] },
      });
      expect(mocks.quotes.mock.calls[0]?.[0].swap.swapperAccount).toBe(SENDER);
      expect(Object.keys(result)).not.toContain("router_address");
    }
  );
  it.each(["exactIn", "targetOut"])(
    "preserves amount and slippage in %s requests",
    async (mode) => {
      await call("/compare", { mode, amount: "1.25", slippageBps: 10, sender: SENDER });
      expect(mocks.quotes.mock.calls[0]?.[0].swap).toEqual(
        expect.objectContaining({
          mode,
          slippageBps: 10,
          swapperAccount: SENDER,
          ...(mode === "targetOut"
            ? { outputAmount: 1250000000000000000n }
            : { inputAmount: 1250000n }),
        })
      );
    }
  );
  it("uses actual zero decimals", async () => {
    mocks.decimals.mockResolvedValue(0);
    mocks.quotes.mockResolvedValue([quote("fabric", 7n, 9n)]);
    const { body } = await call("/quote", { amount: 7, to: TO });
    expect(mocks.quotes.mock.calls[0]?.[0].swap.inputAmount).toBe(7n);
    expect(body).toMatchObject({ input_amount: "7", output_amount: "9" });
  });
  it("filters out unsuccessful quotes and failed simulations", async () => {
    mocks.quotes.mockResolvedValue([
      { success: false, provider: "fabric", error: "unavailable" },
      { ...quote("curve"), simulation: { success: false } },
      quote("relay"),
    ]);
    const { body } = await call();
    expect(body.spandex.provider).toBe("relay");
    expect(body.curve).toBeNull();
    expect(body.recommendation_basis).toBe("single_quote");
  });
  it("selects the best successful Spandex quote", async () => {
    mocks.quotes.mockResolvedValue([quote("fabric", 1000000n, 1n), quote("relay", 1000000n, 2n)]);
    expect((await call()).body.spandex.provider).toBe("relay");
  });
  it.each(["/quote", "/quote-curve", "/compare"])(
    "%s returns fixed public errors without upstream credentials",
    async (endpoint) => {
      mocks.quotes.mockRejectedValue(
        new Error(
          "RPC https://user:password@rpc.example/v2/private-path?apiKey=query-secret authorization=header-secret"
        )
      );
      const { response, body } = await call(endpoint);
      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: "Request failed. Please try again.",
        code: "UPSTREAM_ERROR",
        requestId: response.headers.get("x-request-id"),
      });
      const insights = await (await fetch(`${baseUrl}/errors`)).text();
      for (const secret of ["password", "private-path", "query-secret", "header-secret"])
        expect(insights).not.toContain(secret);
    }
  );
  it("honors Curve and comparison flags independently of provider keys", async () => {
    mocks.flags.curve_enabled = false;
    const { getSpandexConfig } = await import("../config.js");
    expect(getSpandexConfig().aggregators.map((provider) => provider.name())).not.toContain(
      "curve"
    );
    mocks.flags.compare_endpoint = false;
    expect((await call()).response.status).toBe(404);
  });
  it.each(["/quote", "/quote-curve", "/compare"])(
    "%s validates parameters before contacting providers",
    async (endpoint) => {
      expect((await call(endpoint, { from: "invalid" })).response.status).toBe(400);
      expect(mocks.quotes).not.toHaveBeenCalled();
    }
  );
});

describe("server recommendation arithmetic", () => {
  it.each(["exactIn", "targetOut"])(
    "gas cost reverses the raw price winner in %s",
    async (mode) => {
      const target = mode === "targetOut";
      mocks.decimals.mockResolvedValue(18);
      mocks.quotes.mockResolvedValue([
        quote("fabric", target ? 1000000000000000000n : 1n, 1000000000000000000n, 10000n),
        quote("curve", target ? 999990000000000000n : 1n, 1000010000000000000n, 100000n),
      ]);
      const { body } = await call("/compare", { mode, from: target ? WETH : FROM });
      expect(body.recommendation).toBe("spandex");
      expect(body.recommendation_basis).toBe("gas_adjusted");
      expect(body.native_currency).toBe("ETH");
    }
  );
  it.each([
    [1, "ETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
    [10, "ETH", "0x4200000000000000000000000000000000000006"],
    [8453, "ETH", "0x4200000000000000000000000000000000000006"],
    [42161, "ETH", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"],
    [137, "POL", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"],
    [56, "BNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"],
    [43114, "AVAX", "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"],
  ] as const)(
    "uses the native currency and wrapped asset for chain %i",
    async (chainId, symbol, wrapped) => {
      mocks.rate.mockResolvedValue(quote("fabric", 10n ** 18n, 10n ** 18n));
      const { body } = await call("/compare", { chainId, to: TO });
      expect(mocks.rate.mock.calls[0]?.[0].swap.outputToken).toBe(wrapped);
      expect(body.native_currency).toBe(symbol);
      expect(body.spandex.gas_cost_native).toBe("0.00001");
    }
  );
  it("compares rational values before rounding to native wei", async () => {
    mocks.rate.mockResolvedValue(quote("fabric", 10n ** 18n, 1n));
    mocks.quotes.mockResolvedValue([quote("fabric", 1000000n, 1n), quote("curve", 1000000n, 2n)]);
    const { body } = await call("/compare", { to: TO });
    expect(body.spandex.trade_value_native).toBe("0");
    expect(body.curve.trade_value_native).toBe("0");
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_basis).toBe("gas_adjusted");
  });

  it.each(["exactIn", "targetOut"])(
    "uses one shared conversion rate for %s and caches it",
    async (mode) => {
      mocks.rate.mockResolvedValue(quote("fabric", 1n, 400000000000000n));
      await call("/compare", { mode, to: TO });
      await call("/compare", { mode, to: TO });
      expect(mocks.rate).toHaveBeenCalledTimes(1);
    }
  );
  it.each(["exactIn", "targetOut"])("uses raw amounts when %s conversion fails", async (mode) => {
    mocks.quotes.mockResolvedValue([
      quote("fabric", 2000000n, 10n ** 18n),
      quote("curve", 1000000n, 2n * 10n ** 18n),
    ]);
    mocks.rate.mockRejectedValue(new Error("Rate unavailable"));
    const { body } = await call("/compare", { mode, to: TO });
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_basis).toBe("raw_amount");
    expect(body.spandex.net_value_native).toBeNull();
  });
  it.each(["missing gas", "gas RPC failure", "failed rate simulation", "zero rate"])(
    "uses raw amounts with %s",
    async (failure) => {
      mocks.quotes.mockResolvedValue([
        quote(),
        quote("curve", 1000000n, 2n * 10n ** 18n, failure === "missing gas" ? 0n : 10000n),
      ]);
      if (failure === "gas RPC failure") mocks.gas.mockRejectedValue(new Error("Unavailable"));
      if (failure === "failed rate simulation")
        mocks.rate.mockResolvedValue({ ...quote(), simulation: { success: false } });
      if (failure === "zero rate") mocks.rate.mockResolvedValue(quote("fabric", 1n, 0n));
      const { body } = await call("/compare", { to: failure.includes("rate") ? TO : WETH });
      expect(body.recommendation).toBe("curve");
      expect(body.recommendation_basis).toBe("raw_amount");
    }
  );
  it("breaks equal values consistently", async () => {
    expect((await call()).body.recommendation).toBe("spandex");
  });
  it.each(["fabric", "curve"])("reports only the available %s quote", async (provider) => {
    mocks.quotes.mockResolvedValue([quote(provider)]);
    const { body } = await call();
    expect(body.recommendation).toBe(provider === "curve" ? "curve" : "spandex");
    expect(body.recommendation_basis).toBe("single_quote");
  });
  it("reports no recommendation when all providers fail", async () => {
    mocks.quotes.mockResolvedValue([]);
    const { body } = await call();
    expect(body.recommendation).toBeNull();
    expect(body.recommendation_basis).toBe("none");
  });
});
