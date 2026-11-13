import { makeQuote, FROM, TO } from "./quote-fixture.js";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
import QuoteCard from "../lib/components/QuoteCard.svelte";

const mockSpandexQuote = makeQuote();

const mockCurveQuote = makeQuote({
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

describe("QuoteCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the individual provider name", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Via 0x/)).toBeTruthy();
  });

  it('renders provider name "Curve" for curve provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "curve",
        quote: mockCurveQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Via curve/)).toBeTruthy();
  });

  it("shows loading state with aria-busy when loading=true", () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: null,
        loading: true,
        isRecommended: false,
      },
    });
    const loadingEl = container.querySelector('[aria-busy="true"]');
    expect(loadingEl).not.toBeNull();
  });

  it('shows "Loading..." text during loading', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: null,
        loading: true,
        isRecommended: false,
      },
    });
    expect(getByText("Loading...")).toBeTruthy();
  });

  it("shows RECOMMENDED badge when isRecommended=true", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: true,
      },
    });
    expect(getByText("RECOMMENDED DEX ROUTE")).toBeTruthy();
  });

  it("shows SELECTED badge when isRecommended=false", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "curve",
        quote: mockCurveQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText("SELECTED")).toBeTruthy();
  });

  it("applies winner CSS class when isRecommended=true", () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: true,
      },
    });
    const card = container.querySelector(".quote-card");
    expect(card?.classList.contains("winner")).toBe(true);
  });

  it("shows error message when error prop is provided", () => {
    const errorMessage = "Insufficient liquidity for this trade";
    const { getByText, getByRole } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: null,
        error: errorMessage,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(errorMessage)).toBeTruthy();
    expect(getByRole("alert")).toBeTruthy();
  });

  it("displays output amount and symbol", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    // Output amount should be shown
    expect(getByText(/99\.95/)).toBeTruthy();
  });

  it("shows gas cost when available", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText("$4.80")).toBeTruthy();
  });

  it("shows both average prices after the totals and updates them with the quote", async () => {
    const quote = makeQuote({
      from_symbol: "USDC",
      to_symbol: "BAL",
      input_amount: "1257.7",
      output_amount: "10000",
      mode: "targetOut",
    });
    const { getByRole, getByText, rerender } = render(QuoteCard, {
      props: { provider: "0x", quote },
    });
    const rates = getByRole("group", { name: "Average trade price" });
    expect(rates.textContent).toContain("1 USDC ≈ 7.95102 BAL");
    await fireEvent.click(getByRole("button", { name: "Selected route details" }));
    expect(getByText("1 BAL ≈ 0.12577 USDC")).toBeVisible();
    expect(getByText("Average trade price before gas.")).toBeVisible();
    const total = getByText("10000");
    expect(total.parentElement).toHaveTextContent("10000 BAL");
    expect(total.compareDocumentPosition(rates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await rerender({ provider: "0x", quote: { ...quote, input_amount: "2000" } });
    expect(rates.textContent).toContain("1 USDC ≈ 5 BAL");
    expect(getByText("1 BAL ≈ 0.2 USDC")).toBeVisible();
  });

  it("omits the average price when the quote has a zero amount", () => {
    const { queryByRole } = render(QuoteCard, {
      props: { provider: "0x", quote: makeQuote({ output_amount: "0" }) },
    });
    expect(queryByRole("group", { name: "Average trade price" })).toBeNull();
  });

  it("does not show loading state when loading=false and quote provided", () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    const loadingEl = container.querySelector('[aria-busy="true"]');
    expect(loadingEl).toBeNull();
  });

  it('shows "Spandex / 0x" provider info with sub-provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Via 0x/)).toBeTruthy();
  });
});
