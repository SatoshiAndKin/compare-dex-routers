<script lang="ts">
  /**
   * QuoteCard — displays a single router's quote result.
   * Shows loading skeleton, error state, or full quote details.
   * Includes Approve and Swap transaction buttons when a quote is available.
   */
  import { untrack } from "svelte";
  import type { Quote } from "../stores/comparisonStore.svelte.js";
  import QuoteDetails from "./QuoteDetails.svelte";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";

  interface Props {
    provider: "spandex" | "curve";
    quote?: Quote | null;
    error?: string | null;
    loading?: boolean;
    isRecommended?: boolean;
    gasPriceGwei?: string | null;
  }

  let {
    provider,
    quote = null,
    error = null,
    loading = false,
    isRecommended = false,
    gasPriceGwei = null,
  }: Props = $props();

  const providerName = $derived(
    provider === "spandex"
      ? `Spandex${(quote as Quote)?.provider ? " / " + (quote as Quote).provider : ""}`
      : "Curve"
  );

  const isTargetOut = $derived(quote?.mode === "targetOut");
  const primaryAmount = $derived(isTargetOut ? quote?.input_amount : quote?.output_amount);
  const primarySymbol = $derived(isTargetOut ? quote?.from_symbol : quote?.to_symbol);
  const primaryLabel = $derived(isTargetOut ? "You pay (required)" : "You receive (estimated)");
  const hasGasCost = $derived(
    Boolean(quote?.gas_cost_native) && Number(quote?.gas_cost_native) > 0
  );

  // ---------------------------------------------------------------------------
  // Transaction state
  // ---------------------------------------------------------------------------

  /** Router name key used in transactionStore status records */
  const routerName = $derived(provider === "spandex" ? "spandex" : "curve");

  const needsApproval = $derived(Boolean(quote?.execution?.approval));
  const canSwap = $derived(Boolean(quote?.execution));
  const validContext = $derived(quote !== null && transactionStore.matches(quote));
  const approveStatus = $derived(quote ? transactionStore.getApproveStatus(quote) : "idle");
  const swapStatus = $derived(quote ? transactionStore.getSwapStatus(quote) : "idle");
  const approvePending = $derived(approveStatus === "pending");
  const swapPending = $derived(swapStatus === "pending");
  const approveConfirmed = $derived(approveStatus === "confirmed");

  $effect(() => {
    const currentQuote = quote;
    const account = walletStore.address;
    const chainId = walletStore.chainId;
    void account;
    void chainId;
    if (currentQuote)
      untrack(() => {
        void transactionStore.refreshAllowance(currentQuote);
      });
  });

  function handleApprove(): void {
    if (!quote) return;
    void transactionStore.approve(routerName, quote);
  }

  function handleSwap(): void {
    if (!quote) return;
    void transactionStore.swap(routerName, quote);
  }
</script>

<div
  class="quote-card"
  class:winner={isRecommended}
  class:alternative={!isRecommended && !loading && !error}
