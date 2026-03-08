<script lang="ts">
  /**
   * AmountFields — sell/receive two-field amount input with direction toggle.
   * Ports behavior from src/client/amount-fields.ts.
   */
  import { formStore } from '../stores/formStore.svelte.js';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let isProgrammaticUpdate = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let isExactIn = $derived(formStore.mode === 'exactIn');
  let fromSymbol = $derived(formStore.fromToken?.symbol ?? '');
  let toSymbol = $derived(formStore.toToken?.symbol ?? '');

  let sellLabel = $derived(fromSymbol ? `YOU SELL ${fromSymbol}` : 'YOU SELL');
  let receiveLabel = $derived(toSymbol ? `YOU RECEIVE ${toSymbol}` : 'YOU RECEIVE');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Format a quote amount for display: ≤8 decimals, trim trailing zeros.
   */
  export function formatQuoteAmount(value: string | number): string {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '';
    let formatted = num.toFixed(8);
    if (formatted.includes('.')) {
      formatted = formatted.replace(/0+$/, '').replace(/\.$/, '');
    }
    return formatted;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleSellFocus(): void {
    if (isProgrammaticUpdate) return;
    if (formStore.mode !== 'exactIn') {
      formStore.mode = 'exactIn';
    }
  }

  function handleReceiveFocus(): void {
    if (isProgrammaticUpdate) return;
    if (formStore.mode !== 'targetOut') {
      formStore.mode = 'targetOut';
    }
  }

  function handleSellInput(e: Event): void {
    if (isProgrammaticUpdate) return;
    const target = e.target as HTMLInputElement;
    if (formStore.mode !== 'exactIn') {
      formStore.mode = 'exactIn';
    }
    formStore.sellAmount = target.value;
  }

  function handleReceiveInput(e: Event): void {
    if (isProgrammaticUpdate) return;
    const target = e.target as HTMLInputElement;
    if (formStore.mode !== 'targetOut') {
      formStore.mode = 'targetOut';
    }
    formStore.receiveAmount = target.value;
  }

  function handleToggle(): void {
    // Switch mode
    const newMode = formStore.mode === 'exactIn' ? 'targetOut' : 'exactIn';
    formStore.mode = newMode;

    // Optionally swap tokens on toggle
    // (matching original behavior which doesn't swap tokens, just switches mode)
  }
</script>

<div class="amount-fields">
  <div class={`amount-group${isExactIn ? ' active' : ' computed'}`}>
    <label class="amount-label" for="sell-amount">{sellLabel}</label>
    <div class="amount-input-row">
      <input
        id="sell-amount"
        class="amount-input"
        type="number"
        min="0"
        step="any"
        placeholder={isExactIn ? 'Enter amount' : ''}
        value={formStore.sellAmount}
        readonly={!isExactIn}
        onfocus={handleSellFocus}
        oninput={handleSellInput}
        aria-label={sellLabel}
      />
    </div>
  </div>

  <div class="direction-toggle-row">
    <button
      class="direction-toggle"
      type="button"
      onclick={handleToggle}
      aria-label="Switch direction"
      title="Switch direction (exactIn / targetOut)"
    >
      ⇄
    </button>
    {#if !isExactIn}
      <span class="targetout-note">Reverse quote: specify desired output amount</span>
    {/if}
  </div>

  <div class={`amount-group${!isExactIn ? ' active' : ' computed'}`}>
    <label class="amount-label" for="receive-amount">{receiveLabel}</label>
    <div class="amount-input-row">
      <input
        id="receive-amount"
        class="amount-input"
        type="number"
        min="0"
        step="any"
        placeholder={!isExactIn ? 'Enter amount' : ''}
        value={formStore.receiveAmount}
        readonly={isExactIn}
        onfocus={handleReceiveFocus}
        oninput={handleReceiveInput}
        aria-label={receiveLabel}
      />
    </div>
  </div>
</div>

<style>
  .amount-fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .amount-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
    border: 2px solid var(--border, #000);
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
  .amount-input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .direction-toggle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0;
  }

  .direction-toggle {
    padding: 0.25rem 0.75rem;
    background: var(--bg-muted, #f0f0f0);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 1.2rem;
    font-family: inherit;
    color: var(--text, #000);
    transition: background 0.1s;
  }

  .direction-toggle:hover {
    background: var(--bg-hover, #e0e0e0);
  }

  .direction-toggle:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .targetout-note {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
    font-style: italic;
  }
</style>
