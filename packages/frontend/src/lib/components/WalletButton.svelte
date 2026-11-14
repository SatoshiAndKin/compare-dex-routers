<script lang="ts">
  import { walletStore } from "../stores/walletStore.svelte.js";
  import TransactionLink from "./TransactionLink.svelte";

  interface Props {
    /** Called when the connect button is clicked (to open provider menu) */
    onConnectClick?: () => void;
  }

  const { onConnectClick }: Props = $props();
</script>

{#if walletStore.address}
  {@const profile = walletStore.ensProfile}
  <div class="wallet-connected">
    <div class="wallet-identity">
      {#if profile}
        <div class="ens-profile">
          {#if profile.avatar}
            {#key profile.avatar}
              <img
                class="ens-avatar"
                src={profile.avatar}
                alt=""
                width="20"
                height="20"
                referrerpolicy="no-referrer"
                onerror={(event) => event.currentTarget.setAttribute("hidden", "")}
              />
            {/key}
          {/if}
          <span class="ens-name">{profile.name}</span>
        </div>
      {/if}
      <span
        class="connected-address"
        role="status"
        aria-label="Connected wallet address"
        title="Connected wallet address">{walletStore.address}</span
      >
    </div>
    <button
      type="button"
      class="disconnect-btn"
      onclick={() => walletStore.disconnect()}
      aria-label="Disconnect"
      title="Disconnect"
    >
      ×
    </button>
  </div>
{:else}
  <button
    type="button"
    class="connect-btn"
    onclick={(event) => {
      event.currentTarget.focus();
      onConnectClick?.();
    }}
    disabled={walletStore.isConnecting}
    aria-label={walletStore.isConnecting ? "Connecting wallet..." : "Connect wallet"}
  >
    {walletStore.isConnecting ? "Connecting..." : "Connect Wallet"}
  </button>
{/if}
{#if walletStore.message}
  <div class="wallet-message" class:error={walletStore.messageIsError} role="status">
    {walletStore.message}
    {#if walletStore.messageTransaction}
      · <TransactionLink transaction={walletStore.messageTransaction} />
    {/if}
  </div>
{/if}

<style>
  .wallet-connected {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    justify-content: flex-end;
    min-width: 0;
  }

  .wallet-identity {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .ens-profile {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .ens-avatar {
    flex: none;
    object-fit: cover;
    border-radius: 50%;
  }

  .connected-address {
    display: block;
    font-family: monospace;
    font-size: 0.75rem;
    line-height: 1.2;
    color: var(--text-muted, #666);
  }

  .connect-btn {
    width: 100%;
    height: 44px;
    padding: 0 0.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border: 0;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    transition: background 0.1s;
    white-space: nowrap;
    text-transform: none;
    letter-spacing: normal;
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
    align-self: flex-start;
    flex: 0 0 2rem;
    min-height: 44px;
    padding: 0;
    font-size: 1.25rem;
    font-family: inherit;
    line-height: 1;
    cursor: pointer;
    background: transparent;
    border: 0;
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
