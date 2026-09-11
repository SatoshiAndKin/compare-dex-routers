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
import { FROM, TO, SENDER, makeComparison } from "./quote-fixture.js";
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
  return get.mock.calls.filter(([path]) => path === "/compare");
}
describe("mounted comparison lifecycle", () => {
  it.each(["slippage", "chain", "account", "wallet chain"])(
    "invalidates and requotes when %s changes",
    async (change) => {
      render(CompareForm);
      await tick();
      expect(comparisonStore.spandexResult).not.toBeNull();
      if (change === "slippage") formStore.slippageBps = 100;
      if (change === "chain") formStore.chainId = 8453;
      if (change === "account") walletStore.address = SENDER;
      if (change === "wallet chain") walletStore.chainId = 8453;
      flushSync();
      expect(comparisonStore.spandexResult).toBeNull();
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
  it("honors the comparison feature flag", async () => {
    configStore.flags.compare_endpoint = false;
    const { getByRole } = render(CompareForm);
    await tick();
    expect(comparisons()).toHaveLength(0);
    expect(getByRole("button", { name: "Compare Quotes" })).toBeDisabled();
  });
});
