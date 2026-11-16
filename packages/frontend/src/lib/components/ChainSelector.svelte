<script lang="ts">
  import { flushSync } from "svelte";
  import DisclosureChevron from "./DisclosureChevron.svelte";
  import DropdownPanel from "./DropdownPanel.svelte";
  import { selectChain as selectFormChain } from "../stores/formLifecycle.svelte.js";
  import { formStore } from "../stores/formStore.svelte.js";
  import { configStore } from "../stores/configStore.svelte.js";

  const fallbackChains = [
    { id: "1", name: "Ethereum" },
    { id: "8453", name: "Base" },
    { id: "42161", name: "Arbitrum" },
    { id: "10", name: "Optimism" },
    { id: "137", name: "Polygon" },
    { id: "56", name: "BSC" },
    { id: "43114", name: "Avalanche" },
  ];

  const listId = $props.id();
  let isOpen = $state(false);
  let query = $state("");
  let activeIndex = $state(-1);
  let container = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let dropdown = $state<{ handleKeydown(event: KeyboardEvent): void } | null>(null);

  const currentId = $derived(String(formStore.chainId));
  const chains = $derived(
    configStore.supportedChains.length > 0
      ? configStore.supportedChains.map(({ id, name }) => ({ id: String(id), name }))
      : fallbackChains
  );
  const currentChain = $derived(chains.find(({ id }) => id === currentId));
  const options = $derived.by(() => {
    const search = query.trim().toLowerCase();
    if (search)
      return chains.filter(
        ({ id, name }) => name.toLowerCase().includes(search) || id.includes(search)
      );
    return currentChain ? [currentChain, ...chains.filter(({ id }) => id !== currentId)] : chains;
  });

  function openDropdown(): void {
    // Mount and focus during the activation so mobile browsers can open the keyboard.
    flushSync(() => (isOpen = true));
    input?.focus({ preventScroll: true });
  }

  function closeDropdown(): void {
    isOpen = false;
    query = "";
    activeIndex = -1;
  }

  function dismiss(): void {
    closeDropdown();
    trigger?.focus({ preventScroll: true });
  }

  function selectChain(chain: (typeof fallbackChains)[number]): void {
    selectFormChain(Number(chain.id));
    dismiss();
  }

  function closeIfOutside(target: EventTarget | null): void {
    if (isOpen && target instanceof Node && !container?.contains(target)) closeDropdown();
  }
</script>

<svelte:window onpointerdown={(event) => closeIfOutside(event.target)} />

<div
  class="chain-selector"
  bind:this={container}
  onfocusout={(event) => closeIfOutside(event.relatedTarget)}
>
  <button
    bind:this={trigger}
    class="chain-button"
    type="button"
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-controls={isOpen ? listId : undefined}
    onclick={() => (isOpen ? closeDropdown() : openDropdown())}
    onkeydown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (!isOpen) openDropdown();
      dropdown?.handleKeydown(event);
    }}
  >
    <span class="chain-button-text">{currentChain?.name ?? "Unknown"}</span>
    <DisclosureChevron open={isOpen} />
  </button>

  {#if isOpen}
    <DropdownPanel
      bind:this={dropdown}
      anchor={trigger}
      minWidth={224}
      id={listId}
      label="Supported chains"
      {options}
      getKey={(chain) => chain.id}
      selectedKey={currentId}
      bind:activeIndex
      {query}
      emptyMessage="No chains match"
      onSelect={selectChain}
      onDismiss={dismiss}
    >
      {#snippet filter()}
        <div class="chain-search-wrapper">
          <input
            bind:this={input}
            class="chain-search-input"
            type="text"
            role="combobox"
            aria-label="Search chains"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            placeholder="Search chains"
            value={query}
            oninput={(event) => {
              query = event.currentTarget.value;
              activeIndex = -1;
            }}
            onkeydown={(event) => dropdown?.handleKeydown(event)}
            autocomplete="off"
          />
        </div>
      {/snippet}
      {#snippet option(chain)}
        <span class="chain-item-name">{chain.name}</span>
        <span class="chain-item-id">({chain.id})</span>
      {/snippet}
    </DropdownPanel>
  {/if}
</div>

<style>
  .chain-selector {
    width: 11rem;
    max-width: 100%;
  }
  .chain-button {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-muted);
    border: 1px solid var(--border-light);
    cursor: pointer;
    font: inherit;
    font-size: 0.875rem;
    color: var(--text, #000);
    text-align: left;
    text-transform: none;
    letter-spacing: normal;
  }
  .chain-button:focus-visible {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 1px;
  }
  .chain-button-text,
  .chain-item-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .chain-search-wrapper {
    flex: none;
    padding: 0.4rem;
    border-bottom: 1px solid var(--border-light);
  }
  .chain-search-input {
    width: 100%;
    min-height: 44px;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border-light);
    background: var(--bg-input, #fff);
    color: var(--text, #000);
    font: inherit;
    font-size: 1rem;
  }
  .chain-item-id {
    color: var(--text-muted, #666);
    font-size: 0.85rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
