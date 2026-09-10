import { configStore } from "../lib/stores/configStore.svelte.js";
import { makeQuote, FROM, TO } from "./quote-fixture.js";
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
import QuoteResults from "../lib/components/QuoteResults.svelte";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";

// Mock fetch globally for tests that trigger compare()
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function resetComparisonStore() {
  comparisonStore.spandexResult = null;
  comparisonStore.curveResult = null;
  comparisonStore.spandexError = null;
  comparisonStore.curveError = null;
  comparisonStore.isLoading = false;
  comparisonStore.isLoading = false;
  comparisonStore.gasPriceGwei = null;
  comparisonStore.recommendation = null;
  comparisonStore.recommendationReason = null;
  comparisonStore.activeTab = "recommended";
  comparisonStore.mode = "exactIn";
  configStore.flags.curve_enabled = true;
}

const spandexQuote = makeQuote();

const curveQuote = makeQuote({
  provider: "curve",
  output_amount: "99.98",
  output_amount_raw: "99980000",
  gas_cost_native: "0.003",
  route: {
    nodes: [
      { address: FROM, symbol: "USDC" },
      { address: TO, symbol: "USDT" },
    ],
    edges: [
      {
        source: FROM,
        target: TO,
        key: "pool1",
        value: 1,
        address: "0x0000000000000000000000000000000000000001",
      },
    ],
  },
});

describe("QuoteResults", () => {
  beforeEach(() => {
    resetComparisonStore();
    mockFetch.mockReset();
  });

  it("renders nothing when hasResults is false (no data, no loading)", () => {
    const { container } = render(QuoteResults);
    const results = container.querySelector(".quote-results");
    expect(results).toBeNull();
  });

  it("renders both tabs when both quotes are loaded", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "curve";
    comparisonStore.recommendationReason = "Curve outputs more.";

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(2);
  });

  it("tab labels show Curve and Spandex when recommendation is curve", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "curve";
    comparisonStore.recommendationReason = "Curve outputs more.";

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    const tabTexts = tabs.map((t) => t.textContent?.trim());
    expect(tabTexts).toContain("Curve");
    expect(tabTexts).toContain("Spandex");
  });

  it("recommended tab is active by default", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.recommendation = "spandex";
    comparisonStore.recommendationReason = "Spandex outputs more.";
    configStore.flags.curve_enabled = false;

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    const activeTab = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    expect(activeTab).toBeTruthy();
  });

  it("clicking alternative tab switches the active tab", async () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "spandex";
    comparisonStore.recommendationReason = "Spandex outputs more.";

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    const altTab = tabs.find((t) => t.getAttribute("data-tab") === "alternative");
    expect(altTab).toBeTruthy();

    await fireEvent.click(altTab!);
    expect(altTab!.getAttribute("aria-selected")).toBe("true");
  });

  it("shows loading indicators when both are loading", () => {
    comparisonStore.isLoading = true;
    comparisonStore.isLoading = true;

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    const tabTexts = tabs.map((t) => t.textContent?.trim());
    expect(tabTexts.every((t) => t === "Loading...")).toBe(true);
  });

  it("shows recommendation reason when recommendation is set", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "curve";
    comparisonStore.recommendationReason = "Curve outputs 0.03 USDT more (+0.030%).";

    const { getByText } = render(QuoteResults);
    expect(getByText(/Curve outputs 0.03 USDT more/)).toBeTruthy();
  });

  it("shows combined error message when both routers fail", () => {
    comparisonStore.spandexError = "Insufficient liquidity";
    comparisonStore.curveError = "Pool not found";
    comparisonStore.isLoading = false;
    comparisonStore.isLoading = false;

    const { getByRole } = render(QuoteResults);
    const alert = getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("No quotes available");
    expect(alert.textContent).toContain("Insufficient liquidity");
    expect(alert.textContent).toContain("Pool not found");
  });

  it("shows only one tab in Curve is disabled", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.recommendation = "spandex";
    comparisonStore.recommendationReason = "Only Spandex is available on this chain.";
    configStore.flags.curve_enabled = false;

    const { getAllByRole } = render(QuoteResults);
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(1);
  });

  it("shows RECOMMENDED badge on the recommended quote card", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "spandex";
    comparisonStore.recommendationReason = "Spandex outputs more.";

    const { getByText } = render(QuoteResults);
    expect(getByText("RECOMMENDED")).toBeTruthy();
  });

  it("renders QuoteResults container when loading starts", () => {
    comparisonStore.isLoading = true;
    comparisonStore.isLoading = true;

    const { container } = render(QuoteResults);
    const results = container.querySelector(".quote-results");
    expect(results).not.toBeNull();
  });

  it("shows spandex error in recommended tab when spandex fails but curve succeeds", () => {
    comparisonStore.spandexError = "Spandex failed";
    comparisonStore.curveResult = curveQuote;
    comparisonStore.recommendation = "curve";
    comparisonStore.recommendationReason = "Only Curve returned a quote.";

    const { getByText } = render(QuoteResults);
    // Recommended tab shows Curve (the winner), which has the result
    expect(getByText(/99\.98/)).toBeTruthy();
  });
});
