<script lang="ts">
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import QuoteCard from "./QuoteCard.svelte";

  const hasFullBalance = $derived(
    comparisonStore.activeQuote !== null &&
      transactionStore.matches(comparisonStore.activeQuote) &&
      balanceStore.from.status === "ready" &&
      balanceStore.from.raw !== null &&
      balanceStore.from.raw >= BigInt(comparisonStore.activeQuote.input_amount_raw)
  );
</script>

{#if comparisonStore.hasResults}
  <div class="quote-results">
    {#if !hasFullBalance}
      <p class="price-simulation">
        Price simulations use temporary funding. They do not prove that your wallet is ready to
        swap.
      </p>
    {/if}
    {#if comparisonStore.recommendationReason}<div class="reason-box" role="status">
        {comparisonStore.recommendationReason}
      </div>{/if}
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
      />
      {#if comparisonStore.isLoading}<p role="status">Refreshing prices…</p>{/if}
    {:else if comparisonStore.isLoading}<p role="status">Loading provider prices…</p>
    {:else}<p class="quote-error" role="alert">
        {comparisonStore.selectedProvider
          ? `${comparisonStore.selectedProvider} is unavailable. Select and review another route.`
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
          onclick={() => {
            transactionStore.cancelSwap();
            comparisonStore.selectedProvider = quote.provider;
          }}
        >
          {quote.provider}{quote.provider === comparisonStore.recommendation
            ? " — Recommended"
            : ""}: {quote.input_amount}
          {quote.from_symbol} → {quote.output_amount}
          {quote.to_symbol}
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

  .provider-list {
    padding: 1rem;
    border-top: 2px solid var(--border);
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
