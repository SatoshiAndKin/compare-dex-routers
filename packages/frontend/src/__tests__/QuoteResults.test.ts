import { cleanup, render, fireEvent } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuoteResults from "../lib/components/QuoteResults.svelte";
import { comparisonStore as store } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { makeQuote, FROM, TO, SENDER } from "./quote-fixture.js";
import { tick } from "svelte";
import { balanceStore } from "../lib/stores/balanceStore.svelte.js";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { transactionStore } from "../lib/stores/transactionStore.svelte.js";
beforeEach(() => {
  store.invalidate();
  balanceStore.clear();
  walletStore.address = null;
  walletStore.provider = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("provider results", () => {
  it.each(["exactIn", "targetOut"] as const)(
    "shows the funding notice only below the selected %s quote's full input balance",
    async (mode) => {
      vi.spyOn(transactionStore, "refreshChecks").mockResolvedValue();
      walletStore.address = SENDER;
      walletStore.chainId = 1;
      walletStore.provider = { request: vi.fn() };
      formStore.chainId = 1;
      formStore.fromToken = { address: FROM, symbol: "USDC", decimals: 6 };
      formStore.toToken = { address: TO, symbol: "USDT", decimals: 6 };
      formStore.mode = mode;
      formStore.slippageBps = 50;
      formStore.sellAmount = "100";
      formStore.receiveAmount = "99.95";
      store.quotes = [makeQuote({ mode, amount: mode === "exactIn" ? "100" : "99.95" })];
      store.recommendation = "0x";
      balanceStore.from = { status: "ready", raw: 99999999n, decimals: 6 };
      const view = render(QuoteResults);
      const notice = /Price simulations use temporary funding/;
      expect(view.getByText(notice)).toBeVisible();
      balanceStore.from.raw = 100000000n;
      await tick();
      expect(view.queryByText(notice)).toBeNull();
      // A refreshed Exact Output route may require more input for the same requested output.
      if (mode === "targetOut") {
        store.quotes = [
          makeQuote({
            mode,
            amount: "99.95",
            input_amount: "100.000001",
            input_amount_raw: "100000001",
          }),
        ];
      } else {
        balanceStore.from.raw = 99999999n;
      }
      await tick();
      expect(view.getByText(notice)).toBeVisible();
      balanceStore.from.raw = 100000002n;
      await tick();
      expect(view.queryByText(notice)).toBeNull();
      balanceStore.from = { status: "unavailable", raw: null, decimals: 6 };
      await tick();
      expect(view.getByText(notice)).toBeVisible();
    }
  );
  it("renders no results before a request", () => {
    expect(render(QuoteResults).container.querySelector(".quote-results")).toBeNull();
  });
  it("shows one recommended route and an expandable provider list without tabs", () => {
    store.quotes = [makeQuote(), makeQuote({ provider: "curve" })];
    store.recommendation = "0x";
    const view = render(QuoteResults);
    expect(view.queryAllByRole("tab")).toEqual([]);
    expect(view.getByText("RECOMMENDED")).toBeVisible();
    expect(view.container.querySelectorAll(".quote-card")).toHaveLength(1);
    expect(view.getByText(/Price simulations use temporary funding/)).toBeVisible();
    expect(view.container.querySelector("details.provider-list")?.hasAttribute("open")).toBe(false);
  });
  it("selects a provider without changing the server recommendation", async () => {
    store.quotes = [makeQuote(), makeQuote({ provider: "curve", output_amount: "98" })];
    store.recommendation = "0x";
    const view = render(QuoteResults);
    await fireEvent.click(view.getByText(/Provider results and failures/));
    await fireEvent.click(view.getByRole("button", { name: "Select curve" }));
    expect(store.selectedProvider).toBe("curve");
    expect(store.recommendation).toBe("0x");
    expect(view.getByText("Via curve")).toBeVisible();
  });
  it("shows a selected provider's disappearance and its failure without switching", () => {
    store.quotes = [makeQuote()];
    store.recommendation = "0x";
    store.selectedProvider = "curve";
    store.failures = [
      {
        provider: "curve",
        stage: "simulation",
        error: {
          name: "Error",
          message: "No route for this trade",
          code: null,
          cause: null,
          details: null,
        },
      },
    ];
    const view = render(QuoteResults);
    expect(view.getByRole("alert")).toHaveTextContent("curve is unavailable");
    expect(view.queryByText("Via 0x")).toBeNull();
    expect(view.container.textContent).toContain("No route for this trade");
  });
});
