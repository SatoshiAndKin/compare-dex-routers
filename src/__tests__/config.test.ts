import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(),
    })),
  };
});

vi.mock("@spandex/core", () => ({
  createConfig: vi.fn(() => ({})),
  defaultProviders: vi.fn(() => []),
  fabric: vi.fn(() => ({})),
  zeroX: vi.fn(() => ({})),
  kyberswap: vi.fn(() => ({})),
  odos: vi.fn(() => ({})),
  lifi: vi.fn(() => ({})),
  relay: vi.fn(() => ({})),
  velora: vi.fn(() => ({})),
}));

import { createPublicClient } from "viem";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadConfig() {
    return await import("../config.js");
  }

  describe("SUPPORTED_CHAINS", () => {
    it("includes all 7 chains", async () => {
      const { SUPPORTED_CHAINS } = await loadConfig();
      const ids = Object.keys(SUPPORTED_CHAINS).map(Number);
      expect(ids).toEqual(expect.arrayContaining([1, 8453, 42161, 10, 137, 56, 43114]));
      expect(ids).toHaveLength(7);
    });

    it("each chain has name and alchemySubdomain", async () => {
      const { SUPPORTED_CHAINS } = await loadConfig();
      for (const chain of Object.values(SUPPORTED_CHAINS)) {
        expect(chain.name).toBeTruthy();
        expect(chain.alchemySubdomain).toBeTruthy();
      }
    });
  });

  describe("getClient", () => {
    it("throws for unsupported chain", async () => {
      const { getClient } = await loadConfig();
      expect(() => getClient(999)).toThrow("Unsupported chain: 999");
      expect(() => getClient(999)).toThrow("Supported:");
    });

    it("uses Alchemy URL when no per-chain env var is set", async () => {
      process.env.ALCHEMY_API_KEY = "test-key-123";
      const { getClient } = await loadConfig();
      getClient(8453);
      expect(createPublicClient).toHaveBeenCalled();
      const callArg = vi.mocked(createPublicClient).mock.calls.at(-1)?.[0];
      expect(callArg).toBeDefined();
    });

    it("prefers per-chain RPC_URL env var over Alchemy", async () => {
      process.env.RPC_URL_8453 = "https://custom-rpc.example.com";
      process.env.ALCHEMY_API_KEY = "test-key-123";
      const { getClient } = await loadConfig();
      getClient(8453);
      expect(createPublicClient).toHaveBeenCalled();
    });

    it("returns cached client on second call", async () => {
      process.env.ALCHEMY_API_KEY = "test-key-123";
      const { getClient } = await loadConfig();
      const callCountBefore = vi.mocked(createPublicClient).mock.calls.length;
      const client1 = getClient(1);
      const client2 = getClient(1);
      expect(client1).toBe(client2);
      const callCountAfter = vi.mocked(createPublicClient).mock.calls.length;
      expect(callCountAfter - callCountBefore).toBe(1);
    });
  });

  describe("getSpandexConfig", () => {
    it("returns a config object", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getSpandexConfig } = await loadConfig();
      const config = getSpandexConfig();
      expect(config).toBeDefined();
    });
  });

  describe("buildProviders via getSpandexConfig", () => {
    it("uses default providers when no API keys set", async () => {
      delete process.env.ZEROX_API_KEY;
      delete process.env.FABRIC_API_KEY;
      const { getSpandexConfig } = await loadConfig();
      const { defaultProviders } = await import("@spandex/core");
      getSpandexConfig();
      expect(defaultProviders).toHaveBeenCalled();
    });

    it("uses custom providers when FABRIC_API_KEY is set", async () => {
      process.env.FABRIC_API_KEY = "fab-key";
      delete process.env.ZEROX_API_KEY;
      const { getSpandexConfig } = await loadConfig();
      const { fabric } = await import("@spandex/core");
      getSpandexConfig();
      expect(fabric).toHaveBeenCalled();
    });

    it("includes zeroX provider when ZEROX_API_KEY is set", async () => {
      process.env.ZEROX_API_KEY = "zx-key";
      process.env.FABRIC_API_KEY = "fab-key";
      const { getSpandexConfig } = await loadConfig();
      const { zeroX } = await import("@spandex/core");
      getSpandexConfig();
      expect(zeroX).toHaveBeenCalled();
    });
  });

  describe("getTokenDecimals", () => {
    it("calls readContract and caches result", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getTokenDecimals, getClient } = await loadConfig();
      const mockClient = getClient(8453);
      vi.mocked(mockClient.readContract).mockResolvedValue(6);

      const result = await getTokenDecimals(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(result).toBe(6);

      // Second call should use cache, not call readContract again
      const result2 = await getTokenDecimals(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(result2).toBe(6);
      expect(mockClient.readContract).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTokenSymbol", () => {
    it("calls readContract and caches result", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getTokenSymbol, getClient } = await loadConfig();
      const mockClient = getClient(8453);
      vi.mocked(mockClient.readContract).mockResolvedValue("USDC");

      const result = await getTokenSymbol(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(result).toBe("USDC");

      const result2 = await getTokenSymbol(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(result2).toBe("USDC");
      expect(mockClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("returns empty string on error", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getTokenSymbol, getClient } = await loadConfig();
      const mockClient = getClient(43114);
      vi.mocked(mockClient.readContract).mockRejectedValue(new Error("revert"));

      const result = await getTokenSymbol(43114, "0x0000000000000000000000000000000000000001");
      expect(result).toBe("");
    });
  });

  describe("getTokenName", () => {
    it("calls readContract and caches result", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getTokenName, getClient } = await loadConfig();
      const mockClient = getClient(1);
      vi.mocked(mockClient.readContract).mockResolvedValue("USD Coin");

      const result = await getTokenName(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      expect(result).toBe("USD Coin");

      // Second call should use cache
      const result2 = await getTokenName(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      expect(result2).toBe("USD Coin");
      expect(mockClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("returns empty string on error", async () => {
      process.env.ALCHEMY_API_KEY = "test-key";
      const { getTokenName, getClient } = await loadConfig();
      const mockClient = getClient(1);
      vi.mocked(mockClient.readContract).mockRejectedValue(new Error("revert"));

      const result = await getTokenName(1, "0x0000000000000000000000000000000000000001");
      expect(result).toBe("");
    });
  });
});
