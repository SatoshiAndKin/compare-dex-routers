<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    children,
    icon,
    hover = true,
  }: {
    label: string;
    children: Snippet;
    icon?: Snippet;
    hover?: boolean;
  } = $props();
  const id = $props.id();
  let wrapper: HTMLSpanElement;
  let trigger: HTMLButtonElement;
  let hovered = $state(false);
  let pinned = $state(false);
  const open = $derived(hovered || pinned);
  let above = $state(false);

  function dismiss() {
    hovered = false;
    pinned = false;
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    if (wrapper.contains(document.activeElement)) {
      event.stopPropagation();
      trigger.focus();
    }
    dismiss();
  }
  function choosePosition() {
    above = trigger.getBoundingClientRect().top > window.innerHeight / 2;
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (open && !wrapper.contains(event.target as Node)) dismiss();
  }}
  onkeydown={handleEscape}
/>

<span
  role="group"
  class="info-control"
  bind:this={wrapper}
  onpointerenter={(event) => {
    if (hover && event.pointerType === "mouse") {
      choosePosition();
      hovered = true;
    }
  }}
  onpointerleave={() => (hovered = false)}
  onfocusout={(event) => {
    if (!wrapper.contains(event.relatedTarget as Node | null)) dismiss();
  }}
>
  <button
    type="button"
    class="info-trigger"
    bind:this={trigger}
    aria-label={label}
    aria-expanded={open}
    aria-controls={id}
    onclick={() => {
      if (pinned) dismiss();
      else {
        choosePosition();
        pinned = true;
      }
    }}
  >
    {#if icon}{@render icon()}{:else}<span aria-hidden="true">i</span>{/if}
  </button>
  <span class="info-popover" class:above {id} hidden={!open}>
    {@render children()}
  </span>
</span>

<style>
  .info-control {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }
  .info-trigger {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
  }
  .info-trigger:hover,
  .info-trigger[aria-expanded="true"] {
    color: var(--text);
    background: var(--bg-hover);
  }
  .info-trigger span {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border: 1px solid currentColor;
    border-radius: 50%;
    font: 600 0.75rem/1 system-ui;
    text-transform: none;
    letter-spacing: 0;
  }
  .info-popover {
    position: absolute;
    z-index: 110;
    inset-inline-end: 0;
    inset-block-start: 100%;
    display: grid;
    gap: 0.45rem;
    width: min(22rem, 100%);
    max-height: 45dvh;
    overflow-y: auto;
    padding: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text);
    box-shadow: 0 4px 16px #0003;
    overflow-wrap: anywhere;
    font: 0.8125rem/1.45 system-ui;
    text-align: start;
    letter-spacing: 0;
    text-transform: none;
  }
  .info-popover.above {
    inset-block-start: auto;
    inset-block-end: 100%;
  }
</style>
