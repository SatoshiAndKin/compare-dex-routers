<script lang="ts">
  /**
   * TokenInput — searchable token autocomplete input.
   * Ports behavior from src/client/autocomplete.ts (form parts).
   * Also handles unrecognized 0x address detection via tokenListStore.
   */
  import { isNativeToken } from "../native.js";
  import { formStore, type TokenInfo } from "../stores/formStore.svelte.js";
  import { tokensStore } from "../stores/tokensStore.svelte.js";
  import { tokenListStore } from "../stores/tokenListStore.svelte.js";
  import UnrecognizedTokenModal from "./UnrecognizedTokenModal.svelte";
  import InfoPopover from "./InfoPopover.svelte";
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
  let copyResult = $state<{ address: string; status: "copied" | "failed" } | null>(null);
  let pendingSelectedToken = $state<TokenInfo | null>(null);
  let pendingCurrentSideToken = $state<TokenInfo | null>(null);

  /** Track whether this TokenInput instance opened the unrecognized-token modal */
  let openedModal = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let currentToken = $derived(type === "from" ? formStore.fromToken : formStore.toToken);
  const copied = $derived(
    copyResult?.address === currentToken?.address && copyResult?.status === "copied"
  );
  const copyFailed = $derived(
    copyResult?.address === currentToken?.address && copyResult?.status === "failed"
  );
  let showClearButton = $derived(inputValue.trim().length > 0 || currentToken !== null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The input shows the token label; token details contain the full address. */
  function formatTokenDisplay(symbol: string): string {
    return symbol || "Token";
  }

  async function copyAddress(): Promise<void> {
    const address = currentToken?.address;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      copyResult = { address, status: "copied" };
    } catch {
      copyResult = { address, status: "failed" };
    }
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
      .sort((a, b) => Number(b.symbol.toLowerCase() === q) - Number(a.symbol.toLowerCase() === q))
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
    copyResult = null;
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

    inputValue = formatTokenDisplay(token.symbol);
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
    copyResult = null;
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
    copyResult = null;

    if (pendingCurrentSideToken === null) {
      pendingCurrentSideToken = type === "from" ? formStore.fromToken : formStore.toToken;
    }

    pendingSelectedToken = null;

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
      const expected = formatTokenDisplay(token.symbol);
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
        alt=""
        onerror={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    {:else}
      <span class="token-icon-selected" aria-hidden="true">{currentToken?.symbol?.[0] ?? ""}</span>
    {/if}
    <div class="token-name">
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
      {#if currentToken}
        <span class="selected-symbol" aria-hidden="true">{inputValue}</span>
      {/if}
    </div>
    <span class="picker-chevron" aria-hidden="true">⌄</span>
  </div>

  {#snippet clearButton()}
    <button
      type="button"
      class="clear-token-button"
      aria-label={type === "from" ? "Clear from token" : "Clear to token"}
      onmousedown={handleClearMousedown}
      onclick={clearToken}
    >
      ×
    </button>
  {/snippet}

  <div class="token-info">
    {#if currentToken}
      <InfoPopover label={type === "from" ? "Sell token details" : "Buy token details"}>
        <strong
          >{currentToken.symbol}{isNativeToken(currentToken.address) ? " · Native" : ""}</strong
        >
        <span class="selected-token-details">
          <span class="selected-token-address">{currentToken.address}</span>
          <button
            type="button"
            class="copy-address-button"
            aria-label={`Copy ${type} token address`}
            title={copied ? "Copied" : copyFailed ? "Retry copy" : "Copy address"}
            onclick={copyAddress}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              {#if copied}
                <path d="m5 12 4 4L19 6" />
              {:else}
                <path d="M9 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
                <rect x="3" y="7" width="14" height="14" rx="3" />
              {/if}
            </svg>
            <span class="copy-status" role="status"
              >{copied ? "Copied" : copyFailed ? "Retry" : "Copy"}</span
            >
          </button>
        </span>
        <span class="token-detail-actions">
          <button
            type="button"
            class="change-token-button"
            aria-label={type === "from" ? "Clear from token" : "Clear to token"}
            onmousedown={handleClearMousedown}
            onclick={clearToken}>Change token</button
          >
        </span>
        {#if copyFailed}<span class="copy-error" role="alert">
            Could not copy. Select and copy the full address.
          </span>{/if}
      </InfoPopover>
    {:else if showClearButton}
      {@render clearButton()}
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
              <span class="autocomplete-symbol"
                >{token.symbol}{isNativeToken(token.address) ? " — Native" : ""}</span
              >
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
  .selected-token-details {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    min-height: 44px;
  }
  .selected-token-address {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--text-muted);
    font: 0.75rem/1.5 monospace;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .copy-address-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .copy-address-button:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .copy-address-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .copy-status {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .copy-error {
    font-size: 0.75rem;
    color: var(--error);
    margin-top: 0.25rem;
  }
  .token-input-wrapper {
    position: static;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    width: 100%;
    min-height: 44px;
  }

  .token-input-field {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .token-icon-selected {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  span.token-icon-selected {
    display: grid;
    place-items: center;
    background: var(--icon-bg);
    color: var(--text-muted);
    font-size: 0.625rem;
    font-weight: 700;
  }
  .token-detail-actions {
    display: flex;
    justify-content: flex-end;
  }

  .change-token-button {
    font: inherit;
    text-transform: none;
    letter-spacing: normal;
    padding: 0 0.5rem;
    border: 1px solid var(--border-light);
  }
  .token-name {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .token-name > * {
    grid-area: 1 / 1;
    min-width: 0;
  }
  .selected-symbol {
    align-self: center;
    padding-inline-start: 0.25rem;
    overflow-wrap: anywhere;
    pointer-events: none;
    font-weight: 650;
    line-height: 1.25;
  }
  .token-name:has(.selected-symbol) .token-input:not(:focus) {
    color: transparent;
  }
  .token-input:focus + .selected-symbol {
    visibility: hidden;
  }
  .token-input-field .token-input {
    padding: 0.25rem 0 0.25rem 0.25rem;
    border: none;
    background: transparent;
    color: var(--text, #000);
    font-size: 1rem;
    font-weight: 650;
    font-family: inherit;
    min-width: 0;
  }
  .picker-chevron {
    flex: none;
    pointer-events: none;
    color: var(--text-muted);
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
