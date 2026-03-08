<script lang="ts">
  /**
   * MevModal — MEV protection information modal.
   *
   * Shows chain-specific MEV protection messaging:
   *  - Ethereum: Flashbots Protect explanation + "Add to Wallet" button
   *  - BSC: bloXroute Protect
   *  - L2s (Base, Arbitrum, Optimism): sequencer note
   *  - Other: generic note
   *  - Non-Ethereum in "simple" mode: "MEV protection is only available on Ethereum"
   *
   * Ported from src/client/modals.ts `renderMevChainContent()`.
   * - Escape key closes
   * - Backdrop click closes
   * - Body scroll locked while open
   * - Focus returned to opener on close
   */
  import { settingsStore } from '../stores/settingsStore.svelte.js';
  import { formStore } from '../stores/formStore.svelte.js';
  import { walletStore } from '../stores/walletStore.svelte.js';

  // ---------------------------------------------------------------------------
  // Chain ID constants (from src/client/config.ts)
  // ---------------------------------------------------------------------------

  const ETHEREUM_CHAIN_ID = 1;
  const BSC_CHAIN_ID = 56;
  const BASE_CHAIN_ID = 8453;
  const ARBITRUM_CHAIN_ID = 42161;
  const OPTIMISM_CHAIN_ID = 10;
  const POLYGON_CHAIN_ID = 137;
  const AVALANCHE_CHAIN_ID = 43114;

  const FLASHBOTS_RPC_URL = 'https://rpc.flashbots.net';
  const BLOXROUTE_BSC_RPC_URL = 'https://bsc.rpc.blxrbdn.com';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let closeButtonEl = $state<HTMLButtonElement | null>(null);
  let addNetworkError = $state('');

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let chainId = $derived(formStore.chainId);
  let walletDisabled = $derived(!walletStore.isConnected);

  // ---------------------------------------------------------------------------
  // Body scroll lock
  // ---------------------------------------------------------------------------

  $effect(() => {
    if (settingsStore.isMevModalOpen && typeof document !== 'undefined') {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  });

  // Focus close button when modal opens
  $effect(() => {
    if (settingsStore.isMevModalOpen) {
      addNetworkError = '';
      closeButtonEl?.focus();
    }
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleClose(): void {
    settingsStore.closeMevModal();
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) handleClose();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') handleClose();
  }

  async function handleAddToWallet(type: 'ethereum' | 'bsc'): Promise<void> {
    addNetworkError = '';
    const provider = walletStore.provider;
    if (!provider) return;

    const networkConfig =
      type === 'ethereum'
        ? {
            chainId: '0x1',
            chainName: 'Ethereum (Flashbots Protect)',
            rpcUrls: [FLASHBOTS_RPC_URL],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            blockExplorerUrls: ['https://etherscan.io'],
          }
        : {
            chainId: '0x38',
            chainName: 'BSC (bloXroute Protect)',
            rpcUrls: [BLOXROUTE_BSC_RPC_URL],
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            blockExplorerUrls: ['https://bscscan.com'],
          };

    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [networkConfig],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addNetworkError = `Failed to add network: ${msg}`;
    }
  }
</script>

{#if settingsStore.isMevModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mev-modal-title"
      onkeydown={handleKeydown}
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="mev-modal-title" class="modal-title">MEV Protection</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close MEV modal"
          onclick={handleClose}
          bind:this={closeButtonEl}
        >
          ×
        </button>
      </div>

      <div class="modal-body">
        {#if chainId === ETHEREUM_CHAIN_ID}
          <!-- Ethereum: Flashbots Protect -->
          <div class="mev-chain-message ethereum">
            <div class="mev-chain-title">Ethereum Mainnet</div>
            <p class="modal-text">
              Your swap is vulnerable to sandwich attacks. Add Flashbots Protect to send
              transactions privately.
            </p>
            <button
              type="button"
              class="add-to-wallet-btn"
              disabled={walletDisabled}
              onclick={() => void handleAddToWallet('ethereum')}
            >
              Add Flashbots Protect to Wallet
            </button>
            {#if walletDisabled}
              <p class="wallet-required-note">Connect wallet first</p>
            {/if}
          </div>
        {:else if chainId === BSC_CHAIN_ID}
          <!-- BSC: bloXroute -->
          <div class="mev-chain-message bsc">
            <div class="mev-chain-title">BSC (BNB Chain)</div>
            <p class="modal-text">
              BSC has active MEV bots. Add bloXroute BSC Protect for private transaction
              submission.
            </p>
            <button
              type="button"
              class="add-to-wallet-btn"
              disabled={walletDisabled}
              onclick={() => void handleAddToWallet('bsc')}
            >
              Add bloXroute Protect to Wallet
            </button>
            {#if walletDisabled}
              <p class="wallet-required-note">Connect wallet first</p>
            {/if}
          </div>
        {:else if chainId === BASE_CHAIN_ID || chainId === ARBITRUM_CHAIN_ID || chainId === OPTIMISM_CHAIN_ID}
          <!-- L2: sequencer message -->
          {@const chainName =
            chainId === BASE_CHAIN_ID
              ? 'Base'
              : chainId === ARBITRUM_CHAIN_ID
                ? 'Arbitrum'
                : 'Optimism'}
          <div class="mev-chain-message l2">
            <div class="mev-chain-title">{chainName} (L2)</div>
            <p class="modal-text">
              This chain uses a centralized sequencer that processes transactions in order
              received. Sandwich attacks are significantly harder. No additional protection
              needed.
            </p>
          </div>
        {:else if chainId === POLYGON_CHAIN_ID || chainId === AVALANCHE_CHAIN_ID}
          <!-- Polygon / Avalanche -->
          {@const chainName = chainId === POLYGON_CHAIN_ID ? 'Polygon' : 'Avalanche'}
          <div class="mev-chain-message other">
            <div class="mev-chain-title">{chainName}</div>
            <p class="modal-text">
              MEV protection is useful on this chain but no free public protection RPC is
              currently available.
            </p>
          </div>
        {:else}
          <!-- Unknown / not Ethereum -->
          <div class="mev-chain-message other">
            <div class="mev-chain-title">Unknown Chain</div>
            <p class="modal-text">
              MEV protection availability varies by chain. Check if your wallet supports private
              transaction submission.
            </p>
          </div>
        {/if}

        {#if addNetworkError}
          <p class="add-network-error" role="alert">{addNetworkError}</p>
        {/if}

        {#if chainId !== ETHEREUM_CHAIN_ID}
          <p class="ethereum-only-note">
            MEV protection is only available on Ethereum when using this app's built-in routing.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--modal-overlay, rgba(0, 0, 0, 0.7));
    display: flex;
    justify-content: center;
    align-items: flex-start;
    overflow-y: auto;
    z-index: 1100;
  }

  .modal {
    background: var(--bg-card, #fff);
    border: 4px solid var(--border, #000);
    max-width: 500px;
    width: 100%;
    margin: 2rem auto;
    position: relative;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--border, #000);
    color: var(--bg, #fff);
  }

  .modal-title {
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .modal-close {
    background: transparent;
    border: none;
    color: var(--bg, #fff);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .modal-close:hover {
    background: var(--bg-hover, #eee);
    color: var(--text, #000);
  }

  .modal-close:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .modal-body {
    padding: 1rem;
  }

  .mev-chain-message {
    border: 2px solid var(--border, #000);
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--bg-muted, #f0f0f0);
  }

  .mev-chain-message.ethereum {
    border-color: var(--accent, #0055ff);
  }

  .mev-chain-message.bsc {
    border-color: #f0b90b;
  }

  .mev-chain-message.l2 {
    border-color: var(--text-muted, #666);
  }

  .mev-chain-message.other {
    border-color: var(--text-muted, #666);
  }

  .mev-chain-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .modal-text {
    font-size: 0.875rem;
    line-height: 1.6;
    margin-bottom: 0.75rem;
    color: var(--text, #000);
  }

  .add-to-wallet-btn {
    display: block;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border: 2px solid var(--border, #000);
  }

  .add-to-wallet-btn:hover {
    background: var(--accent-hover, #0046cc);
  }

  .add-to-wallet-btn:disabled {
    background: var(--bg-muted, #f0f0f0);
    color: var(--text-muted, #666);
    cursor: not-allowed;
  }

  .add-to-wallet-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }

  .wallet-required-note {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    font-style: italic;
    margin-top: 0.25rem;
  }

  .add-network-error {
    font-size: 0.8rem;
    color: var(--red, #cc0000);
    margin-top: 0.5rem;
  }

  .ethereum-only-note {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
    margin-top: 0.5rem;
    font-style: italic;
  }

  @media (max-width: 424px) {
    .modal {
      margin: 0;
      min-height: 100vh;
    }
  }
</style>
