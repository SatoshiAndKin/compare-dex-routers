<script lang="ts">
  /**
   * QuoteDetails — expandable section with full technical details for a quote.
   * Addresses are NEVER truncated — always shown in full.
   */
  import type { SpandexQuote, CurveQuote } from "../stores/comparisonStore.svelte.js";

  interface Props {
    quote: SpandexQuote | CurveQuote;
    type: "spandex" | "curve";
    gasPriceGwei?: string | null;
  }

  let { quote, type, gasPriceGwei = null }: Props = $props();

  let open = $state(false);

  function toggleOpen() {
    open = !open;
  }

  // Determine if this is a Spandex quote
  const isSpandex = $derived(type === "spandex");
  const spandex = $derived(isSpandex ? (quote as SpandexQuote) : null);
  const curve = $derived(!isSpandex ? (quote as CurveQuote) : null);

  // Show gas cost section?
  const hasGasCost = $derived(Boolean(quote.gas_cost_eth) && Number(quote.gas_cost_eth) > 0);
  const hasGasUsed = $derived(Boolean(quote.gas_used) && Number(quote.gas_used) > 0);
  const hasNetValue = $derived(Boolean(quote.net_value_eth) && Number(quote.net_value_eth) > 0);

  // Route info for Curve
  const curveRoute = $derived(curve?.route ?? []);
  const hasRoute = $derived(curveRoute.length > 0);
  const routeSymbols = $derived(curve?.route_symbols ?? {});
</script>

<div class="quote-details">
  <button type="button" class="details-toggle" class:open onclick={toggleOpen}>
    Details {open ? "▲" : "▼"}
  </button>
  {#if open}
    <div class="details-content">
      <!-- From / To addresses — always full, never truncated -->
      {#if quote.from}
        <div class="detail-field">
          <span class="detail-label">From</span>
          <span class="detail-value mono">
            {quote.from_symbol ? `${quote.from_symbol} ` : ""}{quote.from}
          </span>
        </div>
      {/if}
      {#if quote.to}
        <div class="detail-field">
          <span class="detail-label">To</span>
          <span class="detail-value mono">
            {quote.to_symbol ? `${quote.to_symbol} ` : ""}{quote.to}
          </span>
        </div>
      {/if}

      <!-- Router address — always full, never truncated -->
      {#if quote.router_address}
        <div class="detail-field">
          <span class="detail-label">Router Address</span>
          <span class="detail-value mono">{quote.router_address}</span>
        </div>
      {/if}

      <!-- Router calldata -->
      {#if quote.router_calldata}
        <div class="detail-field">
          <span class="detail-label">Router Calldata</span>
          <span class="detail-value mono compact">{quote.router_calldata}</span>
        </div>
      {/if}

      <!-- Router value (Spandex only) -->
      {#if spandex?.router_value}
        <div class="detail-field">
          <span class="detail-label">Router Value (wei)</span>
          <span class="detail-value mono number">{spandex.router_value}</span>
        </div>
      {/if}

      <!-- Input/output amounts in wei -->
      {#if quote.input_amount_raw}
        <div class="detail-field">
          <span class="detail-label">Input Amount (wei)</span>
          <span class="detail-value mono number">{quote.input_amount_raw}</span>
        </div>
      {/if}
      {#if quote.output_amount_raw}
        <div class="detail-field">
          <span class="detail-label">Output Amount (wei)</span>
          <span class="detail-value mono number">{quote.output_amount_raw}</span>
        </div>
      {/if}

      <!-- Approval info (Spandex only) -->
      {#if spandex?.approval_token}
        <div class="detail-field">
          <span class="detail-label">Approval Token</span>
          <span class="detail-value mono">{spandex.approval_token}</span>
        </div>
        <div class="detail-field">
          <span class="detail-label">Approval Spender</span>
          <span class="detail-value mono">{spandex.approval_spender}</span>
        </div>
      {/if}

      <!-- Approval target (Curve only) -->
      {#if curve?.approval_target}
        <div class="detail-field">
          <span class="detail-label">Approval Target</span>
          <span class="detail-value mono">{curve.approval_target}</span>
        </div>
      {/if}

      <!-- Gas info -->
      {#if hasGasCost}
        <div class="detail-field">
          <span class="detail-label">Gas Cost</span>
          <span class="detail-value number">{quote.gas_cost_eth} ETH</span>
        </div>
        {#if hasGasUsed}
          <div class="detail-field">
            <span class="detail-label">Gas Units</span>
            <span class="detail-value number">{quote.gas_used}</span>
          </div>
        {/if}
        {#if gasPriceGwei}
          <div class="detail-field">
            <span class="detail-label">Gas Price</span>
            <span class="detail-value number">{gasPriceGwei} gwei</span>
          </div>
        {/if}
      {:else}
        <div class="detail-field">
          <span class="detail-label">Gas Used</span>
          <span class="detail-value number">{hasGasUsed ? quote.gas_used : "N/A"}</span>
        </div>
      {/if}

      <!-- Net value after gas -->
      {#if hasNetValue}
        <div class="detail-field">
          <span class="detail-label">Net Value (after gas)</span>
          <span class="detail-value number">{quote.net_value_eth} ETH</span>
        </div>
      {/if}

      <!-- Slippage (Spandex only) -->
      {#if spandex?.slippage_bps}
        <div class="detail-field">
          <span class="detail-label">Slippage</span>
          <span class="detail-value number">{spandex.slippage_bps} bps</span>
        </div>
      {/if}

      <!-- Curve route -->
      {#if hasRoute}
        <div class="detail-field">
          <span class="detail-label">Route ({curveRoute.length} steps)</span>
          <div class="route-steps">
            {#each curveRoute as step, i}
              <div class="route-step">
                <div class="route-step-header">
                  Step {i + 1}: {step.poolName ?? step.poolId ?? "Unknown Pool"}
                </div>
                {#if step.inputCoinAddress}
                  <div class="route-step-field">
                    <span class="detail-label">Input</span>
                    <span class="detail-value mono">
                      {routeSymbols[step.inputCoinAddress.toLowerCase()] ?? ""}
                      {step.inputCoinAddress}
                    </span>
                  </div>
                {/if}
                {#if step.outputCoinAddress}
                  <div class="route-step-field">
                    <span class="detail-label">Output</span>
                    <span class="detail-value mono">
                      {routeSymbols[step.outputCoinAddress.toLowerCase()] ?? ""}
                      {step.outputCoinAddress}
                    </span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
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
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .detail-value.mono {
    font-family: monospace;
  }

  .detail-value.compact {
    font-size: 0.7rem;
    word-break: break-all;
  }

  .detail-value.number {
    font-family: monospace;
    font-weight: 600;
  }

  .route-steps {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .route-step {
    padding: 0.5rem;
    border: 1px solid var(--border-light, #e0e0e0);
    background: var(--bg-card, #fff);
  }

  .route-step-header {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .route-step-field {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin-top: 0.25rem;
  }
</style>
