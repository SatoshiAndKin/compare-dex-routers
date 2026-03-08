<script lang="ts">
  /**
   * SlippagePresets — slippage preset buttons and custom input.
   * Ports behavior from src/client/slippage.ts.
   */
  import { formStore } from '../stores/formStore.svelte.js';

  // ---------------------------------------------------------------------------
  // Constants (from src/client/slippage.ts — presets: 3, 10, 50, 100, 300 bps)
  // ---------------------------------------------------------------------------

  const PRESETS: number[] = [3, 10, 50, 100, 300];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let customValue = $state('');
  let isCustomActive = $state(false);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let activePreset = $derived(
    isCustomActive ? null : PRESETS.find((p) => p === formStore.slippageBps) ?? null,
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handlePresetClick(bps: number): void {
    formStore.slippageBps = bps;
    isCustomActive = false;
    customValue = '';
  }

  function handleCustomInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    customValue = target.value;
    const val = Number(customValue);
    if (customValue !== '' && Number.isFinite(val) && val > 0) {
      formStore.slippageBps = Math.round(val);
      isCustomActive = true;
    } else if (customValue === '') {
      // When cleared, revert to default preset (50 bps)
      formStore.slippageBps = 50;
      isCustomActive = false;
    } else {
      isCustomActive = true;
    }
  }
</script>

<div class="slippage-presets">
  <span class="slippage-label">Slippage</span>
  <div class="slippage-controls">
    <div class="slippage-buttons">
      {#each PRESETS as bps}
        <button
          class={`slippage-btn${activePreset === bps ? ' active' : ''}`}
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
        class={`slippage-custom-input${isCustomActive ? ' active' : ''}`}
        type="number"
        min="0"
        step="1"
        placeholder="Custom bps"
        value={customValue}
        oninput={handleCustomInput}
        aria-label="Custom slippage in basis points"
      />
      <span class="slippage-bps-label">bps</span>
    </div>
  </div>
  <div class="slippage-current">
    Current: <strong>{formStore.slippageBps} bps</strong> ({(formStore.slippageBps / 100).toFixed(
      2,
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
  .slippage-custom-input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .slippage-bps-label {
    font-size: 0.85rem;
    color: var(--text-muted, #666);
  }

  .slippage-current {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
  }
</style>
