import { beforeEach, describe, expect, it, vi } from "vitest";

const makeAddress = (char: string) => `0x${char.repeat(40)}`;
const ADDR_FROM = makeAddress("1");
const ADDR_TO = makeAddress("2");
const ADDR_POOL = makeAddress("3");
const ADDR_ROUTER = makeAddress("4");
const ADDR_SENDER = makeAddress("5");
const ADDR_APPROVAL = makeAddress("6");

const mockCurve = {
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
  },
};

vi.mock("@curvefi/api", () => ({
  default: mockCurve,
}));

describe("curve integration helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCurve.init.mockResolvedValue(undefined);
    mockCurve.factory.fetchPools.mockResolvedValue(undefined);
    mockCurve.crvUSDFactory.fetchPools.mockResolvedValue(undefined);
    mockCurve.cryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurve.twocryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurve.tricryptoFactory.fetchPools.mockResolvedValue(undefined);
    mockCurve.stableNgFactory.fetchPools.mockResolvedValue(undefined);

    mockCurve.router.getBestRouteAndOutput.mockResolvedValue({
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

    mockCurve.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "7",
    });

    mockCurve.router.populateApprove.mockResolvedValue([{ to: ADDR_APPROVAL, data: "0xbeef" }]);
    mockCurve.hasAllowance.mockResolvedValue(false);

    mockCurve.getCoinsData.mockImplementation(async ([address]: string[]) => {
      const lower = String(address).toLowerCase();
      if (lower === ADDR_FROM.toLowerCase()) return [{ symbol: "USDC" }];
      if (lower === ADDR_TO.toLowerCase()) return [{ symbol: "WETH" }];
      return [{ symbol: "LP" }];
    });
  });

  it("isCurveSupported only returns true for Ethereum", async () => {
    vi.resetModules();
    const { isCurveSupported } = await import("../curve.js");
    expect(isCurveSupported(1)).toBe(true);
    expect(isCurveSupported(8453)).toBe(false);
  });

  it("initCurve initializes once and reuses in-flight promise", async () => {
    vi.resetModules();
    const { initCurve } = await import("../curve.js");

    await Promise.all([initCurve("https://rpc.example"), initCurve("https://rpc.example")]);
    await initCurve("https://rpc.example");

    expect(mockCurve.init).toHaveBeenCalledTimes(1);
    expect(mockCurve.factory.fetchPools).toHaveBeenCalledTimes(1);
    expect(mockCurve.crvUSDFactory.fetchPools).toHaveBeenCalledTimes(1);
    expect(mockCurve.cryptoFactory.fetchPools).toHaveBeenCalledTimes(1);
    expect(mockCurve.twocryptoFactory.fetchPools).toHaveBeenCalledTimes(1);
    expect(mockCurve.tricryptoFactory.fetchPools).toHaveBeenCalledTimes(1);
    expect(mockCurve.stableNgFactory.fetchPools).toHaveBeenCalledTimes(1);
  });

  it("findCurveQuote throws when Curve is not initialized", async () => {
    vi.resetModules();
    const { findCurveQuote } = await import("../curve.js");

    await expect(findCurveQuote(ADDR_FROM, ADDR_TO, "1")).rejects.toThrow(
      "Curve API not initialized"
    );
  });

  it("findCurveQuote returns quote with symbols, gas estimate, and approval tx", async () => {
    vi.resetModules();
    const { initCurve, findCurveQuote } = await import("../curve.js");
    await initCurve("https://rpc.example");

    const client = {
      estimateGas: vi.fn().mockResolvedValue(21000n),
    };

    const result = await findCurveQuote(ADDR_FROM, ADDR_TO, "10", ADDR_SENDER, client as never);

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
    expect(mockCurve.hasAllowance).toHaveBeenCalledWith(
      [ADDR_FROM],
      ["10"],
      ADDR_SENDER,
      ADDR_ROUTER
    );
    expect(mockCurve.router.populateApprove).toHaveBeenCalledWith(
      ADDR_FROM,
      "10",
      false,
      ADDR_SENDER
    );
  });

  it("findCurveQuote skips gas and approval checks for invalid sender", async () => {
    vi.resetModules();
    const { initCurve, findCurveQuote } = await import("../curve.js");
    await initCurve("https://rpc.example");

    const client = {
      estimateGas: vi.fn(),
    };

    const result = await findCurveQuote(
      ADDR_FROM,
      ADDR_TO,
      "10",
      "not-an-address",
      client as never
    );

    expect(result.gas_used).toBeUndefined();
    expect(result.approval_target).toBeUndefined();
    expect(client.estimateGas).not.toHaveBeenCalled();
    expect(mockCurve.hasAllowance).not.toHaveBeenCalled();
    expect(mockCurve.router.populateApprove).not.toHaveBeenCalled();
  });

  it("findCurveQuote handles symbol lookup and gas/approval failures gracefully", async () => {
    vi.resetModules();
    const { initCurve, findCurveQuote } = await import("../curve.js");
    await initCurve("https://rpc.example");

    mockCurve.getCoinsData.mockRejectedValueOnce(new Error("symbol failure"));
    mockCurve.getCoinsData.mockResolvedValue([{ symbol: "WETH" }]);
    mockCurve.router.populateSwap.mockResolvedValue({
      to: ADDR_ROUTER,
      data: "0xabcdef",
      value: "0",
    });
    mockCurve.hasAllowance.mockRejectedValue(new Error("allowance failure"));

    const client = {
      estimateGas: vi.fn().mockRejectedValue(new Error("estimation failed")),
    };

    const result = await findCurveQuote(ADDR_FROM, ADDR_TO, "10", ADDR_SENDER, client as never);
    expect(result.from_symbol).toBe("");
    expect(result.to_symbol).toBe("WETH");
    expect(result.gas_used).toBeUndefined();
    expect(result.approval_target).toBeUndefined();
  });

  it("findCurveQuote throws if populateSwap does not return transaction data", async () => {
    vi.resetModules();
    const { initCurve, findCurveQuote } = await import("../curve.js");
    await initCurve("https://rpc.example");

    mockCurve.router.populateSwap.mockResolvedValue({ to: "", data: "" });

    await expect(findCurveQuote(ADDR_FROM, ADDR_TO, "10")).rejects.toThrow(
      "Failed to generate Curve swap transaction"
    );
  });
});
