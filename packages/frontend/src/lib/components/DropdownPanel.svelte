<script lang="ts" generics="Option">
  import type { Snippet } from "svelte";

  let {
    anchor,
    minWidth = 0,
    id,
    label,
    options,
    getKey,
    selectedKey,
    activeIndex = $bindable(-1),
    query,
    emptyMessage,
    onSelect,
    onDismiss,
    filter,
    option,
  }: {
    anchor: HTMLElement | null;
    minWidth?: number;
    id: string;
    label: string;
    options: Option[];
    getKey: (item: Option) => string;
    selectedKey?: string;
    activeIndex?: number;
    query: string;
    emptyMessage: string;
    onSelect: (item: Option) => void;
    onDismiss: () => void;
    filter?: Snippet;
    option: Snippet<[Option]>;
  } = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let list = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const target = anchor;
    const element = panel;
    const preferredWidth = minWidth;
    if (!target || !element) return;

    const viewport = window.visualViewport;
    const position = (): void => {
      const bounds = target.getBoundingClientRect();
      const margin = 8;
      const maxHeight = 360;
      const left = (viewport?.offsetLeft ?? 0) + margin;
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - margin;
      const top = (viewport?.offsetTop ?? 0) + margin;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - margin;
      const width = Math.min(Math.max(bounds.width, preferredWidth), Math.max(0, right - left));
      const above = bounds.top - top;
      const below = bottom - bounds.bottom;
      const openAbove = below < maxHeight && above > below;
      const space = openAbove ? above : below;
      const height = Math.min(maxHeight, Math.max(0, bottom - top));
      // A short viewport can leave too little room on either side of the trigger.
      const overlay = space < 100;
      element.style.left = `${Math.max(left, Math.min(bounds.left, right - width))}px`;
      element.style.width = `${width}px`;
      element.style.maxHeight = `${Math.floor(overlay ? height : Math.min(space, height))}px`;
      element.style.top = overlay ? `${top}px` : openAbove ? "" : `${bounds.bottom}px`;
      element.style.bottom = !overlay && openAbove ? `${window.innerHeight - bounds.top}px` : "";
    };

    // Track the anchor and the visual viewport, including when a mobile keyboard opens.
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(target);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, { passive: true });
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  });

  $effect(() => {
    void query;
    if (list) list.scrollTop = 0;
  });

  $effect(() => {
    const item = list?.children[activeIndex];
    if (!list || !item) return;
    const viewport = list.getBoundingClientRect();
    const bounds = item.getBoundingClientRect();
    if (bounds.top < viewport.top) list.scrollTop += Math.floor(bounds.top - viewport.top);
    else if (bounds.bottom > viewport.bottom)
      list.scrollTop += Math.ceil(bounds.bottom - viewport.bottom);
  });

  export function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const lastIndex = options.length - 1;
      activeIndex =
        event.key === "ArrowDown"
          ? Math.min(activeIndex + 1, lastIndex)
          : activeIndex < 0
            ? lastIndex
            : Math.max(0, activeIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = options[Math.max(activeIndex, 0)];
      if (item !== undefined) onSelect(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
    }
  }
</script>

<div class="dropdown-panel" bind:this={panel}>
  {@render filter?.()}
  <div {id} role="listbox" aria-label={label} class="dropdown-options" bind:this={list}>
    {#each options as item, index (getKey(item))}
      {@const selected = getKey(item) === selectedKey}
      <div
        id={`${id}-${index}`}
        role="option"
        tabindex="-1"
        aria-selected={activeIndex < 0 ? selected : activeIndex === index}
        class="dropdown-option"
        class:current={selected}
        class:active={activeIndex === index}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onSelect(item)}
        onkeydown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(item);
          }
        }}
      >
        {@render option(item)}
      </div>
    {/each}
  </div>
  {#if options.length === 0}
    <div class="dropdown-empty" role="status">{emptyMessage}</div>
  {/if}
</div>

<style>
  .dropdown-panel {
    position: fixed;
    z-index: 100;
    display: flex;
    flex-direction: column;
    border: 2px solid var(--border, #000);
    background: var(--bg-card, #fff);
    overflow: hidden;
  }

  .dropdown-options {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .dropdown-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-light);
    cursor: pointer;
  }

  .dropdown-option:last-child {
    border-bottom: 0;
  }

  .dropdown-option.current {
    background: var(--chain-current-bg, #e8f4e8);
  }

  .dropdown-option:hover,
  .dropdown-option.active {
    background: var(--bg-hover, #f0f0f0);
  }

  .dropdown-empty {
    padding: 0.75rem;
    color: var(--text-muted, #666);
    font-size: 0.875rem;
  }
</style>
