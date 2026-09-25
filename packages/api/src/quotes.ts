import {
  getQuote,
  prepareQuotes,
  simulateQuote,
  isNativeToken,
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
import type { QuoteResponse, QuoteResult, ProviderFailure } from "./quote-response.js";
import { redact, redactText } from "./redaction.js";
import { createPreviewState } from "./preview-simulation.js";

// Used only for previews and exchange-rate estimates. Its calldata never leaves the API.
const PREVIEW_ACCOUNT: Address = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055";
const config = getSpandexConfig();
const rates = new Map<string, { nativeRaw: bigint; tokenRaw: bigint; timestamp: number }>();
const RATE_TTL_MS = 60_000;

function successful(quote: SimulatedQuote, minimumOutput = 1n): quote is SuccessfulSimulatedQuote {
  return (
    quote.success && quote.simulation.success && quote.simulation.outputAmount >= minimumOutput
  );
}

async function requestQuotes(params: QuoteParams) {
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
  const client = getClient(params.chainId);
  const previewState = createPreviewState(
    client,
    swap.swapperAccount,
    swap.inputToken,
    Boolean(params.sender)
  );
  const quotes = config.aggregators.length
    ? await Promise.all(
        await prepareQuotes({
          config,
          swap,
          mapFn: async (quote): Promise<SimulatedQuote> => {
            try {
              return await simulateQuote({
                client,
                swap,
                quote,
                simulationOptions: quote.success
                  ? { stateOverrides: await previewState(quote.inputAmount) }
                  : undefined,
              });
            } catch (error) {
              return {
                ...quote,
                simulation: {
                  success: false,
                  error: error instanceof Error ? error : new Error(String(error)),
                },
              };
            }
          },
        })
      )
    : [];
  const minimumOutput = swap.mode === "targetOut" ? swap.outputAmount : 1n;
  const results = quotes
    .filter((quote) => successful(quote, minimumOutput))
    .map((quote): QuoteResult => ({
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
            approval: isNativeToken(swap.inputToken) ? null : (quote.approval ?? null),
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
  const failures: ProviderFailure[] = [];
  for (const quote of quotes) {
    if (successful(quote, minimumOutput)) continue;
    const error = !quote.success
      ? quote.error
      : !quote.simulation.success
        ? quote.simulation.error
        : new Error("Simulated output is below the requested amount");
    const diagnostic =
      error && typeof error === "object" ? (error as unknown as Record<string, unknown>) : {};
    failures.push({
      provider: quote.provider,
      stage: quote.success ? "simulation" : "quote",
      error: {
        name: redactText(typeof diagnostic.name === "string" ? diagnostic.name : "Error"),
        message: redactText(
          typeof diagnostic.message === "string" ? diagnostic.message : String(error)
        ),
        code:
          typeof diagnostic.code === "string"
            ? redactText(diagnostic.code)
            : typeof diagnostic.code === "number"
              ? diagnostic.code
              : null,
        cause: redact(diagnostic.cause) ?? null,
        details: redact(diagnostic.details) ?? null,
      },
    });
    logger.debug({ provider: quote.provider, minimumOutput, error }, "Provider quote failed");
  }
  return { results, failures, inputDecimals, outputDecimals, account: swap.swapperAccount };
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
      config,
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
      simulationOptions: {
        stateOverrides: await createPreviewState(
          getClient(chainId),
          PREVIEW_ACCOUNT,
          token as Address
        )(tokenRaw),
      },
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

export async function quoteRoutes(params: QuoteParams): Promise<QuoteResponse> {
  const { results, failures, inputDecimals, outputDecimals, account } = await requestQuotes(params);
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
  const values = new Map<QuoteResult, bigint>();
  for (const quote of results) {
    quote.gas_price_gwei = gas.gasPriceGwei;
    const cost =
      quote.gas_used !== null && gas.gasPriceWei !== null
        ? BigInt(quote.gas_used) * gas.gasPriceWei
        : null;
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
  // Use a single comparable basis for every route, preserving configuration order on ties.
  // Simulation gas alone does not supply comparable rollup posting/operator fees.
  const completeGas = ![10, 8453, 42161].includes(params.chainId);
  const adjusted = completeGas && results.length > 0 && values.size === results.length;
  const order = new Map<string, number>(
    config.aggregators.map((provider, index) => [provider.name(), index])
  );
  results.sort((a, b) => (order.get(a.provider) ?? Infinity) - (order.get(b.provider) ?? Infinity));
  const field = targetOut ? "input_amount_raw" : "output_amount_raw";
  const value = (quote: QuoteResult) =>
    adjusted ? (values.get(quote) ?? BigInt(quote[field])) : BigInt(quote[field]);
  results.sort((a, b) => {
    const left = value(a),
      right = value(b);
    return left === right ? 0 : (left < right ? -1 : 1) * (targetOut ? 1 : -1);
  });
  return {
    quotes: results,
    failures,
    recommendation: results[0]?.provider ?? null,
    recommendation_basis: results.length === 0 ? "none" : adjusted ? "gas_adjusted" : "raw_amount",
    recommendation_reason:
      results.length === 0
        ? "No provider returned a successful price simulation."
        : adjusted
          ? `${targetOut ? "Lowest input plus estimated gas" : "Highest output after estimated gas"} in ${native.symbol}. Equal values use provider configuration order.`
          : `Comparing all routes by raw ${targetOut ? "input" : "output"} amounts because comparable gas or conversion data is unavailable. Equal values use provider configuration order.`,
    simulation_basis: "temporary_funding",
    simulation_account: account,
    wallet_readiness: "unchecked",
    gas_price_gwei: gas.gasPriceGwei,
    native_currency: native.symbol,
    mode: params.mode,
  };
}
