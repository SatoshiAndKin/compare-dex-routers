/**
 * Chain selector dropdown module.
 * Manages a searchable chain dropdown with keyboard navigation,
 * filtering by name or chain ID, and pinned current-selection behavior.
 */

import { ALL_CHAINS, CHAIN_NAMES } from "./config.js";
import type { ChainDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DOM elements required by the chain selector */
export interface ChainSelectorElements {
  chainIdInput: HTMLInputElement;
  chainDropdown: HTMLElement;
}

/** Callbacks for cross-module interaction */
export interface ChainSelectorCallbacks {
  /** Called when the user selects a new chain (dispatches change event internally) */
  onChainChange: (chainId: string) => void;
  /** Returns the currently selected chain ID */
  getCurrentChainId: () => number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let elChainIdInput: HTMLInputElement;
let elChainDropdown: HTMLElement;
let callbacks: ChainSelectorCallbacks;

let chainDropdownActiveIdx = -1;
let chainDropdownPreviousChainId: string | null = null;
let chainDropdownPinnedChainId: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format chain display as "Name (ID)" */
export function formatChainDisplay(chainId: string, chainName?: string): string {
  const name = chainName || CHAIN_NAMES[chainId] || "Unknown";
  return name + " (" + chainId + ")";
}

/** Filter chains by query (matches name or chain ID) */
function filterChains(query: string): ChainDefinition[] {
  const q = String(query || "")
    .toLowerCase()
    .trim();
  if (!q) return ALL_CHAINS;
  return ALL_CHAINS.filter((chain) => {
    const nameLower = chain.name.toLowerCase();
    const idStr = chain.id;
    return nameLower.includes(q) || idStr.includes(q);
  });
}

// ---------------------------------------------------------------------------
// Dropdown rendering
// ---------------------------------------------------------------------------

/** Render the chain dropdown items */
function renderChainDropdown(chains: ChainDefinition[], pinnedChainId: string | null): void {
  elChainDropdown.innerHTML = "";
  chainDropdownActiveIdx = -1;

  if (!chains.length && !pinnedChainId) {
    const empty = document.createElement("div");
    empty.className = "chain-item-empty";
    empty.textContent = "No chains match";
    elChainDropdown.appendChild(empty);
    elChainDropdown.classList.add("show");
    elChainIdInput.setAttribute("aria-expanded", "true");
    return;
  }

  const fragment = document.createDocumentFragment();

  // Render pinned chain first if specified
  if (pinnedChainId) {
    const pinnedChain = ALL_CHAINS.find((c) => c.id === pinnedChainId);
    if (pinnedChain) {
      const item = document.createElement("div");
      item.className = "chain-item current-selection";
      item.dataset.chainId = pinnedChain.id;
      item.setAttribute("role", "option");
      item.setAttribute("id", "chain-option-" + pinnedChain.id);

      const nameEl = document.createElement("span");
      nameEl.className = "chain-item-name";
      nameEl.textContent = pinnedChain.name;

      const idEl = document.createElement("span");
      idEl.className = "chain-item-id";
      idEl.textContent = "(" + pinnedChain.id + ")";

      item.appendChild(nameEl);
      item.appendChild(idEl);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectChain(pinnedChain.id, pinnedChain.name);
      });

      fragment.appendChild(item);
    }
  }

  // Render remaining chains (excluding pinned if present)
  chains.forEach((chain) => {
    if (pinnedChainId && chain.id === pinnedChainId) return;

    const item = document.createElement("div");
    item.className = "chain-item";
    item.dataset.chainId = chain.id;
    item.setAttribute("role", "option");
    item.setAttribute("id", "chain-option-" + chain.id);

    const nameEl = document.createElement("span");
    nameEl.className = "chain-item-name";
    nameEl.textContent = chain.name;

    const idEl = document.createElement("span");
    idEl.className = "chain-item-id";
    idEl.textContent = "(" + chain.id + ")";

    item.appendChild(nameEl);
    item.appendChild(idEl);

    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectChain(chain.id, chain.name);
    });

    fragment.appendChild(item);
  });

  elChainDropdown.appendChild(fragment);
  elChainDropdown.classList.add("show");
  elChainIdInput.setAttribute("aria-expanded", "true");
}

