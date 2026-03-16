<script lang="ts">
  /**
   * QuoteResults — tab-based container showing comparison results.
   * Displays Spandex and Curve quotes progressively as they arrive.
   * The "Recommended" tab shows the winning quote; "Alternative" shows the other.
   */
  import { comparisonStore } from "../stores/comparisonStore.svelte.js";
  import QuoteCard from "./QuoteCard.svelte";

  const recommendedProvider = $derived(comparisonStore.recommendation ?? "spandex");
  const alternativeProvider = $derived(recommendedProvider === "spandex" ? "curve" : "spandex");

  function getProviderData(provider: "spandex" | "curve") {
    const isSpandex = provider === "spandex";
    return {
      quote: isSpandex ? comparisonStore.spandexResult : comparisonStore.curveResult,
      error: isSpandex ? comparisonStore.spandexError : comparisonStore.curveError,
      loading: isSpandex ? comparisonStore.spandexLoading : comparisonStore.curveLoading,
    };
  }

  const recommended = $derived(getProviderData(recommendedProvider));
  const alternative = $derived(getProviderData(alternativeProvider));

  const bothLoading = $derived(comparisonStore.spandexLoading && comparisonStore.curveLoading);

  function tabLabel(provider: "spandex" | "curve"): string {
    if (bothLoading) return "Loading...";
    return provider === "spandex" ? "Spandex" : "Curve";
  }

  const recommendedTabLabel = $derived(tabLabel(recommendedProvider));
  const alternativeTabLabel = $derived(tabLabel(alternativeProvider));

  // Hide alternative tab in single router mode (once we know)
  const showAlternativeTab = $derived(!comparisonStore.isSingleRouterMode);

  // Combined error when both fail
  const bothFailed = $derived(
    !comparisonStore.isLoading &&
      comparisonStore.spandexError !== null &&
      (comparisonStore.isSingleRouterMode || comparisonStore.curveError !== null) &&
      comparisonStore.spandexResult === null &&
      comparisonStore.curveResult === null
  );

  const combinedErrorMessage = $derived(
    bothFailed
      ? "No quotes available. " +
          (comparisonStore.spandexError ? `Spandex: ${comparisonStore.spandexError}. ` : "") +
          (comparisonStore.curveError ? `Curve: ${comparisonStore.curveError}` : "")
      : null
  );

  function setTab(tab: "recommended" | "alternative") {
    comparisonStore.activeTab = tab;
  }

  // Show recommendation reason box
  const showReason = $derived(
    comparisonStore.recommendation !== null && comparisonStore.recommendationReason !== null
  );
</script>

{#if comparisonStore.hasResults}
  <div class="quote-results">
    <!-- Tab bar -->
    <div class="tabs" role="tablist">
      <button
        type="button"
        class="tab"
        class:active={comparisonStore.activeTab === "recommended"}
        role="tab"
        aria-selected={comparisonStore.activeTab === "recommended"}
        data-tab="recommended"
        onclick={() => setTab("recommended")}
      >
        {recommendedTabLabel}
      </button>
      {#if showAlternativeTab}
        <button
          type="button"
          class="tab"
          class:active={comparisonStore.activeTab === "alternative"}
          role="tab"
          aria-selected={comparisonStore.activeTab === "alternative"}
          data-tab="alternative"
          onclick={() => setTab("alternative")}
        >
          {alternativeTabLabel}
        </button>
      {/if}
    </div>

    <!-- Recommendation reason box -->
    {#if showReason}
      <div class="reason-box" role="status">
        <div class="reason-title">Recommendation</div>
        <div class="reason-content">{comparisonStore.recommendationReason}</div>
        {#if comparisonStore.gasPriceGwei}
          <div class="reason-gas">Gas Price: {comparisonStore.gasPriceGwei} gwei</div>
        {/if}
      </div>
    {/if}

    <!-- Tab panels -->
    {#if comparisonStore.activeTab === "recommended"}
      <div class="tab-panel" role="tabpanel">
        {#if bothFailed && combinedErrorMessage}
          <div class="combined-error" role="alert">{combinedErrorMessage}</div>
        {:else}
          <QuoteCard
            provider={recommendedProvider}
            quote={recommended.quote}
            error={recommended.error}
            loading={recommended.loading}
            isRecommended={true}
            gasPriceGwei={comparisonStore.gasPriceGwei}
          />
        {/if}
      </div>
    {:else if comparisonStore.activeTab === "alternative" && showAlternativeTab}
      <div class="tab-panel" role="tabpanel">
        <QuoteCard
          provider={alternativeProvider}
          quote={alternative.quote}
          error={alternative.error}
          loading={alternative.loading}
          isRecommended={false}
          gasPriceGwei={comparisonStore.gasPriceGwei}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .quote-results {
    margin-top: 1.5rem;
    border: 2px solid var(--border, #000);
    background: var(--bg-card, #fff);
  }

  /* Tab bar */
  .tabs {
    display: flex;
    border-bottom: 2px solid var(--border, #000);
  }

  .tab {
    flex: 1;
    padding: 0.625rem 1rem;
    background: var(--bg-muted, #f0f0f0);
    color: var(--text, #000);
    border: none;
    border-right: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 700;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: background 0.1s;
  }

  .tab:last-child {
    border-right: none;
  }

  .tab:hover:not(.active) {
    background: var(--bg-hover, #e0e0e0);
  }

  .tab.active {
    background: var(--border, #000);
    color: var(--bg-card, #fff);
  }

  .tab:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: -3px;
  }

  /* Recommendation reason box */
  .reason-box {
    padding: 0.75rem 1rem;
    background: var(--bg-muted, #f0f0f0);
    border-bottom: 2px solid var(--border-light, #e0e0e0);
  }

  .reason-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #666);
    margin-bottom: 0.25rem;
  }

  .reason-content {
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .reason-gas {
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--text-muted, #666);
    margin-top: 0.25rem;
  }

  /* Tab panels */
  .tab-panel {
    padding: 1rem;
  }

  /* Combined error state */
  .combined-error {
    padding: 0.75rem;
    background: var(--bg-muted, #f0f0f0);
    border: 1px solid var(--red, #cc0000);
    border-left: 4px solid var(--red, #cc0000);
    color: var(--red, #cc0000);
    font-size: 0.875rem;
    word-break: break-word;
  }
</style>
