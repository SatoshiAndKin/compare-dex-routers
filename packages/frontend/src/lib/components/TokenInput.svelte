<script lang="ts">
  /**
   * TokenInput — searchable token autocomplete input.
   * Ports behavior from src/client/autocomplete.ts (form parts).
   * Also handles unrecognized 0x address detection via tokenListStore.
   */
  import { formStore, type TokenInfo } from "../stores/formStore.svelte.js";
  import { tokensStore } from "../stores/tokensStore.svelte.js";
  import { tokenListStore } from "../stores/tokenListStore.svelte.js";
  import UnrecognizedTokenModal from "./UnrecognizedTokenModal.svelte";
  import { onMount } from "svelte";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    type: "from" | "to";
  }

  let { type }: Props = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let inputValue = $state("");
  let dropdownVisible = $state(false);
  let matches = $state<TokenInfo[]>([]);
  let activeIdx = $state(-1);
  let inputEl = $state<HTMLInputElement | null>(null);
  let containerEl = $state<HTMLElement | null>(null);
  let pendingSelectedToken = $state<TokenInfo | null>(null);
  let pendingCurrentSideToken = $state<TokenInfo | null>(null);

  /** Track whether this TokenInput instance opened the unrecognized-token modal */
  let openedModal = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let currentToken = $derived(type === "from" ? formStore.fromToken : formStore.toToken);
  let showClearButton = $derived(inputValue.trim().length > 0 || currentToken !== null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Format token display: "SYMBOL (0xFullAddress)" — NEVER truncate */
  function formatTokenDisplay(symbol: string, address: string): string {
    return `${symbol} (${address})`;
  }

  /** Normalize address for comparison */
  function normalizeAddress(value: string): string {
    const lower = value.toLowerCase();
    return lower.startsWith("0x") ? lower.slice(2) : lower;
  }

  /** Check whether a value looks like a full ERC-20 address */
  function isAddressLike(value: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
  }

  /** Find token matches for autocomplete */
  function findMatches(query: string): TokenInfo[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const chainId = formStore.chainId;
    const tokens = tokensStore.getForChain(chainId);
    const normalizedQ = normalizeAddress(q);

    // Track symbol duplicates for disambiguation
    const symbolCounts = new Map<string, number>();
    for (const token of tokens) {
      const sym = (token.symbol ?? "").toLowerCase();
      symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
    }

    return tokens
      .filter((token) => {
        const symbol = (token.symbol ?? "").toLowerCase();
        const name = (token.name ?? "").toLowerCase();
        const address = (token.address ?? "").toLowerCase();
        const normalizedAddr = normalizeAddress(address);
        return (
          symbol.includes(q) ||
          name.includes(q) ||
          address.includes(q) ||
          normalizedAddr.includes(normalizedQ)
        );
      })
      .slice(0, 20);
  }

  /** Refresh autocomplete matches */
  function refreshMatches(): void {
    matches = findMatches(inputValue);
    if (matches.length > 0) {
      dropdownVisible = true;
      activeIdx = -1;
    } else {
      dropdownVisible = false;
    }
  }

  /** Select a token and update store, swapping sides when the new selection duplicates the opposite side */
  function selectToken(token: TokenInfo): void {
    const currentSideToken =
      pendingCurrentSideToken ?? (type === "from" ? formStore.fromToken : formStore.toToken);
    const otherSideToken = type === "from" ? formStore.toToken : formStore.fromToken;
    const normalizedSelectedAddress = normalizeAddress(token.address);

    if (type === "from") {
      formStore.fromToken = token;
      if (
        otherSideToken !== null &&
        normalizeAddress(otherSideToken.address) === normalizedSelectedAddress
      ) {
        formStore.toToken = currentSideToken;
      }
    } else {
      formStore.toToken = token;
      if (
        otherSideToken !== null &&
        normalizeAddress(otherSideToken.address) === normalizedSelectedAddress
      ) {
        formStore.fromToken = currentSideToken;
      }
    }

    inputValue = formatTokenDisplay(token.symbol, token.address);
    matches = [];
    dropdownVisible = false;
    activeIdx = -1;
    pendingSelectedToken = null;
    pendingCurrentSideToken = null;
  }

  function hideDropdown(): void {
    dropdownVisible = false;
    matches = [];
    activeIdx = -1;
  }

  function clearToken(): void {
    inputValue = "";
    hideDropdown();
    openedModal = false;
    tokenListStore.unrecognizedModal = null;

    if (type === "from") {
      formStore.fromToken = null;
    } else {
      formStore.toToken = null;
    }

    inputEl?.focus();
  }

  function handleClearMousedown(e: MouseEvent): void {
    e.preventDefault();
  }

  function setActive(index: number): void {
    activeIdx = index;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  async function handleInput(e: Event): Promise<void> {
    const target = e.target as HTMLInputElement;
    inputValue = target.value;

    if (
      pendingSelectedToken === null ||
      normalizeAddress(pendingSelectedToken.address) !== normalizeAddress(target.value)
    ) {
      pendingCurrentSideToken = type === "from" ? formStore.fromToken : formStore.toToken;
      pendingSelectedToken = null;
    }

    // Clear the store token when input changes manually
    if (type === "from") {
      formStore.fromToken = null;
    } else {
      formStore.toToken = null;
    }

    await tokensStore.fetchIfNeeded();
    refreshMatches();

    // Immediate detection: if a full 42-char address is typed, check it
    const trimmed = inputValue.trim();
    if (isAddressLike(trimmed) && matches.length === 0) {
      // Short delay to avoid firing on every keystroke
      setTimeout(() => {
        if (inputValue.trim() === trimmed) {
          checkUnrecognizedAddress(trimmed);
        }
      }, 100);
    }
  }

  function handleBlur(): void {
    const trimmed = inputValue.trim();
    if (isAddressLike(trimmed) && matches.length === 0) {
      checkUnrecognizedAddress(trimmed);
    }
  }

  async function handleFocus(): Promise<void> {
    await tokensStore.fetchIfNeeded();
    if (inputValue.trim()) {
      refreshMatches();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!dropdownVisible) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, matches.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeIdx >= 0 ? activeIdx : 0;
      const selected = matches[idx];
      if (selected) selectToken(selected);
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  }

  function handleItemMousedown(e: MouseEvent, token: TokenInfo): void {
    e.preventDefault();
    pendingSelectedToken = token;
    selectToken(token);
  }

  function handleDocumentClick(e: MouseEvent): void {
    if (!dropdownVisible) return;
    if (!containerEl) return;
    const target = e.target as Node;
    if (containerEl.contains(target)) return;
    hideDropdown();
  }

  // ---------------------------------------------------------------------------
  // Unrecognized token detection
  // ---------------------------------------------------------------------------

  /**
   * Check whether the current input address is recognised.
   * If not, open the UnrecognizedTokenModal for this input type.
   */
  function checkUnrecognizedAddress(value: string): void {
    const trimmed = value.trim();
    if (!isAddressLike(trimmed)) return;

    const chainId = formStore.chainId;
    const found = tokenListStore.findToken(trimmed, chainId);

    if (found) {
      // Auto-select the recognised token
      selectToken({ ...found, chainId: found.chainId });
    } else {
      openedModal = true;
      tokenListStore.unrecognizedModal = { address: trimmed, chainId, targetType: type };
    }
  }

  /**
   * When the unrecognized-token modal closes (null) and this input opened it,
   * check whether a matching token was saved and auto-select it.
   */
  $effect(() => {
    const modal = tokenListStore.unrecognizedModal;
    if (modal !== null || !openedModal) return;

    openedModal = false;
    const addr = inputValue.trim();
    if (!addr) return;

    const found = tokenListStore.findToken(addr, formStore.chainId);
    if (found) {
      selectToken({ ...found, chainId: found.chainId });
    }
  });

  // Sync input value when store token changes externally
  $effect(() => {
    const token = type === "from" ? formStore.fromToken : formStore.toToken;
    if (token) {
      const expected = formatTokenDisplay(token.symbol, token.address);
      if (inputValue !== expected) {
        inputValue = expected;
      }
    } else if (!inputValue) {
      // cleared externally
    }
  });

  onMount(() => {
    // Prefetch tokens in background
    tokensStore.fetchIfNeeded().catch(() => {});
  });
</script>

<svelte:window on:mousedown={handleDocumentClick} />

<div class="token-input-wrapper" bind:this={containerEl}>
  <div class="token-input-field">
    {#if currentToken?.logoURI}
      <img
        class="token-icon-selected"
        src={currentToken.logoURI}
        alt={`${currentToken.symbol} logo`}
        onerror={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    {/if}
    <input
      bind:this={inputEl}
      class="token-input"
      type="text"
      placeholder={type === "from" ? "Sell token..." : "Receive token..."}
      value={inputValue}
      oninput={handleInput}
      onfocus={handleFocus}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      autocomplete="off"
      aria-label={type === "from" ? "From token" : "To token"}
    />

    {#if showClearButton}
      <button
        type="button"
        class="clear-token-button"
        aria-label={type === "from" ? "Clear from token" : "Clear to token"}
        onmousedown={handleClearMousedown}
        onclick={clearToken}
      >
        ×
      </button>
    {/if}
  </div>

  {#if dropdownVisible && matches.length > 0}
    <div class="token-autocomplete-list" role="listbox">
      {#each matches as token, i}
        <div
          class={`autocomplete-item${activeIdx === i ? " active" : ""}`}
          role="option"
          tabindex="-1"
          aria-selected={activeIdx === i}
          onmousedown={(e) => handleItemMousedown(e, token)}
        >
          {#if token.logoURI}
            <img
              class="autocomplete-logo"
              src={token.logoURI}
              alt={`${token.symbol} logo`}
              loading="lazy"
              onerror={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          {:else}
            <span class="autocomplete-logo-placeholder"></span>
          {/if}
          <div class="autocomplete-meta">
            <div class="autocomplete-title">
              <span class="autocomplete-symbol">{token.symbol}</span>
              {#if token.name}
                <span class="autocomplete-name">{token.name}</span>
              {/if}
            </div>
            <!-- Always show full address — NEVER truncate -->
            <div class="autocomplete-addr">{token.address}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Render modal only for this input type to avoid double-rendering -->
{#if tokenListStore.unrecognizedModal?.targetType === type}
  <UnrecognizedTokenModal />
{/if}

<style>
  .token-input-wrapper {
    position: relative;
    width: 100%;
  }

  .token-input-field {
    display: flex;
    align-items: center;
    border: 2px solid var(--border, #000);
    background: var(--bg-input, #fff);
  }

  .token-icon-selected {
    width: 20px;
    height: 20px;
    margin-left: 0.5rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .token-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--text, #000);
    font-size: 0.95rem;
    font-family: inherit;
    min-width: 0;
  }

  .clear-token-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    min-width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-left: 2px solid var(--border, #000);
    border-radius: 0;
    background: transparent;
    color: var(--text, #000);
    font: inherit;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
  }

  .clear-token-button:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .clear-token-button:focus-visible {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: -2px;
  }

  .token-input:focus {
    outline: none;
  }

  .token-input-field:focus-within {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .token-autocomplete-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    background: var(--bg-card, #fff);
    border: 2px solid var(--border, #000);
    border-top: none;
    max-height: 280px;
    overflow-y: auto;
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .autocomplete-item:hover,
  .autocomplete-item.active {
    background: var(--bg-hover, #f0f0f0);
  }

  .autocomplete-logo {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .autocomplete-logo-placeholder {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--icon-bg, #e0e0e0);
    flex-shrink: 0;
  }

  .autocomplete-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .autocomplete-title {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .autocomplete-symbol {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .autocomplete-name {
    color: var(--text-muted, #666);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .autocomplete-addr {
    font-family: monospace;
    font-size: clamp(0.625rem, 1.5vw, 0.75rem);
    color: var(--text-muted, #666);
    word-break: break-all;
  }
</style>
