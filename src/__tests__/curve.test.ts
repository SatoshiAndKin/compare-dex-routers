import { beforeEach, describe, expect, it, vi } from "vitest";

const makeAddress = (char: string) => `0x${char.repeat(40)}`;
const ADDR_FROM = makeAddress("1");
const ADDR_TO = makeAddress("2");
const ADDR_POOL = makeAddress("3");
const ADDR_ROUTER = makeAddress("4");
const ADDR_SENDER = makeAddress("5");
const ADDR_APPROVAL = makeAddress("6");

// Mock curve instance factory
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

// Queue of instances to return from createCurve
let instanceQueue: ReturnType<typeof createMockCurveInstance>[] = [];
let allCreatedInstances: ReturnType<typeof createMockCurveInstance>[] = [];

vi.mock("@curvefi/api", () => ({
  createCurve: () => {
    // Return from queue if available, otherwise create new
    const instance = instanceQueue.shift() ?? createMockCurveInstance();
    allCreatedInstances.push(instance);
    return instance;
  },
}));

describe("curve multi-chain integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instanceQueue = [];
    allCreatedInstances = [];
  });

  // Helper to configure a mock instance with default successful behavior
  const configureMockInstance = (instance: ReturnType<typeof createMockCurveInstance>) => {
    instance.init.mockResolvedValue(undefined);
    instance.factory.fetchPools.mockResolvedValue(undefined);
    instance.crvUSDFactory.fetchPools.mockResolvedValue(undefined);
    instance.cryptoFactory.fetchPools.mockResolvedValue(undefined);
    instance.twocryptoFactory.fetchPools.mockResolvedValue(undefined);
    instance.tricryptoFactory.fetchPools.mockResolvedValue(undefined);
    instance.stableNgFactory.fetchPools.mockResolvedValue(undefined);

    instance.router.getBestRouteAndOutput.mockResolvedValue({
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

    instance.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "7",
    });

    instance.router.populateApprove.mockResolvedValue([{ to: ADDR_APPROVAL, data: "0xbeef" }]);
    instance.hasAllowance.mockResolvedValue(false);

    instance.getCoinsData.mockImplementation(async ([address]: string[]) => {
      const lower = String(address).toLowerCase();
      if (lower === ADDR_FROM.toLowerCase()) return [{ symbol: "USDC" }];
      if (lower === ADDR_TO.toLowerCase()) return [{ symbol: "WETH" }];
      return [{ symbol: "LP" }];
    });

    instance.router.required.mockResolvedValue("10.5");
  };

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

    // Verify the instance was initialized with correct chainId
    expect(allCreatedInstances.length).toBe(1);
    const instance = allCreatedInstances[0];
    expect(instance?.init).toHaveBeenCalledWith(
      "JsonRpc",
      { url: "https://eth-mainnet.example.com" },
      { chainId: 1 }
    );
  });

  it("initCurveInstance handles initialization failure gracefully", async () => {
    vi.resetModules();

    // Pre-configure an instance to fail
    const failingInstance = createMockCurveInstance();
    failingInstance.init.mockRejectedValueOnce(new Error("RPC connection failed"));
    instanceQueue.push(failingInstance);

    const { initCurveInstance, isCurveInitialized, getCurveInitError } =
      await import("../curve.js");

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

    // Should have created 7 distinct instances
    expect(allCreatedInstances.length).toBe(7);
  });

  it("initAllCurveInstances continues when one chain fails", async () => {
    vi.resetModules();

    // Create 7 instances, one configured to fail for chain 137
    for (let i = 0; i < 7; i++) {
      const instance = createMockCurveInstance();
      configureMockInstance(instance);
      instanceQueue.push(instance);
    }

    const { initAllCurveInstances, isCurveInitialized } = await import("../curve.js");

    // Find the instance that will be used for chain 137 and make it fail
    // The instances are used in the order CURVE_SUPPORTED_CHAINS is defined
    // [1, 8453, 42161, 10, 137, 56, 43114] - chain 137 is index 4
    const polygonInstance = instanceQueue[4];
    if (polygonInstance) {
      polygonInstance.init.mockRejectedValueOnce(new Error("Polygon RPC failed"));
    }

    const log = vi.fn();
    const logError = vi.fn();
    const getRpcUrl = (chainId: number) => `https://chain-${chainId}.example.com`;

    await initAllCurveInstances(getRpcUrl, log, logError);

    // Other chains should still be initialized
    expect(isCurveInitialized(1)).toBe(true);
    expect(isCurveInitialized(8453)).toBe(true);
    expect(isCurveInitialized(137)).toBe(false);

    // Error should be logged
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

    // Pre-configure a working instance
    const instance = createMockCurveInstance();
    configureMockInstance(instance);
    instanceQueue.push(instance);

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
    expect(instance.hasAllowance).toHaveBeenCalledWith(
      [ADDR_FROM],
      ["10"],
      ADDR_SENDER,
      ADDR_ROUTER
    );
    expect(instance.router.populateApprove).toHaveBeenCalledWith(
      ADDR_FROM,
      "10",
      false,
      ADDR_SENDER
    );
  });

  it("findCurveQuote skips gas and approval checks for invalid sender", async () => {
    vi.resetModules();

    const instance = createMockCurveInstance();
    configureMockInstance(instance);
    instanceQueue.push(instance);

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
    expect(instance.hasAllowance).not.toHaveBeenCalled();
    expect(instance.router.populateApprove).not.toHaveBeenCalled();
  });

  it("findCurveQuote handles symbol lookup and gas/approval failures gracefully", async () => {
    vi.resetModules();

    const instance = createMockCurveInstance();
    configureMockInstance(instance);
    instance.getCoinsData.mockRejectedValueOnce(new Error("symbol failure"));
    instance.getCoinsData.mockResolvedValue([{ symbol: "WETH" }]);
    instance.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "0",
    });
    instance.hasAllowance.mockRejectedValue(new Error("allowance failure"));
    instanceQueue.push(instance);

    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

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

    const instance = createMockCurveInstance();
    configureMockInstance(instance);
    instance.router.populateSwap.mockResolvedValue({ to: "", data: "" });
    instanceQueue.push(instance);

    const { initCurveInstance, findCurveQuote } = await import("../curve.js");
    await initCurveInstance(1, "https://eth-mainnet.example.com");

    await expect(findCurveQuote(1, ADDR_FROM, ADDR_TO, "10")).rejects.toThrow(
      "Failed to generate Curve swap transaction"
    );
  });

  it("findCurveQuote works for targetOut mode", async () => {
    vi.resetModules();

    const instance = createMockCurveInstance();
    configureMockInstance(instance);
    instanceQueue.push(instance);

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
    expect(instance.router.required).toHaveBeenCalledWith(ADDR_FROM, ADDR_TO, "100");
  });

  it("findCurveQuote routes to correct chain instance with distinct instances", async () => {
    vi.resetModules();

    // Create distinct instances with different outputs for each chain
    const ethereumInstance = createMockCurveInstance();
    configureMockInstance(ethereumInstance);
    ethereumInstance.router.getBestRouteAndOutput.mockResolvedValue({
      route: [{ poolId: "eth-pool", poolName: "Ethereum Pool" }],
      output: "100.00",
    });

    const baseInstance = createMockCurveInstance();
    configureMockInstance(baseInstance);
    baseInstance.router.getBestRouteAndOutput.mockResolvedValue({
      route: [{ poolId: "base-pool", poolName: "Base Pool" }],
      output: "200.00",
    });

    // Queue them in order: Ethereum first, then Base
    instanceQueue.push(ethereumInstance, baseInstance);

    const { initCurveInstance, findCurveQuote } = await import("../curve.js");

    // Initialize both chains
    await initCurveInstance(1, "https://eth-mainnet.example.com");
    await initCurveInstance(8453, "https://base-mainnet.example.com");

    // Request quote for Base (chainId 8453)
    const baseResult = await findCurveQuote(8453, ADDR_FROM, ADDR_TO, "10");

    // Verify it returned the Base-specific output (200.00 not 100.00)
    expect(baseResult.output_amount).toBe("200.00");

    // Verify the Base instance's getBestRouteAndOutput was called, not Ethereum's
    expect(baseInstance.router.getBestRouteAndOutput).toHaveBeenCalledTimes(1);
    expect(ethereumInstance.router.getBestRouteAndOutput).not.toHaveBeenCalled();

    // Clear mock call counts before testing Ethereum
    baseInstance.router.getBestRouteAndOutput.mockClear();
    ethereumInstance.router.getBestRouteAndOutput.mockClear();

    // Now test Ethereum routing
    const ethResult = await findCurveQuote(1, ADDR_FROM, ADDR_TO, "10");
    expect(ethResult.output_amount).toBe("100.00");
    expect(ethereumInstance.router.getBestRouteAndOutput).toHaveBeenCalledTimes(1);
    expect(baseInstance.router.getBestRouteAndOutput).not.toHaveBeenCalled();
  });
});
