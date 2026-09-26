<script lang="ts">
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";
  import { formStore } from "../stores/formStore.svelte.js";
  import QuoteCard from "./QuoteCard.svelte";
  import QuoteCosts from "./QuoteCosts.svelte";

  function selectProvider(provider: string): void {
    if (transactionStore.busy || comparisonStore.isLoading) return;
    transactionStore.cancelSwap();
    comparisonStore.selectProvider(provider);
  }

  const hasFullBalance = $derived(
    comparisonStore.activeQuote !== null &&
      walletStore.provider !== null &&
      walletStore.address?.toLowerCase() === comparisonStore.activeQuote.sender?.toLowerCase() &&
      walletStore.chainId === comparisonStore.activeQuote.chainId &&
      formStore.chainId === comparisonStore.activeQuote.chainId &&
      formStore.fromToken?.address.toLowerCase() ===
        comparisonStore.activeQuote.from.toLowerCase() &&
      balanceStore.from.status === "ready" &&
      balanceStore.from.raw !== null &&
      balanceStore.from.raw >= BigInt(comparisonStore.activeQuote.input_amount_raw)
  );
</script>

{#if comparisonStore.hasResults}
  <div class="quote-results" aria-busy={comparisonStore.isLoading}>
    <div class="quote-status" role="status" aria-label="Quote loading status">
      {#if comparisonStore.isLoading}
        <span class="spinner" aria-hidden="true"></span>
        {comparisonStore.quotes.length ? "Refreshing quotes…" : "Loading provider prices…"}
      {:else if comparisonStore.isStale && !comparisonStore.error}
        Previous quote. Enter a valid trade to refresh.
      {/if}
    </div>
    {#if !hasFullBalance}
      <p class="price-simulation">
        Price simulations use temporary funding. They do not prove that your wallet is ready to
        swap.
      </p>
    {/if}
    {#if comparisonStore.recommendationReason}<div class="reason-box" role="status">
        {comparisonStore.recommendationReason}
      </div>{/if}
    {#if comparisonStore.recommendationBasis === "raw_amount"}
      <p class="reason-box">
        Ranking by raw {comparisonStore.mode === "targetOut"
          ? "input amount (lowest first)"
          : "output amount (highest first)"}. Gas is excluded because comparable gas costs are
        unavailable.
      </p>
    {/if}
    {#if comparisonStore.recommendation && (comparisonStore.activeProvider !== comparisonStore.recommendation || comparisonStore.routeChoiceRequired)}
      <div class="route-choice">
        <span>Recommended: {comparisonStore.recommendation}</span>
        <button
          type="button"
          disabled={transactionStore.busy || comparisonStore.isLoading}
          onclick={() => selectProvider(comparisonStore.recommendation!)}
          >Use recommended route</button
        >
      </div>
    {/if}
    {#if comparisonStore.workflowProvider}
      <div class="route-choice">
        <span>Selected for approval / swap: {comparisonStore.workflowProvider}</span>
        <button
          type="button"
          disabled={transactionStore.busy}
          onclick={() => transactionStore.cancelSwap()}>Cancel route workflow</button
        >
      </div>
    {/if}
    {#if comparisonStore.error}<div class="quote-error" role="alert">
        {comparisonStore.error}. Refresh quotes to retry.
      </div>{/if}
    {#if comparisonStore.activeQuote}
      <QuoteCard
        provider={comparisonStore.activeQuote.provider}
        quote={comparisonStore.activeQuote}
        error={null}
        loading={false}
        isRecommended={comparisonStore.activeQuote.provider === comparisonStore.recommendation}
        gasPriceGwei={comparisonStore.gasPriceGwei}
        recommendationBasis={comparisonStore.recommendationBasis}
      />
    {:else if !comparisonStore.isLoading}<p class="quote-error" role="alert">
        {comparisonStore.workflowProvider || comparisonStore.selectedProvider
          ? `${comparisonStore.activeProvider} is unavailable for this workflow. Select and review a route to continue.`
          : "No successful price simulations. Review provider failures below."}
      </p>{/if}
    <details class="provider-list">
      <summary
        >Provider results and failures ({comparisonStore.quotes.length +
          comparisonStore.failures.length})</summary
      >
      {#each comparisonStore.quotes as quote (quote.provider)}
        <button
          type="button"
          aria-label={`Select ${quote.provider}`}
          disabled={transactionStore.busy || comparisonStore.isLoading}
          aria-pressed={comparisonStore.activeProvider === quote.provider}
          onclick={() => selectProvider(quote.provider)}
        >
          {quote.provider}{quote.provider === comparisonStore.recommendation
            ? " — Recommended"
            : ""}{quote.provider === comparisonStore.activeProvider ? " — Selected" : ""}: {quote.input_amount}
          {quote.from_symbol} → {quote.output_amount}
          {quote.to_symbol}
          <QuoteCosts {quote} basis={comparisonStore.recommendationBasis} />
        </button>
      {/each}
      {#each comparisonStore.failures as failure (failure.provider)}
        <div class="provider-failure">
          <strong>{failure.provider}</strong> ({failure.stage}): {failure.error.message}
        </div>
      {/each}
    </details>
  </div>
{/if}

<style>
  .quote-results {
    margin-top: 1.5rem;
    border: 2px solid var(--border, #000);
    background: var(--bg-card, #fff);
  }

  .quote-status {
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: 2px solid var(--border-light, #e0e0e0);
    border-top-color: var(--text);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  .provider-list {
    padding: 1rem;
    border-top: 2px solid var(--border);
  }
  .route-choice {
    padding: 0.75rem 1rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .route-choice button {
    font: inherit;
    color: var(--text);
    background: var(--bg-card);
    border: 1px solid var(--border);
    padding: 0.5rem;
    cursor: pointer;
  }
  .provider-list button {
    cursor: pointer;
    padding: 0.5rem;
    margin-top: 0.5rem;
    width: 100%;
    text-align: left;
    font: inherit;
    background: var(--bg-card);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .reason-box,
  .price-simulation,
  .quote-error {
    padding: 0.75rem 1rem;
  }
  .provider-failure {
    overflow-wrap: anywhere;
    margin-top: 0.5rem;
  }
</style>
