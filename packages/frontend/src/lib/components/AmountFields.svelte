<script lang="ts">
  /**
   * AmountFields — sell/receive two-field amount input with direction toggle.
   * Ports behavior from src/client/amount-fields.ts.
   */
  import { formStore } from "../stores/formStore.svelte.js";
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";
  import { formatQuoteRate } from "../quote-rates.js";
  import type { Snippet } from "svelte";

  let {
    sellToken,
    buyToken,
    reverse,
    sellBalance,
    buyBalance,
    settings,
  }: {
    sellToken?: Snippet;
    buyToken?: Snippet;
    reverse?: Snippet;
    sellBalance?: Snippet;
    buyBalance?: Snippet;
    settings?: Snippet;
  } = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let isProgrammaticUpdate = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let isExactIn = $derived(formStore.mode === "exactIn");
  let fromSymbol = $derived(formStore.fromToken?.symbol ?? "");
  let toSymbol = $derived(formStore.toToken?.symbol ?? "");

  let sellLabel = $derived(fromSymbol ? `YOU SELL ${fromSymbol}` : "YOU SELL");
  let receiveLabel = $derived(toSymbol ? `YOU RECEIVE ${toSymbol}` : "YOU RECEIVE");
  const quote = $derived.by(() => {
    const active = comparisonStore.activeQuote;
    return active &&
      active.chainId === formStore.chainId &&
      active.mode === formStore.mode &&
      active.from.toLowerCase() === formStore.fromToken?.address.toLowerCase() &&
      active.to.toLowerCase() === formStore.toToken?.address.toLowerCase()
      ? active
      : null;
  });
  const sellValue = $derived(isExactIn ? formStore.sellAmount : (quote?.input_amount ?? ""));
  const receiveValue = $derived(isExactIn ? (quote?.output_amount ?? "") : formStore.receiveAmount);
  const exchangeRate = $derived(quote && formatQuoteRate(quote.output_amount, quote.input_amount));
  const estimateStatus = $derived(
    !quote ? "" : comparisonStore.isStale ? "Previous estimate" : "Estimate"
  );

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Format a quote amount for display: ≤8 decimals, trim trailing zeros.
   */
  export function formatQuoteAmount(value: string | number): string {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return "";
    let formatted = num.toFixed(8);
    if (formatted.includes(".")) {
      formatted = formatted.replace(/0+$/, "").replace(/\.$/, "");
    }
    return formatted;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleSellFocus(): void {
    if (isProgrammaticUpdate) return;
    if (formStore.mode !== "exactIn") {
      setMode("exactIn");
    }
  }

  function handleReceiveFocus(): void {
    if (isProgrammaticUpdate) return;
    if (formStore.mode !== "targetOut") {
      setMode("targetOut");
    }
  }

  function handleSellInput(e: Event): void {
    if (isProgrammaticUpdate) return;
    const target = e.target as HTMLInputElement;
    if (formStore.mode !== "exactIn") {
      formStore.mode = "exactIn";
    }
    formStore.sellAmount = target.value;
  }

  function handleReceiveInput(e: Event): void {
    if (isProgrammaticUpdate) return;
    const target = e.target as HTMLInputElement;
    if (formStore.mode !== "targetOut") {
      formStore.mode = "targetOut";
    }
    formStore.receiveAmount = target.value;
  }

  function setMode(mode: "exactIn" | "targetOut"): void {
    if (mode === formStore.mode) return;
    if (mode === "exactIn") formStore.sellAmount = sellValue;
    else formStore.receiveAmount = receiveValue;
    formStore.mode = mode;
  }
</script>

<div class="amount-fields">
  <div class="mode-toggle-row">
    <button
      class={`mode-btn${isExactIn ? " active" : ""}`}
      type="button"
      onclick={() => setMode("exactIn")}
      aria-pressed={isExactIn}
    >
      Exact Input
    </button>
    <button
      class={`mode-btn${!isExactIn ? " active" : ""}`}
      type="button"
      onclick={() => setMode("targetOut")}
      aria-pressed={!isExactIn}
    >
      Exact Output
    </button>
  </div>

  <div class="token-pair">
    <div class="amount-group" class:active={isExactIn} class:computed={!isExactIn}>
      <div class="amount-heading">
        <label class="amount-label" for="sell-amount">Sell</label>
        {@render sellBalance?.()}
      </div>
      <div class="amount-input-row">
        <input
          id="sell-amount"
          class="amount-input"
          type="number"
          min="0"
          step="any"
          placeholder="0.0"
          value={sellValue}
          readonly={!isExactIn}
          onfocus={handleSellFocus}
          oninput={handleSellInput}
          aria-label={sellLabel}
        />
        {@render sellToken?.()}
      </div>
      <div class="amount-meta">
        <span>{isExactIn ? "" : estimateStatus}</span>
      </div>
    </div>

    {@render reverse?.()}

    <div class="amount-group" class:active={!isExactIn} class:computed={isExactIn}>
      <div class="amount-heading">
        <label class="amount-label" for="receive-amount">Buy</label>
        {@render buyBalance?.()}
      </div>
      <div class="amount-input-row">
        <input
          id="receive-amount"
          class="amount-input"
          type="number"
          min="0"
          step="any"
          placeholder="0.0"
          value={receiveValue}
          readonly={isExactIn}
          onfocus={handleReceiveFocus}
          oninput={handleReceiveInput}
          aria-label={receiveLabel}
        />
        {@render buyToken?.()}
      </div>
      <div class="amount-meta"><span>{!isExactIn ? "" : estimateStatus}</span></div>
    </div>
  </div>
  {#if settings}
    <div class="swap-summary">
      {@render settings()}
      <div class="summary-row">
        <span>Exchange rate</span><strong>
          {#if quote && exchangeRate}1 {quote.from_symbol} ≈ {exchangeRate}
            {quote.to_symbol}{:else}—{/if}
        </strong>
      </div>
      <div class="summary-row"><span>DEX route</span><strong>{quote?.provider ?? "—"}</strong></div>
    </div>
  {/if}
</div>

<style>
  .amount-fields {
    display: grid;
    gap: 0.5rem;
  }
  .swap-summary {
    font-size: 0.875rem;
  }
  .summary-row {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.5rem;
    min-height: 1.375rem;
    overflow-wrap: anywhere;
  }
  .summary-row span {
    color: var(--text-muted);
  }
  .summary-row strong {
    text-align: right;
  }
  .token-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.125rem;
  }

  .amount-group {
    display: grid;
    grid-template-rows: auto auto 1.125rem;
    min-width: 0;
    padding: 0.375rem 0.625rem;
    background: var(--bg-muted);
    border: 1px solid var(--border-light);
  }
  .amount-group.active {
    border-color: var(--border);
  }
  .amount-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .amount-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.5rem;
  }

  .amount-label {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .amount-input-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(8rem, 38%);
    align-items: center;
    gap: 0.375rem;
  }

  input.amount-input {
    min-width: 0;
    width: 100%;
    padding: 0.25rem 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: 650 1.375rem/1.2 system-ui;
    font-variant-numeric: tabular-nums;
  }
  input.amount-input[readonly] {
    text-overflow: ellipsis;
  }
  @media (max-width: 600px) {
    .amount-input-row input.amount-input {
      font-size: 1.25rem !important;
    }
  }

  .amount-input:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .amount-input[readonly] {
    cursor: default;
  }

  /* Hide number input spinners */
  .amount-input::-webkit-outer-spin-button,
  .amount-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .amount-input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .mode-toggle-row {
    display: flex;
    gap: 0.25rem;
  }

  .mode-btn {
    padding: 0.25rem 0.65rem;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--text, #000);
    text-transform: none;
    letter-spacing: normal;
    transition: background 0.1s;
  }

  .mode-btn.active {
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border-color: var(--accent, #0055ff);
  }

  .mode-btn:hover:not(.active) {
    background: var(--bg-hover, #e0e0e0);
  }

  .mode-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
    z-index: 1;
    position: relative;
  }
</style>
