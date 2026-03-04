/**
 * URL parameter sync and user preferences management.
 *
 * Manages:
 * - Reading form fields into CompareParams
 * - Writing CompareParams to URL via pushState/replaceState
 * - Parsing URL params on page load
 * - localStorage preferences (compare-dex-preferences)
 * - Per-chain token memory (saves from/to per chain ID)
 * - applyDefaults — applies DEFAULT_TOKENS or saved preferences for a chain
 * - cloneCompareParams and compareParamsToSearchParams utilities
 */

import type { CompareParams, UserPreferences, Token } from "./types.js";
import { DEFAULT_TOKENS, STORAGE_KEYS } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UrlSyncElements {
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
  sellAmountInput: HTMLInputElement;
  receiveAmountInput: HTMLInputElement;
  chainIdInput: HTMLInputElement;
  fromIcon: HTMLImageElement;
  toIcon: HTMLImageElement;
  fromWrapper: HTMLElement;
  toWrapper: HTMLElement;
}

export interface UrlSyncCallbacks {
  /** Get the current chain ID */
  getCurrentChainId: () => number;
  /** Check if a wallet is connected */
  hasConnectedWallet: () => boolean;
  /** Get the connected wallet address */
  getConnectedAddress: () => string;
  /** Get the current quote direction mode */
  getActiveMode: () => "exactIn" | "targetOut";
  /** Get the current slippage bps value */
  getSlippageBps: () => string;
  /** Find a token by address for a given chain */
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
  /** Format token for display: "SYMBOL (0xFullAddress)" */
  formatTokenDisplay: (symbol: string, address: string) => string;
  /** Update a token input's icon */
  updateTokenInputIcon: (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: Token | undefined
  ) => void;
  /** Clear a token input's icon */
  clearTokenInputIcon: (wrapper: HTMLElement, icon: HTMLImageElement) => void;
  /** Update amount field labels with token symbols */
  updateAmountFieldLabels: () => void;
  /** Set direction mode (exactIn/targetOut) */
  setDirectionMode: (mode: "exactIn" | "targetOut") => void;
  /** Update slippage preset active state */
  updateSlippagePresetActive: (value: string) => void;
  /** Set slippage input value */
  setSlippageBps: (value: string) => void;
  /** Format chain display string */
  formatChainDisplay: (chainId: string, chainName: string) => string;
  /** Get chain name from chain ID */
  getChainName: (chainId: string) => string;
  /** Extract address from a token input (checks data-address then value) */
  extractAddressFromInput: (input: HTMLInputElement) => string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let els: UrlSyncElements | null = null;
let cbs: UrlSyncCallbacks | null = null;

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

const USER_PREFERENCES_KEY = STORAGE_KEYS.preferences;

/**
 * Load user preferences from localStorage.
 */
export function loadPreferences(): UserPreferences | null {
  try {
    const data = localStorage.getItem(USER_PREFERENCES_KEY);
    if (data) {
      const parsed: unknown = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as UserPreferences;
      }
    }
  } catch {
    // Corrupt data, treat as empty
  }
  return null;
}

/**
 * Save user preferences to localStorage.
 * Merges per-chain tokens with existing saved data.
 */
