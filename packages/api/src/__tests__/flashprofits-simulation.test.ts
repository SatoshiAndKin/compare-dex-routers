import { describe, expect, it, vi } from "vitest";
import { encodeEventTopics, erc20Abi, toHex, type PublicClient } from "viem";
import { simulateFlashprofitsTrade } from "../flashprofits-simulation.js";

const wallet = "0x1111111111111111111111111111111111111111";
const input = "0x2222222222222222222222222222222222222222";
const output = "0x3333333333333333333333333333333333333333";
const market = "0x4444444444444444444444444444444444444444";

function fixture({ received = 30n, extraApproval = false, logsAvailable = true } = {}) {
  const log = {
    address: input,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: wallet, to: market },
    }),
    data: toHex(10n, { size: 32 }),
  };
  const logs = [
    log,
    {
      address: output,
      topics: encodeEventTopics({
        abi: erc20Abi,
        eventName: "Transfer",
        args: { from: market, to: wallet },
      }),
      data: toHex(30n, { size: 32 }),
    },
  ];
  if (extraApproval)
    logs.push({
      address: output,
      topics: encodeEventTopics({
        abi: erc20Abi,
        eventName: "Approval",
        args: { owner: wallet, spender: market },
      }),
      data: toHex(10n, { size: 32 }),
    });
  const balance = (value: bigint) => ({ status: "success", data: toHex(value, { size: 32 }) });
  const calls = [
    balance(100_000n),
    balance(20n),
    balance(0n),
    { status: "success", gasUsed: 21_000n, logs: logsAvailable ? logs : undefined },
    balance(79_000n),
    balance(10n),
    balance(received),
  ];
  const simulateBlocks = vi.fn().mockResolvedValue([{ calls }]);
  const client = {
    getGasPrice: async () => 1n,
    getBlockNumber: async () => 100n,
    simulateBlocks,
  } as unknown as PublicClient;
  const simulation = simulateFlashprofitsTrade({
    client,
    swap: {
      chainId: 1,
      inputToken: input,
      outputToken: output,
      swapperAccount: wallet,
      mode: "exactIn",
      inputAmount: 10n,
      slippageBps: 50,
    },
    tx: { to: wallet, data: "0x1234", value: 0n, approval: null },
    inputAmount: 10n,
    outputAmount: 30n,
    nativeExecutionCost: 0n,
    assets: [input, output],
    approvals: [],
  });
  return { simulation, simulateBlocks };
}

describe("Flashprofits wallet simulation", () => {
  it("checks deltas against logs and simulates the gas and calldata used for signing", async () => {
    const { simulation, simulateBlocks } = fixture();
    await expect(simulation).resolves.toMatchObject({ received: 30n, gas: 25_200n, gasPrice: 1n });
    const [request] = simulateBlocks.mock.lastCall ?? [];
    expect(request).toMatchObject({ blockNumber: 100n, traceTransfers: true });
    expect(request.blocks[0].calls[3]).toEqual({
      from: wallet,
      to: wallet,
      data: "0x1234",
      value: 0n,
      gas: 25_200n,
      gasPrice: 1n,
    });
  });

  it.each([
    [{ received: 29n }, "do not match the transfer logs"],
    [{ extraApproval: true }, "unexpected allowance"],
    [{ logsAvailable: false }, "did not complete in simulation"],
  ] as const)("blocks missing or inconsistent evidence for %o", async (options, error) => {
    await expect(fixture(options).simulation).rejects.toThrow(error);
  });
});
