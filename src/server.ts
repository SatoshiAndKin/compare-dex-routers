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
    const gasPriceWei = gasPriceGwei ? Number(gasPriceGwei) * 1e9 : 0;
    const spandexGasCostEth = gasPriceWei > 0 ? (spandexGas * gasPriceWei) / 1e18 : 0;
    const curveGasCostEth = gasPriceWei > 0 ? (curveGas * gasPriceWei) / 1e18 : 0;

    if (curveOutput > spandexOutput) {
      recommendation = "curve";
      const diff = curveOutput - spandexOutput;
      const pct = ((diff / spandexOutput) * 100).toFixed(3);
      reason = `Curve outputs ${diff.toFixed(6)} more (+${pct}%)`;
      if (curveGasCostEth > 0 && spandexGasCostEth > 0) {
        reason += `. Gas: Curve ${curveGas} units (~${curveGasCostEth.toFixed(6)} ETH) vs Spandex ${spandexGas} units (~${spandexGasCostEth.toFixed(6)} ETH)`;
      } else if (curveGasCostEth > 0) {
        reason += `. Curve gas: ${curveGas} units (~${curveGasCostEth.toFixed(6)} ETH)`;
      }
    } else if (spandexOutput > curveOutput) {
      recommendation = "spandex";
      const diff = spandexOutput - curveOutput;
      const pct = ((diff / curveOutput) * 100).toFixed(3);
      reason = `Spandex (${spandex.result.provider}) outputs ${diff.toFixed(6)} more (+${pct}%)`;
      if (curveGasCostEth > 0 && spandexGasCostEth > 0) {
        reason += `. Gas: Spandex ${spandexGas} units (~${spandexGasCostEth.toFixed(6)} ETH) vs Curve ${curveGas} units (~${curveGasCostEth.toFixed(6)} ETH)`;
      } else if (spandexGasCostEth > 0) {
        reason += `. Spandex gas: ${spandexGas} units (~${spandexGasCostEth.toFixed(6)} ETH)`;
      }
    } else {
      recommendation = "spandex";
      reason = "Equal output amounts; defaulting to Spandex for multi-provider coverage";
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
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { margin: 0 0 16px; color: #333; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .wallet-controls { position: relative; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .wallet-button { padding: 10px 16px; font-size: 14px; }
    .wallet-provider-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 220px; background: #fff; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14); z-index: 30; padding: 6px; }
    .wallet-provider-option { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; color: #222; border: none; border-radius: 4px; padding: 8px; font-size: 14px; }
    .wallet-provider-option:hover { background: #f3f7ff; }
    .wallet-provider-icon, .wallet-connected-icon { width: 20px; height: 20px; object-fit: cover; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
    .wallet-connected { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; }
    .wallet-connected[hidden] { display: none !important; }
    .wallet-address { font-family: monospace; color: #222; }
    .wallet-disconnect-btn { padding: 6px 10px; font-size: 12px; background: #666; }
    .wallet-disconnect-btn:hover { background: #555; }
    .wallet-message { font-size: 12px; color: #666; max-width: 280px; text-align: right; }
    @media (max-width: 720px) {
      .page-header { flex-direction: column; }
      .wallet-controls { align-items: flex-start; }
      .wallet-message { text-align: left; }
    }
    form { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .form-group { margin-bottom: 16px; position: relative; }
    label { display: block; font-weight: 600; margin-bottom: 6px; color: #555; }
    input { width: 100%; padding: 10px; font-size: 14px; font-family: monospace; border: 1px solid #ddd; border-radius: 4px; }
    input:focus { outline: none; border-color: #0066cc; }
    .form-row { display: flex; gap: 16px; }
    .form-row .form-group { flex: 1; }
    button { padding: 12px 24px; font-size: 16px; cursor: pointer; background: #0066cc; color: white; border: none; border-radius: 4px; }
    button:hover { background: #0052a3; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    #result { display: none; }
    #result.show { display: block; }
    .result-box { background: #1e1e1e; color: #d4d4d4; padding: 20px; border-radius: 0 0 8px 8px; }
    .error { color: #e74c3c; }
    .result-header { color: #888; margin-bottom: 12px; font-size: 14px; }
    .field { margin-bottom: 12px; }
    .field-label { color: #888; font-size: 12px; text-transform: uppercase; }
    .field-value { color: #4ec9b0; word-break: break-all; }
    .field-value.number { color: #b5cea8; }
    .provider-tag { display: inline-block; background: #264f78; color: #9cdcfe; padding: 3px 10px; border-radius: 4px; font-size: 13px; margin-left: 8px; }
    .recommendation-banner { padding: 10px 14px; border-radius: 4px; margin-bottom: 14px; font-size: 13px; }
    .recommendation-banner.winner { background: #1a3a1a; color: #4ec9b0; border: 1px solid #2d5a2d; }
    .recommendation-banner.loser { background: #3a2a1a; color: #d4a054; border: 1px solid #5a3a1a; }
    .recommendation-banner.error { background: #3a1a1a; color: #e74c3c; border: 1px solid #5a1a1a; }
    .tabs { display: flex; gap: 0; }
    .tab { padding: 10px 20px; cursor: pointer; background: #ccc; color: #555; border: none; border-radius: 8px 8px 0 0; font-size: 14px; font-weight: 600; }
    .tab.active { background: #1e1e1e; color: #d4d4d4; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .route-step { background: #2d2d2d; padding: 10px; border-radius: 4px; margin: 8px 0; }
    .route-step-header { color: #dcdcaa; margin-bottom: 6px; }
    .autocomplete-list { position: absolute; z-index: 10; background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 4px 4px; max-height: 280px; overflow-y: auto; width: 100%; display: none; }
    .autocomplete-list.show { display: block; }
    .autocomplete-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; }
    .autocomplete-item:hover, .autocomplete-item.active { background: #e8f0fe; }
    .autocomplete-logo { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; background: #f0f0f0; flex-shrink: 0; }
    .autocomplete-meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .autocomplete-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .autocomplete-symbol { font-weight: 600; color: #333; font-family: system-ui, sans-serif; }
    .autocomplete-name { color: #666; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .autocomplete-addr { color: #888; font-size: 11px; font-family: monospace; }
    .tx-actions { margin-top: 16px; padding-top: 14px; border-top: 1px solid #333; }
    .tx-buttons { display: flex; gap: 10px; flex-wrap: wrap; }
    .tx-btn { padding: 9px 14px; font-size: 14px; border-radius: 4px; border: none; cursor: pointer; }
    .tx-btn.swap-primary { background: #22a55a; color: #fff; }
    .tx-btn.swap-primary:hover { background: #1f934f; }
    .tx-btn.swap-secondary { background: #2f4f6f; color: #d7e8ff; }
    .tx-btn.swap-secondary:hover { background: #3c638c; }
    .tx-btn.approve-btn { background: #6b7280; color: #fff; }
    .tx-btn.approve-btn:hover { background: #5b6270; }
    .tx-btn.approved { background: #1f934f; color: #fff; }
    .tx-btn.wallet-required { opacity: 0.6; cursor: not-allowed; }
    .tx-status { margin-top: 10px; font-size: 13px; color: #9ca3af; min-height: 18px; }
    .tx-status.pending { color: #f6c85f; }
    .tx-status.success { color: #34d399; }
    .tx-status.error { color: #f87171; }
    .refresh-indicator { margin-bottom: 10px; padding: 10px 12px; border-radius: 6px; border: 1px solid #2f4f6f; background: #142233; color: #d7e8ff; }
    .refresh-indicator-meta { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; font-size: 12px; }
    .refresh-indicator-status { color: #9ca3af; min-height: 16px; }
    .refresh-indicator-status.error { color: #f87171; }
    .refresh-indicator-progress { margin-top: 8px; height: 4px; border-radius: 999px; background: #0f1726; overflow: hidden; }
    .refresh-indicator-progress-fill { height: 100%; width: 0; background: linear-gradient(90deg, #4ec9b0, #34d399); transition: width 0.2s linear; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>Compare DEX Routers</h1>
    <div class="wallet-controls">
      <button type="button" id="connectWalletBtn" class="wallet-button">Connect Wallet</button>
      <div id="walletConnected" class="wallet-connected" hidden>
        <img id="walletConnectedIcon" class="wallet-connected-icon" alt="Wallet icon" hidden>
        <span id="walletConnectedName"></span>
        <span id="walletConnectedAddress" class="wallet-address"></span>
        <button type="button" id="disconnectWalletBtn" class="wallet-disconnect-btn">Disconnect</button>
      </div>
      <div id="walletProviderMenu" class="wallet-provider-menu" hidden></div>
      <div id="walletMessage" class="wallet-message" aria-live="polite"></div>
    </div>
  </div>

  <form id="form">
    <div class="form-row">
      <div class="form-group">
        <label for="chainId">Chain</label>
        <select id="chainId" style="width: 200px; padding: 10px; font-size: 14px; border: 1px solid #ddd; border-radius: 4px;">
          <option value="1">Ethereum (1)</option>
          <option value="8453" selected>Base (8453)</option>
          <option value="42161">Arbitrum (42161)</option>
          <option value="10">Optimism (10)</option>
          <option value="137">Polygon (137)</option>
          <option value="56">BSC (56)</option>
          <option value="43114">Avalanche (43114)</option>
        </select>
      </div>
      <div class="form-group">
        <label for="slippageBps">Slippage (bps)</label>
        <input type="text" id="slippageBps" value="50" style="width: 120px;">
      </div>
    </div>
    <div class="form-group">
      <label for="from">From (token address)</label>
      <input type="text" id="from" placeholder="0x... or search by symbol/name/address" autocomplete="off">
      <div class="autocomplete-list" id="fromAutocomplete"></div>
    </div>
    <div class="form-group">
      <label for="to">To (token address)</label>
      <input type="text" id="to" placeholder="0x... or search by symbol/name/address" autocomplete="off">
      <div class="autocomplete-list" id="toAutocomplete"></div>
    </div>
    <div class="form-group">
      <label for="amount">Input Amount (human-readable)</label>
      <input type="text" id="amount" value="1000" style="width: 200px;">
    </div>
    <div class="form-group">
      <label for="sender">Sender (optional, for approval check)</label>
      <input type="text" id="sender" placeholder="0x...">
    </div>
    <button type="submit" id="submit">Compare Quotes</button>
  </form>

  <div id="result">
    <div id="refreshIndicator" class="refresh-indicator" hidden>
      <div class="refresh-indicator-meta">
        <span id="refreshCountdown">Refreshing in 15s</span>
        <span id="refreshStatus" class="refresh-indicator-status" aria-live="polite"></span>
      </div>
      <div class="refresh-indicator-progress" aria-hidden="true">
        <div id="refreshProgress" class="refresh-indicator-progress-fill"></div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="recommended" id="tabRecommended">Recommended</button>
      <button class="tab" data-tab="alternative" id="tabAlternative">Alternative</button>
    </div>
    <div class="result-box">
      <div class="tab-content active" id="recommendedContent"></div>
      <div class="tab-content" id="alternativeContent"></div>
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

    const senderInput = document.getElementById('sender');
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
    const refreshIndicator = document.getElementById('refreshIndicator');
    const refreshCountdown = document.getElementById('refreshCountdown');
    const refreshStatus = document.getElementById('refreshStatus');
    const refreshProgress = document.getElementById('refreshProgress');

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

    function setWalletGlobals() {
      window.__selectedWalletProvider = connectedWalletProvider;
      window.__selectedWalletAddress = connectedWalletAddressValue;
      window.__selectedWalletInfo = connectedWalletInfo;
    }

    function truncateAddress(address) {
      if (typeof address !== 'string' || address.length < 10) return address || '';
      return address.slice(0, 6) + '...' + address.slice(-4);
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
        senderInput.value = account;

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
      senderInput.value = '';
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
        input.value = token.address;
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
        from: fromInput.value,
        to: toInput.value,
        amount: amountInput.value,
        slippageBps: slippageInput.value,
        sender: senderInput.value,
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
      if (normalized.sender) {
        url.searchParams.set('sender', normalized.sender);
      } else {
        url.searchParams.delete('sender');
      }
      window.history.replaceState({}, '', url.toString());
    }

    function clearAutoRefreshTimer() {
      if (autoRefreshState.timerId !== null) {
        clearInterval(autoRefreshState.timerId);
        autoRefreshState.timerId = null;
      }
    }

    function getRefreshProgressPercent() {
      const elapsed = AUTO_REFRESH_SECONDS - autoRefreshState.secondsRemaining;
      if (elapsed <= 0) return 0;
      return Math.min(100, Math.max(0, (elapsed / AUTO_REFRESH_SECONDS) * 100));
    }

    function updateRefreshIndicator() {
      const shouldShow = result.classList.contains('show') && Boolean(autoRefreshState.lastParams);
      refreshIndicator.hidden = !shouldShow;
      if (!shouldShow) {
        refreshProgress.style.width = '0%';
        return;
      }

      if (autoRefreshState.paused) {
        refreshCountdown.textContent = 'Auto-refresh paused';
      } else if (autoRefreshState.inFlight) {
        refreshCountdown.textContent = 'Refreshing quotes...';
      } else {
        refreshCountdown.textContent = 'Refreshing in ' + autoRefreshState.secondsRemaining + 's';
      }

      refreshStatus.classList.remove('error');
      if (autoRefreshState.errorMessage) {
        refreshStatus.textContent = autoRefreshState.errorMessage;
        refreshStatus.classList.add('error');
      } else if (autoRefreshState.paused) {
        refreshStatus.textContent = 'Waiting for transaction to settle.';
      } else {
        refreshStatus.textContent = '';
      }

      const width = autoRefreshState.inFlight ? 100 : getRefreshProgressPercent();
      refreshProgress.style.width = width + '%';
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

    function applyDefaults(chainId) {
      const defaults = DEFAULT_TOKENS[chainId];
      if (defaults) {
        fromInput.value = defaults.from;
        toInput.value = defaults.to;
      }
    }

    chainIdInput.addEventListener('change', function() {
      stopAutoRefresh();
      clearResultDisplay();
      currentQuoteChainId = null;
      applyDefaults(Number(this.value));
      fromAutocomplete.hide();
      toAutocomplete.hide();
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
      const swapStyleClass = approvalRequired ? 'swap-secondary' : 'swap-primary';

      return (
        '<div class="tx-actions" data-quote-chain-id="' + quoteChainId + '" data-router-address="' + routerAddress +
        '" data-router-calldata="' + routerCalldata + '" data-router-value="' + routerValue +
        '" data-approval-token="' + approvalToken + '" data-approval-spender="' + approvalSpender + '">' +
          '<div class="tx-buttons">' +
            (approvalRequired
              ? '<button type="button" class="tx-btn approve-btn' + walletRequiredClass + '" data-action="approve">Approve</button>'
              : '') +
            '<button type="button" class="tx-btn swap-btn ' + swapStyleClass + walletRequiredClass + '" data-action="swap">Swap</button>' +
          '</div>' +
          '<div class="tx-status" aria-live="polite"></div>' +
        '</div>'
      );
    }

    function renderSpandexQuote(data, isWinner, quoteChainId) {
      const banner = isWinner
        ? '<div class="recommendation-banner winner">RECOMMENDED</div>'
        : '<div class="recommendation-banner loser">Alternative quote</div>';
      return banner + \`
        <div class="result-header">Spandex Quote <span class="provider-tag">\${data.provider}</span></div>
        <div class="field">
          <div class="field-label">Output Amount</div>
          <div class="field-value number">\${data.output_amount}\${data.to_symbol ? ' ' + data.to_symbol : ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Gas Used</div>
          <div class="field-value number">\${data.gas_used}</div>
        </div>
        <div class="field">
          <div class="field-label">From</div>
          <div class="field-value">\${data.from_symbol ? data.from_symbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${data.from}</span></div>
        </div>
        <div class="field">
          <div class="field-label">To</div>
          <div class="field-value">\${data.to_symbol ? data.to_symbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${data.to}</span></div>
        </div>
        <div class="field">
          <div class="field-label">Input Amount</div>
          <div class="field-value number">\${data.amount}\${data.from_symbol ? ' ' + data.from_symbol : ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Slippage</div>
          <div class="field-value number">\${data.slippage_bps} bps</div>
        </div>
        \${data.approval_token ? \`
        <div class="field">
          <div class="field-label">Approval Token</div>
          <div class="field-value">\${data.approval_token}</div>
        </div>
        <div class="field">
          <div class="field-label">Approval Spender</div>
          <div class="field-value">\${data.approval_spender}</div>
        </div>
        \` : ''}
        <div class="field">
          <div class="field-label">Router Address</div>
          <div class="field-value">\${data.router_address}</div>
        </div>
        <div class="field">
          <div class="field-label">Router Calldata</div>
          <div class="field-value" style="font-size: 11px;">\${data.router_calldata}</div>
        </div>
        \${data.router_value ? \`
        <div class="field">
          <div class="field-label">Router Value (wei)</div>
          <div class="field-value number">\${data.router_value}</div>
        </div>
        \` : ''}
        \${renderQuoteActions({
          quoteChainId,
          routerAddress: data.router_address,
          routerCalldata: data.router_calldata,
          routerValue: data.router_value || '0x0',
          approvalToken: data.approval_token || '',
          approvalSpender: data.approval_spender || '',
        })}
      \`;
    }

    function formatCurveRoute(route, symbols) {
      if (!route || route.length === 0) return '';
      return route.map((step, i) => {
        const poolName = step.poolName || step.poolId || 'Unknown Pool';
        const showPoolId = step.poolName && step.poolId && step.poolName !== step.poolId;
        const inputSymbol = symbols[step.inputCoinAddress?.toLowerCase()] || '';
        const outputSymbol = symbols[step.outputCoinAddress?.toLowerCase()] || '';
        return \`
        <div class="route-step">
          <div class="route-step-header">Step \${i + 1}: \${poolName}\${showPoolId ? ' <span style="color: #888; font-size: 11px;">' + step.poolId + '</span>' : ''}</div>
          <div class="field-label">Pool</div>
          <div class="field-value"><span style="color: #888; font-size: 11px;">\${step.poolAddress || ''}</span></div>
          <div class="field-label">Input</div>
          <div class="field-value">\${inputSymbol ? inputSymbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${step.inputCoinAddress || ''}</span></div>
          <div class="field-label">Output</div>
          <div class="field-value">\${outputSymbol ? outputSymbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${step.outputCoinAddress || ''}</span></div>
        </div>
      \`}).join('');
    }

    function renderCurveQuote(data, isWinner, quoteChainId) {
      const symbols = {};
      symbols[data.from.toLowerCase()] = data.from_symbol;
      symbols[data.to.toLowerCase()] = data.to_symbol;
      if (data.route_symbols) {
        Object.entries(data.route_symbols).forEach(([k, v]) => { symbols[k.toLowerCase()] = v; });
      }
      const banner = isWinner
        ? '<div class="recommendation-banner winner">RECOMMENDED</div>'
        : '<div class="recommendation-banner loser">Alternative quote</div>';
      return banner + \`
        <div class="result-header">Curve Quote</div>
        <div class="field">
          <div class="field-label">Output Amount</div>
          <div class="field-value number">\${data.output_amount}\${data.to_symbol ? ' ' + data.to_symbol : ''}</div>
        </div>
        \${data.gas_used ? \`
        <div class="field">
          <div class="field-label">Gas Used</div>
          <div class="field-value number">\${data.gas_used}</div>
        </div>
        \` : ''}
        <div class="field">
          <div class="field-label">From</div>
          <div class="field-value">\${data.from_symbol ? data.from_symbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${data.from}</span></div>
        </div>
        <div class="field">
          <div class="field-label">To</div>
          <div class="field-value">\${data.to_symbol ? data.to_symbol + ' ' : ''}<span style="color: #888; font-size: 11px;">\${data.to}</span></div>
        </div>
        <div class="field">
          <div class="field-label">Input Amount</div>
          <div class="field-value number">\${data.amount}\${data.from_symbol ? ' ' + data.from_symbol : ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Route (\${data.route.length} steps)</div>
          \${formatCurveRoute(data.route, symbols)}
        </div>
        \${data.approval_target ? \`
        <div class="field">
          <div class="field-label">Approval Target</div>
          <div class="field-value">\${data.approval_target}</div>
        </div>
        \` : ''}
        <div class="field">
          <div class="field-label">Router Address</div>
          <div class="field-value">\${data.router_address}</div>
        </div>
        <div class="field">
          <div class="field-label">Router Calldata</div>
          <div class="field-value" style="font-size: 11px;">\${data.router_calldata}</div>
        </div>
        \${renderQuoteActions({
          quoteChainId,
          routerAddress: data.router_address,
          routerCalldata: data.router_calldata,
          routerValue: '0x0',
          approvalToken: data.from || '',
          approvalSpender: data.approval_target || '',
        })}
      \`;
    }

    function showCompareResult(data, options = {}) {
      const preserveUiState = options.preserveUiState === true;
      const priorUiState = preserveUiState ? captureResultUiState() : null;
      result.className = 'show';

      if (!preserveUiState) {
        setActiveTab('recommended');
      }

      let reasonHtml = '<div class="field" style="margin-bottom: 16px;">' +
        '<div class="field-label">Comparison</div>' +
        '<div class="field-value">' + data.recommendation_reason + '</div>';
      if (data.gas_price_gwei) {
        reasonHtml += '<div class="field-value number" style="font-size: 12px; margin-top: 4px;">Gas price: ' + data.gas_price_gwei + ' gwei</div>';
      }
      reasonHtml += '</div>';

      const quoteChainId = currentQuoteChainId || (data.spandex && data.spandex.chainId) || Number(chainIdInput.value);

      if (data.recommendation === 'spandex' && data.spandex) {
        tabRecommended.textContent = 'Spandex (Recommended)';
        recommendedContent.innerHTML = reasonHtml + renderSpandexQuote(data.spandex, true, quoteChainId);
        if (data.curve) {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderCurveQuote(data.curve, false, quoteChainId);
        } else {
          tabAlternative.textContent = 'Curve';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="recommendation-banner error">' + (data.curve_error || 'No quote available') + '</div>';
        }
      } else if (data.recommendation === 'curve' && data.curve) {
        tabRecommended.textContent = 'Curve (Recommended)';
        recommendedContent.innerHTML = reasonHtml + renderCurveQuote(data.curve, true, quoteChainId);
        if (data.spandex) {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = renderSpandexQuote(data.spandex, false, quoteChainId);
        } else {
          tabAlternative.textContent = 'Spandex';
          tabAlternative.style.display = '';
          alternativeContent.innerHTML = '<div class="recommendation-banner error">' + (data.spandex_error || 'No quote available') + '</div>';
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
        recommendedContent.innerHTML = '<div class="error">No quotes available. ' +
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
      recommendedContent.innerHTML = '<div class="error">' + msg + '</div>';
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
          button.textContent = 'Approved';
          button.dataset.locked = 'true';
          button.classList.add('approved');
          button.disabled = true;

          const swapButton = card.querySelector('.swap-btn');
          if (swapButton) {
            swapButton.classList.remove('swap-secondary');
            swapButton.classList.add('swap-primary');
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
    if (params.get('from')) fromInput.value = params.get('from');
    else applyDefaults(Number(chainIdInput.value));
    if (params.get('to')) toInput.value = params.get('to');
    if (params.get('amount')) amountInput.value = params.get('amount');
    if (params.get('slippageBps')) slippageInput.value = params.get('slippageBps');
    if (params.get('sender')) senderInput.value = params.get('sender');
    if (!params.get('from') && !params.get('to')) applyDefaults(Number(chainIdInput.value));

    const shouldLoadFromUrlParams = Boolean(
      params.get('chainId') && params.get('from') && params.get('to') && params.get('amount')
    );

    loadTokenlist().then(() => {
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
