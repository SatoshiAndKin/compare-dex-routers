import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteParams } from "../quote.js";

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
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  product = {
    product_id: "ETH-USDC",
    base_currency_id: "ETH",
    quote_currency_id: "USDC",
    status: "online",
    trading_disabled: false,
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
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(url.includes("product_book") ? { pricebook: book } : product))
    )
  );
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
  ])("rejects unmapped, wrapped, or identical assets without a fetch: %j", async (override) => {
    expect(await estimate(override)).toMatchObject({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
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
  it.each(["trading_disabled", "cancel_only", "post_only", "auction_mode"])(
    "rejects a market with %s",
    async (flag) => {
      product[flag] = true;
      expect(await estimate()).toMatchObject({ status: "unavailable" });
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
