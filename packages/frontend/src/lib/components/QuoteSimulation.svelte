<script lang="ts">
  import type { Quote } from "../stores/comparisonStore.svelte.js";
  let { quote }: { quote: Quote } = $props();
</script>

<div class="simulation-status">
  {quote.simulation_status === "succeeded"
    ? "Simulated with your wallet’s token balance."
    : `Not simulated. ${quote.simulation_reason ?? "Refresh to retry simulation."}`}
</div>

<style>
  .simulation-status {
    min-height: 3em;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
