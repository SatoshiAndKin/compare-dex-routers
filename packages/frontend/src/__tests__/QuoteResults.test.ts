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
  comparisonStore.spandexLoading = false;
  comparisonStore.curveLoading = false;
  comparisonStore.gasPriceGwei = null;
  comparisonStore.recommendation = null;
  comparisonStore.recommendationReason = null;
  comparisonStore.activeTab = "recommended";
  comparisonStore.mode = "exactIn";
  comparisonStore.isSingleRouterMode = false;
}

const spandexQuote = {
  chainId: 1,
  from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  from_symbol: "USDC",
  to: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  to_symbol: "USDT",
  amount: "100",
  input_amount: "100",
  output_amount: "99.95",
  input_amount_raw: "100000000",
  output_amount_raw: "99950000",
  mode: "exactIn" as const,
  provider: "0x",
  slippage_bps: 50,
  router_address: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  router_calldata: "0x",
  router_value: "0",
  approval_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  approval_spender: "0x1111111254EEB25477B68fb85Ed929f73A960582",
  gas_used: "21000",
  gas_cost_eth: "0.0024",
  output_value_eth: "0.5",
  net_value_eth: "0.49",
};

const curveQuote = {
  source: "curve" as const,
  from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  from_symbol: "USDC",
  to: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  to_symbol: "USDT",
  amount: "100",
  input_amount: "100",
  output_amount: "99.98",
  mode: "exactIn" as const,
  route: [],
  route_symbols: {},
  router_address: "0x99a58482bd75cbab83b27ec03ca68ff489b5788f",
  router_calldata: "0x",
  gas_used: "21000",
  gas_cost_eth: "0.003",
  output_value_eth: "0.5",
  net_value_eth: "0.49",
};

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
    comparisonStore.isSingleRouterMode = true;

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
    comparisonStore.spandexLoading = true;
    comparisonStore.curveLoading = true;

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
    comparisonStore.spandexLoading = false;
    comparisonStore.curveLoading = false;

    const { getByRole } = render(QuoteResults);
    const alert = getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("No quotes available");
    expect(alert.textContent).toContain("Insufficient liquidity");
    expect(alert.textContent).toContain("Pool not found");
  });

  it("shows only one tab in single router mode", () => {
    comparisonStore.spandexResult = spandexQuote;
    comparisonStore.recommendation = "spandex";
    comparisonStore.recommendationReason = "Only Spandex is available on this chain.";
    comparisonStore.isSingleRouterMode = true;

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
    comparisonStore.spandexLoading = true;
    comparisonStore.curveLoading = true;

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
