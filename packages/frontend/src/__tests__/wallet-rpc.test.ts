import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters } from "viem";
import { transactionFees, gasMargin, quantity } from "../lib/wallet-rpc.js";
import { FROM, SENDER, ROUTER } from "./quote-fixture.js";
const tx = { from: SENDER, to: ROUTER, data: "0xabcdef", value: "0x0", chainId: "0x1" };
describe("wallet fee reserves", () => {
  it("adds Arbitrum posting gas only when the source is simulation gas", async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_gasPrice"
        ? "0x2"
        : encodeAbiParameters(
            [{ type: "uint64" }, { type: "uint256" }, { type: "uint256" }],
            [100n, 3n, 5n]
          )
    );
    expect(
      (await transactionFees({ request }, { ...tx, chainId: "0xa4b1" }, 120000n)).reserve
    ).toBe(240360n);
    expect(
      (await transactionFees({ request }, { ...tx, chainId: "0xa4b1" }, 120000n, true)).reserve
    ).toBe(240000n);
    expect(request.mock.calls.filter(([args]) => args.method === "eth_call")).toHaveLength(1);
  });
  it("keeps the 20 percent margin exact above Number precision", () => {
    expect(gasMargin(9007199254740993n)).toBe(10808639105689192n);
    expect(quantity("0x0", "Balance")).toBe(0n);
    expect(() => quantity("", "Balance")).toThrow("unavailable");
  });
  it("uses fresh fees on every calculation", async () => {
    const request = vi.fn().mockResolvedValueOnce("0x2").mockResolvedValueOnce("0x3");
    expect((await transactionFees({ request }, tx, 120000n)).reserve).toBe(240000n);
    expect((await transactionFees({ request }, tx, 120000n)).reserve).toBe(360000n);
  });
  it.each([10, 8453])("includes chain %s data and operator fees with margin", async (chain) => {
    const calls: string[] = [];
    const request = vi.fn(
      async ({ method, params }: { method: string; params?: unknown[] | object }) => {
        if (method === "eth_gasPrice") return "0x2";
        if (method === "eth_getTransactionCount") return "0x0";
        const data = (params as { data: string; to: string }[])[0]!.data;
        calls.push(data);
        return calls.length === 1 ? "0x64" : "0x32";
      }
    );
    const fees = await transactionFees(
      { request },
      { ...tx, chainId: `0x${chain.toString(16)}` },
      120000n
    );
    expect(fees).toEqual({ gasPrice: 2n, dataFee: 180n, reserve: 240180n });
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "getOperatorFee",
          inputs: [{ type: "uint256" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      data: calls[1] as `0x${string}`,
    });
    expect(decoded.args).toEqual([120000n]);
  });
  it("fails closed when network data fees cannot be obtained", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_gasPrice") return "0x2";
      if (method === "eth_getTransactionCount") return "0x0";
      throw new Error("Data fee unavailable");
    });
    await expect(
      transactionFees({ request }, { ...tx, to: FROM, chainId: "0x2105" }, 120000n)
    ).rejects.toThrow("Data fee unavailable");
  });
});
