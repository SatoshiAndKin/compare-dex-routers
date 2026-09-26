import { cleanup, render, fireEvent, within } from "@testing-library/svelte";
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
  transactionStore.busy = false;
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
      store.isLoading = true;
      await tick();
      expect(view.queryByText(notice)).toBeNull();
      expect(view.getByRole("status", { name: "Quote loading status" })).toHaveTextContent(
        "Refreshing quotes"
      );
      expect(view.getByRole("button", { name: "Execute swap" })).toBeDisabled();
      store.isLoading = false;
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
    expect(view.getByText("SELECTED", { exact: true })).toBeVisible();
    expect(view.getByText("Recommended: 0x")).toBeVisible();
    await fireEvent.click(view.getByRole("button", { name: "Use recommended route" }));
    expect(store.activeQuote?.provider).toBe("0x");
    expect(store.workflowProvider).toBeNull();
  });
  it("disables route changes while a wallet operation is pending and permits explicit workflow cancellation afterwards", async () => {
    store.quotes = [makeQuote(), makeQuote({ provider: "curve" })];
    store.recommendation = "0x";
    store.workflowProvider = "curve";
    transactionStore.busy = true;
    const view = render(QuoteResults);
    await fireEvent.click(view.getByText(/Provider results and failures/));
    expect(view.getByRole("button", { name: "Use recommended route" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Select 0x" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Cancel route workflow" })).toBeDisabled();
    transactionStore.busy = false;
    await tick();
    await fireEvent.click(view.getByRole("button", { name: "Cancel route workflow" }));
    expect(store.workflowProvider).toBeNull();
    expect(store.activeQuote?.provider).toBe("0x");
  });
  it.each(["exactIn", "targetOut"] as const)(
    "uses consistent %s costs on the card, rows and Details",
    async (mode) => {
      store.quotes = [
        makeQuote({ mode, net_value_native: mode === "exactIn" ? "0.4976" : "0.5024" }),
        makeQuote({
          mode,
          provider: "curve",
          gas_cost_native: "0.003",
          net_value_native: mode === "exactIn" ? "0.497" : "0.503",
        }),
      ];
      store.recommendation = "0x";
      store.recommendationBasis = "gas_adjusted";
      const view = render(QuoteResults);
      const label =
        mode === "exactIn"
          ? "Estimated output value after gas"
          : "Estimated input cost including gas";
      await fireEvent.click(view.getByText(/Provider results and failures/));
      await fireEvent.click(view.getByRole("button", { name: /Details/ }));
      expect(view.getAllByText(`${label}:`, { exact: false })).toHaveLength(3);
      expect(view.getByText(label, { exact: true })).toBeVisible();
      for (const quote of store.quotes) {
        const row = view.getByRole("button", { name: `Select ${quote.provider}` });
        expect(row).toHaveTextContent(
          `${quote.input_amount} ${quote.from_symbol} → ${quote.output_amount} ${quote.to_symbol}`
        );
        expect(row).toHaveTextContent(`Estimated gas cost: ${quote.gas_cost_native} ETH`);
        expect(row).toHaveTextContent(`${label}: ${quote.net_value_native} ETH`);
      }
    }
  );
  it.each(["gas", "conversion", "complete"])(
    "omits adjusted totals everywhere when raw ranking has %s data",
    async (data) => {
      store.quotes = [
        makeQuote({
          gas_cost_native: data === "gas" ? null : "0",
          trade_value_native: data === "conversion" ? null : "0.5",
        }),
        makeQuote({ provider: "curve" }),
      ];
      store.recommendation = "curve";
      store.recommendationBasis = "raw_amount";
      store.selectProvider("0x");
      const view = render(QuoteResults);
      await fireEvent.click(view.getByText(/Provider results and failures/));
      await fireEvent.click(view.getByRole("button", { name: /Details/ }));
      expect(view.getByText(/Ranking by raw output amount/)).toBeVisible();
      expect(
        view.queryByText(/Estimated (output value after gas|input cost including gas)/)
      ).toBeNull();
      expect(view.queryByText(/Total Cost|Output After Gas/)).toBeNull();
      const row = view.getByRole("button", { name: "Select 0x" });
      expect(row).toHaveTextContent(
        `Estimated gas cost (excluded from ranking): ${data === "gas" ? "Unavailable" : "0 ETH"}`
      );
      expect(
        within(view.container.querySelector(".quote-card") as HTMLElement).getAllByText(
          /excluded from ranking/
        )
      ).toHaveLength(2);
    }
  );
  it("shows a selected provider's disappearance and its failure without switching", () => {
    store.quotes = [makeQuote()];
    store.recommendation = "0x";
    store.workflowProvider = "curve";
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
