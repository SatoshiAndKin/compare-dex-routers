/**
 * Token balance display module.
 *
 * Manages:
 * - Fetching ERC-20 and native token balances via wallet provider
 * - Balance formatting with decimals and thousand separators
 * - Balance cache with TTL to avoid excessive RPC calls
 * - Display updates for from/to balance elements
 */

import type { EIP1193Provider, Token } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BalanceElements {
  fromBalanceEl: HTMLElement;
  toBalanceEl: HTMLElement;
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
}

export interface BalanceCallbacks {
  getCurrentChainId: () => number;
  hasConnectedWallet: () => boolean;
  getConnectedProvider: () => EIP1193Provider | null;
  getConnectedAddress: () => string;
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const BALANCE_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface CachedBalance {
  balance: string;
  timestamp: number;
}

const balanceCache = new Map<string, CachedBalance>();
let els: BalanceElements | null = null;
let cbs: BalanceCallbacks | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNativeToken(address: string): boolean {
  const addr = String(address || "").toLowerCase();
  return (
    addr === "0x0000000000000000000000000000000000000000" ||
    addr === NATIVE_TOKEN_ADDRESS.toLowerCase()
  );
}

/** Format a BigInt balance into a human-readable string with decimals */
export function formatBalance(balance: bigint, decimals: number): string {
  const dec = Number(decimals) || 18;
  const divisor = BigInt(10 ** dec);
  const wholePart = balance / divisor;
  const fractionalPart = balance % divisor;

  // Format fractional part with leading zeros
  let fractionalStr = fractionalPart.toString().padStart(dec, "0");
  // Remove trailing zeros
  fractionalStr = fractionalStr.replace(/0+$/, "");
  // Limit to 6 decimal places for display
  if (fractionalStr.length > 6) fractionalStr = fractionalStr.slice(0, 6);

  // Format whole part with thousand separators
  const wholeStr = String(wholePart).replace(new RegExp("\\B(?=(\\d{3})+(?!\\d))", "g"), ",");

  return fractionalStr ? wholeStr + "." + fractionalStr : wholeStr;
}

/** Fetch balance for a single token via wallet provider RPC */
export async function fetchTokenBalance(
  provider: EIP1193Provider,
  tokenAddress: string,
  walletAddress: string,
  decimals: number,
  chainId: number
): Promise<string | null> {
  if (!provider || !walletAddress || !tokenAddress) return null;

  const cacheKey = chainId + ":" + tokenAddress.toLowerCase() + ":" + walletAddress.toLowerCase();
  const cached = balanceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL_MS) {
    return cached.balance;
  }

  try {
    let balance: bigint;
    if (isNativeToken(tokenAddress)) {
      // Native ETH: use eth_getBalance
      const result = await provider.request({
        method: "eth_getBalance",
        params: [walletAddress, "latest"],
      });
      balance = BigInt(result as string);
    } else {
      // ERC-20: use eth_call with balanceOf selector
      const balanceOfSelector = "0x70a08231"; // balanceOf(address)
      const paddedAddress = walletAddress.slice(2).padStart(64, "0");
      const data = balanceOfSelector + paddedAddress;
      const result = await provider.request({
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"],
      });
      balance = BigInt(result as string);
    }

    const formatted = formatBalance(balance, decimals);
    balanceCache.set(cacheKey, { balance: formatted, timestamp: Date.now() });
    return formatted;
  } catch {
    // Silently fail - don't show error UI
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Update from-token balance display */
export async function updateFromTokenBalance(): Promise<void> {
  if (!els || !cbs) return;

  if (!cbs.hasConnectedWallet()) {
    els.fromBalanceEl.hidden = true;
    return;
  }

  const tokenAddress = els.fromInput.dataset.address;
  if (!tokenAddress) {
    els.fromBalanceEl.hidden = true;
    return;
  }

  const chainId = cbs.getCurrentChainId();
  const token = cbs.findTokenByAddress(tokenAddress, chainId);
  const decimals = token ? token.decimals : 18;

  els.fromBalanceEl.textContent = "Balance: ...";
  els.fromBalanceEl.hidden = false;

  const provider = cbs.getConnectedProvider();
  if (!provider) {
    els.fromBalanceEl.hidden = true;
    return;
  }

  const balance = await fetchTokenBalance(
    provider,
    tokenAddress,
    cbs.getConnectedAddress(),
    decimals,
    chainId
  );

  if (balance !== null) {
    els.fromBalanceEl.textContent = "Balance: " + balance;
    els.fromBalanceEl.hidden = false;
  } else {
    els.fromBalanceEl.hidden = true;
  }
}

/** Update to-token balance display */
export async function updateToTokenBalance(): Promise<void> {
  if (!els || !cbs) return;

  if (!cbs.hasConnectedWallet()) {
    els.toBalanceEl.hidden = true;
    return;
  }

  const tokenAddress = els.toInput.dataset.address;
  if (!tokenAddress) {
    els.toBalanceEl.hidden = true;
    return;
  }

  const chainId = cbs.getCurrentChainId();
  const token = cbs.findTokenByAddress(tokenAddress, chainId);
  const decimals = token ? token.decimals : 18;

  els.toBalanceEl.textContent = "Balance: ...";
  els.toBalanceEl.hidden = false;

  const provider = cbs.getConnectedProvider();
  if (!provider) {
    els.toBalanceEl.hidden = true;
    return;
  }

  const balance = await fetchTokenBalance(
    provider,
    tokenAddress,
    cbs.getConnectedAddress(),
    decimals,
    chainId
  );

  if (balance !== null) {
    els.toBalanceEl.textContent = "Balance: " + balance;
    els.toBalanceEl.hidden = false;
  } else {
    els.toBalanceEl.hidden = true;
  }
}

/** Update both from/to balances */
export function updateTokenBalances(): void {
  void updateFromTokenBalance();
  void updateToTokenBalance();
}

/** Clear balance displays and hide them */
export function clearBalances(): void {
  if (!els) return;
  els.fromBalanceEl.hidden = true;
  els.fromBalanceEl.textContent = "";
  els.toBalanceEl.hidden = true;
  els.toBalanceEl.textContent = "";
}

/** Clear the balance cache (e.g. on chain change) */
export function clearBalanceCache(): void {
  balanceCache.clear();
}

/** Initialize the balance module with DOM elements and callbacks */
export function initBalance(elements: BalanceElements, callbacks: BalanceCallbacks): void {
  els = elements;
  cbs = callbacks;
}
