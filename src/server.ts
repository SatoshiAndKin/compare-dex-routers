import "./env.js";
import "./sentry.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getQuote, serializeWithBigInt } from "@spandex/core";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { parseQuoteParams, type QuoteMode } from "./quote.js";
import {
  getSpandexConfig,
  getTokenDecimals,
  getTokenSymbol,
  getTokenName,
  getClient,
  getRpcUrl,
  SUPPORTED_CHAINS,
  DEFAULT_TOKENS,
} from "./config.js";
import {
  initAllCurveInstances,
  findCurveQuote,
  isCurveSupported,
  isCurveInitialized,
  getCurveInitError,
  type CurveQuoteResult,
} from "./curve.js";
import { logger } from "./logger.js";
import { captureException, captureMessage } from "./sentry.js";
import { getRequestId, setTraceHeaders } from "./tracing.js";
import { recordRequest, getMetrics } from "./metrics.js";
import { isEnabled, getAllFlags } from "./feature-flags.js";
import { trackQuote, getAnalyticsSummary } from "./analytics.js";
import { trackError, getErrorInsights } from "./error-insights.js";
import { getGasPriceWithCache } from "./gas-price.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const CURVE_ENABLED = isEnabled("curve_enabled");

function log(message: string) {
  logger.info(message);
}

function logError(message: string, err?: unknown) {
  const errorDetail = err instanceof Error ? err.message : err || "";
  logger.error({ err: errorDetail }, message);
  captureException(err, { message });
}

const config = getSpandexConfig();

interface QuoteResult {
  chainId: number;
  from: string;
  from_symbol: string;
  to: string;
  to_symbol: string;
  amount: string;
  input_amount: string;
  output_amount: string;
  input_amount_raw: string;
  output_amount_raw: string;
  mode: QuoteMode;
  provider: string;
  slippage_bps: number;
  gas_used: string;
  router_address: string;
  router_calldata: string;
  router_value?: string;
  approval_token?: string;
  approval_spender?: string;
  // Gas price field - may be provided by Spandex or fetched from RPC
  gas_price_gwei?: string;
  // Gas-adjusted comparison fields
  gas_cost_eth?: string; // Gas cost in ETH (gas_used * gas_price / 1e18)
  output_value_eth?: string; // Output converted to ETH
  net_value_eth?: string; // output_value_eth - gas_cost_eth
}

interface TokenListPayload {
  tokens: Array<{
    chainId: number;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
  }>;
  [key: string]: unknown;
}

const FALLBACK_ACCOUNT = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055" as Address;

interface TokenlistEntry {
  path: string;
  name: string;
  tokens: TokenListPayload["tokens"];
}

let cachedDefaultTokenlists: TokenlistEntry[] | null = null;
let cachedDefaultTokenlistsKey: string | null = null;

/**
 * Get the list of default tokenlist file paths from environment.
 * DEFAULT_TOKENLISTS: comma-separated list of file paths (relative to cwd or absolute)
 * Defaults to ['static/tokenlist.json'] when not set.
 */
function getDefaultTokenlistPaths(): string[] {
  const envValue = process.env.DEFAULT_TOKENLISTS;
  if (!envValue || envValue.trim() === "") {
    return [resolve(process.cwd(), "static", "tokenlist.json")];
  }
  // Split by comma, trim whitespace, resolve relative paths to cwd
  return envValue
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("/") ? p : resolve(process.cwd(), p)));
}

/**
 * Load all default tokenlists from configured paths.
 * Returns array of {path, name, tokens} entries.
 * Caches based on the DEFAULT_TOKENLISTS env value.
 */
async function loadDefaultTokenlists(): Promise<TokenlistEntry[]> {
  const paths = getDefaultTokenlistPaths();
  const cacheKey = paths.join("|");

  if (cachedDefaultTokenlists && cachedDefaultTokenlistsKey === cacheKey) {
    return cachedDefaultTokenlists;
  }

  const entries: TokenlistEntry[] = [];

  for (const path of paths) {
    try {
      const fileContents = await readFile(path, "utf8");
      const parsed = JSON.parse(fileContents) as TokenListPayload;
      const tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];
      // Use the name from the tokenlist, or derive from filename
      const name =
        typeof parsed.name === "string" && parsed.name.trim() !== ""
          ? parsed.name
          : path.split("/").pop() || path;
      entries.push({ path, name, tokens });
    } catch (err) {
      logError(`Failed to load default tokenlist from ${path}`, err);
      // Continue to next path - don't fail entirely if one is missing
    }
  }

  cachedDefaultTokenlists = entries;
  cachedDefaultTokenlistsKey = cacheKey;
  return entries;
}

// Maximum response size for proxy endpoint (5MB)
const TOKENLIST_PROXY_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetch and validate a remote tokenlist URL via server-side proxy.
 * This avoids CORS issues when loading custom tokenlists.
 *
 * Validation:
 * - URL must start with https://
 * - Response must be valid JSON with a tokens array
 * - Response body limited to 5MB
 *
 * Returns the parsed tokenlist on success.
 * Throws Error with descriptive message on failure.
 */
