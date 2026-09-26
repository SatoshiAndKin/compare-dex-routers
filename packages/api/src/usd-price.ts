import { formatUnits } from "viem";
import { z } from "zod";
import { logger } from "./logger.js";
import type { UsdConversion } from "./quote-response.js";

const assets: Record<number, string> = {
  1: "ethereum",
  10: "ethereum",
  8453: "ethereum",
  42161: "ethereum",
  56: "binancecoin",
  137: "polygon-ecosystem-token",
  43114: "avalanche-2",
};
const TTL = 60_000;
const MAX_AGE = 600;
const prices = new Map<string, { value: UsdConversion; fetchedAt: number }>();
const pending = new Map<string, Promise<UsdConversion | null>>();
const priceSchema = z.object({ price: z.number().positive(), timestamp: z.number().int() });

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

function fresh(timestamp: number): boolean {
  const age = Date.now() / 1000 - timestamp;
  return age >= 0 && age <= MAX_AGE;
}

async function fetchPrice(asset: string): Promise<UsdConversion | null> {
  try {
    const key = `coingecko:${asset}`;
    const response = await fetch(`https://coins.llama.fi/prices/current/${key}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = z
      .object({ coins: z.record(z.string(), z.unknown()) })
      .parse(await response.json());
    const result = priceSchema.safeParse(body.coins[key]);
    if (!result.success || !fresh(result.data.timestamp)) return null;
    const price = decimal(String(result.data.price));
    const value: UsdConversion = {
      native_price_usd: formatUnits(price.units, price.decimals),
      source: "defillama",
      updated_at: result.data.timestamp,
    };
    prices.set(asset, { value, fetchedAt: Date.now() });
    return value;
  } catch (error) {
    logger.debug({ error, asset }, "USD display conversion unavailable");
    return null;
  }
}

export async function getNativeUsdConversion(chainId: number): Promise<UsdConversion | null> {
  const asset = assets[chainId];
  if (!asset) return null;
  const cached = prices.get(asset);
  if (cached && Date.now() - cached.fetchedAt < TTL && fresh(cached.value.updated_at))
    return cached.value;
  const existing = pending.get(asset);
  if (existing) return existing;
  const request = fetchPrice(asset);
  pending.set(asset, request);
  try {
    return await request;
  } finally {
    pending.delete(asset);
  }
}
