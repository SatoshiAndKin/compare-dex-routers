<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { apiClient } from "../api.js";
  import type { components } from "../../generated/api-types.js";
  import type { CompareParams, Quote } from "../stores/comparisonStore.svelte.js";
  import { autoRefreshStore } from "../stores/autoRefreshStore.svelte.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  import { formatQuoteRate } from "../quote-rates.js";
  import TokenSymbol from "./TokenSymbol.svelte";

  let {
    params,
    quotes,
    stale,
    dexExpiresAt,
    dex,
  }: {
    params: CompareParams | null;
    quotes: Quote[];
    stale: boolean;
    dexExpiresAt: number;
    dex?: Snippet;
  } = $props();
  type ReadyEstimate = Extract<components["schemas"]["CoinbaseEstimate"], { status: "ready" }>;
  let result = $state<ReadyEstimate | null>(null);
  let lastTrade = "";
  let error = $state("");
  let loading = $state(false);
  let revision = $state(0);
  let now = $state(Date.now());
  let overview = $state<HTMLDivElement | null>(null);
  let overviewHeight = $state(0);
  const dexExpired = $derived(now >= dexExpiresAt);
  const expired = $derived(result !== null && now >= Date.parse(result.expires_at));
  const overviewPending = $derived(stale || loading || expired || dexExpired);

  // Save settled geometry. A refresh must not move the wallet controls below it.
  $effect(() => {
    if (!overviewPending && overview)
      untrack(() => {
        overviewHeight = overview?.getBoundingClientRect().height ?? 0;
      });
  });

  const rate = $derived(result && formatQuoteRate(result.output_amount, result.input_amount));
  const inverseRate = $derived(
    result && formatQuoteRate(result.input_amount, result.output_amount)
  );

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const current = params;
    const assumedFee = preferencesStore.coinbaseTakerFeePercent;
    void revision;
    const query = current && {
      chainId: current.chainId,
      from: current.from,
      to: current.to,
      amount: current.amount,
      mode: current.mode,
    };
    const trade = JSON.stringify(query);
    if (trade !== lastTrade) {
      result = null;
      error = "";
    }
    lastTrade = trade;
    loading = Boolean(query);
    if (!query) return;
    const controller = new AbortController();
    void apiClient
      .GET("/coinbase-estimate", {
        params: {
          query: {
            ...query,
            ...(assumedFee === "" ? {} : { takerFeePercent: assumedFee }),
          },
        },
        signal: controller.signal,
      })
      .then(({ data, error: responseError }) => {
        if (controller.signal.aborted) return;
        if (responseError || !data)
          error = responseError?.error ?? "Coinbase estimate unavailable.";
        else if (data.status === "unavailable") error = data.reason;
        else {
          result = data;
          error = "";
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) error = "Coinbase estimate unavailable.";
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          now = Date.now();
          loading = false;
        }
      });
    return () => controller.abort();
  });

  const bestDex = $derived.by(() => {
    if (!params) return null;
    const current = quotes.filter(
      (q) =>
        q.simulation_status !== "failed" &&
        q.chainId === params.chainId &&
        q.from.toLowerCase() === params.from.toLowerCase() &&
        q.to.toLowerCase() === params.to.toLowerCase() &&
        q.mode === params.mode &&
        q.amount === params.amount
    );
    return current.reduce<Quote | null>((best, quote) => {
      if (!best) return quote;
      const targetOut = params.mode === "targetOut";
      const amount = BigInt(targetOut ? quote.input_amount_raw : quote.output_amount_raw);
      const previous = BigInt(targetOut ? best.input_amount_raw : best.output_amount_raw);
      return (targetOut ? amount < previous : amount > previous) ? quote : best;
    }, null);
  });

  const winner = $derived.by(() => {
    if (!params || stale || loading || error || expired || dexExpired || !result || !bestDex)
      return null;
    const targetOut = params.mode === "targetOut";
    const best = BigInt(targetOut ? bestDex.input_amount_raw : bestDex.output_amount_raw);
    const coinbase = BigInt(targetOut ? result.input_amount_raw : result.output_amount_raw);
    if (coinbase === best) return "tie";
    return (targetOut ? coinbase < best : coinbase > best) ? "coinbase" : "dex";
  });
</script>

