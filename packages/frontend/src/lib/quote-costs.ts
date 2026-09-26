import type { Quote, QuoteResponse } from "./stores/comparisonStore.svelte.js";

export function quoteCostFields(
  quote: Quote,
  basis: QuoteResponse["recommendation_basis"]
): [string, string][] {
  const fields: [string, string][] = [
    [
      basis === "raw_amount" ? "Estimated gas cost (excluded from ranking)" : "Estimated gas cost",
      quote.gas_cost_native === null
        ? "Unavailable"
        : `${quote.gas_cost_native} ${quote.native_currency}`,
    ],
  ];
  if (
    basis === "gas_adjusted" &&
    quote.gas_cost_native !== null &&
    quote.trade_value_native !== null &&
    quote.net_value_native !== null
  ) {
    fields.push([
      quote.mode === "targetOut"
        ? "Estimated input cost including gas"
        : "Estimated output value after gas",
      `${quote.net_value_native} ${quote.native_currency}`,
    ]);
  }
  return fields;
}
