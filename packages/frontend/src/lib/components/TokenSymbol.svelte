<script lang="ts">
  import { canonicalToken } from "../native.js";
  import { tokensStore } from "../stores/tokensStore.svelte.js";

  let {
    chainId,
    address,
    symbol,
    logoURI,
  }: {
    chainId: number;
    address: string;
    symbol: string;
    logoURI?: string;
  } = $props();

  const source = $derived(
    logoURI ??
      tokensStore
        .getForChain(chainId)
        .find(
          (token) =>
            canonicalToken(token.address).toLowerCase() === canonicalToken(address).toLowerCase()
        )?.logoURI
  );
</script>

<span class="token-symbol">
  <span class="token-image" aria-hidden="true">
    {#if source}
      {#key source}
        <img
          src={source}
          alt=""
          decoding="async"
          onerror={(event) => {
            (event.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      {/key}
    {/if}
  </span>
  <span class="symbol-text">{symbol}</span>
</span>

<style>
  .token-symbol {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    max-width: 100%;
    vertical-align: middle;
  }
  .token-image {
    display: inline-flex;
    flex: 0 0 var(--token-icon-size, 1em);
    width: var(--token-icon-size, 1em);
    height: var(--token-icon-size, 1em);
  }
  img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: contain;
  }
  .symbol-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
