import { beforeEach, describe, expect, it, vi } from "vitest";

const makeAddress = (char: string) => `0x${char.repeat(40)}`;
const ADDR_FROM = makeAddress("1");
const ADDR_TO = makeAddress("2");
const ADDR_POOL = makeAddress("3");
const ADDR_ROUTER = makeAddress("4");
const ADDR_SENDER = makeAddress("5");
const ADDR_APPROVAL = makeAddress("6");

// Mock curve instance
const createMockCurveInstance = () => ({
  init: vi.fn(),
  factory: { fetchPools: vi.fn() },
  crvUSDFactory: { fetchPools: vi.fn() },
  cryptoFactory: { fetchPools: vi.fn() },
  twocryptoFactory: { fetchPools: vi.fn() },
  tricryptoFactory: { fetchPools: vi.fn() },
  stableNgFactory: { fetchPools: vi.fn() },
  getCoinsData: vi.fn(),
  hasAllowance: vi.fn(),
  router: {
    getBestRouteAndOutput: vi.fn(),
    populateSwap: vi.fn(),
    populateApprove: vi.fn(),
    required: vi.fn(),
  },
});

const mockCurveInstance = createMockCurveInstance();

vi.mock("@curvefi/api", () => ({
  createCurve: () => mockCurveInstance,
}));

