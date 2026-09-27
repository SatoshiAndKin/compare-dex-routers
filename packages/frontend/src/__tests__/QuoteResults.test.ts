import { cleanup, render, fireEvent, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuoteResults from "../lib/components/QuoteResults.svelte";
import { comparisonStore as store } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { makeQuote, SENDER } from "./quote-fixture.js";
import { tick } from "svelte";
import { balanceStore } from "../lib/stores/balanceStore.svelte.js";
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
    "keeps unsimulated %s prices visible and blocks actions until a verified refresh",
    async (mode) => {
      vi.spyOn(transactionStore, "refreshChecks").mockResolvedValue();
      walletStore.address = SENDER;
      walletStore.chainId = 1;
      walletStore.provider = { request: vi.fn() };
      const pending = makeQuote({
        mode,
        execution: null,
        simulation_status: "not_run",
        simulation_reason:
          "Insufficient USDC balance. Fund your wallet and refresh to simulate this route.",
      });
      store.quotes = [pending];
      store.recommendation = "0x";
      const view = render(QuoteResults);
      expect(view.container.querySelector(".quote-card")).toHaveTextContent("You receive");
      expect(view.container.querySelector(".quote-card")).toHaveTextContent(
        "Not simulated. Insufficient USDC balance."
      );
      expect(view.queryByRole("button", { name: "Execute swap" })).toBeNull();
      expect(view.queryByText("Connect your wallet to swap.")).toBeNull();
      // A frontend balance update does not verify the retained quote.
      balanceStore.from = { status: "ready", raw: 100000000n, decimals: 6 };
      store.isLoading = true;
      await tick();
      expect(view.container.querySelector(".quote-card")).toHaveTextContent("Not simulated.");
      expect(view.getByRole("status", { name: "Quote loading status" })).toHaveTextContent(
        "Refreshing quotes"
      );
      expect(view.queryByRole("button", { name: "Execute swap" })).toBeNull();
      store.quotes = [makeQuote({ mode })];
      store.isLoading = false;
      await tick();
      expect(view.container.querySelector(".quote-card")).toHaveTextContent(
        "Simulation passed. Wallet checks required."
      );
      expect(view.queryByText(/Not simulated/)).toBeNull();
      expect(view.getByRole("button", { name: "Execute swap" })).toBeDisabled();
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
    expect(view.container.querySelector(".quote-card")).toHaveTextContent(
      "Simulation passed. Wallet checks required."
    );
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
        makeQuote({
          mode,
          net_value_native: mode === "exactIn" ? "0.4976" : "0.5024",
          net_value_usd: mode === "exactIn" ? "995.2" : "1004.8",
        }),
        makeQuote({
          mode,
          provider: "curve",
          gas_cost_native: "0.003",
          gas_cost_usd: "6",
          approval_gas_cost_usd: "1.2",
          net_value_usd: mode === "exactIn" ? "994" : "1006",
          approval_gas_used: "30000",
          approval_gas_cost_native: "0.0006",
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
      expect(view.getAllByText("None needed", { exact: false })).toHaveLength(3);
      for (const quote of store.quotes) {
        const row = view.getByRole("button", { name: `Select ${quote.provider}` });
        expect(row).toHaveTextContent(
          `${quote.input_amount} ${quote.from_symbol} → ${quote.output_amount} ${quote.to_symbol}`
        );
        expect(row).toHaveTextContent(
          `Estimated gas cost: ${quote.provider === "curve" ? "$6.00" : "$4.80"}`
        );
        expect(row).toHaveTextContent(
          `${label}: ${mode === "exactIn" ? (quote.provider === "curve" ? "$994.00" : "$995.20") : quote.provider === "curve" ? "$1,006.00" : "$1,004.80"}`
        );
        expect(row).toHaveTextContent(
          `Required approval gas cost: ${quote.provider === "curve" ? "$1.20 (included above)" : "None needed"}`
        );
      }
    }
  );
  it.each(["gas", "approval", "conversion", "complete"])(
    "omits adjusted totals everywhere when raw ranking has %s data",
    async (data) => {
      store.quotes = [
        makeQuote({
          gas_cost_native: ["gas", "approval"].includes(data) ? null : "0",
          gas_cost_usd: ["gas", "approval"].includes(data) ? null : "0",
          approval_gas_used: data === "approval" ? null : "0",
          approval_gas_cost_native: data === "approval" ? null : "0",
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
      if (data === "approval")
        expect(row).toHaveTextContent("Required approval gas cost: Unavailable");
      expect(row).toHaveTextContent(
        `Estimated gas cost (excluded from ranking): ${["gas", "approval"].includes(data) ? "Unavailable" : "$0.00"}`
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
