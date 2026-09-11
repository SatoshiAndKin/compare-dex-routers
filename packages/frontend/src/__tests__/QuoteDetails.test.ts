import { makeQuote, FROM, TO } from "./quote-fixture.js";
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import QuoteDetails from "../lib/components/QuoteDetails.svelte";

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

describe("QuoteDetails", () => {
  it("is hidden by default — details content not shown", () => {
    const { container } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });
    const detailsContent = container.querySelector(".details-content");
    expect(detailsContent).toBeNull();
  });

  it("shows details content after toggle button is clicked", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    const toggle = getByText(/Details/);
    await fireEvent.click(toggle);

    const detailsContent = container.querySelector(".details-content");
    expect(detailsContent).not.toBeNull();
  });

  it("collapses details when toggle is clicked again", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    const toggle = getByText(/Details/);
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);

    const detailsContent = container.querySelector(".details-content");
    expect(detailsContent).toBeNull();
  });

  it("displays FULL router address — never truncated", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));

    const fullAddress = "0xdef1c0ded9bec7f1a1670819833240f027b25eff";
    const addressElements = container.querySelectorAll(".detail-value.mono");
    const found = Array.from(addressElements).some((el) => el.textContent?.includes(fullAddress));
    expect(found).toBe(true);
  });

  it("router address is never truncated (no ellipsis pattern)", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));

    const addressElements = container.querySelectorAll(".detail-value.mono");
    addressElements.forEach((el) => {
      expect(el.textContent).not.toMatch(/0x[0-9a-fA-F]{4}\.{3}[0-9a-fA-F]{4}/);
    });
  });

  it("displays FULL from token address", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));

    const fullFromAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const found = container.textContent?.includes(fullFromAddress);
    expect(found).toBe(true);
  });

  it("displays FULL to token address", async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));

    const fullToAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
    const found = container.textContent?.includes(fullToAddress);
    expect(found).toBe(true);
  });

  it("displays gas cost when available", async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/0\.0024 ETH/)).toBeTruthy();
  });

  it("displays gas price in gwei when provided", async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, gasPriceGwei: "30" },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/30 gwei/)).toBeTruthy();
  });

  it("displays slippage for Spandex quotes", async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/50 bps/)).toBeTruthy();
  });

  it("displays amounts in wei", async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText("100000000")).toBeTruthy();
    expect(getByText("99950000")).toBeTruthy();
  });

  it("displays Curve route steps when available", async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockCurveQuote },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText("Pool: 0x0000000000000000000000000000000000000001")).toBeTruthy();
  });

  it("shows details toggle button", () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote },
    });
    expect(getByText(/Details/)).toBeTruthy();
  });
});
