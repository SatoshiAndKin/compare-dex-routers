/**
 * Preferences store — persists browser settings and per-chain trade choices to localStorage.
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
const DEFAULT_DEFILLAMA_WARNING_BPS = 50;
export const DEFAULT_COINBASE_TAKER_FEE_PERCENT = "0.9";

export interface ChainPreferences {
  fromToken?: { address: string; symbol: string; decimals: number; logoURI?: string };
  toToken?: { address: string; symbol: string; decimals: number; logoURI?: string };
  slippageBps?: number;
  explorerUrl?: string;
}

export interface Preferences {
  coinbaseTakerFeePercent?: string;
  defillamaWarningBps?: number;
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
 * Returns whether the browser saved the preferences.
 */
export function savePreferences(prefs: Preferences): boolean {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
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
  private coinbaseRevision = $state(0);
  private defillamaRevision = $state(0);

  get defillamaWarningBps(): number {
    void this.defillamaRevision;
    const bps = loadPreferences()?.defillamaWarningBps;
    return typeof bps === "number" && Number.isInteger(bps) && bps >= 0 && bps <= 10_000
      ? bps
      : DEFAULT_DEFILLAMA_WARNING_BPS;
  }

  setDefillamaWarningPercent(value: string): string | null {
    const text = value.trim();
    const percent = Number(text);
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || percent > 100)
      return "Enter 0 to 100 percent, with at most two decimal places.";
    const prefs = loadPreferences() ?? { chains: {} };
    const defillamaWarningBps = Math.round(percent * 100);
    if (!savePreferences({ ...prefs, defillamaWarningBps }))
      return "This browser could not save the warning threshold.";
    this.defillamaRevision++;
    return null;
  }

  get coinbaseTakerFeePercent(): string {
    void this.coinbaseRevision;
    const fee = loadPreferences()?.coinbaseTakerFeePercent;
    return typeof fee === "string" && (fee === "" || /^\d{1,2}(?:\.\d{1,4})?$/.test(fee))
      ? fee
      : DEFAULT_COINBASE_TAKER_FEE_PERCENT;
  }

  setCoinbaseTakerFeePercent(value: string): string | null {
    if (value !== "" && !/^\d{1,2}(?:\.\d{1,4})?$/.test(value))
      return "Enter 0 to less than 100 percent, with at most four decimal places.";
    savePreferences({ ...(loadPreferences() ?? { chains: {} }), coinbaseTakerFeePercent: value });
    this.coinbaseRevision++;
    return null;
  }

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
