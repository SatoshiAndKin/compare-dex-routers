/**
 * Gas price fallback module with per-block caching.
 *
 * When Spandex does not return gas_price_gwei in its quote response,
 * this module fetches the gas price from our own RPC node using viem's
 * getGasPrice() method.
 *
 * Caching strategy:
 * - Cache is keyed by (chainId, blockNumber)
 * - Multiple requests in the same block share one RPC call
 * - When the block advances, fresh gas price is fetched
 * - Different chains have independent cache entries
 *
 * Graceful degradation:
 * - If both Spandex and RPC fail, the quote still returns with null gas fields
 */

import type { PublicClient } from "viem";

/**
 * Cache entry for gas price data.
 */
interface GasPriceCacheEntry {
  blockNumber: bigint;
  gasPriceWei: bigint;
  timestamp: number; // For debugging/monitoring
}

/**
 * Cache keyed by chainId, storing block number and gas price.
 * Key format: `${chainId}:${blockNumber}`
 * This ensures per-chain, per-block isolation.
 */
const gasPriceCache = new Map<string, GasPriceCacheEntry>();

/**
 * Generate cache key for a chain and block.
 */
function getCacheKey(chainId: number, blockNumber: bigint): string {
  return `${chainId}:${blockNumber.toString()}`;
}

/**
 * Result of gas price fetch operation.
 */
export interface GasPriceResult {
  gasPriceGwei: string | null;
  blockNumber: bigint | null;
  fromCache: boolean;
}

/**
 * Fetch gas price with per-block caching.
 *
 * Flow:
 * 1. Get current block number from the client
 * 2. Check cache for (chainId, blockNumber)
 * 3. If cached, return cached value
 * 4. If not cached, fetch gas price via getGasPrice()
 * 5. Store in cache and return
 *
 * @param chainId - The chain ID
 * @param client - viem PublicClient for the chain
 * @returns GasPriceResult with gas price in gwei and block number
 */
export async function getGasPriceWithCache(
  chainId: number,
  client: PublicClient
): Promise<GasPriceResult> {
  // Get current block number first
  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    // Block number fetch failed - graceful degradation
    return { gasPriceGwei: null, blockNumber: null, fromCache: false };
  }

  if (blockNumber === undefined || blockNumber === null) {
    return { gasPriceGwei: null, blockNumber: null, fromCache: false };
  }

  const cacheKey = getCacheKey(chainId, blockNumber);

  // Check cache for this chain+block
  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    const gasPriceGwei = (Number(cached.gasPriceWei) / 1e9).toFixed(4);
    return {
      gasPriceGwei,
      blockNumber: cached.blockNumber,
      fromCache: true,
    };
  }

  // Cache miss - fetch fresh gas price
  let gasPriceWei: bigint;
  try {
    gasPriceWei = await client.getGasPrice();
  } catch {
    // Gas price fetch failed - return with null gas but valid block number
    return { gasPriceGwei: null, blockNumber, fromCache: false };
  }

  if (gasPriceWei === undefined || gasPriceWei === null) {
    return { gasPriceGwei: null, blockNumber, fromCache: false };
  }

  // Store in cache
  gasPriceCache.set(cacheKey, {
    blockNumber,
    gasPriceWei,
    timestamp: Date.now(),
  });

  const gasPriceGwei = (Number(gasPriceWei) / 1e9).toFixed(4);
  return {
    gasPriceGwei,
    blockNumber,
    fromCache: false,
  };
}

/**
 * Get cached gas price for a specific chain and block (without fetching).
 * Returns null if not cached.
 *
 * Useful for checking if we have a cached value before deciding to fetch.
 */
export function getCachedGasPrice(chainId: number, blockNumber: bigint): string | null {
  const cacheKey = getCacheKey(chainId, blockNumber);
  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    return (Number(cached.gasPriceWei) / 1e9).toFixed(4);
  }
  return null;
}

/**
 * Clear the gas price cache.
 * Primarily for testing purposes.
 */
export function clearGasPriceCache(): void {
  gasPriceCache.clear();
}

/**
 * Get cache statistics for monitoring/debugging.
 */
export function getGasPriceCacheStats(): {
  size: number;
  entries: Array<{ chainId: number; blockNumber: string; gasPriceGwei: string }>;
} {
  const entries = Array.from(gasPriceCache.entries()).map(([key, value]) => {
    const parts = key.split(":");
    const chainIdStr = parts[0] ?? "0";
    const blockNumberStr = parts[1] ?? "0";
    return {
      chainId: parseInt(chainIdStr, 10),
      blockNumber: blockNumberStr,
      gasPriceGwei: (Number(value.gasPriceWei) / 1e9).toFixed(4),
    };
  });

  return {
    size: gasPriceCache.size,
    entries,
  };
}

/**
 * Invalidate cache entries for a specific chain.
 * Called when switching chains to ensure fresh data.
 */
export function invalidateChainCache(chainId: number): void {
  const prefix = `${chainId}:`;
  for (const key of gasPriceCache.keys()) {
    if (key.startsWith(prefix)) {
      gasPriceCache.delete(key);
    }
  }
}
