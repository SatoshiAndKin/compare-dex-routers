<script lang="ts">
  /**
   * SlippagePresets — slippage preset buttons and custom input.
   * Ports behavior from src/client/slippage.ts.
   */
  import { formStore } from "../stores/formStore.svelte.js";

  const PRESETS: number[] = [3, 10, 50, 100, 300];
  const MAX_SLIPPAGE_BPS = 5000; // 50% absolute max
  const WARN_SLIPPAGE_BPS = 1000; // 10% requires confirmation

  let customValue = $state("");
  let isCustomActive = $state(false);
  let slippageError = $state("");
  let pendingHighSlippage = $state<number | null>(null);

  let activePreset = $derived(
    isCustomActive ? null : (PRESETS.find((p) => p === formStore.slippageBps) ?? null)
  );

  function handlePresetClick(bps: number): void {
    formStore.slippageBps = bps;
    isCustomActive = false;
    customValue = "";
    slippageError = "";
    pendingHighSlippage = null;
  }

  function handleCustomInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    customValue = target.value;
    slippageError = "";
    pendingHighSlippage = null;
    const val = Number(customValue);

    if (customValue === "") {
      formStore.slippageBps = 50;
      isCustomActive = false;
      return;
    }

    if (!Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
      slippageError = "Enter a whole number";
      isCustomActive = true;
      return;
    }

    if (val > MAX_SLIPPAGE_BPS) {
      slippageError = `Max slippage is ${MAX_SLIPPAGE_BPS} bps (${MAX_SLIPPAGE_BPS / 100}%)`;
      isCustomActive = true;
      return;
    }

    if (val > WARN_SLIPPAGE_BPS) {
      pendingHighSlippage = Math.round(val);
      isCustomActive = true;
      return;
    }

    formStore.slippageBps = Math.round(val);
    isCustomActive = true;
  }

  function confirmHighSlippage(): void {
    if (pendingHighSlippage !== null) {
      formStore.slippageBps = pendingHighSlippage;
      pendingHighSlippage = null;
    }
  }

  function cancelHighSlippage(): void {
    pendingHighSlippage = null;
    customValue = "";
    isCustomActive = false;
  }
</script>

<div class="slippage-presets">
  <span class="slippage-label">Slippage</span>
  <div class="slippage-controls">
    <div class="slippage-buttons">
      {#each PRESETS as bps}
        <button
          class={`slippage-btn${activePreset === bps ? " active" : ""}`}
          type="button"
          data-bps={bps}
          onclick={() => handlePresetClick(bps)}
          aria-pressed={activePreset === bps}
        >
          {bps / 100}%
        </button>
      {/each}
    </div>
    <div class="slippage-custom">
      <input
        class={`slippage-custom-input${isCustomActive ? " active" : ""}${slippageError ? " error" : ""}`}
        type="number"
        min="1"
        max={MAX_SLIPPAGE_BPS}
        step="1"
        placeholder="bps"
        value={customValue}
        oninput={handleCustomInput}
        aria-label="Custom slippage in basis points"
      />
      <span class="slippage-bps-label">bps</span>
    </div>
  </div>
  {#if slippageError}
    <div class="slippage-error" role="alert">{slippageError}</div>
  {/if}
  {#if pendingHighSlippage !== null}
    <div class="slippage-warning" role="alert">
      <span
        >{pendingHighSlippage} bps ({(pendingHighSlippage / 100).toFixed(1)}%) is very high. Are you
        sure?</span
      >
      <div class="slippage-warning-actions">
        <button type="button" class="confirm-btn" onclick={confirmHighSlippage}>Yes, use it</button>
        <button type="button" class="cancel-btn" onclick={cancelHighSlippage}>Cancel</button>
      </div>
    </div>
  {/if}
  <div class="slippage-current">
    Current: <strong>{formStore.slippageBps} bps</strong> ({(formStore.slippageBps / 100).toFixed(
      2
    )}%)
  </div>
</div>

<style>
  .slippage-presets {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .slippage-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #666);
  }

  .slippage-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .slippage-buttons {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .slippage-btn {
    padding: 0.25rem 0.6rem;
    background: var(--bg-muted, #f0f0f0);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
    color: var(--text, #000);
    transition: background 0.1s;
  }

  .slippage-btn:hover {
    background: var(--bg-hover, #e0e0e0);
  }

  .slippage-btn.active {
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border-color: var(--accent, #0055ff);
  }

  .slippage-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .slippage-custom {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .slippage-custom-input {
    width: 90px;
    padding: 0.25rem 0.5rem;
    border: 2px solid var(--border, #000);
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    font-size: 0.85rem;
    font-family: inherit;
  }

  .slippage-custom-input.active {
    border-color: var(--accent, #0055ff);
  }

  .slippage-custom-input:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  /* Hide number spinners */
  .slippage-custom-input::-webkit-outer-spin-button,
  .slippage-custom-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .slippage-custom-input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .slippage-bps-label {
    font-size: 0.85rem;
    color: var(--text-muted, #666);
  }

  .slippage-custom-input.error {
    border-color: var(--red, #cc0000);
  }

  .slippage-error {
    font-size: 0.8rem;
    color: var(--red, #cc0000);
    font-weight: 600;
  }

  .slippage-warning {
    font-size: 0.8rem;
    color: var(--warning, #cc7a00);
    padding: 0.4rem 0.5rem;
    border: 2px solid var(--warning, #cc7a00);
    background: var(--warning-bg, #f0f0f0);
  }

  .slippage-warning-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .confirm-btn,
  .cancel-btn {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid var(--border, #000);
  }

  .confirm-btn {
    background: var(--warning, #cc7a00);
    color: var(--text-inverse, #fff);
    border-color: var(--warning, #cc7a00);
    font-weight: 600;
  }

  .cancel-btn {
    background: var(--bg-card, #fff);
    color: var(--text, #000);
  }

  .slippage-current {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
  }
</style>
