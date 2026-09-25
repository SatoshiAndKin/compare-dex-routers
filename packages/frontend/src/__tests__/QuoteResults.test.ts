import { cleanup, render, fireEvent } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import QuoteResults from "../lib/components/QuoteResults.svelte";
import { comparisonStore as store } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { makeQuote } from "./quote-fixture.js";
beforeEach(() => {
  store.invalidate();
  walletStore.address = null;
  walletStore.provider = null;
});
afterEach(cleanup);
describe("provider results", () => {
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
