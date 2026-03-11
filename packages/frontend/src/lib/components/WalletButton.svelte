<script lang="ts">
  /**
   * WalletButton — shows "Connect Wallet" when disconnected,
   * or wallet info + address + disconnect button when connected.
   * Full 0x addresses are always shown — never truncated.
   */
  import { walletStore } from "../stores/walletStore.svelte.js";

  interface Props {
    /** Called when the connect button is clicked (to open provider menu) */
    onConnectClick?: () => void;
  }

  const { onConnectClick }: Props = $props();
</script>

<div class="wallet-area">
  {#if walletStore.isConnected}
    <div class="wallet-connected" role="status" aria-label="Wallet connected">
      {#if walletStore.walletInfo?.icon}
        <img
          class="wallet-icon"
          src={walletStore.walletInfo.icon}
          alt="{walletStore.walletInfo.name ?? 'Wallet'} icon"
          onerror={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      {/if}
      <span class="wallet-name">{walletStore.walletInfo?.name ?? "Wallet"}</span>
      <button
        type="button"
        class="disconnect-btn"
        onclick={() => walletStore.disconnect()}
        aria-label="Disconnect"
      >
        Disconnect
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="connect-btn"
      onclick={onConnectClick}
      disabled={walletStore.isConnecting}
      aria-label={walletStore.isConnecting ? "Connecting wallet..." : "Connect wallet"}
    >
      {walletStore.isConnecting ? "Connecting..." : "Connect Wallet"}
    </button>
  {/if}
</div>
{#if walletStore.isConnected && walletStore.address}
  <div class="wallet-address-row">
    <span class="wallet-address" title="Connected wallet address"
      >{walletStore.ensName ?? walletStore.address}</span
    >
    {#if walletStore.ensName}
      <span class="wallet-address-raw">{walletStore.address}</span>
    {/if}
  </div>
{/if}
{#if walletStore.message}
  <p class="wallet-message" class:error={walletStore.messageIsError} role="status">
    {walletStore.message}
  </p>
{/if}

<style>
  .wallet-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }

  .wallet-connected {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .wallet-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .wallet-name {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .wallet-address-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
  }

  .wallet-address {
    font-family: monospace;
    font-size: clamp(0.625rem, 1.5vw, 0.75rem);
    word-break: break-all;
    color: var(--text-muted, #666);
    text-align: right;
  }

  .wallet-address-raw {
    font-family: monospace;
    font-size: clamp(0.625rem, 1.25vw, 0.625rem);
    word-break: break-all;
    color: var(--text-muted, #666);
    opacity: 0.7;
    text-align: right;
  }

  .connect-btn {
    height: 44px;
    padding: 0 0.9rem;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border: 2px solid var(--accent, #0055ff);
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    transition: background 0.1s;
    white-space: nowrap;
  }

  .connect-btn:hover:not(:disabled) {
    background: var(--accent-hover, #0046cc);
    border-color: var(--accent-hover, #0046cc);
  }

  .connect-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disconnect-btn {
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--text-muted, #666);
    color: var(--text-muted, #666);
    transition: background 0.1s;
  }

  .disconnect-btn:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }

  .disconnect-btn:focus {
    outline: 2px solid var(--text-muted, #666);
    outline-offset: 2px;
  }

  .wallet-message {
    font-size: 0.78rem;
    margin: 0;
    color: var(--text-muted, #666);
  }

  .wallet-message.error {
    color: var(--error, #cc0000);
  }
</style>
