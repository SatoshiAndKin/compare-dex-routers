import { formatUnits, parseUnits } from "viem";
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import type { QuoteParams } from "./quote.js";
import { CoinbaseError as EstimateError, resolveCoinbasePair } from "./coinbase-catalog.js";

extendZodWithOpenApi(z);

// Match the app's 30-second wallet-quote freshness window.
const MAX_BOOK_AGE_MS = 30_000;

export const TakerFeePercentSchema = z.string().regex(/^\d{1,2}(?:\.\d{1,4})?$/);

const positiveDecimal = z
  .string()
  .regex(/^\d+(?:\.\d{1,18})?$/)
  .refine((v) => parseUnits(v, 18) > 0n);
const levelSchema = z.object({ price: positiveDecimal, size: positiveDecimal });
const productSchema = z.object({
  product_id: z.string(),
  base_currency_id: z.string(),
  quote_currency_id: z.string(),
  status: z.string(),
  trading_disabled: z.boolean(),
  cancel_only: z.boolean(),
  limit_only: z.boolean(),
  post_only: z.boolean(),
  auction_mode: z.boolean(),
  base_min_size: positiveDecimal,
  base_max_size: positiveDecimal,
  quote_min_size: positiveDecimal,
  quote_max_size: positiveDecimal,
});
const bookSchema = z.object({
  pricebook: z.object({
    product_id: z.string(),
    time: z.string().datetime({ offset: true }),
    bids: z.array(levelSchema).min(1),
    asks: z.array(levelSchema).min(1),
  }),
});

export const CoinbaseEstimateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
  z.object({
    status: z.literal("ready"),
    product_id: z.string(),
    side: z.enum(["BUY", "SELL"]),
    input_symbol: z.string(),
    output_symbol: z.string(),
    input_amount: z.string(),
    output_amount: z.string(),
    input_amount_raw: z.string(),
    output_amount_raw: z.string(),
    input_decimals: z.number().int(),
    output_decimals: z.number().int(),
    fee_percent: z.string().nullable(),
    fee_amount: z.string().nullable(),
    fee_symbol: z.string(),
    as_of: z.string(),
    expires_at: z.string(),
    limit_only: z.boolean(),
    trade_url: z.string().url(),
  }),
]);
export type CoinbaseEstimate = z.infer<typeof CoinbaseEstimateSchema>;

type Asset = { symbol: string; decimals: number };
type Market = {
  product: z.infer<typeof productSchema>;
  book: z.infer<typeof bookSchema>["pricebook"];
};
const cached = new Map<string, { market: Market; at: number }>();
const pending = new Map<string, Promise<Market>>();

async function loadMarket(id: string): Promise<Market> {
  const previous = cached.get(id);
  if (previous && Date.now() - previous.at < 1000) return previous.market;
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    const signal = AbortSignal.timeout(3000);
    const get = async (path: string): Promise<unknown> => {
      const response = await fetch(`https://api.coinbase.com/api/v3/brokerage/market/${path}`, {
        headers: { "Cache-Control": "no-cache" },
        signal,
      });
      if (!response.ok) throw new EstimateError("Coinbase market data is unavailable. Try again.");
      return response.json();
    };
    const [product, body] = await Promise.all([
      get(`products/${id}`),
      get(`product_book?product_id=${id}&limit=1000`),
    ]);
    const market = {
      product: productSchema.parse(product),
      book: bookSchema.parse(body).pricebook,
    };
    cached.set(id, { market, at: Date.now() });
    return market;
  })();
  pending.set(id, request);
  try {
    return await request;
  } finally {
    pending.delete(id);
  }
}

const ceil = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;

// Walk a snapshot, rounding input costs up and output proceeds down. These are
// indicative amounts, not orders rounded to Coinbase's order-size increments.
function fill(
  levels: z.infer<typeof levelSchema>[],
  target: bigint,
  targetBase: boolean,
  buy: boolean,
  precision: number
) {
  const scale = 10n ** BigInt(precision);
  let remaining = target,
    base = 0n,
    quote = 0n;
  const sorted = levels
    .map((level) => ({
      price: parseUnits(level.price, precision),
      size: parseUnits(level.size, precision),
    }))
    .sort((a, b) => (a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * (buy ? 1 : -1)));
  for (const level of sorted) {
    const requested = targetBase
      ? remaining
      : buy
        ? (remaining * scale) / level.price
        : ceil(remaining * scale, level.price);
    const quantity = requested < level.size ? requested : level.size;
    const value = buy ? ceil(quantity * level.price, scale) : (quantity * level.price) / scale;
    base += quantity;
    quote += value;
    const consumed = targetBase ? quantity : value;
    remaining = consumed >= remaining ? 0n : remaining - consumed;
    if (remaining === 0n || (!targetBase && buy && requested <= level.size)) return { base, quote };
  }
  throw new EstimateError("Available Coinbase order-book depth cannot fill this amount.");
}

