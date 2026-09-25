import {
  encodeFunctionData,
  decodeFunctionResult,
  serializeTransaction,
  type Address,
  type Hex,
} from "viem";
import type { EIP1193Provider } from "./stores/walletStore.svelte.js";
import { isNativeToken } from "./native.js";

export function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error(`${label} is unavailable`);
  return BigInt(value);
}
export const hex = (value: bigint | number | string) => `0x${BigInt(value).toString(16)}`;
export const gasMargin = (gas: bigint) => (gas * 6n + 4n) / 5n;

export async function readBalance(
  provider: EIP1193Provider,
  account: string,
  token: string
): Promise<bigint> {
  const value = await provider.request(
    isNativeToken(token)
      ? { method: "eth_getBalance", params: [account, "latest"] }
      : {
          method: "eth_call",
          params: [
            { to: token, data: `0x70a08231${account.slice(2).padStart(64, "0")}` },
            "latest",
          ],
        }
  );
  return quantity(value, "Balance check");
}

export interface WalletTransaction {
  from: string;
  chainId: string;
  to: string;
  data: string;
  value: string;
}
const oracle = "0x420000000000000000000000000000000000000F";
const feeAbi = [
  {
    type: "function",
    name: "getL1Fee",
    stateMutability: "view",
    inputs: [{ type: "bytes", name: "transaction" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getOperatorFee",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "gasUsed" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Fee reads always use the connected wallet and current chain state. */
export async function transactionFees(
  provider: EIP1193Provider,
  tx: WalletTransaction,
  gas: bigint,
  gasIncludesData = false
) {
  const gasPrice = quantity(await provider.request({ method: "eth_gasPrice" }), "Gas price");
  if (gasPrice <= 0n || gas <= 0n) throw new Error("Gas fee data is unavailable");
  const chainId = Number(BigInt(tx.chainId));
  let dataFee = 0n;
  if (chainId === 10 || chainId === 8453) {
    const nonce = quantity(
      await provider.request({ method: "eth_getTransactionCount", params: [tx.from, "pending"] }),
      "Nonce"
    );
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Nonce is unavailable");
    const serialized = serializeTransaction({
      type: "legacy",
      chainId,
      nonce: Number(nonce),
      gas,
      gasPrice,
      to: tx.to as Address,
      data: tx.data as Hex,
      value: BigInt(tx.value),
    });
    // Ask the deployed oracle so operator-fee hardfork formula changes are respected.
    // https://specs.optimism.io/protocol/isthmus/predeploys.html#gaspriceoracle
    const [l1, operator] = await Promise.all([
      provider.request({
        method: "eth_call",
        params: [
          {
            to: oracle,
            data: encodeFunctionData({ abi: feeAbi, functionName: "getL1Fee", args: [serialized] }),
          },
          "latest",
        ],
      }),
      provider.request({
        method: "eth_call",
        params: [
          {
            to: oracle,
            data: encodeFunctionData({ abi: feeAbi, functionName: "getOperatorFee", args: [gas] }),
          },
          "latest",
        ],
      }),
    ]);
    dataFee = gasMargin(
      quantity(l1, "Network data fee") + quantity(operator, "Network operator fee")
    );
  }
  if (chainId === 42161 && !gasIncludesData) {
    // Arbitrum eth_estimateGas includes L1 posting gas, but SDK simulation gas may not.
    const abi = [
      {
        type: "function",
        name: "gasEstimateL1Component",
        stateMutability: "payable",
        inputs: [{ type: "address" }, { type: "bool" }, { type: "bytes" }],
        outputs: [{ type: "uint64" }, { type: "uint256" }, { type: "uint256" }],
      },
    ] as const;
    const response = await provider.request({
      method: "eth_call",
      params: [
        {
          from: tx.from,
          to: "0x00000000000000000000000000000000000000C8",
          data: encodeFunctionData({
            abi,
            functionName: "gasEstimateL1Component",
            args: [tx.to as Address, false, tx.data as Hex],
          }),
        },
        "latest",
      ],
    });
    if (typeof response !== "string") throw new Error("Network data fee unavailable");
    const [l1Gas, baseFee] = decodeFunctionResult({
      abi,
      functionName: "gasEstimateL1Component",
      data: response as Hex,
    });
    if (baseFee <= 0n) throw new Error("Network data fee unavailable");
    dataFee = gasMargin(l1Gas * (baseFee > gasPrice ? baseFee : gasPrice));
  }
  return { gasPrice, dataFee, reserve: gas * gasPrice + dataFee };
}
