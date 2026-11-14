<script lang="ts">
  /**
   * AmountFields — sell/receive two-field amount input with direction toggle.
   * Ports behavior from src/client/amount-fields.ts.
   */
  import { formStore, type TokenInfo } from "../stores/formStore.svelte.js";
  import { comparisonStore, type Quote } from "../stores/comparisonStore.svelte.js";
  import { formatQuoteRate } from "../quote-rates.js";
  import type { Snippet } from "svelte";

  let {
    chain,
    sellToken,
    buyToken,
    reverse,
    sellBalance,
    buyBalance,
    settings,
  }: {
    chain?: Snippet;
    sellToken?: Snippet;
    buyToken?: Snippet;
    reverse?: Snippet<[() => void]>;
    sellBalance?: Snippet;
    buyBalance?: Snippet;
    settings?: Snippet;
  } = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let isProgrammaticUpdate = $state(false);
  let reversedAmount = $state.raw<{
    from: TokenInfo;
    to: TokenInfo;
    mode: typeof formStore.mode;
    exactAmount: string;
    amount: string;
    previousQuotes: Quote[];
  } | null>(null);

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
  const carriedAmount = $derived.by(() => {
    const previous = reversedAmount;
    const amount = isExactIn ? formStore.sellAmount : formStore.receiveAmount;
    return previous &&
      previous.from === formStore.fromToken &&
      previous.to === formStore.toToken &&
      previous.mode === formStore.mode &&
      previous.exactAmount === amount &&
      previous.previousQuotes === comparisonStore.quotes
      ? previous.amount
      : "";
  });
  const sellValue = $derived(
    isExactIn ? formStore.sellAmount : (quote?.input_amount ?? carriedAmount)
  );
  const receiveValue = $derived(
    isExactIn ? (quote?.output_amount ?? carriedAmount) : formStore.receiveAmount
  );
  const exchangeRate = $derived(quote && formatQuoteRate(quote.output_amount, quote.input_amount));
  const rateLabel = $derived(
    quote && exchangeRate ? `1 ${quote.from_symbol} ≈ ${exchangeRate} ${quote.to_symbol}` : null
  );
  const estimateStatus = $derived(
    quote
      ? comparisonStore.isStale
        ? "Previous estimate"
        : "Estimate"
      : carriedAmount
        ? "Previous amount"
        : ""
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
    reversedAmount = null;
    const target = e.target as HTMLInputElement;
    if (formStore.mode !== "exactIn") {
      formStore.mode = "exactIn";
    }
    formStore.sellAmount = target.value;
  }

  function handleReceiveInput(e: Event): void {
    if (isProgrammaticUpdate) return;
    reversedAmount = null;
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
    reversedAmount = null;
    formStore.mode = mode;
  }

  function reverseTrade(): void {
    const { fromToken, toToken } = formStore;
    if (!fromToken || !toToken) return;
    const mode = isExactIn ? "targetOut" : "exactIn";
    const sell = sellValue;
    const receive = receiveValue;
    reversedAmount = {
      from: toToken,
      to: fromToken,
      mode,
      exactAmount: isExactIn ? sell : receive,
      amount: isExactIn ? receive : sell,
      previousQuotes: comparisonStore.quotes,
    };
    formStore.fromToken = toToken;
    formStore.toToken = fromToken;
    formStore.sellAmount = receive;
    formStore.receiveAmount = sell;
    formStore.mode = mode;
  }
</script>

<div class="amount-fields">
  <div class="trade-options">
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
    {@render chain?.()}
  </div>

  <div class="token-pair">
    <div class="amount-group" class:active={isExactIn} class:computed={!isExactIn}>
      <div class="amount-heading">
        <label class="amount-label" for="sell-amount">Sell</label>
        {#if !isExactIn && estimateStatus}<span class="amount-meta">{estimateStatus}</span>{/if}
      </div>
      <div class="amount-token">
        {@render sellToken?.()}
      </div>
      {@render sellBalance?.()}
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
      </div>
    </div>

    <div class="amount-group" class:active={!isExactIn} class:computed={isExactIn}>
      <div class="amount-heading">
        <label class="amount-label" for="receive-amount">Buy</label>
        {#if isExactIn && estimateStatus}<span class="amount-meta">{estimateStatus}</span>{/if}
      </div>
      <div class="amount-token">
        {@render buyToken?.()}
      </div>
      {@render buyBalance?.()}
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
      </div>
    </div>
  </div>
  {#if reverse || settings}
    <div class="swap-summary">
      {@render reverse?.(reverseTrade)}
      {#if settings}
        {@render settings()}
        <div class="exchange-rate" role="group" aria-label="Exchange rate">
          <strong title={rateLabel ?? undefined}>{rateLabel ?? "Rate —"}</strong>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .amount-fields {
    display: grid;
    gap: 0.25rem;
  }
  .trade-options {
    display: grid;
    grid-template-columns: max-content minmax(0, 11rem);
    justify-content: space-between;
    align-items: center;
    gap: 0.25rem;
  }
  .swap-summary {
    position: relative;
    display: grid;
    grid-template-columns: auto max-content minmax(0, 1fr);
    column-gap: 0.375rem;
    font-size: 0.75rem;
  }
  .exchange-rate {
    display: grid;
    align-items: center;
    min-height: 44px;
    line-height: 1.3;
  }
  .exchange-rate strong {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .token-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.125rem;
  }

  .amount-group {
    position: relative;
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    min-width: 0;
    padding-inline: 0.625rem;
    background: var(--bg-muted);
    border: 1px solid var(--border-light);
  }
  .amount-group.active {
    border-color: var(--border);
  }
  .amount-meta {
    font-size: 0.6875rem;
    line-height: 1.1;
    color: var(--text-muted);
  }
  .amount-heading {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 44px;
  }
  .amount-group > :global(.balance-display) {
    grid-column: 1 / -1;
    justify-self: end;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .amount-label {
    font-size: 0.875rem;
    line-height: 1.25;
    color: var(--text-muted);
    margin: 0;
  }

  .amount-token {
    min-width: 0;
  }
  .amount-input-row {
    grid-column: 1 / -1;
  }

  input.amount-input {
    min-width: 0;
    width: 100%;
    padding: 0;
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
    padding: 0.25rem 0.375rem;
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
  @media (max-width: 374px) {
    .trade-options {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
