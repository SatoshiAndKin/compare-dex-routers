<script lang="ts">
  /**
   * SettingsModal — gear icon panel for app settings.
   *
   * Sections:
   *   1. Token Lists: toggle/remove existing lists, add new HTTPS list
   *   2. Local Tokens: list/remove, export/import
   *   3. MEV Protection: toggle (Ethereum only)
   *   4. Custom RPC URL: free-text input
   *
   * - Body scroll locked while open
   * - Focus trapped within modal
   * - Escape key closes
   * - Backdrop click closes
   */
  import { settingsStore } from '../stores/settingsStore.svelte.js';
  import { tokenListStore } from '../stores/tokenListStore.svelte.js';

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  let addListUrl = $state('');
  let addListError = $state('');
  let isAddingList = $state(false);

  let rpcUrlInput = $state('');
  let rpcSaved = $state(false);

  let fileInputEl = $state<HTMLInputElement | null>(null);
  let importError = $state('');
  let importSuccess = $state('');

  let modalEl = $state<HTMLElement | null>(null);
  let closeButtonEl = $state<HTMLButtonElement | null>(null);

  // Sync rpcUrlInput with store when modal opens
  $effect(() => {
    if (settingsStore.isSettingsOpen) {
      rpcUrlInput = settingsStore.customRpcUrl;
      addListUrl = '';
      addListError = '';
      importError = '';
      importSuccess = '';
      rpcSaved = false;
      // Focus the close button
      closeButtonEl?.focus();
    }
  });

  // Body scroll lock
  $effect(() => {
    if (settingsStore.isSettingsOpen && typeof document !== 'undefined') {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleClose(): void {
    settingsStore.closeSettings();
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) handleClose();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      handleClose();
      return;
    }
    if (e.key === 'Tab' && modalEl) {
      const focusable = Array.from(
        modalEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // -- Token lists --

  async function handleAddList(): Promise<void> {
    addListError = '';
    isAddingList = true;
    const err = await tokenListStore.addList(addListUrl);
    isAddingList = false;
    if (err) {
      addListError = err;
    } else {
      addListUrl = '';
    }
  }

  // -- Local tokens --

  function handleExportTokens(): void {
    const json = tokenListStore.exportLocalTokens();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-tokens.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick(): void {
    importError = '';
    importSuccess = '';
    fileInputEl?.click();
  }

  function handleFileChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = tokenListStore.importLocalTokens(text);
      if ('error' in result) {
        importError = result.error;
        importSuccess = '';
      } else {
        importSuccess = `Imported ${String(result.count)} token${result.count !== 1 ? 's' : ''}`;
        importError = '';
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    input.value = '';
  }

  // -- MEV --

  function handleMevToggle(): void {
    settingsStore.mevEnabled = !settingsStore.mevEnabled;
    settingsStore.save();
  }

  function handleOpenMevModal(): void {
    settingsStore.openMevModal();
  }

  // -- Custom RPC URL --

  function handleSaveRpc(): void {
    settingsStore.customRpcUrl = rpcUrlInput.trim();
    settingsStore.save();
    rpcSaved = true;
    setTimeout(() => {
      rpcSaved = false;
    }, 2000);
  }
</script>

{#if settingsStore.isSettingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onkeydown={handleKeydown}
      tabindex="-1"
      bind:this={modalEl}
    >
      <div class="modal-header">
        <h2 id="settings-modal-title" class="modal-title">Settings</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close settings"
          onclick={handleClose}
          bind:this={closeButtonEl}
        >
          ×
        </button>
      </div>

      <div class="modal-body">
        <!-- ---------------------------------------------------------------- -->
        <!-- Token Lists Section                                               -->
        <!-- ---------------------------------------------------------------- -->
        <div class="settings-section">
          <div class="settings-section-title">Token Lists</div>

          {#each tokenListStore.lists as list (list.url ?? '__default__')}
            <div
              class="tokenlist-entry"
              class:disabled={!list.enabled}
              class:error={!!list.error}
            >
              <!-- Toggle -->
              <button
                type="button"
                class="tokenlist-toggle"
                class:on={list.enabled}
                aria-label="{list.enabled ? 'Disable' : 'Enable'} {list.name}"
                aria-pressed={list.enabled}
                onclick={() => tokenListStore.toggleList(list.url)}
              ></button>

              <span class="tokenlist-entry-name" title={list.name}>
                {list.name}
              </span>

              {#if list.error}
                <span class="tokenlist-entry-error" title={list.error}>Error</span>
              {:else}
                <span class="tokenlist-entry-count">
                  {list.tokens.length} tokens
                </span>
              {/if}

              <!-- Remove button (only for custom lists) -->
              {#if list.url !== null}
                <button
                  type="button"
                  class="tokenlist-remove-btn"
                  aria-label="Remove {list.name}"
                  onclick={() => tokenListStore.removeList(list.url!)}
                >
                  ✕
                </button>
              {/if}
            </div>
          {/each}

          <!-- Add new list -->
          <div class="add-list-row">
            <input
              type="url"
              class="add-list-input"
              placeholder="https://example.com/tokenlist.json"
              aria-label="Token list URL"
              bind:value={addListUrl}
              onkeydown={(e) => {
                if (e.key === 'Enter') void handleAddList();
              }}
            />
            <button
              type="button"
              class="add-list-btn"
              disabled={isAddingList || !addListUrl.trim()}
              onclick={() => void handleAddList()}
            >
              {isAddingList ? 'Adding…' : 'Add'}
            </button>
          </div>
          {#if addListError}
            <p class="add-list-error" role="alert">{addListError}</p>
          {/if}
        </div>

        <!-- ---------------------------------------------------------------- -->
        <!-- Local Tokens Section                                              -->
        <!-- ---------------------------------------------------------------- -->
        <div class="settings-section">
          <div class="local-tokens-header">
            <div class="settings-section-title settings-section-title-inline">Local Tokens</div>
            <button
              type="button"
              class="local-tokens-toggle-btn"
              aria-pressed={tokenListStore.localTokensEnabled}
              onclick={() => tokenListStore.toggleLocalTokens()}
            >
              {tokenListStore.localTokensEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          {#if tokenListStore.localTokens.length === 0}
            <p class="empty-local-tokens">No local tokens saved.</p>
          {:else}
            {#each tokenListStore.localTokens as token (token.address + '_' + token.chainId)}
              <div class="local-token-entry">
                <span class="local-token-symbol">{token.symbol}</span>
                <!-- Full address — NEVER truncated (project convention) -->
                <span class="local-token-address">{token.address}</span>
                <span class="local-token-chain">Chain {token.chainId}</span>
                <button
                  type="button"
                  class="local-token-remove-btn"
                  aria-label="Remove {token.symbol}"
                  onclick={() =>
                    tokenListStore.removeLocalToken(token.address, token.chainId)}
                >
                  ✕
                </button>
              </div>
            {/each}
          {/if}

          <div class="local-tokens-actions">
            <button
              type="button"
              class="action-btn"
              disabled={tokenListStore.localTokens.length === 0}
              onclick={handleExportTokens}
            >
              Export My Tokens
            </button>
            <button type="button" class="action-btn" onclick={handleImportClick}>
              Import My Tokens
            </button>
          </div>

          {#if importError}
            <p class="import-error" role="alert">{importError}</p>
          {/if}
          {#if importSuccess}
            <p class="import-success" role="status">{importSuccess}</p>
          {/if}

          <!-- Hidden file input for import -->
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import token list file"
            style="display: none"
            bind:this={fileInputEl}
            onchange={handleFileChange}
          />
        </div>

        <!-- ---------------------------------------------------------------- -->
        <!-- MEV Protection Section (Ethereum only)                            -->
        <!-- ---------------------------------------------------------------- -->
        {#if settingsStore.mevAvailable}
          <div class="settings-section" data-testid="mev-section">
            <div class="settings-section-title">MEV Protection</div>
            <p class="modal-text">
              Protect swaps from sandwich attacks using Flashbots Protect.
            </p>
            <div class="mev-controls">
              <button
                type="button"
                class="mev-toggle-btn"
                class:active={settingsStore.mevEnabled}
                aria-pressed={settingsStore.mevEnabled}
                onclick={handleMevToggle}
              >
                {settingsStore.mevEnabled ? 'MEV Protection: ON' : 'MEV Protection: OFF'}
              </button>
              <button
                type="button"
                class="mev-info-btn"
                aria-label="MEV protection info"
                onclick={handleOpenMevModal}
              >
                ℹ Info
              </button>
            </div>
          </div>
        {/if}

        <!-- ---------------------------------------------------------------- -->
        <!-- Custom RPC URL Section                                            -->
        <!-- ---------------------------------------------------------------- -->
        <div class="settings-section">
          <div class="settings-section-title">Custom RPC URL</div>
          <p class="modal-text">
            Override the default RPC endpoint for this chain. Leave empty to use the default.
          </p>
          <div class="rpc-row">
            <input
              type="url"
              class="rpc-input"
              placeholder="https://mainnet.infura.io/v3/..."
              aria-label="Custom RPC URL"
              bind:value={rpcUrlInput}
            />
            <button type="button" class="save-rpc-btn" onclick={handleSaveRpc}>
              {rpcSaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>
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
    z-index: 1000;
  }

  .modal {
    background: var(--bg-card, #fff);
    border: 4px solid var(--border, #000);
    max-width: 640px;
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

  .settings-section {
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--border, #000);
  }

  .settings-section:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .settings-section-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border, #000);
  }

  .tokenlist-entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    background: var(--bg-muted, #f0f0f0);
    border: 1px solid var(--border-light, #ddd);
  }

  .tokenlist-entry:last-of-type {
    margin-bottom: 0;
  }

  .tokenlist-entry.disabled {
    opacity: 0.5;
  }

  .tokenlist-entry.error {
    border-color: var(--red, #cc0000);
    border-left: 4px solid var(--red, #cc0000);
  }

  .tokenlist-entry-name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tokenlist-entry-count {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    white-space: nowrap;
  }

  .tokenlist-entry-error {
    font-size: 0.75rem;
    color: var(--red, #cc0000);
    font-weight: 600;
  }

  .tokenlist-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--border-light, #ccc);
    border: 1px solid var(--border, #000);
    cursor: pointer;
    flex-shrink: 0;
  }

  .tokenlist-toggle::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 1px;
    width: 16px;
    height: 16px;
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #000);
    transition: transform 0.15s;
  }

  .tokenlist-toggle.on {
    background: var(--accent, #0055ff);
  }

  .tokenlist-toggle.on::after {
    transform: translateX(16px);
  }

  .tokenlist-toggle:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .tokenlist-remove-btn {
    background: transparent;
    border: none;
    color: var(--text-muted, #666);
    font-size: 0.875rem;
    padding: 0.25rem;
    cursor: pointer;
    line-height: 1;
  }

  .tokenlist-remove-btn:hover {
    color: var(--red, #cc0000);
  }

  .tokenlist-remove-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .add-list-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .add-list-input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    font-family: monospace;
    font-size: 0.8rem;
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
  }

  .add-list-input:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }

  .add-list-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border: 2px solid var(--accent, #0055ff);
    white-space: nowrap;
  }

  .add-list-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-list-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .add-list-error {
    font-size: 0.8rem;
    color: var(--red, #cc0000);
    margin-top: 0.25rem;
  }

  .local-tokens-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border, #000);
    margin-bottom: 0.5rem;
  }

  .local-tokens-header .settings-section-title {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .local-tokens-toggle-btn {
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--bg-muted, #f0f0f0);
    border: 1px solid var(--border, #000);
    color: var(--text, #000);
  }

  .local-tokens-toggle-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .empty-local-tokens {
    font-size: 0.85rem;
    color: var(--text-muted, #666);
    font-style: italic;
    margin-bottom: 0.5rem;
  }

  .local-token-entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.5rem;
    background: var(--bg-muted, #f0f0f0);
    border: 1px solid var(--border-light, #ddd);
  }

  .local-token-entry:last-of-type {
    margin-bottom: 0;
  }

  .local-token-symbol {
    font-weight: 700;
    font-size: 0.875rem;
    min-width: 60px;
  }

  .local-token-address {
    font-family: monospace;
    font-size: 0.625rem;
    color: var(--text-muted, #666);
    flex: 1;
    word-break: break-all;
  }

  .local-token-chain {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted, #666);
    white-space: nowrap;
  }

  .local-token-remove-btn {
    background: transparent;
    border: none;
    color: var(--text-muted, #666);
    font-size: 0.875rem;
    padding: 0.25rem;
    cursor: pointer;
    line-height: 1;
  }

  .local-token-remove-btn:hover {
    color: var(--red, #cc0000);
  }

  .local-token-remove-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .local-tokens-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .action-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--bg-card, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
  }

  .action-btn:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .import-error {
    font-size: 0.8rem;
    color: var(--red, #cc0000);
    margin-top: 0.25rem;
  }

  .import-success {
    font-size: 0.8rem;
    color: var(--green, #007700);
    margin-top: 0.25rem;
  }

  .modal-text {
    font-size: 0.875rem;
    line-height: 1.6;
    margin-bottom: 0.75rem;
    color: var(--text, #000);
  }

  .mev-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .mev-toggle-btn {
    padding: 0.4rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    background: var(--bg-muted, #f0f0f0);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .mev-toggle-btn.active {
    background: var(--green, #007700);
    color: #fff;
    border-color: var(--green, #007700);
  }

  .mev-toggle-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .mev-info-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.375rem 0.5rem;
    background: var(--bg-card, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
    cursor: pointer;
  }

  .mev-info-btn:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .mev-info-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
  }

  .rpc-row {
    display: flex;
    gap: 0.5rem;
  }

  .rpc-input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    font-family: monospace;
    font-size: 0.8rem;
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
  }

  .rpc-input:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }

  .save-rpc-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border: 2px solid var(--accent, #0055ff);
    white-space: nowrap;
  }

  .save-rpc-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  @media (max-width: 424px) {
    .modal {
      margin: 0;
      min-height: 100vh;
    }
  }
</style>
