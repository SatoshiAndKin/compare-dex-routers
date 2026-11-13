<script lang="ts">
  import type { Quote, QuoteResponse } from "../stores/comparisonStore.svelte.js";
  import { quoteCostFields } from "../quote-costs.js";
  let { quote, basis }: { quote: Quote; basis: QuoteResponse["recommendation_basis"] } = $props();
</script>

<span class="quote-costs">
  {#each quoteCostFields(quote, basis) as [label, value] (label)}
    <span>{label}: <strong>{value}</strong></span>
  {/each}
</span>

<style>
  .quote-costs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
</style>
