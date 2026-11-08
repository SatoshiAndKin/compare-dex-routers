import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteParams } from "../quote.js";

const decimalsMock = vi.hoisted(() => vi.fn());
vi.mock("../config.js", () => ({
  getNativeAsset: (chainId: number) => ({
    symbol: chainId === 137 ? "POL" : chainId === 43114 ? "AVAX" : chainId === 56 ? "BNB" : "ETH",
  }),
  getTokenDecimals: decimalsMock,
}));

const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const fetchMock = vi.fn();
const params: QuoteParams = {
  chainId: 1,
  from: ETH,
  to: USDC,
  amount: "2",
  mode: "exactIn",
  slippageBps: 50,
};
let product: Record<string, unknown>;
let book: Record<string, unknown>;
let currencies: Record<string, unknown>[];
let products: Record<string, unknown>[] | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  decimalsMock
    .mockReset()
    .mockImplementation(async (_chainId: number, address: string) =>
      [
        USDC.toLowerCase(),
        USDT.toLowerCase(),
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      ].includes(address.toLowerCase())
        ? 6
        : 18
    );
  currencies = [
    {
      id: "ETH",
      supported_networks: ["ethereum", "base", "arbitrum", "optimism"].map((id) => ({
        id,
        contract_address: "",
      })),
    },
    {
      id: "USDC",
      supported_networks: [
        { id: "ethereum", contract_address: USDC },
        ...["base", "arbitrum", "optimism"].map((id) => ({ id, contract_address: "" })),
      ],
    },
    { id: "USDT", supported_networks: [{ id: "ethereum", contract_address: USDT }] },
  ];
  products = undefined;
  product = {
    product_id: "ETH-USDC",
    base_currency_id: "ETH",
    quote_currency_id: "USDC",
    status: "online",
    trading_disabled: false,
    is_disabled: false,
    view_only: false,
    cancel_only: false,
    limit_only: false,
    post_only: false,
    auction_mode: false,
    base_min_size: "0.00000001",
    base_max_size: "100000",
    quote_min_size: "1",
    quote_max_size: "100000000",
  };
  book = {
    product_id: "ETH-USDC",
    time: new Date().toISOString(),
    bids: [
      { price: "2000", size: "1" },
      { price: "1900", size: "2" },
    ],
    asks: [
      { price: "2100", size: "1" },
      { price: "2200", size: "2" },
    ],
  };
  fetchMock.mockImplementation((url: string) => {
    let body: unknown = product;
    if (url.includes("api.exchange.coinbase.com/currencies")) body = currencies;
    else if (url.includes("/market/products?"))
      body = {
        products: products ?? [{ ...product, product_type: "SPOT" }],
        pagination: { has_next: false, next_cursor: "" },
      };
    else if (url.includes("product_book")) body = { pricebook: book };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function estimate(overrides: Partial<QuoteParams> = {}, fee: string | null = "1") {
  const { getCoinbaseEstimate } = await import("../coinbase.js");
  return getCoinbaseEstimate({ ...params, ...overrides }, fee);
}

describe("Coinbase Advanced estimates", () => {
  it("consumes sell depth and deducts the assumed fee from quote proceeds", async () => {
    expect(await estimate()).toMatchObject({
      status: "ready",
      product_id: "ETH-USDC",
      side: "SELL",
      input_amount: "2",
      output_amount: "3861",
      fee_percent: "1",
      fee_amount: "39",
      fee_symbol: "USDC",
      trade_url: "https://www.coinbase.com/advanced-trade/spot/ETH-USDC",
    });
    expect(fetchMock.mock.calls.every((call) => !call[1].headers.Authorization)).toBe(true);
  });
  it("budgets buy input for fees before consuming ask depth", async () => {
    expect(await estimate({ from: USDC, to: ETH, amount: "4343" })).toMatchObject({
      status: "ready",
      side: "BUY",
      input_amount: "4343",
      output_amount: "2",
      fee_amount: "43",
    });
  });
  it("includes fees in target-output buy cost", async () => {
    expect(await estimate({ from: USDC, to: ETH, mode: "targetOut" })).toMatchObject({
      status: "ready",
      input_amount: "4343",
      output_amount: "2",
    });
  });
  it("grosses up target-output sell proceeds before walking bids", async () => {
    expect(await estimate({ amount: "3861", mode: "targetOut" })).toMatchObject({
      status: "ready",
      input_amount: "2",
      output_amount: "3861",
    });
  });
  it("marks missing fees explicitly and distinguishes an explicit zero", async () => {
    expect(await estimate({}, null)).toMatchObject({
      status: "ready",
      output_amount: "3900",
      fee_percent: null,
      fee_amount: null,
    });
    expect(await estimate({}, "0")).toMatchObject({
      status: "ready",
      output_amount: "3900",
      fee_percent: "0",
      fee_amount: "0",
    });
  });
  it("uses the listed stablecoin pair in both directions", async () => {
    product = {
      ...product,
      product_id: "USDT-USDC",
      base_currency_id: "USDT",
      quote_currency_id: "USDC",
    };
    book = {
      ...book,
      product_id: "USDT-USDC",
      bids: [{ price: "0.9999", size: "1000" }],
      asks: [{ price: "1.0001", size: "1000" }],
    };
    expect(await estimate({ from: USDT, to: USDC, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      output_amount: "99.99",
    });
    expect(await estimate({ from: USDC, to: USDT, amount: "100.01" }, "0")).toMatchObject({
      status: "ready",
      output_amount: "100",
    });
  });
  it.each([
    { from: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
    { chainId: 56 },
    { from: "0x1111111111111111111111111111111111111111" },
    { to: ETH },
  ])("rejects unmapped, wrapped, or identical assets: %j", async (override) => {
    expect(await estimate(override)).toMatchObject({ status: "unavailable" });
    expect(fetchMock.mock.calls.some((call) => (call[0] as string).includes("product_book"))).toBe(
      false
    );
  });
  it.each(["exactIn", "targetOut"] as const)(
    "rejects insufficient %s depth instead of quoting a partial fill",
    async (mode) => {
      expect(await estimate({ mode, amount: "999999" })).toMatchObject({
        status: "unavailable",
        reason: expect.stringContaining("depth"),
      });
    }
  );
  it.each([
    "trading_disabled",
    "is_disabled",
    "view_only",
    "cancel_only",
    "post_only",
    "auction_mode",
  ])("rejects a market with %s", async (flag) => {
    product[flag] = true;
    expect(await estimate()).toMatchObject({ status: "unavailable" });
  });
  it.each(["is_disabled", "view_only"])(
    "requires the %s status instead of assuming trading is enabled",
    async (flag) => {
      product[flag] = undefined;
      expect(await estimate()).toMatchObject({
        status: "unavailable",
        reason: "Coinbase returned invalid market data.",
      });
    }
  );
  it("estimates limit-only markets and reports the required order type", async () => {
    product.limit_only = true;
    expect(await estimate()).toMatchObject({ status: "ready", limit_only: true });
  });
  it.each([
    [8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
    [10, "0x0b2c639c533813f4aa9d7837caf62653d097ff85"],
    [42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"],
  ])("maps native ETH and USDC by chain/address on %i", async (chainId, to) => {
    expect(await estimate({ chainId, to })).toMatchObject({
      status: "ready",
      input_symbol: "ETH",
      output_symbol: "USDC",
    });
  });
  it("rejects mismatched product identity", async () => {
    product.quote_currency_id = "USD";
    expect(await estimate()).toMatchObject({ status: "unavailable" });
  });
  it.each([-31000, 10000])("rejects old or future books (%i ms)", async (offset) => {
    book.time = new Date(Date.now() + offset).toISOString();
    expect(await estimate()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("stale"),
    });
  });
  it("rejects malformed levels and unavailable markets", async () => {
    book.bids = [{ price: "NaN", size: "1" }];
    expect(await estimate()).toMatchObject({ status: "unavailable" });
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    expect(await estimate()).toMatchObject({ status: "unavailable" });
  });
  it("rejects precision loss and quantities below market minimums", async () => {
    expect(await estimate({ from: USDC, to: ETH, amount: "1.0000001" })).toMatchObject({
      status: "unavailable",
    });
    expect(await estimate({ amount: "0.000000001" })).toMatchObject({ status: "unavailable" });
  });
  it("keeps fractional fees and large values out of binary floats", async () => {
    book.bids = [{ price: "2000.12345678", size: "100" }];
    expect(await estimate({ amount: "10" }, "0.125")).toMatchObject({
      status: "ready",
      output_amount: "19976.233024",
    });
  });
  it("coalesces requests for the same public market", async () => {
    await Promise.all([estimate(), estimate({ amount: "1" })]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Coinbase asset catalog", () => {
  function balMarket() {
    const address = "0xba100000625a3754423978a60c9317c58a424e3D";
    currencies.push({
      id: "BAL",
      supported_networks: [{ id: "ethereum", contract_address: address }],
    });
    product = { ...product, product_id: "BAL-USDC", base_currency_id: "BAL", limit_only: true };
    book = {
      ...book,
      product_id: "BAL-USDC",
      bids: [{ price: "1.9", size: "1000" }],
      asks: [{ price: "2", size: "1000" }],
    };
    return address;
  }
  it("discovers BAL and its USDC market without a per-asset allowlist", async () => {
    const bal = balMarket();
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      product_id: "BAL-USDC",
      side: "BUY",
      input_amount: "100",
      output_amount: "50",
      output_symbol: "BAL",
      limit_only: true,
    });
    expect(await estimate({ from: bal, to: USDC, amount: "10" }, "0")).toMatchObject({
      status: "ready",
      side: "SELL",
      input_amount: "10",
      output_amount: "19",
    });
    expect(decimalsMock).toHaveBeenCalledWith(1, bal);
  });
  it("discovers an arbitrary new listing and its onchain decimal precision", async () => {
    const address = "0x1234567890123456789012345678901234567890";
    currencies.push({
      id: "NEW",
      supported_networks: [{ id: "ethereum", contract_address: address }],
    });
    product = { ...product, product_id: "NEW-USDC", base_currency_id: "NEW" };
    book = { ...book, product_id: "NEW-USDC" };
    decimalsMock.mockResolvedValue(8);
    expect(await estimate({ from: USDC, to: address, amount: "2100" }, "0")).toMatchObject({
      status: "ready",
      output_symbol: "NEW",
      output_decimals: 8,
      output_amount_raw: "100000000",
    });
    expect(await estimate({ from: address, amount: "1.000000001" }, "0")).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("precision"),
    });
  });
  it("preserves onchain precision above 18 decimals", async () => {
    const bal = balMarket();
    decimalsMock.mockImplementation(async (_chainId: number, address: string) =>
      address === bal ? 24 : 6
    );
    book.bids = [{ price: "1", size: "1000" }];
    product.base_min_size = "0.000000000000000001";
    product.quote_min_size = "0.000000000000000001";
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      output_decimals: 24,
      output_amount_raw: "50000000000000000000000000",
    });
    expect(await estimate({ from: bal, amount: "1.000000000000000001000001" }, "0")).toMatchObject({
      status: "ready",
      input_amount: "1.000000000000000001000001",
      input_amount_raw: "1000000000000000001000001",
      output_amount: "1",
    });
  });
  it("rejects the real contract on a different chain", async () => {
    const bal = balMarket();
    expect(
      await estimate({ chainId: 8453, from: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", to: bal })
    ).toMatchObject({ status: "unavailable", reason: expect.stringContaining("identity") });
  });
  it("rejects conflicting Coinbase identities for the same contract", async () => {
    const bal = balMarket();
    currencies.push({
      id: "OTHER",
      supported_networks: [{ id: "ethereum", contract_address: bal }],
    });
    expect(await estimate({ to: bal })).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("unambiguous"),
    });
  });
  it("uses explicit Coinbase token links when its contract field is empty", async () => {
    const bal = balMarket();
    currencies[currencies.length - 1] = {
      id: "BAL",
      supported_networks: [
        {
          id: "ethereum",
          contract_address: "",
          crypto_address_link: `https://etherscan.io/token/${bal}?a={{address}}`,
        },
      ],
    };
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      output_amount: "50",
    });
  });
  it("never guesses a token identity from a wallet-address link", async () => {
    const bal = balMarket();
    currencies[currencies.length - 1] = {
      id: "BAL",
      supported_networks: [
        {
          id: "ethereum",
          contract_address: "",
          crypto_address_link: "https://etherscan.io/address/{{address}}",
        },
      ],
    };
    expect(await estimate({ from: USDC, to: bal })).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("identity"),
    });
  });
  it("requires Coinbase network support even for issuer-published USDC", async () => {
    currencies[1] = {
      id: "USDC",
      supported_networks: [{ id: "ethereum", contract_address: USDC }],
    };
    expect(
      await estimate({ chainId: 8453, to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" })
    ).toMatchObject({ status: "unavailable", reason: expect.stringContaining("identity") });
  });
  it("does not replace a missing USDC market with USD or a synthetic route", async () => {
    const bal = balMarket();
    products = [
      { ...product, product_type: "SPOT", product_id: "BAL-USD", quote_currency_id: "USD" },
    ];
    expect(await estimate({ from: USDC, to: bal })).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("No direct Coinbase market"),
    });
  });
  it("follows catalog pagination to discover assets beyond the first page", async () => {
    const bal = balMarket();
    const original = fetchMock.getMockImplementation();
    if (!original) throw new Error("Missing fetch fixture");
    fetchMock.mockImplementation((url: string) => {
      if (!url.includes("/market/products?")) return original(url);
      const next = new URL(url).searchParams.get("cursor");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            products: next ? [{ ...product, product_type: "SPOT" }] : [],
            pagination: { has_next: !next, next_cursor: next ? "" : "page2" },
          })
        )
      );
    });
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      output_amount: "50",
    });
    expect(fetchMock.mock.calls.some((call) => (call[0] as string).includes("cursor=page2"))).toBe(
      true
    );
  });
  it("rejects a repeated catalog cursor instead of accepting a partial list", async () => {
    const original = fetchMock.getMockImplementation();
    if (!original) throw new Error("Missing fetch fixture");
    fetchMock.mockImplementation((url: string) =>
      url.includes("/market/products?")
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                products: [{ ...product, product_type: "SPOT" }],
                pagination: { has_next: true, next_cursor: "same" },
              })
            )
          )
        : original(url)
    );
    expect(await estimate()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("incomplete market catalog"),
    });
  });
  it("excludes derivative products from spot comparison", async () => {
    products = [{ ...product, product_type: "FUTURE" }];
    expect(await estimate()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("No direct Coinbase market"),
    });
  });
  it("refreshes listings after the catalog TTL instead of keeping an asset allowlist", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await estimate({}, "0")).toMatchObject({ status: "ready" });
    const bal = balMarket();
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "unavailable",
    });
    clock.mockReturnValue(now + 300001);
    book.time = new Date(now + 300001).toISOString();
    expect(await estimate({ from: USDC, to: bal, amount: "100" }, "0")).toMatchObject({
      status: "ready",
      output_amount: "50",
    });
  });
  it("fails closed on expired catalog refresh errors and recovers on the next request", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await estimate()).toMatchObject({ status: "ready" });
    clock.mockReturnValue(now + 300001);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await estimate()).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("catalog is unavailable"),
    });
    book.time = new Date(now + 300001).toISOString();
    expect(await estimate()).toMatchObject({ status: "ready" });
  });
  it("reports token metadata failure without leaking RPC details", async () => {
    decimalsMock.mockRejectedValue(new Error("https://private-rpc.example/secret"));
    expect(await estimate()).toEqual({
      status: "unavailable",
      reason: "Coinbase estimate is unavailable. Refresh to retry.",
    });
  });
  it("aborts stalled upstream calls within the request budget", async () => {
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason))
        )
    );
    expect(await estimate()).toMatchObject({ status: "unavailable" });
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
});
