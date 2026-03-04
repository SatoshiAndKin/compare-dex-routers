/**
 * Token management module.
 * Handles tokenlist sources (default + custom), local token storage,
 * export/import of local tokens, unrecognized token detection + modal flow,
 * and token input blur handling.
 */

import {
  CHAIN_NAMES,
  DEFAULT_TOKENLIST_NAME,
  LOCAL_TOKENS_SOURCE_NAME,
  STORAGE_KEYS,
} from "./config.js";
import type { Token, TokenlistSource } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DOM elements required by the token management module */
export interface TokenManagementElements {
  tokenlistUrlInput: HTMLInputElement;
  addTokenlistBtn: HTMLButtonElement;
  tokenlistMessage: HTMLElement;
  tokenlistSourcesList: HTMLElement;
  exportLocalTokensBtn: HTMLButtonElement;
  importLocalTokensInput: HTMLInputElement;
  localTokensToggle: HTMLElement;
  localTokensMessage: HTMLElement;
  localTokensContent: HTMLElement;
  unrecognizedTokenModal: HTMLElement;
  unrecognizedTokenLoading: HTMLElement;
  unrecognizedTokenMetadata: HTMLElement;
  unrecognizedTokenName: HTMLElement;
  unrecognizedTokenSymbol: HTMLElement;
  unrecognizedTokenDecimals: HTMLElement;
  unrecognizedTokenError: HTMLElement;
  unrecognizedTokenSaveBtn: HTMLButtonElement;
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
}

