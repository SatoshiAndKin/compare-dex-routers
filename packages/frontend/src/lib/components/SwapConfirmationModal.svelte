<script lang="ts">
  /**
   * SwapConfirmationModal — shown before executing a swap.
   *
   * Reads swap confirmation state from transactionStore.
   * Displays trade details (from/to amounts, router address) and lets the
   * user confirm or cancel the swap.
   *
   * - Full 0x addresses are ALWAYS shown — never truncated (project convention)
   * - Escape key closes the modal (cancels the swap)
   * - Confirm triggers transactionStore.confirmSwap()
   * - Cancel / backdrop click triggers transactionStore.cancelSwap()
   */
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import type { SpandexQuote, CurveQuote } from "../stores/comparisonStore.svelte.js";

  const data = $derived(transactionStore.swapConfirmation);
  const isOpen = $derived(data !== null);

  function getQuoteDetails(quote: SpandexQuote | CurveQuote) {
    const isTargetOut = quote.mode === "targetOut";
    return {
      fromAmount: quote.input_amount ?? "",
      fromSymbol: quote.from_symbol ?? "",
      fromAddress: quote.from ?? "",
      toAmount: quote.output_amount ?? "",
      toSymbol: quote.to_symbol ?? "",
      toAddress: quote.to ?? "",
      routerAddress: quote.router_address ?? "",
      gasCostEth: quote.gas_cost_eth ?? "",
      isTargetOut,
    };
  }

  function handleConfirm(): void {
    transactionStore.confirmSwap();
  }

  function handleCancel(): void {
    transactionStore.cancelSwap();
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      handleCancel();
    }
  }
</script>

{#if isOpen && data}
  {@const details = getQuoteDetails(data.quote)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="swap-modal-title"
      onkeydown={handleKeydown}
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="swap-modal-title" class="modal-title">Confirm Swap</h2>
        <button type="button" class="close-btn" onclick={handleCancel} aria-label="Cancel swap">
          ×
        </button>
      </div>

      <div class="modal-body">
        <div class="trade-row">
          <span class="trade-label">
            {details.isTargetOut ? "You pay (required)" : "You sell"}
          </span>
          <span class="trade-amount">
            {details.fromAmount}
            {details.fromSymbol ? ` ${details.fromSymbol}` : ""}
          </span>
          {#if details.fromAddress}
            <!-- Full address — NEVER truncated (project convention) -->
            <span class="trade-address" title="Token contract address">
              {details.fromAddress}
            </span>
          {/if}
        </div>

        <div class="trade-arrow" aria-hidden="true">↓</div>

        <div class="trade-row">
          <span class="trade-label">
            {details.isTargetOut ? "You receive (exact)" : "You receive (estimated)"}
          </span>
          <span class="trade-amount">
            {details.toAmount}
            {details.toSymbol ? ` ${details.toSymbol}` : ""}
          </span>
          {#if details.toAddress}
            <!-- Full address — NEVER truncated -->
            <span class="trade-address" title="Token contract address">
              {details.toAddress}
            </span>
          {/if}
        </div>

        {#if details.gasCostEth && Number(details.gasCostEth) > 0}
          <div class="detail-row">
            <span class="detail-label">Estimated Gas</span>
            <span class="detail-value">{details.gasCostEth} ETH</span>
          </div>
        {/if}

        {#if details.routerAddress}
          <div class="detail-row">
            <span class="detail-label">Router</span>
            <!-- Full address — NEVER truncated -->
            <span class="detail-value router-address">{details.routerAddress}</span>
          </div>
        {/if}

        <div class="detail-row">
          <span class="detail-label">Via</span>
          <span class="detail-value">{data.routerName}</span>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-cancel" onclick={handleCancel}> Cancel </button>
        <button type="button" class="btn-confirm" onclick={handleConfirm}> Confirm Swap </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .modal-content {
    background: var(--bg, #fff);
    border: 2px solid var(--border, #333);
    padding: 1.5rem;
    min-width: 300px;
    max-width: 480px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .modal-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    line-height: 1;
    color: var(--text, #333);
    border-radius: 2px;
  }

  .close-btn:hover {
    background: var(--bg-hover, #eee);
  }

  .close-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .trade-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.75rem;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-light, #ddd);
  }

  .trade-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
  }

  .trade-amount {
    font-size: 1.25rem;
    font-weight: 700;
    font-family: monospace;
  }

  .trade-address {
    font-size: 0.7rem;
    font-family: monospace;
    color: var(--text-muted, #666);
    word-break: break-all;
  }

  .trade-arrow {
    text-align: center;
    font-size: 1.2rem;
    color: var(--text-muted, #666);
  }

  .detail-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .detail-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
    white-space: nowrap;
    min-width: 5rem;
  }

  .detail-value {
    font-family: monospace;
    word-break: break-all;
  }

  .router-address {
    font-size: 0.7rem;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .btn-cancel {
    padding: 0.5rem 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: transparent;
    border: 2px solid var(--border, #333);
    color: var(--text, #333);
    transition: background 0.1s;
  }

  .btn-cancel:hover {
    background: var(--bg-hover, #eee);
  }

  .btn-cancel:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .btn-confirm {
    padding: 0.5rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--green, #007700);
    border: 2px solid var(--green, #007700);
    color: #fff;
    transition: background 0.1s;
  }

  .btn-confirm:hover {
    background: var(--green-hover, #005500);
    border-color: var(--green-hover, #005500);
  }

  .btn-confirm:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }
</style>
