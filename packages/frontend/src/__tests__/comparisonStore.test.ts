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
  it("uses the server recommendation even when Curve has higher raw output", async () => {
    const data = makeComparison();
    get.mockResolvedValue({ data, response: new Response() });
    await store.compare(params);
    expect(get).toHaveBeenCalledExactlyOnceWith("/compare", {
      params: { query: params },
      signal: expect.any(AbortSignal),
    });
    expect(store.spandexResult?.output_amount).toBe("99.95");
    expect(store.curveResult?.output_amount).toBe("99.98");
    expect(store.recommendation).toBe("spandex");
    expect(store.recommendationReason).toBe(data.recommendation_reason);
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
      expect(store.spandexResult).toBeNull();
      expect(store.spandexError).toBeNull();
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
  it("publishes a single request error for both routers", async () => {
    get.mockRejectedValue(new Error("network unavailable"));
    await store.compare(params);
    expect(store.spandexError).toBe("network unavailable");
    expect(store.curveError).toBe("network unavailable");
    expect(store.isLoading).toBe(false);
  });
});
