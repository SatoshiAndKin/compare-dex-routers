<script lang="ts">
  /**
   * CompareForm — container assembling all form components.
   * Calls the comparison API and updates the comparison store on submit.
   */
  import { configStore } from "../stores/configStore.svelte.js";
  import { formStore } from "../stores/formStore.svelte.js";
  import { comparisonStore, type CompareParams } from "../stores/comparisonStore.svelte.js";
  import { updateUrl } from "../stores/urlSync.svelte.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  import { autoRefreshStore, AUTO_REFRESH_SECONDS } from "../stores/autoRefreshStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import { onDestroy, untrack } from "svelte";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import ChainSelector from "./ChainSelector.svelte";
  import TokenInput from "./TokenInput.svelte";
  import AmountFields from "./AmountFields.svelte";
  import SlippagePresets from "./SlippagePresets.svelte";
  import AutoRefreshIndicator from "./AutoRefreshIndicator.svelte";

  const AUTO_COMPARE_DELAY_MS = 600;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let wasBusy = false;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function currentParams(): CompareParams | null {
    const chainId = formStore.chainId;
    const from = formStore.fromToken?.address;
    const to = formStore.toToken?.address;
    const amount = formStore.mode === "exactIn" ? formStore.sellAmount : formStore.receiveAmount;
    const sender = walletStore.address ?? undefined;
    const slippageBps = formStore.slippageBps;
    const mode = formStore.mode;
    if (
      configStore.flags.compare_endpoint === false ||
      !formStore.canSubmit ||
      !from ||
      !to ||
      !amount
    )
      return null;
    return { chainId, from, to, amount, sender, slippageBps, mode };
  }

  $effect(() => {
    const params = currentParams();
    const walletChain = walletStore.chainId;
    const provider = walletStore.provider;
    // Wallet state is part of the execution context even when the form chain stays fixed.
    void walletChain;
    void provider;
    untrack(() => {
      generation++;
      clearTimer();
      transactionStore.cancelSwap();
      comparisonStore.invalidate();
      autoRefreshStore.stop();
      if (params)
        timer = setTimeout(() => {
          void runCompare(params, generation);
        }, AUTO_COMPARE_DELAY_MS);
    });
    return clearTimer;
  });

  $effect(() => {
    const busy = transactionStore.busy;
    if (wasBusy && !busy)
      untrack(() => {
        clearTimer();
        const params = currentParams();
        if (params) void runCompare(params, generation);
      });
    wasBusy = busy;
  });

  onDestroy(() => {
    generation++;
    clearTimer();
    comparisonStore.invalidate();
    autoRefreshStore.stop();
    transactionStore.cancelSwap();
  });

  async function runCompare(params: CompareParams, epoch: number): Promise<void> {
    if (epoch !== generation || transactionStore.busy) return;
    autoRefreshStore.stop();
    updateUrl(params);
    preferencesStore.saveForChain(params.chainId);
    await comparisonStore.compare(params);
    if (epoch !== generation || transactionStore.busy) return;
    autoRefreshStore.start(AUTO_REFRESH_SECONDS, () => {
      const current = currentParams();
      if (current) void runCompare(current, epoch);
    });
    if (!comparisonStore.spandexResult && !comparisonStore.curveResult) {
      autoRefreshStore.setErrorMessage("Quote request failed. The next refresh will retry.");
    }
  }

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    clearTimer();
    const params = currentParams();
    if (params) await runCompare(params, generation);
  }
</script>

<form class="compare-form" onsubmit={handleSubmit} novalidate>
  <div class="form-section">
    <span class="section-label">Chain</span>
    <ChainSelector />
  </div>

  <div class="form-section">
    <span class="section-label">From Token</span>
    <TokenInput type="from" />
    {#if walletStore.isConnected && balanceStore.fromBalance !== null}
      <span class="balance-display" aria-label="From token balance">
        Balance: {balanceStore.fromBalance}
        {formStore.fromToken?.symbol ?? ""}
      </span>
    {/if}
  </div>

  <div class="form-section">
    <span class="section-label">To Token</span>
    <TokenInput type="to" />
    {#if walletStore.isConnected && balanceStore.toBalance !== null}
      <span class="balance-display" aria-label="To token balance">
        Balance: {balanceStore.toBalance}
        {formStore.toToken?.symbol ?? ""}
      </span>
    {/if}
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
      disabled={configStore.flags.compare_endpoint === false ||
        !formStore.canSubmit ||
        comparisonStore.isLoading ||
        transactionStore.busy}
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
</style>