{#snippet winnerStar()}
  <span role="img" aria-label={winner === "tie" ? "Tied quoted price" : "Better quoted price"}
    >⭐</span
  >
{/snippet}

{#snippet amounts(
  input: string,
  inputSymbol: string,
  output: string,
  outputSymbol: string,
  chainId: number,
  from: string,
  to: string
)}
  <div class="amounts">
    <div>
      <span class="amount-label">You pay</span><strong
        ><span>{input}</span> <TokenSymbol {chainId} address={from} symbol={inputSymbol} /></strong
      >
    </div>
    <div>
      <span class="amount-label">You receive</span><strong
        ><span>{output}</span> <TokenSymbol {chainId} address={to} symbol={outputSymbol} /></strong
      >
    </div>
  </div>
{/snippet}

<div
  class="venue-overview"
  bind:this={overview}
  style:min-height={overviewPending ? `${overviewHeight}px` : undefined}
>
  {#if params || dex}
    <div class="venue-grid">
      <section aria-label="DEX router quotes" class="venue-card">
        <header class="venue-heading">
          <h3 class="venue-title">
            <span>DEX routers</span>
            <span class="winner-slot">
              {#if winner === "dex" || winner === "tie"}{@render winnerStar()}{/if}
            </span>
          </h3>
          <p>Swap from your wallet</p>
        </header>
        {#if bestDex}
          <p class="provider-name">Best DEX price before gas · via {bestDex.provider}</p>
          {@render amounts(
            bestDex.input_amount,
            bestDex.from_symbol,
            bestDex.output_amount,
            bestDex.to_symbol,
            bestDex.chainId,
            bestDex.from,
            bestDex.to
          )}
          <div role="group" aria-label="DEX average trade price" class="quote-rates">
            <p class="amount-label">Average trade price</p>
            <p>
              1 {bestDex.from_symbol} = {formatQuoteRate(
                bestDex.output_amount,
                bestDex.input_amount
              )}
              {bestDex.to_symbol}
            </p>
            <p>
              1 {bestDex.to_symbol} = {formatQuoteRate(bestDex.input_amount, bestDex.output_amount)}
              {bestDex.from_symbol}
            </p>
          </div>
          {#if bestDex.simulation_status === "succeeded"}<p>
              Wallet simulation passed for this DEX quote.
            </p>
          {:else}<p>Price only; wallet simulation not run.</p>{/if}
          <p>
            DEX prices include provider trading fees. Gas and approval costs are excluded from this
            comparison. The selected route can differ because of gas costs or your route choice.
          </p>
          {#if dex}<a class="trade-link" href="#selected-dex-route">Review DEX route ↓</a>{/if}
        {:else}
          <p>
            {stale
              ? "Previous DEX quotes. Refresh to compare this trade."
              : "No matching DEX price is available."}
          </p>
        {/if}
      </section>
      {#if params}
        <section aria-label="Coinbase Advanced estimate" class="venue-card coinbase-estimate">
          <header class="venue-heading">
            <div class="coinbase-heading-row">
              <h3 class="venue-title">
                <span>Coinbase Advanced</span>
                <span class="winner-slot">
                  {#if winner === "coinbase" || winner === "tie"}{@render winnerStar()}{/if}
                </span>
              </h3>
              <div class="estimate-refresh">
                <button
                  type="button"
                  class="estimate-refresh-button"
                  aria-label="Refresh estimate"
                  title="Refresh Coinbase estimate"
                  aria-disabled={loading}
                  onclick={() => {
                    if (!loading) revision++;
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 4v5h-5m5 0a8 8 0 1 0 0 6" />
                  </svg>
                </button>
                <span class="estimate-countdown" role="timer" aria-label="Coinbase auto-refresh">
                  {#if loading}…
                  {:else if autoRefreshStore.paused}Paused
                  {:else if autoRefreshStore.active}{autoRefreshStore.countdown}s
                  {:else}—{/if}
                </span>
              </div>
            </div>
            <p>Estimate for funds already on Coinbase</p>
          </header>
          <p class="provider-name" role="status">
            {#if loading}
              {result ? "Refreshing estimate…" : error || "Loading Coinbase order book…"}
            {:else if error}
              {result ? "Refresh failed. Showing the last estimate." : error}
            {:else if expired}
              Estimate expired.
            {:else if result && dexExpired && !stale}
              DEX quotes expired.
            {:else if result}
              Public order-book estimate · {result.product_id}
            {/if}
          </p>
          <div aria-busy={loading}>
            {#if result}
              {@render amounts(
                result.input_amount,
                result.input_symbol,
                result.output_amount,
                result.output_symbol,
                params.chainId,
                params.from,
                params.to
              )}
              {#if rate && inverseRate}
                <div role="group" aria-label="Coinbase average trade price" class="quote-rates">
                  <p class="amount-label">Average trade price</p>
                  <p>1 {result.input_symbol} = {rate} {result.output_symbol}</p>
                  <p>1 {result.output_symbol} = {inverseRate} {result.input_symbol}</p>
                </div>
              {/if}
              <p>
                {result.fee_percent === null
                  ? "Before trading fees; set your taker rate in Settings for an after-fee estimate."
                  : `Includes an assumed ${result.fee_percent}% fee (${result.fee_amount} ${result.fee_symbol}).`}
              </p>
              <div class="availability">
                <strong>Mobile trading not verified</strong>
                <p>
                  Coinbase Advanced is part of the Coinbase iPhone and Android app. This public
                  order book does not confirm that your account can {result.side === "BUY"
                    ? "buy"
                    : "sell"}
                  {result.side === "BUY" ? result.output_symbol : result.input_symbol} in the {result.product_id}
                  market. Check that this trade is available in your app before moving funds.
                </p>
                <a
                  href="https://help.coinbase.com/en/pro/managing-my-account/account-information/transitioning-to-advanced-trade"
                  target="_blank"
                  rel="noopener noreferrer">About Advanced in the Coinbase app ↗</a
                >
              </div>
              {#if result.limit_only}<p>
                  This market accepts limit orders only. The estimate assumes a limit price that
                  takes available order-book liquidity.
                </p>{/if}
              <p>
                {result.product_id} · Order book:
                <time datetime={result.as_of}>{new Date(result.as_of).toLocaleTimeString()}</time>
              </p>
              <a
                class="trade-link"
                href={result.trade_url}
                target="_blank"
                rel="noopener noreferrer">Open Coinbase Advanced ↗</a
              >
            {/if}
          </div>
          <p class="estimate-note">
            Estimate from public order-book depth. Assumes funds are already on Coinbase. Excludes
            deposits, withdrawals, network costs, and wrapping. Check asset/network support,
            order-size rounding, and the final quote on Coinbase. This estimate does not change DEX
            rankings.
          </p>
        </section>
      {/if}
    </div>
  {/if}
</div>
{#if dex}
  <section id="selected-dex-route" class="selected-dex-route" aria-label="Selected DEX route">
    <h3>Selected DEX route</h3>
    {@render dex()}
  </section>
{/if}

<style>
  .venue-overview {
    display: flow-root;
  }
  .selected-dex-route {
    margin-top: 1.5rem;
    scroll-margin-top: 1rem;
  }
  .provider-name {
    color: var(--text-muted);
    font-size: 0.75rem;
    min-height: 3em;
  }
  .venue-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .venue-card {
    min-width: 0;
    border: 2px solid var(--border);
    padding: 1rem;
    background: var(--bg-card);
    overflow-wrap: anywhere;
  }
  .venue-heading {
    margin-bottom: 0.75rem;
  }
  .venue-title {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }
  .winner-slot {
    flex: 0 0 1.25rem;
  }
  .coinbase-heading-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
  }
  .coinbase-heading-row h3 {
    margin: 0;
  }
  .estimate-refresh {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .estimate-refresh-button {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
  }
  .estimate-refresh-button[aria-disabled="true"] {
    opacity: 0.5;
    cursor: wait;
  }
  .estimate-countdown {
    width: 3.125rem;
    color: var(--text-muted);
    font: 0.75rem monospace;
    text-align: center;
  }
  h3 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
  }
  p {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .venue-heading p {
    color: var(--text-muted);
    margin: 0.5rem 0 0;
  }
  .amounts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .amounts strong {
    display: flex;
    flex-wrap: wrap;
    align-content: start;
    align-items: center;
    column-gap: 0.375em;
    font-size: clamp(1rem, 2.5vw, 1.5rem);
    min-height: 2.4em;
    font-family: monospace;
    line-height: 1.2;
  }
  .amounts strong > span {
    min-width: 0;
  }
  .amount-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0.25rem 0;
  }
  .quote-rates p {
    margin: 0.25rem 0;
  }
  .quote-rates {
    font-family: monospace;
    font-size: 0.875rem;
  }
  .availability {
    border-left: 3px solid var(--border);
    background: var(--bg-muted);
    padding: 0.75rem;
    font-size: 0.8125rem;
    margin: 0.75rem 0;
  }
  .availability p {
    margin: 0.5rem 0;
  }
  .trade-link {
    display: inline-block;
    padding: 0.5rem;
    min-height: 2.75rem;
    margin: 0.5rem 0 0;
    box-sizing: border-box;
  }
  a {
    color: var(--text);
    text-decoration: underline;
  }
  .estimate-note {
    color: var(--text-muted);
  }
  @media (min-width: 760px) {
    .venue-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .amounts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
