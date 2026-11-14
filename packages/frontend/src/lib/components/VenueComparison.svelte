<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { formatUnits } from "viem";
  import { apiClient } from "../api.js";
  import type { components } from "../../generated/api-types.js";
  import type { CompareParams, Quote } from "../stores/comparisonStore.svelte.js";
  import { autoRefreshStore } from "../stores/autoRefreshStore.svelte.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  import { settingsStore } from "../stores/settingsStore.svelte.js";
  import { formatQuoteRate } from "../quote-rates.js";
  import InfoPopover from "./InfoPopover.svelte";
  import TokenSymbol from "./TokenSymbol.svelte";

  let {
    params,
    quotes,
    stale,
    dexExpiresAt,
    dexStatus,
    dex,
  }: {
    params: CompareParams | null;
    quotes: Quote[];
    stale: boolean;
    dexExpiresAt: number;
    dexStatus?: Snippet;
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

  const comparison = $derived.by(() => {
    if (!params || stale || loading || error || expired || dexExpired || !result || !bestDex)
      return null;
    const targetOut = params.mode === "targetOut";
    const dex = BigInt(targetOut ? bestDex.input_amount_raw : bestDex.output_amount_raw);
    const coinbase = BigInt(targetOut ? result.input_amount_raw : result.output_amount_raw);
    if (dex <= 0n || coinbase <= 0n) return null;
    if (coinbase === dex) return { winner: "tie", difference: "" };
    const coinbaseWins = targetOut ? coinbase < dex : coinbase > dex;
    const best = coinbaseWins ? coinbase : dex;
    const worse = coinbaseWins ? dex : coinbase;
    const deviation = targetOut ? worse - best : best - worse;
    const basisPoints = (deviation * 10_000n + best / 2n) / best;
    const percent = basisPoints === 0n ? "<0.01%" : `${formatUnits(basisPoints, 2)}%`;
    return {
      winner: coinbaseWins ? "coinbase" : "dex",
      difference: `${percent} ${targetOut ? "more paid" : "less received"}`,
    };
  });
</script>

{#snippet winnerStar()}
  <span
    role="img"
    aria-label={comparison?.winner === "tie" ? "Tied quoted price" : "Better quoted price"}>⭐</span
  >
{/snippet}

{#snippet amounts(
  input: string,
  inputSymbol: string,
  output: string,
  outputSymbol: string,
  chainId: number,
  from: string,
  to: string,
  venue: "dex" | "coinbase"
)}
  {@const difference =
    comparison && comparison.winner !== "tie" && comparison.winner !== venue
      ? comparison.difference
      : ""}
  <div class="amounts">
    <div>
      <div>
        <span class="amount-label">Sell</span>
        {#if params?.mode === "targetOut"}<div class="price-difference">
            {difference}
          </div>{/if}
      </div>
      <strong
        ><span>{input}</span> <TokenSymbol {chainId} address={from} symbol={inputSymbol} /></strong
      >
    </div>
    <div>
      <div>
        <span class="amount-label">Buy</span>
        {#if params?.mode === "exactIn"}<div class="price-difference">
            {difference}
          </div>{/if}
      </div>
      <strong
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
              {#if comparison?.winner === "dex" || comparison?.winner === "tie"}{@render winnerStar()}{/if}
            </span>
          </h3>
          <InfoPopover label="About DEX prices">
            <strong>Best DEX price before gas</strong>
            <span
              >Prices include provider trading fees. The comparison excludes gas and approval costs.</span
            >
            <span>The selected route can differ because of gas costs or your route choice.</span>
            {#if bestDex}
              <span
                >1 {bestDex.to_symbol} = {formatQuoteRate(
                  bestDex.input_amount,
                  bestDex.output_amount
                )}
                {bestDex.from_symbol}</span
              >
            {/if}
          </InfoPopover>
        </header>
        {@render dexStatus?.()}
        {#if bestDex}
          {@render amounts(
            bestDex.input_amount,
            bestDex.from_symbol,
            bestDex.output_amount,
            bestDex.to_symbol,
            bestDex.chainId,
            bestDex.from,
            bestDex.to,
            "dex"
          )}
          <div role="group" aria-label="DEX average trade price" class="quote-rates">
            <span class="row-label">Rate</span>
            <span
              >1 {bestDex.from_symbol} = {formatQuoteRate(
                bestDex.output_amount,
                bestDex.input_amount
              )}
              {bestDex.to_symbol}</span
            >
          </div>
          <div class="venue-row">
            <span class="row-label">Best price</span><span>{bestDex.provider}</span>
          </div>
          {#if dex}<a class="trade-link" href="#selected-dex-route">Review DEX route ↓</a>{/if}
        {:else}
          <p class="venue-status">{stale ? "Previous DEX quotes" : "No matching DEX price"}</p>
        {/if}
      </section>
      {#if params}
        <section aria-label="Coinbase Advanced estimate" class="venue-card coinbase-estimate">
          <header class="venue-heading">
            <div class="coinbase-heading-row">
              <h3 class="venue-title">
                <span>Coinbase Advanced</span>
                <span class="winner-slot">
                  {#if comparison?.winner === "coinbase" || comparison?.winner === "tie"}{@render winnerStar()}{/if}
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
              <InfoPopover label="About the Coinbase estimate">
                <strong>Mobile trading not verified</strong>
                <span>
                  Coinbase Advanced is part of the Coinbase iPhone and Android app.
                  {#if result}
                    This order book does not confirm that your account can {result.side === "BUY"
                      ? "buy"
                      : "sell"}
                    {result.side === "BUY" ? result.output_symbol : result.input_symbol} in the {result.product_id}
                    market.
                  {/if}
                  Check availability in your app before moving funds.
                </span>
                <a
                  href="https://help.coinbase.com/en/pro/managing-my-account/account-information/transitioning-to-advanced-trade"
                  target="_blank"
                  rel="noopener noreferrer">About Advanced in the Coinbase app ↗</a
                >
                {#if result}
                  <span>
                    {result.fee_percent === null
                      ? "This estimate excludes trading fees."
                      : `Includes an assumed ${result.fee_percent}% fee (${result.fee_amount} ${result.fee_symbol}).`}
                  </span>
                  {#if result.limit_only}
                    <span
                      >This market accepts limit orders only. The estimate assumes a limit price
                      that takes available liquidity.</span
                    >
                  {/if}
                  <span
                    >{result.product_id} · Order book
                    <time datetime={result.as_of}
                      >{new Date(result.as_of).toLocaleTimeString()}</time
                    ></span
                  >
                  {#if rate && inverseRate}<span
                      >{params.mode === "targetOut"
                        ? `1 ${result.input_symbol} = ${rate} ${result.output_symbol}`
                        : `1 ${result.output_symbol} = ${inverseRate} ${result.input_symbol}`}</span
                    >{/if}
                {/if}
                <span
                  >Assumes funds are already on Coinbase. Excludes deposits, withdrawals, network
                  costs, and wrapping.</span
                >
              </InfoPopover>
            </div>
          </header>
          <div class="coinbase-status" class:has-estimate={result !== null}>
            {#if result}
              <button
                class="coinbase-fee"
                type="button"
                aria-haspopup="dialog"
                title="Edit Coinbase taker fee"
                onclick={(event) => {
                  event.currentTarget.focus();
                  settingsStore.openSettings("coinbase-fee");
                }}
              >
                {result.fee_percent === null
                  ? "Before trading fees"
                  : `Assumed fee ${result.fee_percent}%`}
              </button>
            {/if}
            <span role="status">
              {#if loading}
                {result ? "Refreshing estimate…" : error || "Loading order book…"}
              {:else if error}
                {result ? "Refresh failed · Previous estimate" : error}
              {:else if expired}
                Estimate expired.
              {:else if result && dexExpired && !stale}
                DEX quotes expired.
              {:else if result?.limit_only}
                Limit only
              {/if}
            </span>
          </div>
          <div aria-busy={loading}>
            {#if result}
              {@render amounts(
                result.input_amount,
                result.input_symbol,
                result.output_amount,
                result.output_symbol,
                params.chainId,
                params.from,
                params.to,
                "coinbase"
              )}
              {#if rate}
                <div role="group" aria-label="Coinbase average trade price" class="quote-rates">
                  <span class="row-label">Rate</span>
                  <span
                    >{params.mode === "targetOut" && inverseRate
                      ? `1 ${result.output_symbol} = ${inverseRate} ${result.input_symbol}`
                      : `1 ${result.input_symbol} = ${rate} ${result.output_symbol}`}</span
                  >
                </div>
              {/if}
              <a
                class="trade-link"
                href={result.trade_url}
                target="_blank"
                rel="noopener noreferrer">Open Coinbase Advanced ↗</a
              >
            {/if}
          </div>
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
    margin-top: 0.5rem;
    scroll-margin-top: 1rem;
  }
  .venue-status {
    color: var(--text-muted);
    font-size: 0.75rem;
    min-height: 2.25rem;
    overflow-wrap: anywhere;
  }
  .coinbase-status {
    display: grid;
    align-items: center;
    min-height: 44px;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .coinbase-status.has-estimate {
    grid-template-columns: 8rem minmax(0, 1fr);
    gap: 0.375rem;
  }
  .coinbase-fee {
    width: 100%;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-transform: none;
    letter-spacing: normal;
    text-decoration: underline;
    text-align: start;
  }
  .coinbase-fee:hover {
    background: var(--bg-hover);
  }
  .venue-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.375rem;
    align-items: start;
  }
  .venue-card {
    min-width: 0;
    border: 1px solid var(--border-light);
    padding: 0.125rem 0.625rem;
    background: var(--bg-muted);
    overflow-wrap: anywhere;
  }
  .venue-heading,
  .coinbase-heading-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
  }
  .coinbase-heading-row {
    width: 100%;
  }
  .venue-title {
    display: flex;
    align-items: baseline;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
    line-height: 1.2;
  }
  .winner-slot {
    display: inline-flex;
    align-items: center;
    flex: 0 0 1.125rem;
    height: 1em;
  }
  .coinbase-heading-row .venue-title > :first-child {
    min-width: 0;
  }
  .estimate-refresh {
    display: flex;
    flex: none;
    align-items: center;
    margin-left: auto;
  }
  .estimate-refresh-button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
  }
  .estimate-refresh-button:hover {
    background: var(--bg-hover);
  }
  .estimate-refresh-button[aria-disabled="true"] {
    opacity: 0.5;
    cursor: wait;
  }
  .estimate-countdown {
    width: 2.25rem;
    color: var(--text-muted);
    font: 0.6875rem monospace;
    text-align: center;
  }
  h3 {
    font-size: 0.9375rem;
    margin: 0;
  }
  .amounts > div,
  .quote-rates,
  .venue-row {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 0.5rem;
    min-height: 1.375rem;
    font-size: 0.8125rem;
  }
  .amounts strong {
    text-align: right;
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .amounts > div {
    grid-template-columns: min(47%, 8rem) minmax(0, 1fr);
    align-items: start;
  }
  .price-difference {
    font-size: 0.75rem;
    line-height: 1;
    min-height: 2em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .amounts strong > span:first-child {
    display: block;
  }
  .row-label,
  .amount-label {
    color: var(--text-muted);
  }
  .quote-rates > :last-child,
  .venue-row > :last-child {
    text-align: right;
  }
  .trade-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 0.8125rem;
    color: var(--text);
  }
  @media (min-width: 600px) {
    .venue-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
