import "./env.js";
import "./sentry.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
 * Get a Curve quote for the given params.
 * Returns the CurveQuoteResult or throws an error.
 */
async function getCurveQuote(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  sender?: string,
  mode: QuoteMode = "exactIn"
): Promise<CurveQuoteResult> {
  // Check if Curve is available for this chain
  const curveAvailable = CURVE_ENABLED && isCurveSupported(chainId) && isCurveInitialized(chainId);

  if (!curveAvailable) {
    const curveError =
      isCurveSupported(chainId) && !isCurveInitialized(chainId)
        ? `Curve initialization failed for chain ${chainId}: ${getCurveInitError(chainId) || "Unknown error"}`
        : isCurveSupported(chainId)
          ? "Curve is disabled"
          : `Curve does not support chain ${chainId}`;
    throw new Error(curveError);
  }

  return findCurveQuote(chainId, from, to, amount, sender, getClient(chainId), mode);
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Compare DEX Routers</title>
  <meta name="fc:miniapp" content='{"version":"1","imageUrl":"","button":{"title":"Compare DEX","action":{"type":"launch_frame","name":"Compare DEX Routers","url":""}}}' />
  <script>
    // Flash-prevention: apply theme before CSS loads
    (function() {
      var t = localStorage.getItem('compare-dex-theme');
      if (t === 'light' || t === 'dark') {
        document.documentElement.setAttribute('data-theme', t);
      } else {
        var d = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
      }
    })();
  </script>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
  <!-- Page Header: Title + Theme Toggle + Settings Gear -->
  <div class="page-header">
    <h1>Compare DEX Routers</h1>
    <div class="header-actions">
      <button type="button" id="themeBtn" class="theme-btn" aria-label="Toggle theme" title="Toggle theme">
        <span id="themeIcon"></span>
      </button>
      <button type="button" id="settingsBtn" class="settings-btn" aria-label="Open settings" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
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
      <!-- Wallet provider menu moved to modal below -->
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
    <!-- Row 5: Two-field amount inputs (Sell / Receive) -->
    <div class="amount-fields-row">
      <div class="amount-field-group active" id="sellAmountGroup">
        <label class="amount-field-label" for="sellAmount" id="sellAmountLabel">YOU SELL</label>
        <input type="text" class="amount-field-input" id="sellAmount" value="1">
      </div>
      <div class="amount-field-group computed" id="receiveAmountGroup">
        <label class="amount-field-label" for="receiveAmount" id="receiveAmountLabel">YOU RECEIVE</label>
        <input type="text" class="amount-field-input" id="receiveAmount" placeholder="—">
      </div>
    </div>
    <div id="targetOutNote" class="target-out-note" hidden>
      <span class="target-out-note-icon">⚠️</span>
      <span>Fewer providers support reverse quotes (3/7 Spandex providers)</span>
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

  <!-- Wallet Provider Modal -->
  <div id="walletProviderModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="walletProviderModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h2 id="walletProviderModalTitle" class="modal-title">Connect Wallet</h2>
        <button type="button" id="walletProviderModalClose" class="modal-close" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div id="walletProviderList" class="wallet-provider-list"></div>
        <p id="walletProviderNoWallet" class="modal-text" hidden>No wallet detected. Install a wallet extension and try again.</p>
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
    window.__config = {
      defaultTokens: ${JSON.stringify(DEFAULT_TOKENS)},
      walletConnectProjectId: '${process.env.WALLETCONNECT_PROJECT_ID || ""}'
    };
  </script>
  <script src="/static/client.js" type="module" defer></script>
  <script>
    // Theme toggle is now in src/client/theme.ts (loaded via client.js bundle)

    const DEFAULT_TOKENS = ${JSON.stringify(DEFAULT_TOKENS)};
    // WALLETCONNECT_PROJECT_ID is now in src/client/config.ts (injected via window.__config)
    // DEFAULT_TOKENLIST_NAME, LOCAL_TOKENS_SOURCE_NAME, storage keys, and tokenlistSources
    // are now in src/client/token-management.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed functions from the module.
    const DEFAULT_TOKENLIST_NAME = 'Default Tokenlist';
    const LOCAL_TOKENS_SOURCE_NAME = 'Local Tokens';
    // User preferences (compare-dex-preferences) and old key migration are now in
    // src/client/url-sync.ts (loaded via client.js bundle).

    // Wallet state is now managed by src/client/wallet.ts (loaded via client.js bundle).
    // Inline JS accesses wallet state via window.hasConnectedWallet(), window.getConnectedProvider(),
    // window.getConnectedAddress(), window.setWalletMessage(), etc.
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
    let currentAbortController = null; // Track in-progress fetch requests
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

    // Cancel any in-progress fetch requests
    function cancelInProgressFetches() {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
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

    // Compute recommendation from two quotes client-side
    function computeClientRecommendation(mode) {
      const spandexQuote = progressiveQuoteState.spandex;
      const curveQuote = progressiveQuoteState.curve;
      const gasPriceGwei = spandexQuote ? spandexQuote.gas_price_gwei : null;

      if (spandexQuote && curveQuote) {
        if (mode === 'targetOut') {
          const spandexInput = Number(spandexQuote.input_amount);
          const curveInput = Number(curveQuote.input_amount);
          const inputSymbol = spandexQuote.from_symbol || 'tokens';
          if (curveInput < spandexInput) {
            const diff = spandexInput - curveInput;
            const pct = ((diff / spandexInput) * 100).toFixed(3);
            return {
              recommendation: 'curve',
              recommendation_reason: 'Curve requires ' + diff.toFixed(6) + ' ' + inputSymbol + ' less (-' + pct + '%).',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          } else if (spandexInput < curveInput) {
            const diff = curveInput - spandexInput;
            const pct = ((diff / curveInput) * 100).toFixed(3);
            const provider = spandexQuote.provider || 'Spandex';
            return {
              recommendation: 'spandex',
              recommendation_reason: 'Spandex (' + provider + ') requires ' + diff.toFixed(6) + ' ' + inputSymbol + ' less (-' + pct + '%).',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          } else {
            return {
              recommendation: 'spandex',
              recommendation_reason: 'Equal input amounts; defaulting to Spandex for multi-provider coverage.',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          }
        } else {
          // exactIn mode
          const spandexOutput = Number(spandexQuote.output_amount);
          const curveOutput = Number(curveQuote.output_amount);
          const outputSymbol = spandexQuote.to_symbol || 'tokens';
          if (curveOutput > spandexOutput) {
            const diff = curveOutput - spandexOutput;
            const pct = ((diff / spandexOutput) * 100).toFixed(3);
            return {
              recommendation: 'curve',
              recommendation_reason: 'Curve outputs ' + diff.toFixed(6) + ' ' + outputSymbol + ' more (+' + pct + '%).',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          } else if (spandexOutput > curveOutput) {
            const diff = spandexOutput - curveOutput;
            const pct = ((diff / curveOutput) * 100).toFixed(3);
            const provider = spandexQuote.provider || 'Spandex';
            return {
              recommendation: 'spandex',
              recommendation_reason: 'Spandex (' + provider + ') outputs ' + diff.toFixed(6) + ' ' + outputSymbol + ' more (+' + pct + '%).',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          } else {
            return {
              recommendation: 'spandex',
              recommendation_reason: 'Equal output amounts; defaulting to Spandex for multi-provider coverage.',
              gas_price_gwei: gasPriceGwei,
              output_to_eth_rate: null,
              input_to_eth_rate: null,
              mode: mode,
              single_router_mode: false,
            };
          }
        }
      } else if (spandexQuote) {
        return {
          recommendation: 'spandex',
          recommendation_reason: 'Only Spandex returned a quote',
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode: mode,
          single_router_mode: progressiveQuoteState.singleRouterMode,
        };
      } else if (curveQuote) {
        return {
          recommendation: 'curve',
          recommendation_reason: 'Only Curve returned a quote',
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode: mode,
          single_router_mode: progressiveQuoteState.singleRouterMode,
        };
      }
      return null;
    }

    // Fetch and render quotes via parallel fetch() calls
    async function fetchQuotesParallel(compareParams, options = {}) {
      const normalizedParams = cloneCompareParams(compareParams);
      const showLoading = options.showLoading === true;
      const updateUrl = options.updateUrl !== false;
      const requestId = Number.isFinite(options.requestId) ? Number(options.requestId) : ++compareRequestSequence;

      if (requestId > compareRequestSequence) {
        compareRequestSequence = requestId;
      }

      currentQuoteChainId = Number(normalizedParams.chainId);

      // Cancel any in-progress fetch requests
      cancelInProgressFetches();

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
      const quoteChainId = currentQuoteChainId;
      const quoteMode = normalizedParams.mode || 'exactIn';

      // Create AbortController for cancellation
      const abortController = new AbortController();
      currentAbortController = abortController;
      const signal = abortController.signal;

      let spandexDone = false;
      let curveDone = false;

      function checkStale() {
        return requestId !== compareRequestSequence;
      }

      function onQuoteArrived() {
        // Update swap confirmation modal if open
        if (swapConfirmModal.classList.contains('show')) {
          updateSwapConfirmModalText();
        }
        // Update non-active amount field with the best available quote so far
        populateNonActiveField(getBestQuoteFromState());
      }

      function tryFinalize() {
        if (!spandexDone || (!curveDone && !isSingleRouterChain)) return;
        if (checkStale()) return;

        // Compute recommendation client-side
        const recommendationData = computeClientRecommendation(quoteMode);
        if (recommendationData) {
          progressiveQuoteState.recommendation = recommendationData.recommendation;
          progressiveQuoteState.recommendationReason = recommendationData.recommendation_reason;
          progressiveQuoteState.gasPriceGwei = recommendationData.gas_price_gwei;
          progressiveQuoteState.outputToEthRate = recommendationData.output_to_eth_rate;
          progressiveQuoteState.inputToEthRate = recommendationData.input_to_eth_rate;
          progressiveQuoteState.mode = recommendationData.mode;
          progressiveQuoteState.complete = true;

          showProgressiveRecommendation(recommendationData, quoteChainId);
        } else {
          progressiveQuoteState.complete = true;
        }

        // Final update of non-active field with recommended/best quote
        const bestQuote = getBestQuoteFromState();
        if (bestQuote) {
          populateNonActiveField(bestQuote);
        } else {
          // Both routers failed - clear non-active field
          clearNonActiveField();
        }

        if (updateUrl) {
          updateUrlFromCompareParams(normalizedParams);
        }
        saveUserPreferences(normalizedParams);
      }

      // Fetch Spandex quote
      const spandexPromise = fetch('/quote?' + query.toString(), { signal })
        .then(function(response) {
          if (checkStale()) return;
          return response.json().then(function(data) {
            if (checkStale()) return;
            if (!response.ok || data.error) {
              const error = data.error || ('Request failed with status ' + response.status);
              progressiveQuoteState.spandexError = error;
              if (!progressiveQuoteState.spandex) {
                renderProgressiveError('spandex', error, quoteChainId);
              }
            } else {
              progressiveQuoteState.spandex = data;
              renderProgressiveQuote('spandex', data, quoteChainId, data.gas_price_gwei || null);
              progressiveQuoteState.gasPriceGwei = data.gas_price_gwei || progressiveQuoteState.gasPriceGwei;
            }
            onQuoteArrived();
          });
        })
        .catch(function(err) {
          if (signal.aborted || checkStale()) return;
          const message = err instanceof Error ? err.message : 'Spandex quote failed';
          progressiveQuoteState.spandexError = message;
          renderProgressiveError('spandex', message, quoteChainId);
          onQuoteArrived();
        })
        .finally(function() {
          spandexDone = true;
          tryFinalize();
        });

      // Fetch Curve quote (skip if chain doesn't support Curve)
      let curvePromise;
      if (isSingleRouterChain) {
        curveDone = true;
        curvePromise = Promise.resolve();
      } else {
        curvePromise = fetch('/quote-curve?' + query.toString(), { signal })
          .then(function(response) {
            if (checkStale()) return;
            return response.json().then(function(data) {
              if (checkStale()) return;
              if (!response.ok || data.error) {
                const error = data.error || ('Request failed with status ' + response.status);
                progressiveQuoteState.curveError = error;
                tabAlternative.textContent = 'Curve';
                tabAlternative.style.display = '';
                alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(error, quoteChainId) + '</div>';
              } else {
                progressiveQuoteState.curve = data;
                renderProgressiveQuote('curve', data, quoteChainId, progressiveQuoteState.gasPriceGwei);
              }
              onQuoteArrived();
            });
          })
          .catch(function(err) {
            if (signal.aborted || checkStale()) return;
            const message = err instanceof Error ? err.message : 'Curve quote failed';
            progressiveQuoteState.curveError = message;
            tabAlternative.textContent = 'Curve';
            tabAlternative.style.display = '';
            alternativeContent.innerHTML = '<div class="error-message">' + formatErrorWithTokenRefs(message, quoteChainId) + '</div>';
            onQuoteArrived();
          })
          .finally(function() {
            curveDone = true;
            tryFinalize();
          });
      }

      try {
        await Promise.all([spandexPromise, curvePromise]);
      } catch (_e) {
        // Errors handled per-promise above
      }

      // Clean up abort controller
      if (currentAbortController === abortController) {
        currentAbortController = null;
      }

      if (showLoading) {
        submit.disabled = false;
        submit.textContent = 'Compare Quotes';
      }

      if (checkStale()) {
        return { ok: false, stale: true, params: normalizedParams };
      }

      if (progressiveQuoteState.spandex || progressiveQuoteState.curve) {
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
        return { ok: true, params: normalizedParams, payload };
      } else {
        const errorMsg = progressiveQuoteState.spandexError || progressiveQuoteState.curveError || 'No quotes available';
        if (!options.keepExistingResultsOnError) {
          showError(errorMsg);
        }
        return { ok: false, error: errorMsg, params: normalizedParams };
      }
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

    // Wallet DOM elements are now managed by src/client/wallet.ts (via initWallet)
    const chainIdInput = document.getElementById('chainId');
    const fromInput = document.getElementById('from');
    const toInput = document.getElementById('to');
    const fromWrapper = document.getElementById('fromWrapper');
    const toWrapper = document.getElementById('toWrapper');
    const fromIcon = document.getElementById('fromIcon');
    const toIcon = document.getElementById('toIcon');
    const sellAmountInput = document.getElementById('sellAmount');
    const receiveAmountInput = document.getElementById('receiveAmount');
    const slippageInput = document.getElementById('slippageBps');

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

    // Slippage controls are now in src/client/slippage.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed shim functions.
    function updateSlippagePresetActive(value) { if (typeof window.updateSlippagePresetActive === 'function') window.updateSlippagePresetActive(value); }
    function getSlippageBps() { return typeof window.getSlippageBps === 'function' ? window.getSlippageBps() : slippageInput.value; }

    // Amount field handling (direction mode, labels, auto-quote, populate) is now in
    // src/client/amount-fields.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed shim functions.
    function setDirectionMode(mode) { if (typeof window.setDirectionMode === 'function') window.setDirectionMode(mode); }
    function updateAmountFieldLabels() { if (typeof window.updateAmountFieldLabels === 'function') window.updateAmountFieldLabels(); }
    function formatQuoteAmount(value) { return typeof window.formatQuoteAmount === 'function' ? window.formatQuoteAmount(value) : ''; }
    function getBestQuoteFromState() {
      const rec = progressiveQuoteState.recommendation;
      if (rec === 'spandex' && progressiveQuoteState.spandex) return progressiveQuoteState.spandex;
      if (rec === 'curve' && progressiveQuoteState.curve) return progressiveQuoteState.curve;
      return progressiveQuoteState.spandex || progressiveQuoteState.curve || null;
    }
    function populateNonActiveField(quote) { if (typeof window.populateNonActiveField === 'function') window.populateNonActiveField(quote); }
    function clearNonActiveField() { if (typeof window.setComputedAmount === 'function') window.setComputedAmount(''); }
    function scheduleAutoQuote() { if (typeof window.scheduleAutoQuote === 'function') window.scheduleAutoQuote(); }

    // Expose callbacks for the amount-fields module
    window.__cb_cancelInProgressFetches = function() { cancelInProgressFetches(); };
    window.__cb_runCompareAndMaybeStartAutoRefresh = function(params, options) { return runCompareAndMaybeStartAutoRefresh(params, options); };
    window.__cb_getBestQuoteFromState = function() { return getBestQuoteFromState(); };
    window.__cb_clearNonActiveField = function() { clearNonActiveField(); };

    // Chain Selector Dropdown is now in src/client/chain-selector.ts (via initChainSelector)

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

    // hasConnectedWallet is now in src/client/wallet.ts — access via window.hasConnectedWallet()
    function hasConnectedWallet() { return typeof window.hasConnectedWallet === 'function' ? window.hasConnectedWallet() : false; }

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

    // MEV Protection Modal - chain ID constants still used by inline JS
    const FLASHBOTS_RPC_URL = 'https://rpc.flashbots.net';
    const BLOXROUTE_BSC_RPC_URL = 'https://bsc.rpc.blxrbdn.com';
    const ETHEREUM_CHAIN_ID = 1;
    const BSC_CHAIN_ID = 56;
    const BASE_CHAIN_ID = 8453;
    const ARBITRUM_CHAIN_ID = 42161;
    const OPTIMISM_CHAIN_ID = 10;
    const POLYGON_CHAIN_ID = 137;
    const AVALANCHE_CHAIN_ID = 43114;

    // Modal functions are now in src/client/modals.ts (loaded via client.js bundle).
    // Bridge helpers expose inline-JS state to the modal module via window callbacks.
    function openMevModal() { if (typeof window.openMevModal === 'function') window.openMevModal(); }
    function closeMevModal() { if (typeof window.closeMevModal === 'function') window.closeMevModal(); }
    function openSettingsModal() { if (typeof window.openSettingsModal === 'function') window.openSettingsModal(); }
    function closeSettingsModal() { if (typeof window.closeSettingsModal === 'function') window.closeSettingsModal(); }
    function openSwapConfirmModal(card) { if (typeof window.openSwapConfirmModal === 'function') window.openSwapConfirmModal(card); }
    function closeSwapConfirmModal() { if (typeof window.closeSwapConfirmModal === 'function') window.closeSwapConfirmModal(); }
    function updateSwapConfirmModalText() { if (typeof window.updateSwapConfirmModalText === 'function') window.updateSwapConfirmModalText(); }
    function areQuotesStillLoading() { return typeof window.areQuotesStillLoading === 'function' ? window.areQuotesStillLoading() : false; }
    function lockBodyScroll() { if (typeof window.lockBodyScroll === 'function') window.lockBodyScroll(); }
    function unlockBodyScroll() { if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll(); }
    function renderMevChainContent() { if (typeof window.renderMevChainContent === 'function') window.renderMevChainContent(); }

    // Expose inline-JS state/functions to the modal module via window callbacks
    // Bridge callbacks for the modal module (prefixed to avoid shadowing global function declarations)
    // window.__cb_getCurrentChainId is set by chain-selector.ts
    // window.__cb_hasConnectedWallet is set by wallet.ts
    // renderLocalTokens, fetchTokenMetadata, handleUnrecognizedTokenSave, and unrecognized
    // token state are now in src/client/token-management.ts (loaded via client.js bundle).
    // The modal module now calls them directly instead of via __cb_ callbacks.
    window.__cb_addMevRpcToWallet = function(type) { addMevRpcToWallet(type); };
    window.__cb_getProgressiveQuoteState = function() { return progressiveQuoteState; };
    window.__cb_executeSwapFromCard = function(card) { return executeSwapFromCard(card); };
    window.__cb_getPendingSwapCard = function() { return pendingSwapCard; };
    window.__cb_setPendingSwapCard = function(card) { pendingSwapCard = card; };
    // window.__cb_getIsConnectingProvider is set by wallet.ts
    // window.__cb_getPendingPostConnectAction is set by wallet.ts
    // window.__cb_setPendingPostConnectAction is set by wallet.ts

    // Bridge callbacks for the wallet module
    window.__cb_updateTransactionActionStates = function() { updateTransactionActionStates(); };
    window.__cb_updateTokenBalances = function() { updateTokenBalances(); };
    window.__cb_onWalletConnected = function(pendingAction) {
      if (pendingAction) {
        if (pendingAction.type === 'approve' && pendingAction.card && pendingAction.button) {
          void onApproveClick(pendingAction.card, pendingAction.button);
        } else if (pendingAction.type === 'swap' && pendingAction.card) {
          void onSwapClick(pendingAction.card);
        }
      }
    };
    window.__cb_onWalletDisconnected = function() { clearTokenBalances(); };

    // Expose inline-JS functions on window for the token-management and autocomplete modules
    // These are called via callbacks from the TypeScript modules.
    window.formatTokenDisplay = function(symbol, address) { return formatTokenDisplay(symbol, address); };
    window.handleTokenSwapIfNeeded = function(currentInput, newAddress, newDisplay) { handleTokenSwapIfNeeded(currentInput, newAddress, newDisplay); };
    window.updateTokenInputIcon = function(input, icon, wrapper, token) { updateTokenInputIcon(input, icon, wrapper, token); };
    window.clearTokenInputIcon = function(wrapper, icon) { clearTokenInputIcon(wrapper, icon); };
    window.updateFromTokenBalance = function() { void updateFromTokenBalance(); };
    window.updateToTokenBalance = function() { void updateToTokenBalance(); };
    // updateAmountFieldLabels is now in src/client/amount-fields.ts (exposed on window)

    // Local Tokenlist Management, tokenlist sources, and autocomplete are now in
    // src/client/token-management.ts and src/client/autocomplete.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed shim functions.
    function loadLocalTokenList() { return typeof window.loadLocalTokenList === 'function' ? window.loadLocalTokenList() : []; }
    function saveLocalTokenList(tokens) { if (typeof window.saveLocalTokenList === 'function') window.saveLocalTokenList(tokens); }
    function loadLocalTokensEnabled() { return typeof window.loadLocalTokensEnabled === 'function' ? window.loadLocalTokensEnabled() : true; }
    function addTokenToLocalList(token) { if (typeof window.addTokenToLocalList === 'function') window.addTokenToLocalList(token); }
    function removeTokenFromLocalList(address, chainId) { if (typeof window.removeTokenFromLocalList === 'function') window.removeTokenFromLocalList(address, chainId); }

    // User Preferences Management is now in src/client/url-sync.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed shim functions.
    function loadUserPreferences() { return typeof window.loadUserPreferences === 'function' ? window.loadUserPreferences() : null; }
    function saveUserPreferences(params) { if (typeof window.saveUserPreferences === 'function') window.saveUserPreferences(params); }
    function getSavedTokensForChain(chainId) { return typeof window.getSavedTokensForChain === 'function' ? window.getSavedTokensForChain(chainId) : null; }

    // renderMevChainContent is now in src/client/modals.ts

    // Add MEV protection RPC to wallet via wallet_addEthereumChain
    async function addMevRpcToWallet(type) {
      if (!hasConnectedWallet()) {
        if (typeof window.setWalletMessage === 'function') window.setWalletMessage('Connect wallet first', true);
        return;
      }

      const provider = typeof window.getConnectedProvider === 'function' ? window.getConnectedProvider() : null;
      if (!provider || typeof provider.request !== 'function') {
        if (typeof window.setWalletMessage === 'function') window.setWalletMessage('Wallet provider is not available.', true);
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
        if (typeof window.setWalletMessage === 'function') window.setWalletMessage('MEV protection RPC added to your wallet. Switch to it for protected transactions.');
      } catch (err) {
        if (isUserRejectedError(err)) {
          if (typeof window.setWalletMessage === 'function') window.setWalletMessage('Request canceled.', true);
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        if (typeof window.setWalletMessage === 'function') window.setWalletMessage('Failed to add RPC: ' + detail, true);
      }
    }

    // Wallet functions are now in src/client/wallet.ts (loaded via client.js bundle).
    // Inline JS shims delegate to window-exposed wallet module functions.
    function setWalletMessage(message, isError) { if (typeof window.setWalletMessage === 'function') window.setWalletMessage(message, isError); }
    function triggerWalletConnectionFlow() { if (typeof window.triggerWalletConnectionFlow === 'function') window.triggerWalletConnectionFlow(); }
    function disconnectWallet() { if (typeof window.disconnectWallet === 'function') window.disconnectWallet(); }

    // Wallet initialization, ERC-6963 discovery, and event listeners are handled by wallet.ts

    // getCurrentChainId is now in src/client/chain-selector.ts — access via window.getCurrentChainId()
    function getCurrentChainId() { return typeof window.getCurrentChainId === 'function' ? window.getCurrentChainId() : 8453; }

    // Tokenlist sources, autocomplete, escapeHtml, and token matching are now in
    // src/client/token-management.ts and src/client/autocomplete.ts (loaded via client.js bundle).
    // Shim functions delegate to window-exposed module functions.
    function getTokensForChain(chainId) { return typeof window.getTokensForChain === 'function' ? window.getTokensForChain(chainId) : []; }
    function renderTokenlistSources() { if (typeof window.renderTokenlistSources === 'function') window.renderTokenlistSources(); }
    function escapeHtml(str) { return typeof window.escapeHtml === 'function' ? window.escapeHtml(str) : String(str || ''); }
    function isAddressInTokenlists(address, chainId) { return typeof window.isAddressInTokenlists === 'function' ? window.isAddressInTokenlists(address, chainId) : false; }
    function renderLocalTokens() { if (typeof window.renderLocalTokens === 'function') window.renderLocalTokens(); }
    function refreshAutocomplete() { if (typeof window.refreshAutocomplete === 'function') window.refreshAutocomplete(); }
    function renderResultTokenIcon(address, chainId) { return typeof window.renderResultTokenIcon === 'function' ? window.renderResultTokenIcon(address, chainId) : ''; }
    function initializeTokenlistSources() { return typeof window.initializeTokenlistSources === 'function' ? window.initializeTokenlistSources() : Promise.resolve(); }
    function handleTokenInputBlur(input, targetInput) { if (typeof window.handleTokenInputBlur === 'function') window.handleTokenInputBlur(input, targetInput); }

    // findTokenMatches is now in src/client/autocomplete.ts

    // Format token for display: 'SYMBOL (0xFullAddress)' - NEVER truncate
    // This is a project convention in AGENTS.md
    function formatTokenDisplay(symbol, address) {
      const sym = String(symbol || '').trim();
      const addr = String(address || '').trim();
      if (!addr) return sym || '';
      // Show full address - no truncation
      return sym ? sym + ' (' + addr + ')' : addr;
    }

    // renderResultTokenIcon is now in src/client/autocomplete.ts (shim above delegates to module)

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
      
      // If we have data-address, prefer it over parsing the display value
      if (dataAddr) return dataAddr;
      
      return value;
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

    // setupAutocomplete is now in src/client/autocomplete.ts (loaded via client.js bundle).
    // Inline JS accesses autocomplete instances via window-exposed shim functions.
    const fromAutocomplete = { refresh() { const a = typeof window.getFromAutocomplete === 'function' ? window.getFromAutocomplete() : null; if (a) a.refresh(); }, hide() { const a = typeof window.getFromAutocomplete === 'function' ? window.getFromAutocomplete() : null; if (a) a.hide(); } };
    const toAutocomplete = { refresh() { const a = typeof window.getToAutocomplete === 'function' ? window.getToAutocomplete() : null; if (a) a.refresh(); }, hide() { const a = typeof window.getToAutocomplete === 'function' ? window.getToAutocomplete() : null; if (a) a.hide(); } };

    const form = document.getElementById('form');
    const result = document.getElementById('result');
    const submit = document.getElementById('submit');
    const recommendedContent = document.getElementById('recommendedContent');
    const alternativeContent = document.getElementById('alternativeContent');
    const tabRecommended = document.getElementById('tabRecommended');
    const tabAlternative = document.getElementById('tabAlternative');

    // cloneCompareParams, readCompareParamsFromForm, compareParamsToSearchParams,
    // and updateUrlFromCompareParams are now in src/client/url-sync.ts (loaded via client.js bundle).
    // Inline JS accesses them via window-exposed shim functions.
    function cloneCompareParams(params) { return typeof window.cloneCompareParams === 'function' ? window.cloneCompareParams(params) : params; }
    function readCompareParamsFromForm() { return typeof window.readCompareParamsFromForm === 'function' ? window.readCompareParamsFromForm() : {}; }
    function compareParamsToSearchParams(params) { return typeof window.compareParamsToSearchParams === 'function' ? window.compareParamsToSearchParams(params) : new URLSearchParams(); }
    function updateUrlFromCompareParams(params) { if (typeof window.updateUrlFromCompareParams === 'function') window.updateUrlFromCompareParams(params); }

    // Expose extractAddressFromInput on window for url-sync module
    window.extractAddressFromInput = function(input) { return extractAddressFromInput(input); };

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
        params.sender = typeof window.getConnectedAddress === 'function' ? window.getConnectedAddress() : '';
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

    // findTokenByAddress is now in src/client/token-management.ts (shim delegates to module)
    function findTokenByAddress(address, chainId) { return typeof window.findTokenByAddress === 'function' ? window.findTokenByAddress(address, chainId) : undefined; }

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
        typeof window.getConnectedProvider === 'function' ? window.getConnectedProvider() : null,
        tokenAddress,
        typeof window.getConnectedAddress === 'function' ? window.getConnectedAddress() : '',
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
        typeof window.getConnectedProvider === 'function' ? window.getConnectedProvider() : null,
        tokenAddress,
        typeof window.getConnectedAddress === 'function' ? window.getConnectedAddress() : '',
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

    // applyDefaults is now in src/client/url-sync.ts (loaded via client.js bundle).
    function applyDefaults(chainId, options) { if (typeof window.applyDefaults === 'function') window.applyDefaults(chainId, options); }

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
      updateAmountFieldLabels();
    });

    // Modal event listeners (MEV, Settings, Swap Confirm, Wallet Provider, Escape key)
    // are now in src/client/modals.ts (via initModals)

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
      details.push('<div class="field"><div class="field-label">Router Calldata</div><div class="field-value field-value-compact">' + data.router_calldata + '</div></div>');

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
      // Use parallel fetch for progressive UX
      return fetchQuotesParallel(compareParams, options);
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

    // ensureWalletOnChain is now in src/client/wallet.ts — access via window.ensureWalletOnChain()
    async function ensureWalletOnChain(provider, chainId) {
      if (typeof window.ensureWalletOnChain === 'function') return window.ensureWalletOnChain(provider, chainId);
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

      const provider = typeof window.getConnectedProvider === 'function' ? window.getConnectedProvider() : null;
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
        if (typeof window.setPendingPostConnectAction === 'function') window.setPendingPostConnectAction({ type: 'approve', card, button });
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
          from: typeof window.getConnectedAddress === 'function' ? window.getConnectedAddress() : '',
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
        if (typeof window.setPendingPostConnectAction === 'function') window.setPendingPostConnectAction({ type: 'swap', card });
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
        from: typeof window.getConnectedAddress === 'function' ? window.getConnectedAddress() : '',
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
    // URL/preferences restore is now in src/client/url-sync.ts (loaded via client.js bundle).
    const urlRestoreResult = typeof window.restoreFromUrlAndPreferences === 'function'
      ? window.restoreFromUrlAndPreferences()
      : { shouldLoadFromUrlParams: false, savedPrefs: null };
    const shouldLoadFromUrlParams = urlRestoreResult.shouldLoadFromUrlParams;
    const savedPrefs = urlRestoreResult.savedPrefs;

    // initializeTokenlistSources is now in src/client/token-management.ts (shim delegates to module)
    // Load tokenlists and then initialize the UI
    initializeTokenlistSources().then(() => {
      // Apply token formatting after tokenlists are loaded (delegates to url-sync module)
      if (typeof window.applyTokenFormattingAfterLoad === 'function') {
        window.applyTokenFormattingAfterLoad(savedPrefs);
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
      // Update amount field labels with token symbols from loaded tokens
      updateAmountFieldLabels();
    });

    // Update token counts when chain changes
    chainIdInput.addEventListener('change', () => {
      renderTokenlistSources();
    });
  </script>
  <script type="module">
    // Load WalletConnect EthereumProvider via ESM CDN
    try {
      const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2');
      window.__WalletConnectEthereumProvider = EthereumProvider;
    } catch (err) {
      // WalletConnect module failed to load - WC option will be hidden
      window.__WalletConnectEthereumProvider = null;
    }

    // Farcaster miniapp SDK — conditional loading
    // Only loads when ?miniApp=true is in the URL (set by Farcaster client)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('miniApp') === 'true') {
        const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk');

        // Signal to Farcaster client that the app is ready (dismiss splash screen)
        sdk.actions.ready();

        // Get the Farcaster wallet provider and store it globally
        const farcasterProvider = sdk.wallet.getEthereumProvider();
        window.__farcasterWalletProvider = farcasterProvider;
        window.__isFarcasterMiniApp = true;

        // Auto-connect using the Farcaster wallet provider (bypass ERC-6963/WalletConnect menu)
        if (farcasterProvider && typeof farcasterProvider.request === 'function') {
          const accounts = await farcasterProvider.request({ method: 'eth_requestAccounts' });
          const account = Array.isArray(accounts) ? accounts[0] : null;
          if (typeof account === 'string' && account) {
            // Set globals directly for miniapp wallet
            window.__selectedWalletProvider = farcasterProvider;
            window.__selectedWalletAddress = account;
            window.__selectedWalletInfo = { name: 'Farcaster', icon: '', uuid: 'farcaster', rdns: 'farcaster' };

            // Update UI elements
            const connectBtn = document.getElementById('connectWalletBtn');
            const walletConnected = document.getElementById('walletConnected');
            const walletName = document.getElementById('walletConnectedName');
            const walletAddr = document.getElementById('walletConnectedAddress');
            if (connectBtn) connectBtn.hidden = true;
            if (walletConnected) walletConnected.hidden = false;
            if (walletName) walletName.textContent = 'Farcaster';
            if (walletAddr) walletAddr.textContent = account;
          }
        }
      }
    } catch (err) {
      // Farcaster SDK failed to load — graceful degradation, all existing behavior unchanged
      window.__farcasterWalletProvider = null;
      window.__isFarcasterMiniApp = false;
    }
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

  if (url.pathname.startsWith("/static/") && req.method === "GET") {
    const filename = url.pathname.slice("/static/".length);
    if (filename.includes("..") || filename.length === 0) {
      sendError(res, 404, "Not found");
      return;
    }
    const ext = filename.split(".").pop();
    const contentTypes: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      map: "application/json",
    };
    const contentType = contentTypes[ext || ""] || "application/octet-stream";
    try {
      const filePath = join(process.cwd(), "dist", "client", filename);
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch {
      sendError(res, 404, "Not found");
    }
    return;
  }

  if (url.pathname === "/.well-known/farcaster.json" && req.method === "GET") {
    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const baseUrl = `${protocol}://${host}`;
    sendJson(res, 200, {
      accountAssociation: {
        header: process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || "",
        payload: process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || "",
        signature: process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "",
      },
      miniapp: {
        version: "1",
        name: "Compare DEX Routers",
        homeUrl: `${baseUrl}/?miniApp=true`,
        iconUrl: `${baseUrl}/icon.png`,
        primaryCategory: "finance",
      },
    });
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

  if (url.pathname === "/quote-curve" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, sender, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await getCurveQuote(chainId, from, to, amount, sender, mode);
      const duration = Date.now() - startTime;
      log(
        `Quote-curve: chain=${chainId} ${result.from_symbol || from.slice(0, 10)} -> ` +
          `${result.to_symbol || to.slice(0, 10)}, amount=${amount}, mode=${mode}, ` +
          `output=${result.output_amount}, ${duration}ms`
      );
      recordRequest("/quote-curve", duration, false);
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(
        `Quote-curve failed: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ${duration}ms`,
        err
      );
      recordRequest("/quote-curve", duration, true);
      trackError(err, `quote-curve:${chainId}:${from.slice(0, 10)}-${to.slice(0, 10)}`);
      sendError(res, 500, err instanceof Error ? err.message : "Unknown error");
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
