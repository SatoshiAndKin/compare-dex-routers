<script lang="ts">
  /**
   * ThemeToggle — cycles through light → dark → system themes on click.
   * Uses themeStore for state and persistence.
   */
  import { themeStore } from '../stores/themeStore.svelte.js';
</script>

<button
  class="theme-toggle"
  type="button"
  onclick={() => themeStore.cycle()}
  aria-label={themeStore.ariaLabel}
  title={themeStore.ariaLabel}
>
  {themeStore.icon}
</button>

<style>
  .theme-toggle {
    background: none;
    border: 2px solid var(--border, #000);
    color: var(--text, #000);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.25rem 0.5rem;
    font-family: inherit;
    transition: background 0.1s;
  }

  .theme-toggle:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .theme-toggle:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }
</style>
