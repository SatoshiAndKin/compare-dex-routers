<script lang="ts">
  import type { Quote } from "../stores/comparisonStore.svelte.js";
  interface Props {
    quote: Quote;
    gasPriceGwei?: string | null;
  }
  let { quote, gasPriceGwei = null }: Props = $props();
  let open = $state(false);
  const fields = $derived(
    [
      ["From", `${quote.from_symbol} ${quote.from}`],
      ["To", `${quote.to_symbol} ${quote.to}`],
      ["Sender", quote.sender],
      ["Slippage", `${quote.slippage_bps} bps`],
      ["Router Address", quote.execution?.to],
      ["Router Calldata", quote.execution?.data],
      ["Router Value (wei)", quote.execution?.value],
      ["Input Amount (base units)", quote.input_amount_raw],
      ["Output Amount (base units)", quote.output_amount_raw],
      ["Approval Token", quote.execution?.approval?.token],
      ["Approval Spender", quote.execution?.approval?.spender],
      ["Gas Units", quote.gas_used],
      [
        "Gas Price",
        (gasPriceGwei ?? quote.gas_price_gwei) === null
          ? null
          : `${gasPriceGwei ?? quote.gas_price_gwei} gwei`,
      ],
      [
        "Gas Cost",
        quote.gas_cost_native === null ? null : `${quote.gas_cost_native} ${quote.native_currency}`,
      ],
      [
        quote.mode === "targetOut" ? "Total Cost" : "Output After Gas",
        quote.net_value_native === null
          ? null
          : `${quote.net_value_native} ${quote.native_currency}`,
      ],
    ].filter((field) => field[1] !== null && field[1] !== undefined)
  );
</script>

<div class="quote-details">
  <button
    type="button"
    class="details-toggle"
    class:open
    onclick={() => {
      open = !open;
    }}
  >
    Details {open ? "▲" : "▼"}
  </button>
  {#if open}
    <div class="details-content">
      {#each fields as [label, value] (label)}
        <div class="detail-field">
          <span class="detail-label">{label}</span>
          <span class="detail-value mono">{value}</span>
        </div>
      {/each}
      {#if quote.route && quote.route.edges.length > 0}
        <div class="detail-field">
          <span class="detail-label">Route</span>
          {#each quote.route.edges as edge, index (`${edge.key}:${index}`)}
            <div class="detail-value mono">
              {quote.route.nodes.find(
                (node) => node.address.toLowerCase() === edge.source.toLowerCase()
              )?.symbol ?? ""}
              {edge.source} →
              {quote.route.nodes.find(
                (node) => node.address.toLowerCase() === edge.target.toLowerCase()
              )?.symbol ?? ""}
              {edge.target}
              {#if edge.address}<div>Pool: {edge.address}</div>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .quote-details {
    margin-top: 0.75rem;
  }

  .details-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.75rem;
    background: var(--bg-muted, #f0f0f0);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .details-toggle:hover {
    background: var(--bg-hover, #e0e0e0);
  }

  .details-toggle:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }

  .details-toggle.open {
    background: var(--border, #000);
    color: var(--bg-card, #fff);
  }

  .details-content {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 2px solid var(--border-light, #e0e0e0);
    background: var(--bg-muted, #f0f0f0);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .detail-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #666);
  }

  .detail-value {
    font-size: clamp(0.625rem, 1.6vw, 0.8125rem);
    word-break: break-all;
  }

  .detail-value.mono {
    font-family: monospace;
    word-break: break-all;
  }
</style>
