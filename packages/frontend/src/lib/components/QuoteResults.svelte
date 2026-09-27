<script lang="ts">
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import QuoteCard from "./QuoteCard.svelte";
  import QuoteSimulation from "./QuoteSimulation.svelte";
  import QuoteCosts from "./QuoteCosts.svelte";
  import AutoRefreshIndicator from "./AutoRefreshIndicator.svelte";

  const recommendedVerified = $derived(
    comparisonStore.quotes.some(
      (quote) =>
        quote.provider === comparisonStore.recommendation && quote.simulation_status === "succeeded"
    )
  );

  function selectProvider(provider: string): void {
    if (transactionStore.busy || comparisonStore.isLoading) return;
    transactionStore.cancelSwap();
    comparisonStore.selectProvider(provider);
  }
</script>

{#if comparisonStore.hasResults}
  <div class="quote-results" aria-busy={comparisonStore.isLoading}>
    <div class="quote-status" role="status" aria-label="Quote loading status">
      {#if comparisonStore.isLoading}
        <span class="spinner" aria-hidden="true"></span>
        {comparisonStore.quotes.length ? "Refreshing quotes…" : "Loading provider prices…"}
      {:else if comparisonStore.isStale && !comparisonStore.error}
        Previous quote. Enter a valid trade to refresh.
      {:else}
        <AutoRefreshIndicator />
      {/if}
    </div>
    <div class="quote-body">
      {#if comparisonStore.activeQuote}
        <QuoteCard
          provider={comparisonStore.activeQuote.provider}
          quote={comparisonStore.activeQuote}
          error={null}
          loading={false}
          isRecommended={comparisonStore.activeQuote.provider === comparisonStore.recommendation}
          gasPriceGwei={comparisonStore.gasPriceGwei}
          recommendationBasis={comparisonStore.recommendationBasis}
          usdConversion={comparisonStore.usdConversion}
        />
      {:else}
        <div class="quote-placeholder" aria-label="Quote result">
          {#if comparisonStore.isLoading}<span>Finding your best route…</span>
          {:else}<p class="quote-error" role="alert">
              {comparisonStore.workflowProvider || comparisonStore.selectedProvider
                ? `${comparisonStore.activeProvider} is unavailable for this workflow. Select and review a route to continue.`
                : "No successful quotes. Review provider failures below."}
            </p>{/if}
        </div>
      {/if}
    </div>
    {#if comparisonStore.error}<div class="quote-error" role="alert">
        {comparisonStore.error}. Refresh quotes to retry.
      </div>{/if}
    {#if comparisonStore.recommendationBasis === "gas_adjusted"}<p class="reason-box" role="status">
        {comparisonStore.mode === "targetOut"
          ? "Ranked by estimated input cost including gas."
          : "Ranked by estimated output value after gas."}
      </p>{/if}
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
        <span
          >{recommendedVerified ? "Recommended" : "Best quoted price"}: {comparisonStore.recommendation}</span
        >
        <button
          type="button"
          disabled={transactionStore.busy || comparisonStore.isLoading}
          onclick={() => selectProvider(comparisonStore.recommendation!)}
          >{recommendedVerified ? "Use recommended route" : "Show best quoted price"}</button
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
    <details class="provider-list">
      <summary
        >Provider results and failures ({comparisonStore.quotes.length +
          comparisonStore.failures.length})</summary
      >
      {#each [true, false] as verified}
        {#if comparisonStore.quotes.some((quote) => (quote.simulation_status === "succeeded") === verified)}
          <p>{verified ? "Simulated wallet routes" : "Unverified prices"}</p>
        {/if}
        {#each comparisonStore.quotes.filter((quote) => (quote.simulation_status === "succeeded") === verified) as quote (quote.provider)}
          <button
            type="button"
            aria-label={`Select ${quote.provider}`}
            disabled={transactionStore.busy || comparisonStore.isLoading}
            aria-pressed={comparisonStore.activeProvider === quote.provider}
            onclick={() => selectProvider(quote.provider)}
          >
            {quote.provider}{quote.provider === comparisonStore.recommendation
              ? quote.simulation_status === "succeeded"
                ? " — Recommended"
                : " — Best quoted price — unverified"
              : ""}{quote.provider === comparisonStore.activeProvider ? " — Selected" : ""}: {quote.input_amount}
            {quote.from_symbol} → {quote.output_amount}
            {quote.to_symbol}
            <QuoteSimulation {quote} />
            <QuoteCosts {quote} basis={comparisonStore.recommendationBasis} />
          </button>
        {/each}
      {/each}
      {#each comparisonStore.failures as failure (failure.provider)}
        <details class="provider-failure">
          <summary>{failure.provider} — {failure.stage} failed</summary>
          <p>{failure.error.message}</p>
        </details>
      {/each}
    </details>
  </div>
{/if}

<style>
  .quote-body {
    min-height: 22rem;
  }
  .quote-placeholder {
    min-height: 22rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
  .reason-box {
    border: 0;
    background: transparent;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .quote-results {
    margin-top: 0.25rem;
    border: 0;
    background: var(--bg-card, #fff);
  }

  .quote-status {
    min-height: 2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
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
    padding: 0.5rem 0;
    border-top: 1px solid var(--border-light);
  }
  .route-choice {
    padding: 0.5rem 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .route-choice button {
    font: inherit;
    color: var(--text);
    background: var(--bg-card);
    border: 0;
    border-bottom: 1px solid var(--border-light);
    padding: 0.5rem;
    cursor: pointer;
  }
  .provider-list button {
    text-transform: none;
    letter-spacing: normal;
    line-height: 1.5;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.5rem;
    margin-top: 0.5rem;
    width: 100%;
    text-align: left;
    font: inherit;
    background: var(--bg-card);
    color: var(--text);
    border: 0;
    border-bottom: 1px solid var(--border-light);
  }
  .reason-box,
  .quote-error {
    padding: 0.5rem 0;
  }
  .provider-failure {
    overflow-wrap: anywhere;
    margin-top: 0.5rem;
  }
</style>
