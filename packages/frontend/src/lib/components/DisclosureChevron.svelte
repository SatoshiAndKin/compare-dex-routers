<script lang="ts">
  let { open = false }: { open?: boolean } = $props();
</script>

<svg
  class="disclosure-chevron"
  class:open
  width="14"
  height="14"
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="m4 6 4 4 4-4" />
</svg>

<style>
  .disclosure-chevron {
    flex: none;
    pointer-events: none;
  }
  .disclosure-chevron.open,
  :global(details[open] > summary) > .disclosure-chevron {
    transform: rotate(180deg);
  }
</style>
