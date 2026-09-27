import { parseUnits } from "viem";
import type { CompareParams, QuoteResponse } from "./stores/comparisonStore.svelte.js";

export function canQuoteWallet(
  params: CompareParams,
  balance: bigint | null,
  decimals: number
): boolean {
  if (!params.sender || balance === null) return false;
  if (params.mode === "targetOut") return false;
  try {
    const input = parseUnits(params.amount, decimals);
    return input > 0n && balance >= input;
  } catch {
    return false;
  }
}

/** Retain only this comparison's preview prices when wallet quoting loses a provider. */
export function mergePreview(preview: QuoteResponse, wallet: QuoteResponse): QuoteResponse {
  const quotes = [...wallet.quotes];
  for (const quote of preview.quotes) {
    if (quotes.some((candidate) => candidate.provider === quote.provider)) continue;
    const failure = wallet.failures.find((failure) => failure.provider === quote.provider);
    quotes.push({
      ...quote,
      sender: null,
      execution: null,
      simulation_status: "not_run",
      simulation_reason: failure
        ? `Wallet quote unavailable: ${failure.error.message}. Showing a preview price.`
        : "Wallet quote unavailable. Showing a preview price.",
      gas_used: null,
      approval_gas_used: null,
      gas_price_gwei: wallet.gas_price_gwei,
      gas_cost_native: null,
      approval_gas_cost_native: null,
      trade_value_native: null,
      net_value_native: null,
      gas_cost_usd: null,
      approval_gas_cost_usd: null,
      trade_value_usd: null,
      net_value_usd: null,
    });
  }
  const verified = quotes.some((quote) => quote.simulation_status === "succeeded");
  const order = [...preview.quotes, ...wallet.quotes].map((quote) => quote.provider);
  const field = wallet.mode === "targetOut" ? "input_amount_raw" : "output_amount_raw";
  quotes.sort((a, b) => {
    const aVerified = a.simulation_status === "succeeded";
    const bVerified = b.simulation_status === "succeeded";
    if (aVerified || bVerified) return Number(bVerified) - Number(aVerified);
    const left = BigInt(a[field]),
      right = BigInt(b[field]);
    return left === right
      ? order.indexOf(a.provider) - order.indexOf(b.provider)
      : (left < right ? -1 : 1) * (wallet.mode === "targetOut" ? 1 : -1);
  });
  return {
    ...wallet,
    quotes,
    failures: wallet.failures.filter(
      (failure) => !quotes.some((quote) => quote.provider === failure.provider)
    ),
    recommendation: verified ? wallet.recommendation : (quotes[0]?.provider ?? null),
    recommendation_basis: verified
      ? wallet.recommendation_basis
      : quotes.length
        ? "raw_amount"
        : "none",
    recommendation_reason: verified
      ? wallet.recommendation_reason
      : "Best quoted price — unverified. No route simulated successfully for this wallet.",
  };
}
