<script lang="ts">
  /**
   * AmountFields — sell/receive two-field amount input with direction toggle.
   * Ports behavior from src/client/amount-fields.ts.
   */
  import { formStore } from "../stores/formStore.svelte.js";
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";

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
  const estimateStatus = $derived(
    !quote
      ? "Waiting for quote"
      : comparisonStore.isStale
        ? "Previous estimate"
        : "Estimated from selected route"
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

  <div class={`amount-group${isExactIn ? " active" : " computed"}`}>
    <label class="amount-label" for="sell-amount">{sellLabel}</label>
    <div class="amount-input-row">
      <input
        id="sell-amount"
        class="amount-input"
        type="number"
        min="0"
        step="any"
        placeholder={isExactIn ? "Enter amount" : ""}
        value={sellValue}
        readonly={!isExactIn}
        onfocus={handleSellFocus}
        oninput={handleSellInput}
        aria-label={sellLabel}
      />
    </div>
    <span class="amount-hint">{isExactIn ? "Exact amount" : estimateStatus}</span>
  </div>

  <div class={`amount-group${!isExactIn ? " active" : " computed"}`}>
    <label class="amount-label" for="receive-amount">{receiveLabel}</label>
    <div class="amount-input-row">
      <input
        id="receive-amount"
        class="amount-input"
        type="number"
        min="0"
        step="any"
        placeholder={!isExactIn ? "Enter amount" : ""}
        value={receiveValue}
        readonly={isExactIn}
        onfocus={handleReceiveFocus}
        oninput={handleReceiveInput}
        aria-label={receiveLabel}
      />
    </div>
    <span class="amount-hint">{!isExactIn ? "Exact amount" : estimateStatus}</span>
  </div>
</div>

<style>
  .amount-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 0.75rem;
  }

  .amount-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .amount-hint {
    min-height: 3em;
    line-height: 1.5;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .amount-group.computed .amount-input {
    background: var(--computed-bg, #f5f5f5);
    border-color: var(--computed-border, #999);
    color: var(--text-muted, #666);
  }

  .amount-group.active .amount-input {
    background: var(--bg-input, #fff);
    border-color: var(--border, #000);
    color: var(--text, #000);
  }

  .amount-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #666);
  }

  .amount-input-row {
    display: flex;
    align-items: center;
  }

  .amount-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-light);
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    font-size: 1rem;
    font-family: inherit;
    transition:
      background 0.1s,
      border-color 0.1s;
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
    grid-column: 1 / -1;
    display: flex;
    gap: 0;
  }

  .mode-btn {
    flex: 1;
    padding: 0.35rem 0.75rem;
    background: var(--bg-muted, #f0f0f0);
    border: 0;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--text, #000);
    transition: background 0.1s;
  }

  .mode-btn + .mode-btn {
    border-left: none;
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
