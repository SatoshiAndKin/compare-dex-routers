import { beforeEach, describe, expect, it, vi } from "vitest";
import { comparisonStore as store } from "../lib/stores/comparisonStore.svelte.js";
import { deferred, FROM, TO, makeComparison } from "./quote-fixture.js";
type TestResponse = { data: ReturnType<typeof makeComparison>; response: Response };
const { get } = vi.hoisted(() => ({ get: vi.fn<(...args: unknown[]) => Promise<TestResponse>>() }));
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
const params = {
  chainId: 1,
  from: FROM,
  to: TO,
  amount: "100",
  slippageBps: 50,
  mode: "exactIn" as const,
};
beforeEach(() => {
  store.invalidate();
  get.mockReset();
});
describe("one comparison response", () => {
  it("follows a new recommendation after a temporary Curve selection", async () => {
    get.mockResolvedValue({
      data: makeComparison({ recommendation: "curve" }),
      response: new Response(),
    });
    await store.compare(params);
    store.selectedProvider = "curve";
    get.mockResolvedValue({ data: makeComparison(), response: new Response() });
    await store.compare(params);
    expect(store.activeQuote?.provider).toBe("0x");
    expect(store.selectedProvider).toBeNull();
  });
  it("uses the server recommendation even when Curve has higher raw output", async () => {
    const data = makeComparison();
    get.mockResolvedValue({ data, response: new Response() });
    await store.compare(params);
    expect(get).toHaveBeenCalledExactlyOnceWith("/quote", {
      params: { query: params },
      signal: expect.any(AbortSignal),
    });
    expect(store.quotes[0]?.output_amount).toBe("99.95");
    expect(store.quotes[1]?.output_amount).toBe("99.98");
    expect(store.recommendation).toBe("0x");
    expect(store.recommendationReason).toBe(data.recommendation_reason);
    expect(store.recommendationBasis).toBe("gas_adjusted");
  });
  it.each(["exactIn", "targetOut"] as const)(
    "preserves server order and recommendation for %s",
    async (mode) => {
      const data = makeComparison({
        mode,
        recommendation: "curve",
        recommendation_basis: "raw_amount",
      });
      get.mockResolvedValue({ data, response: new Response() });
      await store.compare({ ...params, mode });
      expect(store.quotes).toEqual(data.quotes);
      expect(store.activeQuote?.provider).toBe("curve");
      expect(store.mode).toBe(mode);
      expect(store.recommendationBasis).toBe("raw_amount");
    }
  );
  it("keeps a manual selection on failure and replaces it only with the latest successful response", async () => {
    get.mockResolvedValue({ data: makeComparison(), response: new Response() });
    await store.compare(params);
    store.selectProvider("curve");
    const previous = store.activeQuote!;
    get.mockRejectedValueOnce(new Error("offline"));
    await store.compare(params);
    expect(store.activeQuote).toBe(previous);
    expect(store.isCurrent(previous)).toBe(false);
    const old = deferred<TestResponse>();
    const latest = deferred<TestResponse>();
    get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const first = store.compare(params);
    const second = store.compare(params);
    old.resolve({ data: makeComparison({ recommendation: "curve" }), response: new Response() });
    await first;
    expect(store.activeQuote).toBe(previous);
    expect(store.isLoading).toBe(true);
    latest.resolve({ data: makeComparison(), response: new Response() });
    await second;
    expect(store.activeQuote?.provider).toBe("0x");
    expect(store.isCurrent(store.activeQuote!)).toBe(true);
  });
  it("requires an explicit choice if the workflow provider disappears, even if it returns", async () => {
    store.workflowProvider = "curve";
    const data = makeComparison();
    get.mockResolvedValueOnce({
      data: { ...data, quotes: [data.quotes[0]!] },
      response: new Response(),
    });
    await store.compare(params);
    expect(store.activeProvider).toBe("curve");
    expect(store.activeQuote).toBeNull();
    get.mockResolvedValue({ data, response: new Response() });
    await store.compare(params);
    expect(store.activeQuote).toBeNull();
    store.selectProvider("0x");
    expect(store.activeQuote?.provider).toBe("0x");
    expect(store.workflowProvider).toBeNull();
  });
  it.each(["resolve", "reject"] as const)(
    "ignores an old request that finishes with %s while its replacement loads",
    async (finish) => {
      const old = deferred<Awaited<ReturnType<typeof get>>>();
      const latest = deferred<Awaited<ReturnType<typeof get>>>();
      get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
      const first = store.compare(params);
      const second = store.compare({ ...params, slippageBps: 100 });
      if (finish === "resolve") old.resolve({ data: makeComparison(), response: new Response() });
      else old.reject(new Error("old request failed"));
      await first;
      expect(store.isLoading).toBe(true);
      expect(store.quotes).toEqual([]);
      expect(store.error).toBeNull();
      latest.resolve({
        data: makeComparison({ recommendation: "curve" }),
        response: new Response(),
      });
      await second;
      expect(store.isLoading).toBe(false);
      expect(store.recommendation).toBe("curve");
    }
  );
  it("keeps canceled results empty when transport ignores AbortSignal", async () => {
    const pending = deferred<Awaited<ReturnType<typeof get>>>();
    get.mockReturnValueOnce(pending.promise);
    const comparison = store.compare(params);
    store.invalidate();
    pending.resolve({ data: makeComparison(), response: new Response() });
    await comparison;
    expect(store.hasResults).toBe(false);
  });
  it("publishes one request error", async () => {
    get.mockRejectedValue(new Error("network unavailable"));
    await store.compare(params);
    expect(store.error).toBe("network unavailable");
    expect(store.isLoading).toBe(false);
  });
});

