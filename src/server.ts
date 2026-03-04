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
  <script type="module">
    // Load WalletConnect EthereumProvider via ESM CDN (must stay inline — CDN imports can't be bundled)
    try {
      const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2');
      window.__WalletConnectEthereumProvider = EthereumProvider;
    } catch (err) {
      window.__WalletConnectEthereumProvider = null;
    }

    // Farcaster miniapp SDK — conditional loading
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('miniApp') === 'true') {
        const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk');
        sdk.actions.ready();

        const farcasterProvider = sdk.wallet.getEthereumProvider();
        if (farcasterProvider && typeof farcasterProvider.request === 'function') {
          const accounts = await farcasterProvider.request({ method: 'eth_requestAccounts' });
          const account = Array.isArray(accounts) ? accounts[0] : null;
          if (typeof account === 'string' && account) {
            // Use the wallet module's API to register the Farcaster wallet
            if (typeof window.__setExternalWallet === 'function') {
              window.__setExternalWallet(farcasterProvider, account, {
                name: 'Farcaster', icon: '', uuid: 'farcaster', rdns: 'farcaster'
              });
            }
          }
        }
      }
    } catch (err) {
      // Farcaster SDK failed to load — graceful degradation
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