/** Highlight the active chain item in the dropdown */
function setActiveChainItem(index: number): void {
  const items = elChainDropdown.querySelectorAll(".chain-item");
  items.forEach((el, i) => {
    el.classList.toggle("active", i === index);
    el.setAttribute("aria-selected", i === index ? "true" : "false");
  });
  if (index >= 0 && items[index]) {
    elChainIdInput.setAttribute("aria-activedescendant", items[index].id);
  } else {
    elChainIdInput.removeAttribute("aria-activedescendant");
  }
}

/** Select a chain and update the input */
function selectChain(chainId: string, chainName: string): void {
  const display = formatChainDisplay(chainId, chainName);
  elChainIdInput.value = display;
  elChainIdInput.dataset.chainId = chainId;
  // Clear previous/pinned state since we made a valid selection
  chainDropdownPreviousChainId = null;
  chainDropdownPinnedChainId = null;
  hideChainDropdown();
  // Trigger change event for other listeners
  elChainIdInput.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Hide the chain dropdown */
function hideChainDropdown(): void {
  elChainDropdown.classList.remove("show");
  elChainDropdown.innerHTML = "";
  chainDropdownActiveIdx = -1;
  chainDropdownPinnedChainId = null;
  elChainIdInput.setAttribute("aria-expanded", "false");
  elChainIdInput.removeAttribute("aria-activedescendant");
}

/** Refresh the dropdown based on current input text */
function refreshChainDropdown(): void {
  const query = elChainIdInput.value;
  const chains = filterChains(query);
  // When user is typing/filtering, don't pin - just show filtered results
  renderChainDropdown(chains, null);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleFocus(): void {
  // Store current chain as the one to restore if user cancels
  const currentChainId = callbacks.getCurrentChainId();
  chainDropdownPreviousChainId = String(currentChainId);
  // Set current chain as pinned (appears first, highlighted)
  chainDropdownPinnedChainId = String(currentChainId);
  // Clear input for typing
  elChainIdInput.value = "";
  // Show all chains with current selection pinned at top
  renderChainDropdown(ALL_CHAINS, chainDropdownPinnedChainId);
}

function handleInput(): void {
  // User is typing - clear pinned since we're filtering
  chainDropdownPinnedChainId = null;
  refreshChainDropdown();
}

function handleKeydown(e: KeyboardEvent): void {
  const items = elChainDropdown.querySelectorAll(".chain-item");
  const isOpen = elChainDropdown.classList.contains("show");

  if (e.key === "ArrowDown") {
    if (!isOpen) {
      // Mirror the focus handler: track previous, pin current, clear input
      const currentChainId = callbacks.getCurrentChainId();
      chainDropdownPreviousChainId = String(currentChainId);
      chainDropdownPinnedChainId = String(currentChainId);
      elChainIdInput.value = "";
      renderChainDropdown(ALL_CHAINS, chainDropdownPinnedChainId);
      return;
    }
    e.preventDefault();
    chainDropdownActiveIdx = Math.min(chainDropdownActiveIdx + 1, items.length - 1);
    setActiveChainItem(chainDropdownActiveIdx);
  } else if (e.key === "ArrowUp") {
    if (!isOpen) return;
    e.preventDefault();
    chainDropdownActiveIdx = Math.max(chainDropdownActiveIdx - 1, 0);
    setActiveChainItem(chainDropdownActiveIdx);
  } else if (e.key === "Enter" && isOpen) {
    e.preventDefault();
    // If user navigated to an item, select it
    if (chainDropdownActiveIdx >= 0 && items[chainDropdownActiveIdx]) {
      const item = items[chainDropdownActiveIdx] as HTMLElement;
      const cId = item.dataset.chainId;
      const nameEl = item.querySelector(".chain-item-name");
      const cName = nameEl ? nameEl.textContent || "" : "";
      if (cId) selectChain(cId, cName);
    } else if (chainDropdownPinnedChainId) {
      // No navigation but have pinned chain - select it
      const pinnedChain = ALL_CHAINS.find((c) => c.id === chainDropdownPinnedChainId);
      if (pinnedChain) {
        selectChain(pinnedChain.id, pinnedChain.name);
      }
    } else {
      // No pinned, no navigation - select first from filtered
      const chains = filterChains(elChainIdInput.value);
      const first = chains[0];
      if (first) {
        selectChain(first.id, first.name);
      }
    }
  } else if (e.key === "Escape") {
    // Restore previous selection on Escape
    const restoreChainId = chainDropdownPreviousChainId || String(callbacks.getCurrentChainId());
    elChainIdInput.value = formatChainDisplay(
      restoreChainId,
      CHAIN_NAMES[restoreChainId] ?? undefined
    );
    chainDropdownPreviousChainId = null;
    hideChainDropdown();
  } else if (e.key === "Tab") {
    // On Tab, if typing a partial match, select first match or restore
    const query = elChainIdInput.value.trim();
    if (query) {
      const chains = filterChains(query);
      const onlyMatch = chains.length === 1 ? chains[0] : undefined;
      if (onlyMatch) {
        selectChain(onlyMatch.id, onlyMatch.name);
      } else if (chains.length > 1) {
        // Ambiguous - restore previous
        const restoreChainId =
          chainDropdownPreviousChainId || String(callbacks.getCurrentChainId());
        elChainIdInput.value = formatChainDisplay(
          restoreChainId,
          CHAIN_NAMES[restoreChainId] ?? undefined
        );
        chainDropdownPreviousChainId = null;
      }
    } else {
      // No input - restore previous
      const restoreChainId = chainDropdownPreviousChainId || String(callbacks.getCurrentChainId());
      elChainIdInput.value = formatChainDisplay(
        restoreChainId,
        CHAIN_NAMES[restoreChainId] ?? undefined
      );
      chainDropdownPreviousChainId = null;
    }
    hideChainDropdown();
  }
}

function handleDocumentMousedown(e: MouseEvent): void {
  const target = e.target as Node;
  if (target === elChainIdInput || elChainDropdown.contains(target)) {
    return;
  }
  // On blur, restore previous selection if input doesn't match a valid chain
  const query = elChainIdInput.value.trim().toLowerCase();
  const matchingChains = filterChains(query);
  const singleMatch = matchingChains.length === 1 ? matchingChains[0] : undefined;
  if (singleMatch) {
    // Auto-select if only one match
    selectChain(singleMatch.id, singleMatch.name);
  } else {
    // Restore previous selection
    const restoreChainId = chainDropdownPreviousChainId || String(callbacks.getCurrentChainId());
    elChainIdInput.value = formatChainDisplay(
      restoreChainId,
      CHAIN_NAMES[restoreChainId] ?? undefined
    );
    chainDropdownPreviousChainId = null;
  }
  hideChainDropdown();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current chain ID from the chain input element.
 * Reads data-chain-id attribute first, then parses the display value.
 */
export function getCurrentChainId(): number {
  if (!elChainIdInput) return 8453; // Default to Base before init

  // First check data attribute (set by dropdown selection)
  const dataChainId = elChainIdInput.dataset.chainId;
  if (dataChainId) return Number(dataChainId);

  // Fall back to input value (could be numeric ID or display format)
  const val = elChainIdInput.value.trim();
  if (/^[0-9]+$/.test(val)) {
    // Plain numeric ID
    return Number(val);
  }
  // Try to extract from display format "Name (ID)"
  const match = val.match(/\(([0-9]+)\)$/);
  if (match) {
    return Number(match[1]);
  }
  // Default to Base
  return 8453;
}

/**
 * Initialize the chain selector.
 * Sets up event listeners for focus, input, keydown, and outside-click behavior.
 */
export function initChainSelector(
  elements: ChainSelectorElements,
  cbs: ChainSelectorCallbacks
): void {
  elChainIdInput = elements.chainIdInput;
  elChainDropdown = elements.chainDropdown;
  callbacks = cbs;

  // Event listeners
  elChainIdInput.addEventListener("focus", handleFocus);
  elChainIdInput.addEventListener("input", handleInput);
  elChainIdInput.addEventListener("keydown", handleKeydown);
  document.addEventListener("mousedown", handleDocumentMousedown);

  // Expose on window for inline JS compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.getCurrentChainId = getCurrentChainId;
  win.formatChainDisplay = formatChainDisplay;
  win.__cb_getCurrentChainId = () => getCurrentChainId();
}
