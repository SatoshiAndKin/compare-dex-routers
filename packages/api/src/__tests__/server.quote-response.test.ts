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
  usd: vi.fn(),
  allowance: vi.fn(),
  approvalGas: vi.fn(),
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
vi.mock("../usd-price.js", async (original) => ({
  ...(await original<typeof import("../usd-price.js")>()),
  getNativeUsdConversion: mocks.usd,
}));
vi.mock("../preview-simulation.js", () => ({ createPreviewState: () => mocks.preview }));
vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  getTokenDecimals: async (_chain: number, token: string) => (token === FROM ? 6 : 18),
  getTokenSymbol: async () => "TOKEN",
  getClient: () => ({
    getGasPrice: mocks.gas,
    getBlockNumber: async () => 100n,
    readContract: mocks.allowance,
    estimateGas: mocks.approvalGas,
  }),
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
  mocks.usd.mockResolvedValue({
    native_price_usd: "2000",
    source: "defillama",
    updated_at: Math.floor(Date.now() / 1000),
  });
  mocks.rate.mockResolvedValue(null);
  mocks.allowance.mockResolvedValue(0n);
  mocks.approvalGas.mockResolvedValue(50000n);
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

describe("remaining approval costs", () => {
  const OTHER_ROUTER = "0x5555555555555555555555555555555555555555";
  it.each(["exactIn", "targetOut"])(
    "ranks %s with only the approvals this wallet still needs",
    async (mode) => {
      const approved = quote(
        "curve",
        mode === "exactIn" ? 1000000n : 1000020000000000000n,
        mode === "exactIn" ? 999980000000000000n : 1000000000000000000n
      );
      const unapproved = {
        ...quote("kyberswap", mode === "exactIn" ? 1000000n : 1000000000000000000n),
        approval: { token: FROM, spender: OTHER_ROUTER },
      };
      mocks.quotes.mockResolvedValue([unapproved, approved]);
      mocks.allowance.mockImplementation(async ({ args }: { args: string[] }) =>
        args[1] === ROUTER ? approved.inputAmount : 0n
      );
      const query = {
        sender: SENDER,
        mode,
        ...(mode === "targetOut" ? { from: WETH, to: TO } : {}),
      };
      const { body } = await call(query);
      expect(body.recommendation).toBe("curve");
      expect(body.recommendation_basis).toBe("gas_adjusted");
      expect(body.quotes).toMatchObject([
        {
          provider: "curve",
          gas_used: "10000",
          approval_gas_used: "0",
          approval_gas_cost_native: "0",
          gas_cost_native: "0.00001",
        },
        {
          provider: "kyberswap",
          gas_used: "10000",
          approval_gas_used: "50000",
          approval_gas_cost_native: "0.00005",
          gas_cost_native: "0.00006",
        },
      ]);
      expect(body.quotes[0].net_value_native).toBe(mode === "exactIn" ? "0.99997" : "1.00003");
      expect(mocks.allowance).toHaveBeenCalledWith(
        expect.objectContaining({ address: FROM, args: [SENDER, OTHER_ROUTER], blockNumber: 100n })
      );
      expect(mocks.approvalGas).toHaveBeenCalledTimes(1);
      expect(mocks.approvalGas).toHaveBeenCalledWith(
        expect.objectContaining({
          account: SENDER,
          to: FROM,
          blockNumber: 100n,
          data: `0x095ea7b3${OTHER_ROUTER.slice(2).padStart(64, "0")}${"f".repeat(64)}`,
        })
      );
      mocks.allowance.mockResolvedValue(2n ** 256n - 1n);
      const refreshed = (await call(query)).body;
      expect(refreshed.recommendation).toBe("kyberswap");
      expect(
        refreshed.quotes.every((q: { approval_gas_used: string }) => q.approval_gas_used === "0")
      ).toBe(true);
    }
  );
  it("checks each exact-output input against the shared allowance", async () => {
    mocks.quotes.mockResolvedValue([quote("curve", 1000000n), quote("kyberswap", 1000001n)]);
    mocks.allowance.mockResolvedValue(1000000n);
    const { body } = await call({ sender: SENDER, mode: "targetOut" });
    expect(
      body.quotes.map((q: { provider: string; approval_gas_used: string }) => [
        q.provider,
        q.approval_gas_used,
      ])
    ).toEqual([
      ["curve", "0"],
      ["kyberswap", "50000"],
    ]);
    expect(mocks.allowance).toHaveBeenCalledTimes(1);
  });
  it("reads the new wallet's allowance instead of reusing the previous wallet's", async () => {
    mocks.allowance.mockImplementation(async ({ args }: { args: string[] }) =>
      args[0] === SENDER ? 1000000n : 0n
    );
    expect((await call({ sender: SENDER })).body.quotes[0].approval_gas_used).toBe("0");
    expect((await call({ sender: OTHER_ROUTER })).body.quotes[0].approval_gas_used).toBe("50000");
    expect(mocks.allowance).toHaveBeenCalledWith(
      expect.objectContaining({ args: [OTHER_ROUTER, ROUTER] })
    );
  });
  it("estimates approval when a nonzero allowance is below this route's input", async () => {
    mocks.allowance.mockResolvedValue(999999n);
    const { body } = await call({ sender: SENDER });
    expect(body.quotes[0].approval_gas_used).toBe("50000");
    // Shared token/spender estimates are reused within this response only.
    expect(mocks.approvalGas).toHaveBeenCalledTimes(1);
  });
  it.each(["allowance", "approval estimate", "invalid estimate", "metadata"])(
    "falls back fairly when %s is unavailable",
    async (missing) => {
      if (missing === "allowance") mocks.allowance.mockRejectedValue(new Error("RPC unavailable"));
      if (missing === "approval estimate")
        mocks.approvalGas.mockRejectedValue(new Error("Approval reverted"));
      if (missing === "invalid estimate") mocks.approvalGas.mockResolvedValue(0n);
      if (missing === "metadata")
        mocks.quotes.mockResolvedValue([{ ...quote(), approval: undefined }]);
      const { body } = await call({ sender: SENDER });
      expect(body.quotes[0]).toMatchObject({
        gas_used: "10000",
        approval_gas_used: null,
        gas_cost_native: null,
        net_value_native: null,
      });
      expect(body.recommendation_basis).toBe("raw_amount");
    }
  );
  it("never estimates or charges approvals for native input", async () => {
    const { body } = await call({
      from: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      sender: SENDER,
    });
    expect(body.quotes[0]).toMatchObject({ approval_gas_used: "0", gas_cost_native: "0.00001" });
    expect(mocks.allowance).not.toHaveBeenCalled();
    expect(mocks.approvalGas).not.toHaveBeenCalled();
  });
  it("includes an approval estimate for disconnected previews", async () => {
    const { body } = await call();
    expect(body.quotes[0]).toMatchObject({
      sender: null,
      approval_gas_used: "50000",
      gas_cost_native: "0.00006",
    });
  });
});

