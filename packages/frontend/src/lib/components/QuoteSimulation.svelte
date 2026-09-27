<script lang="ts">
  import type { Quote } from "../stores/comparisonStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";
  import { formStore } from "../stores/formStore.svelte.js";
  let { quote }: { quote: Quote } = $props();
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

<div class="simulation-status">
  <div class="balance-status">{balanceMessage ?? ""}</div>
  {quote.simulation_status === "succeeded"
    ? "Simulation passed. Wallet checks required."
    : quote.simulation_status === "failed"
      ? `Simulation failed. ${quote.simulation_reason ?? "Refresh to retry simulation."}`
      : `Not simulated. ${quote.simulation_reason ?? "Refresh to retry simulation."}`}
</div>

<style>
  .balance-status {
    min-height: 3em;
  }
  .simulation-status {
    min-height: 3em;
    overflow-wrap: anywhere;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
