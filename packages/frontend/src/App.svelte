<script lang="ts">
  import { onMount } from "svelte";
  import CompareForm from "./lib/components/CompareForm.svelte";
  import QuoteResults from "./lib/components/QuoteResults.svelte";
  import ThemeToggle from "./lib/components/ThemeToggle.svelte";
  import WalletButton from "./lib/components/WalletButton.svelte";
  import WalletProviderMenu from "./lib/components/WalletProviderMenu.svelte";
  import SwapConfirmationModal from "./lib/components/SwapConfirmationModal.svelte";
  import ChainMismatchWarning from "./lib/components/ChainMismatchWarning.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";

  import { themeStore } from "./lib/stores/themeStore.svelte.js";
  import { preferencesStore } from "./lib/stores/preferencesStore.svelte.js";
  import {
    parseUrlParams,
    hasAllRequiredParams,
    applyUrlParamsToForm,
  } from "./lib/stores/urlSync.svelte.js";
  import { formStore } from "./lib/stores/formStore.svelte.js";
  import { comparisonStore } from "./lib/stores/comparisonStore.svelte.js";
  import { walletStore } from "./lib/stores/walletStore.svelte.js";
  import { transactionStore } from "./lib/stores/transactionStore.svelte.js";
  import { balanceStore } from "./lib/stores/balanceStore.svelte.js";
  import { configStore } from "./lib/stores/configStore.svelte.js";
  import { settingsStore } from "./lib/stores/settingsStore.svelte.js";
  import { tokenListStore } from "./lib/stores/tokenListStore.svelte.js";
  import type { TokenInfo } from "./lib/stores/formStore.svelte.js";

  let walletMenuOpen = $state(false);

  function openWalletMenu(): void {
    walletMenuOpen = true;
  }

  function closeWalletMenu(): void {
    walletMenuOpen = false;
  }

  // ---------------------------------------------------------------------------
  // Wallet menu request from transactionStore (Approve/Swap clicked without wallet)
  // ---------------------------------------------------------------------------

  $effect(() => {
    if (walletStore.walletMenuRequested) {
      walletMenuOpen = true;
      walletStore.ackMenuRequest();
    }
  });

  // ---------------------------------------------------------------------------
  // Auto-execute pending action after wallet connects
  // ---------------------------------------------------------------------------

  $effect(() => {
    const connected = walletStore.isConnected;
    const pending = walletStore.pendingAction;

    if (connected && pending && (pending.type === "approve" || pending.type === "swap")) {
      // Clear the pending action first to avoid re-execution
      walletStore.pendingAction = null;

      const params = pending.params as { routerName?: string; quote?: unknown } | null;
      if (params?.routerName && params.quote) {
        const routerName = params.routerName;
        const quote = params.quote;
        if (pending.type === "approve") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void transactionStore.approve(routerName, quote as any);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void transactionStore.swap(routerName, quote as any);
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Reactive balance fetching: re-fetch when wallet, chain, or tokens change
  // ---------------------------------------------------------------------------

  $effect(() => {
    const address = walletStore.address;
    const chainId = walletStore.chainId;
    const provider = walletStore.provider;
    const fromToken = formStore.fromToken;
    const toToken = formStore.toToken;

    if (!address || chainId === null || !provider) {
      balanceStore.clear();
      return;
    }

    void balanceStore.fetchBalances(
      provider,
      address,
      chainId,
      fromToken ? { address: fromToken.address, decimals: fromToken.decimals } : null,
      toToken ? { address: toToken.address, decimals: toToken.decimals } : null
    );
  });

  // ---------------------------------------------------------------------------
  // Auto-populate form defaults when config loads (enables auto-compare on load)
  // ---------------------------------------------------------------------------

  let defaultsApplied = false;

  $effect(() => {
    if (defaultsApplied) return;

    // Wait for config to load with default tokens
    const defaults = configStore.defaultTokens;
    if (Object.keys(defaults).length === 0) return;

    // If form already has all data needed for comparison, skip
    const hasTokens = formStore.fromToken !== null && formStore.toToken !== null;
    const hasAmount = formStore.sellAmount !== "" || formStore.receiveAmount !== "";
    if (hasTokens && hasAmount) {
      defaultsApplied = true;
      return;
    }

    const chainId = formStore.chainId;
    const chainDefaults = defaults[String(chainId)];
    if (!chainDefaults) {
      defaultsApplied = true;
      return;
    }

    // Resolve full token info from token list if available
    const allTokens = tokenListStore.allTokens;

    if (!formStore.fromToken && chainDefaults.from) {
      const found = allTokens.find(
        (t) =>
          t.address.toLowerCase() === chainDefaults.from.toLowerCase() &&
          Number(t.chainId) === chainId
      );
      const token: TokenInfo = found
        ? {
            address: found.address,
            symbol: found.symbol,
            decimals: found.decimals,
            name: found.name,
            logoURI: found.logoURI,
          }
        : { address: chainDefaults.from, symbol: "", decimals: 18 };
      formStore.fromToken = token;
    }

    if (!formStore.toToken && chainDefaults.to) {
      const found = allTokens.find(
        (t) =>
          t.address.toLowerCase() === chainDefaults.to.toLowerCase() &&
          Number(t.chainId) === chainId
      );
      const token: TokenInfo = found
        ? {
            address: found.address,
            symbol: found.symbol,
            decimals: found.decimals,
            name: found.name,
            logoURI: found.logoURI,
          }
        : { address: chainDefaults.to, symbol: "", decimals: 18 };
      formStore.toToken = token;
    }

    if (!formStore.sellAmount && !formStore.receiveAmount) {
      formStore.sellAmount = "1";
    }

    defaultsApplied = true;
  });

  onMount(() => {
    // 1. Initialize theme from localStorage (applies data-theme to <html>)
    themeStore.init();

    // 1b. Load persisted settings
    settingsStore.load();

    // 1c. Initialize token lists (default + custom lists from localStorage)
    void tokenListStore.init();
    tokenListStore.loadLocalTokens();

    // 2. Fetch server config (for WalletConnect project ID)
    void configStore.init();

    // 3. Start EIP-6963 wallet discovery
    walletStore.startDiscovery();

    // 4. Parse URL params
    const urlParams = parseUrlParams();
    const allRequired = hasAllRequiredParams();

    if (allRequired) {
      // 5. URL has all required params — populate form and auto-trigger comparison
      applyUrlParamsToForm(urlParams);
      void comparisonStore.compare({
        chainId: formStore.chainId,
        from: urlParams.from!,
        to: urlParams.to!,
        amount: urlParams.amount!,
        slippageBps: formStore.slippageBps,
        mode: formStore.mode,
      });
    } else if (Object.keys(urlParams).length > 0) {
      // 6a. Partial URL params — apply what we have
      applyUrlParamsToForm(urlParams);
    } else {
      // 6b. No URL params — restore preferences for default chain
      preferencesStore.applyToForm(formStore.chainId);
    }

    // Cleanup on unmount
    return () => {
      walletStore.stopDiscovery();
    };
  });
</script>

<div class="app">
  <header class="app-header">
    <h1>Compare DEX Routers</h1>
    <div class="header-actions">
      <ThemeToggle />
      <a
        href="https://github.com/SatoshiAndKin/compare-dex-routers"
        target="_blank"
        rel="noopener noreferrer"
        class="github-link"
        title="View on GitHub"
        aria-label="View on GitHub"
      >
        <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
      <button
        type="button"
        class="settings-btn"
        aria-label="Open settings"
        aria-expanded={settingsStore.isSettingsOpen}
        onclick={() => settingsStore.openSettings()}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  </header>

  <div class="wallet-row">
    <WalletButton onConnectClick={openWalletMenu} />
  </div>

  <ChainMismatchWarning />

  <main class="app-main">
    <CompareForm />
    <QuoteResults />
  </main>
</div>

<WalletProviderMenu
  projectId={configStore.walletConnectProjectId}
  isOpen={walletMenuOpen}
  onClose={closeWalletMenu}
/>

<SwapConfirmationModal />

<SettingsModal />

<style>
  /* Basic shell styles */
  .app {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .github-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    background: var(--bg-card, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    flex-shrink: 0;
    text-decoration: none;
  }

  .github-link:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .github-link:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }

  .wallet-row {
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 800px;
    margin: 0 auto 1rem;
  }

  .settings-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    background: var(--bg-card, #fff);
    color: var(--text, #000);
    border: 2px solid var(--border, #000);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 1.125rem;
  }

  .settings-btn:hover {
    background: var(--bg-hover, #f0f0f0);
  }

  .settings-btn:focus {
    outline: 3px solid var(--accent, #0055ff);
    outline-offset: 0;
  }
</style>
