import { isNativeToken } from "@spandex/core";
import { formatUnits, type Address } from "viem";
import { z } from "zod";
import { logger } from "./logger.js";
import type { QuoteResult, UsdConversion } from "./quote-response.js";

const chains: Record<number, { slug: string; nativeAsset: string }> = {
  1: { slug: "ethereum", nativeAsset: "ethereum" },
  10: { slug: "optimism", nativeAsset: "ethereum" },
  8453: { slug: "base", nativeAsset: "ethereum" },
  42161: { slug: "arbitrum", nativeAsset: "ethereum" },
  56: { slug: "bsc", nativeAsset: "binancecoin" },
  137: { slug: "polygon", nativeAsset: "polygon-ecosystem-token" },
  43114: { slug: "avax", nativeAsset: "avalanche-2" },
};
const TTL = 60_000;
const NATIVE_MAX_AGE = 600;
const TRADE_MAX_AGE = 900;
const MAX_CACHED_PRICES = 1024;
const MIN_TRADE_CONFIDENCE = 0.8;
const priceSchema = z.object({
  price: z.number().positive(),
  timestamp: z.number().int(),
  confidence: z.number().min(0).max(1).optional(),
});
type Price = z.infer<typeof priceSchema>;
const prices = new Map<string, { value: Price; fetchedAt: number }>();
const pending = new Map<string, Promise<Price | null>>();

// Parse decimal/scientific notation without doing monetary arithmetic in Number.
function decimal(value: string): { units: bigint; decimals: number } {
  const [mantissa = "0", exponent = "0"] = value.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const units = BigInt(`${whole}${fraction}`);
  return scale < 0
    ? { units: units * 10n ** BigInt(-scale), decimals: 0 }
    : { units, decimals: scale };
}

export function nativeToUsd(value: string | null, conversion: UsdConversion | null): string | null {
  if (value === null || conversion === null) return null;
  const native = decimal(value);
  const price = decimal(conversion.native_price_usd);
  return formatUnits(native.units * price.units, native.decimals + price.decimals);
}

function fresh(timestamp: number, maxAge: number): boolean {
  const age = Date.now() / 1000 - timestamp;
  return age >= 0 && age <= maxAge;
}

async function fetchPrices(keys: string[]): Promise<Map<string, Price>> {
  const result = new Map<string, Price>();
  try {
    const response = await fetch(`https://coins.llama.fi/prices/current/${keys.join(",")}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return result;
    const body = z
      .object({ coins: z.record(z.string(), z.unknown()) })
      .parse(await response.json());
    for (const key of keys) {
      const price = priceSchema.safeParse(body.coins[key]);
      if (!price.success || !fresh(price.data.timestamp, TRADE_MAX_AGE)) continue;
      prices.delete(key);
      prices.set(key, { value: price.data, fetchedAt: Date.now() });
      if (prices.size > MAX_CACHED_PRICES) prices.delete(prices.keys().next().value ?? key);
      result.set(key, price.data);
    }
  } catch (error) {
    logger.debug({ error, keys }, "DeFiLlama prices unavailable");
  }
  return result;
}

export async function getQuoteUsdPrices(chainId: number, from: string, to: string) {
  const chain = chains[chainId];
  if (!chain) return { native: null, input: null, output: null };
  const nativeKey = `coingecko:${chain.nativeAsset}`;
  const tokenKey = (address: string) =>
    isNativeToken(address as Address) ? nativeKey : `${chain.slug}:${address.toLowerCase()}`;
  const inputKey = tokenKey(from);
  const outputKey = tokenKey(to);
  const cached = new Map<string, Price>();
  const missing = new Set<string>();
  for (const key of new Set([nativeKey, inputKey, outputKey])) {
    const entry = prices.get(key);
    const maxAge = key === nativeKey ? NATIVE_MAX_AGE : TRADE_MAX_AGE;
    if (entry && Date.now() - entry.fetchedAt < TTL && fresh(entry.value.timestamp, maxAge)) {
      cached.set(key, entry.value);
    } else if (!pending.has(key)) {
      missing.add(key);
    }
  }
  if (missing.size) {
    const batch = fetchPrices([...missing]);
    for (const key of missing) {
      pending.set(
        key,
        batch.then((result) => result.get(key) ?? null).finally(() => pending.delete(key))
      );
    }
  }
  const read = (key: string) => cached.get(key) ?? pending.get(key) ?? null;
  const [native, input, output] = await Promise.all([
    read(nativeKey),
    read(inputKey),
    read(outputKey),
  ]);
  return { native, input, output };
}

export function nativeUsdConversion(price: Price | null): UsdConversion | null {
  if (!price || !fresh(price.timestamp, NATIVE_MAX_AGE)) return null;
  const { units, decimals } = decimal(String(price.price));
  return {
    native_price_usd: formatUnits(units, decimals),
    source: "defillama",
    updated_at: price.timestamp,
  };
}

export function compareDefiLlamaPrice(
  quote: Pick<QuoteResult, "input_amount" | "output_amount">,
  input: Price | null,
  output: Price | null
): NonNullable<QuoteResult["defillama_price_check"]> | null {
  const reliable = (price: Price | null): price is Price =>
    price !== null &&
    (price.confidence ?? 0) >= MIN_TRADE_CONFIDENCE &&
    fresh(price.timestamp, TRADE_MAX_AGE);
  if (!reliable(input) || !reliable(output)) return null;

  const paid = decimal(quote.input_amount);
  const received = decimal(quote.output_amount);
  const inputUsd = decimal(String(input.price));
  const outputUsd = decimal(String(output.price));
  // Scale both USD values to the same precision before comparing.
  const inputValue =
    paid.units * inputUsd.units * 10n ** BigInt(received.decimals + outputUsd.decimals);
  const outputValue =
    received.units * outputUsd.units * 10n ** BigInt(paid.decimals + inputUsd.decimals);
  const shortfall = inputValue - outputValue;
  return {
    worse_than_reference: shortfall > 0n,
    shortfall_bps: shortfall > 0n ? Number((shortfall * 10_000n) / inputValue) : 0,
  };
}
