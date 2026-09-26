<script lang="ts">
  import { transactionExplorer, type TransactionReference } from "../explorers.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  let { transaction }: { transaction: TransactionReference } = $props();
  const explorer = $derived(
    transactionExplorer(transaction, preferencesStore.getExplorerUrl(transaction.chainId))
  );
</script>

{#if explorer}
  <a href={explorer.url} target="_blank" rel="noopener noreferrer">View on {explorer.name} ↗</a>
{/if}
<details>
  <summary>Transaction details</summary>
  <span>Chain ID: {transaction.chainId}</span>
  <code>{transaction.hash}</code>
</details>

<style>
  a {
    color: inherit;
    text-decoration: underline;
  }
  details {
    font-size: 0.75rem;
  }
  summary {
    cursor: pointer;
  }
  code {
    display: block;
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
