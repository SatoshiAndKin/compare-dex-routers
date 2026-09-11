import { makeQuote, FROM, TO } from "./quote-fixture.js";
import { render } from "@testing-library/svelte";
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

  it('renders provider name "Spandex" for spandex provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "spandex",
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Spandex/)).toBeTruthy();
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
    expect(getByText(/Curve/)).toBeTruthy();
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
    expect(getByText("RECOMMENDED")).toBeTruthy();
  });

  it("shows ALTERNATIVE badge when isRecommended=false", () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: "curve",
        quote: mockCurveQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText("ALTERNATIVE")).toBeTruthy();
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
    expect(getByText(/0\.0024 ETH/)).toBeTruthy();
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
    expect(getByText(/Via Spandex \/ 0x/)).toBeTruthy();
  });
});
