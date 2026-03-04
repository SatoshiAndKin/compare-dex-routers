/**
 * Amount field handling for sell/receive two-field amount input.
 *
 * Manages:
 * - Direction mode (exactIn / targetOut)
 * - Active amount field tracking (sell / receive)
 * - Programmatic update flag to prevent event listener loops
 * - Auto-quote debounce on input changes
 * - Populating non-active field from quote responses
 * - Amount field labels with token symbols
 */

import type { Token, CompareParams } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmountFieldElements {
  sellAmountInput: HTMLInputElement;
  receiveAmountInput: HTMLInputElement;
  sellAmountLabel: HTMLElement;
  receiveAmountLabel: HTMLElement;
  sellAmountGroup: HTMLElement;
  receiveAmountGroup: HTMLElement;
  targetOutNote: HTMLElement;
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
}

export interface AmountFieldCallbacks {
  /** Schedule an auto-quote comparison (delegates to compare flow) */
  scheduleAutoQuote: () => void;
  /** Cancel in-progress fetch requests */
  cancelInProgressFetches: () => void;
  /** Read current form state into CompareParams */
  readCompareParamsFromForm: () => CompareParams;
  /** Run compare and possibly start auto-refresh */
  runCompareAndMaybeStartAutoRefresh: (
    params: CompareParams,
    options: { showLoading: boolean }
  ) => Promise<void>;
  /** Find a token by address for a given chain */
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
  /** Get current chain ID */
  getCurrentChainId: () => number;
  /** Get best quote from progressive state for non-active field */
  getBestQuoteFromState: () => {
    output_amount?: string;
    input_amount?: string;
  } | null;
  /** Clear non-active field (called when amount is invalid) */
  clearNonActiveField: () => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let currentQuoteMode: "exactIn" | "targetOut" = "exactIn";
let activeAmountField: "sell" | "receive" = "sell";
let isProgrammaticUpdateFlag = false;
let autoQuoteDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let els: AmountFieldElements | null = null;
let cbs: AmountFieldCallbacks | null = null;

// ---------------------------------------------------------------------------
// Exported getters/setters
// ---------------------------------------------------------------------------

/** Get the current direction mode */
export function getActiveMode(): "exactIn" | "targetOut" {
  return currentQuoteMode;
}

/** Get which amount field is currently active */
export function getActiveField(): "sell" | "receive" {
  return activeAmountField;
}

/** Get the active amount value from the active input field */
export function getActiveAmount(): string {
  if (!els) return "";
  return activeAmountField === "sell" ? els.sellAmountInput.value : els.receiveAmountInput.value;
}

/** Check whether we are in a programmatic update */
export function isProgrammatic(): boolean {
  return isProgrammaticUpdateFlag;
}

/** Set the programmatic update flag */
export function setProgrammatic(val: boolean): void {
  isProgrammaticUpdateFlag = val;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Set the direction mode (exactIn or targetOut).
 * Updates visual state of amount groups, active field tracking,
 * and shows/hides the targetOut provider notice.
 */
export function setDirectionMode(mode: "exactIn" | "targetOut"): void {
  currentQuoteMode = mode;
  const isExactIn = mode === "exactIn";
  activeAmountField = isExactIn ? "sell" : "receive";

  if (!els) return;

  // Update visual state of fields
  els.sellAmountGroup.classList.toggle("active", isExactIn);
  els.sellAmountGroup.classList.toggle("computed", !isExactIn);
  els.receiveAmountGroup.classList.toggle("active", !isExactIn);
  els.receiveAmountGroup.classList.toggle("computed", isExactIn);

  // Show/hide the provider note for targetOut mode
  els.targetOutNote.hidden = isExactIn;
}

/**
 * Update sell/receive labels to include the current token symbols.
 * e.g. "YOU SELL USDC" / "YOU RECEIVE ETH"
 */
export function updateAmountFieldLabels(): void {
  if (!els || !cbs) return;

  const fromAddr = els.fromInput.dataset.address || "";
  const toAddr = els.toInput.dataset.address || "";
  const chainId = cbs.getCurrentChainId();
  const fromToken = fromAddr ? cbs.findTokenByAddress(fromAddr, chainId) : undefined;
  const toToken = toAddr ? cbs.findTokenByAddress(toAddr, chainId) : undefined;
  const fromSymbol = fromToken ? fromToken.symbol : "";
  const toSymbol = toToken ? toToken.symbol : "";
  els.sellAmountLabel.textContent = fromSymbol ? "YOU SELL " + fromSymbol : "YOU SELL";
  els.receiveAmountLabel.textContent = toSymbol ? "YOU RECEIVE " + toSymbol : "YOU RECEIVE";
}

/**
 * Format a quote amount for display: ≤8 decimals, trim trailing zeros.
 */
export function formatQuoteAmount(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  let formatted = num.toFixed(8);
  if (formatted.includes(".")) {
    formatted = formatted.replace(/0+$/, "").replace(/\.$/, "");
  }
  return formatted;
}

/** Check if a value is valid for auto-quoting (>0, numeric) */
function isValidAutoQuoteAmount(value: string | number): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "0") return false;
  const num = Number(trimmed);
  return Number.isFinite(num) && num > 0;
}

/**
 * Get the best quote from progressive state and populate the non-active field.
 */
