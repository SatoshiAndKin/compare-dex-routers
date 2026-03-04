/**
 * Auto-refresh module for periodic quote updates.
 *
 * Manages:
 * - Auto-refresh countdown timer and display
 * - Pause/resume during transactions
 * - Refresh cycle execution
 * - Entry point from form submit (compare and maybe start auto-refresh)
 */

import { AUTO_REFRESH_SECONDS } from "./config.js";
import type { CompareParams } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoRefreshElements {
  refreshIndicator: HTMLElement;
  refreshCountdown: HTMLElement;
  refreshStatus: HTMLElement;
  result: HTMLElement;
}

export interface AutoRefreshCallbacks {
  /** Clone compare params (deep copy) */
  cloneCompareParams: (params: CompareParams) => CompareParams;
  /** Check if wallet is connected */
  hasConnectedWallet: () => boolean;
  /** Get connected wallet address */
  getConnectedAddress: () => string;
  /** Run the compare and render (progressive fetch) */
  requestAndRenderCompare: (
    params: CompareParams,
    options: {
      showLoading?: boolean;
      preserveUiState?: boolean;
      keepExistingResultsOnError?: boolean;
      updateUrl?: boolean;
      requestId?: number;
    }
  ) => Promise<CompareResult>;
  /** Read compare params from the form */
  readCompareParamsFromForm: () => CompareParams;
  /** Check if comparison result has quote data */
  hasQuoteResults: (payload: unknown) => boolean;
  /** Get next request sequence ID */
  getNextRequestId: () => number;
}

export interface CompareResult {
  ok: boolean;
  stale?: boolean;
  error?: string;
  params: CompareParams;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const autoRefreshState = {
  timerId: null as ReturnType<typeof setInterval> | null,
  secondsRemaining: AUTO_REFRESH_SECONDS,
  lastParams: null as CompareParams | null,
  paused: false,
  inFlight: false,
  errorMessage: "",
};

let els: AutoRefreshElements | null = null;
let cbs: AutoRefreshCallbacks | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clearAutoRefreshTimer(): void {
  if (autoRefreshState.timerId !== null) {
    clearInterval(autoRefreshState.timerId);
    autoRefreshState.timerId = null;
  }
}

function updateRefreshIndicator(): void {
  if (!els) return;

  const shouldShow = els.result.classList.contains("show") && Boolean(autoRefreshState.lastParams);
  els.refreshIndicator.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  if (autoRefreshState.paused) {
    els.refreshCountdown.textContent = "Auto-refresh paused";
  } else if (autoRefreshState.inFlight) {
    els.refreshCountdown.textContent = "Refreshing...";
  } else {
    els.refreshCountdown.textContent = "Auto-refresh in " + autoRefreshState.secondsRemaining + "s";
  }

  els.refreshStatus.classList.remove("error");
  if (autoRefreshState.errorMessage) {
    els.refreshStatus.textContent = autoRefreshState.errorMessage;
    els.refreshStatus.classList.add("error");
  } else if (autoRefreshState.paused) {
    els.refreshStatus.textContent = "Waiting for transaction.";
  } else {
    els.refreshStatus.textContent = "";
  }
}

function startAutoRefreshCountdown(options: { clearErrorMessage?: boolean } = {}): void {
  const clearErrorMessage = options.clearErrorMessage !== false;
  if (!autoRefreshState.lastParams || autoRefreshState.paused) {
    updateRefreshIndicator();
    return;
  }

  clearAutoRefreshTimer();
  autoRefreshState.secondsRemaining = AUTO_REFRESH_SECONDS;
  if (clearErrorMessage) {
    autoRefreshState.errorMessage = "";
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

function getRefreshParams(): CompareParams | null {
  if (!autoRefreshState.lastParams || !cbs) {
    return null;
  }

  const params = cbs.cloneCompareParams(autoRefreshState.lastParams);
  if (cbs.hasConnectedWallet()) {
    params.sender = cbs.getConnectedAddress();
  }

  return params;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Stop auto-refresh and clear state */
export function stopAutoRefresh(options: { clearLastParams?: boolean } = {}): void {
  const shouldClearLastParams = options.clearLastParams !== false;
  clearAutoRefreshTimer();
  autoRefreshState.paused = false;
  autoRefreshState.inFlight = false;
  autoRefreshState.secondsRemaining = AUTO_REFRESH_SECONDS;
  autoRefreshState.errorMessage = "";
  if (shouldClearLastParams) {
    autoRefreshState.lastParams = null;
  }
  updateRefreshIndicator();
}

/** Begin auto-refresh with given params */
export function beginAutoRefresh(params: CompareParams): void {
  if (!cbs) return;
  autoRefreshState.lastParams = cbs.cloneCompareParams(params);
  autoRefreshState.paused = false;
  autoRefreshState.inFlight = false;
  startAutoRefreshCountdown();
}

/** Pause auto-refresh during a transaction */
export function pauseAutoRefreshForTransaction(): void {
  if (!autoRefreshState.lastParams) {
    return;
  }

  autoRefreshState.paused = true;
  clearAutoRefreshTimer();
  updateRefreshIndicator();
}

/** Resume auto-refresh after a transaction completes */
export function resumeAutoRefreshAfterTransaction(): void {
  if (!autoRefreshState.lastParams) {
    return;
  }

  autoRefreshState.paused = false;
  autoRefreshState.inFlight = false;
  startAutoRefreshCountdown();
}

/** Run one auto-refresh cycle (fetch fresh quotes) */
export async function runAutoRefreshCycle(): Promise<void> {
  if (!cbs) return;

  const refreshParams = getRefreshParams();
  if (!refreshParams || autoRefreshState.paused || autoRefreshState.inFlight) {
    return;
  }

  const requestId = cbs.getNextRequestId();

  autoRefreshState.inFlight = true;
  updateRefreshIndicator();

  const comparison = await cbs.requestAndRenderCompare(refreshParams, {
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
    autoRefreshState.errorMessage = "Refresh failed. Keeping previous quotes.";
    startAutoRefreshCountdown({ clearErrorMessage: false });
  }
}

/**
 * Entry point: run comparison and start auto-refresh if successful.
 * Called from form submit and auto-quote.
 */
export async function runCompareAndMaybeStartAutoRefresh(
  compareParams: CompareParams,
  options: {
    showLoading?: boolean;
    preserveUiState?: boolean;
    keepExistingResultsOnError?: boolean;
    updateUrl?: boolean;
  } = {}
): Promise<CompareResult> {
  if (!cbs) {
    return { ok: false, params: compareParams };
  }

  const requestId = cbs.getNextRequestId();
  const comparison = await cbs.requestAndRenderCompare(compareParams, {
    showLoading: options.showLoading === true,
    preserveUiState: options.preserveUiState === true,
    keepExistingResultsOnError: options.keepExistingResultsOnError === true,
    updateUrl: options.updateUrl !== false,
    requestId,
  });

  if (comparison.stale) {
    return comparison;
  }

  if (comparison.ok && cbs.hasQuoteResults(comparison.payload)) {
    beginAutoRefresh(comparison.params);
  } else {
    stopAutoRefresh();
  }

  return comparison;
}

/** Force update the refresh indicator (e.g., after result display changes) */
export function forceUpdateRefreshIndicator(): void {
  updateRefreshIndicator();
}

/** Initialize the auto-refresh module */
export function initAutoRefresh(
  elements: AutoRefreshElements,
  callbacks: AutoRefreshCallbacks
): void {
  els = elements;
  cbs = callbacks;
}