it("retains the previous USD snapshot until the latest complete response succeeds", async () => {
  const initial = makeComparison();
  get.mockResolvedValue({ data: initial, response: new Response() });
  await store.compare(params);
  const older = deferred<TestResponse>();
  get.mockReturnValueOnce(older.promise);
  const oldRequest = store.compare(params);
  expect(store.usdConversion).toEqual(initial.usd_conversion);
  expect(store.quotes[0]?.net_value_usd).toBe("995.2");
  expect(store.isCurrent(store.quotes[0]!)).toBe(false);
  const next = makeComparison({
    usd_conversion: null,
    quotes: initial.quotes.map((q) => ({ ...q, net_value_usd: null, gas_cost_usd: null })),
  });
  get.mockResolvedValueOnce({ data: next, response: new Response() });
  await store.compare(params);
  older.resolve({ data: initial, response: new Response() });
  await oldRequest;
  expect(store.usdConversion).toBeNull();
  expect(store.quotes[0]?.net_value_usd).toBeNull();
  get.mockRejectedValueOnce(new Error("offline"));
  await store.compare(params);
  expect(store.usdConversion).toBeNull();
  expect(store.quotes).toEqual(next.quotes);
  expect(store.isCurrent(store.quotes[0]!)).toBe(false);
});

describe("balance-aware comparisons", () => {
  const walletParams = { ...params, sender: "0x2222222222222222222222222222222222222222" };
  const preview = () => {
    const data = makeComparison({ recommendation_basis: "raw_amount" });
    data.quotes = data.quotes.map((quote) => ({
      ...quote,
      sender: null,
      execution: null,
      simulation_status: "not_run" as const,
      gas_used: null,
    }));
    return data;
  };
  it.each([null, 0n, 99999999n, 100000000n, 100000001n])(
    "selects the sender using raw input balance %s",
    async (raw) => {
      get.mockResolvedValue({
        data: raw !== null && raw >= 100000000n ? makeComparison() : preview(),
        response: new Response(),
      });
      await store.compare(walletParams, { read: () => raw, decimals: 6 });
      expect(get).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0]?.[1]).toMatchObject({
        params: {
          query: { sender: raw !== null && raw >= 100000000n ? walletParams.sender : undefined },
        },
      });
    }
  );
  it("does not send a wallet request when every exact-output preview is unaffordable", async () => {
    get.mockResolvedValue({ data: preview(), response: new Response() });
    await store.compare(
      { ...walletParams, mode: "targetOut" },
      { read: () => 99999999n, decimals: 6 }
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.quotes.every((quote) => quote.execution === null)).toBe(true);
  });
  it("publishes exact-output results together and preserves a preview when the wallet provider fails", async () => {
    const first = preview();
    first.mode = "targetOut";
    first.quotes = first.quotes.map((quote) => ({ ...quote, mode: "targetOut" }));
    const next = makeComparison({ mode: "targetOut", quotes: [makeComparison().quotes[0]!] });
    next.failures = [
      {
        provider: "curve",
        stage: "quote",
        error: {
          name: "Error",
          message: "Wallet route unavailable",
          code: null,
          cause: null,
          details: null,
        },
      },
    ];
    const pending = deferred<TestResponse>();
    get
      .mockResolvedValueOnce({ data: first, response: new Response() })
      .mockReturnValueOnce(pending.promise);
    const work = store.compare(
      { ...walletParams, mode: "targetOut" },
      { read: () => 100000000n, decimals: 6 }
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(store.quotes).toEqual([]);
    expect(store.isLoading).toBe(true);
    expect(get.mock.calls[0]?.[1]).toMatchObject({ params: { query: { sender: undefined } } });
    expect(get.mock.calls[1]?.[1]).toMatchObject({
      params: { query: { sender: walletParams.sender } },
    });
    pending.resolve({ data: next, response: new Response() });
    await work;
    expect(store.quotes[1]).toMatchObject({
      provider: "curve",
      sender: null,
      execution: null,
      simulation_status: "not_run",
      trade_value_usd: null,
      gas_used: null,
    });
    expect(store.quotes[1]?.simulation_reason).toContain("Wallet route unavailable");
    expect(store.failures).toEqual([]);
    expect(store.recommendation).toBe("0x");
  });
  it("keeps previews when the wallet pass fails and never starts a third pass", async () => {
    get
      .mockResolvedValueOnce({ data: preview(), response: new Response() })
      .mockRejectedValueOnce(new Error("offline"));
    await store.compare(
      { ...walletParams, mode: "targetOut" },
      { read: () => 100000000n, decimals: 6 }
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.quotes).toHaveLength(2);
    expect(store.error).toBe("Wallet verification failed: offline");
    expect(store.isCurrent(store.quotes[0]!)).toBe(false);
  });
  it("ignores an obsolete wallet pass after an account change with sender-free requests", async () => {
    const pending = deferred<TestResponse>();
    get
      .mockResolvedValueOnce({ data: preview(), response: new Response() })
      .mockReturnValueOnce(pending.promise);
    const old = store.compare(
      { ...walletParams, mode: "targetOut" },
      { read: () => 100000000n, decimals: 6 }
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    get.mockResolvedValueOnce({ data: preview(), response: new Response() });
    await store.compare({ ...walletParams, sender: FROM }, { read: () => 0n, decimals: 6 });
    pending.resolve({ data: makeComparison(), response: new Response() });
    await old;
    expect(store.quotes.every((quote) => quote.sender === null)).toBe(true);
  });
});
