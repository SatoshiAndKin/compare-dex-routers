<script lang="ts">
  /**
   * ChainMismatchWarning — shows a warning banner when the connected wallet
   * is on a different chain than the selected form chain.
   * Offers a one-click "Switch Chain" button.
   */
  import { walletStore } from '../stores/walletStore.svelte.js';
  import { formStore } from '../stores/formStore.svelte.js';

  const CHAIN_NAMES: Readonly<Record<number, string>> = {
    1: 'Ethereum',
    10: 'Optimism',
    56: 'BSC',
    137: 'Polygon',
    8453: 'Base',
    42161: 'Arbitrum',
    43114: 'Avalanche',
  };

  function chainName(chainId: number | null): string {
    if (chainId === null) return 'Unknown';
    return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
  }

</script>

{#if walletStore.isConnected && walletStore.chainId !== null && walletStore.chainId !== formStore.chainId}
  <div class="chain-mismatch" role="alert" aria-live="polite">
    <span class="mismatch-msg">
      Wallet is on
      <strong>{chainName(walletStore.chainId)}</strong>.
      Switch to
      <strong>{chainName(formStore.chainId)}</strong>?
    </span>
    <button
      type="button"
      class="switch-btn"
      onclick={() => void walletStore.switchChain(formStore.chainId)}
    >
      Switch Chain
    </button>
  </div>
{/if}

<style>
  .chain-mismatch {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background: var(--warning-bg, #fff3cd);
    border: 1px solid var(--warning-border, #ffc107);
    color: var(--warning-text, #856404);
    font-size: 0.9rem;
    flex-wrap: wrap;
  }

  .mismatch-msg {
    flex: 1;
    min-width: 200px;
  }

  .switch-btn {
    padding: 0.25rem 0.75rem;
    background: var(--warning-border, #ffc107);
    border: 1px solid currentColor;
    color: var(--warning-text, #856404);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    border-radius: 2px;
  }

  .switch-btn:hover {
    opacity: 0.85;
  }

  .switch-btn:focus {
    outline: 2px solid var(--warning-text, #856404);
    outline-offset: 2px;
  }
</style>