>
  {#if loading}
    <!-- Loading skeleton -->
    <div class="quote-loading" aria-busy="true" aria-label="Loading {provider} quote...">
      <div class="loading-badge">Loading...</div>
      <div class="loading-amount"></div>
      <div class="loading-provider">Querying {provider === "spandex" ? "Spandex" : "Curve"}...</div>
    </div>
  {:else if error}
    <!-- Error state -->
    <div class="quote-error" role="alert">
      <div class="provider-label">{provider === "spandex" ? "Spandex" : "Curve"}</div>
      <div class="error-message">{error}</div>
    </div>
  {:else if quote}
    <!-- Quote result -->
    <div class="quote-result">
      <!-- Recommendation badge -->
      <span
        class="recommendation-badge"
        class:winner-badge={isRecommended}
        class:alt-badge={!isRecommended}
      >
        {isRecommended ? "RECOMMENDED" : "ALTERNATIVE"}
      </span>

      <!-- Primary output -->
      <div class="output-label">{primaryLabel}</div>
      <div class="output-amount">
        {primaryAmount ?? ""}
        {primarySymbol ? ` ${primarySymbol}` : ""}
      </div>

      <!-- Provider info -->
      <div class="provider-info">Via {providerName}</div>

      <!-- Gas cost -->
      {#if hasGasCost}
        <div class="gas-info">
          <span class="gas-label">Gas Cost</span>
          <span class="gas-value">{quote.gas_cost_native} {quote.native_currency}</span>
        </div>
      {/if}
      {#if gasPriceGwei}
        <div class="gas-info">
          <span class="gas-label">Gas Price</span>
          <span class="gas-value">{gasPriceGwei} gwei</span>
        </div>
      {/if}

      <!-- Expandable details -->
      <QuoteDetails {quote} {gasPriceGwei} />

      {#if !quote.execution}
        <div class="tx-actions">
          {#if !walletStore.isConnected}
            <button type="button" class="tx-btn" onclick={() => walletStore.requestMenu()}
              >Connect wallet</button
            >
          {/if}
          <span>Preview only. Connect your wallet and review a fresh quote before swapping.</span>
        </div>
      {/if}

      <!-- Transaction actions -->
      {#if needsApproval || canSwap}
        <div class="tx-actions">
          {#if needsApproval}
            <button
              type="button"
              class="tx-btn approve-btn"
              class:confirmed={approveConfirmed}
              disabled={transactionStore.busy ||
                !validContext ||
                approvePending ||
                approveConfirmed}
              aria-label={approveConfirmed
                ? "Already approved"
                : approvePending
                  ? "Approving..."
                  : walletStore.isConnected
                    ? "Approve token spending"
                    : "Connect wallet to approve"}
              onclick={handleApprove}
            >
              {#if approveConfirmed}
                Approved ✓
              {:else if approvePending}
                Approving...
              {:else}
                Approve
              {/if}
            </button>
          {/if}

          {#if canSwap}
            <button
              type="button"
              class="tx-btn swap-btn"
              disabled={transactionStore.busy ||
                !validContext ||
                (needsApproval && !approveConfirmed) ||
                swapPending}
              aria-label={swapPending
                ? "Swap in progress..."
                : walletStore.isConnected
                  ? "Execute swap"
                  : "Connect wallet to swap"}
              onclick={handleSwap}
            >
              {#if swapPending}
                Swapping...
              {:else}
                Swap
              {/if}
            </button>
          {/if}

          <!-- Transaction status indicator -->
          {#if approveStatus === "failed"}
            <span class="tx-status error" role="alert">Approve failed</span>
          {:else if swapStatus === "confirmed"}
            <span class="tx-status success" role="status">Swap confirmed ✓</span>
          {:else if swapStatus === "failed"}
            <span class="tx-status error" role="alert">Swap failed</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .quote-card {
    border: 2px solid var(--border, #000);
    background: var(--bg-card, #fff);
    padding: 1rem;
  }

  .quote-card.winner {
    border-color: var(--success-text, #007700);
    border-width: 3px;
  }

  .quote-card.alternative {
    border-color: var(--border-light, #e0e0e0);
  }

  /* Loading state */
  .quote-loading {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .loading-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-muted, #f0f0f0);
    color: var(--text-muted, #666);
    border: 1px solid var(--border-light, #e0e0e0);
  }

  .loading-amount {
    height: 1.5rem;
    background: var(--bg-muted, #f0f0f0);
    width: 60%;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .loading-provider {
    font-size: 0.875rem;
    color: var(--text-muted, #666);
    font-style: italic;
  }

  /* Error state */
  .quote-error {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .error-message {
    font-size: 0.875rem;
    color: var(--red, #cc0000);
    background: var(--bg-muted, #f0f0f0);
    border: 1px solid var(--red, #cc0000);
    border-left: 4px solid var(--red, #cc0000);
    padding: 0.5rem 0.75rem;
    word-break: break-word;
  }

  /* Quote result */
  .quote-result {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .recommendation-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .winner-badge {
    background: var(--green, #007700);
    color: #fff;
  }

  .alt-badge {
    background: var(--border-light, #e0e0e0);
    color: var(--text-muted, #666);
  }

  .output-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
    margin-top: 0.25rem;
  }

  .output-amount {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: monospace;
    line-height: 1.2;
  }

  .provider-info {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-top: 0.125rem;
  }

  .gas-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .gas-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
  }

  .gas-value {
    font-family: monospace;
    font-weight: 600;
  }

  .provider-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
  }

  /* Transaction action area */
  .tx-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-light, #e0e0e0);
  }

  .tx-btn {
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border: 2px solid var(--accent, #0055ff);
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    transition: background 0.1s;
  }

  .tx-btn:hover:not(:disabled) {
    background: var(--accent-hover, #0046cc);
    border-color: var(--accent-hover, #0046cc);
  }

  .tx-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .tx-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .approve-btn.confirmed {
    color: #fff;
    background: var(--green, #007700);
    border-color: var(--success-text, #007700);
  }

  .tx-status {
    font-size: 0.78rem;
    font-weight: 600;
  }

  .tx-status.success {
    color: var(--success-text, #007700);
  }

  .tx-status.error {
    color: var(--red, #cc0000);
  }
</style>
