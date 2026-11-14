<script lang="ts">
  import { autoRefreshStore } from "../stores/autoRefreshStore.svelte.js";

  let {
    label,
    timerLabel,
    loading,
    disabled = false,
    form,
    onRefresh,
  }: {
    label: string;
    timerLabel: string;
    loading: boolean;
    disabled?: boolean;
    form?: string;
    onRefresh?: () => void;
  } = $props();
</script>

<div class="refresh-control">
  <button
    type={form ? "submit" : "button"}
    {form}
    aria-label={label}
    title={label}
    aria-disabled={loading || disabled}
    onclick={(event) => {
      if (loading || disabled) event.preventDefault();
      else onRefresh?.();
    }}
  >
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 4v5h-5m5 0a8 8 0 1 0 0 6" />
    </svg>
  </button>
  <span class="refresh-countdown" role="timer" aria-label={timerLabel}>
    {#if loading}…
    {:else if autoRefreshStore.paused}Paused
    {:else if autoRefreshStore.active}{autoRefreshStore.countdown}s
    {:else}—{/if}
  </span>
</div>

<style>
  .refresh-control {
    display: flex;
    flex: none;
    align-items: center;
    color: var(--text-muted);
  }
  button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
  }
  button:hover {
    background: var(--bg-hover);
  }
  button[aria-disabled="true"] {
    opacity: 0.5;
    cursor: default;
  }
  .refresh-countdown {
    width: 2.5rem;
    font: 0.6875rem monospace;
    text-align: center;
  }
</style>
