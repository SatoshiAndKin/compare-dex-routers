import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteResponseSchema } from "../quote-response.js";
import type { Quote, SimulatedQuote, SwapParams } from "@spandex/core";

const mocks = vi.hoisted(() => ({
  quotes: vi.fn(),
  rate: vi.fn(),
  simulate: vi.fn(),
  preview: vi.fn(),
  gas: vi.fn(),
}));
vi.mock("@spandex/core", async (original) => ({
  ...(await original<typeof import("@spandex/core")>()),
  prepareQuotes: async (args: {
    swap: SwapParams;
    mapFn: (quote: Quote) => Promise<SimulatedQuote>;
  }) => ((await mocks.quotes(args)) as Quote[]).map(args.mapFn),
  simulateQuote: mocks.simulate,
  getQuote: mocks.rate,
}));
vi.mock("../preview-simulation.js", () => ({ createPreviewState: () => mocks.preview }));
vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  getTokenDecimals: async (_chain: number, token: string) => (token === FROM ? 6 : 18),
  getTokenSymbol: async () => "TOKEN",
  getClient: () => ({ getGasPrice: mocks.gas, getBlockNumber: async () => 100n }),
}));
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const SENDER = "0x3333333333333333333333333333333333333333";
const ROUTER = "0x4444444444444444444444444444444444444444";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
function quote(
  provider = "kyberswap",
  input = 1000000n,
  output = 10n ** 18n,
  gasUsed: bigint | null = 10000n
) {
  return {
    success: true,
    provider,
    inputAmount: input,
    outputAmount: output,
    simulation: { success: true, outputAmount: output, gasUsed: gasUsed ?? undefined },
    txData: { to: ROUTER, data: "0xabcdef", value: 0n },
    approval: { token: FROM, spender: ROUTER },
  };
}
let server: http.Server;
let url: string;
async function call(query: Record<string, string | number> = {}, path = "/quote") {
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
  const response = await fetch(`${url}${path}?${params}`);
  return { response, body: await response.json() };
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.gas.mockResolvedValue(1000000000n);
  mocks.rate.mockResolvedValue(null);
  mocks.quotes.mockResolvedValue([quote(), quote("curve")]);
  mocks.simulate.mockImplementation(async ({ quote }: { quote: SimulatedQuote }) => quote);
  mocks.preview.mockResolvedValue([{ address: SENDER, balance: 10000000000000000000000n }]);
  const { handleRequest } = await import("../server.js");
  server = http.createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("unified quote contract", () => {
  it("returns all provider prices and strips execution from previews", async () => {
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(QuoteResponseSchema.parse(body)).toMatchObject({
      simulation_basis: "temporary_funding",
      wallet_readiness: "unchecked",
      recommendation: "kyberswap",
      failures: [],
    });
    expect(body.quotes.map((quote: { provider: string }) => quote.provider)).toEqual([
      "kyberswap",
      "curve",
    ]);
    for (const result of body.quotes)
      expect(result).toMatchObject({
        sender: null,
        execution: null,
        input_amount_raw: "1000000",
        output_amount_raw: "1000000000000000000",
      });
    expect(mocks.preview).toHaveBeenCalledWith(1000000n);
  });
  it("funds connected-wallet price simulations without replacing the sender or calldata", async () => {
    const { body } = await call({ sender: SENDER });
    expect(mocks.quotes.mock.calls[0]?.[0].swap.swapperAccount).toBe(SENDER);
    expect(mocks.preview).toHaveBeenCalledWith(1000000n);
    expect(mocks.simulate.mock.calls[0]?.[0].simulationOptions.stateOverrides).toEqual([
      { address: SENDER, balance: 10000000000000000000000n },
    ]);
    expect(body.quotes[0]).toMatchObject({
      sender: SENDER,
      execution: {
        to: ROUTER,
        data: "0xabcdef",
        value: "0",
        approval: { token: FROM, spender: ROUTER },
      },
    });
  });
  it("funds each exact-output route with its own required input", async () => {
    mocks.quotes.mockResolvedValue([quote("kyberswap", 1200000n), quote("curve", 1300000n)]);
    const { body } = await call({ mode: "targetOut" });
    expect(mocks.preview).toHaveBeenCalledWith(1200000n);
    expect(mocks.preview).toHaveBeenCalledWith(1300000n);
    expect(body.quotes.map((q: { input_amount_raw: string }) => q.input_amount_raw)).toEqual([
      "1200000",
      "1300000",
    ]);
  });
  it("keeps valid routes when funding verification or another provider fails", async () => {
    mocks.preview.mockRejectedValueOnce(new Error("Cannot verify token balance storage"));
    mocks.quotes.mockResolvedValue([
      quote(),
      quote("curve"),
      {
        success: false,
        provider: "relay",
        error: Object.assign(new Error("No route"), { code: "NO_ROUTE" }),
      },
    ]);
    const { body } = await call({ sender: SENDER });
    expect(body.quotes.map((q: { provider: string }) => q.provider)).toEqual(["curve"]);
    expect(body.failures).toMatchObject([
      {
        provider: "kyberswap",
        stage: "simulation",
        error: { message: "Cannot verify token balance storage" },
      },
      { provider: "relay", stage: "quote", error: { message: "No route", code: "NO_ROUTE" } },
    ]);
  });
  it("reports nested diagnostic fields through shared credential redaction", async () => {
    vi.stubEnv("RPC_URL_1", "https://rpc.example/private-secret");
    const cause = Object.assign(new Error("https://rpc.example/private-secret"), { code: -32000 });
    mocks.quotes.mockResolvedValue([
      {
        success: false,
        provider: "curve",
        error: Object.assign(new Error("Provider failed", { cause }), {
          name: "QuoteError",
          code: "RPC_FAILURE",
          details: { cause, rpcUrl: "https://rpc.example/private-secret" },
        }),
      },
    ]);
    const { body } = await call();
    expect(body.failures[0].error).toMatchObject({
      name: "QuoteError",
      message: "Provider failed",
      code: "RPC_FAILURE",
      cause: { code: -32000 },
      details: { rpcUrl: "[REDACTED]" },
    });
    expect(JSON.stringify(body)).not.toContain("private-secret");
    expect(body.recommendation).toBeNull();
    expect(body.recommendation_basis).toBe("none");
  });
  it("omits approvals for native input", async () => {
    const { body } = await call({
      from: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      sender: SENDER,
    });
    expect(body.quotes[0].execution.approval).toBeNull();
  });
  it("rejects simulated output below an exact-output target", async () => {
    mocks.quotes.mockResolvedValue([quote("curve", 1000000n, 1n)]);
    const { body } = await call({ mode: "targetOut" });
    expect(body.quotes).toEqual([]);
    expect(body.failures[0].stage).toBe("simulation");
    expect(body.recommendation).toBeNull();
  });
  it.each(["/compare", "/quote-curve"])("removes %s", async (path) => {
    expect((await call({}, path)).response.status).toBe(404);
  });
  it("exposes native metadata independently of token lists", async () => {
    const { body } = await call({}, "/config");
    expect(body.nativeAssets["1"]).toMatchObject({
      symbol: "ETH",
      decimals: 18,
      chainId: 1,
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    });
    expect(body.nativeAssets["56"].symbol).toBe("BNB");
  });
});

describe("ranking all providers together", () => {
  it.each([10, 8453, 42161])(
    "uses raw amounts on chain %s when full rollup fees are unavailable",
    async (chainId) => {
      const { body } = await call({ chainId, to: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" });
      expect(body.quotes).toHaveLength(2);
      expect(body.recommendation_basis).toBe("raw_amount");
      expect(body.recommendation_reason).toContain("comparable gas");
    }
  );
  it("can prefer a lower-output route after gas, even within former Spandex providers", async () => {
    mocks.quotes.mockResolvedValue([
      quote("kyberswap", 1n, 1000000000000000000n, 1000000n),
      quote("nordstern", 1n, 999900000000000000n, 10000n),
      quote("curve", 1n, 900000000000000000n),
    ]);
    const { body } = await call();
    expect(body.recommendation).toBe("nordstern");
    expect(body.recommendation_basis).toBe("gas_adjusted");
    expect(body.quotes.map((q: { provider: string }) => q.provider)).toEqual([
      "nordstern",
      "kyberswap",
      "curve",
    ]);
  });
  it("ranks exact output by input plus gas", async () => {
    mocks.quotes.mockResolvedValue([
      quote("kyberswap", 1000000000000000000n, 1000000000000000000n, 1000000n),
      quote("curve", 1000100000000000000n, 1000000000000000000n, 10000n),
    ]);
    const { body } = await call({ from: WETH, to: TO, mode: "targetOut" });
    expect(body.recommendation).toBe("curve");
    expect(body.recommendation_basis).toBe("gas_adjusted");
  });
  it.each(["missing gas", "missing price", "missing conversion"])(
    "uses one raw basis for every candidate with %s",
    async (reason) => {
      mocks.quotes.mockResolvedValue([
        quote("kyberswap", 1n, 1000000000000000000n, 1000000n),
        quote("nordstern", 1n, 999900000000000000n, 10000n),
        quote("curve", 1n, 900000000000000000n, reason === "missing gas" ? null : 10000n),
      ]);
      if (reason === "missing price") mocks.gas.mockRejectedValue(new Error("Gas RPC unavailable"));
      const { body } = await call(reason === "missing conversion" ? { to: TO } : {});
      expect(body.recommendation_basis).toBe("raw_amount");
      expect(body.recommendation).toBe("kyberswap");
      expect(body.recommendation_reason).toContain("all routes by raw output");
    }
  );
  it("breaks equal-value ties by provider configuration order", async () => {
    mocks.quotes.mockResolvedValue([quote("curve"), quote("nordstern"), quote("kyberswap")]);
    const { body } = await call();
    expect(body.quotes.map((q: { provider: string }) => q.provider)).toEqual([
      "kyberswap",
      "nordstern",
      "curve",
    ]);
  });
  it("compares amounts above Number precision exactly", async () => {
    mocks.quotes.mockResolvedValue([
      quote("kyberswap", 1n, 9007199254740992000000000000000000n),
      quote("curve", 1n, 9007199254740992000000000000000001n),
    ]);
    expect((await call()).body.recommendation).toBe("curve");
  });
});
