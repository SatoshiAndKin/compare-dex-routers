/**
 * Shared token utility functions.
 * Pure helpers for formatting tokens, extracting addresses from inputs,
 * and managing token input icons.
 */

import type { Token } from "./types.js";

// ---------------------------------------------------------------------------
// Token display formatting
// ---------------------------------------------------------------------------

/**
 * Format token for display: 'SYMBOL (0xFullAddress)' — NEVER truncate.
 * This is a project convention in AGENTS.md.
 */
export function formatTokenDisplay(symbol: string, address: string): string {
  const sym = String(symbol || "").trim();
  const addr = String(address || "").trim();
  if (!addr) return sym || "";
  return sym ? sym + " (" + addr + ")" : addr;
}

// ---------------------------------------------------------------------------
// Address extraction
// ---------------------------------------------------------------------------

/**
 * Extract address from display format or data-address attribute.
 * Prefers data-address, then checks if value is a raw 0x address,
 * falls back to data-address or raw value.
 */
export function extractAddressFromInput(input: HTMLInputElement): string {
  const dataAddr = input.dataset.address;
  if (dataAddr && /^0x[a-fA-F0-9]{40}$/.test(dataAddr)) return dataAddr;
  const value = String(input.value || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  if (dataAddr) return dataAddr;
  return value;
}

// ---------------------------------------------------------------------------
// Token input icon management
// ---------------------------------------------------------------------------

/**
 * Update the token input icon based on token data.
 * Shows the token logo if available, hides it otherwise.
 */
export function updateTokenInputIcon(
  _input: HTMLInputElement,
  icon: HTMLImageElement,
  wrapper: HTMLElement,
  token: Token | null | undefined
): void {
  if (token && typeof token.logoURI === "string" && token.logoURI) {
    icon.src = token.logoURI;
    icon.alt = token.symbol ? token.symbol + " logo" : "token logo";
    wrapper.classList.remove("no-icon");
    icon.onerror = () => {
      wrapper.classList.add("no-icon");
      icon.src = "";
    };
  } else {
    wrapper.classList.add("no-icon");
    icon.src = "";
  }
}

/**
 * Clear a token input icon (hide it and reset src/alt).
 */
export function clearTokenInputIcon(wrapper: HTMLElement, icon: HTMLImageElement): void {
  wrapper.classList.add("no-icon");
  icon.src = "";
  icon.alt = "";
}

// ---------------------------------------------------------------------------
// Token swap on duplicate detection
// ---------------------------------------------------------------------------

/** Dependencies needed by handleTokenSwapIfNeeded */
export interface TokenSwapContext {
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
  fromIcon: HTMLImageElement;
  toIcon: HTMLImageElement;
  fromWrapper: HTMLElement;
  toWrapper: HTMLElement;
  getCurrentChainId: () => number;
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
  updateFromTokenBalance: () => void;
  updateToTokenBalance: () => void;
}

/**
 * Handle token swap when setting a token to the same value as the other field.
 * If user sets from=A when to=A: swap (to becomes old-from, from becomes A).
 * If user sets to=A when from=A: swap (from becomes old-to, to becomes A).
 * If the other field was empty: just set the new value (no swap needed).
 */
export function handleTokenSwapIfNeeded(
  currentInput: HTMLInputElement,
  newAddress: string,
  _newDisplay: string,
  ctx: TokenSwapContext
): void {
  const isFromInput = currentInput === ctx.fromInput;
  const otherInput = isFromInput ? ctx.toInput : ctx.fromInput;
  const otherAddress = extractAddressFromInput(otherInput);

  if (!/^0x[a-fA-F0-9]{40}$/.test(String(otherAddress || "").trim())) {
    return;
  }

  const normalizedNew = String(newAddress || "")
    .toLowerCase()
    .trim();
  const normalizedOther = String(otherAddress || "")
    .toLowerCase()
    .trim();

  if (normalizedNew && normalizedOther && normalizedNew === normalizedOther) {
    const currentAddress = extractAddressFromInput(currentInput);

    if (
      /^0x[a-fA-F0-9]{40}$/.test(String(currentAddress || "").trim()) &&
      currentAddress.toLowerCase() !== normalizedNew
    ) {
      const chainId = ctx.getCurrentChainId();
      const token = ctx.findTokenByAddress(currentAddress, chainId);
      const swappedDisplay = token
        ? formatTokenDisplay(token.symbol, token.address)
        : currentAddress;
      otherInput.value = swappedDisplay;
      otherInput.dataset.address = currentAddress;

      if (otherInput === ctx.fromInput) {
        updateTokenInputIcon(ctx.fromInput, ctx.fromIcon, ctx.fromWrapper, token ?? null);
        ctx.updateFromTokenBalance();
      } else if (otherInput === ctx.toInput) {
        updateTokenInputIcon(ctx.toInput, ctx.toIcon, ctx.toWrapper, token ?? null);
        ctx.updateToTokenBalance();
      }
    }
  }
}
