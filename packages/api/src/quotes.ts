import {
  getQuote,
  getQuotes,
  isNativeToken,
  type Config,
  type SimulatedQuote,
  type SuccessfulSimulatedQuote,
  type SwapParams,
} from "@spandex/core";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  getClient,
  getSpandexConfig,
  getTokenDecimals,
  getTokenSymbol,
  getNativeAsset,
} from "./config.js";
import { getGasPriceWithCache } from "./gas-price.js";
import { logger } from "./logger.js";
import type { QuoteParams } from "./quote.js";
import type { CompareResult, QuoteResult } from "./quote-response.js";

// Used only for previews and exchange-rate estimates. Its calldata never leaves the API.
const PREVIEW_ACCOUNT: Address = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055";
const config = getSpandexConfig();
const rates = new Map<string, { nativeRaw: bigint; tokenRaw: bigint; timestamp: number }>();
const RATE_TTL_MS = 60_000;
type Router = "spandex" | "curve";

function successful(quote: SimulatedQuote): quote is SuccessfulSimulatedQuote {
  return quote.success && quote.simulation.success;
}

function providerConfig(router?: Router): Config {
  return router
    ? {
        ...config,
        aggregators: config.aggregators.filter(
          (provider) => (provider.name() === "curve") === (router === "curve")
        ),
      }
    : config;
}

async function requestQuotes(params: QuoteParams, router?: Router) {
  const [inputDecimals, outputDecimals, fromSymbol, toSymbol] = await Promise.all([
    getTokenDecimals(params.chainId, params.from),
    getTokenDecimals(params.chainId, params.to),
    getTokenSymbol(params.chainId, params.from),
    getTokenSymbol(params.chainId, params.to),
  ]);
  const common = {
    chainId: params.chainId,
    inputToken: params.from as Address,
    outputToken: params.to as Address,
    slippageBps: params.slippageBps,
    swapperAccount: (params.sender as Address | undefined) ?? PREVIEW_ACCOUNT,
  };
  const swap: SwapParams =
    params.mode === "targetOut"
      ? { ...common, mode: "targetOut", outputAmount: parseUnits(params.amount, outputDecimals) }
      : { ...common, mode: "exactIn", inputAmount: parseUnits(params.amount, inputDecimals) };
  const selectedConfig = providerConfig(router);
  const quotes = selectedConfig.aggregators.length
    ? await getQuotes({ config: selectedConfig, swap })
    : [];
  const results = quotes.filter(successful).map((quote): QuoteResult => ({
    chainId: params.chainId,
    from: params.from,
    from_symbol: fromSymbol,
    to: params.to,
    to_symbol: toSymbol,
    amount: params.amount,
    mode: params.mode,
    input_amount: formatUnits(quote.inputAmount, inputDecimals),
    output_amount: formatUnits(quote.simulation.outputAmount, outputDecimals),
    input_amount_raw: quote.inputAmount.toString(),
    output_amount_raw: quote.simulation.outputAmount.toString(),
    slippage_bps: params.slippageBps,
    provider: quote.provider,
    sender: params.sender ?? null,
    execution: params.sender
      ? {
          to: quote.txData.to,
          data: quote.txData.data,
          value: (quote.txData.value ?? 0n).toString(),
          approval: quote.approval ?? null,
        }
      : null,
    route: quote.route ?? null,
    gas_used:
      quote.simulation.gasUsed && quote.simulation.gasUsed > 0n
        ? quote.simulation.gasUsed.toString()
        : null,
    gas_price_gwei: null,
    native_currency: getNativeAsset(params.chainId).symbol,
    gas_cost_native: null,
    trade_value_native: null,
    net_value_native: null,
  }));
  for (const quote of quotes) {
    if (!successful(quote)) {
      logger.debug(
        { provider: quote.provider, error: quote.success ? quote.simulation : quote.error },
        "Provider quote failed"
      );
    }
  }
  return { results, inputDecimals, outputDecimals };
}

async function nativeRate(chainId: number, token: string, decimals: number) {
  const native = getNativeAsset(chainId);
  const tokenRaw = 10n ** BigInt(decimals);
  if (isNativeToken(token as Address) || token.toLowerCase() === native.wrapped.toLowerCase()) {
    return { tokenRaw, nativeRaw: 10n ** BigInt(native.decimals) };
  }
  const key = `${chainId}:${token.toLowerCase()}`;
  const cached = rates.get(key);
  if (cached && Date.now() - cached.timestamp < RATE_TTL_MS) return cached;
  try {
    const quote = await getQuote({
      config: providerConfig("spandex"),
      swap: {
        chainId,
        inputToken: token as Address,
        outputToken: native.wrapped,
        mode: "exactIn",
        inputAmount: tokenRaw,
        slippageBps: 100,
        swapperAccount: PREVIEW_ACCOUNT,
      },
      strategy: "bestPrice",
    });
    if (!quote || !successful(quote) || quote.simulation.outputAmount <= 0n) return null;
    const rate = { tokenRaw, nativeRaw: quote.simulation.outputAmount, timestamp: Date.now() };
    rates.set(key, rate);
    return rate;
  } catch (error) {
    logger.debug({ error, chainId, token }, "Native conversion rate unavailable");
    return null;
  }
}