export function saveUserPreferences(params?: CompareParams): void {
  if (!els) return;
  try {
    const existing = loadPreferences() || {};
    const perChainTokens: Record<string, { from?: string; to?: string }> =
      existing.perChainTokens || {};

    // If params provided, use them; otherwise read from form
    const p = params || readCompareParamsFromForm();

    // Update per-chain tokens for the current chain
    perChainTokens[String(p.chainId)] = {
      from: String(p.from || "").trim(),
      to: String(p.to || "").trim(),
    };

    const preferences: UserPreferences = {
      chainId: String(p.chainId || "").trim(),
      amount: String(p.amount || "").trim(),
      slippageBps: String(p.slippageBps || "").trim(),
      mode: String(p.mode || "exactIn").trim(),
      sellAmount: els.sellAmountInput.value,
      receiveAmount: els.receiveAmountInput.value,
      perChainTokens,
    };

    localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get saved per-chain tokens for a specific chain ID.
 */
export function getSavedTokensForChain(
  chainId: number | string
): { from?: string; to?: string } | null {
  const prefs = loadPreferences();
  if (prefs && prefs.perChainTokens && prefs.perChainTokens[String(chainId)]) {
    return prefs.perChainTokens[String(chainId)] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compare params utilities
// ---------------------------------------------------------------------------

/**
 * Clone and normalize compare params, filling defaults.
 */
export function cloneCompareParams(params: Partial<CompareParams>): CompareParams {
  return {
    chainId: String(params.chainId || "").trim(),
    from: String(params.from || "").trim(),
    to: String(params.to || "").trim(),
    amount: String(params.amount || "").trim(),
    slippageBps: String(params.slippageBps || "").trim(),
    sender: String((params as Record<string, unknown>).sender || "").trim(),
    mode: (String(params.mode || "exactIn").trim() as "exactIn" | "targetOut") || "exactIn",
  };
}

/**
 * Read the current form state into CompareParams.
 */
export function readCompareParamsFromForm(): CompareParams {
  if (!els || !cbs) {
    return cloneCompareParams({});
  }

  // Read amount from the active field (sell for exactIn, receive for targetOut)
  const mode = cbs.getActiveMode();
  const amount = mode === "targetOut" ? els.receiveAmountInput.value : els.sellAmountInput.value;

  return cloneCompareParams({
    chainId: String(cbs.getCurrentChainId()),
    from: cbs.extractAddressFromInput(els.fromInput),
    to: cbs.extractAddressFromInput(els.toInput),
    amount,
    slippageBps: cbs.getSlippageBps(),
    mode,
    ...(cbs.hasConnectedWallet() ? { sender: cbs.getConnectedAddress() } : {}),
  } as Partial<CompareParams>);
}

/**
 * Convert compare params to URLSearchParams for API calls.
 */
export function compareParamsToSearchParams(params: Partial<CompareParams>): URLSearchParams {
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
    query.set("sender", normalized.sender);
  }

  return query;
}

/**
 * Update the browser URL from compare params via replaceState.
 */
export function updateUrlFromCompareParams(params: Partial<CompareParams>): void {
  const normalized = cloneCompareParams(params);
  const url = new URL(window.location.href);
  url.searchParams.set("chainId", normalized.chainId);
  url.searchParams.set("from", normalized.from);
  url.searchParams.set("to", normalized.to);
  url.searchParams.set("amount", normalized.amount);
  url.searchParams.set("slippageBps", normalized.slippageBps);
  // Only add mode to URL if it's not the default
  if (normalized.mode && normalized.mode !== "exactIn") {
    url.searchParams.set("mode", normalized.mode);
  } else {
    url.searchParams.delete("mode");
  }
  // Sender is never written to URL - it comes from wallet connection state
  url.searchParams.delete("sender");
  // Remove MEV protection param if it exists (no longer used)
  url.searchParams.delete("mevProtection");
  window.history.replaceState({}, "", url.toString());
}

// ---------------------------------------------------------------------------
// Apply defaults
// ---------------------------------------------------------------------------

/**
 * Apply default tokens for a chain, preferring saved per-chain preferences.
 */
export function applyDefaults(chainId: number, options: { skipSavedTokens?: boolean } = {}): void {
  if (!els || !cbs) return;

  const skipSavedTokens = options.skipSavedTokens === true;
  const defaults = DEFAULT_TOKENS[String(chainId)];
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

    const fromToken = cbs.findTokenByAddress(fromAddr, chainId);
    const toToken = cbs.findTokenByAddress(toAddr, chainId);

    // Set from input with display format and data-address
    if (fromToken) {
      els.fromInput.value = cbs.formatTokenDisplay(fromToken.symbol, fromToken.address);
      els.fromInput.dataset.address = fromToken.address;
      cbs.updateTokenInputIcon(els.fromInput, els.fromIcon, els.fromWrapper, fromToken);
    } else {
      els.fromInput.value = fromAddr;
      els.fromInput.dataset.address = fromAddr;
      cbs.clearTokenInputIcon(els.fromWrapper, els.fromIcon);
    }

    // Set to input with display format and data-address
    if (toToken) {
      els.toInput.value = cbs.formatTokenDisplay(toToken.symbol, toToken.address);
      els.toInput.dataset.address = toToken.address;
      cbs.updateTokenInputIcon(els.toInput, els.toIcon, els.toWrapper, toToken);
    } else {
      els.toInput.value = toAddr;
      els.toInput.dataset.address = toAddr;
      cbs.clearTokenInputIcon(els.toWrapper, els.toIcon);
    }
  }
  // Update amount field labels with token symbols
  cbs.updateAmountFieldLabels();
}

// ---------------------------------------------------------------------------
// Page-load URL/preferences restore
// ---------------------------------------------------------------------------

/**
 * Restore form state from URL parameters and/or localStorage preferences.
 * Called once on page load, before tokenlists are loaded.
 * Returns whether URL params include all required fields for auto-compare.
 */
export function restoreFromUrlAndPreferences(): {
  shouldLoadFromUrlParams: boolean;
  savedPrefs: UserPreferences | null;
} {
  if (!els || !cbs) {
    return { shouldLoadFromUrlParams: false, savedPrefs: null };
  }

  const params = new URLSearchParams(window.location.search);
  const savedPrefs = loadPreferences();

  // Chain: URL param > localStorage > default (Base)
  const urlChainId = params.get("chainId");
  if (urlChainId) {
    const chainName = cbs.getChainName(urlChainId);
    els.chainIdInput.dataset.chainId = urlChainId;
    els.chainIdInput.value = cbs.formatChainDisplay(urlChainId, chainName);
  } else if (savedPrefs && savedPrefs.chainId) {
    const chainId = savedPrefs.chainId;
    const chainName = cbs.getChainName(chainId);
    els.chainIdInput.dataset.chainId = chainId;
    els.chainIdInput.value = cbs.formatChainDisplay(chainId, chainName);
  }

  const urlFrom = params.get("from");
  if (urlFrom) {
    els.fromInput.dataset.address = urlFrom;
    // Will format with symbol after tokenlist loads
  }
  // else: Will apply defaults or saved preferences after tokenlist loads

  const urlTo = params.get("to");
  if (urlTo) {
    els.toInput.dataset.address = urlTo;
    // Will format with symbol after tokenlist loads
  }
  // else: Will apply defaults or saved preferences after tokenlist loads

  // Amount + Mode: URL param > localStorage > default
  // ?amount=X (no mode or mode=exactIn) populates sell field
  // ?amount=X&mode=targetOut populates receive field
  {
    const urlMode = params.get("mode");
    const urlAmount = params.get("amount");
    if (urlAmount && urlMode === "targetOut") {
      els.receiveAmountInput.value = urlAmount;
      els.sellAmountInput.value = "";
      cbs.setDirectionMode("targetOut");
    } else if (urlAmount) {
      els.sellAmountInput.value = urlAmount;
      cbs.setDirectionMode("exactIn");
    } else if (savedPrefs && savedPrefs.amount) {
      // Restore from localStorage
      const savedMode = savedPrefs.mode === "targetOut" ? "targetOut" : "exactIn";
      if (savedMode === "targetOut") {
        els.receiveAmountInput.value = savedPrefs.amount;
        els.sellAmountInput.value = savedPrefs.sellAmount || "";
      } else {
        els.sellAmountInput.value = savedPrefs.amount;
        els.receiveAmountInput.value = savedPrefs.receiveAmount || "";
      }
      cbs.setDirectionMode(savedMode);
    }
  }

  // Slippage: URL param > localStorage > default ("50")
  const urlSlippage = params.get("slippageBps");
  if (urlSlippage) {
    cbs.setSlippageBps(urlSlippage);
    cbs.updateSlippagePresetActive(urlSlippage);
  } else if (savedPrefs && savedPrefs.slippageBps) {
    cbs.setSlippageBps(savedPrefs.slippageBps);
    cbs.updateSlippagePresetActive(savedPrefs.slippageBps);
  }
  // Sender param from URL is silently ignored - sender comes from wallet connection state

  // Remove any stale mevProtection param from URL
  if (params.has("mevProtection")) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("mevProtection");
    window.history.replaceState({}, "", cleanUrl.toString());
  }

  const shouldLoadFromUrlParams = Boolean(
    params.get("chainId") && params.get("from") && params.get("to") && params.get("amount")
  );

  return { shouldLoadFromUrlParams, savedPrefs };
}

// ---------------------------------------------------------------------------
// Post-tokenlist-load restore
// ---------------------------------------------------------------------------

/**
 * After tokenlists are loaded, format token inputs with symbols and apply
 * defaults if no URL params or saved preferences exist.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function applyTokenFormattingAfterLoad(savedPrefs: UserPreferences | null): void {
  if (!els || !cbs) return;

  const params = new URLSearchParams(window.location.search);
  const chainId = cbs.getCurrentChainId();
  const saved = getSavedTokensForChain(chainId);

  const paramFrom = params.get("from");
  if (paramFrom) {
    const fromAddr = paramFrom;
    const fromToken = cbs.findTokenByAddress(fromAddr, chainId);
    if (fromToken) {
      els.fromInput.value = cbs.formatTokenDisplay(fromToken.symbol, fromToken.address);
      els.fromInput.dataset.address = fromToken.address;
      cbs.updateTokenInputIcon(els.fromInput, els.fromIcon, els.fromWrapper, fromToken);
    } else {
      els.fromInput.value = fromAddr;
      els.fromInput.dataset.address = fromAddr;
      cbs.clearTokenInputIcon(els.fromWrapper, els.fromIcon);
    }
  } else if (saved && saved.from) {
    // No URL param - use saved preference for this chain
    const fromToken = cbs.findTokenByAddress(saved.from, chainId);
    if (fromToken) {
      els.fromInput.value = cbs.formatTokenDisplay(fromToken.symbol, fromToken.address);
      els.fromInput.dataset.address = fromToken.address;
      cbs.updateTokenInputIcon(els.fromInput, els.fromIcon, els.fromWrapper, fromToken);
    } else {
      els.fromInput.value = saved.from;
      els.fromInput.dataset.address = saved.from;
      cbs.clearTokenInputIcon(els.fromWrapper, els.fromIcon);
    }
  }

  const paramTo = params.get("to");
  if (paramTo) {
    const toAddr = paramTo;
    const toToken = cbs.findTokenByAddress(toAddr, chainId);
    if (toToken) {
      els.toInput.value = cbs.formatTokenDisplay(toToken.symbol, toToken.address);
      els.toInput.dataset.address = toToken.address;
      cbs.updateTokenInputIcon(els.toInput, els.toIcon, els.toWrapper, toToken);
    } else {
      els.toInput.value = toAddr;
      els.toInput.dataset.address = toAddr;
      cbs.clearTokenInputIcon(els.toWrapper, els.toIcon);
    }
  } else if (saved && saved.to) {
    // No URL param - use saved preference for this chain
    const toToken = cbs.findTokenByAddress(saved.to, chainId);
    if (toToken) {
      els.toInput.value = cbs.formatTokenDisplay(toToken.symbol, toToken.address);
      els.toInput.dataset.address = toToken.address;
      cbs.updateTokenInputIcon(els.toInput, els.toIcon, els.toWrapper, toToken);
    } else {
      els.toInput.value = saved.to;
      els.toInput.dataset.address = saved.to;
      cbs.clearTokenInputIcon(els.toWrapper, els.toIcon);
    }
  }

  // Apply defaults if no URL params AND no saved preferences for from/to
  const defaults = DEFAULT_TOKENS[String(chainId)];
  if (!params.get("from") && !(saved && saved.from) && defaults) {
    const fromToken = cbs.findTokenByAddress(defaults.from, chainId);
    if (fromToken) {
      els.fromInput.value = cbs.formatTokenDisplay(fromToken.symbol, fromToken.address);
      els.fromInput.dataset.address = fromToken.address;
      cbs.updateTokenInputIcon(els.fromInput, els.fromIcon, els.fromWrapper, fromToken);
    } else {
      els.fromInput.value = defaults.from;
      els.fromInput.dataset.address = defaults.from;
      cbs.clearTokenInputIcon(els.fromWrapper, els.fromIcon);
    }
  }
  if (!params.get("to") && !(saved && saved.to) && defaults) {
    const toToken = cbs.findTokenByAddress(defaults.to, chainId);
    if (toToken) {
      els.toInput.value = cbs.formatTokenDisplay(toToken.symbol, toToken.address);
      els.toInput.dataset.address = toToken.address;
      cbs.updateTokenInputIcon(els.toInput, els.toIcon, els.toWrapper, toToken);
    } else {
      els.toInput.value = defaults.to;
      els.toInput.dataset.address = defaults.to;
      cbs.clearTokenInputIcon(els.toWrapper, els.toIcon);
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize URL sync module.
 */
export function initUrlSync(elements: UrlSyncElements, callbacks: UrlSyncCallbacks): void {
  els = elements;
  cbs = callbacks;

  // Migrate old localStorage key
  const oldPrefs = localStorage.getItem(STORAGE_KEYS.oldPreferences);
  if (oldPrefs && !localStorage.getItem(USER_PREFERENCES_KEY)) {
    localStorage.setItem(USER_PREFERENCES_KEY, oldPrefs);
    localStorage.removeItem(STORAGE_KEYS.oldPreferences);
  }
}
