import "./env.js";
import "./sentry.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getQuote, serializeWithBigInt } from "@spandex/core";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { parseQuoteParams } from "./quote.js";
import {
  getSpandexConfig,
  getTokenDecimals,
  getTokenSymbol,
  getClient,
  SUPPORTED_CHAINS,
  DEFAULT_TOKENS,
} from "./config.js";
import { initCurve, findCurveQuote, isCurveSupported, type CurveQuoteResult } from "./curve.js";
import { logger } from "./logger.js";
import { captureException, captureMessage } from "./sentry.js";
import { getRequestId, setTraceHeaders } from "./tracing.js";
import { recordRequest, getMetrics } from "./metrics.js";
import { isEnabled, getAllFlags } from "./feature-flags.js";
import { trackQuote, getAnalyticsSummary } from "./analytics.js";
import { trackError, getErrorInsights } from "./error-insights.js";

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
  output_amount: string;
  output_amount_raw: string;
  input_amount_raw: string;
  provider: string;
  slippage_bps: number;
  gas_used: string;
  router_address: string;
  router_calldata: string;
  router_value?: string;
  approval_token?: string;
  approval_spender?: string;
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
let cachedTokenList: TokenListPayload | null = null;
let cachedTokenListPath: string | null = null;

function getTokenListPath() {
  return process.env.TOKENLIST_PATH || resolve(process.cwd(), "data", "tokenlist.json");
}

async function loadTokenList(): Promise<TokenListPayload> {
  const tokenListPath = getTokenListPath();
  if (cachedTokenList && cachedTokenListPath === tokenListPath) {
    return cachedTokenList;
  }

  const fileContents = await readFile(tokenListPath, "utf8");
  const parsed = JSON.parse(fileContents) as TokenListPayload;

  cachedTokenList = parsed;
  cachedTokenListPath = tokenListPath;
  return parsed;
}

