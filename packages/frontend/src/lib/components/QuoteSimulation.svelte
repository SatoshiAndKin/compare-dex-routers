<script lang="ts">
  import type { Quote } from "../stores/comparisonStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";
  import { formStore } from "../stores/formStore.svelte.js";
  let { quote, balanceOnly = false }: { quote: Quote; balanceOnly?: boolean } = $props();
  const balanceMessage = $derived.by(() => {
    if (!walletStore.address) return "Connect your wallet to simulate this route.";
    if (
      quote.chainId !== formStore.chainId ||
      quote.from.toLowerCase() !== formStore.fromToken?.address.toLowerCase() ||
      quote.to.toLowerCase() !== formStore.toToken?.address.toLowerCase() ||
      quote.mode !== formStore.mode ||
      quote.amount !== (quote.mode === "exactIn" ? formStore.sellAmount : formStore.receiveAmount)
    )
      return null;
    if (walletStore.chainId !== quote.chainId) return "Switch network to check your balance.";
    const balance = balanceStore.inputBalance(
      walletStore.provider,
      walletStore.address,
      quote.chainId,
      quote.from
    );
    if (balance === null)
      return balanceStore.from.status === "loading" ? "Balance loading…" : "Balance unavailable.";
    return balance < BigInt(quote.input_amount_raw)
      ? `Insufficient ${quote.from_symbol} balance.`
      : null;
  });
</script>

{#if !balanceOnly || walletStore.isConnected}
  <span class="simulation-status" class:balance-only={balanceOnly}>
    {#if balanceMessage}<span class="balance-status">{balanceMessage}</span>{/if}
    {#if !balanceOnly}
      {quote.simulation_status === "succeeded"
        ? "Simulation passed. Wallet checks required."
        : quote.simulation_status === "failed"
          ? `Simulation failed. ${quote.simulation_reason ?? "Refresh to retry simulation."}`
          : `Not simulated. ${quote.simulation_reason ?? "Refresh to retry simulation."}`}
    {/if}
  </span>
{/if}

<style>
  .balance-status {
    display: block;
  }
  .simulation-status {
    overflow-wrap: anywhere;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .balance-only {
    display: block;
    min-height: 3em;
  }
</style>
