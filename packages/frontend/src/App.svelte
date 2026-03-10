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
      <WalletButton onConnectClick={openWalletMenu} />
      <ThemeToggle />
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
