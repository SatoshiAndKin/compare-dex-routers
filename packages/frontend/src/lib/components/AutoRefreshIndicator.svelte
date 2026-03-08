<script lang="ts">
  /**
   * AutoRefreshIndicator — shows countdown timer status for auto-refresh.
   * Displays:
   *   - "Refreshing in Ns" when active and counting down
   *   - "Refreshing..." when a refresh fetch is in-flight
   *   - "Auto-refresh paused" when paused (e.g. during a transaction)
   *   - Nothing when inactive
   */
  import { autoRefreshStore } from '../stores/autoRefreshStore.svelte.js';
</script>

{#if autoRefreshStore.active}
  <div class="refresh-indicator" role="status" aria-live="polite">
    <span class="refresh-countdown">
      {#if autoRefreshStore.inFlight}
        Refreshing...
      {:else if autoRefreshStore.paused}
        Auto-refresh paused
      {:else}
        Refreshing in {autoRefreshStore.countdown}s
      {/if}
    </span>
    {#if autoRefreshStore.errorMessage}
      <span class="refresh-status error">{autoRefreshStore.errorMessage}</span>
    {:else if autoRefreshStore.paused}
      <span class="refresh-status">Waiting for transaction.</span>
    {/if}
  </div>
{/if}

<style>
  .refresh-indicator {
    font-size: 0.625rem;
    color: var(--text-muted, #666);
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-light, #e0e0e0);
    border-left: 4px solid var(--accent, #0055ff);
    background: var(--bg-muted, #f0f0f0);
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .refresh-countdown {
    font-family: monospace;
  }

  .refresh-status {
    font-style: italic;
    color: var(--text-muted, #666);
    font-size: 0.625rem;
  }

  .refresh-status.error {
    color: var(--red, #cc0000);
    font-weight: 600;
    font-style: normal;
  }
</style>
