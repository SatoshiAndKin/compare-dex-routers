import type { SwapParams } from "@spandex/core";
import type { Address, Hex, PublicClient } from "viem";
import { z } from "zod";
import type { QuoteResult } from "./quote-response.js";
import {
  flashprofitsTransaction,
  flashprofitsWallet,
  type WalletBinding,
} from "./flashprofits-wallet.js";
import { simulateFlashprofitsTrade } from "./flashprofits-simulation.js";
import { logger } from "./logger.js";
import { recordFlashprofitsRequest } from "./metrics.js";

const providers = {
  electric: "Flashprofits Electric",
  direct: "Flashprofits Direct",
} as const;
type Strategy = keyof typeof providers;
type Provider = (typeof providers)[Strategy];

const address = z.custom<Address>(
  (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)
);
const bytes = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value)
);
const amount = z.string().regex(/^\d{1,78}$/);
const routeResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
  z.object({
    status: z.literal("quoted"),
    route: z.object({
      inputAmount: amount,
      outputAmount: amount,
      nodes: z.array(z.object({ token: address })),
      legs: z
        .array(
          z.object({
            inputToken: address,
            outputToken: address,
            inputAmount: amount,
            source: z.string(),
          })
        )
        .min(1),
      execution: z
        .object({
          account: address,
          plan: bytes,
          nativeExecutionCost: amount,
          approvals: z.array(z.object({ token: address, spender: address })),
        })
        .nullish(),
    }),
  }),
]);
const responseSchema = z.object({
  blockNumber: z.number().int().positive(),
  blockHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  electric: routeResult,
  direct: routeResult,
});

export type FlashprofitsPrice = {
  success: true;
  provider: Provider;
  inputAmount: bigint;
  outputAmount: bigint;
  route: QuoteResult["route"];
  wallet_setup?: QuoteResult["wallet_setup"];
  walletExecution?: NonNullable<QuoteResult["execution"]>;
  walletSimulation?: { gasUsed: bigint; approvalGasUsed: bigint; outputAmount: bigint };
};
type FlashprofitsFailure = { success: false; provider: Provider; error: Error };

async function price(
  provider: Provider,
  result: z.infer<typeof routeResult>,
  swap: SwapParams,
  client?: PublicClient,
  wallet?: WalletBinding | null
): Promise<FlashprofitsPrice | FlashprofitsFailure> {
  if (result.status === "unavailable")
    return { success: false, provider, error: new Error(result.reason) };
  const { nodes, legs } = result.route;
  const inputAmount = BigInt(result.route.inputAmount);
  const outputAmount = BigInt(result.route.outputAmount);
  const matches =
    swap.mode === "targetOut"
      ? outputAmount >= swap.outputAmount
      : inputAmount === swap.inputAmount;
  if (!matches || inputAmount === 0n || outputAmount === 0n)
    return {
      success: false,
      provider,
      error: new Error("Flashprofits returned incorrect amounts"),
    };
  const quote: FlashprofitsPrice = {
    success: true,
    provider,
    inputAmount,
    outputAmount,
    route: {
      nodes: nodes.map(({ token }) => ({ address: token })),
      edges: legs.map((leg) => ({
        source: leg.inputToken,
        target: leg.outputToken,
        key: leg.source,
        value: Number(leg.inputAmount),
      })),
    },
  };
  if (wallet?.kind === "setup")
    return { ...quote, wallet_setup: { to: wallet.to, data: wallet.data } };
  if (wallet?.kind === "deployFactory")
    return {
      ...quote,
      wallet_setup: { to: wallet.to, data: wallet.data, factory: wallet.factory },
    };
  const plan = result.route.execution;
  if (!wallet || !plan || !client || plan.account.toLowerCase() !== wallet.account.toLowerCase())
    return quote;
  try {
    const nativeExecutionCost = BigInt(plan.nativeExecutionCost);
    const tx = flashprofitsTransaction(wallet, swap, inputAmount, nativeExecutionCost, plan.plan);
    const simulation = await simulateFlashprofitsTrade({
      client,
      swap,
      tx,
      inputAmount,
      outputAmount,
      nativeExecutionCost,
      assets: nodes.map(({ token }) => token),
      approvals: plan.approvals,
    });
    return {
      ...quote,
      walletSimulation: {
        gasUsed: simulation.gasUsed,
        approvalGasUsed: simulation.approvalGasUsed,
        outputAmount: simulation.received,
      },
      walletExecution: {
        ...tx,
        value: tx.value.toString(),
        wallet_simulation: {
          effects: simulation.effects,
          gas: simulation.gas.toString(),
          gas_price: simulation.gasPrice.toString(),
        },
      },
    };
  } catch (error) {
    logger.debug({ provider, error }, "Flashprofits wallet simulation failed");
    return quote;
  }
}

export async function fetchFlashprofitsPrices(
  baseUrl: string,
  swap: SwapParams,
  deadlineMs: number,
  client?: PublicClient
): Promise<Array<FlashprofitsPrice | FlashprofitsFailure>> {
  const signal = AbortSignal.timeout(deadlineMs);
  const failures = (error: Error): FlashprofitsFailure[] =>
    Object.values(providers).map((provider) => ({ success: false, provider, error }));
  try {
    const prices = await Promise.race([
      request(),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Flashprofits quote timed out")), {
          once: true,
        })
      ),
    ]);
    return prices;
  } catch (failure) {
    return failures(failure instanceof Error ? failure : new Error(String(failure)));
  }

  async function request() {
    const wallet =
      client && (await flashprofitsWallet(client, swap.swapperAccount).catch(() => null));
    signal.throwIfAborted();
    const url = new URL("/api/v2/swap-quote", baseUrl);
    url.searchParams.set("inputToken", swap.inputToken);
    url.searchParams.set("outputToken", swap.outputToken);
    if (swap.mode === "targetOut") url.searchParams.set("outputAmount", String(swap.outputAmount));
    else url.searchParams.set("inputAmount", String(swap.inputAmount));
    if (wallet?.kind === "delegation" || wallet?.kind === "executor")
      url.searchParams.set("executionAccount", wallet.account);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal,
      });
    } catch (error) {
      recordFlashprofitsRequest(signal.aborted ? "timeout" : "network_error");
      throw error;
    }
    recordFlashprofitsRequest(response.status);
    if (!response.ok) throw new Error(`Flashprofits request failed with status ${response.status}`);
    const result = responseSchema.safeParse(await response.json());
    if (!result.success) throw new Error("Flashprofits returned an invalid quote response");
    return Promise.all([
      price(providers.electric, result.data.electric, swap, client, wallet),
      price(providers.direct, result.data.direct, swap, client, wallet),
    ]);
  }
}
