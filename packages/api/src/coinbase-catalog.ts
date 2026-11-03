import { z } from "zod";
import { getNativeAsset, getTokenDecimals } from "./config.js";
import type { QuoteParams } from "./quote.js";

export class CoinbaseError extends Error {}

const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const CATALOG_TTL_MS = 5 * 60_000;
const networks: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  10: "optimism",
  42161: "arbitrum",
  137: "polygon",
  43114: "avacchain",
  56: "bsc",
};
// Coinbase omits these contract fields. These issuer-published identities only apply
// when Coinbase itself lists USDC on that network. Never infer identity from a symbol.
// https://developers.circle.com/stablecoins/usdc-contract-addresses
const issuerContracts: Record<string, Record<string, string>> = {
  USDC: {
    base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    arbitrum: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    optimism: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  },
};
const currencySchema = z.object({
  id: z.string().min(1),
  supported_networks: z
    .array(
      z.object({
        id: z.string(),
        contract_address: z.string().nullable().optional(),
        crypto_address_link: z.string().optional(),
      })
    )
    .optional()
    .default([]),
});
const listedProductSchema = z.object({
  product_id: z.string(),
  base_currency_id: z.string(),
  quote_currency_id: z.string(),
  product_type: z.string(),
});
const pageSchema = z.object({
  products: z.array(listedProductSchema),
  pagination: z.object({ next_cursor: z.string(), has_next: z.boolean() }),
});
type Catalog = {
  currencies: z.infer<typeof currencySchema>[];
  products: z.infer<typeof listedProductSchema>[];
};
let cached: { value: Catalog; at: number } | undefined;
let pending: Promise<Catalog> | undefined;

async function loadCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const signal = AbortSignal.timeout(3000);
    const get = async (url: string): Promise<unknown> => {
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache", "User-Agent": "compare-dex-routers" },
        signal,
      });
      if (!response.ok)
        throw new CoinbaseError("Coinbase asset catalog is unavailable. Try again.");
      return response.json();
    };
    const loadProducts = async () => {
      const products: Catalog["products"] = [];
      const seen = new Set<string>();
      let cursor = "";
      for (;;) {
        const query = new URLSearchParams({
          product_type: "SPOT",
          limit: "1000",
          get_all_products: "true",
        });
        if (cursor) query.set("cursor", cursor);
        const page = pageSchema.parse(
          await get(`https://api.coinbase.com/api/v3/brokerage/market/products?${query}`)
        );
        products.push(...page.products.filter((product) => product.product_type === "SPOT"));
        if (!page.pagination.has_next) return products;
        cursor = page.pagination.next_cursor;
        if (!cursor || seen.has(cursor))
          throw new CoinbaseError("Coinbase returned an incomplete market catalog. Try again.");
        seen.add(cursor);
      }
    };
    const [currencies, products] = await Promise.all([
      get("https://api.exchange.coinbase.com/currencies").then((data) =>
        z.array(currencySchema).parse(data)
      ),
      loadProducts(),
    ]);
    const value = { currencies, products };
    cached = { value, at: Date.now() };
    return value;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}

export async function resolveCoinbasePair(params: QuoteParams) {
  const networkId = networks[params.chainId];
  if (!networkId || params.from.toLowerCase() === params.to.toLowerCase())
    throw new CoinbaseError("Select two different Coinbase assets on a supported chain.");
  const catalog = await loadCatalog();
  const identify = async (address: string) => {
    const normalized = address.toLowerCase();
    const native =
      normalized === NATIVE || normalized === "0x0000000000000000000000000000000000000000";
    const matches = catalog.currencies.filter((currency) =>
      currency.supported_networks.some((network) => {
        if (network.id !== networkId) return false;
        if (native) return currency.id === getNativeAsset(params.chainId).symbol;
        // Some Coinbase wrapped-asset entries publish identity in the token URL.
        const linked = network.crypto_address_link?.match(
          /\/token\/(0x[0-9a-f]{40})(?:[/?#]|$)/i
        )?.[1];
        const contract =
          network.contract_address || linked || issuerContracts[currency.id]?.[networkId];
        return !!contract && ADDRESS.test(contract) && contract.toLowerCase() === normalized;
      })
    );
    const ids = [...new Set(matches.map((currency) => currency.id))];
    const [symbol] = ids;
    if (ids.length !== 1 || !symbol)
      throw new CoinbaseError(
        "Coinbase does not publish an unambiguous identity for this chain/token address."
      );
    const decimals = await getTokenDecimals(params.chainId, address);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
      throw new CoinbaseError("Token decimal precision is not supported by the Coinbase estimate.");
    return { symbol, decimals };
  };
  const [from, to] = await Promise.all([identify(params.from), identify(params.to)]);
  if (from.symbol === to.symbol)
    throw new CoinbaseError(
      "These tokens represent the same Coinbase asset; no exchange trade is needed."
    );
  const product = catalog.products.find(
    (product) =>
      (product.base_currency_id === from.symbol && product.quote_currency_id === to.symbol) ||
      (product.base_currency_id === to.symbol && product.quote_currency_id === from.symbol)
  );
  if (!product)
    throw new CoinbaseError(
      "No direct Coinbase market connects these assets. A route would require multiple exchange trades."
    );
  return {
    from,
    to,
    pair: [product.base_currency_id, product.quote_currency_id] as const,
    id: product.product_id,
  };
}
