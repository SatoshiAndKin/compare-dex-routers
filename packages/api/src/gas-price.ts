/**
 * Gas price fallback with per-block caching.
 * Fetches gas price from RPC when Spandex doesn't provide it.
 * Cache keyed by (chainId, blockNumber) with 5-minute TTL and 1000-entry max.
 */

import type { PublicClient } from "viem";
import { logger } from "./logger.js";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_CACHE_SIZE = 1000;

interface GasPriceCacheEntry {
  blockNumber: bigint;
  gasPriceWei: bigint;
  timestamp: number;
}

const gasPriceCache = new Map<string, GasPriceCacheEntry>();

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
        "Gas price cache evicted oldest entries"
      );
    }
  }
}

function getCacheKey(chainId: number, blockNumber: bigint): string {
  return `${chainId}:${blockNumber.toString()}`;
}

export interface GasPriceResult {
  gasPriceGwei: string | null;
  blockNumber: bigint | null;
  fromCache: boolean;
}

/** Fetch gas price with per-block caching. Returns null fields on failure. */
export async function getGasPriceWithCache(
  chainId: number,
  client: PublicClient
): Promise<GasPriceResult> {
  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch (error) {
    logger.debug(
      { chainId, error: String(error) },
      "Failed to fetch block number for gas price cache"
    );
    return { gasPriceGwei: null, blockNumber: null, fromCache: false };
  }

  const cacheKey = getCacheKey(chainId, blockNumber);

  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      const gasPriceGwei = (Number(cached.gasPriceWei) / 1e9).toFixed(4);
      return {
        gasPriceGwei,
        blockNumber: cached.blockNumber,
        fromCache: true,
      };
    }
    gasPriceCache.delete(cacheKey);
  }

  let gasPriceWei: bigint;
  try {
    gasPriceWei = await client.getGasPrice();
  } catch (error) {
    logger.debug(
      { chainId, blockNumber: blockNumber.toString(), error: String(error) },
      "Failed to fetch gas price from RPC"
    );
    return { gasPriceGwei: null, blockNumber, fromCache: false };
  }

  gasPriceCache.set(cacheKey, {
    blockNumber,
    gasPriceWei,
    timestamp: Date.now(),
  });

  evictStaleEntries();

  const gasPriceGwei = (Number(gasPriceWei) / 1e9).toFixed(4);
  return {
    gasPriceGwei,
    blockNumber,
    fromCache: false,
  };
}

/** Get cached gas price for a specific chain and block (without fetching). */
export function getCachedGasPrice(chainId: number, blockNumber: bigint): string | null {
  const cacheKey = getCacheKey(chainId, blockNumber);
  const cached = gasPriceCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      return (Number(cached.gasPriceWei) / 1e9).toFixed(4);
    }
    gasPriceCache.delete(cacheKey);
  }
  return null;
}

/** Clear the gas price cache (for testing). */
export function clearGasPriceCache(): void {
  gasPriceCache.clear();
}

/** Get cache statistics for monitoring/debugging. */
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

/** Invalidate cache entries for a specific chain. */
export function invalidateChainCache(chainId: number): void {
  const prefix = `${chainId}:`;
  for (const key of gasPriceCache.keys()) {
    if (key.startsWith(prefix)) {
      gasPriceCache.delete(key);
    }
  }
}
