<script lang="ts">
  /**
   * CompareForm — container assembling all form components.
   * Calls the comparison API and updates the comparison store on submit.
   */
  import { formStore } from '../stores/formStore.svelte.js';
  import { comparisonStore, type CompareParams } from '../stores/comparisonStore.svelte.js';
  import { updateUrl } from '../stores/urlSync.svelte.js';
  import { preferencesStore } from '../stores/preferencesStore.svelte.js';
  import { autoRefreshStore, AUTO_REFRESH_SECONDS } from '../stores/autoRefreshStore.svelte.js';
  import { walletStore } from '../stores/walletStore.svelte.js';
  import { balanceStore } from '../stores/balanceStore.svelte.js';
  import ChainSelector from './ChainSelector.svelte';
  import TokenInput from './TokenInput.svelte';
  import AmountFields from './AmountFields.svelte';
  import SlippagePresets from './SlippagePresets.svelte';
  import AutoRefreshIndicator from './AutoRefreshIndicator.svelte';

  // ---------------------------------------------------------------------------
  // Auto-refresh helpers
  // ---------------------------------------------------------------------------

  /** Run comparison with the given params (used by both submit and auto-refresh) */
  async function runCompare(params: CompareParams): Promise<void> {
    autoRefreshStore.setInFlight(true);

    await comparisonStore.compare(params);

    autoRefreshStore.setInFlight(false);

    const hasResults =
      comparisonStore.spandexResult !== null || comparisonStore.curveResult !== null;

    if (hasResults) {
      const capturedParams = { ...params };
      autoRefreshStore.reset(AUTO_REFRESH_SECONDS, () => {
        void runAutoRefresh(capturedParams);
      });
    } else {
      // Both failed — stop auto-refresh
      autoRefreshStore.stop();
    }
  }

  /** Auto-refresh cycle: re-run compare with last known good params */
  async function runAutoRefresh(params: CompareParams): Promise<void> {
    autoRefreshStore.setInFlight(true);

    await comparisonStore.compare(params);

    autoRefreshStore.setInFlight(false);

    const hasResults =
      comparisonStore.spandexResult !== null || comparisonStore.curveResult !== null;

    if (hasResults) {
      // Restart countdown with updated params
      const capturedParams = { ...params };
      autoRefreshStore.reset(AUTO_REFRESH_SECONDS, () => {
        void runAutoRefresh(capturedParams);
      });
    } else {
      autoRefreshStore.setErrorMessage('Refresh failed. Keeping previous quotes.');
      // Restart countdown despite error (matching original behavior)
      const capturedParams = { ...params };
      autoRefreshStore.reset(AUTO_REFRESH_SECONDS, () => {
        void runAutoRefresh(capturedParams);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (!formStore.canSubmit) return;

    const from = formStore.fromToken?.address;
    const to = formStore.toToken?.address;
    const amount =
      formStore.mode === 'exactIn' ? formStore.sellAmount : formStore.receiveAmount;

    if (!from || !to || !amount) return;

    const params: CompareParams = {
      chainId: formStore.chainId,
      from,
      to,
      amount,
      slippageBps: formStore.slippageBps,
      mode: formStore.mode,
    };

    // Stop any existing auto-refresh before starting a new comparison
    autoRefreshStore.stop();

    // Update URL before compare so it's shareable immediately
    updateUrl(params);

    await runCompare(params);

    // Save preferences to localStorage after compare completes
    preferencesStore.saveForChain(formStore.chainId);
  }
</script>

<form class="compare-form" onsubmit={handleSubmit} novalidate>
  <div class="form-section">
    <span class="section-label">Chain</span>
    <ChainSelector />
  </div>

  <div class="form-section form-row">
    <div class="form-col">
      <span class="section-label">From Token</span>
      <TokenInput type="from" />
      {#if walletStore.isConnected && balanceStore.fromBalance !== null}
        <span class="balance-display" aria-label="From token balance">
          Balance: {balanceStore.fromBalance}
          {formStore.fromToken?.symbol ?? ''}
        </span>
      {/if}
    </div>
    <div class="form-col">
      <span class="section-label">To Token</span>
      <TokenInput type="to" />
      {#if walletStore.isConnected && balanceStore.toBalance !== null}
        <span class="balance-display" aria-label="To token balance">
          Balance: {balanceStore.toBalance}
          {formStore.toToken?.symbol ?? ''}
        </span>
      {/if}
    </div>
  </div>

  <div class="form-section">
    <AmountFields />
  </div>

  <div class="form-section">
    <SlippagePresets />
  </div>

  <div class="form-section">
    <button
      class="submit-btn"
      type="submit"
      disabled={!formStore.canSubmit || comparisonStore.isLoading}
      aria-busy={comparisonStore.isLoading}
    >
      {#if comparisonStore.isLoading}
        Comparing...
      {:else}
        Compare Quotes
      {/if}
    </button>
    <AutoRefreshIndicator />
  </div>
</form>

<style>
  .compare-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-row {
    flex-direction: row;
    gap: 1rem;
  }

  .form-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #666);
  }

  .submit-btn {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border: 2px solid var(--accent, #0055ff);
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    font-family: inherit;
    letter-spacing: 0.02em;
    transition: background 0.1s;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover, #0046cc);
    border-color: var(--accent-hover, #0046cc);
  }

  .submit-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .balance-display {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-top: 0.1rem;
  }

  @media (max-width: 600px) {
    .form-row {
      flex-direction: column;
    }
  }
</style>