/** Callbacks for cross-module interaction */
export interface TokenManagementCallbacks {
  getCurrentChainId: () => number;
  escapeHtml: (str: string) => string;
  refreshAutocomplete: () => void;
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
  formatTokenDisplay: (symbol: string, address: string) => string;
  handleTokenSwapIfNeeded: (
    currentInput: HTMLInputElement,
    newAddress: string,
    newDisplay: string
  ) => void;
  updateTokenInputIcon: (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: Token | null | undefined
  ) => void;
  clearTokenInputIcon: (wrapper: HTMLElement, icon: HTMLImageElement) => void;
  updateFromTokenBalance: () => void;
  updateToTokenBalance: () => void;
  updateAmountFieldLabels: () => void;
  isAddressLike: (address: string) => boolean;
  openUnrecognizedTokenModal: (address: string, chainId: number, targetInput: string) => void;
  closeUnrecognizedTokenModal: () => void;
  getFromIcon: () => HTMLImageElement;
  getToIcon: () => HTMLImageElement;
  getFromWrapper: () => HTMLElement;
  getToWrapper: () => HTMLElement;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let elements: TokenManagementElements;
let callbacks: TokenManagementCallbacks;

/** The mutable array of tokenlist sources (default + custom) */
let tokenlistSources: TokenlistSource[] = [];

/** State for the unrecognized token modal */
let unrecognizedTokenState: {
  address: string;
  chainId: number;
  metadata: { name: string; symbol: string; decimals: number } | null;
  targetInput: "from" | "to" | null;
} = {
  address: "",
  chainId: 0,
  metadata: null,
  targetInput: null,
};

// Storage keys (from inline JS constants)
const OLD_CUSTOM_TOKENLIST_URL_KEY = STORAGE_KEYS.oldCustomTokenlistUrl;
const CUSTOM_TOKENLISTS_KEY = STORAGE_KEYS.customTokenlists;
const DEFAULT_TOKENLIST_ENABLED_KEY = STORAGE_KEYS.defaultTokenlistEnabled;
const LOCAL_TOKEN_LIST_KEY = STORAGE_KEYS.localTokenList;
const LOCAL_TOKENS_ENABLED_KEY = STORAGE_KEYS.localTokensEnabled;

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

/** Get the current unrecognized token state */
export function getUnrecognizedTokenState(): typeof unrecognizedTokenState {
  return unrecognizedTokenState;
}

/** Set the unrecognized token state (used by modals module) */
export function setUnrecognizedTokenState(state: Partial<typeof unrecognizedTokenState>): void {
  unrecognizedTokenState = { ...unrecognizedTokenState, ...state };
}

// ---------------------------------------------------------------------------
// Local token list storage
// ---------------------------------------------------------------------------

/** Load local tokens from localStorage */
export function loadLocalTokenList(): Token[] {
  try {
    const data = localStorage.getItem(LOCAL_TOKEN_LIST_KEY);
    if (data) {
      const parsed = JSON.parse(data) as { tokens?: Token[] };
      if (parsed && Array.isArray(parsed.tokens)) {
        return parsed.tokens.map((t) => ({ ...t, _source: LOCAL_TOKENS_SOURCE_NAME }));
      }
    }
  } catch {
    // Corrupt data, treat as empty
  }
  return [];
}

/** Save local tokens to localStorage */
export function saveLocalTokenList(tokens: Token[]): void {
  const payload = {
    name: "Local Tokens",
    timestamp: new Date().toISOString(),
    tokens: tokens.map((t) => ({
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

/** Load local tokens enabled state from localStorage */
export function loadLocalTokensEnabled(): boolean {
  try {
    const data = localStorage.getItem(LOCAL_TOKENS_ENABLED_KEY);
    if (data !== null) {
      return data === "true";
    }
  } catch {
    // Ignore storage errors
  }
  // Default to enabled
  return true;
}

/** Save local tokens enabled state to localStorage */
export function saveLocalTokensEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LOCAL_TOKENS_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}

/** Add a token to the local list (dedup by address+chainId) */
export function addTokenToLocalList(token: Token): void {
  const existing = loadLocalTokenList();
  const isDuplicate = existing.some(
    (t) =>
      String(t.address).toLowerCase() === String(token.address).toLowerCase() &&
      Number(t.chainId) === Number(token.chainId)
  );
  if (!isDuplicate) {
    existing.push({ ...token, _source: LOCAL_TOKENS_SOURCE_NAME });
    saveLocalTokenList(existing);
  }
}

/** Remove a token from the local list by address and chainId */
export function removeTokenFromLocalList(address: string, chainId: number): void {
  const existing = loadLocalTokenList();
  const filtered = existing.filter(
    (t) =>
      !(
        String(t.address).toLowerCase() === String(address).toLowerCase() &&
        Number(t.chainId) === Number(chainId)
      )
  );
  saveLocalTokenList(filtered);
  renderLocalTokens();
  callbacks.refreshAutocomplete();
}

// ---------------------------------------------------------------------------
// Local tokens export/import
// ---------------------------------------------------------------------------

function setLocalTokensMessage(text: string, kind?: string): void {
  elements.localTokensMessage.textContent = text || "";
  elements.localTokensMessage.className = "tokenlist-message" + (kind ? " " + kind : "");
}

/** Export local tokens as Uniswap tokenlist JSON format */
export function exportLocalTokenList(): void {
  const localTokens = loadLocalTokenList();
  if (localTokens.length === 0) {
    setLocalTokensMessage("No tokens to export", "error");
    return;
  }

  const payload = {
    name: "Local Tokens",
    version: { major: 1, minor: 0, patch: 0 },
    timestamp: new Date().toISOString(),
    tokens: localTokens.map((t) => ({
      chainId: t.chainId,
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // Create temporary download link
  const a = document.createElement("a");
  a.href = url;
  a.download = "local-tokens.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setLocalTokensMessage(
    "Exported " + localTokens.length + " token" + (localTokens.length === 1 ? "" : "s"),
    "success"
  );
}

/** Import tokens from a Uniswap tokenlist JSON file */
export function importLocalTokenList(file: File): void {
  const reader = new FileReader();

  reader.onload = (event: ProgressEvent<FileReader>) => {
    try {
      const content = event.target?.result;
      if (typeof content !== "string") {
        throw new Error("File content is not text");
      }

      let parsed: { tokens?: unknown[] };
      try {
        parsed = JSON.parse(content) as { tokens?: unknown[] };
      } catch {
        throw new Error("File is not valid JSON");
      }

      // Validate Uniswap tokenlist structure
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tokens)) {
        throw new Error("File must contain a tokens array");
      }

      const importedTokens = parsed.tokens as Record<string, unknown>[];
      if (importedTokens.length === 0) {
        throw new Error("Tokenlist contains no tokens");
      }

      // Validate each token has required fields
      const validTokens: Token[] = [];
      for (const token of importedTokens) {
        if (
          typeof token.chainId === "number" &&
          typeof token.address === "string" &&
          /^0x[a-fA-F0-9]{40}$/.test(token.address) &&
          typeof token.symbol === "string" &&
          typeof token.decimals === "number"
        ) {
          validTokens.push({
            chainId: token.chainId,
            address: token.address,
            name: (token.name as string) || (token.symbol as string) || "Unknown",
            symbol: token.symbol,
            decimals: token.decimals,
          });
        }
      }

      if (validTokens.length === 0) {
        throw new Error("No valid tokens found in file");
      }

      // Merge with existing tokens (dedup by address+chainId)
      const existing = loadLocalTokenList();
      let addedCount = 0;

      for (const token of validTokens) {
        const isDuplicate = existing.some(
          (t) =>
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
      callbacks.refreshAutocomplete();

      if (addedCount === 0) {
        setLocalTokensMessage("All tokens already exist in your list", "success");
      } else {
        setLocalTokensMessage(
          "Imported " + addedCount + " new token" + (addedCount === 1 ? "" : "s"),
          "success"
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalTokensMessage("Import error: " + msg, "error");
    }
  };

  reader.onerror = () => {
    setLocalTokensMessage("Failed to read file", "error");
  };

  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Render local tokens in settings panel
// ---------------------------------------------------------------------------

/** Render local tokens list in settings modal */
export function renderLocalTokens(): void {
  const container = elements.localTokensContent;
  if (!container) return;

  const localTokens = loadLocalTokenList();
  const localTokensEnabled = loadLocalTokensEnabled();

  // Update toggle state
  const toggle = elements.localTokensToggle;
  if (toggle) {
    toggle.classList.toggle("on", localTokensEnabled);
    toggle.setAttribute("aria-checked", String(localTokensEnabled));
  }

  // Update export button disabled state
  if (elements.exportLocalTokensBtn) {
    elements.exportLocalTokensBtn.disabled = localTokens.length === 0;
  }

  if (localTokens.length === 0) {
    container.innerHTML = '<div class="settings-placeholder">No custom tokens saved</div>';
    return;
  }

  const esc = callbacks.escapeHtml;
  let html = "";
  for (const token of localTokens) {
    const chainName = CHAIN_NAMES[String(token.chainId)] || "Chain " + token.chainId;
    html +=
      '<div class="local-token-entry' +
      (localTokensEnabled ? "" : " disabled") +
      '" data-address="' +
      esc(token.address) +
      '" data-chain-id="' +
      token.chainId +
      '">';
    html += '<span class="local-token-symbol">' + esc(token.symbol || "???") + "</span>";
    html += '<span class="local-token-address">' + esc(token.address) + "</span>";
    html += '<span class="local-token-chain">' + esc(chainName) + "</span>";
    html +=
      '<button type="button" class="local-token-remove-btn" data-action="remove-local-token" data-address="' +
      esc(token.address) +
      '" data-chain-id="' +
      token.chainId +
      '" aria-label="Remove token">&times;</button>';
    html += "</div>";
  }

  container.innerHTML = html;

  // Wire up event handlers
  container
    .querySelectorAll<HTMLButtonElement>("[data-action='remove-local-token']")
    .forEach((el) => {
      el.addEventListener("click", (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const address = btn.dataset.address;
        const chainId = Number(btn.dataset.chainId);
        if (address && chainId) {
          removeTokenFromLocalList(address, chainId);
        }
      });
    });
}

/** Handle local tokens toggle click */
function handleLocalTokensToggle(): void {
  const currentState = loadLocalTokensEnabled();
  const newState = !currentState;
  saveLocalTokensEnabled(newState);
  renderLocalTokens();
  callbacks.refreshAutocomplete();
}

// ---------------------------------------------------------------------------
// Tokenlist URL normalization & storage
// ---------------------------------------------------------------------------

/** Normalize URL for duplicate detection */
export function normalizeTokenlistUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

/** Load default tokenlist(s) from server */
export async function loadDefaultTokenlists(): Promise<{ name: string; tokens: Token[] }[]> {
  try {
    const res = await fetch("/tokenlist");
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    const data = (await res.json()) as {
      tokenlists?: { name?: string; tokens?: Token[] }[];
      tokens?: Token[];
    };
    // Server now returns {tokenlists: [{name, tokens}, ...], tokens: merged}
    const tokenlists = Array.isArray(data.tokenlists) ? data.tokenlists : [];
    if (tokenlists.length === 0) {
      // Fallback for old server response format
      const tokens = Array.isArray(data.tokens) ? data.tokens : [];
      if (tokens.length > 0) {
        return [
          {
            name: DEFAULT_TOKENLIST_NAME,
            tokens: tokens.map((t) => ({
              ...t,
              _source: DEFAULT_TOKENLIST_NAME,
            })),
          },
        ];
      }
      return [];
    }
    // Tag tokens with their source name
    return tokenlists.map((entry) => ({
      name: entry.name || DEFAULT_TOKENLIST_NAME,
      tokens: (entry.tokens || []).map((t) => ({
        ...t,
        _source: entry.name || DEFAULT_TOKENLIST_NAME,
      })),
    }));
  } catch {
    return [];
  }
}

/** Load custom tokenlist from URL via proxy endpoint */
export async function loadTokenlistFromUrl(
  url: string
): Promise<{ tokens: Token[]; name: string }> {
  const res = await fetch("/tokenlist/proxy?url=" + encodeURIComponent(url));
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "HTTP " + res.status);
  }
  const data = (await res.json()) as { tokens?: Token[]; name?: string };
  const tokens = Array.isArray(data.tokens) ? data.tokens : [];
  const name = data.name || url;
  return { tokens, name };
}

/** Save tokenlist sources to localStorage */
export function saveTokenlistSources(): void {
  const data = tokenlistSources
    .filter((s) => s.url !== null)
    .map((s) => ({
      url: s.url,
      enabled: s.enabled,
      name: s.name,
    }));

  // Save default tokenlist enabled state separately
  const defaultSource = tokenlistSources.find((s) => s.url === null);
  const defaultEnabled = defaultSource ? defaultSource.enabled : true;

  try {
    localStorage.setItem(CUSTOM_TOKENLISTS_KEY, JSON.stringify(data));
    localStorage.setItem(DEFAULT_TOKENLIST_ENABLED_KEY, String(defaultEnabled));
  } catch {
    // Ignore storage errors
  }
}

/** Load tokenlist sources from localStorage */
export function loadTokenlistSourcesFromStorage():
  | {
      url: string;
      enabled: boolean;
      name: string;
    }[]
  | null {
  try {
    const data = localStorage.getItem(CUSTOM_TOKENLISTS_KEY);
    if (data) {
      return JSON.parse(data) as { url: string; enabled: boolean; name: string }[];
    }
  } catch {
    // Corrupt data, treat as empty
  }
  return null;
}

/** Migrate old single-URL format to new multi-list format */
export function migrateOldTokenlistUrl():
  | {
      url: string;
      enabled: boolean;
      name: string;
    }[]
  | null {
  try {
    const oldUrl = localStorage.getItem(OLD_CUSTOM_TOKENLIST_URL_KEY);
    if (oldUrl) {
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

// ---------------------------------------------------------------------------
// Get tokens for a chain (merging all enabled sources)
// ---------------------------------------------------------------------------

/** Count tokens for a specific chain */
function countTokensForChain(tokens: Token[], chainId: number): number {
  const cid = Number(chainId);
  return tokens.filter((t) => Number(t.chainId) === cid).length;
}

/** Get all tokens from enabled sources for a chain */
export function getTokensForChain(chainId: number): Token[] {
  const cid = Number(chainId);
  const seen = new Set<string>();
  const result: Token[] = [];

  // Get tokens from all enabled sources
  for (const source of tokenlistSources) {
    if (!source.enabled || !source.tokens) continue;

    for (const token of source.tokens) {
      if (Number(token.chainId) !== cid || typeof token.address !== "string") continue;
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
      if (Number(token.chainId) !== cid || typeof token.address !== "string") continue;
      const addr = token.address.toLowerCase();
      if (seen.has(addr)) continue;
      seen.add(addr);
      result.push(token);
    }
  }

  return result;
}

/** Check if address is in any enabled tokenlist (including local tokens) */
export function isAddressInTokenlists(address: string, chainId: number): boolean {
  const addr = String(address || "").toLowerCase();
  const cid = Number(chainId);

  // Check tokenlist sources
  for (const source of tokenlistSources) {
    if (!source.enabled || !source.tokens) continue;
    const found = source.tokens.find(
      (t) => Number(t.chainId) === cid && String(t.address || "").toLowerCase() === addr
    );
    if (found) return true;
  }

  // Check local tokens (if enabled)
  if (loadLocalTokensEnabled()) {
    const localTokens = loadLocalTokenList();
    const foundLocal = localTokens.find(
      (t) => Number(t.chainId) === cid && String(t.address || "").toLowerCase() === addr
    );
    if (foundLocal) return true;
  }

  return false;
}

/** Find token by address in enabled sources + local tokens */
export function findTokenByAddress(address: string, chainId: number): Token | undefined {
  const addr = String(address || "").toLowerCase();
  const cid = Number(chainId);
  // Search through enabled sources only
  for (const source of tokenlistSources) {
    if (!source.enabled || !source.tokens) continue;
    const found = source.tokens.find(
      (t) => Number(t.chainId) === cid && String(t.address || "").toLowerCase() === addr
    );
    if (found) return found;
  }
  // Search local tokens
  const localTokens = loadLocalTokenList();
  const foundLocal = localTokens.find(
    (t) => Number(t.chainId) === cid && String(t.address || "").toLowerCase() === addr
  );
  if (foundLocal) return foundLocal;
  return undefined;
}

// ---------------------------------------------------------------------------
// Render tokenlist sources in settings modal
// ---------------------------------------------------------------------------

function setTokenlistMessage(text: string, kind?: string): void {
  elements.tokenlistMessage.textContent = text || "";
  elements.tokenlistMessage.className = "tokenlist-message" + (kind ? " " + kind : "");
}

/** Render tokenlist sources list in settings modal */
export function renderTokenlistSources(): void {
  const chainId = callbacks.getCurrentChainId();
  const chainName = CHAIN_NAMES[String(chainId)] || "this chain";
  const esc = callbacks.escapeHtml;

  if (tokenlistSources.length === 0) {
    elements.tokenlistSourcesList.innerHTML =
      '<div class="settings-placeholder">No tokenlists loaded</div>';
    return;
  }

  let html = "";
  for (let i = 0; i < tokenlistSources.length; i++) {
    const source = tokenlistSources[i];
    if (!source) continue;
    const isDefault = source.url === null;
    const tokenCount = source.tokens ? countTokensForChain(source.tokens, chainId) : 0;
    const displayName = source.name || (isDefault ? DEFAULT_TOKENLIST_NAME : source.url || "");
    const hasError = Boolean(source.error);
    const hasChainMismatch = !hasError && tokenCount === 0;

    html +=
      '<div class="tokenlist-entry' +
      (source.enabled ? "" : " disabled") +
      (hasError ? " error" : "") +
      '" data-index="' +
      i +
      '">';
    html += '<span class="tokenlist-entry-name">' + esc(displayName) + "</span>";
    html += '<span class="tokenlist-entry-count">' + tokenCount + " tokens</span>";

    if (hasError) {
      html += '<span class="tokenlist-entry-error">' + esc(source.error || "") + "</span>";
      html +=
        '<button type="button" class="btn-small tokenlist-retry-btn" data-action="retry" data-index="' +
        i +
        '">Retry</button>';
    } else if (hasChainMismatch) {
      html += '<span class="tokenlist-chain-warning">0 tokens for ' + esc(chainName) + "</span>";
    }

    // Toggle switch
    html +=
      '<div class="tokenlist-toggle' +
      (source.enabled ? " on" : "") +
      '" data-action="toggle" data-index="' +
      i +
      '" role="switch" aria-checked="' +
      source.enabled +
      '" tabindex="0"></div>';

    // Remove button (not for default)
    if (!isDefault) {
      html +=
        '<button type="button" class="tokenlist-remove-btn" data-action="remove" data-index="' +
        i +
        '" aria-label="Remove tokenlist">&times;</button>';
    }

    html += "</div>";
  }

  elements.tokenlistSourcesList.innerHTML = html;

  // Wire up event handlers
  elements.tokenlistSourcesList.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    el.addEventListener("click", handleTokenlistSourceAction);
    if (el.getAttribute("role") === "switch") {
      el.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleTokenlistSourceAction(e);
        }
      });
    }
  });
}

/** Handle tokenlist source actions (toggle, remove, retry) */
function handleTokenlistSourceAction(e: Event): void {
  const el = e.currentTarget as HTMLElement;
  const action = el.dataset.action;
  const index = Number(el.dataset.index);

  if (action === "toggle") {
    const toggleSource = tokenlistSources[index];
    if (toggleSource) toggleSource.enabled = !toggleSource.enabled;
    saveTokenlistSources();
    renderTokenlistSources();
    callbacks.refreshAutocomplete();
  } else if (action === "remove") {
    tokenlistSources.splice(index, 1);
    saveTokenlistSources();
    renderTokenlistSources();
    callbacks.refreshAutocomplete();
  } else if (action === "retry") {
    const source = tokenlistSources[index];
    if (!source) return;
    source.error = null;
    renderTokenlistSources();
    // Re-fetch the tokenlist
    if (source.url) {
      void loadTokenlistSource(source.url, index);
    }
  }
}

/** Load a tokenlist source and update state */
async function loadTokenlistSource(url: string, index: number): Promise<void> {
  const entry = tokenlistSources[index];
  if (!entry) return;
  try {
    const { tokens, name } = await loadTokenlistFromUrl(url);
    const taggedTokens = tokens.map((t) => ({ ...t, _source: name }));
    entry.tokens = taggedTokens;
    entry.name = name;
    entry.error = null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entry.error = msg;
    entry.tokens = [];
  }
  renderTokenlistSources();
  callbacks.refreshAutocomplete();
}

/** Add a new tokenlist from URL */
async function handleAddTokenlist(): Promise<void> {
  const url = String(elements.tokenlistUrlInput.value || "").trim();
  if (!url) {
    setTokenlistMessage("Enter a tokenlist URL", "error");
    return;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    setTokenlistMessage("Invalid URL format", "error");
    return;
  }

  // Check for HTTPS
  if (!url.toLowerCase().startsWith("https://")) {
    setTokenlistMessage("URL must use HTTPS", "error");
    return;
  }

  // Check for duplicate
  const normalizedUrl = normalizeTokenlistUrl(url);
  const isDuplicate = tokenlistSources.some(
    (s) => s.url && normalizeTokenlistUrl(s.url) === normalizedUrl
  );
  if (isDuplicate) {
    setTokenlistMessage("This tokenlist is already added", "error");
    return;
  }

  const esc = callbacks.escapeHtml;
  elements.addTokenlistBtn.disabled = true;
  elements.addTokenlistBtn.textContent = "Loading...";
  setTokenlistMessage("Fetching tokenlist...", "loading");

  try {
    // Fetch the tokenlist BEFORE adding to tokenlistSources
    const { tokens, name } = await loadTokenlistFromUrl(url);

    // Check for duplicate by name (catches default lists added via URL)
    const nameNorm = (name || "").trim().toLowerCase();
    const isNameDuplicate = tokenlistSources.some(
      (s) => (s.name || "").trim().toLowerCase() === nameNorm
    );
    if (isNameDuplicate) {
      setTokenlistMessage('This tokenlist is already loaded ("' + esc(name) + '")', "error");
      return;
    }

    const taggedTokens = tokens.map((t) => ({ ...t, _source: name }));

    // Only add to tokenlistSources after successful fetch
    tokenlistSources.push({
      url,
      enabled: true,
      name,
      tokens: taggedTokens,
      error: null,
    });
    saveTokenlistSources();
    setTokenlistMessage('Added "' + esc(name) + '"', "success");
    elements.tokenlistUrlInput.value = "";
    renderTokenlistSources();
    callbacks.refreshAutocomplete();
  } catch (err) {
    // On failure, do NOT add to tokenlistSources - just show error message
    const msg = err instanceof Error ? err.message : String(err);
    setTokenlistMessage("Error: " + msg, "error");
  } finally {
    elements.addTokenlistBtn.disabled = false;
    elements.addTokenlistBtn.textContent = "Load";
  }
}

// ---------------------------------------------------------------------------
// Unrecognized token detection
// ---------------------------------------------------------------------------

/** Fetch token metadata from the server */
export async function fetchTokenMetadata(address: string, chainId: number): Promise<void> {
  try {
    const url =
      "/token-metadata?chainId=" +
      encodeURIComponent(chainId) +
      "&address=" +
      encodeURIComponent(address);
    const response = await fetch(url);
    const data = (await response.json()) as {
      name?: string;
      symbol?: string;
      decimals?: number;
      error?: string;
    };

    if (!response.ok || data.error) {
      elements.unrecognizedTokenLoading.hidden = true;
      elements.unrecognizedTokenMetadata.hidden = true;
      elements.unrecognizedTokenError.hidden = false;
      elements.unrecognizedTokenError.textContent =
        data.error || "Failed to fetch metadata (HTTP " + response.status + ")";
      elements.unrecognizedTokenSaveBtn.disabled = true;
      return;
    }

    // Success - show metadata
    unrecognizedTokenState.metadata = data as {
      name: string;
      symbol: string;
      decimals: number;
    };
    elements.unrecognizedTokenLoading.hidden = true;
    elements.unrecognizedTokenError.hidden = true;
    elements.unrecognizedTokenMetadata.hidden = false;
    elements.unrecognizedTokenName.textContent = data.name || "";
    elements.unrecognizedTokenSymbol.textContent = data.symbol || "";
    elements.unrecognizedTokenDecimals.textContent = String(data.decimals || 0);
    elements.unrecognizedTokenSaveBtn.disabled = false;
  } catch (err) {
    elements.unrecognizedTokenLoading.hidden = true;
    elements.unrecognizedTokenMetadata.hidden = true;
    elements.unrecognizedTokenError.hidden = false;
    const msg = err instanceof Error ? err.message : String(err);
    elements.unrecognizedTokenError.textContent = "Failed to fetch metadata: " + msg;
    elements.unrecognizedTokenSaveBtn.disabled = true;
  }
}

/** Handle saving an unrecognized token to local list */
export function handleUnrecognizedTokenSave(): void {
  if (!unrecognizedTokenState.metadata || !unrecognizedTokenState.address) {
    return;
  }

  const token: Token = {
    chainId: unrecognizedTokenState.chainId,
    address: unrecognizedTokenState.address,
    name: unrecognizedTokenState.metadata.name || "",
    symbol: unrecognizedTokenState.metadata.symbol || "",
    decimals: unrecognizedTokenState.metadata.decimals || 18,
    _source: LOCAL_TOKENS_SOURCE_NAME,
  };

  // Add to local list
  addTokenToLocalList(token);
  renderLocalTokens();

  // Update input field with formatted display
  const input =
    unrecognizedTokenState.targetInput === "from" ? elements.fromInput : elements.toInput;
  const newDisplay = callbacks.formatTokenDisplay(token.symbol, token.address);
  // Handle token swap if setting to same value as other field
  callbacks.handleTokenSwapIfNeeded(input, token.address, newDisplay);
  input.value = newDisplay;
  input.dataset.address = token.address;
  // Clear icon for custom tokens (no logoURI)
  if (input === elements.fromInput) {
    callbacks.clearTokenInputIcon(callbacks.getFromWrapper(), callbacks.getFromIcon());
  } else if (input === elements.toInput) {
    callbacks.clearTokenInputIcon(callbacks.getToWrapper(), callbacks.getToIcon());
  }

  // Close modal
  callbacks.closeUnrecognizedTokenModal();

  // Refresh autocomplete to include the new token
  callbacks.refreshAutocomplete();

  // Update balance for this token field
  if (input === elements.fromInput) {
    callbacks.updateFromTokenBalance();
  } else if (input === elements.toInput) {
    callbacks.updateToTokenBalance();
  }
  // Update amount field labels with token symbols
  callbacks.updateAmountFieldLabels();
}

/** Handle blur event on token inputs - check for unrecognized addresses */
export function handleTokenInputBlur(input: HTMLInputElement, targetInput: "from" | "to"): void {
  const value = String(input.value || "").trim();

  // Check if it's a valid address
  if (!callbacks.isAddressLike(value)) {
    return;
  }

  const chainId = callbacks.getCurrentChainId();

  // Handle token swap if setting to same value as other field
  callbacks.handleTokenSwapIfNeeded(input, value, value);

  // Check if address is already in tokenlists
  if (isAddressInTokenlists(value, chainId)) {
    // Update data-address
    input.dataset.address = value;
    // Try to find the token to get a nicer display format
    const token = findTokenByAddress(value, chainId);
    if (token) {
      input.value = callbacks.formatTokenDisplay(token.symbol, token.address);
      // Update token icon in input field
      if (input === elements.fromInput) {
        callbacks.updateTokenInputIcon(
          elements.fromInput,
          callbacks.getFromIcon(),
          callbacks.getFromWrapper(),
          token
        );
      } else if (input === elements.toInput) {
        callbacks.updateTokenInputIcon(
          elements.toInput,
          callbacks.getToIcon(),
          callbacks.getToWrapper(),
          token
        );
      }
    }
    // Update balance for this token field
    if (input === elements.fromInput) {
      callbacks.updateFromTokenBalance();
    } else if (input === elements.toInput) {
      callbacks.updateToTokenBalance();
    }
    callbacks.updateAmountFieldLabels();
    return;
  }

  // Address is not recognized - show popup
  input.dataset.address = value;
  callbacks.openUnrecognizedTokenModal(value, chainId, targetInput);
}

// ---------------------------------------------------------------------------
// Initialize tokenlist sources on page load
// ---------------------------------------------------------------------------

/** Initialize tokenlist sources (default + custom) from server and localStorage */
export async function initializeTokenlistSources(): Promise<void> {
  // Step 1: Load all default tokenlists from server
  const defaultTokenlistEntries = await loadDefaultTokenlists();

  // Read default tokenlist enabled state from localStorage (default: true for new visitors)
  let defaultEnabled = true;
  try {
    const stored = localStorage.getItem(DEFAULT_TOKENLIST_ENABLED_KEY);
    if (stored !== null) {
      defaultEnabled = stored === "true";
    }
  } catch {
    // Ignore storage errors, use default
  }

  // Create one tokenlistSources entry per default tokenlist
  tokenlistSources = defaultTokenlistEntries.map((entry) => ({
    url: null,
    enabled: defaultEnabled,
    name: entry.name,
    tokens: entry.tokens,
    error: null,
  }));

  // Step 2: Check for migration from old single-URL format
  const migrated = migrateOldTokenlistUrl();
  const savedLists = migrated || loadTokenlistSourcesFromStorage();

  // Collect default names for dedup
  const defaultNames = new Set(
    defaultTokenlistEntries.map((e) => (e.name || "").trim().toLowerCase())
  );

  // Step 3: Load saved custom tokenlists (skip duplicates of defaults)
  if (savedLists && savedLists.length > 0) {
    // Filter out saved lists whose name already matches a default
    const filteredSaved = savedLists.filter((saved) => {
      const savedName = (saved.name || "").trim().toLowerCase();
      return !savedName || !defaultNames.has(savedName);
    });

    let removedDuplicates = false;
    const loadPromises = filteredSaved.map(async (saved) => {
      const index = tokenlistSources.length;
      tokenlistSources.push({
        url: saved.url,
        enabled: saved.enabled !== false,
        name: saved.name || saved.url,
        tokens: [],
        error: null,
      });

      const entry = tokenlistSources[index];
      if (!entry) return;
      try {
        const { tokens, name } = await loadTokenlistFromUrl(saved.url);
        // Post-fetch dedup: if fetched name matches a default, mark for removal
        const nameNorm = (name || "").trim().toLowerCase();
        if (defaultNames.has(nameNorm)) {
          (entry as TokenlistSource & { _duplicate?: boolean })._duplicate = true;
          removedDuplicates = true;
          return;
        }
        entry.tokens = tokens.map((t) => ({
          ...t,
          _source: name,
        }));
        entry.name = name;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.error = msg;
        entry.tokens = [];
      }
    });

    await Promise.all(loadPromises);

    // Remove any entries that turned out to be duplicates after fetch
    if (removedDuplicates) {
      tokenlistSources = tokenlistSources.filter(
        (s) => !(s as TokenlistSource & { _duplicate?: boolean })._duplicate
      );
      saveTokenlistSources();
    }
  }

  // Step 4: Render the sources list
  renderTokenlistSources();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/** Initialize token management module */
export function initTokenManagement(
  els: TokenManagementElements,
  cbs: TokenManagementCallbacks
): void {
  elements = els;
  callbacks = cbs;

  // Wire up export button
  if (elements.exportLocalTokensBtn) {
    elements.exportLocalTokensBtn.addEventListener("click", exportLocalTokenList);
  }

  // Wire up import input
  if (elements.importLocalTokensInput) {
    elements.importLocalTokensInput.addEventListener("change", (e: Event) => {
      const input = e.target as HTMLInputElement;
      const files = input.files;
      const firstFile = files?.[0];
      if (firstFile) {
        importLocalTokenList(firstFile);
        // Reset input so same file can be selected again
        input.value = "";
      }
    });
  }

  // Wire up local tokens toggle
  if (elements.localTokensToggle) {
    elements.localTokensToggle.addEventListener("click", handleLocalTokensToggle);
    elements.localTokensToggle.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleLocalTokensToggle();
      }
    });
  }

  // Wire up add tokenlist button
  elements.addTokenlistBtn.addEventListener("click", () => {
    void handleAddTokenlist();
  });

  // Load on Enter in URL input
  elements.tokenlistUrlInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAddTokenlist();
    }
  });

  // Wire up token input blur listeners
  elements.fromInput.addEventListener("blur", () =>
    handleTokenInputBlur(elements.fromInput, "from")
  );
  elements.toInput.addEventListener("blur", () => handleTokenInputBlur(elements.toInput, "to"));

  // Also check when a full 42-char address is typed (immediate detection)
  elements.fromInput.addEventListener("input", () => {
    const value = String(elements.fromInput.value || "").trim();
    if (
      callbacks.isAddressLike(value) &&
      !isAddressInTokenlists(value, callbacks.getCurrentChainId())
    ) {
      setTimeout(() => {
        const currentValue = String(elements.fromInput.value || "").trim();
        if (callbacks.isAddressLike(currentValue)) {
          handleTokenInputBlur(elements.fromInput, "from");
        }
      }, 100);
    }
  });

  elements.toInput.addEventListener("input", () => {
    const value = String(elements.toInput.value || "").trim();
    if (
      callbacks.isAddressLike(value) &&
      !isAddressInTokenlists(value, callbacks.getCurrentChainId())
    ) {
      setTimeout(() => {
        const currentValue = String(elements.toInput.value || "").trim();
        if (callbacks.isAddressLike(currentValue)) {
          handleTokenInputBlur(elements.toInput, "to");
        }
      }, 100);
    }
  });
}
