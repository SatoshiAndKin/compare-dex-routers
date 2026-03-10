<script lang="ts">
  /**
   * UnrecognizedTokenModal — shown when a user pastes a 0x address not found
   * in any token list. Fetches ERC-20 metadata, lets the user save to local tokens.
   */
  import { tokenListStore, type Token } from "../stores/tokenListStore.svelte.js";
  import { apiClient } from "../api.js";

  // ---------------------------------------------------------------------------
  // Internal state (per-open)
  // ---------------------------------------------------------------------------

  type MetadataState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; name: string; symbol: string; decimals: number }
    | { status: "error"; message: string };

  let metadataState = $state<MetadataState>({ status: "idle" });

  // ---------------------------------------------------------------------------
  // Reactive: open/close triggered by tokenListStore.unrecognizedModal
  // ---------------------------------------------------------------------------

  $effect(() => {
    const modal = tokenListStore.unrecognizedModal;
    if (modal !== null) {
      // Opened: start fetching metadata
      metadataState = { status: "loading" };
      fetchMetadata(modal.address, modal.chainId).catch(() => {
        // handled inside fetchMetadata
      });
    } else {
      // Closed: reset state
      metadataState = { status: "idle" };
    }
  });

  // ---------------------------------------------------------------------------
  // Fetch metadata
  // ---------------------------------------------------------------------------

  async function fetchMetadata(address: string, chainId: number): Promise<void> {
    try {
      const { data, error } = await apiClient.GET("/token-metadata", {
        params: { query: { chainId, address } },
      });

      if (error || !data) {
        const msg =
          (error as { error?: string } | undefined)?.error ?? "Failed to fetch token metadata";
        metadataState = { status: "error", message: msg };
        return;
      }

      metadataState = {
        status: "loaded",
        name: data.name ?? "",
        symbol: data.symbol ?? "",
        decimals: data.decimals ?? 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      metadataState = { status: "error", message: `Failed to fetch metadata: ${msg}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleSave(): void {
    const modal = tokenListStore.unrecognizedModal;
    if (!modal) return;
    if (metadataState.status !== "loaded") return;

    const token: Token = {
      address: modal.address,
      chainId: modal.chainId,
      name: metadataState.name,
      symbol: metadataState.symbol,
      decimals: metadataState.decimals,
    };

    tokenListStore.addLocalToken(token);
    tokenListStore.unrecognizedModal = null;
  }

  function handleCancel(): void {
    tokenListStore.unrecognizedModal = null;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") handleCancel();
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let modal = $derived(tokenListStore.unrecognizedModal);
  let canSave = $derived(metadataState.status === "loaded");
</script>

{#if modal !== null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="unrecognized-token-title"
    onkeydown={handleKeydown}
  >
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="unrecognized-token-title" class="modal-title">Unrecognized Token</h2>
        <button type="button" class="modal-close" aria-label="Cancel" onclick={handleCancel}>
          ×
        </button>
      </div>

      <div class="modal-body">
        <div class="modal-address-row">
          <span class="modal-label">Address</span>
          <span class="modal-address">{modal.address}</span>
        </div>

        {#if metadataState.status === "loading"}
          <div class="modal-loading" aria-live="polite">Loading token metadata…</div>
        {:else if metadataState.status === "error"}
          <div class="modal-error" role="alert">
            {metadataState.message}
          </div>
        {:else if metadataState.status === "loaded"}
          <dl class="modal-metadata">
            <div class="metadata-row">
              <dt>Name</dt>
              <dd>{metadataState.name}</dd>
            </div>
            <div class="metadata-row">
              <dt>Symbol</dt>
              <dd>{metadataState.symbol}</dd>
            </div>
            <div class="metadata-row">
              <dt>Decimals</dt>
              <dd>{metadataState.decimals}</dd>
            </div>
          </dl>
        {/if}
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick={handleCancel}>Cancel</button>
        <button type="button" class="btn-primary" disabled={!canSave} onclick={handleSave}>
          Save to My Tokens
        </button>
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
    z-index: 200;
  }

  .modal-card {
    background: var(--bg-card, #fff);
    border: 2px solid var(--border, #000);
    padding: 1.5rem;
    min-width: 340px;
    max-width: 480px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
    color: var(--text, #000);
  }

  .modal-address-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .modal-label {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .modal-address {
    font-family: monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .modal-loading {
    color: var(--text-muted, #666);
    font-size: 0.9rem;
  }

  .modal-error {
    color: var(--error, #c00);
    font-size: 0.9rem;
  }

  .modal-metadata {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
  }

  .metadata-row {
    display: flex;
    gap: 0.75rem;
  }

  .metadata-row dt {
    font-weight: 600;
    min-width: 80px;
    font-size: 0.9rem;
  }

  .metadata-row dd {
    margin: 0;
    font-size: 0.9rem;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .btn-primary {
    padding: 0.5rem 1rem;
    background: var(--accent, #0055ff);
    color: var(--accent-fg, #fff);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.9rem;
    font-family: inherit;
  }
</style>
