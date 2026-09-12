<script lang="ts">
  import { onMount, untrack } from "svelte";
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
  import { parseUrlParams, applyUrlParamsToForm } from "./lib/stores/urlSync.svelte.js";
  import { formStore } from "./lib/stores/formStore.svelte.js";
  import { walletStore } from "./lib/stores/walletStore.svelte.js";
  import { transactionStore } from "./lib/stores/transactionStore.svelte.js";
  import { balanceStore } from "./lib/stores/balanceStore.svelte.js";
  import { configStore } from "./lib/stores/configStore.svelte.js";
  import { settingsStore } from "./lib/stores/settingsStore.svelte.js";
  import { tokenListStore } from "./lib/stores/tokenListStore.svelte.js";
  import { applyDefaults, resolveSelectedTokens } from "./lib/stores/formLifecycle.svelte.js";

  let metadataError = $state<string | null>(null);

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
  // Re-fetch balances after a transaction or a wallet, chain, or token change
  // ---------------------------------------------------------------------------

  $effect(() => {
    const address = walletStore.address;
    const chainId = walletStore.chainId;
    const selectedChain = formStore.chainId;
    const provider = walletStore.provider;
    const fromToken = formStore.fromToken;
    const toToken = formStore.toToken;

    if (
      transactionStore.busy ||
      !address ||
      chainId === null ||
      chainId !== selectedChain ||
      !provider
    ) {
      balanceStore.clear();
      return;
    }

    balanceStore.clearCache();
    void balanceStore.fetchBalances(
      provider,
      address,
      chainId,
      fromToken && fromToken.decimals !== null
        ? { address: fromToken.address, decimals: fromToken.decimals }
        : null,
      toToken && toToken.decimals !== null
        ? { address: toToken.address, decimals: toToken.decimals }
        : null
    );
  });

  // ---------------------------------------------------------------------------
  // Resolve token metadata as selections or available lists change.
  $effect(() => {
    const from = formStore.fromToken;
    const to = formStore.toToken;
    const chainId = formStore.chainId;
    const tokens = tokenListStore.allTokens;
    void from;
    void to;
    void chainId;
    void tokens;
    let active = true;
    untrack(() => {
      metadataError = null;
      void resolveSelectedTokens().then((error) => {
        if (active) metadataError = error;
      });
    });
    return () => {
      active = false;
    };
  });

  onMount(() => {
    let active = true;
    themeStore.init();
    // Discard the removed app-signing settings. They must never affect wallet submission.
    try {
      localStorage.removeItem("compare-dex-settings");
    } catch {
      /* Storage can be unavailable. */
    }
    tokenListStore.startRefresh();
    void tokenListStore.init();
    tokenListStore.loadLocalTokens();
    walletStore.startDiscovery();
    const urlParams = parseUrlParams();
    formStore.isLoading = true;
    if (Object.keys(urlParams).length) applyUrlParamsToForm(urlParams);
    else preferencesStore.applyToForm(formStore.chainId);
    void configStore.init().then(() => {
      if (!active) return;
      applyDefaults();
      formStore.isLoading = false;
    });
    return () => {
      active = false;
      tokenListStore.stopRefresh();
      walletStore.stopDiscovery();
      transactionStore.cancelSwap();
    };
  });
</script>

<div class="app">
  <header class="app-header">
    <div class="brand">
      <svg class="brand-planet" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="28" fill="#4477AA" stroke="#66CCEE" stroke-width="2" />
        <path
          d="M28 36c18 13 28 2 42 14M26 53c20 14 32 2 45 12"
          fill="none"
          stroke="#66CCEE"
          stroke-width="4"
          opacity=".6"
        />
        <ellipse
          cx="50"
          cy="50"
          rx="47"
          ry="12"
          transform="rotate(-28 50 50)"
          fill="none"
          stroke="#CCBB44"
          stroke-width="4"
        />
        <path d="m83 14 2-7 2 7 7 2-7 2-2 7-2-7-7-2z" fill="#EE6677" />
      </svg>
      <div>
        <p class="brand-eyebrow">Explore your next swap</p>
        <h1>Compare DEX Routers</h1>
      </div>
    </div>
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
    {#if metadataError}<p role="alert">{metadataError}. Select the token again to retry.</p>{/if}
    <CompareForm />
    <QuoteResults />
  </main>
  <footer class="space-footer">
    <span aria-hidden="true">✦</span> Spandex + Curve · Compare routes. Choose your swap.
    <span aria-hidden="true">✦</span>
  </footer>
</div>

<WalletProviderMenu
  projectId={configStore.walletConnectProjectId}
  isOpen={walletMenuOpen}
  onClose={closeWalletMenu}
/>

<SwapConfirmationModal />

<SettingsModal />

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: 1rem;
    color: var(--space-text);
    min-width: 0;
  }
  .brand-planet {
    width: 90px;
    flex: 0 0 90px;
  }
  .brand-eyebrow {
    color: #66ccee;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    margin-bottom: 0.3rem;
  }
  h1 {
    margin: 0;
    line-height: 1.15;
    text-shadow: 3px 3px 0 #aa3377;
  }
  .space-footer {
    text-align: center;
    color: #bbbbbb;
    font-size: 0.75rem;
    margin-top: 2.5rem;
    padding: 1rem;
    border-top: 1px dotted #4477aa;
  }
  .space-footer span {
    color: #ccbb44;
  }
  @media (max-width: 600px) {
    .brand {
      gap: 0.5rem;
    }
    .brand-planet {
      width: 58px;
      flex-basis: 58px;
    }
    .app {
      padding: 0.5rem;
    }
    .header-actions {
      margin-left: auto;
    }
  }
  .app {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.75rem;
    gap: 1.25rem;
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
