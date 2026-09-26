import { isNativeToken } from "@spandex/core";
import {
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

type Prestate = Record<string, { storage?: Record<Hex, Hex> }>;
type BalanceStorage = { slot: Hex; creditsPerToken: bigint | null };
const creditAbi = parseAbi([
  "function creditsBalanceOfHighres(address) view returns (uint256, uint256, bool)",
]);
const CREDIT_UNIT = 10n ** 18n;
const verificationError = () => new Error("Cannot verify token balance storage for preview");

function storedBalance(amount: bigint, rate: bigint | null): bigint {
  return rate === null ? amount : (amount * rate + CREDIT_UNIT - 1n) / CREDIT_UNIT;
}

async function balanceStorage(
  client: PublicClient,
  token: Address,
  account: Address
): Promise<BalanceStorage> {
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
  const verifySlots = async (rate: bigint | null) =>
    Promise.all(
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
                  {
                    address: token,
                    stateDiff: [{ slot, value: toHex(storedBalance(amount, rate), { size: 32 }) }],
                  },
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
  const direct = (await verifySlots(null)).filter((slot): slot is Hex => slot !== undefined);
  if (direct.length === 1 && direct[0]) return { slot: direct[0], creditsPerToken: null };
  if (direct.length > 1) throw verificationError();

  // OUSD-style rebasing balances are floor(credits * 1e18 / creditsPerToken).
  // Ask the token for the account-specific rate; never write a global rate or
  // assume a mapping position. Both balance probes must still match exactly.
  try {
    const [, rate] = await client.readContract({
      address: token,
      abi: creditAbi,
      functionName: "creditsBalanceOfHighres",
      args: [account],
    });
    if (rate <= 0n) throw verificationError();
    const scaled = (await verifySlots(rate)).filter((slot): slot is Hex => slot !== undefined);
    if (scaled.length !== 1 || !scaled[0]) throw verificationError();
    return { slot: scaled[0], creditsPerToken: rate };
  } catch {
    throw verificationError();
  }
}

/** Fund simulations only. No state change reaches the chain or an execution payload. */
export function createPreviewState(
  client: PublicClient,
  account: Address,
  token: Address,
  preserveCode = false
) {
  let storage: Promise<BalanceStorage> | undefined;
  return async (amount: bigint): Promise<StateOverride> => {
    if (amount <= 0n) throw new Error("Preview input amount must be positive");
    const native = isNativeToken(token);
    const state: StateOverride = [
      {
        address: account,
        ...(preserveCode ? {} : { code: "0x" as const }),
        balance: parseEther("10000") + (native ? amount : 0n),
      },
    ];
    if (!native) {
      storage ??= balanceStorage(client, token, account);
      const { slot, creditsPerToken } = await storage;
      const value = storedBalance(amount, creditsPerToken);
      state.push({
        address: token,
        stateDiff: [{ slot, value: toHex(value, { size: 32 }) }],
      });
      if (creditsPerToken !== null) {
        // Verify the complete override at the actual quote amount, including
        // rounding and account code. Reject delegation offsets or changed rates.
        const [balance, [credits, rate]] = await Promise.all([
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
            stateOverride: state,
          }),
          client.readContract({
            address: token,
            abi: creditAbi,
            functionName: "creditsBalanceOfHighres",
            args: [account],
            stateOverride: state,
          }),
        ]);
        if (balance !== amount || credits !== value || rate !== creditsPerToken)
          throw verificationError();
      }
    }
    return state;
  };
}
