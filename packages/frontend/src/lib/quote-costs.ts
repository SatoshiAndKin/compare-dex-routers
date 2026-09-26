import type { Quote, QuoteResponse } from "./stores/comparisonStore.svelte.js";

export function formatUsd(value: string | null | undefined): string {
  if (value == null) return "USD unavailable";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "USD unavailable";
  const [, sign, whole = "0", fraction = ""] = match;
  const nonzero = /[1-9]/.test(whole + fraction);
  if (BigInt(whole) === 0n && fraction.padEnd(2, "0").slice(0, 2) === "00" && nonzero)
    return sign ? "−<$0.01" : "<$0.01";
  const cents =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2)) +
    (Number(fraction[2] ?? "0") >= 5 ? 1n : 0n);
  const dollars = (cents / 100n).toLocaleString("en-US");
  return `${sign && nonzero ? "−" : ""}$${dollars}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function quoteCostFields(
  quote: Quote,
  basis: QuoteResponse["recommendation_basis"]
): [string, string][] {
  const fields: [string, string][] = [
    [
      basis === "raw_amount" ? "Estimated gas cost (excluded from ranking)" : "Estimated gas cost",
      quote.gas_cost_native === null ? "Unavailable" : formatUsd(quote.gas_cost_usd),
    ],
    [
      "Required approval gas cost",
      quote.approval_gas_used === "0"
        ? "None needed"
        : quote.approval_gas_cost_native == null
          ? "Unavailable"
          : `${formatUsd(quote.approval_gas_cost_usd)}${quote.gas_cost_native === null ? "" : " (included above)"}`,
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
      formatUsd(quote.net_value_usd),
    ]);
  }
  return fields;
}