async function findQuote(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  slippageBps: number,
  sender?: string
): Promise<QuoteResult> {
  // Only input decimals are needed before calling Spandex (for parseUnits).
  // Output decimals and symbols are fetched in parallel with the quote.
  const inputDecimals = await getTokenDecimals(chainId, from);
  const inputAmount = parseUnits(amount, inputDecimals);

  const swapRequest = {
    chainId,
    inputToken: from as Address,
    outputToken: to as Address,
    mode: "exactIn" as const,
    inputAmount,
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
  const [quotes, outputDecimals, fromSymbol, toSymbol] = await Promise.all([
    Promise.all(quotePromises),
    getTokenDecimals(chainId, to),
    getTokenSymbol(chainId, from),
    getTokenSymbol(chainId, to),
  ]);

  // Prefer sender quote, fall back to fallback account quote
  const quote = quotes.find((q) => q !== null) ?? null;

  if (!quote) {
    throw new Error("No providers returned a successful quote");
  }

  const outputHuman = formatUnits(quote.simulation.outputAmount, outputDecimals);

  const result: QuoteResult = {
    chainId,
    from,
    from_symbol: fromSymbol,
    to,
    to_symbol: toSymbol,
    amount,
    output_amount: outputHuman,
    output_amount_raw: quote.simulation.outputAmount.toString(),
    input_amount_raw: quote.inputAmount.toString(),
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

// Check if output token is ETH/WETH
function isEthOutput(symbol: string, address: string, chainId: number): boolean {
  const normalizedSymbol = symbol.toUpperCase();
  if (normalizedSymbol === "ETH" || normalizedSymbol === "WETH") return true;

  const wethAddress = WETH_ADDRESSES[chainId];
  if (wethAddress && address.toLowerCase() === wethAddress.toLowerCase()) return true;

  return false;
}

async function compareQuotes(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  slippageBps: number,
  sender?: string
): Promise<CompareResult> {
  const spandexPromise = findQuote(chainId, from, to, amount, slippageBps, sender)
    .then((r) => ({ result: r, error: null }))
    .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }));

  const curveAvailable = CURVE_ENABLED && isCurveSupported(chainId);
  const curvePromise = curveAvailable
    ? findCurveQuote(from, to, amount, sender, getClient(chainId))
        .then((r) => ({ result: r, error: null }))
        .catch((err) => ({ result: null, error: err instanceof Error ? err.message : String(err) }))
    : Promise.resolve({ result: null, error: "Curve only supports Ethereum (chainId 1)" });

  let gasPriceGwei: string | null = null;
  try {
    const client = getClient(chainId);
    const gasPrice = await client.getGasPrice();
    gasPriceGwei = (Number(gasPrice) / 1e9).toFixed(4);
  } catch {
    // Gas price fetch failed, skip
  }

  const [spandex, curveResult] = await Promise.all([spandexPromise, curvePromise]);

  let recommendation: "spandex" | "curve" | null = null;
  let reason: string;

  if (spandex.result && curveResult.result) {
    const spandexOutput = Number(spandex.result.output_amount);
    const curveOutput = Number(curveResult.result.output_amount);
    const spandexGas = Number(spandex.result.gas_used || "0");
    const curveGas = Number(curveResult.result.gas_used || "0");

    // Determine gas availability
    const spandexHasGas = spandexGas > 0 && gasPriceGwei !== null;
    const curveHasGas = curveGas > 0 && gasPriceGwei !== null;
    const bothHaveGas = spandexHasGas && curveHasGas;

    // Compute gas costs in ETH
    const gasPriceWei = gasPriceGwei ? Number(gasPriceGwei) * 1e9 : 0;
    const spandexGasCostEth = spandexHasGas ? (spandexGas * gasPriceWei) / 1e18 : 0;
    const curveGasCostEth = curveHasGas ? (curveGas * gasPriceWei) / 1e18 : 0;

    // Determine if output is ETH/WETH
    const outputIsEth = isEthOutput(spandex.result.to_symbol, spandex.result.to, chainId);
    const outputSymbol = spandex.result.to_symbol || "tokens";

    if (bothHaveGas && outputIsEth) {
      // Gas-adjusted comparison: subtract gas cost from output
      const spandexAdjustedOutput = spandexOutput - spandexGasCostEth;
      const curveAdjustedOutput = curveOutput - curveGasCostEth;

      if (curveAdjustedOutput > spandexAdjustedOutput) {
        recommendation = "curve";
        reason = `Curve returns ${curveOutput.toFixed(6)} ETH (${curveAdjustedOutput.toFixed(6)} ETH after gas) vs Spandex ${spandexOutput.toFixed(6)} ETH (${spandexAdjustedOutput.toFixed(6)} ETH after gas). Curve recommended.`;
      } else if (spandexAdjustedOutput > curveAdjustedOutput) {
        recommendation = "spandex";
        reason = `Spandex (${spandex.result.provider}) returns ${spandexOutput.toFixed(6)} ETH (${spandexAdjustedOutput.toFixed(6)} ETH after gas) vs Curve ${curveOutput.toFixed(6)} ETH (${curveAdjustedOutput.toFixed(6)} ETH after gas). Spandex recommended.`;
      } else {
        recommendation = "spandex";
        reason = `Equal gas-adjusted output: ${spandexAdjustedOutput.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
      }
    } else if (bothHaveGas && !outputIsEth) {
      // Gas-aware comparison: note gas costs in reason but compare raw output
      if (curveOutput > spandexOutput) {
        recommendation = "curve";
        const diff = curveOutput - spandexOutput;
        const pct = ((diff / spandexOutput) * 100).toFixed(3);
        reason = `Curve outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%). Gas costs: Curve ${curveGasCostEth.toFixed(6)} ETH vs Spandex ${spandexGasCostEth.toFixed(6)} ETH. Curve recommended (gas-aware).`;
      } else if (spandexOutput > curveOutput) {
        recommendation = "spandex";
        const diff = spandexOutput - curveOutput;
        const pct = ((diff / curveOutput) * 100).toFixed(3);
        reason = `Spandex (${spandex.result.provider}) outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%). Gas costs: Spandex ${spandexGasCostEth.toFixed(6)} ETH vs Curve ${curveGasCostEth.toFixed(6)} ETH. Spandex recommended (gas-aware).`;
      } else {
        recommendation = "spandex";
        reason = `Equal output amounts. Gas costs: Spandex ${spandexGasCostEth.toFixed(6)} ETH vs Curve ${curveGasCostEth.toFixed(6)} ETH. Defaulting to Spandex for multi-provider coverage.`;
      }
    } else {
      // Fall back to raw output comparison with a note about missing gas
      const missingGas: string[] = [];
      if (!spandexHasGas) missingGas.push("Spandex");
      if (!curveHasGas) missingGas.push("Curve");
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
  } else if (spandex.result) {
    recommendation = "spandex";
    reason = "Only Spandex returned a quote";
  } else if (curveResult.result) {
    recommendation = "curve";
    reason = "Only Curve returned a quote";
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
    gas_price_gwei: gasPriceGwei,
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
      background: #fff;
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
    .modal-close:focus { outline: 2px solid #0055FF; }
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
      background: #f8f8f8;
    }
    .mev-chain-message.ethereum { border-color: #0055FF; }
    .mev-chain-message.bsc { border-color: #F0B90B; }
    .mev-chain-message.l2 { border-color: #666; }
    .mev-chain-message.other { border-color: #999; }

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
    
    /* Form Row Layout */
    .form-row { display: flex; gap: 1rem; }
    .form-row .form-group { flex: 1; }
    .form-row .form-group.narrow { flex: 0 0 120px; }

    /* Non-collapsible Form Row - stays horizontal even at 375px */
    .form-row-fixed { display: flex; gap: 0.5rem; }
    .form-row-fixed .form-group { flex: 1; min-width: 0; }
    .form-row-fixed .form-group.amount-group { flex: 0 0 150px; }
    
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
    }
    .btn-primary:hover { background: #0046CC; }
    
    .btn-secondary {
      background: #000;
      color: #fff;
    }
    .btn-secondary:hover { background: #333; }

    /* Slippage Preset Buttons - Brutalist style */
    .slippage-section { max-width: 300px; }
    .slippage-label-row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .slippage-label {
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding-left: 0.5rem;
      border-left: 4px solid #0055FF;
    }
    .slippage-presets {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }
    .slippage-preset-btn {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.25rem 0.5rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      cursor: pointer;
      min-width: 40px;
    }
    .slippage-preset-btn:hover { background: #f0f0f0; }
    .slippage-preset-btn.active {
      background: #000;
      color: #fff;
    }
    .slippage-preset-btn:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    .slippage-input-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .slippage-input-row input {
      width: 80px;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 0.875rem;
      background: #fff;
      color: #000;
      border: 2px solid #000;
    }
    .slippage-input-row input:focus { outline: 3px solid #0055FF; outline-offset: 0; }
    .slippage-hint {
      font-size: 0.625rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

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
    .wallet-address { font-family: monospace; font-size: 0.75rem; padding-left: 0.375rem; border-left: 3px solid #0055FF; word-break: break-all; }
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
    .autocomplete-logo {
      width: 18px;
      height: 18px;
      object-fit: cover;
      background: #e0e0e0;
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
      border-left-width: 6px;
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
      border-color: #999;
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
    .tx-status.success { color: #007700; background: #e8e8e8; padding: 0.125rem 0.25rem; }
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
      background: #f8f8f8;
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
      border-left: 3px solid #0055FF;
      background: #fafafa;
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
      background: #f8f8f8;
      font-weight: 600;
    }
    
    /* Responsive */
    @media (max-width: 600px) {
      .form-row { flex-direction: column; }
      .form-row .form-group.narrow { flex: 1; }
      /* Note: .form-row-fixed does NOT collapse - stays horizontal at all widths */
    }
  </style>
</head>
<body>
  <h1>Compare DEX Routers</h1>
  
  <!-- Wallet Section - Inline with trading flow -->
  <form id="form">
    <!-- Row 1: Chain Selector -->
    <div class="form-group">
      <label for="chainId">Chain</label>
      <select id="chainId">
        <option value="1">Ethereum (1)</option>
        <option value="8453" selected>Base (8453)</option>
        <option value="42161">Arbitrum (42161)</option>
        <option value="10">Optimism (10)</option>
        <option value="137">Polygon (137)</option>
        <option value="56">BSC (56)</option>
        <option value="43114">Avalanche (43114)</option>
      </select>
    </div>
    <!-- Row 2: Wallet (integrated into form flow) -->
    <div class="form-group wallet-group">
      <div class="wallet-row">
        <button type="button" id="connectWalletBtn">Connect Wallet</button>
        <div id="walletConnected" class="wallet-row" hidden style="gap: 0.5rem;">
          <img id="walletConnectedIcon" class="wallet-connected-icon" alt="" hidden>
          <span id="walletConnectedName" class="wallet-status"></span>
          <span id="walletConnectedAddress" class="wallet-address"></span>
          <button type="button" id="disconnectWalletBtn" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Disconnect</button>
        </div>
      </div>
      <div id="walletProviderMenu" class="wallet-provider-menu" hidden></div>
      <div id="walletMessage" class="wallet-message" aria-live="polite"></div>
    </div>
    <!-- Row 3: From Token + Amount (non-collapsible, stays horizontal at 375px) -->
    <div class="form-row-fixed">
      <div class="form-group">
        <label for="from">From Token</label>
        <input type="text" id="from" placeholder="Search symbol/name or enter address" autocomplete="off">
        <div class="autocomplete-list" id="fromAutocomplete"></div>
      </div>
      <div class="form-group amount-group">
        <label for="amount">Amount</label>
        <input type="text" id="amount" value="1000">
      </div>
    </div>
    <!-- Row 4: To Token -->
    <div class="form-group">
      <label for="to">To Token</label>
      <input type="text" id="to" placeholder="Search symbol/name or enter address" autocomplete="off">
      <div class="autocomplete-list" id="toAutocomplete"></div>
    </div>
    <!-- Row 5: Slippage with presets -->
    <div class="form-group slippage-section">
      <div class="slippage-label-row">
        <span class="slippage-label">Slippage</span>
        <div class="slippage-presets">
          <button type="button" class="slippage-preset-btn" data-bps="10">10</button>
          <button type="button" class="slippage-preset-btn active" data-bps="50">50</button>
          <button type="button" class="slippage-preset-btn" data-bps="100">100</button>
          <button type="button" class="slippage-preset-btn" data-bps="300">300</button>
        </div>
      </div>
      <div class="slippage-input-row">
        <input type="text" id="slippageBps" value="50">
        <span class="slippage-hint">bps (1 bps = 0.01%)</span>
      </div>
    </div>
    <button type="submit" id="submit" class="btn-primary">Compare Quotes</button>
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
    <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 2px solid #000;">
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

  <script>
    const DEFAULT_TOKENS = ${JSON.stringify(DEFAULT_TOKENS)};
    let tokenlistTokens = [];
    const walletProvidersByUuid = new Map();
    let fallbackWalletProvider = null;
    let connectedWalletProvider = null;
    let connectedWalletAddressValue = '';
    let connectedWalletInfo = null;
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
    let compareRequestSequence = 0;

    const CHAIN_ID_HEX_MAP = Object.freeze({
      '1': '0x1',
      '10': '0xa',
      '56': '0x38',
      '137': '0x89',
      '8453': '0x2105',
      '42161': '0xa4b1',
      '43114': '0xa86a',
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
    const amountInput = document.getElementById('amount');
    const slippageInput = document.getElementById('slippageBps');
    const slippagePresetBtns = document.querySelectorAll('.slippage-preset-btn');

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

    const mevInfoBtn = document.getElementById('mevInfoBtn');
    const mevModal = document.getElementById('mevModal');
    const mevModalClose = document.getElementById('mevModalClose');
    const mevChainContent = document.getElementById('mevChainContent');
    const refreshIndicator = document.getElementById('refreshIndicator');
    const refreshCountdown = document.getElementById('refreshCountdown');
    const refreshStatus = document.getElementById('refreshStatus');

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
        if (button.dataset.locked === 'true' || button.dataset.pending === 'true') {
          return;
        }

        if (!walletConnectedValue) {
          button.classList.add('wallet-required');
          button.setAttribute('aria-disabled', 'true');
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

    // Open modal
    function openMevModal() {
      renderMevChainContent();
      mevModal.classList.add('show');
      document.body.style.overflow = 'hidden';
      // Focus the close button for accessibility
      mevModalClose.focus();
    }

    // Close modal
    function closeMevModal() {
      mevModal.classList.remove('show');
      document.body.style.overflow = '';
      // Return focus to the button that opened the modal
      mevInfoBtn.focus();
    }

    // Render chain-specific content in modal
    function renderMevChainContent() {
      const chainId = Number(chainIdInput.value);
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
        } else {
          walletConnectedIcon.hidden = true;
          walletConnectedIcon.removeAttribute('src');
        }
      } else {
        connectWalletBtn.hidden = false;
        walletConnected.hidden = true;
        walletConnectedName.textContent = '';
        walletConnectedAddress.textContent = '';
        walletConnectedIcon.hidden = true;
        walletConnectedIcon.removeAttribute('src');
      }
    }

    function closeWalletProviderMenu() {
      walletProviderMenu.hidden = true;
      walletProviderMenu.innerHTML = '';
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
        icon.style.display = 'none';
      };
      return icon;
    }

    async function connectToWalletProvider(provider, info) {
      if (!provider || typeof provider.request !== 'function') {
        setWalletMessage('Wallet provider is not available.', true);
        return;
      }

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
      } catch (err) {
        const code = err && typeof err === 'object' ? err.code : undefined;
        if (code === 4001) {
          setWalletMessage('Wallet connection was canceled.', true);
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

    connectWalletBtn.addEventListener('click', () => {
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
    });

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

    async function loadTokenlist() {
      try {
        const res = await fetch('/tokenlist');
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        tokenlistTokens = Array.isArray(data.tokens) ? data.tokens : [];
      } catch {
        tokenlistTokens = [];
      }
    }

    function getTokensForChain(chainId) {
      const cid = Number(chainId);
      const seen = new Set();
      return tokenlistTokens.filter((t) => {
        if (Number(t.chainId) !== cid || typeof t.address !== 'string') return false;
        const addr = t.address.toLowerCase();
        if (seen.has(addr)) return false;
        seen.add(addr);
        return true;
      });
    }

    function findTokenMatches(value, chainId) {
      const query = value.trim().toLowerCase();
      if (!query) return [];

      const normalizedQuery = normalizeAddress(query);
      return getTokensForChain(chainId)
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
        // Show 'SYMBOL (0xABCD...1234)' format in input
        input.value = formatTokenDisplay(token.symbol, token.address);
        // Store full address in data-address attribute
        input.dataset.address = token.address;
        hide();
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

          const address = document.createElement('div');
          address.className = 'autocomplete-addr';
          address.textContent = token.address || '';

          title.appendChild(symbol);
          title.appendChild(name);
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
        const chainId = document.getElementById('chainId').value;
        matches = findTokenMatches(input.value, chainId);
        render();
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
      };
    }

    function readCompareParamsFromForm() {
      return cloneCompareParams({
        chainId: chainIdInput.value,
        from: extractAddressFromInput(fromInput),
        to: extractAddressFromInput(toInput),
        amount: amountInput.value,
        slippageBps: slippageInput.value,
        sender: hasConnectedWallet() ? connectedWalletAddressValue : '',
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
      return tokenlistTokens.find((t) => 
        Number(t.chainId) === cid && 
        String(t.address || '').toLowerCase() === addr
      );
    }

    function applyDefaults(chainId) {
      const defaults = DEFAULT_TOKENS[chainId];
      if (defaults) {
        const fromToken = findTokenByAddress(defaults.from, chainId);
        const toToken = findTokenByAddress(defaults.to, chainId);
        
        // Set from input with display format and data-address
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
        } else {
          fromInput.value = defaults.from;
          fromInput.dataset.address = defaults.from;
        }
        
        // Set to input with display format and data-address
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
        } else {
          toInput.value = defaults.to;
          toInput.dataset.address = defaults.to;
        }
      }
    }

    chainIdInput.addEventListener('change', function() {
      stopAutoRefresh();
      clearResultDisplay();
      currentQuoteChainId = null;
      applyDefaults(Number(this.value));
      fromAutocomplete.hide();
      toAutocomplete.hide();
      // Update modal content if modal is open
      if (mevModal.classList.contains('show')) {
        renderMevChainContent();
      }
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
    });

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
      details.push('<div class="field"><div class="field-label">Router Calldata</div><div class="field-value" style="font-size: 0.625rem; word-break: break-all;">' + data.router_calldata.slice(0, 100) + (data.router_calldata.length > 100 ? '...' : '') + '</div></div>');
      
      if (data.router_value) {
        details.push('<div class="field"><div class="field-label">Router Value (wei)</div><div class="field-value number">' + data.router_value + '</div></div>');
      }
      
      if (data.approval_token) {
        details.push('<div class="field"><div class="field-label">Approval Token</div><div class="field-value">' + data.approval_token + '</div></div>');
        details.push('<div class="field"><div class="field-label">Approval Spender</div><div class="field-value">' + data.approval_spender + '</div></div>');
      }
      
      // Always show Gas Used field - "N/A" if missing or zero
      const gasUsed = data.gas_used && Number(data.gas_used) > 0 ? data.gas_used : null;
      details.push('<div class="field"><div class="field-label">Gas Used</div><div class="field-value number">' + (gasUsed || 'N/A') + '</div></div>');
      
      if (type === 'spandex' && data.slippage_bps) {
        details.push('<div class="field"><div class="field-label">Slippage</div><div class="field-value number">' + data.slippage_bps + ' bps</div></div>');
      }
      
      return details.join('');
    }

    function renderSpandexQuote(data, isWinner, quoteChainId) {
      const recommendationLabel = isWinner ? '<span class="result-recommendation winner">RECOMMENDED</span>' : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
      const primaryClass = isWinner ? 'result-primary winner' : 'result-primary alternative';
      const providerLabel = 'Spandex' + (data.provider ? ' / ' + data.provider : '');
      
      // Primary section: output + buttons inline
      const primary = 
        '<div class="' + primaryClass + '">' +
          recommendationLabel +
          '<div class="result-output-label">You receive (estimated)</div>' +
          '<div class="result-output">' + data.output_amount + (data.to_symbol ? ' ' + data.to_symbol : '') + '</div>' +
          '<div class="field" style="margin-top: 0.5rem;"><div class="field-label">Via ' + providerLabel + '</div></div>' +
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
          '<div class="field"><div class="field-label">From</div><div class="field-value">' + (data.from_symbol ? data.from_symbol + ' ' : '') + data.from + '</div></div>' +
          '<div class="field"><div class="field-label">To</div><div class="field-value">' + (data.to_symbol ? data.to_symbol + ' ' : '') + data.to + '</div></div>' +
          '<div class="field"><div class="field-label">Input Amount</div><div class="field-value number">' + data.amount + (data.from_symbol ? ' ' + data.from_symbol : '') + '</div></div>' +
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

    function renderCurveQuote(data, isWinner, quoteChainId) {
      const symbols = {};
      symbols[data.from.toLowerCase()] = data.from_symbol;
      symbols[data.to.toLowerCase()] = data.to_symbol;
      if (data.route_symbols) {
        Object.entries(data.route_symbols).forEach(([k, v]) => { symbols[k.toLowerCase()] = v; });
      }
      
      const recommendationLabel = isWinner ? '<span class="result-recommendation winner">RECOMMENDED</span>' : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
      const primaryClass = isWinner ? 'result-primary winner' : 'result-primary alternative';
      
      // Primary section: output + buttons inline
      const primary = 
        '<div class="' + primaryClass + '">' +
          recommendationLabel +
          '<div class="result-output-label">You receive (estimated)</div>' +
          '<div class="result-output">' + data.output_amount + (data.to_symbol ? ' ' + data.to_symbol : '') + '</div>' +
          '<div class="field" style="margin-top: 0.5rem;"><div class="field-label">Via Curve</div></div>' +
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
          '<div class="field"><div class="field-label">From</div><div class="field-value">' + (data.from_symbol ? data.from_symbol + ' ' : '') + data.from + '</div></div>' +
          '<div class="field"><div class="field-label">To</div><div class="field-value">' + (data.to_symbol ? data.to_symbol + ' ' : '') + data.to + '</div></div>' +
          '<div class="field"><div class="field-label">Input Amount</div><div class="field-value number">' + data.amount + (data.from_symbol ? ' ' + data.from_symbol : '') + '</div></div>' +
          (data.route && data.route.length > 0 ? '<div class="field"><div class="field-label">Route (' + data.route.length + ' steps)</div>' + formatCurveRoute(data.route, symbols) + '</div>' : '') +
          (data.approval_target ? '<div class="field"><div class="field-label">Approval Target</div><div class="field-value">' + data.approval_target + '</div></div>' : '') +
          renderSecondaryDetails(data, 'curve') +
        '</div>';
      
      return primary + secondary;
    }

    function showCompareResult(data, options = {}) {
      const preserveUiState = options.preserveUiState === true;
      const priorUiState = preserveUiState ? captureResultUiState() : null;
      result.className = 'show';

      if (!preserveUiState) {
        setActiveTab('recommended');
      }

      const quoteChainId = currentQuoteChainId || (data.spandex && data.spandex.chainId) || Number(chainIdInput.value);

      // Build comparison reason text with typography, not color
      let reasonHtml = '<div style="padding: 0.5rem; border: 2px solid #000; margin-bottom: 0.5rem; background: #f8f8f8;">';
      reasonHtml += '<div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Reason</div>';
      reasonHtml += '<div style="font-size: 0.875rem;">' + data.recommendation_reason + '</div>';
      if (data.gas_price_gwei) {
        reasonHtml += '<div class="field-value number" style="font-size: 0.75rem; margin-top: 0.25rem;">Gas: ' + data.gas_price_gwei + ' gwei</div>';
      }
      reasonHtml += '</div>';

      if (data.recommendation === 'spandex' && data.spandex) {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(data.spandex, true, quoteChainId);
        if (data.curve) {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderCurveQuote(data.curve, false, quoteChainId);
        } else {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + (data.curve_error || 'No quote available') + '</div>';
        }
      } else if (data.recommendation === 'curve' && data.curve) {
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(data.curve, true, quoteChainId);
        if (data.spandex) {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderSpandexQuote(data.spandex, false, quoteChainId);
        } else {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="error-message">' + (data.spandex_error || 'No quote available') + '</div>';
        }
      } else if (data.spandex) {
        tabRecommended.textContent = 'Spandex';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(data.spandex, false, quoteChainId);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else if (data.curve) {
        tabRecommended.textContent = 'Curve';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(data.curve, false, quoteChainId);
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
      } else {
        tabRecommended.textContent = 'Results';
        recommendedContent.innerHTML = '<div class="error-message">No quotes available. ' +
          (data.spandex_error ? 'Spandex: ' + data.spandex_error + '. ' : '') +
          (data.curve_error ? 'Curve: ' + data.curve_error : '') + '</div>';
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
      recommendedContent.innerHTML = '<div class="error-message">' + msg + '</div>';
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
      const normalizedParams = cloneCompareParams(compareParams);
      const showLoading = options.showLoading === true;
      const preserveUiState = options.preserveUiState === true;
      const keepExistingResultsOnError = options.keepExistingResultsOnError === true;
      const updateUrl = options.updateUrl !== false;
      const requestId = Number.isFinite(options.requestId) ? Number(options.requestId) : ++compareRequestSequence;

      if (requestId > compareRequestSequence) {
        compareRequestSequence = requestId;
      }

      currentQuoteChainId = Number(normalizedParams.chainId);

      if (showLoading) {
        submit.disabled = true;
        submit.textContent = 'Comparing...';
        result.className = 'show';
        recommendedContent.innerHTML = '<div class="result-header">Querying Spandex + Curve for best price...</div>';
        tabRecommended.textContent = 'Loading...';
        tabAlternative.style.display = 'none';
        alternativeContent.innerHTML = '';
        setActiveTab('recommended');
      }

      try {
        const payload = await fetchComparePayload(normalizedParams);
        if (requestId !== compareRequestSequence) {
          return { ok: false, stale: true, params: normalizedParams };
        }

        showCompareResult(payload, { preserveUiState });
        if (updateUrl) {
          updateUrlFromCompareParams(normalizedParams);
        }
        return { ok: true, payload, params: normalizedParams };
      } catch (err) {
        if (requestId !== compareRequestSequence) {
          return { ok: false, stale: true, params: normalizedParams };
        }

        const message = err instanceof Error ? err.message : String(err);
        if (!keepExistingResultsOnError) {
          showError(message);
        }
        return { ok: false, error: message, params: normalizedParams };
      } finally {
        if (showLoading) {
          submit.disabled = false;
          submit.textContent = 'Compare Quotes';
        }
      }
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

      const chainId = card.dataset.quoteChainId || currentQuoteChainId || chainIdInput.value;

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
        setWalletMessage('Connect wallet first', true);
        setTxStatus(card, 'Connect wallet first', 'error');
        updateTransactionActionStates();
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
        setWalletMessage('Connect wallet first', true);
        setTxStatus(card, 'Connect wallet first', 'error');
        updateTransactionActionStates();
        return;
      }

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
    if (params.get('chainId')) chainIdInput.value = params.get('chainId');
    if (params.get('from')) {
      const fromAddr = params.get('from');
      fromInput.dataset.address = fromAddr;
      // Will format with symbol after tokenlist loads
    } else {
      // Will apply defaults after tokenlist loads
    }
    if (params.get('to')) {
      const toAddr = params.get('to');
      toInput.dataset.address = toAddr;
      // Will format with symbol after tokenlist loads
    }
    if (params.get('amount')) amountInput.value = params.get('amount');
    if (params.get('slippageBps')) slippageInput.value = params.get('slippageBps');
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

    loadTokenlist().then(() => {
      // Now we can format tokens with symbols from the loaded tokenlist
      const chainId = Number(chainIdInput.value);
      
      if (params.get('from')) {
        const fromAddr = params.get('from');
        const fromToken = findTokenByAddress(fromAddr, chainId);
        if (fromToken) {
          fromInput.value = formatTokenDisplay(fromToken.symbol, fromToken.address);
          fromInput.dataset.address = fromToken.address;
        } else {
          fromInput.value = fromAddr;
          fromInput.dataset.address = fromAddr;
        }
      }
      
      if (params.get('to')) {
        const toAddr = params.get('to');
        const toToken = findTokenByAddress(toAddr, chainId);
        if (toToken) {
          toInput.value = formatTokenDisplay(toToken.symbol, toToken.address);
          toInput.dataset.address = toToken.address;
        } else {
          toInput.value = toAddr;
          toInput.dataset.address = toAddr;
        }
      }
      
      // Apply defaults if no URL params for from/to
      if (!params.get('from') && !params.get('to')) {
        applyDefaults(chainId);
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
      const tokenList = await loadTokenList();
      sendJson(res, 200, tokenList);
    } catch (err) {
      logError("Failed to load tokenlist", err);
      const details = err instanceof Error ? err.message : String(err);
      sendError(res, 500, `Failed to load tokenlist: ${details}`);
    }
    return;
  }

  if (url.pathname === "/quote" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, slippageBps, sender } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await findQuote(chainId, from, to, amount, slippageBps, sender);
      const duration = Date.now() - startTime;
      log(
        `Quote: chain=${chainId} ${result.from_symbol || from.slice(0, 10)} -> ` +
          `${result.to_symbol || to.slice(0, 10)}, amount=${amount}, ` +
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

    const { chainId, from, to, amount, slippageBps, sender } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await compareQuotes(chainId, from, to, amount, slippageBps, sender);
      const duration = Date.now() - startTime;
      log(
        `Compare: chain=${chainId} ${from.slice(0, 10)} -> ${to.slice(0, 10)}, ` +
          `amount=${amount}, recommendation=${result.recommendation}, ${duration}ms`
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

  log(`404: ${req.method} ${url.pathname}`);
  sendError(res, 404, "Not found");
}

async function main() {
  if (CURVE_ENABLED) {
    const rpcUrl =
      process.env.RPC_URL_1 ||
      (process.env.ALCHEMY_API_KEY
        ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        : "");
    if (rpcUrl) {
      try {
        log("Initializing Curve API...");
        await initCurve(rpcUrl);
        log("Curve API initialized");
        captureMessage("Curve API initialized successfully");
      } catch (err) {
        logError("Curve initialization failed, continuing without Curve", err);
      }
    } else {
      log("No RPC URL for Ethereum, Curve disabled");
    }
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
