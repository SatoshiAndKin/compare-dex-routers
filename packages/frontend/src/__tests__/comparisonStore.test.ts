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
