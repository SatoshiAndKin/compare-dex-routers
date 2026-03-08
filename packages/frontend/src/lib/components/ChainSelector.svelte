<script lang="ts">
  /**
   * ChainSelector — searchable chain dropdown with keyboard navigation.
   * Ports behavior from src/client/chain-selector.ts.
   */
  import { formStore } from '../stores/formStore.svelte.js';

  // ---------------------------------------------------------------------------
  // Chain definitions (from src/client/config.ts)
  // ---------------------------------------------------------------------------

  interface ChainDefinition {
    id: string;
    name: string;
  }

  const ALL_CHAINS: ChainDefinition[] = [
    { id: '1', name: 'Ethereum' },
    { id: '8453', name: 'Base' },
    { id: '42161', name: 'Arbitrum' },
    { id: '10', name: 'Optimism' },
    { id: '137', name: 'Polygon' },
    { id: '56', name: 'BSC' },
    { id: '43114', name: 'Avalanche' },
  ];

  const CHAIN_NAMES: Record<string, string> = {
    '1': 'Ethereum',
    '10': 'Optimism',
    '56': 'BSC',
    '137': 'Polygon',
    '8453': 'Base',
    '42161': 'Arbitrum',
    '43114': 'Avalanche',
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let isOpen = $state(false);
  let searchQuery = $state('');
  let activeIdx = $state(-1);
  let previousChainId = $state<string | null>(null);
  let containerEl = $state<HTMLElement | null>(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Filtered chains based on search query */
  let filteredChains = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return ALL_CHAINS;
    return ALL_CHAINS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.includes(q),
    );
  });

  /** Display text for the current chain */
  let currentChainDisplay = $derived.by(() => {
    const id = String(formStore.chainId);
    const name = CHAIN_NAMES[id] ?? 'Unknown';
    return `${name} (${id})`;
  });

  /** All visible items: pinned current chain first (when opening), then filtered */
  let visibleChains = $derived.by((): ChainDefinition[] => {
    if (!isOpen) return [];
    if (searchQuery) {
      // While searching, just show filtered results
      return filteredChains;
    }
    // When not searching, show current chain pinned at top, then rest
    const currentId = String(formStore.chainId);
    const currentChain = ALL_CHAINS.find((c) => c.id === currentId);
    const rest = ALL_CHAINS.filter((c) => c.id !== currentId);
    return currentChain ? [currentChain, ...rest] : ALL_CHAINS;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatChainDisplay(id: string, name: string): string {
    return `${name} (${id})`;
  }

  function selectChain(chain: ChainDefinition): void {
    formStore.chainId = Number(chain.id);
    previousChainId = null;
    closeDropdown();
  }

  function openDropdown(): void {
    previousChainId = String(formStore.chainId);
    searchQuery = '';
    activeIdx = -1;
    isOpen = true;
  }

  function closeDropdown(): void {
    isOpen = false;
    searchQuery = '';
    activeIdx = -1;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleButtonClick(): void {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function handleSearchInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    searchQuery = target.value;
    activeIdx = -1;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    const items = visibleChains;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeItem = activeIdx >= 0 ? items[activeIdx] : undefined;
      const firstItem = items[0];
      if (activeItem) {
        selectChain(activeItem);
      } else if (firstItem) {
        selectChain(firstItem);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Restore previous selection
      if (previousChainId) {
        formStore.chainId = Number(previousChainId);
      }
      closeDropdown();
    } else if (e.key === 'Tab') {
      // On tab, try auto-select single match or restore
      if (searchQuery.trim()) {
        const matches = filteredChains;
        if (matches.length === 1 && matches[0]) {
          selectChain(matches[0]);
        } else {
          if (previousChainId) {
            formStore.chainId = Number(previousChainId);
          }
          closeDropdown();
        }
      } else {
        if (previousChainId) {
          formStore.chainId = Number(previousChainId);
        }
        closeDropdown();
      }
    }
  }

  function handleDocumentClick(e: MouseEvent): void {
    if (!isOpen) return;
    if (!containerEl) return;
    const target = e.target as Node;
    if (containerEl.contains(target)) return;

    // Click outside: restore previous selection or auto-select single match
    if (searchQuery.trim()) {
      const matches = filteredChains;
      if (matches.length === 1 && matches[0]) {
        selectChain(matches[0]);
        return;
      }
    }
    if (previousChainId) {
      formStore.chainId = Number(previousChainId);
    }
    closeDropdown();
  }

  function handleItemMousedown(e: MouseEvent, chain: ChainDefinition): void {
    e.preventDefault();
    selectChain(chain);
  }
</script>

<svelte:window on:mousedown={handleDocumentClick} />

<div class="chain-selector" bind:this={containerEl}>
  <button
    class="chain-button"
    type="button"
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    onclick={handleButtonClick}
    onkeydown={handleKeydown}
  >
    <span class="chain-button-text">{currentChainDisplay}</span>
    <span class="chain-button-arrow" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
  </button>

  {#if isOpen}
    <div class="chain-dropdown" role="listbox">
      <div class="chain-search-wrapper">
        <input
          class="chain-search-input"
          type="text"
          placeholder="Search chains..."
          value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleKeydown}
          aria-label="Search chains"
          autocomplete="off"
        />
      </div>

      {#if visibleChains.length === 0}
        <div class="chain-item-empty">No chains match</div>
      {:else}
        {#each visibleChains as chain, i}
          {@const isCurrentSelection = chain.id === String(formStore.chainId) && !searchQuery}
          <div
            class={`chain-item${isCurrentSelection ? ' current-selection' : ''}${activeIdx === i ? ' active' : ''}`}
            role="option"
            tabindex="-1"
            aria-selected={activeIdx === i}
            id={`chain-option-${chain.id}`}
            onmousedown={(e) => handleItemMousedown(e, chain)}
          >
            <span class="chain-item-name">{chain.name}</span>
            <span class="chain-item-id">({chain.id})</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .chain-selector {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  .chain-button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--bg-input, #fff);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.95rem;
    font-family: inherit;
    color: var(--text, #000);
    text-align: left;
  }

  .chain-button:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .chain-button-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chain-button-arrow {
    margin-left: 0.5rem;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .chain-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    background: var(--bg-card, #fff);
    border: 2px solid var(--border, #000);
    border-top: none;
    max-height: 300px;
    overflow-y: auto;
  }

  .chain-search-wrapper {
    padding: 0.4rem;
    border-bottom: 1px solid var(--border-light, #e0e0e0);
  }

  .chain-search-input {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border-light, #e0e0e0);
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    font-size: 0.9rem;
    font-family: inherit;
  }

  .chain-search-input:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }

  .chain-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font-size: 0.95rem;
  }

  .chain-item:hover,
  .chain-item.active {
    background: var(--bg-hover, #f0f0f0);
  }

  .chain-item.current-selection {
    background: var(--chain-current-bg, #e8f4e8);
    border-left: 3px solid var(--chain-current-border, #22c55e);
  }

  .chain-item-name {
    flex: 1;
    font-weight: 500;
  }

  .chain-item-id {
    color: var(--text-muted, #666);
    font-size: 0.85rem;
  }

  .chain-item-empty {
    padding: 0.75rem;
    color: var(--text-muted, #666);
    font-style: italic;
    text-align: center;
  }
</style>
