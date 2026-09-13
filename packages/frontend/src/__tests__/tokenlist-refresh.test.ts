import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  tokenListStore as store,
  DEFAULT_UNISWAP_URL,
} from "../lib/stores/tokenListStore.svelte.js";
import { deferred } from "./quote-fixture.js";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
const DAY = 86_400_000;
const token = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  chainId: 1,
  decimals: 6,
};

beforeEach(() => {
  store.stopRefresh();
  Object.assign(store, { initialized: false, isInitializing: false, lists: [], localTokens: [] });
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T00:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  get.mockReset().mockResolvedValue({
    data: {
      name: "Built-in",
      tokenlists: [{ name: "Built-in", tokens: [token] }],
      tokens: [token],
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ name: "External", tokens: [token] })))
  );
});
afterEach(() => {
  store.stopRefresh();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("daily and manual token-list refresh", () => {
  it("waits a full day, combines manual requests, and replaces lists without duplicates", async () => {
    store.startRefresh();
    await store.init();
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(get).toHaveBeenCalledTimes(2);
    const pending = deferred<{ data: { name: string; tokens: (typeof token)[] } }>();
    get.mockReturnValueOnce(pending.promise);
    const first = store.refresh();
    const second = store.refresh();
    expect(get).toHaveBeenCalledTimes(3);
    pending.resolve({ data: { name: "New", tokens: [{ ...token, symbol: "NEW" }] } });
    await Promise.all([first, second]);
    expect(store.lists.filter((entry) => entry.url === null)).toEqual([
      {
        url: null,
        name: "New",
        enabled: true,
        tokens: [{ ...token, symbol: "NEW", _source: "New" }],
        error: undefined,
      },
    ]);
  });

  it("suspends hidden pages and refreshes once when overdue", async () => {
    store.startRefresh();
    await store.init();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(get).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps last valid tokens on failure and does not retry on every visibility change", async () => {
    store.startRefresh();
    await store.init();
    get.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(DAY);
    expect(store.lists[0]).toMatchObject({
      tokens: [{ ...token, _source: "Built-in" }],
      error: "offline",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
    await store.refresh();
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("does not restore a removed list when an old fetch ignores cancellation", async () => {
    await store.init();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const refresh = store.refresh();
    store.removeList(DEFAULT_UNISWAP_URL);
    pending.resolve(new Response(JSON.stringify({ name: "Late", tokens: [token] })));
    await refresh;
    expect(store.lists.map((entry) => entry.url)).toEqual([null]);
  });

  it("skips disabled lists and stops requests and timers on unmount", async () => {
    store.startRefresh();
    await store.init();
    store.toggleList(DEFAULT_UNISWAP_URL);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(fetch).toHaveBeenCalledTimes(1);
    store.stopRefresh();
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