describe("curve multi-chain integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCurveInstance.init.mockResolvedValue(undefined);
    mockCurveInstance.factory.fetchPools.mockResolvedValue(undefined);
    mockCurveInstance.crvUSDFactory.fetchPools.mockResolvedValue(undefined);
    mockCurveInstance.cryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurveInstance.twocryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurveInstance.tricryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurveInstance.stableNgFactory.fetchPools.mockResolvedValue(undefined);

    mockCurveInstance.router.getBestRouteAndOutput.mockResolvedValue({
      route: [
        {
          poolId: "pool-1",
          poolName: "Pool One",
          poolAddress: ADDR_POOL,
          inputCoinAddress: ADDR_FROM,
          outputCoinAddress: ADDR_TO,
        },
      ],
      output: "123.45",
    });

    mockCurveInstance.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "7",
    });

    mockCurveInstance.router.populateApprove.mockResolvedValue([
      { to: ADDR_APPROVAL, data: "0xbeef" },
    ]);
    mockCurveInstance.hasAllowance.mockResolvedValue(false);

    mockCurveInstance.getCoinsData.mockImplementation(async ([address]: string[]) => {
      const lower = String(address).toLowerCase();
      if (lower === ADDR_FROM.toLowerCase()) return [{ symbol: "USDC" }];
      if (lower === ADDR_TO.toLowerCase()) return [{ symbol: "WETH" }];
      return [{ symbol: "LP" }];
    });

    mockCurveInstance.router.required.mockResolvedValue("10.5");
  });

  it("isCurveSupported returns true for all 7 supported chains", async () => {
    vi.resetModules();
    const { isCurveSupported, CURVE_SUPPORTED_CHAINS } = await import("../curve.js");

    // Check the list
    expect(CURVE_SUPPORTED_CHAINS).toEqual([1, 8453, 42161, 10, 137, 56, 43114]);

    // Check each chain
    expect(isCurveSupported(1)).toBe(true); // Ethereum
    expect(isCurveSupported(8453)).toBe(true); // Base
    expect(isCurveSupported(42161)).toBe(true); // Arbitrum
    expect(isCurveSupported(10)).toBe(true); // Optimism
    expect(isCurveSupported(137)).toBe(true); // Polygon
    expect(isCurveSupported(56)).toBe(true); // BSC
    expect(isCurveSupported(43114)).toBe(true); // Avalanche

    // Unsupported chain
    expect(isCurveSupported(999)).toBe(false);
  });

  it("initCurveInstance initializes a curve instance for a chain", async () => {
    vi.resetModules();
    const { initCurveInstance, isCurveInitialized } = await import("../curve.js");

    const result = await initCurveInstance(1, "https://eth-mainnet.example.com");

    expect(result).not.toBeNull();
    expect(isCurveInitialized(1)).toBe(true);
    expect(mockCurveInstance.init).toHaveBeenCalledWith(
      "JsonRpc",
      { url: "https://eth-mainnet.example.com" },
      { chainId: 1 }
    );
  });

  it("initCurveInstance handles initialization failure gracefully", async () => {
    vi.resetModules();
    const { initCurveInstance, isCurveInitialized, getCurveInitError } =
      await import("../curve.js");

    mockCurveInstance.init.mockRejectedValueOnce(new Error("RPC connection failed"));

    const result = await initCurveInstance(8453, "https://base-mainnet.example.com");

    expect(result).toBeNull();
    expect(isCurveInitialized(8453)).toBe(false);
    expect(getCurveInitError(8453)).toBe("RPC connection failed");
  });

  it("initAllCurveInstances initializes all chains in parallel", async () => {
    vi.resetModules();
    const { initAllCurveInstances, isCurveInitialized, CURVE_SUPPORTED_CHAINS } =
      await import("../curve.js");

    const log = vi.fn();
    const logError = vi.fn();
    const getRpcUrl = (chainId: number) => `https://chain-${chainId}.example.com`;

    await initAllCurveInstances(getRpcUrl, log, logError);

    // All chains should be initialized
    for (const chainId of CURVE_SUPPORTED_CHAINS) {
      expect(isCurveInitialized(chainId)).toBe(true);
    }

    // Should have logged for each chain
    expect(log).toHaveBeenCalledTimes(7);
  });

  it("initAllCurveInstances continues when one chain fails", async () => {
    vi.resetModules();
    const { initAllCurveInstances, isCurveInitialized } = await import("../curve.js");

    // Make chain 137 fail
    mockCurveInstance.init.mockImplementation(
      async (_type: string, _settings: object, options: { chainId: number }) => {
        if (options.chainId === 137) {
          throw new Error("Polygon RPC failed");
        }
      }
    );

    const log = vi.fn();
    const logError = vi.fn();
    const getRpcUrl = (chainId: number) => `https://chain-${chainId}.example.com`;

    await initAllCurveInstances(getRpcUrl, log, logError);

    // Other chains should still be initialized
    expect(isCurveInitialized(1)).toBe(true);
    expect(isCurveInitialized(8453)).toBe(true);
    expect(isCurveInitialized(137)).toBe(false);

    // Error should be logged (logError is called with just the message string)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("137"));
  });

  it("findCurveQuote throws when Curve is not initialized for chain", async () => {
    vi.resetModules();
    const { findCurveQuote } = await import("../curve.js");

    await expect(findCurveQuote(8453, ADDR_FROM, ADDR_TO, "1")).rejects.toThrow(
      "Curve not initialized for chain 8453"
    );
  });

  it("findCurveQuote returns quote with symbols, gas estimate, and approval tx", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    const client = {
      estimateGas: vi.fn().mockResolvedValue(21000n),
    };

    const result = await findCurveQuote(1, ADDR_FROM, ADDR_TO, "10", ADDR_SENDER, client as never);

    expect(result).toMatchObject({
      source: "curve",
      from: ADDR_FROM,
      from_symbol: "USDC",
      to: ADDR_TO,
      to_symbol: "WETH",
      amount: "10",
      output_amount: "123.45",
      router_address: ADDR_ROUTER,
      router_calldata: "0xabcdef",
      approval_target: ADDR_APPROVAL,
      approval_calldata: "0xbeef",
      gas_used: "21000",
    });
    expect(result.route_symbols[ADDR_FROM.toLowerCase()]).toBe("USDC");
    expect(result.route_symbols[ADDR_TO.toLowerCase()]).toBe("WETH");

    expect(client.estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ADDR_SENDER,
        to: ADDR_ROUTER,
        data: "0xabcdef",
        value: 7n,
      })
    );
    expect(mockCurveInstance.hasAllowance).toHaveBeenCalledWith(
      [ADDR_FROM],
      ["10"],
      ADDR_SENDER,
      ADDR_ROUTER
    );
    expect(mockCurveInstance.router.populateApprove).toHaveBeenCalledWith(
      ADDR_FROM,
      "10",
      false,
      ADDR_SENDER
    );
  });

  it("findCurveQuote skips gas and approval checks for invalid sender", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    const client = {
      estimateGas: vi.fn(),
    };

    const result = await findCurveQuote(
      1,
      ADDR_FROM,
      ADDR_TO,
      "10",
      "not-an-address",
      client as never
    );

    expect(result.gas_used).toBeUndefined();
    expect(result.approval_target).toBeUndefined();
    expect(client.estimateGas).not.toHaveBeenCalled();
    expect(mockCurveInstance.hasAllowance).not.toHaveBeenCalled();
    expect(mockCurveInstance.router.populateApprove).not.toHaveBeenCalled();
  });

  it("findCurveQuote handles symbol lookup and gas/approval failures gracefully", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    mockCurveInstance.getCoinsData.mockRejectedValueOnce(new Error("symbol failure"));
    mockCurveInstance.getCoinsData.mockResolvedValue([{ symbol: "WETH" }]);
    mockCurveInstance.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "0",
    });
    mockCurveInstance.hasAllowance.mockRejectedValue(new Error("allowance failure"));

    const client = {
      estimateGas: vi.fn().mockRejectedValue(new Error("estimation failed")),
    };

    const result = await findCurveQuote(1, ADDR_FROM, ADDR_TO, "10", ADDR_SENDER, client as never);
    expect(result.from_symbol).toBe("");
    expect(result.to_symbol).toBe("WETH");
    expect(result.gas_used).toBeUndefined();
    expect(result.approval_target).toBeUndefined();
  });

  it("findCurveQuote throws if populateSwap does not return transaction data", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    mockCurveInstance.router.populateSwap.mockResolvedValue({ to: "", data: "" });

    await expect(findCurveQuote(1, ADDR_FROM, ADDR_TO, "10")).rejects.toThrow(
      "Failed to generate Curve swap transaction"
    );
  });

  it("findCurveQuote works for targetOut mode", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    const result = await findCurveQuote(
      1,
      ADDR_FROM,
      ADDR_TO,
      "100",
      undefined,
      undefined,
      "targetOut"
    );

    expect(result.mode).toBe("targetOut");
    expect(result.output_amount).toBe("100");
    expect(result.input_amount).toBe("10.5");
    expect(mockCurveInstance.router.required).toHaveBeenCalledWith(ADDR_FROM, ADDR_TO, "100");
  });

  it("findCurveQuote routes to correct chain instance", async () => {
    vi.resetModules();
    const { initCurveInstance, findCurveQuote } = await import("../curve.js");

    // Initialize multiple chains
    await initCurveInstance(1, "https://eth-mainnet.example.com");
    await initCurveInstance(8453, "https://base-mainnet.example.com");

    // Request quote for Base (chainId 8453)
    const result = await findCurveQuote(8453, ADDR_FROM, ADDR_TO, "10");

    expect(result.source).toBe("curve");
    // Verify it used the Base instance (init would have been called with chainId 8453)
    expect(mockCurveInstance.init).toHaveBeenCalledWith(
      "JsonRpc",
      { url: "https://base-mainnet.example.com" },
      { chainId: 8453 }
    );
  });
});