async function fetchProxyTokenList(urlString: string): Promise<TokenListPayload> {
  // Validate URL parameter exists and is a string
  if (!urlString || typeof urlString !== "string") {
    throw new Error("Missing url parameter");
  }

  // Parse and validate URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL format");
  }

  // Enforce HTTPS only
  if (url.protocol !== "https:") {
    throw new Error("URL must use HTTPS protocol");
  }

  // Fetch the remote URL
  let response: Response;
  try {
    response = await fetch(urlString, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch remote URL: ${detail}`, { cause: err });
  }

  if (!response.ok) {
    throw new Error(`Remote server returned HTTP ${response.status}`);
  }

  // Check content-length header if present
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > TOKENLIST_PROXY_MAX_BYTES) {
    throw new Error(`Response too large: ${contentLength} bytes exceeds 5MB limit`);
  }

  // Read response body with size limit
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to read response body");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;
      if (totalBytes > TOKENLIST_PROXY_MAX_BYTES) {
        throw new Error("Response body exceeds 5MB limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Combine chunks and parse JSON
  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.length;
  }

  const bodyText = new TextDecoder().decode(bodyBytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("Response is not valid JSON");
  }

  // Validate tokens array exists
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as Record<string, unknown>).tokens)
  ) {
    throw new Error("Response must contain a tokens array");
  }

  return parsed as TokenListPayload;
}

async function findQuote(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  slippageBps: number,
  sender?: string,
  mode: QuoteMode = "exactIn"
): Promise<QuoteResult> {
  // Fetch decimals for both tokens upfront
  const [inputDecimals, outputDecimals] = await Promise.all([
    getTokenDecimals(chainId, from),
    getTokenDecimals(chainId, to),
  ]);

  // Build swap request based on mode
  const swapRequest =
    mode === "targetOut"
      ? {
          chainId,
          inputToken: from as Address,
          outputToken: to as Address,
          mode: "targetOut" as const,
          outputAmount: parseUnits(amount, outputDecimals),
          slippageBps,
        }
      : {
          chainId,
          inputToken: from as Address,
          outputToken: to as Address,
          mode: "exactIn" as const,
          inputAmount: parseUnits(amount, inputDecimals),
          slippageBps,
        };

  // Fire sender and fallback quotes in parallel when sender is provided
  const quotePromises = [];
  if (sender) {
    quotePromises.push(
      getQuote({
        config,
        swap: { ...swapRequest, swapperAccount: sender as Address },
        strategy: "bestPrice",
      })
    );
  }
  quotePromises.push(
    getQuote({
      config,
      swap: { ...swapRequest, swapperAccount: FALLBACK_ACCOUNT },
      strategy: "bestPrice",
    })
  );

  // Fetch non-critical metadata concurrently with the Spandex query
  const [quotes, fromSymbol, toSymbol] = await Promise.all([
    Promise.all(quotePromises),
    getTokenSymbol(chainId, from),
    getTokenSymbol(chainId, to),
  ]);

  // Prefer sender quote, fall back to fallback account quote
  const quote = quotes.find((q) => q !== null) ?? null;

  if (!quote) {
    throw new Error("No providers returned a successful quote");
  }

  // Format amounts based on mode
  const inputHuman = formatUnits(quote.inputAmount, inputDecimals);
  const outputHuman = formatUnits(quote.simulation.outputAmount, outputDecimals);

  const result: QuoteResult = {
    chainId,
    from,
    from_symbol: fromSymbol,
    to,
    to_symbol: toSymbol,
    amount,
    input_amount: inputHuman,
    output_amount: outputHuman,
    input_amount_raw: quote.inputAmount.toString(),
    output_amount_raw: quote.simulation.outputAmount.toString(),
    mode,
    provider: quote.provider,
    slippage_bps: slippageBps,
    gas_used: quote.simulation.gasUsed?.toString() ?? "0",
    router_address: quote.txData.to,
    router_calldata: quote.txData.data,
  };

  if (quote.txData.value) {
    result.router_value = quote.txData.value.toString();
  }

  if (quote.approval) {
    result.approval_token = quote.approval.token;
    result.approval_spender = quote.approval.spender;
  }

  return result;
}

interface CompareResult {
  spandex: QuoteResult | null;
  spandex_error: string | null;
  curve: CurveQuoteResult | null;
  curve_error: string | null;
  recommendation: "spandex" | "curve" | null;
  recommendation_reason: string;
  gas_price_gwei: string | null;
  // Gas-adjusted comparison fields
  output_to_eth_rate: string | null; // Rate used to convert output to ETH (null if output is ETH)
  input_to_eth_rate: string | null; // Rate used to convert input to ETH (null if input is ETH, used for targetOut mode)
  mode: QuoteMode; // The quote mode used for this comparison
}

// Known WETH addresses by chainId
const WETH_ADDRESSES: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Ethereum mainnet
  8453: "0x4200000000000000000000000000000000000006", // Base
  42161: "0x82aF49447D8a07e3340369C42921F5baB03F7D1D", // Arbitrum
  10: "0x4200000000000000000000000000000000000006", // Optimism
  137: "0x7ceB23bD638e8c21a3e6f28A20c2eE60b7E34F54", // Polygon
  56: "0xbb4CdB9CBd36B01bD1cBaEB2Fe939D64f10c92b3", // BSC (WBNB)
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // Avalanche (WAVAX)
};

// Rate cache for output->ETH conversions (60s TTL)
const OUTPUT_TO_ETH_RATE_CACHE_TTL_MS = 60 * 1000;
const outputToEthRateCache = new Map<string, { rate: number; timestamp: number }>();

// Rate cache for input->ETH conversions (60s TTL) - used for targetOut mode
const INPUT_TO_ETH_RATE_CACHE_TTL_MS = 60 * 1000;
const inputToEthRateCache = new Map<string, { rate: number; timestamp: number }>();

// Check if output token is ETH/WETH
function isEthOutput(symbol: string, address: string, chainId: number): boolean {
  const normalizedSymbol = symbol.toUpperCase();
  if (normalizedSymbol === "ETH" || normalizedSymbol === "WETH") return true;

  const wethAddress = WETH_ADDRESSES[chainId];
  if (wethAddress && address.toLowerCase() === wethAddress.toLowerCase()) return true;

  return false;
}

// Fetch output->ETH rate via Spandex quote
// Uses a small amount (1 unit of output token) to get the exchange rate
// Caches the rate for 60 seconds since both quotes in a comparison use the same output token
async function fetchOutputToEthRate(
  chainId: number,
  outputToken: string,
  outputDecimals: number
): Promise<number | null> {
  const cacheKey = `${chainId}:${outputToken.toLowerCase()}`;
  const cached = outputToEthRateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < OUTPUT_TO_ETH_RATE_CACHE_TTL_MS) {
    return cached.rate;
  }

  const wethAddress = WETH_ADDRESSES[chainId];
  if (!wethAddress) {
    // No WETH address for this chain, can't fetch rate
    return null;
  }

  try {
    // Use 1 unit of the output token to get the rate
    const oneUnit = parseUnits("1", outputDecimals);

    const quote = await getQuote({
      config,
      swap: {
        chainId,
        inputToken: outputToken as Address,
        outputToken: wethAddress as Address,
        mode: "exactIn",
        inputAmount: oneUnit,
        slippageBps: 1000, // 10% slippage for rate fetch (we just need an approximate rate)
        swapperAccount: FALLBACK_ACCOUNT,
      },
      strategy: "bestPrice",
    });

    if (!quote) {
      return null;
    }

    // Rate = outputAmount (in ETH) / 1 unit of input
    // Since we used 1 unit, the output amount IS the rate
    const rate = Number(formatUnits(quote.simulation.outputAmount, 18));

    // Cache the rate
    outputToEthRateCache.set(cacheKey, { rate, timestamp: Date.now() });

    return rate;
  } catch {
    // Rate fetch failed
    return null;
  }
}

// Fetch input->ETH rate via Spandex quote (for targetOut mode gas-adjusted comparison)
// Uses a small amount (1 unit of input token) to get the exchange rate
// Caches the rate for 60 seconds since both quotes in a comparison use the same input token
async function fetchInputToEthRate(
  chainId: number,
  inputToken: string,
  inputDecimals: number
): Promise<number | null> {
  const cacheKey = `${chainId}:${inputToken.toLowerCase()}`;
  const cached = inputToEthRateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < INPUT_TO_ETH_RATE_CACHE_TTL_MS) {
    return cached.rate;
  }

  const wethAddress = WETH_ADDRESSES[chainId];
  if (!wethAddress) {
    // No WETH address for this chain, can't fetch rate
    return null;
  }

  try {
    // Use 1 unit of the input token to get the rate
    const oneUnit = parseUnits("1", inputDecimals);

    const quote = await getQuote({
      config,
      swap: {
        chainId,
        inputToken: inputToken as Address,
        outputToken: wethAddress as Address,
        mode: "exactIn",
        inputAmount: oneUnit,
        slippageBps: 1000, // 10% slippage for rate fetch (we just need an approximate rate)
        swapperAccount: FALLBACK_ACCOUNT,
      },
      strategy: "bestPrice",
    });

    if (!quote) {
      return null;
    }

    // Rate = outputAmount (in ETH) / 1 unit of input
    // Since we used 1 unit, the output amount IS the rate
    const rate = Number(formatUnits(quote.simulation.outputAmount, 18));

    // Cache the rate
    inputToEthRateCache.set(cacheKey, { rate, timestamp: Date.now() });

    return rate;
  } catch {
    // Rate fetch failed
    return null;
  }
}

// Helper to format ETH values with appropriate precision
function formatEthValue(value: number): string {
  if (value === 0) return "0";
  if (value < 0.000001) return value.toExponential(6);
  return value.toFixed(6);
}

async function compareQuotes(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  slippageBps: number,
  sender?: string,
  mode: QuoteMode = "exactIn"
): Promise<CompareResult> {
  const spandexPromise = findQuote(chainId, from, to, amount, slippageBps, sender, mode)
    .then((r) => ({ result: r, error: null }))
    .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }));

  const curveAvailable = CURVE_ENABLED && isCurveSupported(chainId) && isCurveInitialized(chainId);
  const curvePromise = curveAvailable
    ? findCurveQuote(chainId, from, to, amount, sender, getClient(chainId), mode)
        .then((r) => ({ result: r, error: null }))
        .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }))
    : Promise.resolve({
        result: null,
        error:
          isCurveSupported(chainId) && !isCurveInitialized(chainId)
            ? `Curve initialization failed for chain ${chainId}: ${getCurveInitError(chainId) || "Unknown error"}`
            : isCurveSupported(chainId)
              ? "Curve is disabled"
              : `Curve does not support chain ${chainId}`,
      });

  // Fetch gas price with per-block caching via RPC fallback
  // This runs in parallel with the Spandex/Curve quote fetches
  const gasPricePromise = getGasPriceWithCache(chainId, getClient(chainId))
    .then((result) => result.gasPriceGwei)
    .catch(() => null);

  const [spandex, curveResult, gasPriceGwei] = await Promise.all([
    spandexPromise,
    curvePromise,
    gasPricePromise,
  ]);

  // Prefer Spandex's gas_price_gwei if provided (future-proofing)
  // Otherwise use the RPC fallback value
  const effectiveGasPriceGwei = spandex.result?.gas_price_gwei ?? gasPriceGwei;

  let recommendation: "spandex" | "curve" | null = null;
  let reason: string;
  let outputToEthRate: number | null = null;
  let outputToEthRateStr: string | null = null;
  let inputToEthRate: number | null = null;
  let inputToEthRateStr: string | null = null;

  // Determine if output is ETH/WETH
  const outputIsEth = spandex.result
    ? isEthOutput(spandex.result.to_symbol, spandex.result.to, chainId)
    : curveResult.result
      ? isEthOutput(curveResult.result.to_symbol, curveResult.result.to, chainId)
      : false;

  // Determine if input is ETH/WETH (relevant for targetOut mode)
  const inputIsEth = spandex.result
    ? isEthOutput(spandex.result.from_symbol, spandex.result.from, chainId)
    : curveResult.result
      ? isEthOutput(curveResult.result.from_symbol, curveResult.result.from, chainId)
      : false;

  const outputSymbol = spandex.result?.to_symbol || curveResult.result?.to_symbol || "tokens";
  const inputSymbol = spandex.result?.from_symbol || curveResult.result?.from_symbol || "tokens";

  // Fetch output->ETH rate for non-ETH outputs (needed for exactIn gas-adjusted comparison)
  if (mode === "exactIn" && !outputIsEth && (spandex.result || curveResult.result)) {
    const outputToken = spandex.result?.to || curveResult.result?.to;
    const outputDecimals = await getTokenDecimals(chainId, outputToken || "");
    outputToEthRate = await fetchOutputToEthRate(chainId, outputToken || "", outputDecimals);
    if (outputToEthRate !== null) {
      outputToEthRateStr = outputToEthRate.toFixed(6);
    }
  }

  // Fetch input->ETH rate for non-ETH inputs (needed for targetOut gas-adjusted comparison)
  if (mode === "targetOut" && !inputIsEth && (spandex.result || curveResult.result)) {
    const inputToken = spandex.result?.from || curveResult.result?.from;
    const inputDecimals = await getTokenDecimals(chainId, inputToken || "");
    inputToEthRate = await fetchInputToEthRate(chainId, inputToken || "", inputDecimals);
    if (inputToEthRate !== null) {
      inputToEthRateStr = inputToEthRate.toFixed(6);
    }
  }

  // Helper to compute gas-adjusted values for a quote (exactIn mode)
  // Returns: gas cost in ETH, output value in ETH, net value (output - gas)
  function computeGasAdjustedValuesExactIn(
    outputAmount: number,
    gasUsed: number,
    gasPriceWei: number
  ): {
    gasCostEth: number;
    outputValueEth: number;
    netValueEth: number;
  } {
    const gasCostEth = gasUsed > 0 && gasPriceWei > 0 ? (gasUsed * gasPriceWei) / 1e18 : 0;
    // Convert output to ETH
    const outputValueEth = outputIsEth
      ? outputAmount
      : outputToEthRate !== null
        ? outputAmount * outputToEthRate
        : 0;
    const netValueEth = outputValueEth - gasCostEth;
    return { gasCostEth, outputValueEth, netValueEth };
  }

  // Helper to compute gas-adjusted values for a quote (targetOut mode)
  // Returns: gas cost in ETH, input value in ETH, total cost (input + gas) - LOWER is better
  function computeGasAdjustedValuesTargetOut(
    inputAmount: number,
    gasUsed: number,
    gasPriceWei: number
  ): {
    gasCostEth: number;
    inputValueEth: number;
    totalCostEth: number;
  } {
    const gasCostEth = gasUsed > 0 && gasPriceWei > 0 ? (gasUsed * gasPriceWei) / 1e18 : 0;
    // Convert input to ETH (input is what we're paying, so we need its ETH value)
    const inputValueEth = inputIsEth
      ? inputAmount
      : inputToEthRate !== null
        ? inputAmount * inputToEthRate
        : 0;
    const totalCostEth = inputValueEth + gasCostEth;
    return { gasCostEth, inputValueEth, totalCostEth };
  }

  // Helper to enrich quote with gas-adjusted fields
  function enrichQuoteWithGasFields(
    quote: QuoteResult | null,
    gasCostEth: number,
    outputValueEth: number,
    netValueEth: number
  ): void {
    if (!quote) return;
    quote.gas_cost_eth = formatEthValue(gasCostEth);
    quote.output_value_eth = formatEthValue(outputValueEth);
    quote.net_value_eth = formatEthValue(netValueEth);
  }

  // Enrich Curve quote with gas-adjusted fields
  function enrichCurveQuoteWithGasFields(
    quote: CurveQuoteResult | null,
    gasCostEth: number,
    outputValueEth: number,
    netValueEth: number
  ): void {
    if (!quote) return;
    quote.gas_cost_eth = formatEthValue(gasCostEth);
    quote.output_value_eth = formatEthValue(outputValueEth);
    quote.net_value_eth = formatEthValue(netValueEth);
  }

  const gasPriceWei = effectiveGasPriceGwei ? Number(effectiveGasPriceGwei) * 1e9 : 0;

  if (spandex.result && curveResult.result) {
    const spandexGas = Number(spandex.result.gas_used || "0");
    const curveGas = Number(curveResult.result.gas_used || "0");
    const bothHaveGas = spandexGas > 0 && curveGas > 0 && effectiveGasPriceGwei !== null;

    if (mode === "targetOut") {
      // === TARGET_OUT MODE ===
      // Compare by required INPUT amount (lower = better)
      // User specifies desired output, quotes return required input
      const spandexInput = Number(spandex.result.input_amount);
      const curveInput = Number(curveResult.result.input_amount);

      // Compute gas-adjusted values for targetOut
      const spandexValues = computeGasAdjustedValuesTargetOut(
        spandexInput,
        spandexGas,
        gasPriceWei
      );
      const curveValues = computeGasAdjustedValuesTargetOut(curveInput, curveGas, gasPriceWei);

      // Enrich quotes with gas fields (for targetOut, net_value_eth represents total cost)
      enrichQuoteWithGasFields(
        spandex.result,
        spandexValues.gasCostEth,
        spandexValues.inputValueEth,
        spandexValues.totalCostEth
      );
      enrichCurveQuoteWithGasFields(
        curveResult.result,
        curveValues.gasCostEth,
        curveValues.inputValueEth,
        curveValues.totalCostEth
      );

      // Determine if we can do gas-adjusted comparison
      const canDoGasAdjusted = inputIsEth || inputToEthRate !== null;

      if (canDoGasAdjusted && bothHaveGas) {
        // Gas-adjusted comparison: lower total cost wins
        if (curveValues.totalCostEth < spandexValues.totalCostEth) {
          recommendation = "curve";
          // Show input difference if amounts differ
          const inputDiff = spandexInput - curveInput;
          const inputDiffNote =
            inputDiff > 0.000001
              ? ` Curve requires ${inputDiff.toFixed(6)} ${inputSymbol} less input.`
              : "";
          if (inputIsEth) {
            reason = `Curve requires ${curveInput.toFixed(6)} ETH (${curveValues.totalCostEth.toFixed(6)} ETH total with gas) vs Spandex ${spandexInput.toFixed(6)} ETH (${spandexValues.totalCostEth.toFixed(6)} ETH total).${inputDiffNote} Curve recommended.`;
          } else {
            reason = `Curve requires ${curveInput.toFixed(6)} ${inputSymbol} (~${curveValues.inputValueEth.toFixed(6)} ETH, ${curveValues.totalCostEth.toFixed(6)} ETH total with gas) vs Spandex ${spandexInput.toFixed(6)} ${inputSymbol} (~${spandexValues.inputValueEth.toFixed(6)} ETH, ${spandexValues.totalCostEth.toFixed(6)} ETH total). Rate: 1 ${inputSymbol} = ${inputToEthRateStr} ETH.${inputDiffNote} Curve recommended.`;
          }
        } else if (spandexValues.totalCostEth < curveValues.totalCostEth) {
          recommendation = "spandex";
          // Show input difference if amounts differ
          const inputDiff = curveInput - spandexInput;
          const inputDiffNote =
            inputDiff > 0.000001
              ? ` Spandex requires ${inputDiff.toFixed(6)} ${inputSymbol} less input.`
              : "";
          if (inputIsEth) {
            reason = `Spandex (${spandex.result.provider}) requires ${spandexInput.toFixed(6)} ETH (${spandexValues.totalCostEth.toFixed(6)} ETH total with gas) vs Curve ${curveInput.toFixed(6)} ETH (${curveValues.totalCostEth.toFixed(6)} ETH total).${inputDiffNote} Spandex recommended.`;
          } else {
            reason = `Spandex (${spandex.result.provider}) requires ${spandexInput.toFixed(6)} ${inputSymbol} (~${spandexValues.inputValueEth.toFixed(6)} ETH, ${spandexValues.totalCostEth.toFixed(6)} ETH total with gas) vs Curve ${curveInput.toFixed(6)} ${inputSymbol} (~${curveValues.inputValueEth.toFixed(6)} ETH, ${curveValues.totalCostEth.toFixed(6)} ETH total). Rate: 1 ${inputSymbol} = ${inputToEthRateStr} ETH.${inputDiffNote} Spandex recommended.`;
          }
        } else {
          recommendation = "spandex";
          reason = `Equal total cost: ${spandexValues.totalCostEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else if (!canDoGasAdjusted && bothHaveGas) {
        // Rate fetch failed but we have gas - show gas costs in ETH for info, compare raw input
        if (curveInput < spandexInput) {
          recommendation = "curve";
          const diff = spandexInput - curveInput;
          const pct = ((diff / spandexInput) * 100).toFixed(3);
          reason = `Curve requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%). Gas costs: Curve ${curveValues.gasCostEth.toFixed(6)} ETH vs Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH. Curve recommended (gas cost shown for info, rate unavailable).`;
        } else if (spandexInput < curveInput) {
          recommendation = "spandex";
          const diff = curveInput - spandexInput;
          const pct = ((diff / curveInput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%). Gas costs: Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH vs Curve ${curveValues.gasCostEth.toFixed(6)} ETH. Spandex recommended (gas cost shown for info, rate unavailable).`;
        } else {
          recommendation = "spandex";
          reason = `Equal input amounts. Gas costs: Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH vs Curve ${curveValues.gasCostEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else {
        // Fall back to raw input comparison with a note about missing gas
        const missingGas: string[] = [];
        if (spandexGas === 0 || effectiveGasPriceGwei === null) missingGas.push("Spandex");
        if (curveGas === 0 || effectiveGasPriceGwei === null) missingGas.push("Curve");
        const missingGasNote =
          missingGas.length > 0
            ? ` Gas estimates unavailable for ${missingGas.join(" and ")}, comparing raw input only.`
            : "";

        if (curveInput < spandexInput) {
          recommendation = "curve";
          const diff = spandexInput - curveInput;
          const pct = ((diff / spandexInput) * 100).toFixed(3);
          reason = `Curve requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).${missingGasNote}`;
        } else if (spandexInput < curveInput) {
          recommendation = "spandex";
          const diff = curveInput - spandexInput;
          const pct = ((diff / curveInput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).${missingGasNote}`;
        } else {
          recommendation = "spandex";
          reason = `Equal input amounts; defaulting to Spandex for multi-provider coverage.${missingGasNote}`;
        }
      }
    } else {
      // === EXACT_IN MODE (default) ===
      // Compare by OUTPUT amount (higher = better)
      const spandexOutput = Number(spandex.result.output_amount);
      const curveOutput = Number(curveResult.result.output_amount);

      // Compute gas-adjusted values for exactIn
      const spandexValues = computeGasAdjustedValuesExactIn(spandexOutput, spandexGas, gasPriceWei);
      const curveValues = computeGasAdjustedValuesExactIn(curveOutput, curveGas, gasPriceWei);

      // Enrich quotes with gas fields
      enrichQuoteWithGasFields(
        spandex.result,
        spandexValues.gasCostEth,
        spandexValues.outputValueEth,
        spandexValues.netValueEth
      );
      enrichCurveQuoteWithGasFields(
        curveResult.result,
        curveValues.gasCostEth,
        curveValues.outputValueEth,
        curveValues.netValueEth
      );

      // Determine if we can do gas-adjusted comparison
      const canDoGasAdjusted = outputIsEth || outputToEthRate !== null;

      if (canDoGasAdjusted && bothHaveGas) {
        // Gas-adjusted comparison for ALL pairs using net ETH value
        if (curveValues.netValueEth > spandexValues.netValueEth) {
          recommendation = "curve";
          if (outputIsEth) {
            reason = `Curve returns ${curveOutput.toFixed(6)} ETH (${curveValues.netValueEth.toFixed(6)} ETH after gas) vs Spandex ${spandexOutput.toFixed(6)} ETH (${spandexValues.netValueEth.toFixed(6)} ETH after gas). Curve recommended.`;
          } else {
            reason = `Curve returns ${curveOutput.toFixed(6)} ${outputSymbol} (~${curveValues.outputValueEth.toFixed(6)} ETH, ${curveValues.netValueEth.toFixed(6)} ETH after gas) vs Spandex ${spandexOutput.toFixed(6)} ${outputSymbol} (~${spandexValues.outputValueEth.toFixed(6)} ETH, ${spandexValues.netValueEth.toFixed(6)} ETH after gas). Rate: 1 ${outputSymbol} = ${outputToEthRateStr} ETH. Curve recommended.`;
          }
        } else if (spandexValues.netValueEth > curveValues.netValueEth) {
          recommendation = "spandex";
          if (outputIsEth) {
            reason = `Spandex (${spandex.result.provider}) returns ${spandexOutput.toFixed(6)} ETH (${spandexValues.netValueEth.toFixed(6)} ETH after gas) vs Curve ${curveOutput.toFixed(6)} ETH (${curveValues.netValueEth.toFixed(6)} ETH after gas). Spandex recommended.`;
          } else {
            reason = `Spandex (${spandex.result.provider}) returns ${spandexOutput.toFixed(6)} ${outputSymbol} (~${spandexValues.outputValueEth.toFixed(6)} ETH, ${spandexValues.netValueEth.toFixed(6)} ETH after gas) vs Curve ${curveOutput.toFixed(6)} ${outputSymbol} (~${curveValues.outputValueEth.toFixed(6)} ETH, ${curveValues.netValueEth.toFixed(6)} ETH after gas). Rate: 1 ${outputSymbol} = ${outputToEthRateStr} ETH. Spandex recommended.`;
          }
        } else {
          recommendation = "spandex";
          reason = `Equal gas-adjusted net value: ${spandexValues.netValueEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else if (!canDoGasAdjusted && bothHaveGas) {
        // Rate fetch failed but we have gas - show gas costs in ETH for info, compare raw output
        if (curveOutput > spandexOutput) {
          recommendation = "curve";
          const diff = curveOutput - spandexOutput;
          const pct = ((diff / spandexOutput) * 100).toFixed(3);
          reason = `Curve outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%). Gas costs: Curve ${curveValues.gasCostEth.toFixed(6)} ETH vs Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH. Curve recommended (gas cost shown for info, rate unavailable).`;
        } else if (spandexOutput > curveOutput) {
          recommendation = "spandex";
          const diff = spandexOutput - curveOutput;
          const pct = ((diff / curveOutput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%). Gas costs: Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH vs Curve ${curveValues.gasCostEth.toFixed(6)} ETH. Spandex recommended (gas cost shown for info, rate unavailable).`;
        } else {
          recommendation = "spandex";
          reason = `Equal output amounts. Gas costs: Spandex ${spandexValues.gasCostEth.toFixed(6)} ETH vs Curve ${curveValues.gasCostEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else {
        // Fall back to raw output comparison with a note about missing gas
        const missingGas: string[] = [];
        if (spandexGas === 0 || effectiveGasPriceGwei === null) missingGas.push("Spandex");
        if (curveGas === 0 || effectiveGasPriceGwei === null) missingGas.push("Curve");
        const missingGasNote =
          missingGas.length > 0
            ? ` Gas estimates unavailable for ${missingGas.join(" and ")}, comparing raw output only.`
            : "";

        if (curveOutput > spandexOutput) {
          recommendation = "curve";
          const diff = curveOutput - spandexOutput;
          const pct = ((diff / spandexOutput) * 100).toFixed(3);
          reason = `Curve outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).${missingGasNote}`;
        } else if (spandexOutput > curveOutput) {
          recommendation = "spandex";
          const diff = spandexOutput - curveOutput;
          const pct = ((diff / curveOutput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).${missingGasNote}`;
        } else {
          recommendation = "spandex";
          reason = `Equal output amounts; defaulting to Spandex for multi-provider coverage.${missingGasNote}`;
        }
      }
    }
  } else if (spandex.result) {
    recommendation = "spandex";
    reason = "Only Spandex returned a quote";

    // Enrich with gas fields
    const spandexGas = Number(spandex.result.gas_used || "0");
    if (mode === "targetOut") {
      const spandexInput = Number(spandex.result.input_amount);
      const values = computeGasAdjustedValuesTargetOut(spandexInput, spandexGas, gasPriceWei);
      enrichQuoteWithGasFields(
        spandex.result,
        values.gasCostEth,
        values.inputValueEth,
        values.totalCostEth
      );
    } else {
      const spandexOutput = Number(spandex.result.output_amount);
      const values = computeGasAdjustedValuesExactIn(spandexOutput, spandexGas, gasPriceWei);
      enrichQuoteWithGasFields(
        spandex.result,
        values.gasCostEth,
        values.outputValueEth,
        values.netValueEth
      );
    }
  } else if (curveResult.result) {
    recommendation = "curve";
    reason = "Only Curve returned a quote";

    // Enrich with gas fields
    const curveGas = Number(curveResult.result.gas_used || "0");
    if (mode === "targetOut") {
      const curveInput = Number(curveResult.result.input_amount);
      const values = computeGasAdjustedValuesTargetOut(curveInput, curveGas, gasPriceWei);
      enrichCurveQuoteWithGasFields(
        curveResult.result,
        values.gasCostEth,
        values.inputValueEth,
        values.totalCostEth
      );
    } else {
      const curveOutput = Number(curveResult.result.output_amount);
      const values = computeGasAdjustedValuesExactIn(curveOutput, curveGas, gasPriceWei);
      enrichCurveQuoteWithGasFields(
        curveResult.result,
        values.gasCostEth,
        values.outputValueEth,
        values.netValueEth
      );
    }
  } else {
    reason = "Neither source returned a quote";
  }

  return {
    spandex: spandex.result,
    spandex_error: spandex.error,
    curve: curveResult.result,
    curve_error: curveResult.error,
    recommendation,
    recommendation_reason: reason,
    gas_price_gwei: effectiveGasPriceGwei,
    output_to_eth_rate: outputToEthRateStr,
    input_to_eth_rate: inputToEthRateStr,
    mode,
  };
}

function sendJson(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(serializeWithBigInt(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

/**
 * Send SSE event to client
 */
function sendSSE(res: http.ServerResponse, event: string, data: object) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stream compare quotes via Server-Sent Events.
 * Sends each router's quote as it arrives, then sends recommendation after both complete.
 */
async function streamCompareQuotes(
  res: http.ServerResponse,
  chainId: number,
  from: string,
  to: string,
  amount: string,
  slippageBps: number,
  sender?: string,
  mode: QuoteMode = "exactIn"
): Promise<void> {
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  let curveResult: { result: CurveQuoteResult | null; error: string | null } | null = null;

  // Check if Curve is available for this chain
  const curveAvailable = CURVE_ENABLED && isCurveSupported(chainId) && isCurveInitialized(chainId);
  const singleRouterMode = !curveAvailable;

  // If Curve is not available, send its unavailability immediately
  if (!curveAvailable) {
    const curveError =
      isCurveSupported(chainId) && !isCurveInitialized(chainId)
        ? `Curve initialization failed for chain ${chainId}: ${getCurveInitError(chainId) || "Unknown error"}`
        : isCurveSupported(chainId)
          ? "Curve is disabled"
          : `Curve does not support chain ${chainId}`;
    curveResult = { result: null, error: curveError };
    sendSSE(res, "error", { router: "curve", error: curveError });
  }

  // Start gas price fetch in parallel
  const gasPricePromise = getGasPriceWithCache(chainId, getClient(chainId))
    .then((result) => result.gasPriceGwei)
    .catch(() => null);

  // Create Spandex promise
  const spandexPromise = findQuote(chainId, from, to, amount, slippageBps, sender, mode)
    .then((r) => ({ result: r, error: null }))
    .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }));

  // Create Curve promise if available - use pre-set curveResult for unavailable case
  const curvePromise = curveAvailable
    ? findCurveQuote(chainId, from, to, amount, sender, getClient(chainId), mode)
        .then((r) => ({ result: r, error: null }))
        .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }))
    : Promise.resolve(curveResult ?? { result: null, error: "Curve not available" });

  // Process quotes as they arrive
  const processSpandex = spandexPromise.then(async (spandex) => {
    if (spandex.result) {
      sendSSE(res, "quote", { router: "spandex", data: spandex.result });
    } else {
      sendSSE(res, "error", { router: "spandex", error: spandex.error || "No quote available" });
    }
    return spandex;
  });

  const processCurve = curvePromise.then(async (curve) => {
    curveResult = curve;
    if (curve.result) {
      sendSSE(res, "quote", { router: "curve", data: curve.result });
    } else if (curve.error) {
      // Only send error event if not already sent (curve unavailable case)
      if (curveAvailable) {
        sendSSE(res, "error", { router: "curve", error: curve.error });
      }
    }
    return curve;
  });

  // Wait for both quotes and gas price
  const [spandex, curveResolved, gasPriceGwei] = await Promise.all([
    processSpandex,
    processCurve,
    gasPricePromise,
  ]);

  // Update curveResult with the resolved value
  curveResult = curveResolved;

  // Now compute recommendation and metadata
  const effectiveGasPriceGwei = spandex.result?.gas_price_gwei ?? gasPriceGwei;

  // Fetch output->ETH or input->ETH rate for gas-adjusted comparison
  let outputToEthRate: number | null = null;
  let outputToEthRateStr: string | null = null;
  let inputToEthRate: number | null = null;
  let inputToEthRateStr: string | null = null;

  const outputIsEth = spandex.result
    ? isEthOutput(spandex.result.to_symbol, spandex.result.to, chainId)
    : curveResult?.result
      ? isEthOutput(curveResult.result.to_symbol, curveResult.result.to, chainId)
      : false;

  const inputIsEth = spandex.result
    ? isEthOutput(spandex.result.from_symbol, spandex.result.from, chainId)
    : curveResult?.result
      ? isEthOutput(curveResult.result.from_symbol, curveResult.result.from, chainId)
      : false;

  const outputSymbol = spandex.result?.to_symbol || curveResult?.result?.to_symbol || "tokens";
  const inputSymbol = spandex.result?.from_symbol || curveResult?.result?.from_symbol || "tokens";

  if (mode === "exactIn" && !outputIsEth && (spandex.result || curveResult?.result)) {
    const outputToken = spandex.result?.to || curveResult?.result?.to;
    const outputDecimals = await getTokenDecimals(chainId, outputToken || "");
    outputToEthRate = await fetchOutputToEthRate(chainId, outputToken || "", outputDecimals);
    if (outputToEthRate !== null) {
      outputToEthRateStr = outputToEthRate.toFixed(6);
    }
  }

  if (mode === "targetOut" && !inputIsEth && (spandex.result || curveResult?.result)) {
    const inputToken = spandex.result?.from || curveResult?.result?.from;
    const inputDecimals = await getTokenDecimals(chainId, inputToken || "");
    inputToEthRate = await fetchInputToEthRate(chainId, inputToken || "", inputDecimals);
    if (inputToEthRate !== null) {
      inputToEthRateStr = inputToEthRate.toFixed(6);
    }
  }

  // Compute gas-adjusted values for each quote
  const gasPriceWei = effectiveGasPriceGwei ? Number(effectiveGasPriceGwei) * 1e9 : 0;

  function computeGasAdjustedValuesExactIn(
    outputAmount: number,
    gasUsed: number,
    gasPriceWeiVal: number
  ): { gasCostEth: number; outputValueEth: number; netValueEth: number } {
    const gasCostEth = gasUsed > 0 && gasPriceWeiVal > 0 ? (gasUsed * gasPriceWeiVal) / 1e18 : 0;
    const outputValueEth = outputIsEth
      ? outputAmount
      : outputToEthRate !== null
        ? outputAmount * outputToEthRate
        : 0;
    const netValueEth = outputValueEth - gasCostEth;
    return { gasCostEth, outputValueEth, netValueEth };
  }

  function computeGasAdjustedValuesTargetOut(
    inputAmount: number,
    gasUsed: number,
    gasPriceWeiVal: number
  ): { gasCostEth: number; inputValueEth: number; totalCostEth: number } {
    const gasCostEth = gasUsed > 0 && gasPriceWeiVal > 0 ? (gasUsed * gasPriceWeiVal) / 1e18 : 0;
    const inputValueEth = inputIsEth
      ? inputAmount
      : inputToEthRate !== null
        ? inputAmount * inputToEthRate
        : 0;
    const totalCostEth = inputValueEth + gasCostEth;
    return { gasCostEth, inputValueEth, totalCostEth };
  }

  // Enrich quotes with gas fields and determine recommendation
  let recommendation: "spandex" | "curve" | null = null;
  let reason: string;

  if (spandex.result && curveResult?.result) {
    const spandexGas = Number(spandex.result.gas_used || "0");
    const curveGas = Number(curveResult.result.gas_used || "0");
    const bothHaveGas = spandexGas > 0 && curveGas > 0 && effectiveGasPriceGwei !== null;

    if (mode === "targetOut") {
      const spandexInput = Number(spandex.result.input_amount);
      const curveInput = Number(curveResult.result.input_amount);
      const spandexValues = computeGasAdjustedValuesTargetOut(
        spandexInput,
        spandexGas,
        gasPriceWei
      );
      const curveValues = computeGasAdjustedValuesTargetOut(curveInput, curveGas, gasPriceWei);
      const canDoGasAdjusted = inputIsEth || inputToEthRate !== null;

      // Enrich quotes
      if (spandex.result) {
        spandex.result.gas_cost_eth = formatEthValue(spandexValues.gasCostEth);
        spandex.result.output_value_eth = formatEthValue(spandexValues.inputValueEth);
        spandex.result.net_value_eth = formatEthValue(spandexValues.totalCostEth);
      }
      if (curveResult.result) {
        curveResult.result.gas_cost_eth = formatEthValue(curveValues.gasCostEth);
        curveResult.result.output_value_eth = formatEthValue(curveValues.inputValueEth);
        curveResult.result.net_value_eth = formatEthValue(curveValues.totalCostEth);
      }

      if (canDoGasAdjusted && bothHaveGas) {
        if (curveValues.totalCostEth < spandexValues.totalCostEth) {
          recommendation = "curve";
          const inputDiff = spandexInput - curveInput;
          const inputDiffNote =
            inputDiff > 0.000001
              ? ` Curve requires ${inputDiff.toFixed(6)} ${inputSymbol} less input.`
              : "";
          if (inputIsEth) {
            reason = `Curve requires ${curveInput.toFixed(6)} ETH (${curveValues.totalCostEth.toFixed(6)} ETH total with gas) vs Spandex ${spandexInput.toFixed(6)} ETH (${spandexValues.totalCostEth.toFixed(6)} ETH total).${inputDiffNote} Curve recommended.`;
          } else {
            reason = `Curve requires ${curveInput.toFixed(6)} ${inputSymbol} (~${curveValues.inputValueEth.toFixed(6)} ETH, ${curveValues.totalCostEth.toFixed(6)} ETH total with gas) vs Spandex ${spandexInput.toFixed(6)} ${inputSymbol} (~${spandexValues.inputValueEth.toFixed(6)} ETH, ${spandexValues.totalCostEth.toFixed(6)} ETH total). Rate: 1 ${inputSymbol} = ${inputToEthRateStr} ETH.${inputDiffNote} Curve recommended.`;
          }
        } else if (spandexValues.totalCostEth < curveValues.totalCostEth) {
          recommendation = "spandex";
          const inputDiff = curveInput - spandexInput;
          const inputDiffNote =
            inputDiff > 0.000001
              ? ` Spandex requires ${inputDiff.toFixed(6)} ${inputSymbol} less input.`
              : "";
          if (inputIsEth) {
            reason = `Spandex (${spandex.result.provider}) requires ${spandexInput.toFixed(6)} ETH (${spandexValues.totalCostEth.toFixed(6)} ETH total with gas) vs Curve ${curveInput.toFixed(6)} ETH (${curveValues.totalCostEth.toFixed(6)} ETH total).${inputDiffNote} Spandex recommended.`;
          } else {
            reason = `Spandex (${spandex.result.provider}) requires ${spandexInput.toFixed(6)} ${inputSymbol} (~${spandexValues.inputValueEth.toFixed(6)} ETH, ${spandexValues.totalCostEth.toFixed(6)} ETH total with gas) vs Curve ${curveInput.toFixed(6)} ${inputSymbol} (~${curveValues.inputValueEth.toFixed(6)} ETH, ${curveValues.totalCostEth.toFixed(6)} ETH total). Rate: 1 ${inputSymbol} = ${inputToEthRateStr} ETH.${inputDiffNote} Spandex recommended.`;
          }
        } else {
          recommendation = "spandex";
          reason = `Equal total cost: ${spandexValues.totalCostEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else {
        // Fall back to raw input comparison
        if (curveInput < spandexInput) {
          recommendation = "curve";
          const diff = spandexInput - curveInput;
          const pct = ((diff / spandexInput) * 100).toFixed(3);
          reason = `Curve requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).`;
        } else if (spandexInput < curveInput) {
          recommendation = "spandex";
          const diff = curveInput - spandexInput;
          const pct = ((diff / curveInput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).`;
        } else {
          recommendation = "spandex";
          reason = `Equal input amounts; defaulting to Spandex for multi-provider coverage.`;
        }
      }
    } else {
      // exactIn mode
      const spandexOutput = Number(spandex.result.output_amount);
      const curveOutput = Number(curveResult.result.output_amount);
      const spandexValues = computeGasAdjustedValuesExactIn(spandexOutput, spandexGas, gasPriceWei);
      const curveValues = computeGasAdjustedValuesExactIn(curveOutput, curveGas, gasPriceWei);
      const canDoGasAdjusted = outputIsEth || outputToEthRate !== null;

      // Enrich quotes
      if (spandex.result) {
        spandex.result.gas_cost_eth = formatEthValue(spandexValues.gasCostEth);
        spandex.result.output_value_eth = formatEthValue(spandexValues.outputValueEth);
        spandex.result.net_value_eth = formatEthValue(spandexValues.netValueEth);
      }
      if (curveResult.result) {
        curveResult.result.gas_cost_eth = formatEthValue(curveValues.gasCostEth);
        curveResult.result.output_value_eth = formatEthValue(curveValues.outputValueEth);
        curveResult.result.net_value_eth = formatEthValue(curveValues.netValueEth);
      }

      if (canDoGasAdjusted && bothHaveGas) {
        if (curveValues.netValueEth > spandexValues.netValueEth) {
          recommendation = "curve";
          if (outputIsEth) {
            reason = `Curve returns ${curveOutput.toFixed(6)} ETH (${curveValues.netValueEth.toFixed(6)} ETH after gas) vs Spandex ${spandexOutput.toFixed(6)} ETH (${spandexValues.netValueEth.toFixed(6)} ETH after gas). Curve recommended.`;
          } else {
            reason = `Curve returns ${curveOutput.toFixed(6)} ${outputSymbol} (~${curveValues.outputValueEth.toFixed(6)} ETH, ${curveValues.netValueEth.toFixed(6)} ETH after gas) vs Spandex ${spandexOutput.toFixed(6)} ${outputSymbol} (~${spandexValues.outputValueEth.toFixed(6)} ETH, ${spandexValues.netValueEth.toFixed(6)} ETH after gas). Rate: 1 ${outputSymbol} = ${outputToEthRateStr} ETH. Curve recommended.`;
          }
        } else if (spandexValues.netValueEth > curveValues.netValueEth) {
          recommendation = "spandex";
          if (outputIsEth) {
            reason = `Spandex (${spandex.result.provider}) returns ${spandexOutput.toFixed(6)} ETH (${spandexValues.netValueEth.toFixed(6)} ETH after gas) vs Curve ${curveOutput.toFixed(6)} ETH (${curveValues.netValueEth.toFixed(6)} ETH after gas). Spandex recommended.`;
          } else {
            reason = `Spandex (${spandex.result.provider}) returns ${spandexOutput.toFixed(6)} ${outputSymbol} (~${spandexValues.outputValueEth.toFixed(6)} ETH, ${spandexValues.netValueEth.toFixed(6)} ETH after gas) vs Curve ${curveOutput.toFixed(6)} ${outputSymbol} (~${curveValues.outputValueEth.toFixed(6)} ETH, ${curveValues.netValueEth.toFixed(6)} ETH after gas). Rate: 1 ${outputSymbol} = ${outputToEthRateStr} ETH. Spandex recommended.`;
          }
        } else {
          recommendation = "spandex";
          reason = `Equal gas-adjusted net value: ${spandexValues.netValueEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
        }
      } else {
        // Fall back to raw output comparison
        if (curveOutput > spandexOutput) {
          recommendation = "curve";
          const diff = curveOutput - spandexOutput;
          const pct = ((diff / spandexOutput) * 100).toFixed(3);
          reason = `Curve outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).`;
        } else if (spandexOutput > curveOutput) {
          recommendation = "spandex";
          const diff = spandexOutput - curveOutput;
          const pct = ((diff / curveOutput) * 100).toFixed(3);
          reason = `Spandex (${spandex.result.provider}) outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).`;
        } else {
          recommendation = "spandex";
          reason = `Equal output amounts; defaulting to Spandex for multi-provider coverage.`;
        }
      }
    }
  } else if (spandex.result) {
    recommendation = "spandex";
    reason = "Only Spandex returned a quote";

    const spandexGas = Number(spandex.result.gas_used || "0");
    if (mode === "targetOut") {
      const spandexInput = Number(spandex.result.input_amount);
      const values = computeGasAdjustedValuesTargetOut(spandexInput, spandexGas, gasPriceWei);
      spandex.result.gas_cost_eth = formatEthValue(values.gasCostEth);
      spandex.result.output_value_eth = formatEthValue(values.inputValueEth);
      spandex.result.net_value_eth = formatEthValue(values.totalCostEth);
    } else {
      const spandexOutput = Number(spandex.result.output_amount);
      const values = computeGasAdjustedValuesExactIn(spandexOutput, spandexGas, gasPriceWei);
      spandex.result.gas_cost_eth = formatEthValue(values.gasCostEth);
      spandex.result.output_value_eth = formatEthValue(values.outputValueEth);
      spandex.result.net_value_eth = formatEthValue(values.netValueEth);
    }
  } else if (curveResult?.result) {
    recommendation = "curve";
    reason = "Only Curve returned a quote";

    const curveGas = Number(curveResult.result.gas_used || "0");
    if (mode === "targetOut") {
      const curveInput = Number(curveResult.result.input_amount);
      const values = computeGasAdjustedValuesTargetOut(curveInput, curveGas, gasPriceWei);
      curveResult.result.gas_cost_eth = formatEthValue(values.gasCostEth);
      curveResult.result.output_value_eth = formatEthValue(values.inputValueEth);
      curveResult.result.net_value_eth = formatEthValue(values.totalCostEth);
    } else {
      const curveOutput = Number(curveResult.result.output_amount);
      const values = computeGasAdjustedValuesExactIn(curveOutput, curveGas, gasPriceWei);
      curveResult.result.gas_cost_eth = formatEthValue(values.gasCostEth);
      curveResult.result.output_value_eth = formatEthValue(values.outputValueEth);
      curveResult.result.net_value_eth = formatEthValue(values.netValueEth);
    }
  } else {
    reason = "Neither source returned a quote";
  }

  // Send 'complete' event with recommendation and metadata
  sendSSE(res, "complete", {
    recommendation,
    recommendation_reason: reason,
    gas_price_gwei: effectiveGasPriceGwei,
    output_to_eth_rate: outputToEthRateStr,
    input_to_eth_rate: inputToEthRateStr,
    mode,
    single_router_mode: singleRouterMode,
  });

  // Send 'done' event
  sendSSE(res, "done", {});
  res.end();
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Compare DEX Routers</title>
  <style>
    /* BRUTALIST DESIGN: High contrast, no border-radius, max 2 fonts */
    /* Color Palette: Black/White + Blue accent (#0055FF) + Orange accent (#CC2900) + Green (#007700) + Red (#CC0000) */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    
    /* Respect hidden attribute - critical for wallet state */
    [hidden] { display: none !important; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      color: #000;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.5;
    }
    
    /* Typography */
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; letter-spacing: -0.02em; }
    h2, h3, h4 { font-weight: 600; }
    .mono { font-family: monospace; }
    
    /* Form Elements */
    form { margin-bottom: 1rem; }
    .form-group { margin-bottom: 0.75rem; position: relative; }
    label { display: block; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; padding-left: 0.5rem; border-left: 4px solid #0055FF; }
    input, select {
      width: 100%;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 0.875rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
    }
    input:focus, select:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    input::placeholder { color: #666; }
    
    /* MEV Protection Info Button */
    .mev-info-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.375rem 0.5rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      cursor: pointer;
    }
    .mev-info-btn:hover { background: #f0f0f0; }
    .mev-info-btn:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    .mev-info-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* Settings Gear Icon */
    .settings-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      padding: 0;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      cursor: pointer;
      flex-shrink: 0;
    }
    .settings-btn:hover { background: #f0f0f0; }
    .settings-btn:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    .settings-btn svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    /* Page Header - Title and Settings Gear */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .page-header h1 {
      margin-bottom: 0;
    }
    .page-header .settings-btn {
      flex-shrink: 0;
    }

    /* Form Header Row - Chain Selector only */
    .form-header-row {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .form-header-row .form-group { flex: 1; margin-bottom: 0; }

    /* Modal Overlay */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      justify-content: center;
      align-items: flex-start;
      padding: 2rem 1rem;
      overflow-y: auto;
      z-index: 1000;
    }
    .modal-overlay.show { display: flex; }

    /* Modal Dialog - Brutalist Design */
    .modal {
      background: #fff;
      border: 4px solid #000;
      max-width: 500px;
      width: 100%;
      position: relative;
      margin: auto;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 2px solid #000;
      background: #000;
      color: #fff;
    }
    .modal-title {
      font-size: 1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modal-close {
      background: transparent;
      border: none;
      color: #fff;
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
      padding: 0 0.25rem;
    }
    .modal-close:hover { background: #333; }
    .modal-close:focus { outline: 3px solid #0055FF; }
    .modal-body {
      padding: 1rem;
    }
    .modal-section {
      margin-bottom: 1rem;
    }
    .modal-section:last-child { margin-bottom: 0; }
    .modal-text {
      font-size: 0.875rem;
      line-height: 1.6;
      margin-bottom: 0.75rem;
    }
    .modal-link {
      color: #0055FF;
      text-decoration: underline;
      font-weight: 600;
    }
    .modal-link:hover { text-decoration: none; }

    /* Chain-specific content */
    .mev-chain-message {
      border: 2px solid #000;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      background: #f0f0f0;
    }
    .mev-chain-message.ethereum { border-color: #0055FF; }
    .mev-chain-message.bsc { border-color: #F0B90B; }
    .mev-chain-message.l2 { border-color: #666; }
    .mev-chain-message.other { border-color: #666; }

    .mev-chain-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }

    /* Add to Wallet Button */
    .add-to-wallet-btn {
      display: block;
      width: 100%;
      margin-top: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.625rem 1rem;
      background: #0055FF;
      color: #fff;
      border: 2px solid #000;
      cursor: pointer;
    }
    .add-to-wallet-btn:hover { background: #0046CC; }
    .add-to-wallet-btn:disabled {
      background: #ccc;
      color: #666;
      cursor: not-allowed;
    }
    .add-to-wallet-btn:focus { outline: 3px solid #0055FF; outline-offset: 0; }

    .wallet-required-note {
      font-size: 0.75rem;
      color: #666;
      font-style: italic;
      margin-top: 0.25rem;
    }

    /* Settings Modal Section */
    .settings-section {
      margin-bottom: 1.25rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #000;
    }
    .settings-section:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
    .settings-section-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid #000;
    }
    .local-tokens-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid #000;
    }
    .local-tokens-header .settings-section-title {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    .settings-placeholder {
      font-size: 0.875rem;
      color: #666;
      font-style: italic;
      padding: 0.5rem;
      background: #f0f0f0;
      border: 1px solid #e0e0e0;
    }

    /* Tokenlist Sources */
    .tokenlist-add-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .tokenlist-add-row input {
      flex: 1;
      min-width: 0;
    }
    .tokenlist-entry {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      margin-bottom: 0.5rem;
      background: #f0f0f0;
    }
    .tokenlist-entry:last-child { margin-bottom: 0; }
    .tokenlist-entry.disabled { opacity: 0.5; background: #f0f0f0; }
    .tokenlist-entry.error { border-color: #CC0000; border-left: 4px solid #CC0000; background: #f0f0f0; }
    .tokenlist-entry-name {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      font-size: 0.875rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tokenlist-entry-count {
      font-size: 0.75rem;
      color: #666;
      white-space: nowrap;
    }
    .tokenlist-entry-error {
      font-size: 0.75rem;
      color: #CC0000;
      font-weight: 600;
      margin-left: 0.25rem;
    }
    .tokenlist-chain-warning {
      font-size: 0.75rem;
      color: #CC7A00;
      font-weight: 600;
      margin-left: 0.25rem;
    }
    .tokenlist-trust-warning {
      background: #f0f0f0;
      border: 2px solid #CC7A00;
      border-left: 4px solid #CC7A00;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      font-size: 0.8125rem;
      line-height: 1.5;
    }
    .tokenlist-trust-warning strong {
      font-weight: 700;
      color: #CC7A00;
    }
    .tokenlist-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      background: #ccc;
      border: 2px solid #000;
      cursor: pointer;
      flex-shrink: 0;
    }
    .tokenlist-toggle::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      width: 14px;
      height: 14px;
      background: #fff;
      border: 1px solid #000;
      transition: transform 0.15s;
    }
    .tokenlist-toggle.on {
      background: #0055FF;
    }
    .tokenlist-toggle.on::after {
      transform: translateX(16px);
    }
    .tokenlist-remove-btn {
      background: transparent;
      border: none;
      color: #666;
      font-size: 1rem;
      padding: 0 0.25rem;
      cursor: pointer;
      line-height: 1;
    }
    .tokenlist-remove-btn:hover { color: #CC0000; }
    .tokenlist-remove-btn:focus { outline: 3px solid #0055FF; }
    .tokenlist-retry-btn {
      font-size: 0.625rem;
      padding: 0.125rem 0.25rem;
      background: #0055FF;
      color: #fff;
      border-color: #0055FF;
    }

    /* Local Token Entry */
    .local-token-entry {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      margin-bottom: 0.5rem;
      background: #f0f0f0;
    }
    .local-token-entry:last-child { margin-bottom: 0; }
    .local-token-symbol {
      font-weight: 700;
      font-size: 0.875rem;
      min-width: 60px;
    }
    .local-token-address {
      font-family: monospace;
      font-size: 0.625rem;
      color: #666;
      flex: 1;
      word-break: break-all;
    }
    .local-token-chain {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.125rem 0.25rem;
      background: #e0e0e0;
      color: #666;
      white-space: nowrap;
    }
    .local-token-remove-btn {
      background: transparent;
      border: none;
      color: #666;
      font-size: 1rem;
      padding: 0 0.25rem;
      cursor: pointer;
      line-height: 1;
    }
    .local-token-remove-btn:hover { color: #CC0000; }
    .local-token-remove-btn:focus { outline: 3px solid #0055FF; }

    /* Local Tokens Actions Row */
    .local-tokens-actions {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .btn-import-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin: 0;
    }
    .btn-import-label input[type="file"] {
      display: none;
    }

    /* Unrecognized Token Popup */
    .unrecognized-token-info {
      border: 2px solid #CC7A00;
      border-left: 4px solid #CC7A00;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      background: #f0f0f0;
    }
    .unrecognized-token-address {
      font-family: monospace;
      font-size: 0.75rem;
      word-break: break-all;
      background: #f0f0f0;
      padding: 0.375rem 0.5rem;
      border: 1px solid #e0e0e0;
      margin-top: 0.5rem;
    }
    .unrecognized-token-loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: #666;
      padding: 0.75rem;
    }
    .unrecognized-token-loading::before {
      content: '';
      width: 16px;
      height: 16px;
      border: 2px solid #e0e0e0;
      border-top-color: #0055FF;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .unrecognized-token-metadata {
      padding: 0.75rem;
      border: 1px solid #e0e0e0;
      background: #f0f0f0;
    }
    .unrecognized-token-field {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.375rem;
    }
    .unrecognized-token-field:last-child { margin-bottom: 0; }
    .unrecognized-token-field-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      min-width: 80px;
    }
    .unrecognized-token-field-value {
      font-size: 0.875rem;
      font-weight: 600;
    }
    .unrecognized-token-error {
      font-size: 0.875rem;
      color: #CC0000;
      font-weight: 600;
      padding: 0.75rem;
      border: 2px solid #CC0000;
      border-left: 4px solid #CC0000;
      background: #f0f0f0;
    }
    .unrecognized-token-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .unrecognized-token-actions .btn-primary {
      flex: 1;
    }
    .unrecognized-token-actions .btn-secondary {
      flex: 1;
    }

    /* Swap Confirmation Modal Actions */
    .swap-confirm-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .swap-confirm-actions .btn-primary {
      flex: 1;
    }
    .swap-confirm-actions .btn-secondary {
      flex: 1;
    }

    /* Source badge in autocomplete */
    .autocomplete-source {
      font-size: 0.5rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.125rem 0.25rem;
      background: #e0e0e0;
      color: #666;
      margin-left: 0.25rem;
    }

    /* Form Row Layout */
    .form-row { display: flex; gap: 1rem; }
    .form-row .form-group { flex: 1; }
    .form-row .form-group.narrow { flex: 0 0 120px; }

    /* Non-collapsible Form Row - stays horizontal even at 375px */
    .form-row-fixed { display: flex; gap: 0.5rem; }
    .form-row-fixed .form-group { flex: 1; min-width: 0; }
    
    /* Buttons - Accent Color: Electric Blue #0055FF (color-blind safe) */
    button {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0.625rem 1rem;
      cursor: pointer;
      border: 2px solid #000;
      background: #fff;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    button:hover { background: #f0f0f0; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    
    .btn-primary {
      background: #0055FF;
      color: #fff;
      border-color: #0055FF;
      min-width: 180px; /* Accommodate "Compare Quotes" (longest label) without resize */
    }
    .btn-primary:hover { background: #0046CC; }
    
    .btn-secondary {
      background: #fff;
      color: #000;
      border-color: #000;
    }
    .btn-secondary:hover { background: #f0f0f0; }

    /* Utility classes for extracted inline styles */
    .mev-button-row {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 2px solid #000;
    }
    .settings-section-title-inline { display: inline; }
    .field-value-compact {
      font-size: 0.625rem;
      word-break: break-all;
    }
    .field-spaced { margin-top: 0.5rem; }
    .reason-box {
      padding: 0.5rem;
      border: 2px solid #000;
      margin-bottom: 0.5rem;
      background: #f0f0f0;
    }
    .reason-box-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .reason-box-content { font-size: 0.875rem; }
    .reason-box-gas {
      font-size: 0.75rem;
      margin-top: 0.25rem;
    }

    /* Action Row - Submit + Compact Slippage */
    .action-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .action-row .btn-primary {
      flex-shrink: 0;
    }
    
    /* Compact Slippage Box - bordered container next to submit */
    .slippage-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.5rem;
      border: 2px solid #000;
      background: #fff;
      flex-wrap: wrap;
    }
    .slippage-box-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      margin-right: 0.25rem;
    }
    /* Preset buttons - pill/toggle style */
    .slippage-box-presets {
      display: flex;
      gap: 0.25rem;
    }
    .slippage-preset-compact {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.375rem 0.5rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      border-radius: 4px;
      cursor: pointer;
      min-width: 28px;
      min-height: 32px;
      text-align: center;
    }
    .slippage-preset-compact:hover { background: #f0f0f0; }
    .slippage-preset-compact.active {
      background: #000;
      color: #fff;
    }
    .slippage-preset-compact:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    /* Custom input - standard text field appearance */
    .slippage-box-input {
      width: 52px;
      padding: 0.375rem 0.5rem;
      font-family: monospace;
      font-size: 0.75rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      border-radius: 0;
      margin-left: 0.25rem;
      min-height: 32px;
    }
    .slippage-box-input:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    .slippage-box-hint {
      font-size: 0.75rem;
      color: #666;
      margin-left: 0.125rem;
    }

    /* Direction Toggle - Sell exact / Buy exact */
    .direction-toggle-row {
      display: flex;
      gap: 0;
      margin-bottom: 0.75rem;
    }
    .direction-btn {
      flex: 1;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.5rem 1rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      cursor: pointer;
    }
    .direction-btn:first-child {
      border-right: none;
    }
    .direction-btn:hover {
      background: #f0f0f0;
    }
    .direction-btn.active {
      background: #000;
      color: #fff;
    }
    .direction-btn:focus {
      outline: 3px solid #0055FF;
      outline-offset: 0;
    }

    /* Target Out Note - provider coverage warning */
    .target-out-note {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      background: #f0f0f0;
      border: 2px solid #CC7A00;
      margin-bottom: 0.75rem;
      font-size: 0.75rem;
      color: #000;
    }
    .target-out-note-icon {
      flex-shrink: 0;
    }

    /* Tokenlist URL Input */
    .tokenlist-url-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .tokenlist-url-row input {
      flex: 1;
      min-width: 0;
    }
    .btn-small {
      font-size: 0.75rem;
      padding: 0.375rem 0.625rem;
      white-space: nowrap;
      min-width: 70px; /* Accommodate "Loading..." without resize */
    }
    .tokenlist-message {
      font-size: 0.75rem;
      margin-top: 0.25rem;
      min-height: 1rem;
    }
    .tokenlist-message.error { color: #CC0000; font-weight: 600; }
    .tokenlist-message.success { color: #007700; }
    .tokenlist-message.loading { color: #666; font-style: italic; }

    /* Wallet Section - Integrated into form flow (no extra border/section) */
    .wallet-group {
      margin-bottom: 0.75rem;
    }
    .wallet-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .wallet-status {
      font-size: 0.875rem;
      font-weight: 600;
    }
    .wallet-address { font-family: monospace; font-size: 0.75rem; padding-left: 0.375rem; border-left: 4px solid #0055FF; word-break: break-all; }
    .wallet-connected-row { gap: 0.5rem; }
    .btn-disconnect {
      font-size: 0.75rem;
      padding: 0.375rem 0.625rem; /* Match .btn-small for consistent small button sizing */
    }
    .wallet-message {
      font-size: 0.75rem;
      font-style: italic;
      margin-top: 0.25rem;
    }
    .wallet-message.error { color: #000; font-weight: 600; }
    .wallet-provider-menu {
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 200px;
      max-height: 300px;
      overflow-y: auto;
      background: #fff;
      border: 2px solid #000;
      z-index: 100;
      margin-top: 0.25rem;
    }
    .wallet-provider-option {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      text-align: left;
      background: #fff;
      color: #000;
      border: none;
      border-bottom: 1px solid #000;
      padding: 0.5rem;
      font-size: 0.875rem;
      text-transform: none;
      letter-spacing: normal;
    }
    .wallet-provider-option:last-child { border-bottom: none; }
    .wallet-provider-option:hover { background: #f0f0f0; }
    .wallet-provider-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wallet-provider-icon, .wallet-connected-icon {
      width: 18px;
      height: 18px;
      object-fit: cover;
      background: #e0e0e0;
      flex-shrink: 0;
    }
    
    /* Chain Selector Dropdown (searchable) */
    .chain-dropdown {
      position: absolute;
      z-index: 60;
      background: #fff;
      border: 2px solid #000;
      border-top: none;
      max-height: 240px;
      overflow-y: auto;
      min-width: 200px;
      width: max-content;
      max-width: 350px;
      display: none;
    }
    .chain-dropdown.show { display: block; }
    .chain-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      cursor: pointer;
      border-bottom: 1px solid #e0e0e0;
    }
    .chain-item:last-child { border-bottom: none; }
    .chain-item:hover, .chain-item.active { background: #f0f0f0; }
    .chain-item.current-selection {
      background: #e8f4e8;
      border-left: 4px solid #22c55e;
      font-weight: 700;
    }
    .chain-item.current-selection .chain-item-name { font-weight: 700; }
    .chain-item-name { font-weight: 600; font-size: 0.875rem; }
    .chain-item-id { font-family: monospace; color: #666; font-size: 0.75rem; }
    .chain-item-empty {
      padding: 0.5rem;
      color: #666;
      font-style: italic;
      font-size: 0.875rem;
    }

    /* Autocomplete */
    .autocomplete-list {
      position: absolute;
      z-index: 50;
      background: #fff;
      border: 2px solid #000;
      border-top: none;
      max-height: 240px;
      overflow-y: auto;
      min-width: 320px;
      width: max-content;
      max-width: 450px;
      display: none;
    }
    .autocomplete-list.show { display: block; }
    .autocomplete-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.5rem;
      cursor: pointer;
      border-bottom: 1px solid #e0e0e0;
    }
    .autocomplete-item:last-child { border-bottom: none; }
    .autocomplete-item:hover, .autocomplete-item.active { background: #f0f0f0; }

    /* Token Balance Display */
    .token-balance {
      font-family: monospace;
      font-size: 0.75rem;
      color: #666;
      margin-top: 0.25rem;
      padding-left: 0.25rem;
    }
    .autocomplete-logo {
      width: 18px;
      height: 18px;
      object-fit: cover;
      background: #e0e0e0;
      flex-shrink: 0;
    }

    /* Token Input Wrapper - for icon display */
    .token-input-wrapper {
      position: relative;
      width: 100%;
    }
    .token-input-wrapper input {
      width: 100%;
      padding-left: 1.75rem; /* Make room for 18px icon + 6px margin */
    }
    .token-input-wrapper.no-icon input {
      padding-left: 0.5rem; /* Standard padding when no icon */
    }
    .token-input-icon {
      position: absolute;
      left: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      object-fit: cover;
      background: #e0e0e0;
      border-radius: 50%;
      pointer-events: none; /* Don't interfere with input clicks */
    }
    .token-input-wrapper.no-icon .token-input-icon {
      display: none;
    }

    /* Result Token Icon - small icon next to token symbols in results */
    .result-token-icon {
      width: 16px;
      height: 16px;
      object-fit: cover;
      background: #e0e0e0;
      border-radius: 50%;
      vertical-align: middle;
      margin-right: 0.25rem;
      flex-shrink: 0;
    }

    .autocomplete-meta { min-width: 0; flex: 1; }
    .autocomplete-title { display: flex; align-items: baseline; gap: 0.25rem; }
    .autocomplete-symbol { font-weight: 600; font-size: 0.875rem; }
    .autocomplete-name { color: #666; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .autocomplete-addr { font-family: monospace; color: #666; font-size: 0.625rem; word-break: break-all; }
    
    /* Results Section - Inline below form */
    #result { display: none; }
    #result.show { display: block; }
    
    /* Primary Result - Output Amount + Actions Inline */
    .result-primary {
      border: 2px solid #000;
      border-left-width: 4px;
      padding: 1rem;
      margin-bottom: 0.5rem;
      background: #fff;
    }
    .result-primary.winner { border-left-color: #0055FF; }
    .result-primary.alternative { border-left-color: #CC2900; }
    .result-output {
      font-size: 2rem;
      font-weight: 700;
      font-family: monospace;
      margin-bottom: 0.5rem;
      letter-spacing: -0.02em;
    }
    .result-output-label {
      font-size: 0.625rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #666;
      margin-bottom: 0.125rem;
    }
    /* Flat label style for recommendation badges - not button-like */
    .result-recommendation {
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-bottom: 0.5rem;
      padding: 0;
      display: inline-block;
      border: none;
      border-bottom: 2px solid;
    }
    .result-recommendation.winner { color: #0055FF; border-bottom-color: #0055FF; }
    .result-recommendation.alternative { color: #CC2900; border-bottom-color: #CC2900; }
    
    /* Transaction Buttons - Step Indicator Pattern */
    .tx-actions { margin-top: 1rem; padding-top: 0.75rem; border-top: 2px solid #000; }
    .tx-steps { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
    .tx-step {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .tx-step-num {
      font-size: 0.625rem;
      font-weight: 700;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .tx-btn {
      font-size: 0.875rem;
      padding: 0.625rem 1rem;
      border: 2px solid #000;
      background: #fff;
      color: #000;
      cursor: pointer;
      min-width: 100px; /* Accommodate "Approved ✓" without resize */
    }
    .tx-btn.swap-btn { background: #0055FF; color: #fff; border-color: #0055FF; }
    .tx-btn.swap-btn:hover { background: #0046CC; }
    .tx-btn.approve-btn { background: #0055FF; color: #fff; border-color: #0055FF; }
    .tx-btn.approve-btn:hover { background: #0046CC; }
    .tx-btn.approved { background: #007700; color: #fff; border-color: #007700; cursor: default; }
    .tx-btn.approved:hover { background: #007700; }
    .tx-btn.disabled, .tx-btn.wallet-required {
      opacity: 0.4;
      cursor: not-allowed;
      background: #e0e0e0;
      color: #666;
      border-color: #666;
    }
    .tx-btn.disabled:hover, .tx-btn.wallet-required:hover { background: #e0e0e0; }
    .tx-checkmark {
      font-size: 0.875rem;
      color: #007700;
      margin-left: 0.25rem;
      font-weight: 700;
    }
    .tx-status {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    /* Status uses text + weight, not just color */
    .tx-status.pending::before { content: "PENDING: "; }
    .tx-status.success::before { content: "SUCCESS: "; }
    .tx-status.error::before { content: "FAILED: "; }
    .tx-status.pending { color: #666; }
    .tx-status.success { color: #007700; background: #f0f0f0; padding: 0.125rem 0.25rem; }
    .tx-status.error { color: #CC0000; background: #f0f0f0; padding: 0.125rem 0.25rem; border: 1px solid #CC0000; }
    
    /* Tabs - Compact */
    .tabs {
      display: flex;
      border: 2px solid #000;
      border-bottom: none;
    }
    .tab {
      flex: 1;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #fff;
      color: #666;
      border: none;
      border-right: 2px solid #000;
      cursor: pointer;
    }
    .tab:last-child { border-right: none; }
    .tab.active { background: #000; color: #fff; border-bottom: 3px solid #0055FF; }
    .tab.active[data-tab="alternative"] { border-bottom-color: #CC2900; }
    .tab:hover:not(.active) { background: #f0f0f0; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    /* Secondary Details - Collapsible */
    .details-toggle {
      width: 100%;
      text-align: left;
      padding: 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #f0f0f0;
      border: 2px solid #000;
      border-top: none;
      cursor: pointer;
    }
    .details-toggle:hover { background: #e0e0e0; }
    .details-toggle::after { content: " [+]"; font-family: monospace; }
    .details-toggle.open::after { content: " [-]"; }
    .details-content {
      display: none;
      border: 2px solid #000;
      border-top: none;
      padding: 0.75rem;
      background: #f0f0f0;
    }
    .details-content.open { display: block; }
    
    /* Field Display */
    .field { margin-bottom: 0.5rem; }
    .field-label {
      font-size: 0.625rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #666;
      margin-bottom: 0.125rem;
    }
    .field-value {
      font-family: monospace;
      font-size: 0.75rem;
      word-break: break-all;
    }
    .field-value.number { font-weight: 600; }
    
    /* Route Steps */
    .route-step {
      border: 1px solid #000;
      padding: 0.5rem;
      margin: 0.5rem 0;
      background: #fff;
    }
    .route-step-header { font-weight: 600; font-size: 0.75rem; margin-bottom: 0.25rem; }
    
    /* Refresh Indicator - Subtle */
    .refresh-indicator {
      font-size: 0.625rem;
      color: #666;
      padding: 0.25rem 0.5rem;
      border: 1px solid #e0e0e0;
      border-left: 4px solid #0055FF;
      background: #f0f0f0;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .refresh-indicator-status { font-style: italic; }
    .refresh-indicator-status.error { color: #CC0000; font-weight: 600; font-style: normal; }
    
    /* Error Display */
    .error-message {
      border: 2px solid #000;
      padding: 0.75rem;
      background: #f0f0f0;
      font-weight: 600;
    }

    /* Copyable Token Reference in error messages */
    .token-ref {
      display: inline-flex;
      align-items: center;
      gap: 0.125rem;
      font-family: monospace;
      font-weight: 600;
      color: #0055FF;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
    }
    .token-ref:hover {
      color: #0046CC;
    }
    .token-ref:focus {
      outline: 2px solid #0055FF;
      outline-offset: 1px;
    }
    .token-ref.copied {
      color: #007700;
    }
    .token-ref .copied-feedback {
      position: absolute;
      background: #007700;
      color: #fff;
      padding: 0.125rem 0.375rem;
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid #000;
      white-space: nowrap;
      margin-left: 0.25rem;
      animation: fadeOut 1.5s forwards;
    }
    @keyframes fadeOut {
      0% { opacity: 1; }
      70% { opacity: 1; }
      100% { opacity: 0; }
    }
    
    /* Responsive */
    @media (max-width: 600px) {
      .form-row { flex-direction: column; }
      .form-row .form-group.narrow { flex: 1; }
      /* Note: .form-row-fixed does NOT collapse - stays horizontal at all widths */
    }

    /* Farcaster miniapp viewport (424x695px) */
    @media (max-width: 424px) {
      /* Ensure settings modal fits within narrow viewport */
      .modal { max-width: 100%; margin: 0 0.5rem; }
      .modal-body { padding: 0.75rem; }
      /* Ensure autocomplete dropdowns don't overflow */
      .autocomplete-list { max-width: 100%; min-width: 0; width: 100%; }
      .chain-dropdown { max-width: 100%; min-width: 0; width: 100%; }
    }

    /* Mobile-first touch targets (44px minimum) */
    @media (max-width: 600px) {
      /* All buttons need adequate touch targets */
      button {
        min-height: 44px;
      }
      .btn-small, .btn-disconnect {
        min-height: 44px;
      }
      /* Direction toggle buttons */
      .direction-btn {
        min-height: 44px;
      }
      /* Dropdown items need adequate touch targets */
      .chain-item {
        padding: 0.75rem 0.5rem;
        min-height: 44px;
      }
      .autocomplete-item {
        padding: 0.75rem 0.5rem;
        min-height: 44px;
      }
      /* Wallet provider menu items */
      .wallet-provider-option {
        padding: 0.75rem 0.5rem;
        min-height: 44px;
      }
      /* Slippage presets and input */
      .slippage-preset-compact {
        min-height: 44px;
        min-width: 44px;
      }
      .slippage-box-input {
        min-height: 44px;
      }
    }

    /* Extra-small viewport (375px) - ensure no horizontal overflow */
    @media (max-width: 375px) {
      /* Reduce body padding to maximize usable space */
      body { padding: 12px; }
      /* Slippage area mobile - ensure no overflow */
      /* Hide outer presets at 375px to fit within viewport while maintaining 44px touch targets */
      .slippage-box {
        gap: 0.25rem;
        padding: 0.25rem 0.375rem;
      }
      .slippage-preset-compact {
        min-width: 44px;
        min-height: 44px;
        padding: 0.5rem 0.375rem;
        font-size: 0.75rem; /* VAL-CSS-001: >= 0.75rem */
      }
      /* Hide outer preset buttons (3 and 300) at 375px to prevent overflow */
      .slippage-preset-compact[data-bps="3"],
      .slippage-preset-compact[data-bps="300"] {
        display: none;
      }
      .slippage-box-input {
        width: 50px;
        min-height: 44px;
        font-size: 0.75rem; /* VAL-CSS-001: >= 0.75rem */
      }
      .slippage-box-label {
        font-size: 0.75rem; /* VAL-CSS-001: >= 0.75rem */
      }
      .slippage-box-hint {
        font-size: 0.75rem; /* VAL-CSS-001: >= 0.75rem */
      }
      /* Prevent form elements from causing overflow */
      input, select {
        font-size: 1rem; /* Prevent iOS zoom on focus */
        min-height: 44px; /* VAL-CSS-005: touch targets >= 44px */
      }
      /* Primary button should be full width on very small screens */
      .action-row {
        flex-direction: column;
        align-items: stretch;
      }
      .action-row .btn-primary {
        width: 100%;
        min-width: 0;
      }
      /* Direction toggle - keep readable font at 0.75rem */
      .direction-btn {
        font-size: 0.75rem;
        padding: 0.5rem 0.5rem;
      }
    }
  </style>
</head>
<body>
  <!-- Page Header: Title + Settings Gear -->
  <div class="page-header">
    <h1>Compare DEX Routers</h1>
    <button type="button" id="settingsBtn" class="settings-btn" aria-label="Open settings" aria-haspopup="dialog" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </button>
  </div>
  
  <!-- Wallet Section - Inline with trading flow -->
  <form id="form">
    <!-- Row 1: Chain Selector (searchable dropdown) -->
    <div class="form-header-row">
      <div class="form-group">
        <label for="chainId">Chain</label>
        <input type="text" id="chainId" placeholder="Search chain name or ID..." autocomplete="off" data-chain-id="8453" value="Base (8453)" role="combobox" aria-expanded="false" aria-controls="chainDropdown" aria-haspopup="listbox">
        <div class="chain-dropdown" id="chainDropdown" role="listbox"></div>
      </div>
    </div>
    <!-- Row 2: Wallet (integrated into form flow) -->
    <div class="form-group wallet-group">
      <div class="wallet-row">
        <button type="button" id="connectWalletBtn" class="btn-primary">Connect Wallet</button>
        <div id="walletConnected" class="wallet-row wallet-connected-row" hidden>
          <img id="walletConnectedIcon" class="wallet-connected-icon" alt="" hidden>
          <span id="walletConnectedName" class="wallet-status"></span>
          <span id="walletConnectedAddress" class="wallet-address"></span>
          <button type="button" id="disconnectWalletBtn" class="btn-disconnect">Disconnect</button>
        </div>
      </div>
      <div id="walletProviderMenu" class="wallet-provider-menu" hidden></div>
      <div id="walletMessage" class="wallet-message" aria-live="polite"></div>
    </div>
    <!-- Row 3: From Token -->
    <div class="form-group">
      <label for="from">From Token</label>
      <div class="token-input-wrapper no-icon" id="fromWrapper">
        <img class="token-input-icon" id="fromIcon" alt="" src="">
        <input type="text" id="from" placeholder="Search symbol/name or enter address" autocomplete="off">
      </div>
      <div class="autocomplete-list" id="fromAutocomplete"></div>
      <div id="fromBalance" class="token-balance" hidden></div>
    </div>
    <!-- Row 4: To Token -->
    <div class="form-group">
      <label for="to">To Token</label>
      <div class="token-input-wrapper no-icon" id="toWrapper">
        <img class="token-input-icon" id="toIcon" alt="" src="">
        <input type="text" id="to" placeholder="Search symbol/name or enter address" autocomplete="off">
      </div>
      <div class="autocomplete-list" id="toAutocomplete"></div>
      <div id="toBalance" class="token-balance" hidden></div>
    </div>
    <!-- Row 5: Direction Toggle -->
    <div class="direction-toggle-row">
      <button type="button" id="directionExactIn" class="direction-btn active" aria-pressed="true">
        Sell exact
      </button>
      <button type="button" id="directionTargetOut" class="direction-btn" aria-pressed="false">
        Buy exact
      </button>
    </div>
    <div id="targetOutNote" class="target-out-note" hidden>
      <span class="target-out-note-icon">⚠️</span>
      <span>Fewer providers support reverse quotes (3/7 Spandex providers)</span>
    </div>
    <!-- Row 6: Amount (full-width for 20+ digit numbers) -->
    <div class="form-group">
      <label for="amount">Amount</label>
      <input type="text" id="amount" value="1">
    </div>
    <!-- Row 7: Action Row with Submit + Compact Slippage -->
    <div class="action-row">
      <button type="submit" id="submit" class="btn-primary">Compare Quotes</button>
      <div class="slippage-box">
        <span class="slippage-box-label">Slippage</span>
        <div class="slippage-box-presets">
          <button type="button" class="slippage-preset-compact" data-bps="3">3</button>
          <button type="button" class="slippage-preset-compact" data-bps="10">10</button>
          <button type="button" class="slippage-preset-compact active" data-bps="50">50</button>
          <button type="button" class="slippage-preset-compact" data-bps="100">100</button>
          <button type="button" class="slippage-preset-compact" data-bps="300">300</button>
        </div>
        <input type="text" id="slippageBps" class="slippage-box-input" value="50" aria-label="Slippage (bps)">
        <span class="slippage-box-hint">bps</span>
      </div>
    </div>
  </form>

  <div id="result">
    <div id="refreshIndicator" class="refresh-indicator" hidden>
      <span id="refreshCountdown">Auto-refresh in 15s</span>
      <span id="refreshStatus" class="refresh-indicator-status" aria-live="polite"></span>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="recommended" id="tabRecommended">Recommended</button>
      <button class="tab" data-tab="alternative" id="tabAlternative">Alternative</button>
    </div>
    <div class="tab-content active" id="recommendedContent"></div>
    <div class="tab-content" id="alternativeContent"></div>
    <!-- MEV Protection info button - positioned near swap action area -->
    <div class="mev-button-row">
      <button type="button" id="mevInfoBtn" class="mev-info-btn" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        MEV Protection
      </button>
    </div>
  </div>

  <!-- MEV Protection Modal -->
  <div id="mevModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="mevModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h2 id="mevModalTitle" class="modal-title">MEV Protection</h2>
        <button type="button" id="mevModalClose" class="modal-close" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <p class="modal-text">
            <strong>MEV (Maximal Extractable Value)</strong> means bots can see your pending swap and front-run it, sandwiching your trade to profit at your expense. A protected RPC sends your transaction directly to block builders, bypassing the public mempool.
          </p>
          <p class="modal-text">
            <a href="https://docs.flashbots.net/flashbots-protect/overview" target="_blank" rel="noopener noreferrer" class="modal-link">Learn more at Flashbots Docs →</a>
          </p>
        </div>
        <div id="mevChainContent" class="modal-section">
          <!-- Chain-specific content rendered by JS -->
        </div>
      </div>
    </div>
  </div>

  <!-- Settings Modal -->
  <div id="settingsModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h2 id="settingsModalTitle" class="modal-title">Settings</h2>
        <button type="button" id="settingsModalClose" class="modal-close" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <!-- Tokenlist Sources Section -->
        <div class="settings-section">
          <div class="settings-section-title">Tokenlist Sources</div>
          <div class="tokenlist-trust-warning">
            <strong>⚠️ Only load tokenlists from trusted sources.</strong> Malicious tokenlists can contain fake token addresses (e.g., a fake USDC) that could trick you into sending funds to scammers.
          </div>
          <div class="tokenlist-add-row">
            <input type="text" id="tokenlistUrlInput" placeholder="https://tokens.uniswap.org">
            <button type="button" id="addTokenlistBtn" class="btn-small">Load</button>
          </div>
          <div id="tokenlistMessage" class="tokenlist-message" aria-live="polite"></div>
          <div id="tokenlistSourcesList">
            <!-- Tokenlist entries rendered by JS -->
          </div>
        </div>
        </div>
        <!-- Local Tokens Section -->
        <div class="settings-section">
          <div class="local-tokens-header">
            <div class="settings-section-title settings-section-title-inline">Local Tokens</div>
            <div id="localTokensToggle" class="tokenlist-toggle on" role="switch" aria-checked="true" aria-label="Toggle local tokens" tabindex="0"></div>
          </div>
          <div class="local-tokens-actions">
            <button type="button" id="exportLocalTokensBtn" class="btn-small" disabled>Export Tokenlist</button>
            <label class="btn-small btn-import-label">
              Import Tokenlist
              <input type="file" id="importLocalTokensInput" accept=".json" hidden>
            </label>
          </div>
          <div id="localTokensMessage" class="tokenlist-message" aria-live="polite"></div>
          <div id="localTokensContent">
            <!-- Local tokens rendered by JS -->
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Unrecognized Token Modal -->
  <div id="unrecognizedTokenModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="unrecognizedTokenModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h2 id="unrecognizedTokenModalTitle" class="modal-title">Unrecognized Token</h2>
        <button type="button" id="unrecognizedTokenModalClose" class="modal-close" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="unrecognized-token-info">
          <p class="modal-text">This token address is not in any of your enabled tokenlists. Fetching metadata from the blockchain...</p>
          <div id="unrecognizedTokenAddress" class="unrecognized-token-address"></div>
        </div>
        <div id="unrecognizedTokenLoading" class="unrecognized-token-loading">
          Fetching token metadata...
        </div>
        <div id="unrecognizedTokenMetadata" class="unrecognized-token-metadata" hidden>
          <div class="unrecognized-token-field">
            <span class="unrecognized-token-field-label">Name</span>
            <span id="unrecognizedTokenName" class="unrecognized-token-field-value"></span>
          </div>
          <div class="unrecognized-token-field">
            <span class="unrecognized-token-field-label">Symbol</span>
            <span id="unrecognizedTokenSymbol" class="unrecognized-token-field-value"></span>
          </div>
          <div class="unrecognized-token-field">
            <span class="unrecognized-token-field-label">Decimals</span>
            <span id="unrecognizedTokenDecimals" class="unrecognized-token-field-value"></span>
          </div>
        </div>
        <div id="unrecognizedTokenError" class="unrecognized-token-error" hidden></div>
        <div class="unrecognized-token-actions">
          <button type="button" id="unrecognizedTokenCancelBtn" class="btn-secondary">Cancel</button>
          <button type="button" id="unrecognizedTokenSaveBtn" class="btn-primary" disabled>Save to Local List</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Swap Confirmation Modal (appears when clicking Swap while quotes still loading) -->
  <div id="swapConfirmModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="swapConfirmModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h2 id="swapConfirmModalTitle" class="modal-title">Confirm Swap</h2>
        <button type="button" id="swapConfirmModalClose" class="modal-close" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <p class="modal-text" id="swapConfirmModalText">
            <strong>Another quote is still loading.</strong> A better price may arrive soon.
          </p>
        </div>
        <div class="swap-confirm-actions">
          <button type="button" id="swapConfirmWaitBtn" class="btn-secondary">Wait</button>
          <button type="button" id="swapConfirmProceedBtn" class="btn-primary">Swap Anyway</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const DEFAULT_TOKENS = ${JSON.stringify(DEFAULT_TOKENS)};
    const DEFAULT_TOKENLIST_NAME = 'Default Tokenlist';

    // Multi-tokenlist data model:
    // - tokenlistSources: array of {url, enabled, name, tokens, error?}
    // - Each token in tokens array has _source field
    let tokenlistSources = [];
    // Legacy single-tokenlist URL key (for migration)
    const OLD_CUSTOM_TOKENLIST_URL_KEY = 'customTokenlistUrl';
    // New multi-tokenlist storage key
    const CUSTOM_TOKENLISTS_KEY = 'customTokenlists';
    // Default tokenlist enabled state (stored separately since default is not in customTokenlists)
    const DEFAULT_TOKENLIST_ENABLED_KEY = 'defaultTokenlistEnabled';
    // Local tokenlist key - stores user-saved tokens in Uniswap tokenlist format
    const LOCAL_TOKEN_LIST_KEY = 'localTokenList';
    const LOCAL_TOKENS_SOURCE_NAME = 'Local Tokens';
    // Local tokens enabled state (toggle in settings panel)
    const LOCAL_TOKENS_ENABLED_KEY = 'localTokensEnabled';
    // User preferences key - stores form selections (chain, tokens, amount, slippage)
    const USER_PREFERENCES_KEY = 'flashprofits-preferences';

    const walletProvidersByUuid = new Map();
    let fallbackWalletProvider = null;
    let connectedWalletProvider = null;
    let connectedWalletAddressValue = '';
    let connectedWalletInfo = null;
    // Post-connect callback for auto-approve/auto-swap flow
    let pendingPostConnectAction = null; // null | { type: 'approve' | 'swap', card: HTMLElement, button?: HTMLButtonElement }
    let isConnectingProvider = false; // flag to distinguish menu close vs cancel
    let currentQuoteChainId = null;
    const AUTO_REFRESH_SECONDS = 15;
    const autoRefreshState = {
      timerId: null,
      secondsRemaining: AUTO_REFRESH_SECONDS,
      lastParams: null,
      paused: false,
      inFlight: false,
      errorMessage: '',
    };
    // Chains where Curve is supported - used to determine single-router mode upfront
    const CURVE_SUPPORTED_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114];
    let compareRequestSequence = 0;
    let currentEventSource = null; // Track in-progress SSE connection
    let progressiveQuoteState = {
      spandex: null,
      spandexError: null,
      curve: null,
      curveError: null,
      recommendation: null,
      recommendationReason: null,
      gasPriceGwei: null,
      outputToEthRate: null,
      inputToEthRate: null,
      mode: null,
      complete: false,
      singleRouterMode: false,
    };

    // Reset progressive quote state for new comparison
    function resetProgressiveQuoteState(singleRouterMode = false) {
      progressiveQuoteState = {
        spandex: null,
        spandexError: null,
        curve: null,
        curveError: null,
        recommendation: null,
        recommendationReason: null,
        gasPriceGwei: null,
        outputToEthRate: null,
        inputToEthRate: null,
        mode: null,
        complete: false,
        singleRouterMode: singleRouterMode,
      };
    }

    // Cancel any in-progress EventSource
    function cancelInProgressEventSource() {
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
    }

    // Show loading state in results area
    function showProgressiveLoadingState() {
      result.className = 'show';
      recommendedContent.innerHTML = '<div class="result-header">Querying Spandex + Curve for best price...</div>';
      tabRecommended.textContent = 'Loading...';
      tabAlternative.style.display = '';
      alternativeContent.innerHTML = '<div class="result-header loading-indicator">Waiting for quotes...</div>';
      tabAlternative.textContent = 'Loading...';
      setActiveTab('recommended');
    }

    // Render a single quote in progressive mode (without recommendation info yet)
    function renderProgressiveQuote(router, data, quoteChainId, gasPriceGwei) {
      if (router === 'spandex') {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = renderSpandexQuote(data, false, quoteChainId, gasPriceGwei);
      } else if (router === 'curve') {
        tabAlternative.textContent = 'Curve';
        tabAlternative.style.display = '';
        alternativeContent.innerHTML = renderCurveQuote(data, false, quoteChainId, gasPriceGwei);
      }
      result.className = 'show';
    }

    // Render a single error in progressive mode
    function renderProgressiveError(router, error, quoteChainId) {
      const errorHtml = '<div class="error-message">' + formatErrorWithTokenRefs(error, quoteChainId) + '</div>';
      if (router === 'spandex') {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = errorHtml;
      } else if (router === 'curve') {
        tabAlternative.textContent = 'Curve';
        tabAlternative.style.display = '';
        alternativeContent.innerHTML = errorHtml;
      }
      result.className = 'show';
    }

    // Update UI with recommendation after both quotes arrived
    function showProgressiveRecommendation(data, quoteChainId) {
      const { recommendation, recommendation_reason, gas_price_gwei, output_to_eth_rate, input_to_eth_rate } = data;

      // Build reason box
      let reasonHtml = '<div class="reason-box">';
      reasonHtml += '<div class="reason-box-title">Reason</div>';
      reasonHtml += '<div class="reason-box-content">' + recommendation_reason + '</div>';
      if (gas_price_gwei) {
        reasonHtml += '<div class="field-value number reason-box-gas">Gas Price: ' + gas_price_gwei + ' gwei</div>';
      }
      if (output_to_eth_rate) {
        const outputSymbol = (progressiveQuoteState.spandex && progressiveQuoteState.spandex.to_symbol) ||
                             (progressiveQuoteState.curve && progressiveQuoteState.curve.to_symbol) || 'token';
        reasonHtml += '<div class="field-value number reason-box-gas">Rate: 1 ' + outputSymbol + ' = ' + output_to_eth_rate + ' ETH</div>';
      }
      reasonHtml += '</div>';

      // Re-render with recommendation
      if (recommendation === 'spandex' && progressiveQuoteState.spandex) {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(progressiveQuoteState.spandex, true, quoteChainId, gas_price_gwei);
        if (progressiveQuoteState.curve) {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderCurveQuote(progressiveQuoteState.curve, false, quoteChainId, gas_price_gwei);
        } else if (progressiveQuoteState.curveError) {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(progressiveQuoteState.curveError, quoteChainId) + '</div>';
        }
      } else if (recommendation === 'curve' && progressiveQuoteState.curve) {
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(progressiveQuoteState.curve, true, quoteChainId, gas_price_gwei);
        if (progressiveQuoteState.spandex) {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderSpandexQuote(progressiveQuoteState.spandex, false, quoteChainId, gas_price_gwei);
        } else if (progressiveQuoteState.spandexError) {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(progressiveQuoteState.spandexError, quoteChainId) + '</div>';
        }
      } else if (progressiveQuoteState.spandex) {
        // Only spandex available
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(progressiveQuoteState.spandex, false, quoteChainId, gas_price_gwei);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else if (progressiveQuoteState.curve) {
        // Only curve available
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(progressiveQuoteState.curve, false, quoteChainId, gas_price_gwei);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else {
        // Both failed
        const combinedError = 'No quotes available. ' +
          (progressiveQuoteState.spandexError ? 'Spandex: ' + progressiveQuoteState.spandexError + '. ' : '') +
          (progressiveQuoteState.curveError ? 'Curve: ' + progressiveQuoteState.curveError : '');
        tabRecommended.textContent = 'Results';
        recommendedContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(combinedError, quoteChainId) + '</div>';
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      }

      setActiveTab('recommended');
      updateTransactionActionStates();
      updateRefreshIndicator();
    }

    // Fetch and render quotes progressively via SSE
    async function fetchAndRenderCompareProgressive(compareParams, options = {}) {
      const normalizedParams = cloneCompareParams(compareParams);
      const showLoading = options.showLoading === true;
      const preserveUiState = options.preserveUiState === true;
      const updateUrl = options.updateUrl !== false;
      const requestId = Number.isFinite(options.requestId) ? Number(options.requestId) : ++compareRequestSequence;

      if (requestId > compareRequestSequence) {
        compareRequestSequence = requestId;
      }

      currentQuoteChainId = Number(normalizedParams.chainId);

      // Cancel any in-progress EventSource
      cancelInProgressEventSource();

      // Determine single-router mode upfront based on Curve support for this chain
      const isSingleRouterChain = !CURVE_SUPPORTED_CHAINS.includes(currentQuoteChainId);

      // Reset progressive state with pre-computed single-router mode
      resetProgressiveQuoteState(isSingleRouterChain);

      if (showLoading) {
        submit.disabled = true;
        submit.textContent = 'Comparing...';
        showProgressiveLoadingState();
      }

      const query = compareParamsToSearchParams(normalizedParams);
      const eventSource = new EventSource('/compare-stream?' + query.toString());
      currentEventSource = eventSource;

      const quoteChainId = currentQuoteChainId;

      return new Promise((resolve) => {
        let resolved = false;

        const cleanup = () => {
          if (eventSource === currentEventSource) {
            currentEventSource = null;
          }
          eventSource.close();
        };

        const checkStale = () => {
          if (requestId !== compareRequestSequence) {
            cleanup();
            if (!resolved) {
              resolved = true;
              resolve({ ok: false, stale: true, params: normalizedParams });
            }
            return true;
          }
          return false;
        };

        eventSource.addEventListener('quote', (event) => {
          if (checkStale()) return;

          try {
            const payload = JSON.parse(event.data);
            const router = payload.router;
            const data = payload.data;

            if (router === 'spandex') {
              progressiveQuoteState.spandex = data;
            } else if (router === 'curve') {
              progressiveQuoteState.curve = data;
            }

            // Render this quote immediately
            renderProgressiveQuote(router, data, quoteChainId, progressiveQuoteState.gasPriceGwei);

            // Update swap confirmation modal if open (may change text or auto-dismiss)
            if (swapConfirmModal.classList.contains('show')) {
              updateSwapConfirmModalText();
            }
          } catch (e) {
            console.error('Failed to parse quote event:', e);
          }
        });

        eventSource.addEventListener('error', (event) => {
          if (checkStale()) return;

          try {
            const payload = JSON.parse(event.data);
            const router = payload.router;
            const error = payload.error;

            if (router === 'spandex') {
              progressiveQuoteState.spandexError = error;
              // Show error only if we haven't received a quote yet
              if (!progressiveQuoteState.spandex) {
                renderProgressiveError(router, error, quoteChainId);
              }
            } else if (router === 'curve') {
              progressiveQuoteState.curveError = error;
              // Show error in alternative tab
              tabAlternative.textContent = 'Curve';
              tabAlternative.style.display = '';
              alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(error, quoteChainId) + '</div>';
            } else if (router === 'server') {
              // Server error - show in results
              showError(error);
            }

            // Update swap confirmation modal if open (may change text or auto-dismiss)
            if (swapConfirmModal.classList.contains('show')) {
              updateSwapConfirmModalText();
            }
          } catch (e) {
            console.error('Failed to parse error event:', e);
          }
        });

        eventSource.addEventListener('complete', (event) => {
          if (checkStale()) return;

          try {
            const payload = JSON.parse(event.data);
            progressiveQuoteState.recommendation = payload.recommendation;
            progressiveQuoteState.recommendationReason = payload.recommendation_reason;
            progressiveQuoteState.gasPriceGwei = payload.gas_price_gwei;
            progressiveQuoteState.outputToEthRate = payload.output_to_eth_rate;
            progressiveQuoteState.inputToEthRate = payload.input_to_eth_rate;
            progressiveQuoteState.mode = payload.mode;
            progressiveQuoteState.singleRouterMode = payload.single_router_mode;
            progressiveQuoteState.complete = true;

            // Update swap confirmation modal if open (auto-dismiss if all quotes arrived)
            if (swapConfirmModal.classList.contains('show')) {
              updateSwapConfirmModalText();
            }

            // Update UI with recommendation
            showProgressiveRecommendation(payload, quoteChainId);

            if (updateUrl) {
              updateUrlFromCompareParams(normalizedParams);
            }
            saveUserPreferences(normalizedParams);
          } catch (e) {
            console.error('Failed to parse complete event:', e);
          }
        });

        eventSource.addEventListener('done', () => {
          cleanup();
          if (!resolved) {
            resolved = true;
            if (progressiveQuoteState.spandex || progressiveQuoteState.curve) {
              // Build payload for auto-refresh compatibility
              const payload = {
                spandex: progressiveQuoteState.spandex,
                curve: progressiveQuoteState.curve,
                recommendation: progressiveQuoteState.recommendation,
                recommendation_reason: progressiveQuoteState.recommendationReason,
                gas_price_gwei: progressiveQuoteState.gasPriceGwei,
                output_to_eth_rate: progressiveQuoteState.outputToEthRate,
                input_to_eth_rate: progressiveQuoteState.inputToEthRate,
                mode: progressiveQuoteState.mode,
                single_router_mode: progressiveQuoteState.singleRouterMode,
              };
              resolve({ ok: true, params: normalizedParams, payload });
            } else {
              const errorMsg = progressiveQuoteState.spandexError || progressiveQuoteState.curveError || 'No quotes available';
              resolve({ ok: false, error: errorMsg, params: normalizedParams });
            }
          }
        });

        eventSource.onerror = (err) => {
          cleanup();
          if (!resolved) {
            resolved = true;
            const message = 'Failed to connect to quote stream';
            if (!options.keepExistingResultsOnError) {
              showError(message);
            }
            resolve({ ok: false, error: message, params: normalizedParams });
          }
        };
      }).finally(() => {
        if (showLoading) {
          submit.disabled = false;
          submit.textContent = 'Compare Quotes';
        }
      });
    }

    const CHAIN_ID_HEX_MAP = Object.freeze({
      '1': '0x1',
      '10': '0xa',
      '56': '0x38',
      '137': '0x89',
      '8453': '0x2105',
      '42161': '0xa4b1',
      '43114': '0xa86a',
    });
    const CHAIN_NAMES = Object.freeze({
      '1': 'Ethereum',
      '10': 'Optimism',
      '56': 'BSC',
      '137': 'Polygon',
      '8453': 'Base',
      '42161': 'Arbitrum',
      '43114': 'Avalanche',
    });
    const MAX_UINT256_HEX = 'f'.repeat(64);

    const connectWalletBtn = document.getElementById('connectWalletBtn');
    const walletConnected = document.getElementById('walletConnected');
    const walletConnectedIcon = document.getElementById('walletConnectedIcon');
    const walletConnectedName = document.getElementById('walletConnectedName');
    const walletConnectedAddress = document.getElementById('walletConnectedAddress');
    const disconnectWalletBtn = document.getElementById('disconnectWalletBtn');
    const walletProviderMenu = document.getElementById('walletProviderMenu');
    const walletMessage = document.getElementById('walletMessage');
    const chainIdInput = document.getElementById('chainId');
    const fromInput = document.getElementById('from');
    const toInput = document.getElementById('to');
    const fromWrapper = document.getElementById('fromWrapper');
    const toWrapper = document.getElementById('toWrapper');
    const fromIcon = document.getElementById('fromIcon');
    const toIcon = document.getElementById('toIcon');
    const amountInput = document.getElementById('amount');
    const slippageInput = document.getElementById('slippageBps');
    const slippagePresetBtns = document.querySelectorAll('.slippage-preset-compact');

    // Update token input icon based on token data
    function updateTokenInputIcon(input, icon, wrapper, token) {
      if (token && typeof token.logoURI === 'string' && token.logoURI) {
        icon.src = token.logoURI;
        icon.alt = token.symbol ? token.symbol + ' logo' : 'token logo';
        wrapper.classList.remove('no-icon');
        // Handle image load error gracefully
        icon.onerror = () => {
          wrapper.classList.add('no-icon');
          icon.src = '';
        };
      } else {
        // No logoURI - hide icon
        wrapper.classList.add('no-icon');
        icon.src = '';
      }
    }

    // Clear token input icon
    function clearTokenInputIcon(wrapper, icon) {
      wrapper.classList.add('no-icon');
      icon.src = '';
      icon.alt = '';
    }

    // Update active state on slippage preset buttons
    function updateSlippagePresetActive(value) {
      const bpsValue = String(value || '').trim();
      slippagePresetBtns.forEach((btn) => {
        const btnBps = btn.dataset.bps;
        btn.classList.toggle('active', btnBps === bpsValue);
      });
    }

    // Slippage preset button click handler
    slippagePresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const bps = btn.dataset.bps;
        if (bps) {
          slippageInput.value = bps;
          updateSlippagePresetActive(bps);
        }
      });
    });

    // On custom input, update preset active state
    slippageInput.addEventListener('input', () => {
      updateSlippagePresetActive(slippageInput.value);
    });

    // Direction Toggle - Sell exact (exactIn) / Buy exact (targetOut)
    const directionExactInBtn = document.getElementById('directionExactIn');
    const directionTargetOutBtn = document.getElementById('directionTargetOut');
    const targetOutNote = document.getElementById('targetOutNote');

    // Current mode state: 'exactIn' (default) or 'targetOut'
    let currentQuoteMode = 'exactIn';

    function setDirectionMode(mode) {
      currentQuoteMode = mode;
      const isExactIn = mode === 'exactIn';

      directionExactInBtn.classList.toggle('active', isExactIn);
      directionExactInBtn.setAttribute('aria-pressed', String(isExactIn));

      directionTargetOutBtn.classList.toggle('active', !isExactIn);
      directionTargetOutBtn.setAttribute('aria-pressed', String(!isExactIn));

      // Show/hide the provider note for targetOut mode
      targetOutNote.hidden = isExactIn;
    }

    directionExactInBtn.addEventListener('click', () => {
      setDirectionMode('exactIn');
    });

    directionTargetOutBtn.addEventListener('click', () => {
      setDirectionMode('targetOut');
    });

    // Chain Selector Dropdown (searchable)
    const chainDropdown = document.getElementById('chainDropdown');
    const ALL_CHAINS = [
      { id: '1', name: 'Ethereum' },
      { id: '8453', name: 'Base' },
      { id: '42161', name: 'Arbitrum' },
      { id: '10', name: 'Optimism' },
      { id: '137', name: 'Polygon' },
      { id: '56', name: 'BSC' },
      { id: '43114', name: 'Avalanche' },
    ];
    let chainDropdownActiveIdx = -1;
    let chainDropdownPreviousChainId = null; // Track chain to restore on cancel
    let chainDropdownPinnedChainId = null; // Chain to pin at top when dropdown opens

    function formatChainDisplay(chainId, chainName) {
      const name = chainName || CHAIN_NAMES[chainId] || 'Unknown';
      return name + ' (' + chainId + ')';
    }

    function filterChains(query) {
      const q = String(query || '').toLowerCase().trim();
      if (!q) return ALL_CHAINS;
      return ALL_CHAINS.filter(chain => {
        const nameLower = chain.name.toLowerCase();
        const idStr = chain.id;
        return nameLower.includes(q) || idStr.includes(q);
      });
    }

    function renderChainDropdown(chains, pinnedChainId) {
      chainDropdown.innerHTML = '';
      chainDropdownActiveIdx = -1;

      if (!chains.length && !pinnedChainId) {
        const empty = document.createElement('div');
        empty.className = 'chain-item-empty';
        empty.textContent = 'No chains match';
        chainDropdown.appendChild(empty);
        chainDropdown.classList.add('show');
        chainIdInput.setAttribute('aria-expanded', 'true');
        return;
      }

      const fragment = document.createDocumentFragment();

      // Render pinned chain first if specified
      if (pinnedChainId) {
        const pinnedChain = ALL_CHAINS.find(c => c.id === pinnedChainId);
        if (pinnedChain) {
          const item = document.createElement('div');
          item.className = 'chain-item current-selection';
          item.dataset.chainId = pinnedChain.id;
          item.setAttribute('role', 'option');
          item.setAttribute('id', 'chain-option-' + pinnedChain.id);

          const nameEl = document.createElement('span');
          nameEl.className = 'chain-item-name';
          nameEl.textContent = pinnedChain.name;

          const idEl = document.createElement('span');
          idEl.className = 'chain-item-id';
          idEl.textContent = '(' + pinnedChain.id + ')';

          item.appendChild(nameEl);
          item.appendChild(idEl);

          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectChain(pinnedChain.id, pinnedChain.name);
          });

          fragment.appendChild(item);
        }
      }

      // Render remaining chains (excluding pinned if present)
      chains.forEach((chain, idx) => {
        if (pinnedChainId && chain.id === pinnedChainId) return; // Skip pinned chain in main list

        const item = document.createElement('div');
        item.className = 'chain-item';
        item.dataset.chainId = chain.id;
        item.setAttribute('role', 'option');
        item.setAttribute('id', 'chain-option-' + chain.id);

        const nameEl = document.createElement('span');
        nameEl.className = 'chain-item-name';
        nameEl.textContent = chain.name;

        const idEl = document.createElement('span');
        idEl.className = 'chain-item-id';
        idEl.textContent = '(' + chain.id + ')';

        item.appendChild(nameEl);
        item.appendChild(idEl);

        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectChain(chain.id, chain.name);
        });

        fragment.appendChild(item);
      });

      chainDropdown.appendChild(fragment);
      chainDropdown.classList.add('show');
      chainIdInput.setAttribute('aria-expanded', 'true');
    }

    function setActiveChainItem(index) {
      const items = chainDropdown.querySelectorAll('.chain-item');
      items.forEach((el, i) => {
        el.classList.toggle('active', i === index);
        el.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      if (index >= 0 && items[index]) {
        chainIdInput.setAttribute('aria-activedescendant', items[index].id);
      } else {
        chainIdInput.removeAttribute('aria-activedescendant');
      }
    }

    function selectChain(chainId, chainName) {
      const display = formatChainDisplay(chainId, chainName);
      chainIdInput.value = display;
      chainIdInput.dataset.chainId = chainId;
      // Clear previous/pinned state since we made a valid selection
      chainDropdownPreviousChainId = null;
      chainDropdownPinnedChainId = null;
      hideChainDropdown();
      // Trigger change event for other listeners
      chainIdInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function hideChainDropdown() {
      chainDropdown.classList.remove('show');
      chainDropdown.innerHTML = '';
      chainDropdownActiveIdx = -1;
      chainDropdownPinnedChainId = null;
      chainIdInput.setAttribute('aria-expanded', 'false');
      chainIdInput.removeAttribute('aria-activedescendant');
    }

    function refreshChainDropdown() {
      const query = chainIdInput.value;
      const chains = filterChains(query);
      // When user is typing/filtering, don't pin - just show filtered results
      renderChainDropdown(chains, null);
    }

    // Chain input event handlers
    chainIdInput.addEventListener('focus', () => {
      // Store current chain as the one to restore if user cancels
      const currentChainId = getCurrentChainId();
      chainDropdownPreviousChainId = String(currentChainId);
      // Set current chain as pinned (appears first, highlighted)
      chainDropdownPinnedChainId = String(currentChainId);
      // Clear input for typing
      chainIdInput.value = '';
      // Show all chains with current selection pinned at top
      renderChainDropdown(ALL_CHAINS, chainDropdownPinnedChainId);
    });

    chainIdInput.addEventListener('input', () => {
      // User is typing - clear pinned since we're filtering
      chainDropdownPinnedChainId = null;
      refreshChainDropdown();
    });

    chainIdInput.addEventListener('keydown', (e) => {
      const items = chainDropdown.querySelectorAll('.chain-item');
      const isOpen = chainDropdown.classList.contains('show');

      if (e.key === 'ArrowDown') {
        if (!isOpen) {
          // Mirror the focus handler: track previous, pin current, clear input
          const currentChainId = getCurrentChainId();
          chainDropdownPreviousChainId = String(currentChainId);
          chainDropdownPinnedChainId = String(currentChainId);
          chainIdInput.value = '';
          renderChainDropdown(ALL_CHAINS, chainDropdownPinnedChainId);
          return;
        }
        e.preventDefault();
        chainDropdownActiveIdx = Math.min(chainDropdownActiveIdx + 1, items.length - 1);
        setActiveChainItem(chainDropdownActiveIdx);
      } else if (e.key === 'ArrowUp') {
        if (!isOpen) return;
        e.preventDefault();
        chainDropdownActiveIdx = Math.max(chainDropdownActiveIdx - 1, 0);
        setActiveChainItem(chainDropdownActiveIdx);
      } else if (e.key === 'Enter' && isOpen) {
        e.preventDefault();
        // If user navigated to an item, select it
        if (chainDropdownActiveIdx >= 0 && items[chainDropdownActiveIdx]) {
          const item = items[chainDropdownActiveIdx];
          const chainId = item.dataset.chainId;
          const chainName = item.querySelector('.chain-item-name').textContent;
          selectChain(chainId, chainName);
        } else if (chainDropdownPinnedChainId) {
          // No navigation but have pinned chain - select it
          const pinnedChain = ALL_CHAINS.find(c => c.id === chainDropdownPinnedChainId);
          if (pinnedChain) {
            selectChain(pinnedChain.id, pinnedChain.name);
          }
        } else {
          // No pinned, no navigation - select first from filtered
          const chains = filterChains(chainIdInput.value);
          if (chains.length > 0) {
            selectChain(chains[0].id, chains[0].name);
          }
        }
      } else if (e.key === 'Escape') {
        // Restore previous selection on Escape
        const restoreChainId = chainDropdownPreviousChainId || String(getCurrentChainId());
        chainIdInput.value = formatChainDisplay(restoreChainId, CHAIN_NAMES[restoreChainId]);
        chainDropdownPreviousChainId = null;
        hideChainDropdown();
      } else if (e.key === 'Tab') {
        // On Tab, if typing a partial match, select first match or restore
        const query = chainIdInput.value.trim();
        if (query) {
          const chains = filterChains(query);
          if (chains.length === 1) {
            selectChain(chains[0].id, chains[0].name);
          } else if (chains.length > 1) {
            // Ambiguous - restore previous
            const restoreChainId = chainDropdownPreviousChainId || String(getCurrentChainId());
            chainIdInput.value = formatChainDisplay(restoreChainId, CHAIN_NAMES[restoreChainId]);
            chainDropdownPreviousChainId = null;
          }
        } else {
          // No input - restore previous
          const restoreChainId = chainDropdownPreviousChainId || String(getCurrentChainId());
          chainIdInput.value = formatChainDisplay(restoreChainId, CHAIN_NAMES[restoreChainId]);
          chainDropdownPreviousChainId = null;
        }
        hideChainDropdown();
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('mousedown', (e) => {
      if (e.target === chainIdInput || chainDropdown.contains(e.target)) {
        return;
      }
      // On blur, restore previous selection if input doesn't match a valid chain
      const query = chainIdInput.value.trim().toLowerCase();
      const matchingChains = filterChains(query);
      if (matchingChains.length === 1) {
        // Auto-select if only one match
        selectChain(matchingChains[0].id, matchingChains[0].name);
      } else {
        // Restore previous selection
        const restoreChainId = chainDropdownPreviousChainId || String(getCurrentChainId());
        chainIdInput.value = formatChainDisplay(restoreChainId, CHAIN_NAMES[restoreChainId]);
        chainDropdownPreviousChainId = null;
      }
      hideChainDropdown();
    });

    const mevInfoBtn = document.getElementById('mevInfoBtn');
    const mevModal = document.getElementById('mevModal');
    const mevModalClose = document.getElementById('mevModalClose');
    const mevChainContent = document.getElementById('mevChainContent');
    const refreshIndicator = document.getElementById('refreshIndicator');
    const refreshCountdown = document.getElementById('refreshCountdown');
    const refreshStatus = document.getElementById('refreshStatus');

    // Settings Modal Elements
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const settingsModalClose = document.getElementById('settingsModalClose');

    // Swap Confirmation Modal Elements
    const swapConfirmModal = document.getElementById('swapConfirmModal');
    const swapConfirmModalClose = document.getElementById('swapConfirmModalClose');
    const swapConfirmModalText = document.getElementById('swapConfirmModalText');
    const swapConfirmWaitBtn = document.getElementById('swapConfirmWaitBtn');
    const swapConfirmProceedBtn = document.getElementById('swapConfirmProceedBtn');

    // State for pending swap action (when user clicks "Swap Anyway")
    let pendingSwapCard = null; // HTMLElement - the card to swap

    function hasConnectedWallet() {
      return Boolean(connectedWalletProvider && connectedWalletAddressValue);
    }

    function getChainIdHex(chainId) {
      const id = String(chainId || '').trim();
      if (!id) return '0x0';
      if (CHAIN_ID_HEX_MAP[id]) return CHAIN_ID_HEX_MAP[id];
      const parsed = Number(id);
      if (!Number.isFinite(parsed) || parsed < 0) return '0x0';
      return '0x' + parsed.toString(16);
    }

    function toHexQuantity(value) {
      if (typeof value !== 'string') return '0x0';
      const trimmed = value.trim().toLowerCase();
      if (!trimmed) return '0x0';
      if (trimmed.startsWith('0x')) return trimmed;
      try {
        return '0x' + BigInt(trimmed).toString(16);
      } catch {
        return '0x0';
      }
    }

    function isAddressLike(address) {
      return /^0x[a-fA-F0-9]{40}$/.test(String(address || '').trim());
    }

    function encodeApproveCalldata(spender) {
      const normalizedSpender = String(spender || '').trim();
      if (!isAddressLike(normalizedSpender)) {
        throw new Error('Invalid approval spender address');
      }
      const spenderWord = normalizedSpender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
      return '0x095ea7b3' + spenderWord + MAX_UINT256_HEX;
    }

    function updateTransactionActionStates() {
      const walletConnectedValue = hasConnectedWallet();
      document.querySelectorAll('.tx-btn').forEach((button) => {
        // Skip buttons that are intentionally disabled by step indicator or transaction logic
        // - data-locked: approval already completed, button locked in approved state
        // - data-pending: transaction in flight
        // - .disabled CSS class: step indicator marks swap disabled before approval
        if (
          button.dataset.locked === 'true' ||
          button.dataset.pending === 'true' ||
          button.classList.contains('disabled')
        ) {
          return;
        }

        if (!walletConnectedValue) {
          // Show wallet-required visual state but keep button clickable
          // so clicking triggers auto-connect flow
          button.classList.add('wallet-required');
          // Do NOT set aria-disabled - button should be clickable to trigger wallet connect
          button.disabled = false;
        } else {
          button.classList.remove('wallet-required');
          button.removeAttribute('aria-disabled');
          button.disabled = false;
        }
      });
    }

    // MEV Protection Modal
    const FLASHBOTS_RPC_URL = 'https://rpc.flashbots.net';
    const BLOXROUTE_BSC_RPC_URL = 'https://bsc.rpc.blxrbdn.com';
    const ETHEREUM_CHAIN_ID = 1;
    const BSC_CHAIN_ID = 56;
    const BASE_CHAIN_ID = 8453;
    const ARBITRUM_CHAIN_ID = 42161;
    const OPTIMISM_CHAIN_ID = 10;
    const POLYGON_CHAIN_ID = 137;
    const AVALANCHE_CHAIN_ID = 43114;

    // Modal scroll lock coordination with reference counting
    // When multiple modals are open, closing one should not restore body overflow
    // until all modals are closed.
    let modalScrollLockCount = 0;

    function lockBodyScroll() {
      modalScrollLockCount++;
      if (modalScrollLockCount === 1) {
        document.body.style.overflow = 'hidden';
      }
    }

    function unlockBodyScroll() {
      modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
      if (modalScrollLockCount === 0) {
        document.body.style.overflow = '';
      }
    }

    // Open modal
    function openMevModal() {
      renderMevChainContent();
      mevModal.classList.add('show');
      lockBodyScroll();
      // Focus the close button for accessibility
      mevModalClose.focus();
    }

    // Close modal
    function closeMevModal() {
      mevModal.classList.remove('show');
      unlockBodyScroll();
      // Return focus to the button that opened the modal
      mevInfoBtn.focus();
    }

    // Settings Modal Functions
    function openSettingsModal() {
      renderLocalTokens();
      settingsModal.classList.add('show');
      settingsBtn.setAttribute('aria-expanded', 'true');
      lockBodyScroll();
      // Focus the close button for accessibility
      settingsModalClose.focus();
    }

    function closeSettingsModal() {
      settingsModal.classList.remove('show');
      settingsBtn.setAttribute('aria-expanded', 'false');
      unlockBodyScroll();
      // Return focus to the button that opened the modal
      settingsBtn.focus();
    }

    // Swap Confirmation Modal Functions
    function openSwapConfirmModal(card) {
      pendingSwapCard = card;
      updateSwapConfirmModalText();
      swapConfirmModal.classList.add('show');
      lockBodyScroll();
      // Focus the first focusable element (Wait button) for accessibility
      swapConfirmWaitBtn.focus();
    }

    function closeSwapConfirmModal() {
      swapConfirmModal.classList.remove('show');
      unlockBodyScroll();
      // Save the card reference before clearing
      const cardToFocus = pendingSwapCard;
      pendingSwapCard = null;
      // Return focus to the swap button
      if (cardToFocus) {
        const swapBtn = cardToFocus.querySelector('.swap-btn');
        if (swapBtn) swapBtn.focus();
      }
    }

    // Focus trap for swap confirmation modal
    function handleSwapConfirmModalKeydown(event) {
      if (event.key !== 'Tab') return;

      // Get all focusable elements in the modal
      const focusableElements = swapConfirmModal.querySelectorAll(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }

    function updateSwapConfirmModalText() {
      // Check if quotes are still loading
      const isLoading = !progressiveQuoteState.complete &&
                        ((progressiveQuoteState.spandex === null && progressiveQuoteState.spandexError === null) ||
                         (progressiveQuoteState.curve === null && progressiveQuoteState.curveError === null && !progressiveQuoteState.singleRouterMode));

      if (!isLoading) {
        // All quotes arrived while modal was open - auto-dismiss
        closeSwapConfirmModal();
        return;
      }

      // Update text based on current state
      const routerName = progressiveQuoteState.spandex === null && progressiveQuoteState.spandexError === null ? 'Spandex' : 'Curve';
      swapConfirmModalText.innerHTML = '<strong>The ' + routerName + ' quote is still loading.</strong> A better price may arrive soon.';
    }

    function handleSwapConfirmWait() {
      closeSwapConfirmModal();
      // No swap executed - user chose to wait
    }

    async function handleSwapConfirmProceed() {
      const card = pendingSwapCard;
      closeSwapConfirmModal();

      if (!card) return;

      // Proceed with the swap
      await executeSwapFromCard(card);
    }

    // Check if quotes are still loading
    function areQuotesStillLoading() {
      // If complete flag is true, no quotes are loading
      if (progressiveQuoteState.complete) return false;

      // If in single router mode, only one router applies
      if (progressiveQuoteState.singleRouterMode) return false;

      // Check if any router hasn't responded yet (no quote and no error)
      const spandexPending = progressiveQuoteState.spandex === null && progressiveQuoteState.spandexError === null;
      const curvePending = progressiveQuoteState.curve === null && progressiveQuoteState.curveError === null;

      return spandexPending || curvePending;
    }

    // Local Tokenlist Management
    function loadLocalTokenList() {
      try {
        const data = localStorage.getItem(LOCAL_TOKEN_LIST_KEY);
        if (data) {
          const parsed = JSON.parse(data);
          if (parsed && Array.isArray(parsed.tokens)) {
            return parsed.tokens.map(t => ({ ...t, _source: LOCAL_TOKENS_SOURCE_NAME }));
          }
        }
      } catch {
        // Corrupt data, treat as empty
      }
      return [];
    }

    function saveLocalTokenList(tokens) {
      const payload = {
        name: 'Local Tokens',
        timestamp: new Date().toISOString(),
        tokens: tokens.map(t => ({
          chainId: t.chainId,
          address: t.address,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
        })),
      };
      try {
        localStorage.setItem(LOCAL_TOKEN_LIST_KEY, JSON.stringify(payload));
      } catch {
        // Ignore storage errors
      }
    }

    // Local tokens enabled/disabled state (toggle in settings panel)
    function loadLocalTokensEnabled() {
      try {
        const data = localStorage.getItem(LOCAL_TOKENS_ENABLED_KEY);
        if (data !== null) {
          return data === 'true';
        }
      } catch {
        // Ignore storage errors
      }
      // Default to enabled
      return true;
    }

    function saveLocalTokensEnabled(enabled) {
      try {
        localStorage.setItem(LOCAL_TOKENS_ENABLED_KEY, String(enabled));
      } catch {
        // Ignore storage errors
      }
    }

    // User Preferences Management
    // Saves user form selections after successful comparison
    // Structure: { chainId, amount, slippageBps, mode, perChainTokens: { [chainId]: { from, to } } }
    function loadUserPreferences() {
      try {
        const data = localStorage.getItem(USER_PREFERENCES_KEY);
        if (data) {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }
      } catch {
        // Corrupt data, treat as empty
      }
      return null;
    }

    function saveUserPreferences(params) {
      try {
        // Load existing preferences to merge perChainTokens
        const existing = loadUserPreferences() || {};
        const perChainTokens = existing.perChainTokens || {};

        // Update per-chain tokens for the current chain
        perChainTokens[String(params.chainId)] = {
          from: String(params.from || '').trim(),
          to: String(params.to || '').trim(),
        };

        const preferences = {
          chainId: String(params.chainId || '').trim(),
          amount: String(params.amount || '').trim(),
          slippageBps: String(params.slippageBps || '').trim(),
          mode: String(params.mode || 'exactIn').trim(),
          perChainTokens,
        };

        localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
      } catch {
        // Ignore storage errors
      }
    }

    function getSavedTokensForChain(chainId) {
      const prefs = loadUserPreferences();
      if (prefs && prefs.perChainTokens && prefs.perChainTokens[String(chainId)]) {
        return prefs.perChainTokens[String(chainId)];
      }
      return null;
    }

    function addTokenToLocalList(token) {
      const existing = loadLocalTokenList();
      // Check for duplicate by address+chainId
      const isDuplicate = existing.some(t =>
        String(t.address).toLowerCase() === String(token.address).toLowerCase() &&
        Number(t.chainId) === Number(token.chainId)
      );
      if (!isDuplicate) {
        existing.push({ ...token, _source: LOCAL_TOKENS_SOURCE_NAME });
        saveLocalTokenList(existing);
      }
    }

    function removeTokenFromLocalList(address, chainId) {
      const existing = loadLocalTokenList();
      const filtered = existing.filter(t =>
        !(String(t.address).toLowerCase() === String(address).toLowerCase() &&
          Number(t.chainId) === Number(chainId))
      );
      saveLocalTokenList(filtered);
      renderLocalTokens();
      refreshAutocomplete();
    }

    // Local Tokens Export/Import Elements
    const exportLocalTokensBtn = document.getElementById('exportLocalTokensBtn');
    const importLocalTokensInput = document.getElementById('importLocalTokensInput');
    const localTokensMessage = document.getElementById('localTokensMessage');

    function setLocalTokensMessage(text, kind) {
      localTokensMessage.textContent = text || '';
      localTokensMessage.className = 'tokenlist-message' + (kind ? ' ' + kind : '');
    }

    // Export local tokens as Uniswap tokenlist JSON format
    function exportLocalTokenList() {
      const localTokens = loadLocalTokenList();
      if (localTokens.length === 0) {
        setLocalTokensMessage('No tokens to export', 'error');
        return;
      }

      const payload = {
        name: 'Local Tokens',
        version: { major: 1, minor: 0, patch: 0 },
        timestamp: new Date().toISOString(),
        tokens: localTokens.map(t => ({
          chainId: t.chainId,
          address: t.address,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
        })),
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // Create temporary download link
      const a = document.createElement('a');
      a.href = url;
      a.download = 'local-tokens.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLocalTokensMessage('Exported ' + localTokens.length + ' token' + (localTokens.length === 1 ? '' : 's'), 'success');
    }

    // Import tokens from a Uniswap tokenlist JSON file
    function importLocalTokenList(file) {
      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          const content = event.target.result;
          if (typeof content !== 'string') {
            throw new Error('File content is not text');
          }

          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch {
            throw new Error('File is not valid JSON');
          }

          // Validate Uniswap tokenlist structure
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tokens)) {
            throw new Error('File must contain a tokens array');
          }

          const importedTokens = parsed.tokens;
          if (importedTokens.length === 0) {
            throw new Error('Tokenlist contains no tokens');
          }

          // Validate each token has required fields
          const validTokens = [];
          for (const token of importedTokens) {
            if (
              typeof token.chainId === 'number' &&
              typeof token.address === 'string' &&
              /^0x[a-fA-F0-9]{40}$/.test(token.address) &&
              typeof token.symbol === 'string' &&
              typeof token.decimals === 'number'
            ) {
              validTokens.push({
                chainId: token.chainId,
                address: token.address,
                name: token.name || token.symbol || 'Unknown',
                symbol: token.symbol,
                decimals: token.decimals,
              });
            }
          }

          if (validTokens.length === 0) {
            throw new Error('No valid tokens found in file');
          }

          // Merge with existing tokens (dedup by address+chainId)
          const existing = loadLocalTokenList();
          let addedCount = 0;

          for (const token of validTokens) {
            const isDuplicate = existing.some(t =>
              String(t.address).toLowerCase() === String(token.address).toLowerCase() &&
              Number(t.chainId) === Number(token.chainId)
            );
            if (!isDuplicate) {
              existing.push({ ...token, _source: LOCAL_TOKENS_SOURCE_NAME });
              addedCount++;
            }
          }

          saveLocalTokenList(existing);
          renderLocalTokens();
          refreshAutocomplete();

          if (addedCount === 0) {
            setLocalTokensMessage('All tokens already exist in your list', 'success');
          } else {
            setLocalTokensMessage('Imported ' + addedCount + ' new token' + (addedCount === 1 ? '' : 's'), 'success');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setLocalTokensMessage('Import error: ' + msg, 'error');
        }
      };

      reader.onerror = () => {
        setLocalTokensMessage('Failed to read file', 'error');
      };

      reader.readAsText(file);
    }

    // Wire up export button
    if (exportLocalTokensBtn) {
      exportLocalTokensBtn.addEventListener('click', exportLocalTokenList);
    }

    // Wire up import input
    if (importLocalTokensInput) {
      importLocalTokensInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          importLocalTokenList(files[0]);
          // Reset input so same file can be selected again
          e.target.value = '';
        }
      });
    }

    function renderLocalTokens() {
      const container = document.getElementById('localTokensContent');
      if (!container) return;

      const localTokens = loadLocalTokenList();
      const localTokensEnabled = loadLocalTokensEnabled();

      // Update toggle state
      const toggle = document.getElementById('localTokensToggle');
      if (toggle) {
        toggle.classList.toggle('on', localTokensEnabled);
        toggle.setAttribute('aria-checked', String(localTokensEnabled));
      }

      // Update export button disabled state
      if (exportLocalTokensBtn) {
        exportLocalTokensBtn.disabled = localTokens.length === 0;
      }

      if (localTokens.length === 0) {
        container.innerHTML = '<div class="settings-placeholder">No custom tokens saved</div>';
        return;
      }

      let html = '';
      for (const token of localTokens) {
        const chainName = CHAIN_NAMES[String(token.chainId)] || 'Chain ' + token.chainId;
        html += '<div class="local-token-entry' + (localTokensEnabled ? '' : ' disabled') + '" data-address="' + escapeHtml(token.address) + '" data-chain-id="' + token.chainId + '">';
        html += '<span class="local-token-symbol">' + escapeHtml(token.symbol || '???') + '</span>';
        html += '<span class="local-token-address">' + escapeHtml(token.address) + '</span>';
        html += '<span class="local-token-chain">' + escapeHtml(chainName) + '</span>';
        html += '<button type="button" class="local-token-remove-btn" data-action="remove-local-token" data-address="' + escapeHtml(token.address) + '" data-chain-id="' + token.chainId + '" aria-label="Remove token">&times;</button>';
        html += '</div>';
      }

      container.innerHTML = html;

      // Wire up event handlers
      container.querySelectorAll('[data-action="remove-local-token"]').forEach(el => {
        el.addEventListener('click', (e) => {
          const btn = e.currentTarget;
          const address = btn.dataset.address;
          const chainId = Number(btn.dataset.chainId);
          if (address && chainId) {
            removeTokenFromLocalList(address, chainId);
          }
        });
      });
    }

    // Handle local tokens toggle
    function handleLocalTokensToggle() {
      const currentState = loadLocalTokensEnabled();
      const newState = !currentState;
      saveLocalTokensEnabled(newState);
      renderLocalTokens();
      refreshAutocomplete();
    }

    // Wire up local tokens toggle
    const localTokensToggle = document.getElementById('localTokensToggle');
    if (localTokensToggle) {
      localTokensToggle.addEventListener('click', handleLocalTokensToggle);
      localTokensToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleLocalTokensToggle();
        }
      });
    }

    // Unrecognized Token Modal Elements
    const unrecognizedTokenModal = document.getElementById('unrecognizedTokenModal');
    const unrecognizedTokenModalClose = document.getElementById('unrecognizedTokenModalClose');
    const unrecognizedTokenAddress = document.getElementById('unrecognizedTokenAddress');
    const unrecognizedTokenLoading = document.getElementById('unrecognizedTokenLoading');
    const unrecognizedTokenMetadata = document.getElementById('unrecognizedTokenMetadata');
    const unrecognizedTokenName = document.getElementById('unrecognizedTokenName');
    const unrecognizedTokenSymbol = document.getElementById('unrecognizedTokenSymbol');
    const unrecognizedTokenDecimals = document.getElementById('unrecognizedTokenDecimals');
    const unrecognizedTokenError = document.getElementById('unrecognizedTokenError');
    const unrecognizedTokenCancelBtn = document.getElementById('unrecognizedTokenCancelBtn');
    const unrecognizedTokenSaveBtn = document.getElementById('unrecognizedTokenSaveBtn');

    // State for the unrecognized token modal
    let unrecognizedTokenState = {
      address: '',
      chainId: 0,
      metadata: null,
      targetInput: null, // 'from' or 'to'
    };

    function openUnrecognizedTokenModal(address, chainId, targetInput) {
      unrecognizedTokenState = {
        address: address,
        chainId: chainId,
        metadata: null,
        targetInput: targetInput,
      };

      // Reset UI
      unrecognizedTokenAddress.textContent = address;
      unrecognizedTokenLoading.hidden = false;
      unrecognizedTokenMetadata.hidden = true;
      unrecognizedTokenError.hidden = true;
      unrecognizedTokenSaveBtn.disabled = true;
      unrecognizedTokenSaveBtn.textContent = 'Save to Local List';

      // Show modal
      unrecognizedTokenModal.classList.add('show');
      lockBodyScroll();
      unrecognizedTokenModalClose.focus();

      // Fetch metadata
      fetchTokenMetadata(address, chainId);
    }

    function closeUnrecognizedTokenModal() {
      unrecognizedTokenModal.classList.remove('show');
      unlockBodyScroll();
      // Return focus to the input that triggered the modal
      if (unrecognizedTokenState.targetInput === 'from') {
        fromInput.focus();
      } else if (unrecognizedTokenState.targetInput === 'to') {
        toInput.focus();
      }
      unrecognizedTokenState = {
        address: '',
        chainId: 0,
        metadata: null,
        targetInput: null,
      };
    }

    async function fetchTokenMetadata(address, chainId) {
      try {
        const url = '/token-metadata?chainId=' + encodeURIComponent(chainId) + '&address=' + encodeURIComponent(address);
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || data.error) {
          // Show error
          unrecognizedTokenLoading.hidden = true;
          unrecognizedTokenMetadata.hidden = true;
          unrecognizedTokenError.hidden = false;
          unrecognizedTokenError.textContent = data.error || ('Failed to fetch metadata (HTTP ' + response.status + ')');
          unrecognizedTokenSaveBtn.disabled = true;
          return;
        }

        // Success - show metadata
        unrecognizedTokenState.metadata = data;
        unrecognizedTokenLoading.hidden = true;
        unrecognizedTokenError.hidden = true;
        unrecognizedTokenMetadata.hidden = false;
        unrecognizedTokenName.textContent = data.name || '';
        unrecognizedTokenSymbol.textContent = data.symbol || '';
        unrecognizedTokenDecimals.textContent = String(data.decimals || 0);
        unrecognizedTokenSaveBtn.disabled = false;
      } catch (err) {
        // Network or other error
        unrecognizedTokenLoading.hidden = true;
        unrecognizedTokenMetadata.hidden = true;
        unrecognizedTokenError.hidden = false;
        const msg = err instanceof Error ? err.message : String(err);
        unrecognizedTokenError.textContent = 'Failed to fetch metadata: ' + msg;
        unrecognizedTokenSaveBtn.disabled = true;
      }
    }

    function handleUnrecognizedTokenSave() {
      if (!unrecognizedTokenState.metadata || !unrecognizedTokenState.address) {
        return;
      }

      const token = {
        chainId: unrecognizedTokenState.chainId,
        address: unrecognizedTokenState.address,
        name: unrecognizedTokenState.metadata.name || '',
        symbol: unrecognizedTokenState.metadata.symbol || '',
        decimals: unrecognizedTokenState.metadata.decimals || 18,
        _source: LOCAL_TOKENS_SOURCE_NAME,
      };

      // Add to local list
      addTokenToLocalList(token);
      renderLocalTokens();

      // Update input field with formatted display
      const input = unrecognizedTokenState.targetInput === 'from' ? fromInput : toInput;
      const newDisplay = formatTokenDisplay(token.symbol, token.address);
      // Handle token swap if setting to same value as other field
      handleTokenSwapIfNeeded(input, token.address, newDisplay);
      input.value = newDisplay;
      input.dataset.address = token.address;
      // Clear icon for custom tokens (no logoURI)
      if (input === fromInput) {
        clearTokenInputIcon(fromWrapper, fromIcon);
      } else if (input === toInput) {
        clearTokenInputIcon(toWrapper, toIcon);
      }

      // Close modal
      closeUnrecognizedTokenModal();

      // Refresh autocomplete to include the new token
      refreshAutocomplete();

      // Update balance for this token field
      if (input === fromInput) {
        void updateFromTokenBalance();
      } else if (input === toInput) {
        void updateToTokenBalance();
      }
    }

    // Event listeners for unrecognized token modal
    unrecognizedTokenModalClose.addEventListener('click', closeUnrecognizedTokenModal);
    unrecognizedTokenCancelBtn.addEventListener('click', closeUnrecognizedTokenModal);
    unrecognizedTokenSaveBtn.addEventListener('click', handleUnrecognizedTokenSave);

    // Close modal on overlay click
    unrecognizedTokenModal.addEventListener('click', (event) => {
      if (event.target === unrecognizedTokenModal) {
        closeUnrecognizedTokenModal();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && unrecognizedTokenModal.classList.contains('show')) {
        closeUnrecognizedTokenModal();
      }
    });

    // Check if address is in any enabled tokenlist (including local tokens)
    function isAddressInTokenlists(address, chainId) {
      const addr = String(address || '').toLowerCase();
      const cid = Number(chainId);

      // Check tokenlist sources
      for (const source of tokenlistSources) {
        if (!source.enabled || !source.tokens) continue;
        const found = source.tokens.find(t =>
          Number(t.chainId) === cid &&
          String(t.address || '').toLowerCase() === addr
        );
        if (found) return true;
      }

      // Check local tokens (if enabled)
      if (loadLocalTokensEnabled()) {
        const localTokens = loadLocalTokenList();
        const foundLocal = localTokens.find(t =>
          Number(t.chainId) === cid &&
          String(t.address || '').toLowerCase() === addr
        );
        if (foundLocal) return true;
      }

      return false;
    }

    // Handle blur event on token inputs - check for unrecognized addresses
    function handleTokenInputBlur(input, targetInput) {
      const value = String(input.value || '').trim();

      // Check if it's a valid address
      if (!isAddressLike(value)) {
        return;
      }

      const chainId = getCurrentChainId();

      // Handle token swap if setting to same value as other field
      // This needs to happen before we update the data-address
      handleTokenSwapIfNeeded(input, value, value);

      // Check if address is already in tokenlists
      if (isAddressInTokenlists(value, chainId)) {
        // Update data-address
        input.dataset.address = value;
        // Try to find the token to get a nicer display format
        const token = findTokenByAddress(value, chainId);
        if (token) {
          input.value = formatTokenDisplay(token.symbol, token.address);
          // Update token icon in input field
          if (input === fromInput) {
            updateTokenInputIcon(fromInput, fromIcon, fromWrapper, token);
          } else if (input === toInput) {
            updateTokenInputIcon(toInput, toIcon, toWrapper, token);
          }
        }
        // Update balance for this token field
        if (input === fromInput) {
          void updateFromTokenBalance();
        } else if (input === toInput) {
          void updateToTokenBalance();
        }
        return;
      }

      // Address is not recognized - show popup
      input.dataset.address = value;
      openUnrecognizedTokenModal(value, chainId, targetInput);
    }

    // Add blur listeners to token inputs
    fromInput.addEventListener('blur', () => handleTokenInputBlur(fromInput, 'from'));
    toInput.addEventListener('blur', () => handleTokenInputBlur(toInput, 'to'));

    // Also check when a full 42-char address is typed (immediate detection)
    fromInput.addEventListener('input', () => {
      const value = String(fromInput.value || '').trim();
      if (isAddressLike(value) && !isAddressInTokenlists(value, getCurrentChainId())) {
        // Delay slightly to allow for paste/autocomplete to settle
        setTimeout(() => {
          const currentValue = String(fromInput.value || '').trim();
          if (isAddressLike(currentValue)) {
            handleTokenInputBlur(fromInput, 'from');
          }
        }, 100);
      }
    });

    toInput.addEventListener('input', () => {
      const value = String(toInput.value || '').trim();
      if (isAddressLike(value) && !isAddressInTokenlists(value, getCurrentChainId())) {
        setTimeout(() => {
          const currentValue = String(toInput.value || '').trim();
          if (isAddressLike(currentValue)) {
            handleTokenInputBlur(toInput, 'to');
          }
        }, 100);
      }
    });

    // Render chain-specific content in modal
    function renderMevChainContent() {
      const chainId = getCurrentChainId();
      const walletConnectedValue = hasConnectedWallet();
      const walletDisabled = !walletConnectedValue;
      const walletNote = walletDisabled ? '<p class="wallet-required-note">Connect wallet first</p>' : '';

      let html = '';

      if (chainId === ETHEREUM_CHAIN_ID) {
        html =
          '<div class="mev-chain-message ethereum">' +
            '<div class="mev-chain-title">Ethereum Mainnet</div>' +
            '<p>Your swap is vulnerable to sandwich attacks. Add Flashbots Protect to send transactions privately.</p>' +
            '<button type="button" class="add-to-wallet-btn" id="addFlashbotsBtn" ' + (walletDisabled ? 'disabled' : '') + '>' +
              'Add Flashbots Protect to Wallet' +
            '</button>' +
            walletNote +
          '</div>';
      } else if (chainId === BSC_CHAIN_ID) {
        html =
          '<div class="mev-chain-message bsc">' +
            '<div class="mev-chain-title">BSC (BNB Chain)</div>' +
            '<p>BSC has active MEV bots. Add bloXroute BSC Protect for private transaction submission.</p>' +
            '<button type="button" class="add-to-wallet-btn" id="addBloXrouteBtn" ' + (walletDisabled ? 'disabled' : '') + '>' +
              'Add bloXroute Protect to Wallet' +
            '</button>' +
            walletNote +
          '</div>';
      } else if (chainId === BASE_CHAIN_ID || chainId === ARBITRUM_CHAIN_ID || chainId === OPTIMISM_CHAIN_ID) {
        const chainName = chainId === BASE_CHAIN_ID ? 'Base' : (chainId === ARBITRUM_CHAIN_ID ? 'Arbitrum' : 'Optimism');
        html =
          '<div class="mev-chain-message l2">' +
            '<div class="mev-chain-title">' + chainName + ' (L2)</div>' +
            '<p>This chain uses a centralized sequencer that processes transactions in order received. Sandwich attacks are significantly harder. No additional protection needed.</p>' +
          '</div>';
      } else if (chainId === POLYGON_CHAIN_ID || chainId === AVALANCHE_CHAIN_ID) {
        const chainName = chainId === POLYGON_CHAIN_ID ? 'Polygon' : 'Avalanche';
        html =
          '<div class="mev-chain-message other">' +
            '<div class="mev-chain-title">' + chainName + '</div>' +
            '<p>MEV protection is useful on this chain but no free public protection RPC is currently available.</p>' +
          '</div>';
      } else {
        html =
          '<div class="mev-chain-message other">' +
            '<div class="mev-chain-title">Unknown Chain</div>' +
            '<p>MEV protection availability varies by chain. Check if your wallet supports private transaction submission.</p>' +
          '</div>';
      }

      mevChainContent.innerHTML = html;

      // Add click handlers for Add to Wallet buttons
      const addFlashbotsBtn = document.getElementById('addFlashbotsBtn');
      if (addFlashbotsBtn) {
        addFlashbotsBtn.addEventListener('click', () => addMevRpcToWallet('ethereum'));
      }

      const addBloXrouteBtn = document.getElementById('addBloXrouteBtn');
      if (addBloXrouteBtn) {
        addBloXrouteBtn.addEventListener('click', () => addMevRpcToWallet('bsc'));
      }
    }

    // Add MEV protection RPC to wallet via wallet_addEthereumChain
    async function addMevRpcToWallet(type) {
      if (!hasConnectedWallet()) {
        setWalletMessage('Connect wallet first', true);
        return;
      }

      const provider = connectedWalletProvider;
      if (!provider || typeof provider.request !== 'function') {
        setWalletMessage('Wallet provider is not available.', true);
        return;
      }

      let chainParams;
      if (type === 'ethereum') {
        chainParams = {
          chainId: '0x1',
          chainName: 'Ethereum (Flashbots Protect)',
          rpcUrls: [FLASHBOTS_RPC_URL],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          blockExplorerUrls: ['https://etherscan.io'],
        };
      } else if (type === 'bsc') {
        chainParams = {
          chainId: '0x38',
          chainName: 'BSC (bloXroute Protect)',
          rpcUrls: [BLOXROUTE_BSC_RPC_URL],
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          blockExplorerUrls: ['https://bscscan.com'],
        };
      } else {
        return;
      }

      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [chainParams],
        });
        setWalletMessage('MEV protection RPC added to your wallet. Switch to it for protected transactions.');
      } catch (err) {
        if (isUserRejectedError(err)) {
          setWalletMessage('Request canceled.', true);
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setWalletMessage('Failed to add RPC: ' + detail, true);
      }
    }

    function setWalletGlobals() {
      window.__selectedWalletProvider = connectedWalletProvider;
      window.__selectedWalletAddress = connectedWalletAddressValue;
      window.__selectedWalletInfo = connectedWalletInfo;
    }

    // Never truncate addresses - always show full 0x... address
    // This is a project convention in AGENTS.md
    function truncateAddress(address) {
      if (typeof address !== 'string') return address || '';
      return address; // Return full address, no truncation
    }

    function walletName(info) {
      if (!info || typeof info.name !== 'string' || !info.name.trim()) {
        return 'Wallet';
      }
      return info.name.trim();
    }

    function setWalletMessage(message, isError = false) {
      walletMessage.textContent = message;
      walletMessage.classList.toggle('error', isError);
    }

    function updateWalletStateUi() {
      if (connectedWalletProvider && connectedWalletAddressValue) {
        connectWalletBtn.hidden = true;
        walletConnected.hidden = false;
        walletConnectedName.textContent = walletName(connectedWalletInfo);
        walletConnectedAddress.textContent = truncateAddress(connectedWalletAddressValue);

        const icon = connectedWalletInfo && typeof connectedWalletInfo.icon === 'string' ? connectedWalletInfo.icon : '';
        if (icon) {
          walletConnectedIcon.hidden = false;
          walletConnectedIcon.src = icon;
          walletConnectedIcon.onerror = () => {
            walletConnectedIcon.src = ''; // Clear src to prevent broken icon from rendering
            walletConnectedIcon.hidden = true;
          };
        } else {
          walletConnectedIcon.hidden = true;
          walletConnectedIcon.removeAttribute('src');
          walletConnectedIcon.onerror = null;
        }
      } else {
        connectWalletBtn.hidden = false;
        walletConnected.hidden = true;
        walletConnectedName.textContent = '';
        walletConnectedAddress.textContent = '';
        walletConnectedIcon.hidden = true;
        walletConnectedIcon.removeAttribute('src');
        walletConnectedIcon.onerror = null;
      }
    }

    function closeWalletProviderMenu() {
      walletProviderMenu.hidden = true;
      walletProviderMenu.innerHTML = '';
      // If closing without a provider connection in progress, cancel any pending action
      if (!isConnectingProvider && pendingPostConnectAction) {
        pendingPostConnectAction = null;
      }
    }

    function createWalletIcon(iconUri, altText, className) {
      const icon = document.createElement('img');
      icon.className = className;
      icon.alt = altText;
      if (typeof iconUri === 'string' && iconUri) {
        icon.src = iconUri;
      } else {
        icon.style.display = 'none';
      }
      icon.onerror = () => {
        icon.src = ''; // Clear src to prevent broken icon from rendering
        icon.style.display = 'none';
      };
      return icon;
    }

    async function connectToWalletProvider(provider, info) {
      if (!provider || typeof provider.request !== 'function') {
        setWalletMessage('Wallet provider is not available.', true);
        return;
      }

      // Mark that we're actively trying to connect (not just dismissing menu)
      isConnectingProvider = true;

      try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        const account = Array.isArray(accounts) ? accounts[0] : null;
        if (typeof account !== 'string' || !account) {
          throw new Error('No account returned by wallet');
        }

        connectedWalletProvider = provider;
        connectedWalletAddressValue = account;
        connectedWalletInfo = info || { name: 'Wallet', icon: '' };

        setWalletGlobals();
        closeWalletProviderMenu();
        updateWalletStateUi();
        updateTransactionActionStates();
        setWalletMessage('');
        updateTokenBalances(); // Fetch balances for selected tokens

        // Execute pending post-connect action (auto-approve/auto-swap)
        const action = pendingPostConnectAction;
        pendingPostConnectAction = null; // Clear before executing to prevent re-trigger
        isConnectingProvider = false; // Reset flag before action execution
        if (action) {
          if (action.type === 'approve' && action.card && action.button) {
            void onApproveClick(action.card, action.button);
          } else if (action.type === 'swap' && action.card) {
            void onSwapClick(action.card);
          }
        }
      } catch (err) {
        isConnectingProvider = false; // Reset flag on error
        const code = err && typeof err === 'object' ? err.code : undefined;
        if (code === 4001) {
          setWalletMessage('Wallet connection was canceled.', true);
          // Clear pending action on user cancel
          pendingPostConnectAction = null;
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setWalletMessage('Wallet connection failed: ' + detail, true);
      }
    }

    function disconnectWallet() {
      connectedWalletProvider = null;
      connectedWalletAddressValue = '';
      connectedWalletInfo = null;
      setWalletGlobals();
      closeWalletProviderMenu();
      updateWalletStateUi();
      updateTransactionActionStates();
      clearTokenBalances(); // Hide balances when wallet disconnected
      setWalletMessage('Wallet disconnected.');
    }

    function openWalletProviderMenu(providers) {
      walletProviderMenu.innerHTML = '';

      providers.forEach((detail) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'wallet-provider-option';

        const providerInfo = detail.info || {};
        const providerName = walletName(providerInfo);
        const icon = createWalletIcon(providerInfo.icon, providerName + ' icon', 'wallet-provider-icon');
        const name = document.createElement('span');
        name.className = 'wallet-provider-name';
        name.textContent = providerName;

        option.appendChild(icon);
        option.appendChild(name);

        option.addEventListener('click', () => {
          void connectToWalletProvider(detail.provider, providerInfo);
        });

        walletProviderMenu.appendChild(option);
      });

      walletProviderMenu.hidden = providers.length === 0;
    }

    function getAnnouncedWalletProviders() {
      return Array.from(walletProvidersByUuid.values());
    }

    function onAnnounceProvider(event) {
      const detail = event.detail;
      if (!detail || !detail.provider || !detail.info || typeof detail.info.uuid !== 'string') {
        return;
      }

      if (walletProvidersByUuid.has(detail.info.uuid)) {
        return;
      }

      walletProvidersByUuid.set(detail.info.uuid, detail);
    }

    window.addEventListener('eip6963:announceProvider', onAnnounceProvider);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    if (typeof window.ethereum !== 'undefined') {
      fallbackWalletProvider = window.ethereum;
    }

    // Trigger wallet connection flow programmatically (used by auto-approve/auto-swap)
    function triggerWalletConnectionFlow() {
      setWalletMessage('');
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const announcedProviders = getAnnouncedWalletProviders();
      if (announcedProviders.length > 0) {
        openWalletProviderMenu(announcedProviders);
        return;
      }

      if (fallbackWalletProvider) {
        void connectToWalletProvider(fallbackWalletProvider, {
          uuid: 'window.ethereum',
          name: 'Injected Wallet',
          icon: '',
          rdns: 'window.ethereum',
        });
        return;
      }

      closeWalletProviderMenu();
      setWalletMessage('No wallet detected. Install a wallet extension and try again.', true);
    }

    connectWalletBtn.addEventListener('click', triggerWalletConnectionFlow);

    disconnectWalletBtn.addEventListener('click', disconnectWallet);

    document.addEventListener('mousedown', (event) => {
      if (event.target === connectWalletBtn || walletProviderMenu.contains(event.target)) {
        return;
      }
      closeWalletProviderMenu();
    });

    updateWalletStateUi();
    setWalletGlobals();
    updateTransactionActionStates();

    function normalizeAddress(value) {
      const lower = value.toLowerCase();
      return lower.startsWith('0x') ? lower.slice(2) : lower;
    }

    // Normalize URL for duplicate detection (lowercase host, strip trailing slash)
    function normalizeTokenlistUrl(url) {
      try {
        const parsed = new URL(url);
        return parsed.origin.toLowerCase() + parsed.pathname.replace(/\\/+$/, '');
      } catch {
        return url.toLowerCase().replace(/\\/+$/, '');
      }
    }

    // Load default tokenlist(s) from server
    // Returns array of {name, tokens} objects (one per configured default)
    async function loadDefaultTokenlists() {
      try {
        const res = await fetch('/tokenlist');
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        // Server now returns {tokenlists: [{name, tokens}, ...], tokens: merged}
        const tokenlists = Array.isArray(data.tokenlists) ? data.tokenlists : [];
        if (tokenlists.length === 0) {
          // Fallback for old server response format
          const tokens = Array.isArray(data.tokens) ? data.tokens : [];
          if (tokens.length > 0) {
            return [{ name: DEFAULT_TOKENLIST_NAME, tokens: tokens.map(t => ({ ...t, _source: DEFAULT_TOKENLIST_NAME })) }];
          }
          return [];
        }
        // Tag tokens with their source name
        return tokenlists.map(entry => ({
          name: entry.name || DEFAULT_TOKENLIST_NAME,
          tokens: (entry.tokens || []).map(t => ({ ...t, _source: entry.name || DEFAULT_TOKENLIST_NAME }))
        }));
      } catch {
        return [];
      }
    }

    // Load custom tokenlist from URL via proxy endpoint
    async function loadTokenlistFromUrl(url) {
      const res = await fetch('/tokenlist/proxy?url=' + encodeURIComponent(url));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || ('HTTP ' + res.status));
      }
      const data = await res.json();
      const tokens = Array.isArray(data.tokens) ? data.tokens : [];
      // Name from the tokenlist, or URL fallback
      const name = data.name || url;
      return { tokens, name };
    }

    // Tokenlist Sources UI Elements
    const tokenlistUrlInput = document.getElementById('tokenlistUrlInput');
    const addTokenlistBtn = document.getElementById('addTokenlistBtn');
    const tokenlistMessage = document.getElementById('tokenlistMessage');
    const tokenlistSourcesList = document.getElementById('tokenlistSourcesList');

    function setTokenlistMessage(text, kind) {
      tokenlistMessage.textContent = text || '';
      tokenlistMessage.className = 'tokenlist-message' + (kind ? ' ' + kind : '');
    }

    // Count tokens for a specific chain
    function countTokensForChain(tokens, chainId) {
      const cid = Number(chainId);
      return tokens.filter(t => Number(t.chainId) === cid).length;
    }

    // Get all tokens from enabled sources for a chain
    function getTokensForChain(chainId) {
      const cid = Number(chainId);
      const seen = new Set();
      const result = [];

      // Get tokens from all enabled sources
      for (const source of tokenlistSources) {
        if (!source.enabled || !source.tokens) continue;

        for (const token of source.tokens) {
          if (Number(token.chainId) !== cid || typeof token.address !== 'string') continue;
          const addr = token.address.toLowerCase();
          if (seen.has(addr)) continue;
          seen.add(addr);
          result.push(token);
        }
      }

      // Add local tokens (if enabled)
      if (loadLocalTokensEnabled()) {
        const localTokens = loadLocalTokenList();
        for (const token of localTokens) {
          if (Number(token.chainId) !== cid || typeof token.address !== 'string') continue;
          const addr = token.address.toLowerCase();
          if (seen.has(addr)) continue;
          seen.add(addr);
          result.push(token);
        }
      }

      return result;
    }

    // Get current chain ID
    function getCurrentChainId() {
      // First check data attribute (set by dropdown selection)
      const dataChainId = chainIdInput.dataset.chainId;
      if (dataChainId) return Number(dataChainId);

      // Fall back to input value (could be numeric ID or display format)
      const val = chainIdInput.value.trim();
      if (/^[0-9]+$/.test(val)) {
        // Plain numeric ID
        return Number(val);
      }
      // Try to extract from display format "Name (ID)"
      const match = val.match(/\\(([0-9]+)\\)$/);
      if (match) {
        return Number(match[1]);
      }
      // Default to Base
      return 8453;
    }

    // Render tokenlist sources in settings modal
    function renderTokenlistSources() {
      const chainId = getCurrentChainId();
      const chainName = CHAIN_NAMES[String(chainId)] || 'this chain';

      if (tokenlistSources.length === 0) {
        tokenlistSourcesList.innerHTML = '<div class="settings-placeholder">No tokenlists loaded</div>';
        return;
      }

      let html = '';
      for (let i = 0; i < tokenlistSources.length; i++) {
        const source = tokenlistSources[i];
        const isDefault = source.url === null;
        const tokenCount = source.tokens ? countTokensForChain(source.tokens, chainId) : 0;
        const displayName = source.name || (isDefault ? DEFAULT_TOKENLIST_NAME : source.url);
        const hasError = Boolean(source.error);
        const hasChainMismatch = !hasError && tokenCount === 0;

        html += '<div class="tokenlist-entry' + (source.enabled ? '' : ' disabled') + (hasError ? ' error' : '') + '" data-index="' + i + '">';
        html += '<span class="tokenlist-entry-name">' + escapeHtml(displayName) + '</span>';
        html += '<span class="tokenlist-entry-count">' + tokenCount + ' tokens</span>';

        if (hasError) {
          html += '<span class="tokenlist-entry-error">' + escapeHtml(source.error) + '</span>';
          html += '<button type="button" class="btn-small tokenlist-retry-btn" data-action="retry" data-index="' + i + '">Retry</button>';
        } else if (hasChainMismatch) {
          html += '<span class="tokenlist-chain-warning">0 tokens for ' + escapeHtml(chainName) + '</span>';
        }

        // Toggle switch
        html += '<div class="tokenlist-toggle' + (source.enabled ? ' on' : '') + '" data-action="toggle" data-index="' + i + '" role="switch" aria-checked="' + source.enabled + '" tabindex="0"></div>';

        // Remove button (not for default)
        if (!isDefault) {
          html += '<button type="button" class="tokenlist-remove-btn" data-action="remove" data-index="' + i + '" aria-label="Remove tokenlist">&times;</button>';
        }

        html += '</div>';
      }

      tokenlistSourcesList.innerHTML = html;

      // Wire up event handlers
      tokenlistSourcesList.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', handleTokenlistSourceAction);
        if (el.getAttribute('role') === 'switch') {
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTokenlistSourceAction(e);
            }
          });
        }
      });
    }

    // Escape HTML for safe display
    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Handle tokenlist source actions (toggle, remove, retry)
    function handleTokenlistSourceAction(e) {
      const el = e.currentTarget;
      const action = el.dataset.action;
      const index = Number(el.dataset.index);

      if (action === 'toggle') {
        tokenlistSources[index].enabled = !tokenlistSources[index].enabled;
        saveTokenlistSources();
        renderTokenlistSources();
        refreshAutocomplete();
      } else if (action === 'remove') {
        tokenlistSources.splice(index, 1);
        saveTokenlistSources();
        renderTokenlistSources();
        refreshAutocomplete();
      } else if (action === 'retry') {
        const source = tokenlistSources[index];
        source.error = null;
        renderTokenlistSources();
        // Re-fetch the tokenlist
        loadTokenlistSource(source.url, index);
      }
    }

    // Refresh autocomplete dropdowns
    function refreshAutocomplete() {
      if (fromInput.value.trim()) fromAutocomplete.refresh();
      if (toInput.value.trim()) toAutocomplete.refresh();
    }

    // Save tokenlist sources to localStorage
    function saveTokenlistSources() {
      // Save custom tokenlists (excluding default which has url === null)
      const data = tokenlistSources
        .filter(s => s.url !== null)
        .map(s => ({
          url: s.url,
          enabled: s.enabled,
          name: s.name
        }));

      // Save default tokenlist enabled state separately
      const defaultSource = tokenlistSources.find(s => s.url === null);
      const defaultEnabled = defaultSource ? defaultSource.enabled : true;

      try {
        localStorage.setItem(CUSTOM_TOKENLISTS_KEY, JSON.stringify(data));
        localStorage.setItem(DEFAULT_TOKENLIST_ENABLED_KEY, String(defaultEnabled));
      } catch {
        // Ignore storage errors
      }
    }

    // Load tokenlist sources from localStorage
    function loadTokenlistSourcesFromStorage() {
      try {
        const data = localStorage.getItem(CUSTOM_TOKENLISTS_KEY);
        if (data) {
          return JSON.parse(data);
        }
      } catch {
        // Corrupt data, treat as empty
      }
      return null;
    }

    // Migrate old single-URL format to new multi-list format
    function migrateOldTokenlistUrl() {
      try {
        const oldUrl = localStorage.getItem(OLD_CUSTOM_TOKENLIST_URL_KEY);
        if (oldUrl) {
          // Migrate to new format
          const newList = [{ url: oldUrl, enabled: true, name: oldUrl }];
          localStorage.setItem(CUSTOM_TOKENLISTS_KEY, JSON.stringify(newList));
          localStorage.removeItem(OLD_CUSTOM_TOKENLIST_URL_KEY);
          return newList;
        }
      } catch {
        // Ignore migration errors
      }
      return null;
    }

    // Load a tokenlist source and update state
    async function loadTokenlistSource(url, index) {
      try {
        const { tokens, name } = await loadTokenlistFromUrl(url);
        const taggedTokens = tokens.map(t => ({ ...t, _source: name }));
        tokenlistSources[index].tokens = taggedTokens;
        tokenlistSources[index].name = name;
        tokenlistSources[index].error = null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tokenlistSources[index].error = msg;
        tokenlistSources[index].tokens = [];
      }
      renderTokenlistSources();
      refreshAutocomplete();
    }

    // Add a new tokenlist
    // NOTE: If the initial fetch fails, we do NOT add an entry to tokenlistSources.
    // The error is shown only in the status message area. This is per VAL-MULTI-007.
    // Error-state entries with retry UI only exist for lists that were previously
    // loaded successfully but fail on page reload (VAL-MULTI-011).
    async function handleAddTokenlist() {
      const url = String(tokenlistUrlInput.value || '').trim();
      if (!url) {
        setTokenlistMessage('Enter a tokenlist URL', 'error');
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        setTokenlistMessage('Invalid URL format', 'error');
        return;
      }

      // Check for HTTPS
      if (!url.toLowerCase().startsWith('https://')) {
        setTokenlistMessage('URL must use HTTPS', 'error');
        return;
      }

      // Check for duplicate
      const normalizedUrl = normalizeTokenlistUrl(url);
      const isDuplicate = tokenlistSources.some(s =>
        s.url && normalizeTokenlistUrl(s.url) === normalizedUrl
      );
      if (isDuplicate) {
        setTokenlistMessage('This tokenlist is already added', 'error');
        return;
      }

      addTokenlistBtn.disabled = true;
      addTokenlistBtn.textContent = 'Loading...';
      setTokenlistMessage('Fetching tokenlist...', 'loading');

      try {
        // Fetch the tokenlist BEFORE adding to tokenlistSources
        const { tokens, name } = await loadTokenlistFromUrl(url);
        const taggedTokens = tokens.map(t => ({ ...t, _source: name }));

        // Only add to tokenlistSources after successful fetch
        tokenlistSources.push({ url, enabled: true, name, tokens: taggedTokens, error: null });
        saveTokenlistSources();
        setTokenlistMessage('Added "' + escapeHtml(name) + '"', 'success');
        tokenlistUrlInput.value = '';
        renderTokenlistSources();
        refreshAutocomplete();
      } catch (err) {
        // On failure, do NOT add to tokenlistSources - just show error message
        const msg = err instanceof Error ? err.message : String(err);
        setTokenlistMessage('Error: ' + msg, 'error');
      } finally {
        addTokenlistBtn.disabled = false;
        addTokenlistBtn.textContent = 'Load';
      }
    }

    // Wire up button handlers
    addTokenlistBtn.addEventListener('click', handleAddTokenlist);

    // Load on Enter in URL input
    tokenlistUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAddTokenlist();
      }
    });

    // Find token matches for autocomplete
    function findTokenMatches(value, chainId) {
      const query = value.trim().toLowerCase();
      if (!query) return [];

      const normalizedQuery = normalizeAddress(query);
      const tokens = getTokensForChain(chainId);

      // Track which symbols are duplicated across sources
      const symbolCounts = new Map();
      for (const token of tokens) {
        const symbol = String(token.symbol || '').toLowerCase();
        symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
      }

      return tokens
        .filter((token) => {
          const symbol = String(token.symbol || '').toLowerCase();
          const name = String(token.name || '').toLowerCase();
          const address = String(token.address || '').toLowerCase();
          const normalizedAddress = normalizeAddress(address);

          return (
            symbol.includes(query) ||
            name.includes(query) ||
            address.includes(query) ||
            normalizedAddress.includes(normalizedQuery)
          );
        })
        .map(token => {
          const symbol = String(token.symbol || '').toLowerCase();
          const needsDisambiguation = (symbolCounts.get(symbol) || 0) > 1;
          return { ...token, _needsDisambiguation: needsDisambiguation };
        })
        .slice(0, 20);
    }

    // Format token for display: 'SYMBOL (0xFullAddress)' - NEVER truncate
    // This is a project convention in AGENTS.md
    function formatTokenDisplay(symbol, address) {
      const sym = String(symbol || '').trim();
      const addr = String(address || '').trim();
      if (!addr) return sym || '';
      // Show full address - no truncation
      return sym ? sym + ' (' + addr + ')' : addr;
    }

    // Render a small token icon for result display (16px)
    // Returns empty string if token not found or has no logoURI
    // Uses onerror to hide broken images gracefully
    function renderResultTokenIcon(address, chainId) {
      const token = findTokenByAddress(address, chainId);
      if (!token || typeof token.logoURI !== 'string' || !token.logoURI) {
        return '';
      }
      const alt = (token.symbol || 'token') + ' logo';
      // Use onerror to hide broken images gracefully
      return '<img class="result-token-icon" src="' + token.logoURI + '" alt="' + alt + '" onerror="this.style.display=\\'none\\'">';
    }

    // Extract address from display format or data-address attribute
    function extractAddressFromInput(input) {
      // First check data-address attribute
      const dataAddr = input.dataset.address;
      if (dataAddr && /^0x[a-fA-F0-9]{40}$/.test(dataAddr)) {
        return dataAddr;
      }
      
      const value = String(input.value || '').trim();
      
      // Check if it's already a plain address
      if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return value;
      }
      
      // Try to extract from 'SYMBOL (0xABCD...1234)' format
      // The pattern is: (0xHEX...HEX)
      if (value.includes('...') && value.includes('(') && value.includes(')')) {
        // We only have partial address in display, need full from data-address
        return dataAddr || value;
      }
      
      // Check for partial address pattern that might be a real address
      if (value.startsWith('0x') && value.length >= 6) {
        // Could be a partial or full address - if we have data-address use it
        if (dataAddr) return dataAddr;
      }
      
      return value; // Return as-is, validation will catch issues
    }

    // Handle token swap when setting a token to the same value as the other field
    // If user sets from=A when to=A: swap (to becomes old-from, from becomes A)
    // If user sets to=A when from=A: swap (from becomes old-to, to becomes A)
    // If the other field was empty: just set the new value (no swap needed)
    function handleTokenSwapIfNeeded(currentInput, newAddress, newDisplay) {
      const isFromInput = currentInput === fromInput;
      const otherInput = isFromInput ? toInput : fromInput;
      const otherAddress = extractAddressFromInput(otherInput);

      // Only proceed if the other field has a valid address (not just typed text or empty)
      if (!isAddressLike(otherAddress)) {
        return;
      }

      // Normalize addresses for comparison
      const normalizedNew = String(newAddress || '').toLowerCase().trim();
      const normalizedOther = String(otherAddress || '').toLowerCase().trim();

      // Check if we're setting the same token as the other field
      if (normalizedNew && normalizedOther && normalizedNew === normalizedOther) {
        // Get current address before it changes (from data-address attribute)
        const currentAddress = extractAddressFromInput(currentInput);

        // Only swap if the current field also has a valid different address
        if (isAddressLike(currentAddress) && currentAddress.toLowerCase() !== normalizedNew) {
          // There was a different valid value in the current field - swap it to the other field
          // Reconstruct the display value using the token's symbol
          const chainId = getCurrentChainId();
          const token = findTokenByAddress(currentAddress, chainId);
          const swappedDisplay = token
            ? formatTokenDisplay(token.symbol, token.address)
            : currentAddress;
          otherInput.value = swappedDisplay;
          otherInput.dataset.address = currentAddress;
          // Update icon for the swapped field
          if (otherInput === fromInput) {
            updateTokenInputIcon(fromInput, fromIcon, fromWrapper, token);
          } else if (otherInput === toInput) {
            updateTokenInputIcon(toInput, toIcon, toWrapper, token);
          }
          // Update balance for the swapped field
          if (otherInput === fromInput) {
            void updateFromTokenBalance();
          } else if (otherInput === toInput) {
            void updateToTokenBalance();
          }
        }
        // If current field was empty or had non-address content, leave the other field unchanged
        // (no swap needed - just let the new value be set in the current field)
      }
    }

    function setupAutocomplete(inputId, listId) {
      const input = document.getElementById(inputId);
      const list = document.getElementById(listId);
      let matches = [];
      let activeIdx = -1;

      function hide() {
        list.classList.remove('show');
        list.innerHTML = '';
        matches = [];
        activeIdx = -1;
      }

      function selectToken(token) {
        // Handle token swap if setting to same value as other field
        const newDisplay = formatTokenDisplay(token.symbol, token.address);
        handleTokenSwapIfNeeded(input, token.address, newDisplay);
        // Show 'SYMBOL (0xABCD...1234)' format in input
        input.value = newDisplay;
        // Store full address in data-address attribute
        input.dataset.address = token.address;
        // Update token icon in input field
        if (input === fromInput) {
          updateTokenInputIcon(fromInput, fromIcon, fromWrapper, token);
        } else if (input === toInput) {
          updateTokenInputIcon(toInput, toIcon, toWrapper, token);
        }
        hide();
        // Update balance for this token field
        if (input === fromInput) {
          void updateFromTokenBalance();
        } else if (input === toInput) {
          void updateToTokenBalance();
        }
      }

      function setActive(index) {
        const items = list.querySelectorAll('.autocomplete-item');
        items.forEach((el, i) => el.classList.toggle('active', i === index));
      }

      function render() {
        list.innerHTML = '';
        activeIdx = -1;
        if (!matches.length) {
          list.classList.remove('show');
          return;
        }

        const fragment = document.createDocumentFragment();
        matches.forEach((token) => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';

          const logo = document.createElement('img');
          logo.className = 'autocomplete-logo';
          logo.alt = token.symbol ? token.symbol + ' logo' : 'token logo';
          logo.loading = 'lazy';
          if (typeof token.logoURI === 'string' && token.logoURI) {
            logo.src = token.logoURI;
          }
          logo.onerror = () => {
            logo.style.display = 'none';
          };

          const meta = document.createElement('div');
          meta.className = 'autocomplete-meta';

          const title = document.createElement('div');
          title.className = 'autocomplete-title';

          const symbol = document.createElement('span');
          symbol.className = 'autocomplete-symbol';
          symbol.textContent = token.symbol || '';

          const name = document.createElement('span');
          name.className = 'autocomplete-name';
          name.textContent = token.name || '';

          title.appendChild(symbol);
          title.appendChild(name);

          // Add source badge if disambiguation is needed
          if (token._needsDisambiguation && token._source) {
            const sourceBadge = document.createElement('span');
            sourceBadge.className = 'autocomplete-source';
            sourceBadge.textContent = token._source;
            title.appendChild(sourceBadge);
          }

          const address = document.createElement('div');
          address.className = 'autocomplete-addr';
          address.textContent = token.address || '';

          meta.appendChild(title);
          meta.appendChild(address);

          item.appendChild(logo);
          item.appendChild(meta);

          item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            selectToken(token);
          });

          fragment.appendChild(item);
        });

        list.appendChild(fragment);
        list.classList.add('show');
      }

      function refresh() {
        const chainId = getCurrentChainId();
        matches = findTokenMatches(input.value, chainId);
        render();
        // Clear icon when input is cleared
        if (!input.value.trim()) {
          input.dataset.address = '';
          if (input === fromInput) {
            clearTokenInputIcon(fromWrapper, fromIcon);
          } else if (input === toInput) {
            clearTokenInputIcon(toWrapper, toIcon);
          }
        }
      }

      input.addEventListener('input', refresh);
      input.addEventListener('focus', () => {
        if (input.value.trim()) {
          refresh();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          if (!matches.length) return;
          e.preventDefault();
          activeIdx = Math.min(activeIdx + 1, matches.length - 1);
          setActive(activeIdx);
        } else if (e.key === 'ArrowUp') {
          if (!matches.length) return;
          e.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          setActive(activeIdx);
        } else if (e.key === 'Enter' && list.classList.contains('show')) {
          if (!matches.length) return;
          e.preventDefault();
          const selectedIndex = activeIdx >= 0 ? activeIdx : 0;
          selectToken(matches[selectedIndex]);
        } else if (e.key === 'Escape') {
          hide();
        }
      });

      document.addEventListener('mousedown', (event) => {
        if (event.target === input || list.contains(event.target)) {
          return;
        }
        hide();
      });

      document.getElementById('chainId').addEventListener('change', () => {
        if (input.value.trim()) {
          refresh();
        } else {
          hide();
        }
      });

      return {
        refresh,
        hide,
      };
    }

    const fromAutocomplete = setupAutocomplete('from', 'fromAutocomplete');
    const toAutocomplete = setupAutocomplete('to', 'toAutocomplete');

    const form = document.getElementById('form');
    const result = document.getElementById('result');
    const submit = document.getElementById('submit');
    const recommendedContent = document.getElementById('recommendedContent');
    const alternativeContent = document.getElementById('alternativeContent');
    const tabRecommended = document.getElementById('tabRecommended');
    const tabAlternative = document.getElementById('tabAlternative');

    function cloneCompareParams(params) {
      return {
        chainId: String(params.chainId || '').trim(),
        from: String(params.from || '').trim(),
        to: String(params.to || '').trim(),
        amount: String(params.amount || '').trim(),
        slippageBps: String(params.slippageBps || '').trim(),
        sender: String(params.sender || '').trim(),
        mode: String(params.mode || 'exactIn').trim(),
      };
    }

    function readCompareParamsFromForm() {
      return cloneCompareParams({
        chainId: String(getCurrentChainId()),
        from: extractAddressFromInput(fromInput),
        to: extractAddressFromInput(toInput),
        amount: amountInput.value,
        slippageBps: slippageInput.value,
        sender: hasConnectedWallet() ? connectedWalletAddressValue : '',
        mode: currentQuoteMode,
      });
    }

    function compareParamsToSearchParams(params) {
      const normalized = cloneCompareParams(params);
      const query = new URLSearchParams({
        chainId: normalized.chainId,
        from: normalized.from,
        to: normalized.to,
        amount: normalized.amount,
        slippageBps: normalized.slippageBps,
        mode: normalized.mode,
      });

      if (normalized.sender) {
        query.set('sender', normalized.sender);
      }

      return query;
    }

    function updateUrlFromCompareParams(params) {
      const normalized = cloneCompareParams(params);
      const url = new URL(window.location.href);
      url.searchParams.set('chainId', normalized.chainId);
      url.searchParams.set('from', normalized.from);
      url.searchParams.set('to', normalized.to);
      url.searchParams.set('amount', normalized.amount);
      url.searchParams.set('slippageBps', normalized.slippageBps);
      // Only add mode to URL if it's not the default
      if (normalized.mode && normalized.mode !== 'exactIn') {
        url.searchParams.set('mode', normalized.mode);
      } else {
        url.searchParams.delete('mode');
      }
      // Sender is never written to URL - it comes from wallet connection state
      url.searchParams.delete('sender');
      // Remove MEV protection param if it exists (no longer used)
      url.searchParams.delete('mevProtection');
      window.history.replaceState({}, '', url.toString());
    }

    function clearAutoRefreshTimer() {
      if (autoRefreshState.timerId !== null) {
        clearInterval(autoRefreshState.timerId);
        autoRefreshState.timerId = null;
      }
    }

    function updateRefreshIndicator() {
      const shouldShow = result.classList.contains('show') && Boolean(autoRefreshState.lastParams);
      refreshIndicator.hidden = !shouldShow;
      if (!shouldShow) {
        return;
      }

      if (autoRefreshState.paused) {
        refreshCountdown.textContent = 'Auto-refresh paused';
      } else if (autoRefreshState.inFlight) {
        refreshCountdown.textContent = 'Refreshing...';
      } else {
        refreshCountdown.textContent = 'Auto-refresh in ' + autoRefreshState.secondsRemaining + 's';
      }

      refreshStatus.classList.remove('error');
      if (autoRefreshState.errorMessage) {
        refreshStatus.textContent = autoRefreshState.errorMessage;
        refreshStatus.classList.add('error');
      } else if (autoRefreshState.paused) {
        refreshStatus.textContent = 'Waiting for transaction.';
      } else {
        refreshStatus.textContent = '';
      }
    }

    function stopAutoRefresh(options = {}) {
      const shouldClearLastParams = options.clearLastParams !== false;
      clearAutoRefreshTimer();
      autoRefreshState.paused = false;
      autoRefreshState.inFlight = false;
      autoRefreshState.secondsRemaining = AUTO_REFRESH_SECONDS;
      autoRefreshState.errorMessage = '';
      if (shouldClearLastParams) {
        autoRefreshState.lastParams = null;
      }
      updateRefreshIndicator();
    }

    function startAutoRefreshCountdown(options = {}) {
      const clearErrorMessage = options.clearErrorMessage !== false;
      if (!autoRefreshState.lastParams || autoRefreshState.paused) {
        updateRefreshIndicator();
        return;
      }

      clearAutoRefreshTimer();
      autoRefreshState.secondsRemaining = AUTO_REFRESH_SECONDS;
      if (clearErrorMessage) {
        autoRefreshState.errorMessage = '';
      }

      autoRefreshState.timerId = setInterval(() => {
        if (autoRefreshState.paused || autoRefreshState.inFlight || !autoRefreshState.lastParams) {
          updateRefreshIndicator();
          return;
        }

        autoRefreshState.secondsRemaining -= 1;
        if (autoRefreshState.secondsRemaining <= 0) {
          clearAutoRefreshTimer();
          void runAutoRefreshCycle();
          return;
        }

        updateRefreshIndicator();
      }, 1000);

      updateRefreshIndicator();
    }

    function beginAutoRefresh(params) {
      autoRefreshState.lastParams = cloneCompareParams(params);
      autoRefreshState.paused = false;
      autoRefreshState.inFlight = false;
      startAutoRefreshCountdown();
    }

    function pauseAutoRefreshForTransaction() {
      if (!autoRefreshState.lastParams) {
        return;
      }

      autoRefreshState.paused = true;
      clearAutoRefreshTimer();
      updateRefreshIndicator();
    }

    function resumeAutoRefreshAfterTransaction() {
      if (!autoRefreshState.lastParams) {
        return;
      }

      autoRefreshState.paused = false;
      autoRefreshState.inFlight = false;
      startAutoRefreshCountdown();
    }

    function getRefreshParams() {
      if (!autoRefreshState.lastParams) {
        return null;
      }

      const params = cloneCompareParams(autoRefreshState.lastParams);
      if (hasConnectedWallet()) {
        params.sender = connectedWalletAddressValue;
      }

      return params;
    }

    function getActiveTab() {
      const active = document.querySelector('.tab.active');
      if (!(active instanceof HTMLElement)) {
        return 'recommended';
      }

      return active.dataset.tab === 'alternative' ? 'alternative' : 'recommended';
    }

    function setActiveTab(tabName) {
      const target = tabName === 'alternative' && tabAlternative.style.display !== 'none' ? 'alternative' : 'recommended';
      tabRecommended.classList.toggle('active', target === 'recommended');
      tabAlternative.classList.toggle('active', target === 'alternative');
      recommendedContent.classList.toggle('active', target === 'recommended');
      alternativeContent.classList.toggle('active', target === 'alternative');
    }

    function captureResultUiState() {
      return {
        activeTab: getActiveTab(),
        scrollY: window.scrollY,
      };
    }

    function clearResultDisplay() {
      result.classList.remove('show');
      tabRecommended.textContent = 'Recommended';
      tabAlternative.textContent = 'Alternative';
      tabAlternative.style.display = '';
      recommendedContent.innerHTML = '';
      alternativeContent.innerHTML = '';
      setActiveTab('recommended');
      updateRefreshIndicator();
    }

    function findTokenByAddress(address, chainId) {
      const addr = String(address || '').toLowerCase();
      const cid = Number(chainId);
      // Search through enabled sources only
      for (const source of tokenlistSources) {
        if (!source.enabled || !source.tokens) continue;
        const found = source.tokens.find((t) =>
          Number(t.chainId) === cid &&
          String(t.address || '').toLowerCase() === addr
        );
        if (found) return found;
      }
      // Search local tokens
      const localTokens = loadLocalTokenList();
      const foundLocal = localTokens.find((t) =>
        Number(t.chainId) === cid &&
        String(t.address || '').toLowerCase() === addr
      );
      if (foundLocal) return foundLocal;
      return undefined;
    }

    // Token Balance Display
    const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    const BALANCE_CACHE_TTL_MS = 30 * 1000; // 30 seconds
    const balanceCache = new Map(); // key: chainId:tokenAddress:walletAddress -> { balance, timestamp }

    function isNativeToken(address) {
      const addr = String(address || '').toLowerCase();
      return addr === '0x0000000000000000000000000000000000000000' ||
             addr === NATIVE_TOKEN_ADDRESS.toLowerCase();
    }

    async function fetchTokenBalance(provider, tokenAddress, walletAddress, decimals, chainId) {
      if (!provider || !walletAddress || !tokenAddress) return null;

      const cacheKey = chainId + ':' + tokenAddress.toLowerCase() + ':' + walletAddress.toLowerCase();
      const cached = balanceCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < BALANCE_CACHE_TTL_MS) {
        return cached.balance;
      }

      try {
        let balance;
        if (isNativeToken(tokenAddress)) {
          // Native ETH: use eth_getBalance
          const result = await provider.request({
            method: 'eth_getBalance',
            params: [walletAddress, 'latest'],
          });
          balance = BigInt(result);
        } else {
          // ERC-20: use eth_call with balanceOf selector
          const balanceOfSelector = '0x70a08231'; // balanceOf(address)
          const paddedAddress = walletAddress.slice(2).padStart(64, '0');
          const data = balanceOfSelector + paddedAddress;
          const result = await provider.request({
            method: 'eth_call',
            params: [{ to: tokenAddress, data }, 'latest'],
          });
          balance = BigInt(result);
        }

        const formatted = formatBalance(balance, decimals);
        balanceCache.set(cacheKey, { balance: formatted, timestamp: Date.now() });
        return formatted;
      } catch {
        // Silently fail - don't show error UI
        return null;
      }
    }

    function formatBalance(balance, decimals) {
      const dec = Number(decimals) || 18;
      const divisor = BigInt(10 ** dec);
      const wholePart = balance / divisor;
      const fractionalPart = balance % divisor;

      // Format fractional part with leading zeros
      let fractionalStr = fractionalPart.toString().padStart(dec, '0');
      // Remove trailing zeros
      fractionalStr = fractionalStr.replace(/0+$/, '');
      // Limit to 6 decimal places for display
      if (fractionalStr.length > 6) fractionalStr = fractionalStr.slice(0, 6);

      // Format whole part with thousand separators
      const wholeStr = String(wholePart).replace(new RegExp('\\\\B(?=(\\\\d{3})+(?!\\\\d))', 'g'), ',');
      
      return fractionalStr ? wholeStr + '.' + fractionalStr : wholeStr;
    }

    const fromBalanceEl = document.getElementById('fromBalance');
    const toBalanceEl = document.getElementById('toBalance');

    function clearTokenBalances() {
      fromBalanceEl.hidden = true;
      fromBalanceEl.textContent = '';
      toBalanceEl.hidden = true;
      toBalanceEl.textContent = '';
    }

    async function updateFromTokenBalance() {
      if (!hasConnectedWallet()) {
        fromBalanceEl.hidden = true;
        return;
      }

      const tokenAddress = fromInput.dataset.address;
      if (!tokenAddress) {
        fromBalanceEl.hidden = true;
        return;
      }

      const chainId = getCurrentChainId();
      const token = findTokenByAddress(tokenAddress, chainId);
      const decimals = token ? token.decimals : 18;

      fromBalanceEl.textContent = 'Balance: ...';
      fromBalanceEl.hidden = false;

      const balance = await fetchTokenBalance(
        connectedWalletProvider,
        tokenAddress,
        connectedWalletAddressValue,
        decimals,
        chainId
      );

      if (balance !== null) {
        fromBalanceEl.textContent = 'Balance: ' + balance;
        fromBalanceEl.hidden = false;
      } else {
        fromBalanceEl.hidden = true;
      }
    }

    async function updateToTokenBalance() {
      if (!hasConnectedWallet()) {
        toBalanceEl.hidden = true;
        return;
      }

      const tokenAddress = toInput.dataset.address;
      if (!tokenAddress) {
        toBalanceEl.hidden = true;
        return;
      }

      const chainId = getCurrentChainId();
      const token = findTokenByAddress(tokenAddress, chainId);
      const decimals = token ? token.decimals : 18;

      toBalanceEl.textContent = 'Balance: ...';
      toBalanceEl.hidden = false;

      const balance = await fetchTokenBalance(
        connectedWalletProvider,
        tokenAddress,
        connectedWalletAddressValue,
        decimals,
        chainId
      );

      if (balance !== null) {
        toBalanceEl.textContent = 'Balance: ' + balance;
        toBalanceEl.hidden = false;
      } else {
        toBalanceEl.hidden = true;
      }
    }

    function updateTokenBalances() {
      void updateFromTokenBalance();
      void updateToTokenBalance();
    }

    function applyDefaults(chainId, options = {}) {
      const skipSavedTokens = options.skipSavedTokens === true;
      const defaults = DEFAULT_TOKENS[chainId];
      if (defaults) {
        // Check for saved per-chain tokens first (unless skipped)
        let fromAddr = defaults.from;
        let toAddr = defaults.to;

        if (!skipSavedTokens) {
          const saved = getSavedTokensForChain(chainId);
          if (saved) {
            if (saved.from) fromAddr = saved.from;
            if (saved.to) toAddr = saved.to;
          }
        }

        const fromToken = findTokenByAddress(fromAddr, chainId);
        const toToken = findTokenByAddress(toAddr, chainId);

        // Set from input with display format and data-address
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
          updateTokenInputIcon(fromInput, fromIcon, fromWrapper, fromToken);
        } else {
          fromInput.value = fromAddr;
          fromInput.dataset.address = fromAddr;
          clearTokenInputIcon(fromWrapper, fromIcon);
        }

        // Set to input with display format and data-address
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
          updateTokenInputIcon(toInput, toIcon, toWrapper, toToken);
        } else {
          toInput.value = toAddr;
          toInput.dataset.address = toAddr;
          clearTokenInputIcon(toWrapper, toIcon);
        }
      }
    }

    chainIdInput.addEventListener('change', () => {
      stopAutoRefresh();
      clearResultDisplay();
      currentQuoteChainId = null;
      applyDefaults(Number(getCurrentChainId()));
      fromAutocomplete.hide();
      toAutocomplete.hide();
      // Update modal content if modal is open
      if (mevModal.classList.contains('show')) {
        renderMevChainContent();
      }
      // Clear balance cache on chain change and refetch balances
      balanceCache.clear();
      updateTokenBalances();
    });

    // MEV Modal event listeners
    mevInfoBtn.addEventListener('click', openMevModal);

    mevModalClose.addEventListener('click', closeMevModal);

    // Close modal on overlay click (outside the modal)
    mevModal.addEventListener('click', (event) => {
      if (event.target === mevModal) {
        closeMevModal();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mevModal.classList.contains('show')) {
        closeMevModal();
      }
      if (event.key === 'Escape' && settingsModal.classList.contains('show')) {
        closeSettingsModal();
      }
      if (event.key === 'Escape' && swapConfirmModal.classList.contains('show')) {
        closeSwapConfirmModal();
      }
    });

    // Settings Modal event listeners
    settingsBtn.addEventListener('click', openSettingsModal);

    settingsModalClose.addEventListener('click', closeSettingsModal);

    // Close settings modal on overlay click (outside the modal)
    settingsModal.addEventListener('click', (event) => {
      if (event.target === settingsModal) {
        closeSettingsModal();
      }
    });

    // Swap Confirmation Modal event listeners
    swapConfirmModalClose.addEventListener('click', closeSwapConfirmModal);

    // Close swap confirmation modal on overlay click (outside the modal)
    swapConfirmModal.addEventListener('click', (event) => {
      if (event.target === swapConfirmModal) {
        closeSwapConfirmModal();
      }
    });

    swapConfirmWaitBtn.addEventListener('click', handleSwapConfirmWait);
    swapConfirmProceedBtn.addEventListener('click', () => {
      void handleSwapConfirmProceed();
    });

    // Focus trap for swap confirmation modal (Tab/Shift+Tab)
    swapConfirmModal.addEventListener('keydown', handleSwapConfirmModalKeydown);

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        setActiveTab(tab.dataset.tab);
      });
    });

    function renderQuoteActions(options) {
      const quoteChainId = String(options.quoteChainId || '');
      const routerAddress = String(options.routerAddress || '');
      const routerCalldata = String(options.routerCalldata || '');
      const routerValue = String(options.routerValue || '0x0');
      const approvalToken = String(options.approvalToken || '');
      const approvalSpender = String(options.approvalSpender || '');
      const approvalRequired = Boolean(approvalToken && approvalSpender);
      const walletRequiredClass = hasConnectedWallet() ? '' : ' wallet-required';

      // Step indicator pattern: show numbered steps when approval is required
      // When no approval needed, show only the Swap button
      if (approvalRequired) {
        return (
          '<div class="tx-actions" data-quote-chain-id="' + quoteChainId + '" data-router-address="' + routerAddress +
          '" data-router-calldata="' + routerCalldata + '" data-router-value="' + routerValue +
          '" data-approval-token="' + approvalToken + '" data-approval-spender="' + approvalSpender + '">' +
            '<div class="tx-steps">' +
              '<div class="tx-step">' +
                '<span class="tx-step-num">1.</span>' +
                '<button type="button" class="tx-btn approve-btn' + walletRequiredClass + '" data-action="approve">Approve</button>' +
              '</div>' +
              '<div class="tx-step">' +
                '<span class="tx-step-num">2.</span>' +
                '<button type="button" class="tx-btn swap-btn disabled' + walletRequiredClass + '" data-action="swap" disabled>Swap</button>' +
              '</div>' +
            '</div>' +
            '<div class="tx-status" aria-live="polite"></div>' +
          '</div>'
        );
      } else {
        // No approval needed - show only Swap button, no step indicators
        return (
          '<div class="tx-actions" data-quote-chain-id="' + quoteChainId + '" data-router-address="' + routerAddress +
          '" data-router-calldata="' + routerCalldata + '" data-router-value="' + routerValue +
          '" data-approval-token="" data-approval-spender="">' +
            '<div class="tx-steps">' +
              '<button type="button" class="tx-btn swap-btn' + walletRequiredClass + '" data-action="swap">Swap</button>' +
            '</div>' +
            '<div class="tx-status" aria-live="polite"></div>' +
          '</div>'
        );
      }
    }

    // Render secondary details (collapsible)
    function renderSecondaryDetails(data, type) {
      const details = [];

      details.push('<div class="field"><div class="field-label">Router Address</div><div class="field-value">' + data.router_address + '</div></div>');
      details.push('<div class="field"><div class="field-label">Router Calldata</div><div class="field-value field-value-compact">' + data.router_calldata.slice(0, 100) + (data.router_calldata.length > 100 ? '...' : '') + '</div></div>');

      if (data.router_value) {
        details.push('<div class="field"><div class="field-label">Router Value (wei)</div><div class="field-value number">' + data.router_value + '</div></div>');
      }

      // Show wei values for input and output amounts (raw integers from API)
      if (data.input_amount_raw) {
        details.push('<div class="field"><div class="field-label">Input Amount (wei)</div><div class="field-value number mono">' + data.input_amount_raw + '</div></div>');
      }
      if (data.output_amount_raw) {
        details.push('<div class="field"><div class="field-label">Output Amount (wei)</div><div class="field-value number mono">' + data.output_amount_raw + '</div></div>');
      }

      if (data.approval_token) {
        details.push('<div class="field"><div class="field-label">Approval Token</div><div class="field-value">' + data.approval_token + '</div></div>');
        details.push('<div class="field"><div class="field-label">Approval Spender</div><div class="field-value">' + data.approval_spender + '</div></div>');
      }
      
      // Show Gas Cost in ETH (preferred) or Gas Used (fallback)
      if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
        details.push('<div class="field"><div class="field-label">Gas Cost</div><div class="field-value number">' + data.gas_cost_eth + ' ETH</div></div>');
        // Also show raw gas units as secondary info
        const gasUsed = data.gas_used && Number(data.gas_used) > 0 ? data.gas_used : null;
        if (gasUsed) {
          details.push('<div class="field"><div class="field-label">Gas Units</div><div class="field-value number">' + gasUsed + '</div></div>');
        }
      } else {
        // Fallback to raw gas units if ETH cost not available
        const gasUsed = data.gas_used && Number(data.gas_used) > 0 ? data.gas_used : null;
        details.push('<div class="field"><div class="field-label">Gas Used</div><div class="field-value number">' + (gasUsed || 'N/A') + '</div></div>');
      }
      
      // Show net value in ETH if available
      if (data.net_value_eth && Number(data.net_value_eth) > 0) {
        details.push('<div class="field"><div class="field-label">Net Value (after gas)</div><div class="field-value number">' + data.net_value_eth + ' ETH</div></div>');
      }
      
      if (type === 'spandex' && data.slippage_bps) {
        details.push('<div class="field"><div class="field-label">Slippage</div><div class="field-value number">' + data.slippage_bps + ' bps</div></div>');
      }
      
      return details.join('');
    }

    function renderSpandexQuote(data, isWinner, quoteChainId, gasPriceGwei) {
      const recommendationLabel = isWinner ? '<span class="result-recommendation winner">RECOMMENDED</span>' : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
      const primaryClass = isWinner ? 'result-primary winner' : 'result-primary alternative';
      const providerLabel = 'Spandex' + (data.provider ? ' / ' + data.provider : '');

      // Handle mode-specific display
      const isTargetOut = data.mode === 'targetOut';
      // In targetOut mode: amount is the desired output, input_amount is what you pay
      // In exactIn mode: amount is the input, output_amount is what you receive
      const primaryAmount = isTargetOut ? data.input_amount : data.output_amount;
      const primarySymbol = isTargetOut ? data.from_symbol : data.to_symbol;
      const primaryLabel = isTargetOut ? 'You pay (required)' : 'You receive (estimated)';
      const primaryTokenAddress = isTargetOut ? data.from : data.to;

      // Get token icons for result display
      const primaryIcon = renderResultTokenIcon(primaryTokenAddress, quoteChainId);
      const fromIcon = renderResultTokenIcon(data.from, quoteChainId);
      const toIcon = renderResultTokenIcon(data.to, quoteChainId);

      // Build gas info line for primary display (Gas Cost and Gas Price together)
      let gasInfoLine = '';
      if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
        gasInfoLine = '<div class="field field-spaced"><div class="field-label">Gas Cost</div><div class="field-value number">' + data.gas_cost_eth + ' ETH</div></div>';
        if (gasPriceGwei) {
          gasInfoLine += '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' + gasPriceGwei + ' gwei</div></div>';
        }
      } else if (gasPriceGwei) {
        gasInfoLine = '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' + gasPriceGwei + ' gwei</div></div>';
      }

      // Primary section: output + buttons inline
      const primary =
        '<div class="' + primaryClass + '">' +
          recommendationLabel +
          '<div class="result-output-label">' + primaryLabel + '</div>' +
          '<div class="result-output">' + primaryAmount + (primarySymbol ? ' ' + primaryIcon + primarySymbol : '') + '</div>' +
          '<div class="field field-spaced"><div class="field-label">Via ' + providerLabel + '</div></div>' +
          gasInfoLine +
          renderQuoteActions({
            quoteChainId,
            routerAddress: data.router_address,
            routerCalldata: data.router_calldata,
            routerValue: data.router_value || '0x0',
            approvalToken: data.approval_token || '',
            approvalSpender: data.approval_spender || '',
          }) +
        '</div>';

      // Secondary details (collapsible)
      const secondary =
        '<button type="button" class="details-toggle" onclick="this.classList.toggle(\\'open\\'); this.nextElementSibling.classList.toggle(\\'open\\');">Details</button>' +
        '<div class="details-content">' +
          '<div class="field"><div class="field-label">From</div><div class="field-value">' + fromIcon + (data.from_symbol ? data.from_symbol + ' ' : '') + data.from + '</div></div>' +
          '<div class="field"><div class="field-label">To</div><div class="field-value">' + toIcon + (data.to_symbol ? data.to_symbol + ' ' : '') + data.to + '</div></div>' +
          '<div class="field"><div class="field-label">' + (isTargetOut ? 'Output Amount (desired)' : 'Input Amount') + '</div><div class="field-value number">' + data.amount + (isTargetOut && data.to_symbol ? ' ' + toIcon + data.to_symbol : (!isTargetOut && data.from_symbol ? ' ' + fromIcon + data.from_symbol : '')) + '</div></div>' +
          '<div class="field"><div class="field-label">' + (isTargetOut ? 'Input Amount (required)' : 'Output Amount') + '</div><div class="field-value number">' + (isTargetOut ? data.input_amount + (data.from_symbol ? ' ' + fromIcon + data.from_symbol : '') : data.output_amount + (data.to_symbol ? ' ' + toIcon + data.to_symbol : '')) + '</div></div>' +
          renderSecondaryDetails(data, 'spandex') +
        '</div>';

      return primary + secondary;
    }

    function formatCurveRoute(route, symbols) {
      if (!route || route.length === 0) return '';
      return route.map((step, i) => {
        const poolName = step.poolName || step.poolId || 'Unknown Pool';
        const inputSymbol = symbols[step.inputCoinAddress?.toLowerCase()] || '';
        const outputSymbol = symbols[step.outputCoinAddress?.toLowerCase()] || '';
        return '<div class="route-step">' +
          '<div class="route-step-header">Step ' + (i + 1) + ': ' + poolName + '</div>' +
          '<div class="field"><div class="field-label">Input</div><div class="field-value">' + (inputSymbol ? inputSymbol + ' ' : '') + (step.inputCoinAddress || '') + '</div></div>' +
          '<div class="field"><div class="field-label">Output</div><div class="field-value">' + (outputSymbol ? outputSymbol + ' ' : '') + (step.outputCoinAddress || '') + '</div></div>' +
        '</div>';
      }).join('');
    }

    function renderCurveQuote(data, isWinner, quoteChainId, gasPriceGwei) {
      const symbols = {};
      symbols[data.from.toLowerCase()] = data.from_symbol;
      symbols[data.to.toLowerCase()] = data.to_symbol;
      if (data.route_symbols) {
        Object.entries(data.route_symbols).forEach(([k, v]) => { symbols[k.toLowerCase()] = v; });
      }

      const recommendationLabel = isWinner ? '<span class="result-recommendation winner">RECOMMENDED</span>' : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
      const primaryClass = isWinner ? 'result-primary winner' : 'result-primary alternative';

      // Handle mode-specific display
      const isTargetOut = data.mode === 'targetOut';
      const primaryAmount = isTargetOut ? data.input_amount : data.output_amount;
      const primarySymbol = isTargetOut ? data.from_symbol : data.to_symbol;
      const primaryLabel = isTargetOut ? 'You pay (required)' : 'You receive (estimated)';
      const primaryTokenAddress = isTargetOut ? data.from : data.to;

      // Get token icons for result display
      const primaryIcon = renderResultTokenIcon(primaryTokenAddress, quoteChainId);
      const fromIcon = renderResultTokenIcon(data.from, quoteChainId);
      const toIcon = renderResultTokenIcon(data.to, quoteChainId);

      // Build gas info line for primary display (Gas Cost and Gas Price together)
      let gasInfoLine = '';
      if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
        gasInfoLine = '<div class="field field-spaced"><div class="field-label">Gas Cost</div><div class="field-value number">' + data.gas_cost_eth + ' ETH</div></div>';
        if (gasPriceGwei) {
          gasInfoLine += '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' + gasPriceGwei + ' gwei</div></div>';
        }
      } else if (gasPriceGwei) {
        gasInfoLine = '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' + gasPriceGwei + ' gwei</div></div>';
      }

      // Primary section: output + buttons inline
      const primary =
        '<div class="' + primaryClass + '">' +
          recommendationLabel +
          '<div class="result-output-label">' + primaryLabel + '</div>' +
          '<div class="result-output">' + primaryAmount + (primarySymbol ? ' ' + primaryIcon + primarySymbol : '') + '</div>' +
          '<div class="field field-spaced"><div class="field-label">Via Curve</div></div>' +
          gasInfoLine +
          renderQuoteActions({
            quoteChainId,
            routerAddress: data.router_address,
            routerCalldata: data.router_calldata,
            routerValue: '0x0',
            approvalToken: data.from || '',
            approvalSpender: data.approval_target || '',
          }) +
        '</div>';

      // Secondary details (collapsible)
      const secondary =
        '<button type="button" class="details-toggle" onclick="this.classList.toggle(\\'open\\'); this.nextElementSibling.classList.toggle(\\'open\\');">Details</button>' +
        '<div class="details-content">' +
          '<div class="field"><div class="field-label">From</div><div class="field-value">' + fromIcon + (data.from_symbol ? data.from_symbol + ' ' : '') + data.from + '</div></div>' +
          '<div class="field"><div class="field-label">To</div><div class="field-value">' + toIcon + (data.to_symbol ? data.to_symbol + ' ' : '') + data.to + '</div></div>' +
          '<div class="field"><div class="field-label">' + (isTargetOut ? 'Output Amount (desired)' : 'Input Amount') + '</div><div class="field-value number">' + data.amount + (isTargetOut && data.to_symbol ? ' ' + toIcon + data.to_symbol : (!isTargetOut && data.from_symbol ? ' ' + fromIcon + data.from_symbol : '')) + '</div></div>' +
          '<div class="field"><div class="field-label">' + (isTargetOut ? 'Input Amount (required)' : 'Output Amount') + '</div><div class="field-value number">' + (isTargetOut ? data.input_amount + (data.from_symbol ? ' ' + fromIcon + data.from_symbol : '') : data.output_amount + (data.to_symbol ? ' ' + toIcon + data.to_symbol : '')) + '</div></div>' +
          (data.route && data.route.length > 0 ? '<div class="field"><div class="field-label">Route (' + data.route.length + ' steps)</div>' + formatCurveRoute(data.route, symbols) + '</div>' : '') +
          (data.approval_target ? '<div class="field"><div class="field-label">Approval Target</div><div class="field-value">' + data.approval_target + '</div></div>' : '') +
          renderSecondaryDetails(data, 'curve') +
        '</div>';

      return primary + secondary;
    }

    // Format error message with clickable token references
    // Finds addresses in the message and wraps them with symbol display + copy functionality
    function formatErrorWithTokenRefs(message, chainId) {
      // Regex to find Ethereum addresses (0x followed by 40 hex chars)
      const addressRegex = /0x[a-fA-F0-9]{40}/g;
      const tokens = getTokensForChain(chainId);

      // Build a map of address -> symbol for quick lookup
      const symbolByAddress = new Map();
      for (const token of tokens) {
        const addrLower = token.address.toLowerCase();
        if (!symbolByAddress.has(addrLower)) {
          symbolByAddress.set(addrLower, token.symbol || '');
        }
      }

      // Replace addresses with clickable token refs
      return message.replace(addressRegex, (match) => {
        const addrLower = match.toLowerCase();
        const symbol = symbolByAddress.get(addrLower) || '';
        const displayText = symbol || match; // Show symbol if known, else full address

        // If we have a symbol, show it with full address in title
        // If no symbol, show the full address (still copyable)
        if (symbol) {
          return '<span class="token-ref" title="' + match + '" data-address="' + match + '" tabindex="0" role="button" onclick="handleTokenRefClick(this, \\'' + match + '\\')" onkeydown="if(event.key===\\'Enter\\'){handleTokenRefClick(this,\\'' + match + '\\');}">' + displayText + '</span>';
        } else {
          return '<span class="token-ref" title="Click to copy" data-address="' + match + '" tabindex="0" role="button" onclick="handleTokenRefClick(this, \\'' + match + '\\')" onkeydown="if(event.key===\\'Enter\\'){handleTokenRefClick(this,\\'' + match + '\\');}">' + match + '</span>';
        }
      });
    }

    // Handle click on token reference - copy address to clipboard
    function handleTokenRefClick(element, address) {
      navigator.clipboard.writeText(address).then(() => {
        // Show copied feedback
        element.classList.add('copied');

        // Remove any existing feedback
        const existingFeedback = element.querySelector('.copied-feedback');
        if (existingFeedback) existingFeedback.remove();

        // Add new feedback
        const feedback = document.createElement('span');
        feedback.className = 'copied-feedback';
        feedback.textContent = 'Copied!';
        feedback.style.position = 'relative';
        element.appendChild(feedback);

        // Remove the copied class and feedback after animation
        setTimeout(() => {
          element.classList.remove('copied');
          if (feedback.parentNode) feedback.remove();
        }, 1500);
      }).catch(() => {
        // Fallback: select the text
        const range = document.createRange();
        range.selectNode(element);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
    }

    function showCompareResult(data, options = {}) {
      const preserveUiState = options.preserveUiState === true;
      const priorUiState = preserveUiState ? captureResultUiState() : null;
      result.className = 'show';

      if (!preserveUiState) {
        setActiveTab('recommended');
      }

      const quoteChainId = currentQuoteChainId || (data.spandex && data.spandex.chainId) || getCurrentChainId();

      // Build comparison reason text with typography, not color
      let reasonHtml = '<div class="reason-box">';
      reasonHtml += '<div class="reason-box-title">Reason</div>';
      reasonHtml += '<div class="reason-box-content">' + data.recommendation_reason + '</div>';
      if (data.gas_price_gwei) {
        reasonHtml += '<div class="field-value number reason-box-gas">Gas Price: ' + data.gas_price_gwei + ' gwei</div>';
      }
      // Show output->ETH rate if available (for non-ETH outputs)
      if (data.output_to_eth_rate) {
        const outputSymbol = (data.spandex && data.spandex.to_symbol) || (data.curve && data.curve.to_symbol) || 'token';
        reasonHtml += '<div class="field-value number reason-box-gas">Rate: 1 ' + outputSymbol + ' = ' + data.output_to_eth_rate + ' ETH</div>';
      }
      reasonHtml += '</div>';

      if (data.recommendation === 'spandex' && data.spandex) {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(data.spandex, true, quoteChainId, data.gas_price_gwei);
        if (data.curve) {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderCurveQuote(data.curve, false, quoteChainId, data.gas_price_gwei);
        } else {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(data.curve_error || 'No quote available', quoteChainId) + '</div>';
        }
      } else if (data.recommendation === 'curve' && data.curve) {
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(data.curve, true, quoteChainId, data.gas_price_gwei);
        if (data.spandex) {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderSpandexQuote(data.spandex, false, quoteChainId, data.gas_price_gwei);
        } else {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(data.spandex_error || 'No quote available', quoteChainId) + '</div>';
        }
      } else if (data.spandex) {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(data.spandex, false, quoteChainId, data.gas_price_gwei);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else if (data.curve) {
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(data.curve, false, quoteChainId, data.gas_price_gwei);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else {
        tabRecommended.textContent = 'Results';
        const combinedError = 'No quotes available. ' +
          (data.spandex_error ? 'Spandex: ' + data.spandex_error + '. ' : '') +
          (data.curve_error ? 'Curve: ' + data.curve_error : '');
        recommendedContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(combinedError, quoteChainId) + '</div>';
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      }

      if (preserveUiState && priorUiState) {
        setActiveTab(priorUiState.activeTab);
        window.scrollTo(0, priorUiState.scrollY);
      } else {
        setActiveTab('recommended');
      }

      updateTransactionActionStates();
      updateRefreshIndicator();
    }

    function showError(msg) {
      result.className = 'show';
      const chainId = getCurrentChainId();
      recommendedContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(msg, chainId) + '</div>';
      tabRecommended.textContent = 'Results';
      tabAlternative.style.display = 'none';
      alternativeContent.innerHTML = '';
      setActiveTab('recommended');
      updateRefreshIndicator();
    }

    function hasQuoteResults(data) {
      return Boolean(data && (data.spandex || data.curve));
    }

    async function fetchComparePayload(compareParams) {
      const query = compareParamsToSearchParams(compareParams);
      const response = await fetch('/compare?' + query.toString());
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || ('Request failed with status ' + response.status));
      }
      return payload;
    }

    async function requestAndRenderCompare(compareParams, options = {}) {
      // Use progressive SSE-based fetching for better UX
      return fetchAndRenderCompareProgressive(compareParams, options);
    }

    async function runAutoRefreshCycle() {
      const refreshParams = getRefreshParams();
      if (!refreshParams || autoRefreshState.paused || autoRefreshState.inFlight) {
        return;
      }

      const requestId = ++compareRequestSequence;

      autoRefreshState.inFlight = true;
      updateRefreshIndicator();

      const comparison = await requestAndRenderCompare(refreshParams, {
        preserveUiState: true,
        keepExistingResultsOnError: true,
        requestId,
      });

      autoRefreshState.inFlight = false;
      if (comparison.stale) {
        updateRefreshIndicator();
        return;
      }

      if (!autoRefreshState.lastParams || autoRefreshState.paused) {
        updateRefreshIndicator();
        return;
      }

      if (comparison.ok) {
        autoRefreshState.lastParams = comparison.params;
        startAutoRefreshCountdown();
      } else {
        autoRefreshState.errorMessage = 'Refresh failed. Keeping previous quotes.';
        startAutoRefreshCountdown({ clearErrorMessage: false });
      }
    }

    function isRejectionCode(code) {
      return Number(code) === 4001;
    }

    function isUserRejectedError(err) {
      if (!err || typeof err !== 'object') return false;

      if (isRejectionCode(err.code)) {
        return true;
      }

      if (err.data && typeof err.data === 'object') {
        if (isRejectionCode(err.data.code)) {
          return true;
        }

        if (err.data.originalError && typeof err.data.originalError === 'object' && isRejectionCode(err.data.originalError.code)) {
          return true;
        }
      }

      if (err.error && typeof err.error === 'object' && isRejectionCode(err.error.code)) {
        return true;
      }

      return false;
    }

    function setTxStatus(card, text, kind) {
      const status = card.querySelector('.tx-status');
      if (!status) return;
      status.textContent = text || '';
      status.classList.remove('pending', 'success', 'error');
      if (kind) {
        status.classList.add(kind);
      }
    }

    function setTxCardPending(card, pending) {
      card.querySelectorAll('.tx-btn').forEach((button) => {
        button.dataset.pending = pending ? 'true' : 'false';
        if (pending) {
          button.classList.remove('wallet-required');
          button.disabled = true;
        } else if (button.dataset.locked === 'true') {
          button.disabled = true;
        } else {
          button.disabled = false;
        }
      });

      if (!pending) {
        updateTransactionActionStates();
      }
    }

    async function ensureWalletOnChain(provider, chainId) {
      const targetChainIdHex = getChainIdHex(chainId).toLowerCase();
      if (targetChainIdHex === '0x0') {
        throw new Error('Invalid chain ID');
      }

      const activeChainId = await provider.request({ method: 'eth_chainId' });
      if (String(activeChainId || '').toLowerCase() === targetChainIdHex) {
        return;
      }

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainIdHex }],
      });
    }

    async function waitForTransactionReceipt(provider, txHash) {
      const timeoutMs = 120000;
      const pollIntervalMs = 1500;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const receipt = await provider.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        });

        if (receipt) {
          return receipt;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error('Timed out waiting for transaction confirmation');
    }

    async function executeCardTransaction(card, txParams, onSuccess) {
      if (!hasConnectedWallet()) {
        setWalletMessage('Connect wallet first', true);
        setTxStatus(card, 'Connect wallet first', 'error');
        updateTransactionActionStates();
        return;
      }

      const provider = connectedWalletProvider;
      if (!provider || typeof provider.request !== 'function') {
        setWalletMessage('Wallet provider is not available.', true);
        setTxStatus(card, 'Failed', 'error');
        updateTransactionActionStates();
        return;
      }

      const chainId = card.dataset.quoteChainId || currentQuoteChainId || String(getCurrentChainId());

      setTxCardPending(card, true);
      setTxStatus(card, 'Confirming...', 'pending');
      pauseAutoRefreshForTransaction();

      try {
        await ensureWalletOnChain(provider, chainId);
        setTxStatus(card, 'Confirming...', 'pending');

        const txHash = await provider.request({
          method: 'eth_sendTransaction',
          params: [txParams],
        });
        const receipt = await waitForTransactionReceipt(provider, txHash);
        const statusValue = String(receipt && receipt.status ? receipt.status : '').toLowerCase();

        if (statusValue === '0x1' || statusValue === '1') {
          if (typeof onSuccess === 'function') {
            onSuccess();
          }
          setWalletMessage('');
          setTxStatus(card, 'Success', 'success');
          return;
        }

        throw new Error('Transaction failed');
      } catch (err) {
        if (isUserRejectedError(err)) {
          setWalletMessage('Transaction canceled in wallet.', true);
          setTxStatus(card, 'Failed', 'error');
          return;
        }

        setWalletMessage('Transaction failed. Please try again.', true);
        setTxStatus(card, 'Failed', 'error');
      } finally {
        setTxCardPending(card, false);
        resumeAutoRefreshAfterTransaction();
      }
    }

    async function onApproveClick(card, button) {
      if (!hasConnectedWallet()) {
        // Store pending action and trigger wallet connection flow
        pendingPostConnectAction = { type: 'approve', card, button };
        triggerWalletConnectionFlow();
        return;
      }

      const approvalToken = String(card.dataset.approvalToken || '').trim();
      const approvalSpender = String(card.dataset.approvalSpender || '').trim();
      if (!isAddressLike(approvalToken) || !isAddressLike(approvalSpender)) {
        setTxStatus(card, 'Failed', 'error');
        return;
      }

      let calldata;
      try {
        calldata = encodeApproveCalldata(approvalSpender);
      } catch {
        setTxStatus(card, 'Failed', 'error');
        return;
      }

      await executeCardTransaction(
        card,
        {
          to: approvalToken,
          data: calldata,
          value: '0x0',
          from: connectedWalletAddressValue,
        },
        () => {
          // Show checkmark and mark as approved
          button.innerHTML = 'Approved<span class="tx-checkmark"> ✓</span>';
          button.dataset.locked = 'true';
          button.classList.add('approved');
          button.disabled = true;

          // Enable the Swap button (remove disabled state)
          const swapButton = card.querySelector('.swap-btn');
          if (swapButton) {
            swapButton.classList.remove('disabled');
            swapButton.disabled = false;
          }
        }
      );
    }

    async function onSwapClick(card) {
      if (!hasConnectedWallet()) {
        // Store pending action and trigger wallet connection flow
        pendingPostConnectAction = { type: 'swap', card };
        triggerWalletConnectionFlow();
        return;
      }

      // Check if quotes are still loading - show confirmation modal if so
      if (areQuotesStillLoading()) {
        openSwapConfirmModal(card);
        return;
      }

      // All quotes arrived - proceed directly
      await executeSwapFromCard(card);
    }

    // Execute the swap transaction from a card element
    async function executeSwapFromCard(card) {
      const routerAddress = String(card.dataset.routerAddress || '').trim();
      const routerCalldata = String(card.dataset.routerCalldata || '').trim();
      const routerValue = String(card.dataset.routerValue || '0x0');
      if (!isAddressLike(routerAddress) || !routerCalldata) {
        setTxStatus(card, 'Failed', 'error');
        return;
      }

      await executeCardTransaction(card, {
        to: routerAddress,
        data: routerCalldata,
        value: toHexQuantity(routerValue || '0x0'),
        from: connectedWalletAddressValue,
      });
    }

    result.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest('.tx-btn');
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      const card = button.closest('.tx-actions');
      if (!(card instanceof HTMLElement)) {
        return;
      }

      if (button.dataset.pending === 'true' || button.dataset.locked === 'true') {
        return;
      }

      if (button.dataset.action === 'approve') {
        void onApproveClick(card, button);
        return;
      }

      if (button.dataset.action === 'swap') {
        void onSwapClick(card);
      }
    });

    async function runCompareAndMaybeStartAutoRefresh(compareParams, options = {}) {
      const requestId = ++compareRequestSequence;
      const comparison = await requestAndRenderCompare(compareParams, {
        showLoading: options.showLoading === true,
        preserveUiState: options.preserveUiState === true,
        keepExistingResultsOnError: options.keepExistingResultsOnError === true,
        updateUrl: options.updateUrl !== false,
        requestId,
      });

      if (comparison.stale) {
        return comparison;
      }

      if (comparison.ok && hasQuoteResults(comparison.payload)) {
        beginAutoRefresh(comparison.params);
      } else {
        stopAutoRefresh();
      }

      return comparison;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const compareParams = readCompareParamsFromForm();
      await runCompareAndMaybeStartAutoRefresh(compareParams, { showLoading: true });
    });

    // Restore from URL params or apply chain defaults
    const params = new URLSearchParams(window.location.search);
    // Load user preferences for fallback when URL params are missing
    const savedPrefs = loadUserPreferences();

    // Chain: URL param > localStorage > default (Base)
    if (params.get('chainId')) {
      const chainId = params.get('chainId');
      const chainName = CHAIN_NAMES[chainId] || '';
      chainIdInput.dataset.chainId = chainId;
      chainIdInput.value = formatChainDisplay(chainId, chainName);
    } else if (savedPrefs && savedPrefs.chainId) {
      const chainId = savedPrefs.chainId;
      const chainName = CHAIN_NAMES[chainId] || '';
      chainIdInput.dataset.chainId = chainId;
      chainIdInput.value = formatChainDisplay(chainId, chainName);
    }
    if (params.get('from')) {
      const fromAddr = params.get('from');
      fromInput.dataset.address = fromAddr;
      // Will format with symbol after tokenlist loads
    } else {
      // Will apply defaults or saved preferences after tokenlist loads
    }
    if (params.get('to')) {
      const toAddr = params.get('to');
      toInput.dataset.address = toAddr;
      // Will format with symbol after tokenlist loads
    } else {
      // Will apply defaults or saved preferences after tokenlist loads
    }
    // Amount: URL param > localStorage > default ("1")
    if (params.get('amount')) {
      amountInput.value = params.get('amount');
    } else if (savedPrefs && savedPrefs.amount) {
      amountInput.value = savedPrefs.amount;
    }
    // Slippage: URL param > localStorage > default ("50")
    if (params.get('slippageBps')) {
      slippageInput.value = params.get('slippageBps');
      updateSlippagePresetActive(params.get('slippageBps'));
    } else if (savedPrefs && savedPrefs.slippageBps) {
      slippageInput.value = savedPrefs.slippageBps;
      updateSlippagePresetActive(savedPrefs.slippageBps);
    }
    // Mode: URL param > localStorage > default ("exactIn")
    if (params.get('mode') === 'targetOut') {
      setDirectionMode('targetOut');
    } else if (savedPrefs && savedPrefs.mode === 'targetOut') {
      setDirectionMode('targetOut');
    }
    // Sender param from URL is silently ignored - sender comes from wallet connection state

    // Remove any stale mevProtection param from URL
    if (params.has('mevProtection')) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('mevProtection');
      window.history.replaceState({}, '', cleanUrl.toString());
    }

    const shouldLoadFromUrlParams = Boolean(
      params.get('chainId') && params.get('from') && params.get('to') && params.get('amount')
    );

    // Initialize tokenlist sources on page load
    async function initializeTokenlistSources() {
      // Step 1: Load all default tokenlists from server
      const defaultTokenlistEntries = await loadDefaultTokenlists();

      // Read default tokenlist enabled state from localStorage (default: true for new visitors)
      // Note: single toggle applies to all default tokenlists
      let defaultEnabled = true;
      try {
        const stored = localStorage.getItem(DEFAULT_TOKENLIST_ENABLED_KEY);
        if (stored !== null) {
          defaultEnabled = stored === 'true';
        }
      } catch {
        // Ignore storage errors, use default
      }

      // Create one tokenlistSources entry per default tokenlist
      // Each has url: null (marker for default) but distinct names
      tokenlistSources = defaultTokenlistEntries.map((entry) => ({
        url: null, // null indicates default (not a custom URL)
        enabled: defaultEnabled,
        name: entry.name,
        tokens: entry.tokens,
        error: null
      }));

      // Step 2: Check for migration from old single-URL format
      const migrated = migrateOldTokenlistUrl();
      let savedLists = migrated || loadTokenlistSourcesFromStorage();

      // Step 3: Load saved custom tokenlists
      if (savedLists && savedLists.length > 0) {
        const loadPromises = savedLists.map(async (saved) => {
          const index = tokenlistSources.length;
          tokenlistSources.push({
            url: saved.url,
            enabled: saved.enabled !== false, // default to true
            name: saved.name || saved.url,
            tokens: [],
            error: null
          });

          try {
            const { tokens, name } = await loadTokenlistFromUrl(saved.url);
            tokenlistSources[index].tokens = tokens.map(t => ({ ...t, _source: name }));
            tokenlistSources[index].name = name;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            tokenlistSources[index].error = msg;
            tokenlistSources[index].tokens = [];
          }
        });

        await Promise.all(loadPromises);
      }

      // Step 4: Render the sources list
      renderTokenlistSources();
    }

    // Load tokenlists and then initialize the UI
    initializeTokenlistSources().then(() => {
      // Now we can format tokens with symbols from the loaded tokenlist
      const chainId = getCurrentChainId();
      const saved = getSavedTokensForChain(chainId);

      if (params.get('from')) {
        const fromAddr = params.get('from');
        const fromToken = findTokenByAddress(fromAddr, chainId);
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
          updateTokenInputIcon(fromInput, fromIcon, fromWrapper, fromToken);
        } else {
          fromInput.value = fromAddr;
          fromInput.dataset.address = fromAddr;
          clearTokenInputIcon(fromWrapper, fromIcon);
        }
      } else if (saved && saved.from) {
        // No URL param - use saved preference for this chain
        const fromToken = findTokenByAddress(saved.from, chainId);
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
          updateTokenInputIcon(fromInput, fromIcon, fromWrapper, fromToken);
        } else {
          fromInput.value = saved.from;
          fromInput.dataset.address = saved.from;
          clearTokenInputIcon(fromWrapper, fromIcon);
        }
      }

      if (params.get('to')) {
        const toAddr = params.get('to');
        const toToken = findTokenByAddress(toAddr, chainId);
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
          updateTokenInputIcon(toInput, toIcon, toWrapper, toToken);
        } else {
          toInput.value = toAddr;
          toInput.dataset.address = toAddr;
          clearTokenInputIcon(toWrapper, toIcon);
        }
      } else if (saved && saved.to) {
        // No URL param - use saved preference for this chain
        const toToken = findTokenByAddress(saved.to, chainId);
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
          updateTokenInputIcon(toInput, toIcon, toWrapper, toToken);
        } else {
          toInput.value = saved.to;
          toInput.dataset.address = saved.to;
          clearTokenInputIcon(toWrapper, toIcon);
        }
      }

      // Apply defaults if no URL params AND no saved preferences for from/to
      // Note: applyDefaults now checks getSavedTokensForChain internally,
      // but we use skipSavedTokens=true since we already handled saved prefs above
      const defaults = DEFAULT_TOKENS[chainId];
      if (!params.get('from') && !(saved && saved.from) && defaults) {
        const fromToken = findTokenByAddress(defaults.from, chainId);
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
          updateTokenInputIcon(fromInput, fromIcon, fromWrapper, fromToken);
        } else {
          fromInput.value = defaults.from;
          fromInput.dataset.address = defaults.from;
          clearTokenInputIcon(fromWrapper, fromIcon);
        }
      }
      if (!params.get('to') && !(saved && saved.to) && defaults) {
        const toToken = findTokenByAddress(defaults.to, chainId);
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
          updateTokenInputIcon(toInput, toIcon, toWrapper, toToken);
        } else {
          toInput.value = defaults.to;
          toInput.dataset.address = defaults.to;
          clearTokenInputIcon(toWrapper, toIcon);
        }
      }

      const activeElement = document.activeElement;
      if (activeElement === fromInput) {
        fromAutocomplete.refresh();
      }
      if (activeElement === toInput) {
        toAutocomplete.refresh();
      }

      if (shouldLoadFromUrlParams) {
        void runCompareAndMaybeStartAutoRefresh(readCompareParamsFromForm(), {
          showLoading: true,
          updateUrl: false,
        });
      }

      // Render local tokens on page load
      renderLocalTokens();

      // Fetch balances if wallet is already connected
      updateTokenBalances();
    });

    // Update token counts when chain changes
    chainIdInput.addEventListener('change', () => {
      renderTokenlistSources();
    });
  </script>
</body>
</html>`;

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestStart = Date.now();
  const requestId = getRequestId(req);
  setTraceHeaders(res, requestId);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/" && req.method === "GET") {
    sendHtml(res, INDEX_HTML);
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", requestId, flags: getAllFlags() });
    recordRequest("/health", Date.now() - requestStart, false);
    return;
  }

  if (url.pathname === "/metrics" && isEnabled("metrics_endpoint")) {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(getMetrics());
    return;
  }

  if (url.pathname === "/analytics") {
    sendJson(res, 200, getAnalyticsSummary());
    return;
  }

  if (url.pathname === "/errors") {
    sendJson(res, 200, getErrorInsights());
    return;
  }

  if (url.pathname === "/chains" && req.method === "GET") {
    sendJson(res, 200, SUPPORTED_CHAINS);
    return;
  }

  if (url.pathname === "/tokenlist" && req.method === "GET") {
    try {
      const defaultTokenlists = await loadDefaultTokenlists();
      // Return structured response with all default tokenlists
      // For backward compatibility, merge all tokens into a single array
      const allTokens = defaultTokenlists.flatMap((entry) => entry.tokens);
      const names = defaultTokenlists.map((entry) => entry.name);
      sendJson(res, 200, {
        name: names.length === 1 ? names[0] : "Default Tokenlists",
        tokenlists: defaultTokenlists.map((entry) => ({
          name: entry.name,
          tokens: entry.tokens,
        })),
        tokens: allTokens,
      });
    } catch (err) {
      logError("Failed to load tokenlist", err);
      const details = err instanceof Error ? err.message : String(err);
      sendError(res, 500, `Failed to load tokenlist: ${details}`);
    }
    return;
  }

  // Proxy endpoint for custom tokenlist URLs (avoids CORS issues)
  if (url.pathname === "/tokenlist/proxy" && req.method === "GET") {
    const remoteUrl = url.searchParams.get("url");

    if (!remoteUrl) {
      sendError(res, 400, "Missing url parameter");
      return;
    }

    try {
      const tokenList = await fetchProxyTokenList(remoteUrl);
      sendJson(res, 200, tokenList);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Determine appropriate status code
      if (
        message.includes("Missing url") ||
        message.includes("Invalid URL") ||
        message.includes("HTTPS")
      ) {
        sendError(res, 400, message);
      } else {
        // Fetch failures, parse errors, size limits - all 502
        sendError(res, 502, message);
      }
    }
    return;
  }

  // Token metadata endpoint - fetches ERC-20 name, symbol, decimals from chain
  if (url.pathname === "/token-metadata" && req.method === "GET") {
    const chainIdParam = url.searchParams.get("chainId");
    const addressParam = url.searchParams.get("address");

    // Validate chainId
    const chainId = parseInt(chainIdParam || "", 10);
    if (isNaN(chainId) || chainId <= 0) {
      sendError(res, 400, "Missing or invalid chainId parameter");
      return;
    }

    if (!SUPPORTED_CHAINS[chainId]) {
      sendError(res, 400, `Unsupported chain: ${chainId}`);
      return;
    }

    // Validate address format
    if (!addressParam) {
      sendError(res, 400, "Missing or invalid address parameter");
      return;
    }

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(addressParam)) {
      sendError(res, 400, "Invalid address format");
      return;
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        getTokenName(chainId, addressParam),
        getTokenSymbol(chainId, addressParam),
        getTokenDecimals(chainId, addressParam),
      ]);

      // Check if this is a valid ERC-20 token (at least one metadata field should be present)
      if (!name && !symbol && decimals === 0) {
        sendError(res, 404, "Not a valid ERC-20 token");
        return;
      }

      sendJson(res, 200, { name, symbol, decimals });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Token metadata fetch failed: chain=${chainId} address=${addressParam}`, err);

      // Check for specific error types
      if (message.includes("Unsupported chain")) {
        sendError(res, 400, message);
      } else if (
        message.includes("revert") ||
        message.includes("call revert") ||
        message.includes("execution reverted") ||
        message.includes("returned no data") ||
        message.includes("not a contract")
      ) {
        sendError(res, 404, "Not a valid ERC-20 token");
      } else if (
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("ECONNREFUSED")
      ) {
        sendError(res, 500, `RPC error: ${message}`);
      } else {
        sendError(res, 500, message);
      }
    }
    return;
  }

  if (url.pathname === "/quote" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, slippageBps, sender, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await findQuote(chainId, from, to, amount, slippageBps, sender, mode);
      const duration = Date.now() - startTime;
      log(
        `Quote: chain=${chainId} ${result.from_symbol || from.slice(0, 10)} -> ` +
          `${result.to_symbol || to.slice(0, 10)}, amount=${amount}, mode=${mode}, ` +
          `output=${result.output_amount}, provider=${result.provider}, ${duration}ms`
      );
      recordRequest("/quote", duration, false);
      trackQuote({
        chainId,
        fromToken: from,
        toToken: to,
        provider: result.provider,
        durationMs: duration,
        success: true,
        outputAmount: result.output_amount,
      });
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(
        `Quote failed: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ${duration}ms`,
        err
      );
      recordRequest("/quote", duration, true);
      trackQuote({
        chainId,
        fromToken: from,
        toToken: to,
        provider: "unknown",
        durationMs: duration,
        success: false,
      });
      trackError(err, `quote:${chainId}:${from.slice(0, 10)}-${to.slice(0, 10)}`);
      sendError(res, 500, err instanceof Error ? err.message : "Unknown error");
    }
    return;
  }

  if (url.pathname === "/compare" && req.method === "GET" && isEnabled("compare_endpoint")) {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, slippageBps, sender, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await compareQuotes(chainId, from, to, amount, slippageBps, sender, mode);
      const duration = Date.now() - startTime;
      log(
        `Compare: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ` +
          `amount=${amount}, mode=${mode}, recommendation=${result.recommendation}, ${duration}ms`
      );
      recordRequest("/compare", duration, false);
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(
        `Compare failed: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ${duration}ms`,
        err
      );
      recordRequest("/compare", duration, true);
      trackError(err, `compare:${chainId}:${from.slice(0, 10)}-${to.slice(0, 10)}`);
      sendError(res, 500, err instanceof Error ? err.message : "Unknown error");
    }
    return;
  }

  if (url.pathname === "/compare-stream" && req.method === "GET" && isEnabled("compare_endpoint")) {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, slippageBps, sender, mode } = parsed.data;

    const startTime = Date.now();
    try {
      await streamCompareQuotes(res, chainId, from, to, amount, slippageBps, sender, mode);
      const duration = Date.now() - startTime;
      log(
        `Compare-stream: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ` +
          `amount=${amount}, mode=${mode}, ${duration}ms`
      );
      recordRequest("/compare-stream", duration, false);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(
        `Compare-stream failed: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ${duration}ms`,
        err
      );
      recordRequest("/compare-stream", duration, true);
      trackError(err, `compare-stream:${chainId}:${from.slice(0, 10)}-${to.slice(0, 10)}`);
      // For SSE, we can't send a proper HTTP error after headers are sent
      // Send an error event instead
      if (!res.headersSent) {
        sendError(res, 500, err instanceof Error ? err.message : "Unknown error");
      } else {
        sendSSE(res, "error", {
          router: "server",
          error: err instanceof Error ? err.message : "Unknown error",
        });
        sendSSE(res, "done", {});
        res.end();
      }
    }
    return;
  }

  log(`404: ${req.method} ${url.pathname}`);
  sendError(res, 404, "Not found");
}

async function main() {
  if (CURVE_ENABLED) {
    log("Initializing Curve API for all supported chains...");
    await initAllCurveInstances(getRpcUrl, log, logError);
    log("Curve API initialization complete");
    captureMessage("Curve API initialization complete");
  }

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    log(`Server listening on http://${HOST}:${PORT}`);
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((err) => {
    logError("Failed to start server", err);
    process.exit(1);
  });
}
