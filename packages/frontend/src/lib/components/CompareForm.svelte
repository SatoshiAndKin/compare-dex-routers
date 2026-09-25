<script lang="ts">
  /**
   * CompareForm — container assembling all form components.
   * Calls the comparison API and updates the comparison store on submit.
   */
  import { formStore } from "../stores/formStore.svelte.js";
  import {
    comparisonStore,
    requestQuotes,
    type CompareParams,
  } from "../stores/comparisonStore.svelte.js";
  import { updateUrl } from "../stores/urlSync.svelte.js";
  import { preferencesStore } from "../stores/preferencesStore.svelte.js";
  import { autoRefreshStore, AUTO_REFRESH_SECONDS } from "../stores/autoRefreshStore.svelte.js";
  import { walletStore } from "../stores/walletStore.svelte.js";
  import { balanceStore } from "../stores/balanceStore.svelte.js";
  import { onDestroy, untrack, tick } from "svelte";
  import { transactionStore } from "../stores/transactionStore.svelte.js";
  import { exactAmount, isNativeToken } from "../native.js";
  import { gasMargin, transactionFees, hex, readBalance } from "../wallet-rpc.js";
  import ChainSelector from "./ChainSelector.svelte";
  import TokenInput from "./TokenInput.svelte";
  import AmountFields from "./AmountFields.svelte";
  import SlippagePresets from "./SlippagePresets.svelte";
  import AutoRefreshIndicator from "./AutoRefreshIndicator.svelte";

  const AUTO_COMPARE_DELAY_MS = 600;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let wasBusy = false;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function currentParams(): CompareParams | null {
    const chainId = formStore.chainId;
    const from = formStore.fromToken?.address;
    const to = formStore.toToken?.address;
    const amount = formStore.mode === "exactIn" ? formStore.sellAmount : formStore.receiveAmount;
    const sender = walletStore.address ?? undefined;
    const slippageBps = formStore.slippageBps;
    const mode = formStore.mode;
    if (!formStore.canSubmit || !from || !to || !amount) return null;
    return { chainId, from, to, amount, sender, slippageBps, mode };
  }

  $effect(() => {
    const params = currentParams();
    const walletChain = walletStore.chainId;
    const provider = walletStore.provider;
    // Wallet state is part of the execution context even when the form chain stays fixed.
    void walletChain;
    void provider;
    untrack(() => {
      generation++;
      clearTimer();
      transactionStore.invalidate();
      comparisonStore.invalidate();
      autoRefreshStore.stop();
      if (params)
        timer = setTimeout(() => {
          void runCompare(params, generation);
        }, AUTO_COMPARE_DELAY_MS);
    });
    return clearTimer;
  });

  $effect(() => {
    const busy = transactionStore.busy;
    if (wasBusy && !busy)
      untrack(() => {
        clearTimer();
        const params = currentParams();
        if (params) void runCompare(params, generation);
      });
    wasBusy = busy;
  });

  onDestroy(() => {
    generation++;
    clearTimer();
    comparisonStore.invalidate();
    autoRefreshStore.stop();
    transactionStore.invalidate();
  });

  async function runCompare(params: CompareParams, epoch: number): Promise<void> {
    if (epoch !== generation || transactionStore.busy) return;
    autoRefreshStore.stop();
    updateUrl(params);
    preferencesStore.saveForChain(params.chainId);
    await comparisonStore.compare(params);
    if (epoch !== generation || transactionStore.busy) return;
    autoRefreshStore.start(AUTO_REFRESH_SECONDS, () => {
      const current = currentParams();
      if (current) void runCompare(current, epoch);
    });
    if (comparisonStore.quotes.length === 0) {
      autoRefreshStore.setErrorMessage("Quote request failed. The next refresh will retry.");
    }
  }

  let fillingBalance = $state(false);
  let balanceMessage = $state("");
  async function useSellBalance(): Promise<void> {
    const token = formStore.fromToken;
    const account = walletStore.address;
    const provider = walletStore.provider;
    const chainId = formStore.chainId;
    if (walletStore.chainId !== chainId || balanceStore.from.status === "wrong_network") {
      await walletStore.switchChain(chainId);
      return;
    }
    if (
      !token ||
      token.decimals === null ||
      !account ||
      !provider ||
      balanceStore.from.raw === null
    )
      return;
    const epoch = generation;
    fillingBalance = true;
    balanceMessage = "";
    try {
      const checkWallet = async () => {
        const [chain, accounts] = await Promise.all([
          provider.request({ method: "eth_chainId" }),
          provider.request({ method: "eth_accounts" }),
        ]);
        if (
          typeof chain !== "string" ||
          Number(BigInt(chain)) !== chainId ||
          !Array.isArray(accounts) ||
          accounts[0]?.toLowerCase() !== account.toLowerCase()
        )
          throw new Error("Wallet account or network changed. Refresh balances.");
      };
      await checkWallet();
      let raw = await readBalance(provider, account, token.address);
      if (isNativeToken(token.address)) {
        if (!formStore.toToken)
          throw new Error("Select a receive token before estimating the gas reserve.");
        if (raw <= 0n) throw new Error("No native balance is available after reserving gas.");
        const params: CompareParams = {
          chainId,
          from: token.address,
          to: formStore.toToken.address,
          amount: exactAmount(raw, token.decimals),
          mode: "exactIn",
          slippageBps: formStore.slippageBps,
          sender: account,
        };
        const preview = await requestQuotes(params);
        const providerName = comparisonStore.activeProvider ?? preview.recommendation;
        const route = preview.quotes.find((quote) => quote.provider === providerName);
        if (!route?.execution || !route.gas_used || BigInt(route.gas_used) <= 0n)
          throw new Error(
            "A route gas estimate is unavailable. Enter a native amount manually and leave gas in your wallet."
          );
        const fees = await transactionFees(
          provider,
          {
            from: account,
            chainId: hex(chainId),
            to: route.execution.to,
            data: route.execution.data,
            value: hex(route.execution.value),
          },
          gasMargin(BigInt(route.gas_used))
        );
        raw = raw > fees.reserve ? raw - fees.reserve : 0n;
        if (raw === 0n) throw new Error("No native balance is available after reserving gas.");
        balanceMessage =
          "An estimated gas reserve was deducted. Fees will be checked again before submission.";
      }
      await checkWallet();
      if (
        epoch !== generation ||
        provider !== walletStore.provider ||
        account !== walletStore.address ||
        chainId !== walletStore.chainId
      )
        return;
      formStore.mode = "exactIn";
      formStore.sellAmount = exactAmount(raw, token.decimals);
      await tick();
      clearTimer();
      const params = currentParams();
      if (params) await runCompare(params, generation);
    } catch (error) {
      if (epoch === generation)
        balanceMessage = `Cannot fill balance: ${error instanceof Error ? error.message : "Fee data unavailable. Enter an amount manually."}`;
    } finally {
      fillingBalance = false;
    }
  }
  function balanceLabel(side: "from" | "to"): string {
    if (walletStore.chainId !== formStore.chainId || balanceStore[side].status === "wrong_network")
      return "Switch network to view balance";
    const value = side === "from" ? balanceStore.fromBalance : balanceStore.toBalance;
    if (value !== null) return `Balance: ${value}`;
    return balanceStore[side].status === "loading" ? "Balance: Loading…" : "Balance: Unavailable";
  }

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    clearTimer();
    const params = currentParams();
    if (params) await runCompare(params, generation);
  }
