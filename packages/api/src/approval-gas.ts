import { isNativeToken, type SuccessfulQuote } from "@spandex/core";
import {
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseEther,
  type Address,
  type PublicClient,
} from "viem";
import { logger } from "./logger.js";

/** Request-local estimates: never reuse allowances across wallets or refreshes. */
export function createApprovalGasEstimator(
  client: PublicClient,
  inputToken: Address,
  account: Address,
  connected: boolean
) {
  let block: Promise<bigint> | undefined;
  const allowances = new Map<string, Promise<bigint>>();
  const estimates = new Map<string, Promise<bigint>>();
  return async (quote: SuccessfulQuote): Promise<bigint | null> => {
    if (isNativeToken(inputToken)) return 0n;
    // Use the same metadata and unlimited approval as the wallet workflow.
    // A synthetic simulation approval is not evidence that the wallet needs one.
    const approval = quote.approval;
    if (!approval) return null;
    try {
      block ??= client.getBlockNumber({ cacheTime: 0 });
      const blockNumber = await block;
      const key = `${approval.token.toLowerCase()}:${approval.spender.toLowerCase()}`;
      if (connected) {
        let allowance = allowances.get(key);
        if (!allowance) {
          allowance = client.readContract({
            address: approval.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, approval.spender],
            blockNumber,
          });
          allowances.set(key, allowance);
        }
        if ((await allowance) >= quote.inputAmount) return 0n;
      }
      let estimate = estimates.get(key);
      if (!estimate) {
        estimate = client.estimateGas({
          account,
          to: approval.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [approval.spender, maxUint256],
          }),
          value: 0n,
          blockNumber,
          // Price previews work without native funds; preserve allowance and code.
          stateOverride: [{ address: account, balance: parseEther("10000") }],
        });
        estimates.set(key, estimate);
      }
      const gas = await estimate;
      return gas > 0n ? gas : null;
    } catch (error) {
      // In particular, a zero-first token may reject the wallet's direct approval.
      // Do not advertise a free approval or a comparable total in that case.
      logger.debug({ error, provider: quote.provider }, "Required approval gas unavailable");
      return null;
    }
  };
}
