import type { Quote } from "../lib/stores/comparisonStore.svelte.js";
import type { components } from "../generated/api-types.js";
export const FROM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const TO = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
export const SENDER = "0x2222222222222222222222222222222222222222";
export const ROUTER = "0xdef1c0ded9bec7f1a1670819833240f027b25eff";
export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    chainId: 1,
    from: FROM,
    from_symbol: "USDC",
    to: TO,
    to_symbol: "USDT",
    amount: "100",
    input_amount: "100",
    output_amount: "99.95",
    input_amount_raw: "100000000",
    output_amount_raw: "99950000",
    mode: "exactIn",
    provider: "0x",
    slippage_bps: 50,
    sender: SENDER,
    execution: {
      to: ROUTER,
      data: "0xabcdef",
      value: "0",
      approval: { token: FROM, spender: ROUTER },
    },
    route: null,
    gas_used: "120000",
    gas_price_gwei: "20",
    native_currency: "ETH",
    gas_cost_native: "0.0024",
    trade_value_native: "0.5",
    net_value_native: "0.4976",
    ...overrides,
  };
}
export function makeComparison(
  overrides: Partial<components["schemas"]["CompareResult"]> = {}
): components["schemas"]["CompareResult"] {
  return {
    spandex: makeQuote(),
    curve: makeQuote({ provider: "curve", output_amount: "99.98", output_amount_raw: "99980000" }),
    spandex_error: null,
    curve_error: null,
    recommendation: "spandex",
    recommendation_reason: "Highest output after gas in ETH.",
    recommendation_basis: "gas_adjusted",
    gas_price_gwei: "20",
    native_currency: "ETH",
    input_to_native_rate: null,
    output_to_native_rate: "0.005",
    mode: "exactIn",
    ...overrides,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
