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
