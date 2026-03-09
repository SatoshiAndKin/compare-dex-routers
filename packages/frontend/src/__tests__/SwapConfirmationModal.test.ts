import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, vi } from "vitest";
import SwapConfirmationModal from "../lib/components/SwapConfirmationModal.svelte";
import { transactionStore } from "../lib/stores/transactionStore.svelte.js";
import type { SpandexQuote } from "../lib/stores/comparisonStore.svelte.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockSpandexQuote: SpandexQuote = {
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
  mode: "exactIn",
  provider: "0x",
  slippage_bps: 50,
  router_address: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  router_calldata: "0xabcdef1234",
  router_value: "0",
  approval_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  approval_spender: "0x1111111254EEB25477B68fb85Ed929f73A960582",
  gas_used: "120000",
  gas_cost_eth: "0.0024",
  output_value_eth: "0.5",
  net_value_eth: "0.49",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetTransactionStore(): void {
  // Cancel any pending confirmation
  transactionStore.cancelSwap();
  transactionStore.approveStatus = {};
  transactionStore.swapStatus = {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SwapConfirmationModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTransactionStore();
  });

  // ---------------------------------------------------------------------------
  // Hidden when no confirmation pending
  // ---------------------------------------------------------------------------

  it("renders nothing when swapConfirmation is null", () => {
    const { container } = render(SwapConfirmationModal);
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Shown when confirmation pending
  // ---------------------------------------------------------------------------

  it("shows modal when swapConfirmation is set", () => {
    // Set confirmation state directly
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { container } = render(SwapConfirmationModal);
    expect(container.querySelector(".modal-backdrop")).not.toBeNull();
  });

  it('renders "Confirm Swap" title when open', () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByRole } = render(SwapConfirmationModal);
    expect(getByRole("heading", { name: "Confirm Swap" })).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Trade details
  // ---------------------------------------------------------------------------

  it("displays input amount and symbol", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    expect(getByText(/100/)).toBeTruthy();
    expect(getByText(/USDC/)).toBeTruthy();
  });

  it("displays output amount and symbol", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    expect(getByText(/99\.95/)).toBeTruthy();
    expect(getByText(/USDT/)).toBeTruthy();
  });

  it("displays gas cost when available", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    expect(getByText(/0\.0024 ETH/)).toBeTruthy();
  });

  it("shows router address in full (never truncated)", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    // Full 42-char address must appear in the DOM
    expect(getByText("0xdef1c0ded9bec7f1a1670819833240f027b25eff")).toBeTruthy();
  });

  it("shows token addresses in full (never truncated)", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    // From token address — full 42 chars
    expect(getByText("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBeTruthy();
  });

  it('shows router name "spandex"', () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getAllByText } = render(SwapConfirmationModal);
    // "spandex" appears in Via row and potentially router name
    const els = getAllByText(/spandex/i);
    expect(els.length).toBeGreaterThan(0);
  });

  it("has a dialog role for accessibility", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByRole } = render(SwapConfirmationModal);
    expect(getByRole("dialog")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Cancel dismisses modal
  // ---------------------------------------------------------------------------

  it("Cancel button calls cancelSwap", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const cancelSpy = vi.spyOn(transactionStore, "cancelSwap");
    const { getByText } = render(SwapConfirmationModal);

    fireEvent.click(getByText("Cancel"));

    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it("Cancel clears swapConfirmation", async () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    fireEvent.click(getByText("Cancel"));

    expect(transactionStore.swapConfirmation).toBeNull();
  });

  it("close button (×) cancels", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const cancelSpy = vi.spyOn(transactionStore, "cancelSwap");
    const { getByLabelText } = render(SwapConfirmationModal);
    cancelSpy.mockClear();

    fireEvent.click(getByLabelText("Cancel swap"));

    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it("Escape key cancels", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const cancelSpy = vi.spyOn(transactionStore, "cancelSwap");
    const { getByRole } = render(SwapConfirmationModal);
    cancelSpy.mockClear();

    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });

    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Confirm triggers swap
  // ---------------------------------------------------------------------------

  it('"Confirm Swap" button calls confirmSwap', () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const confirmSpy = vi.spyOn(transactionStore, "confirmSwap");
    const { getByRole } = render(SwapConfirmationModal);

    fireEvent.click(getByRole("button", { name: "Confirm Swap" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it("Confirm clears swapConfirmation", () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote,
    };

    const { getByRole } = render(SwapConfirmationModal);
    fireEvent.click(getByRole("button", { name: "Confirm Swap" }));

    expect(transactionStore.swapConfirmation).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // targetOut mode display
  // ---------------------------------------------------------------------------

  it('shows "You pay (required)" label in targetOut mode', () => {
    const targetOutQuote: SpandexQuote = {
      ...mockSpandexQuote,
      mode: "targetOut",
    };

    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: targetOutQuote,
    };

    const { getByText } = render(SwapConfirmationModal);
    expect(getByText("You pay (required)")).toBeTruthy();
  });

  it('shows "You sell" label in exactIn mode', () => {
    transactionStore.swapConfirmation = {
      routerName: "spandex",
      quote: mockSpandexQuote, // mode: 'exactIn'
    };

    const { getByText } = render(SwapConfirmationModal);
    expect(getByText("You sell")).toBeTruthy();
  });
});
