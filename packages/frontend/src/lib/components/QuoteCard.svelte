<script lang="ts">
  /**
   * QuoteCard — displays a single router's quote result.
   * Shows loading skeleton, error state, or full quote details.
   * Includes Approve and Swap transaction buttons when a quote is available.
   */
  import { untrack } from "svelte";
  import type { Quote, QuoteResponse } from "../stores/comparisonStore.svelte.js";
  import QuoteDetails from "./QuoteDetails.svelte";
  import QuoteCosts from "./QuoteCosts.svelte";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";

  interface Props {
    provider: string;
    quote?: Quote | null;
    error?: string | null;
    loading?: boolean;
    isRecommended?: boolean;
    gasPriceGwei?: string | null;
    recommendationBasis?: QuoteResponse["recommendation_basis"];
  }

  let {
    provider,
    quote = null,
    error = null,
    loading = false,
    isRecommended = false,
    gasPriceGwei = null,
    recommendationBasis = "none",
  }: Props = $props();

  const providerName = $derived(quote?.provider ?? provider);

  // ---------------------------------------------------------------------------
  // Transaction state
  // ---------------------------------------------------------------------------

  /** Router name key used in transactionStore status records */
  const routerName = $derived(provider);

  const needsApproval = $derived(Boolean(quote?.execution?.approval));
  const canSwap = $derived(Boolean(quote?.execution));
  const validContext = $derived(quote !== null && transactionStore.matches(quote));
  const walletCheck = $derived(quote ? transactionStore.getCheck(quote) : null);
  const approveStatus = $derived(quote ? transactionStore.getApproveStatus(quote) : "idle");
  const swapStatus = $derived(quote ? transactionStore.getSwapStatus(quote) : "idle");
  const approvePending = $derived(approveStatus === "pending");
  const swapPending = $derived(swapStatus === "pending");
  const approveConfirmed = $derived(approveStatus === "confirmed");

  $effect(() => {
    const currentQuote = quote;
    const account = walletStore.address;
    const chainId = walletStore.chainId;
    const busy = transactionStore.busy;
    void account;
    void chainId;
    if (currentQuote && !busy)
      untrack(() => {
        void transactionStore.refreshChecks(currentQuote);
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
      <div class="loading-provider">Querying {provider}...</div>
    </div>
  {:else if error}
    <!-- Error state -->
    <div class="quote-error" role="alert">
      <div class="provider-label">{provider}</div>
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
        {isRecommended ? "RECOMMENDED" : "SELECTED"}
      </span>

      <div class="provider-info">Via {providerName}</div>
      <div class="quote-amounts">
        <div>
          <div class="output-label">You pay</div>
          <div class="input-amount">{quote.input_amount} {quote.from_symbol}</div>
        </div>
        <div>
          <div class="output-label">You receive</div>
          <div class="output-amount">{quote.output_amount} {quote.to_symbol}</div>
        </div>
      </div>

      <!-- Gas cost -->
      <QuoteCosts {quote} basis={recommendationBasis} />
      <!-- Expandable details -->
      <QuoteDetails {quote} {gasPriceGwei} {recommendationBasis} />

      <div class="execution-status">
        {#if !quote.execution}
          <div class="tx-actions">
            <span>Connect your wallet to swap.</span>
          </div>
        {/if}

        {#if quote.execution && walletCheck}<p class="wallet-check" role="status">
            {walletCheck.message}
          </p>{/if}
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
                  walletCheck?.status !== "approval" ||
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
                  walletCheck?.status !== "ready" ||
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
    </div>
  {/if}
</div>

<style>
  .quote-amounts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .execution-status {
    min-height: 5rem;
  }
  .wallet-check {
    min-height: 3em;
    font-size: 0.8125rem;
  }

  .quote-card {
    border: 0;
    background: var(--bg-card, #fff);
    padding: 0.5rem 0;
  }

  .quote-card.winner {
    border: 0;
  }

  .quote-card.alternative {
    border: 0;
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
    padding: 0;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .winner-badge {
    background: transparent;
    color: var(--success-text);
  }

  .alt-badge {
    background: transparent;
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

  .input-amount,
  .output-amount {
    font-size: clamp(1rem, 2.5vw, 1.5rem);
    overflow-wrap: anywhere;
    min-height: 2.4em;
    font-weight: 700;
    font-family: monospace;
    line-height: 1.2;
  }

  .provider-info {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-top: 0.125rem;
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
    padding-top: 0;
    border-top: 0;
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
