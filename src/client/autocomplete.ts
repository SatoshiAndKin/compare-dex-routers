/**
 * Token autocomplete module.
 * Provides searchable token dropdowns for from/to token input fields,
 * with keyboard navigation, logo display, source badges, and dedup logic.
 */

import type { Token } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DOM elements required by the autocomplete module */
export interface AutocompleteElements {
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
  fromAutocompleteList: HTMLElement;
  toAutocompleteList: HTMLElement;
  fromWrapper: HTMLElement;
  toWrapper: HTMLElement;
  fromIcon: HTMLImageElement;
  toIcon: HTMLImageElement;
  chainIdInput: HTMLInputElement;
}

/** Callbacks for cross-module interaction */
export interface AutocompleteCallbacks {
  getCurrentChainId: () => number;
  getTokensForChain: (chainId: number) => Token[];
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
  findTokenByAddress: (address: string, chainId: number) => Token | undefined;
}

/** Result of setupAutocomplete — exposes refresh/hide control */
export interface AutocompleteInstance {
  refresh: () => void;
  hide: () => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let elements: AutocompleteElements;
let callbacks: AutocompleteCallbacks;

let fromAutocomplete: AutocompleteInstance;
let toAutocomplete: AutocompleteInstance;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Escape HTML for safe display */
export function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Normalize an address (lowercase, strip 0x prefix) */
function normalizeAddress(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith("0x") ? lower.slice(2) : lower;
}

// ---------------------------------------------------------------------------
// Token matching
// ---------------------------------------------------------------------------

/** Find token matches for autocomplete */
export function findTokenMatches(value: string, chainId: number): Token[] {
  const query = value.trim().toLowerCase();
  if (!query) return [];

  const normalizedQuery = normalizeAddress(query);
  const tokens = callbacks.getTokensForChain(chainId);

  // Track which symbols are duplicated across sources
  const symbolCounts = new Map<string, number>();
  for (const token of tokens) {
    const symbol = String(token.symbol || "").toLowerCase();
    symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
  }

  return tokens
    .filter((token) => {
      const symbol = String(token.symbol || "").toLowerCase();
      const name = String(token.name || "").toLowerCase();
      const address = String(token.address || "").toLowerCase();
      const normalizedAddr = normalizeAddress(address);

      return (
        symbol.includes(query) ||
        name.includes(query) ||
        address.includes(query) ||
        normalizedAddr.includes(normalizedQuery)
      );
    })
    .map((token) => {
      const symbol = String(token.symbol || "").toLowerCase();
      const needsDisambiguation = (symbolCounts.get(symbol) || 0) > 1;
      return { ...token, _needsDisambiguation: needsDisambiguation };
    })
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Autocomplete dropdown setup
// ---------------------------------------------------------------------------

/** Set up autocomplete for a single input field */
function setupAutocomplete(input: HTMLInputElement, list: HTMLElement): AutocompleteInstance {
  let matches: Token[] = [];
  let activeIdx = -1;

  function hide(): void {
    list.classList.remove("show");
    list.innerHTML = "";
    matches = [];
    activeIdx = -1;
  }

  function selectToken(token: Token): void {
    // Handle token swap if setting to same value as other field
    const newDisplay = callbacks.formatTokenDisplay(token.symbol, token.address);
    callbacks.handleTokenSwapIfNeeded(input, token.address, newDisplay);
    // Show 'SYMBOL (0xABCD...1234)' format in input
    input.value = newDisplay;
    // Store full address in data-address attribute
    input.dataset.address = token.address;
    // Update token icon in input field
    if (input === elements.fromInput) {
      callbacks.updateTokenInputIcon(
        elements.fromInput,
        elements.fromIcon,
        elements.fromWrapper,
        token
      );
    } else if (input === elements.toInput) {
      callbacks.updateTokenInputIcon(elements.toInput, elements.toIcon, elements.toWrapper, token);
    }
    hide();
    // Update balance for this token field
    if (input === elements.fromInput) {
      callbacks.updateFromTokenBalance();
    } else if (input === elements.toInput) {
      callbacks.updateToTokenBalance();
    }
    // Update amount field labels with token symbols
    callbacks.updateAmountFieldLabels();
    // Dispatch token change event for auto-quote
    input.dispatchEvent(new CustomEvent("tokenselected"));
  }

  function setActive(index: number): void {
    const items = list.querySelectorAll<HTMLElement>(".autocomplete-item");
    items.forEach((el, i) => el.classList.toggle("active", i === index));
  }

  function render(): void {
    list.innerHTML = "";
    activeIdx = -1;
    if (!matches.length) {
      list.classList.remove("show");
      return;
    }

    const fragment = document.createDocumentFragment();
    matches.forEach((token) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";

      const logo = document.createElement("img");
      logo.className = "autocomplete-logo";
      logo.alt = token.symbol ? token.symbol + " logo" : "token logo";
      logo.loading = "lazy";
      if (typeof token.logoURI === "string" && token.logoURI) {
        logo.src = token.logoURI;
      }
      logo.onerror = () => {
        logo.style.display = "none";
      };

      const meta = document.createElement("div");
      meta.className = "autocomplete-meta";

      const title = document.createElement("div");
      title.className = "autocomplete-title";

      const symbol = document.createElement("span");
      symbol.className = "autocomplete-symbol";
      symbol.textContent = token.symbol || "";

      const name = document.createElement("span");
      name.className = "autocomplete-name";
      name.textContent = token.name || "";

      title.appendChild(symbol);
      title.appendChild(name);

      // Add source badge if disambiguation is needed
      if (token._needsDisambiguation && token._source) {
        const sourceBadge = document.createElement("span");
        sourceBadge.className = "autocomplete-source";
        sourceBadge.textContent = token._source;
        title.appendChild(sourceBadge);
      }

      const address = document.createElement("div");
      address.className = "autocomplete-addr";
      address.textContent = token.address || "";

      meta.appendChild(title);
      meta.appendChild(address);

      item.appendChild(logo);
      item.appendChild(meta);

      item.addEventListener("mousedown", (event: MouseEvent) => {
        event.preventDefault();
        selectToken(token);
      });

      fragment.appendChild(item);
    });

    list.appendChild(fragment);
    list.classList.add("show");
  }

  function refresh(): void {
    const chainId = callbacks.getCurrentChainId();
    matches = findTokenMatches(input.value, chainId);
    render();
    // Clear icon when input is cleared
    if (!input.value.trim()) {
      input.dataset.address = "";
      if (input === elements.fromInput) {
        callbacks.clearTokenInputIcon(elements.fromWrapper, elements.fromIcon);
      } else if (input === elements.toInput) {
        callbacks.clearTokenInputIcon(elements.toWrapper, elements.toIcon);
      }
    }
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => {
    if (input.value.trim()) {
      refresh();
    }
  });

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      if (!matches.length) return;
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, matches.length - 1);
      setActive(activeIdx);
    } else if (e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      setActive(activeIdx);
    } else if (e.key === "Enter" && list.classList.contains("show")) {
      if (!matches.length) return;
      e.preventDefault();
      const selectedIndex = activeIdx >= 0 ? activeIdx : 0;
      const selected = matches[selectedIndex];
      if (selected) selectToken(selected);
    } else if (e.key === "Escape") {
      hide();
    }
  });

  document.addEventListener("mousedown", (event: MouseEvent) => {
    if (event.target === input || list.contains(event.target as Node)) {
      return;
    }
    hide();
  });

  elements.chainIdInput.addEventListener("change", () => {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Refresh both autocomplete dropdowns */
export function refreshAutocomplete(): void {
  if (elements.fromInput.value.trim()) fromAutocomplete.refresh();
  if (elements.toInput.value.trim()) toAutocomplete.refresh();
}

/** Render a small token icon for result display (16px) */
export function renderResultTokenIcon(address: string, chainId: number): string {
  const token = callbacks.findTokenByAddress(address, chainId);
  if (!token || typeof token.logoURI !== "string" || !token.logoURI) {
    return "";
  }
  const alt = (token.symbol || "token") + " logo";
  return (
    '<img class="result-token-icon" src="' +
    token.logoURI +
    '" alt="' +
    alt +
    '" onerror="this.style.display=\'none\'">'
  );
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/** Initialize autocomplete module */
export function initAutocomplete(els: AutocompleteElements, cbs: AutocompleteCallbacks): void {
  elements = els;
  callbacks = cbs;

  fromAutocomplete = setupAutocomplete(elements.fromInput, elements.fromAutocompleteList);
  toAutocomplete = setupAutocomplete(elements.toInput, elements.toAutocompleteList);
}
