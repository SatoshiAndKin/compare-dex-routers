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
 * - TTL-based eviction: entries older than 5 minutes are evicted
 * - Max-size eviction: when cache exceeds 1000 entries, oldest are evicted
 *
 * Graceful degradation:
 * - If both Spandex and RPC fail, the quote still returns with null gas fields
 */

import type { PublicClient } from "viem";
import { logger } from "./logger.js";

/** Cache TTL in milliseconds (5 minutes) */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of entries in the cache */
export const MAX_CACHE_SIZE = 1000;

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
 *
 * Eviction policy:
 * - TTL: entries older than CACHE_TTL_MS are considered stale
 * - Max-size: when cache exceeds MAX_CACHE_SIZE, oldest entries are evicted
 */
const gasPriceCache = new Map<string, GasPriceCacheEntry>();

/**
 * Evict expired and excess entries from the cache.
 * Called after adding new entries to prevent unbounded growth.
 */
function evictStaleEntries(): void {
  const now = Date.now();

  // Evict TTL-expired entries
  for (const [key, entry] of gasPriceCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      gasPriceCache.delete(key);
    }
  }

  // If still over max size, evict oldest entries
  if (gasPriceCache.size > MAX_CACHE_SIZE) {
    // Get entries sorted by timestamp (oldest first)
    const entries = Array.from(gasPriceCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );

    // Evict oldest until under max size
    const toEvict = entries.slice(0, gasPriceCache.size - MAX_CACHE_SIZE);
    for (const [key] of toEvict) {
      gasPriceCache.delete(key);
    }

    if (toEvict.length > 0) {
      logger.debug(
        { evictedCount: toEvict.length, remainingSize: gasPriceCache.size },
        "Gas price cache evicted oldest entries to stay under max size"
      );
    }
  }
}

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
  } catch (error) {
    // Block number fetch failed - graceful degradation
    logger.debug(
      { chainId, error: String(error) },
      "Failed to fetch block number for gas price cache"
    );
    return { gasPriceGwei: null, blockNumber: null, fromCache: false };
  }

  if (blockNumber === undefined || blockNumber === null) {
    return { gasPriceGwei: null, blockNumber: null, fromCache: false };
  }

  const cacheKey = getCacheKey(chainId, blockNumber);

  // Check cache for this chain+block (also check TTL)
  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    // Check if entry has expired due to TTL
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      const gasPriceGwei = (Number(cached.gasPriceWei) / 1e9).toFixed(4);
      return {
        gasPriceGwei,
        blockNumber: cached.blockNumber,
        fromCache: true,
      };
    }
    // Entry expired, remove it and fetch fresh
    gasPriceCache.delete(cacheKey);
  }

  // Cache miss - fetch fresh gas price
  let gasPriceWei: bigint;
  try {
    gasPriceWei = await client.getGasPrice();
  } catch (error) {
    // Gas price fetch failed - return with null gas but valid block number
    logger.debug(
      { chainId, blockNumber: blockNumber.toString(), error: String(error) },
      "Failed to fetch gas price from RPC"
    );
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

  // Evict stale entries to prevent unbounded growth
  evictStaleEntries();

  const gasPriceGwei = (Number(gasPriceWei) / 1e9).toFixed(4);
  return {
    gasPriceGwei,
    blockNumber,
    fromCache: false,
  };
}

/**
 * Get cached gas price for a specific chain and block (without fetching).
 * Returns null if not cached or if entry has expired due to TTL.
 *
 * Useful for checking if we have a cached value before deciding to fetch.
 */
export function getCachedGasPrice(chainId: number, blockNumber: bigint): string | null {
  const cacheKey = getCacheKey(chainId, blockNumber);
  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    // Check TTL - if expired, treat as cache miss
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      return (Number(cached.gasPriceWei) / 1e9).toFixed(4);
    }
    // Entry expired, remove it
    gasPriceCache.delete(cacheKey);
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