export function populateNonActiveField(
  quote: { output_amount?: string; input_amount?: string } | null
): void {
  if (!els) return;
  if (!quote) {
    clearNonActiveField();
    return;
  }
  let amount: string;
  if (activeAmountField === "sell") {
    // exactIn mode: populate receive field with output amount
    amount = formatQuoteAmount(quote.output_amount ?? "");
    if (amount) {
      isProgrammaticUpdateFlag = true;
      els.receiveAmountInput.value = amount;
      isProgrammaticUpdateFlag = false;
    }
  } else {
    // targetOut mode: populate sell field with input amount
    amount = formatQuoteAmount(quote.input_amount ?? "");
    if (amount) {
      isProgrammaticUpdateFlag = true;
      els.sellAmountInput.value = amount;
      isProgrammaticUpdateFlag = false;
    }
  }
}

/** Set the computed (non-active) field to a specific value programmatically. */
export function setComputedAmount(value: string): void {
  if (!els) return;
  isProgrammaticUpdateFlag = true;
  if (activeAmountField === "sell") {
    els.receiveAmountInput.value = value;
  } else {
    els.sellAmountInput.value = value;
  }
  isProgrammaticUpdateFlag = false;
}

/** Clear the non-active field to empty. */
function clearNonActiveField(): void {
  if (!els) return;
  isProgrammaticUpdateFlag = true;
  if (activeAmountField === "sell") {
    els.receiveAmountInput.value = "";
  } else {
    els.sellAmountInput.value = "";
  }
  isProgrammaticUpdateFlag = false;
}

/**
 * Schedule an auto-quote with 400ms debounce.
 * Cancels any in-progress fetches and waits for user to stop typing.
 */
export function scheduleAutoQuote(): void {
  if (!els || !cbs) return;

  if (autoQuoteDebounceTimer !== null) {
    clearTimeout(autoQuoteDebounceTimer);
    autoQuoteDebounceTimer = null;
  }
  cbs.cancelInProgressFetches();

  const currentValue =
    activeAmountField === "sell" ? els.sellAmountInput.value : els.receiveAmountInput.value;
  if (!isValidAutoQuoteAmount(currentValue)) {
    clearNonActiveField();
    return;
  }

  autoQuoteDebounceTimer = setTimeout(() => {
    autoQuoteDebounceTimer = null;
    if (!cbs) return;
    const compareParams = cbs.readCompareParamsFromForm();
    // Need both from and to tokens to be set
    if (!compareParams.from || !compareParams.to) return;
    void cbs.runCompareAndMaybeStartAutoRefresh(compareParams, { showLoading: false });
  }, 400);
}

/**
 * Get the best quote from progressive quote state.
 * Delegates to the callback provided by inline JS.
 */
export function getBestQuoteFromState(): {
  output_amount?: string;
  input_amount?: string;
} | null {
  if (!cbs) return null;
  return cbs.getBestQuoteFromState();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize amount field handling.
 * Wires up focus and input event listeners on sell/receive fields.
 */
export function initAmountFields(
  elements: AmountFieldElements,
  callbacks: AmountFieldCallbacks
): void {
  els = elements;
  cbs = callbacks;

  const { sellAmountInput, receiveAmountInput, fromInput, toInput } = elements;

  // Clicking/focusing the sell field switches back to exactIn mode
  sellAmountInput.addEventListener("focus", () => {
    if (isProgrammaticUpdateFlag) return;
    if (activeAmountField !== "sell") {
      setDirectionMode("exactIn");
    }
  });

  // Clicking/focusing the receive field switches to targetOut mode
  receiveAmountInput.addEventListener("focus", () => {
    if (isProgrammaticUpdateFlag) return;
    if (activeAmountField !== "receive") {
      setDirectionMode("targetOut");
    }
  });

  // When user types in sell field, set mode to exactIn and trigger auto-quote
  sellAmountInput.addEventListener("input", () => {
    if (isProgrammaticUpdateFlag) return;
    if (activeAmountField !== "sell") {
      setDirectionMode("exactIn");
    }
    scheduleAutoQuote();
  });

  // When user types in receive field, set mode to targetOut and trigger auto-quote
  receiveAmountInput.addEventListener("input", () => {
    if (isProgrammaticUpdateFlag) return;
    if (activeAmountField !== "receive") {
      setDirectionMode("targetOut");
    }
    scheduleAutoQuote();
  });

  // Re-trigger auto-quote when tokens change via autocomplete
  fromInput.addEventListener("tokenselected", () => {
    scheduleAutoQuote();
  });
  toInput.addEventListener("tokenselected", () => {
    scheduleAutoQuote();
  });

  // Expose on window for inline JS backward compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.getActiveMode = getActiveMode;
  win.getActiveField = getActiveField;
  win.getActiveAmount = getActiveAmount;
  win.isProgrammatic = isProgrammatic;
  win.setProgrammatic = setProgrammatic;
  win.setDirectionMode = setDirectionMode;
  win.updateAmountFieldLabels = updateAmountFieldLabels;
  win.formatQuoteAmount = formatQuoteAmount;
  win.populateNonActiveField = populateNonActiveField;
  win.setComputedAmount = setComputedAmount;
  win.scheduleAutoQuote = scheduleAutoQuote;
  win.getBestQuoteFromState_module = getBestQuoteFromState;
}