function tradeAmount(params: QuoteParams, from: Asset, to: Asset, precision: number) {
  const amountDecimals = params.mode === "exactIn" ? from.decimals : to.decimals;
  if (
    !/^\d+(?:\.\d+)?$/.test(params.amount) ||
    (params.amount.split(".")[1]?.length ?? 0) > amountDecimals
  )
    throw new EstimateError("Amount exceeds the token's supported decimal precision.");
  const amount = parseUnits(params.amount, precision);
  if (amount <= 0n) throw new EstimateError("Enter a positive trade amount.");
  return amount;
}

function validateMarket(
  product: Market["product"],
  book: Market["book"],
  id: string,
  pair: readonly [string, string]
) {
  if (
    product.product_id !== id ||
    book.product_id !== id ||
    product.base_currency_id !== pair[0] ||
    product.quote_currency_id !== pair[1]
  )
    throw new EstimateError("Coinbase returned a different market identity.");
  if (
    product.status !== "online" ||
    product.trading_disabled ||
    product.cancel_only ||
    product.post_only ||
    product.auction_mode
  )
    throw new EstimateError("This Coinbase market is not open for immediate trading.");
  const age = Date.now() - Date.parse(book.time);
  if (age < -1000 || age > MAX_BOOK_AGE_MS)
    throw new EstimateError("Coinbase order-book data is stale. Refresh to retry.");
}

export async function getCoinbaseEstimate(
  params: QuoteParams,
  feePercent: string | null
): Promise<CoinbaseEstimate> {
  try {
    const { from, to, pair, id } = await resolveCoinbasePair(params);
    if (feePercent !== null && !TakerFeePercentSchema.safeParse(feePercent).success)
      throw new EstimateError(
        "Enter a taker fee from 0 to less than 100 percent, with at most four decimal places."
      );
    const precision = Math.max(18, from.decimals, to.decimals);
    const percent = 100n * 10n ** BigInt(precision);
    const fee = feePercent === null ? 0n : parseUnits(feePercent, precision);
    const amount = tradeAmount(params, from, to, precision);
    const { product, book } = await loadMarket(id);
    validateMarket(product, book, id, pair);
    const buy = from.symbol === pair[1];
    const targetBase = buy ? params.mode === "targetOut" : params.mode === "exactIn";
    const target = targetBase
      ? amount
      : buy
        ? (amount * percent) / (percent + fee)
        : ceil(amount * percent, percent - fee);
    const filled = fill(buy ? book.asks : book.bids, target, targetBase, buy, precision);
    if (
      filled.base < parseUnits(product.base_min_size, precision) ||
      filled.base > parseUnits(product.base_max_size, precision) ||
      filled.quote < parseUnits(product.quote_min_size, precision) ||
      filled.quote > parseUnits(product.quote_max_size, precision)
    )
      throw new EstimateError("Amount is outside Coinbase market size limits.");
    const commission = ceil(filled.quote * fee, percent);
    const input = buy ? filled.quote + commission : filled.base;
    const output = buy ? filled.base : filled.quote - commission;
    const inputRaw = ceil(input, 10n ** BigInt(precision - from.decimals));
    const outputRaw = output / 10n ** BigInt(precision - to.decimals);
    return {
      status: "ready",
      product_id: id,
      side: buy ? "BUY" : "SELL",
      input_symbol: from.symbol,
      output_symbol: to.symbol,
      input_amount: formatUnits(inputRaw, from.decimals),
      output_amount: formatUnits(outputRaw, to.decimals),
      input_amount_raw: inputRaw.toString(),
      output_amount_raw: outputRaw.toString(),
      input_decimals: from.decimals,
      output_decimals: to.decimals,
      fee_percent: feePercent,
      fee_amount: feePercent === null ? null : formatUnits(commission, precision),
      fee_symbol: pair[1],
      as_of: book.time,
      expires_at: new Date(Date.parse(book.time) + MAX_BOOK_AGE_MS).toISOString(),
      limit_only: product.limit_only,
      trade_url: `https://www.coinbase.com/advanced-trade/spot/${id}`,
    };
  } catch (error) {
    // Never return upstream bodies, URLs, or request details to the browser.
    const reason =
      error instanceof z.ZodError
        ? "Coinbase returned invalid market data."
        : error instanceof EstimateError
          ? error.message
          : "Coinbase estimate is unavailable. Refresh to retry.";
    return { status: "unavailable", reason };
  }
}
