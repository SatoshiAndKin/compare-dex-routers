/**
 * Balance store for token balances.
 * Handles ERC-20 and native token balance fetching via wallet provider RPC.
 * Ported from src/client/balance.ts for Svelte 5.
 */

import type { EIP1193Provider } from './walletStore.svelte.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const BALANCE_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenRef {
  address: string;
  decimals: number;
  symbol?: string;
}

interface CachedBalance {
  balance: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Module-level cache (shared across all balance store instances)
// ---------------------------------------------------------------------------

const balanceCache = new Map<string, CachedBalance>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNativeToken(address: string): boolean {
  const addr = String(address ?? '').toLowerCase();
  return (
    addr === '0x0000000000000000000000000000000000000000' ||
    addr === NATIVE_TOKEN_ADDRESS.toLowerCase()
  );
}

/**
 * Format a BigInt balance into a human-readable string with decimals.
 * Exported for testing.
 */
export function formatBalance(balance: bigint, decimals: number): string {
  const dec = Math.max(0, Number(decimals) || 18);
  const divisor = BigInt(10 ** dec);
  const wholePart = balance / divisor;
  const fractionalPart = balance % divisor;

  // Format fractional part with leading zeros up to `dec` digits
  let fractionalStr = fractionalPart.toString().padStart(dec, '0');
  // Remove trailing zeros
  fractionalStr = fractionalStr.replace(/0+$/, '');
  // Limit to 6 decimal places for display
  if (fractionalStr.length > 6) fractionalStr = fractionalStr.slice(0, 6);

  // Format whole part with thousand separators
  const wholeStr = String(wholePart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return fractionalStr ? wholeStr + '.' + fractionalStr : wholeStr;
}

/**
 * Fetch balance for a single token via wallet provider RPC.
 * Uses a 30-second TTL cache to avoid excessive RPC calls.
 * Returns null on error (silently fails to avoid breaking UI).
 */
export async function fetchTokenBalance(
  provider: EIP1193Provider,
  tokenAddress: string,
  walletAddress: string,
  decimals: number,
  chainId: number,
): Promise<string | null> {
  if (!provider || !walletAddress || !tokenAddress) return null;

  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
  const cached = balanceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL_MS) {
    return cached.balance;
  }

  try {
    let balance: bigint;

    if (isNativeToken(tokenAddress)) {
      // Native token (ETH/BNB/etc): use eth_getBalance
      const result = (await provider.request({
        method: 'eth_getBalance',
        params: [walletAddress, 'latest'],
      })) as string;
      balance = BigInt(result);
    } else {
      // ERC-20: use eth_call with balanceOf(address) selector
      const balanceOfSelector = '0x70a08231'; // keccak256("balanceOf(address)")[0..4]
      const paddedAddress = walletAddress.slice(2).padStart(64, '0');
      const data = balanceOfSelector + paddedAddress;
      const result = (await provider.request({
        method: 'eth_call',
        params: [{ to: tokenAddress, data }, 'latest'],
      })) as string;
      balance = BigInt(result);
    }

    const formatted = formatBalance(balance, decimals);
    balanceCache.set(cacheKey, { balance: formatted, timestamp: Date.now() });
    return formatted;
  } catch {
    // Silently fail — don't show RPC errors for balance fetching
    return null;
  }
}

// ---------------------------------------------------------------------------
// BalanceStore class
// ---------------------------------------------------------------------------

class BalanceStore {
  /** Formatted balance for the "from" token (null when unknown / not connected) */
  fromBalance = $state<string | null>(null);
  /** Formatted balance for the "to" token (null when unknown / not connected) */
  toBalance = $state<string | null>(null);

  /**
   * Fetch balances for both tokens in parallel.
   * Sets fromBalance / toBalance when complete.
   */
  async fetchBalances(
    provider: EIP1193Provider,
    walletAddress: string,
    chainId: number,
    fromToken: TokenRef | null,
    toToken: TokenRef | null,
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    if (fromToken) {
      promises.push(
        fetchTokenBalance(provider, fromToken.address, walletAddress, fromToken.decimals, chainId)
          .then((bal) => {
            this.fromBalance = bal;
          })
          .catch(() => {
            this.fromBalance = null;
          }),
      );
    } else {
      this.fromBalance = null;
    }

    if (toToken) {
      promises.push(
        fetchTokenBalance(provider, toToken.address, walletAddress, toToken.decimals, chainId)
          .then((bal) => {
            this.toBalance = bal;
          })
          .catch(() => {
            this.toBalance = null;
          }),
      );
    } else {
      this.toBalance = null;
    }

    await Promise.all(promises);
  }

  /** Clear displayed balances (e.g. on wallet disconnect or token change). */
  clear(): void {
    this.fromBalance = null;
    this.toBalance = null;
  }

  /** Clear the TTL cache (e.g. on chain change). */
  clearCache(): void {
    balanceCache.clear();
  }
}

export const balanceStore = new BalanceStore();