</script>

<form class="compare-form" onsubmit={handleSubmit} novalidate>
  <div class="form-section">
    <span class="section-label">Chain</span>
    <ChainSelector />
  </div>

  <div class="form-section">
    <span class="section-label">From Token</span>
    <TokenInput type="from" />
    {#if walletStore.isConnected}
      <button
        type="button"
        class="balance-display"
        aria-label="From token balance"
        disabled={fillingBalance ||
          transactionStore.busy ||
          (walletStore.chainId === formStore.chainId &&
            balanceStore.from.status !== "ready" &&
            balanceStore.from.status !== "wrong_network")}
        onclick={() => void useSellBalance()}
      >
        {balanceLabel("from")}
        {formStore.fromToken?.symbol ?? ""}
      </button>
      {#if balanceMessage}<span role="status">{balanceMessage}</span>{/if}
    {/if}
  </div>

  <div class="form-section">
    <span class="section-label">To Token</span>
    <TokenInput type="to" />
    {#if walletStore.isConnected}
      <span class="balance-display" aria-label="To token balance"
        >{balanceLabel("to")} {formStore.toToken?.symbol ?? ""}</span
      >
    {/if}
  </div>

  <div class="form-section">
    <AmountFields />
  </div>

  <div class="form-section">
    <SlippagePresets />
  </div>

  <div class="form-section">
    <button
      class="submit-btn"
      type="submit"
      disabled={!formStore.canSubmit || comparisonStore.isLoading || transactionStore.busy}
      aria-busy={comparisonStore.isLoading}
    >
      {#if comparisonStore.isLoading}
        Comparing...
      {:else}
        Compare Quotes
      {/if}
    </button>
    <AutoRefreshIndicator />
  </div>
</form>

<style>
  .compare-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #666);
  }

  .submit-btn {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: var(--accent, #0055ff);
    color: var(--text-inverse, #fff);
    border: 2px solid var(--accent, #0055ff);
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    font-family: inherit;
    letter-spacing: 0.02em;
    transition: background 0.1s;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover, #0046cc);
    border-color: var(--accent-hover, #0046cc);
  }

  .submit-btn:focus {
    outline: 2px solid var(--accent, #0055ff);
    outline-offset: 2px;
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .balance-display {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    margin-top: 0.1rem;
  }
</style>
