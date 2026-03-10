<script lang="ts">
  /**
   * WalletProviderMenu — modal for selecting a wallet provider.
   *
   * Discovers injected wallets via EIP-6963 announceProvider events.
   * Offers WalletConnect (loaded via CDN ESM — never bundled).
   * Detects Farcaster frame context and offers Farcaster SDK (CDN ESM).
   */
  import { onMount } from "svelte";
  import { walletStore, type EIP6963ProviderDetail } from "../stores/walletStore.svelte.js";

  interface Props {
    /** WalletConnect project ID from server config */
    projectId: string;
    /** Whether the menu is currently open */
    isOpen: boolean;
    /** Called when the menu should close */
    onClose: () => void;
  }

  const { projectId, isOpen, onClose }: Props = $props();

  // Farcaster frame detection: if window.parent !== window, we're inside a frame
  let isFarcasterFrame = $state(false);

  onMount(() => {
    isFarcasterFrame = typeof window !== "undefined" && window.parent !== window;
  });

  // Re-request providers each time menu opens (in case new wallets were installed)
  $effect(() => {
    if (isOpen && typeof window !== "undefined") {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }
  });

  // ---------------------------------------------------------------------------
  // Connect handlers
  // ---------------------------------------------------------------------------

  async function handleConnectInjected(detail: EIP6963ProviderDetail): Promise<void> {
    onClose();
    await walletStore.connect(detail);
  }

  async function handleConnectWalletConnect(): Promise<void> {
    onClose();
    await walletStore.connectWalletConnect(projectId);
  }

  async function handleConnectFarcaster(): Promise<void> {
    onClose();
    await walletStore.connectFarcaster();
  }

  // ---------------------------------------------------------------------------
  // Keyboard / backdrop handling
  // ---------------------------------------------------------------------------

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      onClose();
    }
  }

  // WalletConnect SVG icon (inline to avoid extra requests)
  const wcIcon =
    `data:image/svg+xml,` +
    encodeURIComponent(
      '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
        '<rect width="32" height="32" rx="6" fill="#3B99FC"/>' +
        '<path d="M10.05 12.36c3.28-3.21 8.62-3.21 11.9 0l.4.39a.41.41 0 0 1 0 .58l-1.35 1.32a.21.21 0 0 1-.3 0l-.54-.53c-2.29-2.24-6.01-2.24-8.3 0l-.58.57a.21.21 0 0 1-.3 0l-1.35-1.32a.41.41 0 0 1 0-.58l.42-.43ZM24.75 15.1l1.2 1.18a.41.41 0 0 1 0 .58l-5.43 5.31a.42.42 0 0 1-.6 0l-3.85-3.77a.1.1 0 0 0-.15 0l-3.85 3.77a.42.42 0 0 1-.6 0l-5.42-5.31a.41.41 0 0 1 0-.58l1.2-1.18a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 0 0 0 .15 0l3.85-3.77a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 0 0 0 .15 0l3.85-3.77a.42.42 0 0 1 .6 0Z" fill="#fff"/></svg>'
    );
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-label="Select wallet provider"
      onkeydown={handleKeydown}
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 class="modal-title">Connect Wallet</h2>
        <button type="button" class="close-btn" onclick={onClose} aria-label="Close wallet menu">
          ×
        </button>
      </div>

      <div class="provider-list" role="list" aria-label="Available wallet providers">
        {#each walletStore.discoveredProviders as detail (detail.info.uuid)}
          <button
            type="button"
            class="provider-option"
            onclick={() => void handleConnectInjected(detail)}
            aria-label="Connect with {detail.info.name}"
          >
            {#if detail.info.icon}
              <img
                class="provider-icon"
                src={detail.info.icon}
                alt="{detail.info.name} icon"
                onerror={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            {:else}
              <span class="provider-icon-placeholder" aria-hidden="true">🔑</span>
            {/if}
            <span class="provider-name">{detail.info.name}</span>
          </button>
        {/each}

        {#if projectId}
          <button
            type="button"
            class="provider-option"
            onclick={() => void handleConnectWalletConnect()}
            aria-label="Connect with WalletConnect"
          >
            <img class="provider-icon" src={wcIcon} alt="WalletConnect icon" />
            <span class="provider-name">WalletConnect</span>
          </button>
        {/if}

        {#if isFarcasterFrame}
          <button
            type="button"
            class="provider-option"
            onclick={() => void handleConnectFarcaster()}
            aria-label="Connect with Farcaster"
          >
            <span class="provider-icon-placeholder" aria-hidden="true">🟣</span>
            <span class="provider-name">Farcaster</span>
          </button>
        {/if}

        {#if walletStore.discoveredProviders.length === 0 && !projectId && !isFarcasterFrame}
          <p class="no-wallet-msg">
            No wallets detected. Install a browser wallet extension to get started.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--bg, #fff);
    border: 2px solid var(--border, #333);
    padding: 1.5rem;
    min-width: 300px;
    max-width: 420px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .modal-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    line-height: 1;
    color: var(--text, #333);
    border-radius: 2px;
  }

  .close-btn:hover {
    background: var(--bg-hover, #eee);
  }

  .close-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .provider-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .provider-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-light, #ddd);
    cursor: pointer;
    text-align: left;
    font-size: 1rem;
    font-family: inherit;
    font-weight: 500;
    transition: background 0.1s;
    border-radius: 2px;
  }

  .provider-option:hover {
    background: var(--bg-hover, #e8e8e8);
  }

  .provider-option:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .provider-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .provider-icon-placeholder {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    flex-shrink: 0;
  }

  .provider-name {
    font-weight: 600;
  }

  .no-wallet-msg {
    color: var(--text-muted, #666);
    font-size: 0.9rem;
    text-align: center;
    padding: 1rem;
    margin: 0;
  }
</style>
