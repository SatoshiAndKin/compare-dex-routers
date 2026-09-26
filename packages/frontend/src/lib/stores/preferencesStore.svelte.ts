/**
 * Preferences store — persists per-chain token selections and slippage to localStorage.
 * Ported from src/client/url-sync.ts for Svelte 5.
 *
 * Storage key: 'compare-dex-preferences'
 * Per-chain: fromToken, toToken, slippageBps
 *
 * Priority: URL params > localStorage > DEFAULT_TOKENS defaults
 */

import { canonicalToken } from "../native.js";
import { formStore } from "./formStore.svelte.js";
import { explorerBase } from "../explorers.js";
import type { TokenInfo } from "./formStore.svelte.js";

const PREFERENCES_KEY = "compare-dex-preferences";

export interface ChainPreferences {
  fromToken?: { address: string; symbol: string; decimals: number; logoURI?: string };
  toToken?: { address: string; symbol: string; decimals: number; logoURI?: string };
  slippageBps?: number;
  explorerUrl?: string;
}

export interface Preferences {
  chains: Record<number, ChainPreferences>;
}

/**
 * Load preferences from localStorage.
 * Returns null on error (corrupt data, private browsing, etc.)
 */
export function loadPreferences(): Preferences | null {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "chains" in parsed &&
      parsed.chains &&
      typeof parsed.chains === "object" &&
      !Array.isArray(parsed.chains)
    ) {
      return parsed as Preferences;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save preferences to localStorage.
 * Silently ignores errors (storage quota, private browsing, etc.)
 */
export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get saved preferences for a specific chain.
 */
export function getChainPreferences(chainId: number): ChainPreferences | null {
  const prefs = loadPreferences();
  if (!prefs) return null;
  return prefs.chains[chainId] ?? null;
}

class PreferencesStore {
  private explorerRevision = $state(0);

  getExplorerUrl(chainId: number): string | null {
    void this.explorerRevision;
    return explorerBase(getChainPreferences(chainId)?.explorerUrl);
  }

  setExplorerUrl(chainId: number, value: string): string | null {
    const url = explorerBase(value);
    if (value.trim() && !url)
      return "Enter an HTTPS explorer URL without credentials, a query, or a fragment.";
    const prefs = loadPreferences() ?? { chains: {} };
    const chain = { ...prefs.chains[chainId] };
    if (url) chain.explorerUrl = url;
    else delete chain.explorerUrl;
    prefs.chains[chainId] = chain;
    savePreferences(prefs);
    this.explorerRevision++;
    return null;
  }
  /**
   * Save current formStore state (fromToken, toToken, slippageBps) for the given chain.
   * Called after a successful compare.
   */
  saveForChain(chainId: number): void {
    const existing = loadPreferences() ?? { chains: {} };

    const chainPrefs: ChainPreferences = {
      ...existing.chains[chainId],
      slippageBps: formStore.slippageBps,
    };

    if (formStore.fromToken && formStore.fromToken.decimals !== null) {
      chainPrefs.fromToken = {
        address: canonicalToken(formStore.fromToken.address),
        symbol: formStore.fromToken.symbol,
        decimals: formStore.fromToken.decimals,
        logoURI: formStore.fromToken.logoURI,
      };
    }

    if (formStore.toToken && formStore.toToken.decimals !== null) {
      chainPrefs.toToken = {
        address: canonicalToken(formStore.toToken.address),
        symbol: formStore.toToken.symbol,
        decimals: formStore.toToken.decimals,
        logoURI: formStore.toToken.logoURI,
      };
    }

    existing.chains[chainId] = chainPrefs;
    savePreferences(existing);
  }

  /**
   * Apply saved preferences for a chain to the form store.
   * If no saved preferences exist, leaves the form unchanged.
   * Returns true if preferences were applied.
   */
  applyToForm(chainId: number): boolean {
    const chainPrefs = getChainPreferences(chainId);
    if (!chainPrefs) return false;

    if (chainPrefs.fromToken) {
      const token: TokenInfo = {
        address: canonicalToken(chainPrefs.fromToken.address),
        symbol: chainPrefs.fromToken.symbol,
        decimals: null,
        chainId,
        logoURI: chainPrefs.fromToken.logoURI,
      };
      formStore.fromToken = token;
    }

    if (chainPrefs.toToken) {
      const token: TokenInfo = {
        address: canonicalToken(chainPrefs.toToken.address),
        symbol: chainPrefs.toToken.symbol,
        decimals: null,
        chainId,
        logoURI: chainPrefs.toToken.logoURI,
      };
      formStore.toToken = token;
    }

    if (chainPrefs.slippageBps !== undefined) {
      formStore.slippageBps = chainPrefs.slippageBps;
    }

    return true;
  }
}

export const preferencesStore = new PreferencesStore();
