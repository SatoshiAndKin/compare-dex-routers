import { isNativeToken } from "@spandex/core";
import {
  encodeFunctionData,
  erc20Abi,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

type Prestate = Record<string, { storage?: Record<Hex, Hex> }>;

async function balanceSlot(client: PublicClient, token: Address, account: Address): Promise<Hex> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [account] });
  const trace = await client.request<{
    Parameters: [{ to: Address; data: Hex }, "latest", { tracer: "prestateTracer" }];
    ReturnType: Prestate;
  }>({
    method: "debug_traceCall",
    params: [{ to: token, data }, "latest", { tracer: "prestateTracer" }],
  });
  const storage = Object.entries(trace).find(
    ([address]) => address.toLowerCase() === token.toLowerCase()
  )?.[1].storage;
  const slots = Object.keys(storage ?? {}).filter((slot): slot is Hex =>
    /^0x[0-9a-fA-F]{64}$/.test(slot)
  );
  // Bound RPC work for arbitrary token contracts. Never guess a mapping layout.
  if (slots.length === 0 || slots.length > 16)
    throw new Error("Cannot verify token balance storage for preview");
  const verified = await Promise.all(
    slots.map(async (slot) => {
      try {
        const probes = [1n, 2n];
        const balances = await Promise.all(
          probes.map((amount) =>
            client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
              stateOverride: [
                { address: token, stateDiff: [{ slot, value: toHex(amount, { size: 32 }) }] },
              ],
            })
          )
        );
        return balances.every((amount, index) => amount === probes[index]) ? slot : undefined;
      } catch {
        return undefined;
      }
    })
  );
  const matches = verified.filter((slot): slot is Hex => slot !== undefined);
  const [match] = matches;
  if (matches.length !== 1 || !match)
    throw new Error("Cannot verify token balance storage for preview");
  return match;
}

/** Fund simulations only. No state change reaches the chain or an execution payload. */
export function createPreviewState(client: PublicClient, account: Address, token: Address) {
  let slot: Promise<Hex> | undefined;
  return async (amount: bigint): Promise<StateOverride> => {
    if (amount <= 0n) throw new Error("Preview input amount must be positive");
    const native = isNativeToken(token);
    const state: StateOverride = [
      {
        address: account,
        code: "0x",
        balance: parseEther("10000") + (native ? amount : 0n),
      },
    ];
    if (!native) {
      slot ??= balanceSlot(client, token, account);
      state.push({
        address: token,
        stateDiff: [{ slot: await slot, value: toHex(amount, { size: 32 }) }],
      });
    }
    return state;
  };
}