function best(quotes: QuoteResult[], mode: QuoteParams["mode"]): QuoteResult | null {
  return quotes.reduce<QuoteResult | null>((previous, current) => {
    if (!previous) return current;
    const field = mode === "targetOut" ? "input_amount_raw" : "output_amount_raw";
    return (
      mode === "targetOut"
        ? BigInt(current[field]) < BigInt(previous[field])
        : BigInt(current[field]) > BigInt(previous[field])
    )
      ? current
      : previous;
  }, null);
}

export async function compareQuotes(params: QuoteParams, router?: Router): Promise<CompareResult> {
  const { results, inputDecimals, outputDecimals } = await requestQuotes(params, router);
  const spandex = best(
    results.filter((quote) => quote.provider !== "curve"),
    params.mode
  );
  const curve = best(
    results.filter((quote) => quote.provider === "curve"),
    params.mode
  );
  const native = getNativeAsset(params.chainId);
  const targetOut = params.mode === "targetOut";
  const [gas, rate] = await Promise.all([
    getGasPriceWithCache(params.chainId, getClient(params.chainId)),
    results.length
      ? nativeRate(
          params.chainId,
          targetOut ? params.from : params.to,
          targetOut ? inputDecimals : outputDecimals
        )
      : null,
  ]);
  const gasPrice = gas.gasPriceWei;
  const values = new Map<QuoteResult, bigint>();
  for (const quote of [spandex, curve]) {
    if (!quote) continue;
    quote.gas_price_gwei = gas.gasPriceGwei;
    const cost =
      quote.gas_used !== null && gasPrice !== null ? BigInt(quote.gas_used) * gasPrice : null;
    const amount = BigInt(targetOut ? quote.input_amount_raw : quote.output_amount_raw);
    const value = rate ? (amount * rate.nativeRaw) / rate.tokenRaw : null;
    quote.gas_cost_native = cost === null ? null : formatUnits(cost, native.decimals);
    quote.trade_value_native = value === null ? null : formatUnits(value, native.decimals);
    if (cost !== null && rate !== null) {
      const numerator = amount * rate.nativeRaw;
      const gasNumerator = cost * rate.tokenRaw;
      const net = targetOut ? numerator + gasNumerator : numerator - gasNumerator;
      values.set(quote, net);
      quote.net_value_native = formatUnits(net / rate.tokenRaw, native.decimals);
    }
  }
  let recommendation: Router | null = null;
  let basis: CompareResult["recommendation_basis"] = "none";
  let reason = "No provider returned a successful quote.";
  if (spandex && curve) {
    const spandexNet = values.get(spandex);
    const curveNet = values.get(curve);
    const adjusted = spandexNet !== undefined && curveNet !== undefined;
    const field = targetOut ? "input_amount_raw" : "output_amount_raw";
    const spandexValue = adjusted ? spandexNet : BigInt(spandex[field]);
    const curveValue = adjusted ? curveNet : BigInt(curve[field]);
    recommendation = (targetOut ? curveValue < spandexValue : curveValue > spandexValue)
      ? "curve"
      : "spandex";
    basis = adjusted ? "gas_adjusted" : "raw_amount";
    reason = adjusted
      ? `${targetOut ? "Lowest total cost" : "Highest output after gas"} in ${native.symbol}.`
      : `Comparing raw ${targetOut ? "input" : "output"} amounts because gas or conversion data is unavailable.`;
    if (spandexValue === curveValue) reason += " Equal values; Spandex selected.";
  } else if (spandex || curve) {
    recommendation = spandex ? "spandex" : "curve";
    basis = "single_quote";
    reason = `Only ${spandex ? "Spandex" : "Curve"} returned a quote.`;
  }
  const rateText = rate ? formatUnits(rate.nativeRaw, native.decimals) : null;
  return {
    spandex,
    curve,
    spandex_error: spandex ? null : "Spandex returned no successful quote.",
    curve_error: curve ? null : "Curve returned no successful quote.",
    recommendation,
    recommendation_reason: reason,
    recommendation_basis: basis,
    gas_price_gwei: gas.gasPriceGwei,
    native_currency: native.symbol,
    input_to_native_rate: targetOut ? rateText : null,
    output_to_native_rate: targetOut ? null : rateText,
    mode: params.mode,
  };
}

export async function singleQuote(params: QuoteParams, router: Router): Promise<QuoteResult> {
  const comparison = await compareQuotes(params, router);
  const quote = comparison[router];
  if (!quote) throw new Error("No provider returned a successful quote");
  return quote;
}