describe("display-only USD conversion", () => {
  it.each(["exactIn", "targetOut"])(
    "preserves %s ranking across USD rates and outages",
    async (mode) => {
      mocks.quotes.mockResolvedValue([
        quote("kyberswap", 1000000000000000000n, 1000000000000000000n, 1000000n),
        quote(
          "curve",
          1000100000000000000n,
          mode === "targetOut" ? 1000000000000000000n : 999900000000000000n,
          10000n
        ),
      ]);
      const query: Record<string, string> =
        mode === "targetOut" ? { mode, from: WETH, to: TO } : { mode };
      const original = (await call(query)).body;
      expect(original.recommendation).toBe("curve");
      expect(original.usd_conversion.native_price_usd).toBe("2000");
      expect(original.quotes[0].net_value_usd).toBe(mode === "targetOut" ? "2000.32" : "1999.68");
      expect(original.quotes[0].gas_cost_usd).toBe("0.12");
      expect(original.quotes[0].approval_gas_cost_usd).toBe("0.1");
      for (const conversion of [
        null,
        {
          native_price_usd: "0.000001",
          source: "defillama",
          updated_at: Math.floor(Date.now() / 1000),
        },
      ]) {
        mocks.usd.mockResolvedValue(conversion);
        const next = (await call(query)).body;
        expect(next.recommendation).toBe(original.recommendation);
        expect(next.recommendation_basis).toBe(original.recommendation_basis);
        expect(
          next.quotes.map((q: { provider: string; net_value_native: string }) => [
            q.provider,
            q.net_value_native,
          ])
        ).toEqual(
          original.quotes.map((q: { provider: string; net_value_native: string }) => [
            q.provider,
            q.net_value_native,
          ])
        );
        if (conversion === null) expect(next.quotes[0].net_value_usd).toBeNull();
      }
    }
  );
  it("keeps available USD gas costs but omits adjusted USD totals for raw rankings", async () => {
    const { body } = await call({ to: TO });
    expect(body.recommendation_basis).toBe("raw_amount");
    expect(body.quotes[0]).toMatchObject({
      gas_cost_usd: "0.12",
      approval_gas_cost_usd: "0.1",
      trade_value_usd: null,
      net_value_usd: null,
    });
  });
  it("charges zero USD for approvals that are already sufficient", async () => {
    mocks.allowance.mockResolvedValue(2n ** 256n - 1n);
    const { body } = await call({ sender: SENDER });
    expect(body.quotes[0]).toMatchObject({
      approval_gas_cost_usd: "0",
      gas_cost_usd: "0.02",
      net_value_usd: "1999.98",
    });
  });
  it("rejects a conversion that became stale while quotes were loading", async () => {
    mocks.usd.mockResolvedValue({
      native_price_usd: "2000",
      source: "defillama",
      updated_at: Math.floor(Date.now() / 1000) - 601,
    });
    const { body } = await call();
    expect(body.usd_conversion).toBeNull();
    expect(body.quotes[0].net_value_usd).toBeNull();
    expect(body.recommendation_basis).toBe("gas_adjusted");
  });
});
