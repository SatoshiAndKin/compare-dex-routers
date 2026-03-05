/**
 * Quote display and progressive rendering module.
 *
 * Manages:
 * - Progressive quote state tracking
 * - Rendering Spandex and Curve quotes with recommendation labels
 * - Tab switching (recommended/alternative)
 * - Quote action buttons (approve/swap) HTML generation
 * - Secondary details (collapsible) rendering
 * - Error display with clickable token references
 * - Parallel quote fetching with AbortController
 * - Client-side recommendation computation
 */

import { CURVE_SUPPORTED_CHAINS } from "./config.js";
import type {
  CompareParams,
  QuoteResponse,
  CurveQuoteResponse,
  CurveRouteStep,
  ProgressiveQuoteState,
  Token,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuoteDisplayElements {
  result: HTMLElement;
  recommendedContent: HTMLElement;
  alternativeContent: HTMLElement;
  tabRecommended: HTMLElement;
  tabAlternative: HTMLElement;
  submit: HTMLButtonElement;
}

export interface QuoteDisplayCallbacks {
  /** Check if wallet is connected */
  hasConnectedWallet: () => boolean;
  /** Get current chain ID from selector */
  getCurrentChainId: () => number;
  /** Render a token icon for result display */
  renderResultTokenIcon: (address: string, chainId: number | string) => string;
  /** Get tokens for chain (for address→symbol lookup in errors) */
  getTokensForChain: (chainId: number) => Token[];
  /** Handle token ref click (copy address) */
  handleTokenRefClick: (element: HTMLElement, address: string) => void;
  /** Format error with token refs */
  formatErrorWithTokenRefs: (message: string, chainId: number | string) => string;
  /** Update transaction action button states */
  updateTransactionActionStates: () => void;
  /** Update refresh indicator */
  forceUpdateRefreshIndicator: () => void;
  /** Populate non-active amount field from quote */
  populateNonActiveField: (quote: QuoteResponse | CurveQuoteResponse | null) => void;
  /** Clear non-active amount field */
  clearNonActiveField: () => void;
  /** Clone compare params */
  cloneCompareParams: (params: CompareParams) => CompareParams;
  /** Convert compare params to URLSearchParams */
  compareParamsToSearchParams: (params: CompareParams) => URLSearchParams;
  /** Update URL from compare params */
  updateUrlFromCompareParams: (params: CompareParams) => void;
  /** Save user preferences */
  saveUserPreferences: (params: CompareParams) => void;
  /** Update swap confirmation modal text if open */
  updateSwapConfirmModalText: () => void;
  /** Check if swap confirm modal is open */
  isSwapConfirmModalOpen: () => boolean;
  /** Get best quote from progressive state (for amount fields) */
  getBestQuoteFromState: () => QuoteResponse | CurveQuoteResponse | null;
}

export interface FetchCompareResult {
  ok: boolean;
  stale?: boolean;
  error?: string;
  params: CompareParams;
  payload?: {
    spandex: QuoteResponse | null;
    curve: CurveQuoteResponse | null;
    recommendation: string | null;
    recommendation_reason: string | null;
    gas_price_gwei: string | null;
    output_to_eth_rate: number | null;
    input_to_eth_rate: number | null;
    mode: string | null;
    single_router_mode: boolean;
  };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let els: QuoteDisplayElements | null = null;
let cbs: QuoteDisplayCallbacks | null = null;
let currentQuoteChainId: number | null = null;
let compareRequestSequence = 0;
let currentAbortController: AbortController | null = null;

let progressiveQuoteState: ProgressiveQuoteState = {
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

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function setActiveTab(tabName: "recommended" | "alternative"): void {
  if (!els) return;
  const target =
    tabName === "alternative" && els.tabAlternative.style.display !== "none"
      ? "alternative"
      : "recommended";
  els.tabRecommended.classList.toggle("active", target === "recommended");
  els.tabAlternative.classList.toggle("active", target === "alternative");
  els.recommendedContent.classList.toggle("active", target === "recommended");
  els.alternativeContent.classList.toggle("active", target === "alternative");
}

// getActiveTab and captureResultUiState removed — available for future preserveUiState support

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderQuoteActions(options: {
  quoteChainId: number | string;
  routerAddress: string;
  routerCalldata: string;
  routerValue: string;
  approvalToken: string;
  approvalSpender: string;
  inputAmountRaw: string;
}): string {
  const quoteChainId = String(options.quoteChainId || "");
  const routerAddress = String(options.routerAddress || "");
  const routerCalldata = String(options.routerCalldata || "");
  const routerValue = String(options.routerValue || "0x0");
  const approvalToken = String(options.approvalToken || "");
  const approvalSpender = String(options.approvalSpender || "");
  const inputAmountRaw = String(options.inputAmountRaw || "0");
  const approvalRequired = Boolean(approvalToken && approvalSpender);
  const walletRequiredClass = cbs && cbs.hasConnectedWallet() ? "" : " wallet-required";

  if (approvalRequired) {
    return (
      '<div class="tx-actions" data-quote-chain-id="' +
      quoteChainId +
      '" data-router-address="' +
      routerAddress +
      '" data-router-calldata="' +
      routerCalldata +
      '" data-router-value="' +
      routerValue +
      '" data-approval-token="' +
      approvalToken +
      '" data-approval-spender="' +
      approvalSpender +
      '" data-input-amount-raw="' +
      inputAmountRaw +
      '">' +
      '<div class="tx-steps">' +
      '<div class="tx-step">' +
      '<span class="tx-step-num">1.</span>' +
      '<button type="button" class="tx-btn approve-btn' +
      walletRequiredClass +
      '" data-action="approve">Approve</button>' +
      "</div>" +
      '<div class="tx-step">' +
      '<span class="tx-step-num">2.</span>' +
      '<button type="button" class="tx-btn swap-btn disabled' +
      walletRequiredClass +
      '" data-action="swap" disabled>Swap</button>' +
      "</div>" +
      "</div>" +
      '<div class="tx-status" aria-live="polite"></div>' +
      "</div>"
    );
  } else {
    return (
      '<div class="tx-actions" data-quote-chain-id="' +
      quoteChainId +
      '" data-router-address="' +
      routerAddress +
      '" data-router-calldata="' +
      routerCalldata +
      '" data-router-value="' +
      routerValue +
      '" data-approval-token="" data-approval-spender="" data-input-amount-raw="' +
      inputAmountRaw +
      '">' +
      '<div class="tx-steps">' +
      '<button type="button" class="tx-btn swap-btn' +
      walletRequiredClass +
      '" data-action="swap">Swap</button>' +
      "</div>" +
      '<div class="tx-status" aria-live="polite"></div>' +
      "</div>"
    );
  }
}

function renderSecondaryDetails(
  data: QuoteResponse | CurveQuoteResponse,
  type: "spandex" | "curve"
): string {
  const details: string[] = [];

  details.push(
    '<div class="field"><div class="field-label">Router Address</div><div class="field-value">' +
      data.router_address +
      "</div></div>"
  );
  details.push(
    '<div class="field"><div class="field-label">Router Calldata</div><div class="field-value field-value-compact">' +
      data.router_calldata +
      "</div></div>"
  );

  const routerValue = (data as QuoteResponse).router_value;
  if (routerValue) {
    details.push(
      '<div class="field"><div class="field-label">Router Value (wei)</div><div class="field-value number">' +
        routerValue +
        "</div></div>"
    );
  }

  if (data.input_amount_raw) {
    details.push(
      '<div class="field"><div class="field-label">Input Amount (wei)</div><div class="field-value number mono">' +
        data.input_amount_raw +
        "</div></div>"
    );
  }
  if (data.output_amount_raw) {
    details.push(
      '<div class="field"><div class="field-label">Output Amount (wei)</div><div class="field-value number mono">' +
        data.output_amount_raw +
        "</div></div>"
    );
  }

  const spandexData = data as QuoteResponse;
  if (spandexData.approval_token) {
    details.push(
      '<div class="field"><div class="field-label">Approval Token</div><div class="field-value">' +
        spandexData.approval_token +
        "</div></div>"
    );
    details.push(
      '<div class="field"><div class="field-label">Approval Spender</div><div class="field-value">' +
        spandexData.approval_spender +
        "</div></div>"
    );
  }

  if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
    details.push(
      '<div class="field"><div class="field-label">Gas Cost</div><div class="field-value number">' +
        data.gas_cost_eth +
        " ETH</div></div>"
    );
    const gasUsed = data.gas_used && Number(data.gas_used) > 0 ? data.gas_used : null;
    if (gasUsed) {
      details.push(
        '<div class="field"><div class="field-label">Gas Units</div><div class="field-value number">' +
          gasUsed +
          "</div></div>"
      );
    }
  } else {
    const gasUsed = data.gas_used && Number(data.gas_used) > 0 ? data.gas_used : null;
    details.push(
      '<div class="field"><div class="field-label">Gas Used</div><div class="field-value number">' +
        (gasUsed || "N/A") +
        "</div></div>"
    );
  }

  if (data.net_value_eth && Number(data.net_value_eth) > 0) {
    details.push(
      '<div class="field"><div class="field-label">Net Value (after gas)</div><div class="field-value number">' +
        data.net_value_eth +
        " ETH</div></div>"
    );
  }

  if (type === "spandex" && spandexData.slippage_bps) {
    details.push(
      '<div class="field"><div class="field-label">Slippage</div><div class="field-value number">' +
        spandexData.slippage_bps +
        " bps</div></div>"
    );
  }

  return details.join("");
}

function renderSpandexQuote(
  data: QuoteResponse,
  isWinner: boolean,
  quoteChainId: number,
  gasPriceGwei: string | null
): string {
  if (!cbs) return "";

  const recommendationLabel = isWinner
    ? '<span class="result-recommendation winner">RECOMMENDED</span>'
    : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
  const primaryClass = isWinner ? "result-primary winner" : "result-primary alternative";
  const providerLabel = "Spandex" + (data.provider ? " / " + data.provider : "");

  const isTargetOut = data.mode === "targetOut";
  const primaryAmount = isTargetOut ? data.input_amount : data.output_amount;
  const primarySymbol = isTargetOut ? data.from_symbol : data.to_symbol;
  const primaryLabel = isTargetOut ? "You pay (required)" : "You receive (estimated)";
  const primaryTokenAddress = isTargetOut ? data.from : data.to;

  const primaryIcon = cbs.renderResultTokenIcon(primaryTokenAddress ?? "", quoteChainId);
  const fromIconHtml = cbs.renderResultTokenIcon(data.from ?? "", quoteChainId);
  const toIconHtml = cbs.renderResultTokenIcon(data.to ?? "", quoteChainId);

  let gasInfoLine = "";
  if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
    gasInfoLine =
      '<div class="field field-spaced"><div class="field-label">Gas Cost</div><div class="field-value number">' +
      data.gas_cost_eth +
      " ETH</div></div>";
    if (gasPriceGwei) {
      gasInfoLine +=
        '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' +
        gasPriceGwei +
        " gwei</div></div>";
    }
  } else if (gasPriceGwei) {
    gasInfoLine =
      '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' +
      gasPriceGwei +
      " gwei</div></div>";
  }

  const primary =
    '<div class="' +
    primaryClass +
    '">' +
    recommendationLabel +
    '<div class="result-output-label">' +
    primaryLabel +
    "</div>" +
    '<div class="result-output">' +
    primaryAmount +
    (primarySymbol ? " " + primaryIcon + primarySymbol : "") +
    "</div>" +
    '<div class="field field-spaced"><div class="field-label">Via ' +
    providerLabel +
    "</div></div>" +
    gasInfoLine +
    renderQuoteActions({
      quoteChainId,
      routerAddress: data.router_address ?? "",
      routerCalldata: data.router_calldata ?? "",
      routerValue: data.router_value || "0x0",
      approvalToken: data.approval_token || "",
      approvalSpender: data.approval_spender || "",
      inputAmountRaw: data.input_amount_raw || "0",
    }) +
    "</div>";

  const secondary =
    '<button type="button" class="details-toggle" onclick="this.classList.toggle(\'open\'); this.nextElementSibling.classList.toggle(\'open\');">Details</button>' +
    '<div class="details-content">' +
    '<div class="field"><div class="field-label">From</div><div class="field-value">' +
    fromIconHtml +
    (data.from_symbol ? data.from_symbol + " " : "") +
    data.from +
    "</div></div>" +
    '<div class="field"><div class="field-label">To</div><div class="field-value">' +
    toIconHtml +
    (data.to_symbol ? data.to_symbol + " " : "") +
    data.to +
    "</div></div>" +
    '<div class="field"><div class="field-label">' +
    (isTargetOut ? "Output Amount (desired)" : "Input Amount") +
    '</div><div class="field-value number">' +
    data.amount +
    (isTargetOut && data.to_symbol
      ? " " + toIconHtml + data.to_symbol
      : !isTargetOut && data.from_symbol
        ? " " + fromIconHtml + data.from_symbol
        : "") +
    "</div></div>" +
    '<div class="field"><div class="field-label">' +
    (isTargetOut ? "Input Amount (required)" : "Output Amount") +
    '</div><div class="field-value number">' +
    (isTargetOut
      ? data.input_amount + (data.from_symbol ? " " + fromIconHtml + data.from_symbol : "")
      : data.output_amount + (data.to_symbol ? " " + toIconHtml + data.to_symbol : "")) +
    "</div></div>" +
    renderSecondaryDetails(data, "spandex") +
    "</div>";

  return primary + secondary;
}

function formatCurveRoute(route: CurveRouteStep[], symbols: Record<string, string>): string {
  if (!route || route.length === 0) return "";
  return route
    .map((step, i) => {
      const poolName = step.poolName || step.poolId || "Unknown Pool";
      const inputSymbol = symbols[step.inputCoinAddress?.toLowerCase() ?? ""] || "";
      const outputSymbol = symbols[step.outputCoinAddress?.toLowerCase() ?? ""] || "";
      return (
        '<div class="route-step">' +
        '<div class="route-step-header">Step ' +
        (i + 1) +
        ": " +
        poolName +
        "</div>" +
        '<div class="field"><div class="field-label">Input</div><div class="field-value">' +
        (inputSymbol ? inputSymbol + " " : "") +
        (step.inputCoinAddress || "") +
        "</div></div>" +
        '<div class="field"><div class="field-label">Output</div><div class="field-value">' +
        (outputSymbol ? outputSymbol + " " : "") +
        (step.outputCoinAddress || "") +
        "</div></div>" +
        "</div>"
      );
    })
    .join("");
}

function renderCurveQuote(
  data: CurveQuoteResponse,
  isWinner: boolean,
  quoteChainId: number,
  gasPriceGwei: string | null
): string {
  if (!cbs) return "";

  const symbols: Record<string, string> = {};
  if (data.from) symbols[data.from.toLowerCase()] = data.from_symbol ?? "";
  if (data.to) symbols[data.to.toLowerCase()] = data.to_symbol ?? "";
  if (data.route_symbols) {
    Object.entries(data.route_symbols).forEach(([k, v]) => {
      symbols[k.toLowerCase()] = v;
    });
  }

  const recommendationLabel = isWinner
    ? '<span class="result-recommendation winner">RECOMMENDED</span>'
    : '<span class="result-recommendation alternative">ALTERNATIVE</span>';
  const primaryClass = isWinner ? "result-primary winner" : "result-primary alternative";

  const isTargetOut = data.mode === "targetOut";
  const primaryAmount = isTargetOut ? data.input_amount : data.output_amount;
  const primarySymbol = isTargetOut ? data.from_symbol : data.to_symbol;
  const primaryLabel = isTargetOut ? "You pay (required)" : "You receive (estimated)";
  const primaryTokenAddress = isTargetOut ? data.from : data.to;

  const primaryIcon = cbs.renderResultTokenIcon(primaryTokenAddress ?? "", quoteChainId);
  const fromIconHtml = cbs.renderResultTokenIcon(data.from ?? "", quoteChainId);
  const toIconHtml = cbs.renderResultTokenIcon(data.to ?? "", quoteChainId);

  let gasInfoLine = "";
  if (data.gas_cost_eth && Number(data.gas_cost_eth) > 0) {
    gasInfoLine =
      '<div class="field field-spaced"><div class="field-label">Gas Cost</div><div class="field-value number">' +
      data.gas_cost_eth +
      " ETH</div></div>";
    if (gasPriceGwei) {
      gasInfoLine +=
        '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' +
        gasPriceGwei +
        " gwei</div></div>";
    }
  } else if (gasPriceGwei) {
    gasInfoLine =
      '<div class="field field-spaced"><div class="field-label">Gas Price</div><div class="field-value number">' +
      gasPriceGwei +
      " gwei</div></div>";
  }

  const primary =
    '<div class="' +
    primaryClass +
    '">' +
    recommendationLabel +
    '<div class="result-output-label">' +
    primaryLabel +
    "</div>" +
    '<div class="result-output">' +
    primaryAmount +
    (primarySymbol ? " " + primaryIcon + primarySymbol : "") +
    "</div>" +
    '<div class="field field-spaced"><div class="field-label">Via Curve</div></div>' +
    gasInfoLine +
    renderQuoteActions({
      quoteChainId,
      routerAddress: data.router_address ?? "",
      routerCalldata: data.router_calldata ?? "",
      routerValue: "0x0",
      approvalToken: data.from || "",
      approvalSpender: (data as CurveQuoteResponse).approval_target || "",
      inputAmountRaw: data.input_amount_raw || "0",
    }) +
    "</div>";

  const secondary =
    '<button type="button" class="details-toggle" onclick="this.classList.toggle(\'open\'); this.nextElementSibling.classList.toggle(\'open\');">Details</button>' +
    '<div class="details-content">' +
    '<div class="field"><div class="field-label">From</div><div class="field-value">' +
    fromIconHtml +
    (data.from_symbol ? data.from_symbol + " " : "") +
    data.from +
    "</div></div>" +
    '<div class="field"><div class="field-label">To</div><div class="field-value">' +
    toIconHtml +
    (data.to_symbol ? data.to_symbol + " " : "") +
    data.to +
    "</div></div>" +
    '<div class="field"><div class="field-label">' +
    (isTargetOut ? "Output Amount (desired)" : "Input Amount") +
    '</div><div class="field-value number">' +
    data.amount +
    (isTargetOut && data.to_symbol
      ? " " + toIconHtml + data.to_symbol
      : !isTargetOut && data.from_symbol
        ? " " + fromIconHtml + data.from_symbol
        : "") +
    "</div></div>" +
    '<div class="field"><div class="field-label">' +
    (isTargetOut ? "Input Amount (required)" : "Output Amount") +
    '</div><div class="field-value number">' +
    (isTargetOut
      ? data.input_amount + (data.from_symbol ? " " + fromIconHtml + data.from_symbol : "")
      : data.output_amount + (data.to_symbol ? " " + toIconHtml + data.to_symbol : "")) +
    "</div></div>" +
    (data.route && data.route.length > 0
      ? '<div class="field"><div class="field-label">Route (' +
        data.route.length +
        " steps)</div>" +
        formatCurveRoute(data.route, symbols) +
        "</div>"
      : "") +
    (data.approval_target
      ? '<div class="field"><div class="field-label">Approval Target</div><div class="field-value">' +
        data.approval_target +
        "</div></div>"
      : "") +
    renderSecondaryDetails(data, "curve") +
    "</div>";

  return primary + secondary;
}

/** Format error message with clickable token references */
export function formatErrorWithTokenRefs(message: string, chainId: number | string): string {
  if (!cbs) return String(message || "");

  const addressRegex = /0x[a-fA-F0-9]{40}/g;
  const tokens = cbs.getTokensForChain(Number(chainId));

  const symbolByAddress = new Map<string, string>();
  for (const token of tokens) {
    const addrLower = token.address.toLowerCase();
    if (!symbolByAddress.has(addrLower)) {
      symbolByAddress.set(addrLower, token.symbol || "");
    }
  }

  return message.replace(addressRegex, (match) => {
    const addrLower = match.toLowerCase();
    const symbol = symbolByAddress.get(addrLower) || "";
    const displayText = symbol || match;

    if (symbol) {
      return (
        '<span class="token-ref" title="' +
        match +
        '" data-address="' +
        match +
        '" tabindex="0" role="button" onclick="handleTokenRefClick(this, \'' +
        match +
        "')\" onkeydown=\"if(event.key==='Enter'){handleTokenRefClick(this,'" +
        match +
        "');}\">" +
        displayText +
        "</span>"
      );
    } else {
      return (
        '<span class="token-ref" title="Click to copy" data-address="' +
        match +
        '" tabindex="0" role="button" onclick="handleTokenRefClick(this, \'' +
        match +
        "')\" onkeydown=\"if(event.key==='Enter'){handleTokenRefClick(this,'" +
        match +
        "');}\">" +
        match +
        "</span>"
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Progressive rendering
// ---------------------------------------------------------------------------

function resetProgressiveQuoteState(singleRouterMode = false): void {
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
    singleRouterMode,
  };
}

function showProgressiveLoadingState(): void {
  if (!els) return;
  els.result.className = "show";
  els.recommendedContent.innerHTML =
    '<div class="result-header">Querying Spandex + Curve for best price...</div>';
  els.tabRecommended.textContent = "Loading...";
  els.tabAlternative.style.display = "";
  els.alternativeContent.innerHTML =
    '<div class="result-header loading-indicator">Waiting for quotes...</div>';
  els.tabAlternative.textContent = "Loading...";
  setActiveTab("recommended");
}

function renderProgressiveQuote(
  router: "spandex" | "curve",
  data: QuoteResponse | CurveQuoteResponse,
  quoteChainId: number,
  gasPriceGwei: string | null
): void {
  if (!els) return;
  if (router === "spandex") {
    els.tabRecommended.textContent = "Spandex";
    els.recommendedContent.innerHTML = renderSpandexQuote(
      data as QuoteResponse,
      false,
      quoteChainId,
      gasPriceGwei
    );
  } else if (router === "curve") {
    els.tabAlternative.textContent = "Curve";
    els.tabAlternative.style.display = "";
    els.alternativeContent.innerHTML = renderCurveQuote(
      data as CurveQuoteResponse,
      false,
      quoteChainId,
      gasPriceGwei
    );
  }
  els.result.className = "show";
}

function renderProgressiveError(
  router: "spandex" | "curve",
  error: string,
  quoteChainId: number
): void {
  if (!els) return;
  const errorHtml =
    '<div class="error-message">' + formatErrorWithTokenRefs(error, quoteChainId) + "</div>";
  if (router === "spandex") {
    els.tabRecommended.textContent = "Spandex";
    els.recommendedContent.innerHTML = errorHtml;
  } else if (router === "curve") {
    els.tabAlternative.textContent = "Curve";
    els.tabAlternative.style.display = "";
    els.alternativeContent.innerHTML = errorHtml;
  }
  els.result.className = "show";
}

function showProgressiveRecommendation(
  data: {
    recommendation: string | null;
    recommendation_reason: string | null;
    gas_price_gwei: string | null;
    output_to_eth_rate: number | null;
  },
  quoteChainId: number
): void {
  if (!els || !cbs) return;

  const recommendation = data.recommendation;
  const recommendationReason = data.recommendation_reason;
  const gasPriceGwei = data.gas_price_gwei;
  const outputToEthRate = data.output_to_eth_rate;

  let reasonHtml = '<div class="reason-box">';
  reasonHtml += '<div class="reason-box-title">Reason</div>';
  reasonHtml += '<div class="reason-box-content">' + (recommendationReason ?? "") + "</div>";
  if (gasPriceGwei) {
    reasonHtml +=
      '<div class="field-value number reason-box-gas">Gas Price: ' + gasPriceGwei + " gwei</div>";
  }
  if (outputToEthRate) {
    const outputSymbol =
      (progressiveQuoteState.spandex && progressiveQuoteState.spandex.to_symbol) ||
      (progressiveQuoteState.curve && progressiveQuoteState.curve.to_symbol) ||
      "token";
    reasonHtml +=
      '<div class="field-value number reason-box-gas">Rate: 1 ' +
      outputSymbol +
      " = " +
      outputToEthRate +
      " ETH</div>";
  }
  reasonHtml += "</div>";

  if (recommendation === "spandex" && progressiveQuoteState.spandex) {
    els.tabRecommended.textContent = "Spandex";
    els.recommendedContent.innerHTML =
      reasonHtml +
      renderSpandexQuote(progressiveQuoteState.spandex, true, quoteChainId, gasPriceGwei);
    if (progressiveQuoteState.curve) {
      els.tabAlternative.textContent = "Curve";
      els.tabAlternative.style.display = "";
      els.alternativeContent.innerHTML = renderCurveQuote(
        progressiveQuoteState.curve,
        false,
        quoteChainId,
        gasPriceGwei
      );
    } else if (progressiveQuoteState.curveError) {
      els.tabAlternative.textContent = "Curve";
      els.tabAlternative.style.display = "";
      els.alternativeContent.innerHTML =
        '<div class="error-message">' +
        formatErrorWithTokenRefs(progressiveQuoteState.curveError, quoteChainId) +
        "</div>";
    }
  } else if (recommendation === "curve" && progressiveQuoteState.curve) {
    els.tabRecommended.textContent = "Curve";
    els.recommendedContent.innerHTML =
      reasonHtml + renderCurveQuote(progressiveQuoteState.curve, true, quoteChainId, gasPriceGwei);
    if (progressiveQuoteState.spandex) {
      els.tabAlternative.textContent = "Spandex";
      els.tabAlternative.style.display = "";
      els.alternativeContent.innerHTML = renderSpandexQuote(
        progressiveQuoteState.spandex,
        false,
        quoteChainId,
        gasPriceGwei
      );
    } else if (progressiveQuoteState.spandexError) {
      els.tabAlternative.textContent = "Spandex";
      els.tabAlternative.style.display = "";
      els.alternativeContent.innerHTML =
        '<div class="error-message">' +
        formatErrorWithTokenRefs(progressiveQuoteState.spandexError, quoteChainId) +
        "</div>";
    }
  } else if (progressiveQuoteState.spandex) {
    els.tabRecommended.textContent = "Spandex";
    els.recommendedContent.innerHTML =
      reasonHtml +
      renderSpandexQuote(progressiveQuoteState.spandex, false, quoteChainId, gasPriceGwei);
    els.tabAlternative.style.display = "none";
    els.alternativeContent.innerHTML = "";
  } else if (progressiveQuoteState.curve) {
    els.tabRecommended.textContent = "Curve";
    els.recommendedContent.innerHTML =
      reasonHtml + renderCurveQuote(progressiveQuoteState.curve, false, quoteChainId, gasPriceGwei);
    els.tabAlternative.style.display = "none";
    els.alternativeContent.innerHTML = "";
  } else {
    const combinedError =
      "No quotes available. " +
      (progressiveQuoteState.spandexError
        ? "Spandex: " + progressiveQuoteState.spandexError + ". "
        : "") +
      (progressiveQuoteState.curveError ? "Curve: " + progressiveQuoteState.curveError : "");
    els.tabRecommended.textContent = "Results";
    els.recommendedContent.innerHTML =
      '<div class="error-message">' +
      formatErrorWithTokenRefs(combinedError, quoteChainId) +
      "</div>";
    els.tabAlternative.style.display = "none";
    els.alternativeContent.innerHTML = "";
  }

  setActiveTab("recommended");
  cbs.updateTransactionActionStates();
  cbs.forceUpdateRefreshIndicator();
}

// ---------------------------------------------------------------------------
// Client recommendation computation
// ---------------------------------------------------------------------------

interface RecommendationResult {
  recommendation: "spandex" | "curve";
  recommendation_reason: string;
  gas_price_gwei: string | null;
  output_to_eth_rate: null;
  input_to_eth_rate: null;
  mode: string;
  single_router_mode: boolean;
}

function computeClientRecommendation(mode: string): RecommendationResult | null {
  const spandexQuote = progressiveQuoteState.spandex;
  const curveQuote = progressiveQuoteState.curve;
  const gasPriceGwei = spandexQuote ? (spandexQuote.gas_price_gwei ?? null) : null;

  if (spandexQuote && curveQuote) {
    if (mode === "targetOut") {
      const spandexInput = Number(spandexQuote.input_amount);
      const curveInput = Number(curveQuote.input_amount);
      const inputSymbol = spandexQuote.from_symbol || "tokens";
      if (curveInput < spandexInput) {
        const diff = spandexInput - curveInput;
        const pct = ((diff / spandexInput) * 100).toFixed(3);
        return {
          recommendation: "curve",
          recommendation_reason:
            "Curve requires " + diff.toFixed(6) + " " + inputSymbol + " less (-" + pct + "%).",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      } else if (spandexInput < curveInput) {
        const diff = curveInput - spandexInput;
        const pct = ((diff / curveInput) * 100).toFixed(3);
        const provider = spandexQuote.provider || "Spandex";
        return {
          recommendation: "spandex",
          recommendation_reason:
            "Spandex (" +
            provider +
            ") requires " +
            diff.toFixed(6) +
            " " +
            inputSymbol +
            " less (-" +
            pct +
            "%).",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      } else {
        return {
          recommendation: "spandex",
          recommendation_reason:
            "Equal input amounts; defaulting to Spandex for multi-provider coverage.",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      }
    } else {
      const spandexOutput = Number(spandexQuote.output_amount);
      const curveOutput = Number(curveQuote.output_amount);
      const outputSymbol = spandexQuote.to_symbol || "tokens";
      if (curveOutput > spandexOutput) {
        const diff = curveOutput - spandexOutput;
        const pct = ((diff / spandexOutput) * 100).toFixed(3);
        return {
          recommendation: "curve",
          recommendation_reason:
            "Curve outputs " + diff.toFixed(6) + " " + outputSymbol + " more (+" + pct + "%).",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      } else if (spandexOutput > curveOutput) {
        const diff = spandexOutput - curveOutput;
        const pct = ((diff / curveOutput) * 100).toFixed(3);
        const provider = spandexQuote.provider || "Spandex";
        return {
          recommendation: "spandex",
          recommendation_reason:
            "Spandex (" +
            provider +
            ") outputs " +
            diff.toFixed(6) +
            " " +
            outputSymbol +
            " more (+" +
            pct +
            "%).",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      } else {
        return {
          recommendation: "spandex",
          recommendation_reason:
            "Equal output amounts; defaulting to Spandex for multi-provider coverage.",
          gas_price_gwei: gasPriceGwei,
          output_to_eth_rate: null,
          input_to_eth_rate: null,
          mode,
          single_router_mode: false,
        };
      }
    }
  } else if (spandexQuote) {
    return {
      recommendation: "spandex",
      recommendation_reason: "Only Spandex returned a quote",
      gas_price_gwei: gasPriceGwei,
      output_to_eth_rate: null,
      input_to_eth_rate: null,
      mode,
      single_router_mode: progressiveQuoteState.singleRouterMode,
    };
  } else if (curveQuote) {
    return {
      recommendation: "curve",
      recommendation_reason: "Only Curve returned a quote",
      gas_price_gwei: gasPriceGwei,
      output_to_eth_rate: null,
      input_to_eth_rate: null,
      mode,
      single_router_mode: progressiveQuoteState.singleRouterMode,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the current progressive quote state (for swap confirm modal checks etc.) */
export function getProgressiveQuoteState(): ProgressiveQuoteState {
  return progressiveQuoteState;
}

/** Get current quote chain ID */
export function getCurrentQuoteChainId(): number | null {
  return currentQuoteChainId;
}

/** Get best quote from progressive state */
export function getBestQuoteFromState(): QuoteResponse | CurveQuoteResponse | null {
  const rec = progressiveQuoteState.recommendation;
  if (rec === "spandex" && progressiveQuoteState.spandex) return progressiveQuoteState.spandex;
  if (rec === "curve" && progressiveQuoteState.curve) return progressiveQuoteState.curve;
  return progressiveQuoteState.spandex || progressiveQuoteState.curve || null;
}

/** Cancel any in-progress fetch requests */
export function cancelInProgressFetches(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

/** Clear the result display area */
export function clearResultDisplay(): void {
  if (!els) return;
  els.result.classList.remove("show");
  els.tabRecommended.textContent = "Recommended";
  els.tabAlternative.textContent = "Alternative";
  els.tabAlternative.style.display = "";
  els.recommendedContent.innerHTML = "";
  els.alternativeContent.innerHTML = "";
  setActiveTab("recommended");
  if (cbs) cbs.forceUpdateRefreshIndicator();
}

/** Show an error message in the result area */
export function showError(msg: string): void {
  if (!els || !cbs) return;
  els.result.className = "show";
  const chainId = cbs.getCurrentChainId();
  els.recommendedContent.innerHTML =
    '<div class="error-message">' + formatErrorWithTokenRefs(msg, chainId) + "</div>";
  els.tabRecommended.textContent = "Results";
  els.tabAlternative.style.display = "none";
  els.alternativeContent.innerHTML = "";
  setActiveTab("recommended");
  cbs.forceUpdateRefreshIndicator();
}

/** Check if comparison result has quote data */
export function hasQuoteResults(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const obj = data as { spandex?: unknown; curve?: unknown };
  return Boolean(obj.spandex || obj.curve);
}

/** Get next request sequence ID (incrementing) */
export function getNextRequestId(): number {
  return ++compareRequestSequence;
}

/** Set up tab switching event listeners */
export function setupTabSwitching(): void {
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveTab(tab.dataset.tab as "recommended" | "alternative");
    });
  });
}

/** Reset the current quote chain ID (e.g. on chain change) */
export function resetCurrentQuoteChainId(): void {
  currentQuoteChainId = null;
}

/**
 * Fetch and render quotes via parallel fetch() calls.
 * This is the core comparison engine — fetches Spandex and Curve in parallel,
 * renders progressively as each quote arrives, then computes recommendation.
 */
export async function fetchQuotesParallel(
  compareParams: CompareParams,
  options: {
    showLoading?: boolean;
    updateUrl?: boolean;
    requestId?: number;
    preserveUiState?: boolean;
    keepExistingResultsOnError?: boolean;
  } = {}
): Promise<FetchCompareResult> {
  if (!els || !cbs) {
    return { ok: false, params: compareParams };
  }

  const normalizedParams = cbs.cloneCompareParams(compareParams);
  const showLoading = options.showLoading === true;
  const updateUrl = options.updateUrl !== false;
  const requestId = Number.isFinite(options.requestId)
    ? Number(options.requestId)
    : ++compareRequestSequence;

  if (requestId > compareRequestSequence) {
    compareRequestSequence = requestId;
  }

  currentQuoteChainId = Number(normalizedParams.chainId);

  cancelInProgressFetches();

  const isSingleRouterChain = !CURVE_SUPPORTED_CHAINS.includes(currentQuoteChainId);
  resetProgressiveQuoteState(isSingleRouterChain);

  if (showLoading) {
    els.submit.disabled = true;
    els.submit.textContent = "Comparing...";
    showProgressiveLoadingState();
  }

  const query = cbs.compareParamsToSearchParams(normalizedParams);
  const quoteChainId = currentQuoteChainId;
  const quoteMode = normalizedParams.mode || "exactIn";

  const abortController = new AbortController();
  currentAbortController = abortController;
  const signal = abortController.signal;

  let spandexDone = false;
  let curveDone = false;

  function checkStale(): boolean {
    return requestId !== compareRequestSequence;
  }

  function onQuoteArrived(): void {
    if (!cbs) return;
    // Update swap confirmation modal if open
    if (cbs.isSwapConfirmModalOpen()) {
      cbs.updateSwapConfirmModalText();
    }
    // Update non-active amount field with the best available quote so far
    cbs.populateNonActiveField(getBestQuoteFromState());
  }

  function tryFinalize(): void {
    if (!spandexDone || (!curveDone && !isSingleRouterChain)) return;
    if (checkStale()) return;
    if (!cbs) return;

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

    const bestQuote = getBestQuoteFromState();
    if (bestQuote) {
      cbs.populateNonActiveField(bestQuote);
    } else {
      cbs.clearNonActiveField();
    }

    if (updateUrl) {
      cbs.updateUrlFromCompareParams(normalizedParams);
    }
    cbs.saveUserPreferences(normalizedParams);
  }

  // Fetch Spandex quote
  const spandexPromise = fetch("/quote?" + query.toString(), { signal })
    .then(function (response) {
      if (checkStale()) return;
      return response.json().then(function (data: QuoteResponse) {
        if (checkStale()) return;
        if (!response.ok || data.error) {
          const error = data.error || "Request failed with status " + response.status;
          progressiveQuoteState.spandexError = error;
          if (!progressiveQuoteState.spandex) {
            renderProgressiveError("spandex", error, quoteChainId);
          }
        } else {
          progressiveQuoteState.spandex = data;
          renderProgressiveQuote("spandex", data, quoteChainId, data.gas_price_gwei || null);
          progressiveQuoteState.gasPriceGwei =
            data.gas_price_gwei || progressiveQuoteState.gasPriceGwei;
        }
        onQuoteArrived();
      });
    })
    .catch(function (err: unknown) {
      if (signal.aborted || checkStale()) return;
      const message = err instanceof Error ? err.message : "Spandex quote failed";
      progressiveQuoteState.spandexError = message;
      renderProgressiveError("spandex", message, quoteChainId);
      onQuoteArrived();
    })
    .finally(function () {
      spandexDone = true;
      tryFinalize();
    });

  // Fetch Curve quote
  let curvePromise: Promise<void>;
  if (isSingleRouterChain) {
    curveDone = true;
    curvePromise = Promise.resolve();
  } else {
    curvePromise = fetch("/quote-curve?" + query.toString(), { signal })
      .then(function (response) {
        if (checkStale()) return;
        return response.json().then(function (data: CurveQuoteResponse) {
          if (checkStale()) return;
          if (!response.ok || data.error) {
            const error = data.error || "Request failed with status " + response.status;
            progressiveQuoteState.curveError = error;
            if (els) {
              els.tabAlternative.textContent = "Curve";
              els.tabAlternative.style.display = "";
              els.alternativeContent.innerHTML =
                '<div class="error-message">' +
                formatErrorWithTokenRefs(error, quoteChainId) +
                "</div>";
            }
          } else {
            progressiveQuoteState.curve = data;
            renderProgressiveQuote("curve", data, quoteChainId, progressiveQuoteState.gasPriceGwei);
          }
          onQuoteArrived();
        });
      })
      .catch(function (err: unknown) {
        if (signal.aborted || checkStale()) return;
        const message = err instanceof Error ? err.message : "Curve quote failed";
        progressiveQuoteState.curveError = message;
        if (els) {
          els.tabAlternative.textContent = "Curve";
          els.tabAlternative.style.display = "";
          els.alternativeContent.innerHTML =
            '<div class="error-message">' +
            formatErrorWithTokenRefs(message, quoteChainId) +
            "</div>";
        }
        onQuoteArrived();
      })
      .finally(function () {
        curveDone = true;
        tryFinalize();
      });
  }

  try {
    await Promise.all([spandexPromise, curvePromise]);
  } catch {
    // Errors handled per-promise above
  }

  if (currentAbortController === abortController) {
    currentAbortController = null;
  }

  if (showLoading) {
    els.submit.disabled = false;
    els.submit.textContent = "Compare Quotes";
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
    const errorMsg =
      progressiveQuoteState.spandexError ||
      progressiveQuoteState.curveError ||
      "No quotes available";
    if (!options.keepExistingResultsOnError) {
      showError(errorMsg);
    }
    return { ok: false, error: errorMsg, params: normalizedParams };
  }
}

/**
 * Request and render a comparison (delegates to fetchQuotesParallel).
 * This is the main entry point for comparison rendering.
 */
export async function requestAndRenderCompare(
  compareParams: CompareParams,
  options: {
    showLoading?: boolean;
    preserveUiState?: boolean;
    keepExistingResultsOnError?: boolean;
    updateUrl?: boolean;
    requestId?: number;
  } = {}
): Promise<FetchCompareResult> {
  return fetchQuotesParallel(compareParams, options);
}

/** Initialize the quote display module */
export function initQuoteDisplay(
  elements: QuoteDisplayElements,
  callbacks: QuoteDisplayCallbacks
): void {
  els = elements;
  cbs = callbacks;
}
