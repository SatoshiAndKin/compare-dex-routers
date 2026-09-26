import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther, toHex, type Hex, type PublicClient } from "viem";
import { createPreviewState } from "../preview-simulation.js";

const ACCOUNT = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055";
const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const BALANCE_SLOT = toHex(981231n, { size: 32 });
const OTHER_SLOT = toHex(9n, { size: 32 });
const request = vi.fn();
const readContract = vi.fn();
const client = { request, readContract } as unknown as PublicClient;
type Probe = { stateOverride: [{ stateDiff: [{ slot: Hex; value: Hex }] }] };

beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue({
    [TOKEN.toLowerCase()]: { storage: { [BALANCE_SLOT]: "0x0", [OTHER_SLOT]: "0x1" } },
    [ACCOUNT.toLowerCase()]: { storage: { [toHex(888n, { size: 32 })]: "0x0" } },
  });
  readContract.mockImplementation(async ({ stateOverride }: Probe) => {
    const change = stateOverride[0].stateDiff[0];
    return change.slot === BALANCE_SLOT ? BigInt(change.value) : 1n;
  });
});

describe("preview simulation state", () => {
  it("clears account code and funds native input without reading token storage", async () => {
    const state = await createPreviewState(
      client,
      ACCOUNT,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    )(parseEther("20000"));
    expect(state).toEqual([{ address: ACCOUNT, code: "0x", balance: parseEther("30000") }]);
    expect(request).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("preserves connected-wallet code while temporarily funding native and token input", async () => {
    const native = await createPreviewState(
      client,
      ACCOUNT,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      true
    )(1n);
    expect(native).toEqual([{ address: ACCOUNT, balance: parseEther("10000") + 1n }]);
    const token = await createPreviewState(client, ACCOUNT, TOKEN, true)(123n);
    expect(token[0]).toEqual({ address: ACCOUNT, balance: parseEther("10000") });
    expect(token[1]?.stateDiff).toEqual([{ slot: BALANCE_SLOT, value: toHex(123n, { size: 32 }) }]);
  });

  it("discovers the actual balance slot and funds each quote with its exact input", async () => {
    const state = createPreviewState(client, ACCOUNT, TOKEN);
    const results = await Promise.all([state(1000000n), state(1250000n)]);
    expect(results).toEqual(
      [1000000n, 1250000n].map((amount) => [
        { address: ACCOUNT, code: "0x", balance: parseEther("10000") },
        { address: TOKEN, stateDiff: [{ slot: BALANCE_SLOT, value: toHex(amount, { size: 32 }) }] },
      ])
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "debug_traceCall",
      params: [{ to: TOKEN }, "latest", { tracer: "prestateTracer" }],
    });
    // Both probe values must match. A constant balance of 1 must not identify OTHER_SLOT.
    expect(readContract).toHaveBeenCalledTimes(4);
    for (const [parameters] of readContract.mock.calls) {
      expect(parameters).toMatchObject({
        address: TOKEN,
        functionName: "balanceOf",
        args: [ACCOUNT],
      });
    }
  });

  it("rejects ambiguous storage instead of choosing a slot", async () => {
    readContract.mockImplementation(async ({ stateOverride }: Probe) =>
      BigInt(stateOverride[0].stateDiff[0].value)
    );
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(10n)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });

  it("rejects layouts whose returned balances do not match both probes", async () => {
    readContract.mockResolvedValue(1n);
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(10n)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });

  it("tolerates reverted non-balance slots while verifying the actual balance", async () => {
    readContract.mockImplementation(async ({ stateOverride }: Probe) => {
      const change = stateOverride[0].stateDiff[0];
      if (change.slot === OTHER_SLOT) throw new Error("Invalid proxy implementation");
      return BigInt(change.value);
    });
    expect((await createPreviewState(client, ACCOUNT, TOKEN)(19n))[1]).toEqual({
      address: TOKEN,
      stateDiff: [{ slot: BALANCE_SLOT, value: toHex(19n, { size: 32 }) }],
    });
  });

  it.each([0, 17])("bounds work when the trace returns %i candidate slots", async (count) => {
    request.mockResolvedValue({
      [TOKEN]: {
        storage: Object.fromEntries(
          Array.from({ length: count }, (_, i) => [toHex(i, { size: 32 }), "0x0"])
        ),
      },
    });
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(10n)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it("does not guess storage when the RPC cannot trace the token", async () => {
    request.mockRejectedValue(new Error("trace unavailable"));
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(10n)).rejects.toThrow(
      "trace unavailable"
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])("rejects invalid input %s without RPC calls", async (amount) => {
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(amount)).rejects.toThrow(
      "must be positive"
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe("rebasing credit preview funding", () => {
  const RATE = 611122269089047016606236757n;
  const UNIT = 10n ** 18n;
  const amount = 375772178271914396231n;
  function creditToken(rate = RATE, nonlinear = false) {
    readContract.mockImplementation(
      async ({
        functionName,
        stateOverride,
      }: {
        functionName: string;
        stateOverride?: { stateDiff?: { slot: Hex; value: Hex }[] }[];
      }) => {
        const change = stateOverride?.flatMap((s) => s.stateDiff ?? [])[0];
        const credits = change?.slot === BALANCE_SLOT ? BigInt(change.value) : 0n;
        if (functionName === "creditsBalanceOfHighres") return [credits, rate, true];
        const balance = rate ? (credits * UNIT) / rate : 0n;
        return nonlinear && balance > 2n ? balance - 1n : balance;
      }
    );
  }
  it("discovers credits and rounds up to fund the exact OUSD amount without changing global rates", async () => {
    creditToken();
    const fund = createPreviewState(client, ACCOUNT, TOKEN);
    const amounts = [amount, amount + 123456789n];
    const states = await Promise.all(amounts.map(fund));
    expect(states).toEqual(
      amounts.map((value) => [
        { address: ACCOUNT, code: "0x", balance: parseEther("10000") },
        {
          address: TOKEN,
          stateDiff: [
            { slot: BALANCE_SLOT, value: toHex((value * RATE + UNIT - 1n) / UNIT, { size: 32 }) },
          ],
        },
      ])
    );
    expect(request).toHaveBeenCalledTimes(1);
    for (const [args] of readContract.mock.calls.filter(
      ([args]) => args.stateOverride?.length === 2
    )) {
      expect(args.stateOverride[1].stateDiff).toHaveLength(1);
      expect(args.stateOverride[1].stateDiff[0].slot).toBe(BALANCE_SLOT);
    }
  });
  it("preserves connected wallet code while funding scaled credits", async () => {
    creditToken();
    const state = await createPreviewState(client, ACCOUNT, TOKEN, true)(amount);
    expect(state[0]).toEqual({ address: ACCOUNT, balance: parseEther("10000") });
    expect(state[1]?.stateDiff?.[0]?.value).toBe(
      toHex((amount * RATE + UNIT - 1n) / UNIT, { size: 32 })
    );
  });
  it("verifies the requested amount, not just small discovery probes", async () => {
    creditToken(RATE, true);
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(amount)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });
  it("rejects an invalid credit conversion instead of guessing", async () => {
    creditToken(0n);
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(amount)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });
  it("rejects a rebase rate that changes after discovery", async () => {
    creditToken();
    const original = readContract.getMockImplementation();
    if (!original) throw new Error("Missing credit token mock");
    readContract.mockImplementation(async (args) => {
      const result = await original(args);
      return args.functionName === "creditsBalanceOfHighres" && args.stateOverride
        ? [result[0], RATE + 1n, true]
        : result;
    });
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(amount)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });

  it("rejects a claimed credit layout when the credit getter does not confirm the written value", async () => {
    creditToken();
    const original = readContract.getMockImplementation();
    if (!original) throw new Error("Missing credit token mock");
    readContract.mockImplementation(async (args) =>
      args.functionName === "creditsBalanceOfHighres" ? [0n, RATE, true] : original(args)
    );
    await expect(createPreviewState(client, ACCOUNT, TOKEN)(amount)).rejects.toThrow(
      "Cannot verify token balance storage"
    );
  });
});
