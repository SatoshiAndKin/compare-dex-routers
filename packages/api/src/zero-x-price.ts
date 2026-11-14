import { z } from "zod";
import type { Address } from "viem";
import type { QuoteResult } from "./quote-response.js";

const address = z.custom<Address>(
  (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)
);
const quantity = z.string().regex(/^\d+$/);
const price = z.object({
  liquidityAvailable: z.literal(true),
  sellAmount: quantity,
  buyAmount: quantity,
  route: z.object({
    tokens: z.array(z.object({ address, symbol: z.string() })),
    fills: z.array(
      z.object({
        from: address,
        to: address,
        source: z.string(),
        proportionBps: z.string().regex(/^(?:\d{1,4}|10000)$/),
      })
    ),
  }),
});

export type ZeroXPrice = {
  success: true;
  provider: "0x";
  inputAmount: bigint;
  outputAmount: bigint;
  route: QuoteResult["route"];
};

export async function fetchZeroXPrice(
  apiKey: string,
  swap: {
    chainId: number;
    inputToken: Address;
    outputToken: Address;
    inputAmount: bigint;
    slippageBps: number;
  },
  deadlineMs: number
): Promise<ZeroXPrice | { success: false; provider: "0x"; error: Error }> {
  const query = new URLSearchParams({
    chainId: String(swap.chainId),
    sellToken: swap.inputToken,
    buyToken: swap.outputToken,
    sellAmount: String(swap.inputAmount),
    slippageBps: String(swap.slippageBps),
  });
  try {
    const response = await fetch(`https://api.0x.org/swap/allowance-holder/price?${query}`, {
      headers: { accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" },
      signal: AbortSignal.timeout(deadlineMs),
    });
    if (!response.ok) throw new Error(`0x API request failed with status ${response.status}`);
    const result = price.safeParse(await response.json());
    if (!result.success) throw new Error("0x returned no usable indicative price");
    const { sellAmount, buyAmount, route } = result.data;
    return {
      success: true,
      provider: "0x",
      inputAmount: BigInt(sellAmount),
      outputAmount: BigInt(buyAmount),
      route: {
        nodes: route.tokens,
        edges: route.fills.map(({ from, to, source, proportionBps }) => ({
          source: from,
          target: to,
          key: source,
          value: Number(proportionBps),
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      provider: "0x",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
