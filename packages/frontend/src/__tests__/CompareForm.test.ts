import { cleanup, render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompareForm from "../lib/components/CompareForm.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { configStore } from "../lib/stores/configStore.svelte.js";
import { autoRefreshStore } from "../lib/stores/autoRefreshStore.svelte.js";
import { transactionStore } from "../lib/stores/transactionStore.svelte.js";
import type { CompareParams } from "../lib/stores/comparisonStore.svelte.js";
import { FROM, TO, SENDER, makeComparison, deferred } from "./quote-fixture.js";
const get = vi.hoisted(() =>
  vi.fn<
    (
      path: string,
      options?: { params?: { query?: CompareParams } }
    ) => Promise<{ data: ReturnType<typeof makeComparison>; response: Response }>
  >()
);
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  comparisonStore.invalidate();
  autoRefreshStore.stop();
  transactionStore.busy = false;
  walletStore.address = null;
  walletStore.provider = null;
  walletStore.chainId = null;
  formStore.chainId = 1;
  formStore.mode = "exactIn";
  formStore.slippageBps = 50;
  formStore.sellAmount = "100";
  formStore.isLoading = false;
  formStore.fromToken = { address: FROM, chainId: 1, decimals: 6, symbol: "USDC" };
  formStore.toToken = { address: TO, chainId: 1, decimals: 6, symbol: "USDT" };
  configStore.flags = { compare_endpoint: true, curve_enabled: true };
  get.mockReset().mockResolvedValue({ data: makeComparison(), response: new Response() });
});
afterEach(() => {
  cleanup();
  autoRefreshStore.stop();
  comparisonStore.invalidate();
  vi.useRealTimers();
});
async function tick(ms = 600) {
  flushSync();
  await vi.advanceTimersByTimeAsync(ms);
  flushSync();
}
function comparisons() {
  return get.mock.calls.filter(([path]) => path === "/quote");
}
describe("mounted comparison lifecycle", () => {
  it.each(["slippage", "chain", "account", "wallet chain"])(
    "invalidates and requotes when %s changes",
    async (change) => {
      render(CompareForm);
      await tick();
      expect(comparisonStore.quotes).toHaveLength(2);
      if (change === "slippage") formStore.slippageBps = 100;
      if (change === "chain") formStore.chainId = 8453;
      if (change === "account") walletStore.address = SENDER;
      if (change === "wallet chain") walletStore.chainId = 8453;
      flushSync();
      expect(comparisonStore.quotes).toEqual(makeComparison().quotes);
      expect(comparisonStore.isCurrent(comparisonStore.quotes[0]!)).toBe(false);
      expect(comparisonStore.isLoading).toBe(true);
      expect(autoRefreshStore.active).toBe(false);
      await tick();
      expect(comparisons()).toHaveLength(2);
      const query = comparisons()[1]?.[1]?.params?.query;
      expect(query).toMatchObject({
        chainId: change === "chain" ? 8453 : 1,
        slippageBps: change === "slippage" ? 100 : 50,
        sender: change === "account" ? SENDER : undefined,
      });
      await tick(15000);
      expect(comparisons()).toHaveLength(3);
      expect(comparisons()[2]?.[1]?.params?.query).toEqual(query);
    }
  );
  it("retains the selected quote through amount edits, a slow response, and failure", async () => {
    render(CompareForm);
    await tick();
    comparisonStore.selectedProvider = "curve";
    const previous = comparisonStore.activeQuote!;
    const pending = deferred<Awaited<ReturnType<typeof get>>>();
    get.mockReturnValueOnce(pending.promise);
    formStore.sellAmount = "200";
    flushSync();
    expect(comparisonStore.activeQuote).toBe(previous);
    expect(comparisonStore.isCurrent(previous)).toBe(false);
    await tick();
    expect(comparisonStore.activeQuote).toBe(previous);
    expect(comparisonStore.isLoading).toBe(true);
    pending.reject(new Error("network unavailable"));
    await tick(0);
    expect(comparisonStore.activeQuote).toBe(previous);
    expect(comparisonStore.error).toBe("network unavailable");
    expect(comparisonStore.isCurrent(previous)).toBe(false);
    expect(comparisonStore.isLoading).toBe(false);
    formStore.sellAmount = "";
    flushSync();
    expect(comparisonStore.activeQuote).toBe(previous);
    expect(comparisonStore.isCurrent(previous)).toBe(false);
    expect(comparisonStore.isLoading).toBe(false);
    await tick();
    expect(comparisons()).toHaveLength(2);
    formStore.sellAmount = "100";
    await tick();
    expect(comparisonStore.activeQuote?.provider).toBe("curve");
    expect(comparisonStore.isCurrent(comparisonStore.activeQuote!)).toBe(true);
  });
  it("waits for selected metadata before sending the amount", async () => {
    formStore.fromToken!.decimals = null;
    render(CompareForm);
    await tick();
    expect(comparisons()).toHaveLength(0);
    formStore.fromToken!.decimals = 0;
    await tick();
    expect(comparisons()).toHaveLength(1);
  });
  it("pauses requests during a wallet action and refreshes when it ends", async () => {
    render(CompareForm);
    await tick();
    transactionStore.busy = true;
    flushSync();
    formStore.slippageBps = 100;
    await tick();
    expect(comparisons()).toHaveLength(1);
    transactionStore.busy = false;
    await tick(0);
    expect(comparisons()).toHaveLength(2);
    expect(comparisons()[1]?.[1]?.params?.query).toMatchObject({ slippageBps: 100 });
  });
});
