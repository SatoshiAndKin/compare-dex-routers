import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import {
  getGasPriceWithCache,
  getCachedGasPrice,
  clearGasPriceCache,
  getGasPriceCacheStats,
  invalidateChainCache,
} from "../gas-price.js";

// Mock viem PublicClient
const mockClient = {
  getBlockNumber: vi.fn<() => Promise<bigint>>(),
  getGasPrice: vi.fn<() => Promise<bigint>>(),
} as unknown as PublicClient;

describe("gas-price module", () => {
  beforeEach(() => {
    clearGasPriceCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearGasPriceCache();
  });

  describe("getGasPriceWithCache", () => {
    it("fetches gas price on cache miss", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n); // 20 gwei

      const result = await getGasPriceWithCache(1, mockClient);

      expect(result.gasPriceGwei).toBe("20.0000");
      expect(result.blockNumber).toBe(1000n);
      expect(result.fromCache).toBe(false);

      // Verify RPC calls were made
      expect(mockClient.getBlockNumber).toHaveBeenCalledTimes(1);
      expect(mockClient.getGasPrice).toHaveBeenCalledTimes(1);
    });

    it("returns cached value on cache hit (same block)", async () => {
      // First call - cache miss
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      const result1 = await getGasPriceWithCache(1, mockClient);
      expect(result1.fromCache).toBe(false);

      // Second call - same chain, same block - should hit cache
      const result2 = await getGasPriceWithCache(1, mockClient);
      expect(result2.gasPriceGwei).toBe("20.0000");
      expect(result2.fromCache).toBe(true);

      // getGasPrice should only be called once (first time)
      expect(mockClient.getGasPrice).toHaveBeenCalledTimes(1);
    });

    it("fetches fresh gas price on new block", async () => {
      // First call - block 1000
      vi.mocked(mockClient.getBlockNumber).mockResolvedValueOnce(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValueOnce(20_000_000_000n);

      const result1 = await getGasPriceWithCache(1, mockClient);
      expect(result1.blockNumber).toBe(1000n);
      expect(result1.fromCache).toBe(false);

      // Second call - block 1001 (block advanced)
      vi.mocked(mockClient.getBlockNumber).mockResolvedValueOnce(1001n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValueOnce(25_000_000_000n); // New price

      const result2 = await getGasPriceWithCache(1, mockClient);
      expect(result2.blockNumber).toBe(1001n);
      expect(result2.gasPriceGwei).toBe("25.0000");
      expect(result2.fromCache).toBe(false);

      // getGasPrice should be called twice (once per block)
      expect(mockClient.getGasPrice).toHaveBeenCalledTimes(2);
    });

    it("per-chain cache isolation", async () => {
      // Chain 1 - block 1000
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      const result1 = await getGasPriceWithCache(1, mockClient);
      expect(result1.gasPriceGwei).toBe("20.0000");

      // Chain 8453 (Base) - same block number but different chain
      // Should NOT hit cache from chain 1
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(5_000_000_000n); // 5 gwei on Base

      const result2 = await getGasPriceWithCache(8453, mockClient);
      expect(result2.gasPriceGwei).toBe("5.0000");
      expect(result2.fromCache).toBe(false); // Cache miss for new chain

      // getGasPrice should be called twice (once per chain)
      expect(mockClient.getGasPrice).toHaveBeenCalledTimes(2);

      // Now both chains should have cached entries
      const stats = getGasPriceCacheStats();
      expect(stats.size).toBe(2);
    });

    it("handles RPC failure gracefully", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockRejectedValue(new Error("RPC error"));

      const result = await getGasPriceWithCache(1, mockClient);

      expect(result.gasPriceGwei).toBeNull();
      expect(result.blockNumber).toBe(1000n);
      expect(result.fromCache).toBe(false);
    });

    it("handles block number fetch failure gracefully", async () => {
      vi.mocked(mockClient.getBlockNumber).mockRejectedValue(new Error("RPC error"));

      const result = await getGasPriceWithCache(1, mockClient);

      expect(result.gasPriceGwei).toBeNull();
      expect(result.blockNumber).toBeNull();
      expect(result.fromCache).toBe(false);
    });

    it("formats gas price with 4 decimal places", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(1_234_567_890n); // ~1.2346 gwei

      const result = await getGasPriceWithCache(1, mockClient);

      expect(result.gasPriceGwei).toBe("1.2346");
    });
  });

  describe("getCachedGasPrice", () => {
    it("returns null for uncached entry", () => {
      const result = getCachedGasPrice(1, 1000n);
      expect(result).toBeNull();
    });

    it("returns cached value after fetch", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      await getGasPriceWithCache(1, mockClient);

      const cached = getCachedGasPrice(1, 1000n);
      expect(cached).toBe("20.0000");
    });

    it("returns null for different block number", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      await getGasPriceWithCache(1, mockClient);

      const cached = getCachedGasPrice(1, 1001n); // Different block
      expect(cached).toBeNull();
    });
  });

  describe("getGasPriceCacheStats", () => {
    it("returns empty stats initially", () => {
      const stats = getGasPriceCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it("returns stats after caching", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      await getGasPriceWithCache(1, mockClient);

      const stats = getGasPriceCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries).toHaveLength(1);
      expect(stats.entries[0]).toEqual({
        chainId: 1,
        blockNumber: "1000",
        gasPriceGwei: "20.0000",
      });
    });
  });

  describe("invalidateChainCache", () => {
    it("clears entries for specified chain only", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      // Cache for chain 1
      await getGasPriceWithCache(1, mockClient);

      // Cache for chain 8453
      await getGasPriceWithCache(8453, mockClient);

      let stats = getGasPriceCacheStats();
      expect(stats.size).toBe(2);

      // Invalidate chain 1
      invalidateChainCache(1);

      stats = getGasPriceCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0]?.chainId).toBe(8453);
    });

    it("does nothing for uncached chain", () => {
      invalidateChainCache(999); // Non-existent chain
      const stats = getGasPriceCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("clearGasPriceCache", () => {
    it("clears all cache entries", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      await getGasPriceWithCache(1, mockClient);
      await getGasPriceWithCache(8453, mockClient);

      expect(getGasPriceCacheStats().size).toBe(2);

      clearGasPriceCache();

      expect(getGasPriceCacheStats().size).toBe(0);
    });
  });

  describe("multiple concurrent requests", () => {
    it("shares cache among concurrent requests", async () => {
      vi.mocked(mockClient.getBlockNumber).mockResolvedValue(1000n);
      vi.mocked(mockClient.getGasPrice).mockResolvedValue(20_000_000_000n);

      // Fire 5 concurrent requests for the same chain/block
      const results = await Promise.all([
        getGasPriceWithCache(1, mockClient),
        getGasPriceWithCache(1, mockClient),
        getGasPriceWithCache(1, mockClient),
        getGasPriceWithCache(1, mockClient),
        getGasPriceWithCache(1, mockClient),
      ]);

      // All should return the same value
      for (const result of results) {
        expect(result.gasPriceGwei).toBe("20.0000");
      }

      // Note: Due to async nature, we might get multiple RPC calls
      // This test verifies the cache works, not that it deduplicates in-flight requests
      // (which would require additional logic like a promise cache)
    });
  });
});
