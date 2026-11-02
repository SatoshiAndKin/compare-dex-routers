<script lang="ts">
  import { formatUnits } from "viem";
  import { apiClient } from "../api.js";
  import type { components } from "../../generated/api-types.js";
  import type { CompareParams, Quote } from "../stores/comparisonStore.svelte.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  import { formatQuoteRate } from "../quote-rates.js";

  let {
    params,
    quotes,
    stale,
    dexExpiresAt,
  }: {
    params: CompareParams | null;
    quotes: Quote[];
    stale: boolean;
    dexExpiresAt: number;
  } = $props();
  let result = $state<components["schemas"]["CoinbaseEstimate"] | null>(null);
  let error = $state("");
  let loading = $state(false);
  let revision = $state(0);
  let now = $state(Date.now());
  const dexExpired = $derived(now >= dexExpiresAt);
  const expired = $derived(result?.status === "ready" && now > Date.parse(result.expires_at));

  const rate = $derived(
    result?.status === "ready" ? formatQuoteRate(result.output_amount, result.input_amount) : null
  );
  const inverseRate = $derived(
    result?.status === "ready" ? formatQuoteRate(result.input_amount, result.output_amount) : null
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
    result = null;
    error = "";
    loading = Boolean(current);
    if (!current) return;
    const controller = new AbortController();
    void apiClient
      .GET("/coinbase-estimate", {
        params: {
          query: {
            chainId: current.chainId,
            from: current.from,
            to: current.to,
            amount: current.amount,
            mode: current.mode,
            ...(assumedFee === "" ? {} : { takerFeePercent: assumedFee }),
          },
        },
        signal: controller.signal,
      })
      .then(({ data, error: responseError }) => {
        if (controller.signal.aborted) return;
        if (responseError || !data)
          error = responseError?.error ?? "Coinbase estimate unavailable.";
        else result = data;
        now = Date.now();
      })
      .catch(() => {
        if (!controller.signal.aborted) error = "Coinbase estimate unavailable. Refresh to retry.";
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  const difference = $derived.by(() => {
    if (
      !params ||
      stale ||
      loading ||
      expired ||
      dexExpired ||
      result?.status !== "ready" ||
      result.fee_percent === null ||
      !quotes.length
    )
      return null;
    const current = quotes.filter(
      (q) =>
        q.simulation_status !== "failed" &&
        q.chainId === params.chainId &&
        q.from.toLowerCase() === params.from.toLowerCase() &&
        q.to.toLowerCase() === params.to.toLowerCase() &&
        q.mode === params.mode &&
        q.amount === params.amount
    );
    if (!current.length) return null;
    const targetOut = params.mode === "targetOut";
    const amounts = current.map((q) =>
      BigInt(targetOut ? q.input_amount_raw : q.output_amount_raw)
    );
    const best = amounts.reduce((a, b) => (targetOut ? (a < b ? a : b) : a > b ? a : b));
    const coinbase = BigInt(targetOut ? result.input_amount_raw : result.output_amount_raw);
    const delta = coinbase - best;
    const magnitude = delta < 0n ? -delta : delta;
    return delta === 0n
      ? "Same quoted amount as the best DEX price before gas and transfers."
      : `${formatUnits(magnitude, targetOut ? result.input_decimals : result.output_decimals)} ${targetOut ? result.input_symbol : result.output_symbol} ${delta > 0n ? "more" : "less"} ${targetOut ? "input required" : "output"} than the best DEX price before gas and transfers.`;
  });
</script>

{#if params}
  <section aria-label="Coinbase Advanced estimate" class="coinbase-estimate">
    <h3>Coinbase Advanced estimate</h3>
    <div aria-live="polite" aria-busy={loading}>
      {#if loading}<p>Loading Coinbase order book…</p>
      {:else if error}<p>{error}</p>
      {:else if result?.status === "unavailable"}<p>{result.reason}</p>
      {:else if result?.status === "ready"}
        <p class="amounts">
          {result.input_amount}
          {result.input_symbol} → {result.output_amount}
          {result.output_symbol}
        </p>
        {#if rate && inverseRate}
          <div role="group" aria-label="Coinbase average trade price" class="quote-rates">
            <p>Average trade price</p>
            <p>1 {result.input_symbol} = {rate} {result.output_symbol}</p>
            <p>1 {result.output_symbol} = {inverseRate} {result.input_symbol}</p>
          </div>
        {/if}
        <p>
          {result.fee_percent === null
            ? "Before trading fees; set your taker rate in Settings for an after-fee estimate."
            : `Includes an assumed ${result.fee_percent}% fee (${result.fee_amount} ${result.fee_symbol}).`}
        </p>
        {#if result.limit_only}<p>
            This market accepts limit orders only. The estimate assumes a limit price that takes
            available order-book liquidity.
          </p>{/if}
        {#if expired}<p>Estimate expired. Refresh before comparing prices.</p>{/if}
        {#if dexExpired && !stale && result.fee_percent !== null}<p>
            DEX quotes expired. Refresh quotes to compare prices.
          </p>{/if}
        {#if difference}<p class="difference">{difference}</p>{/if}
        <p>
          {result.product_id} · Order book:
          <time datetime={result.as_of}>{new Date(result.as_of).toLocaleTimeString()}</time>
        </p>
        <a href={result.trade_url} target="_blank" rel="noopener noreferrer"
          >Open Coinbase Advanced ↗</a
        >
      {/if}
    </div>
    <button type="button" onclick={() => revision++} disabled={loading}>Refresh estimate</button>
    <p>
      Estimate from public order-book depth. Assumes funds are already on Coinbase. Excludes
      deposits, withdrawals, network costs, and wrapping. Check asset/network support, order-size
      rounding, and the final quote on Coinbase. This estimate does not change DEX rankings.
    </p>
  </section>
{/if}

<style>
  .coinbase-estimate {
    border: 2px solid var(--border);
    padding: 1rem;
    margin-top: 1rem;
  }
  h3 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  p {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .amounts,
  .difference {
    font-weight: 700;
  }
  .amounts {
    font-size: 1.25rem;
  }
  .quote-rates p {
    margin: 0.25rem 0;
  }
  button {
    padding: 0.5rem;
    min-height: 2.75rem;
  }
  a {
    color: var(--text);
    text-decoration: underline;
  }
</style>
