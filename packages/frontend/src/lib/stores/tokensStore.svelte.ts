/**
 * Token list store.
 * Fetches and caches tokens from the API, filters by chainId.
 * When tokenListStore has loaded custom lists / local tokens, getForChain
 * returns from tokenListStore.allTokens (which includes custom lists and local tokens).
 */

import { apiClient } from '../api.js';
import type { TokenInfo } from './formStore.svelte.js';
import { tokenListStore } from './tokenListStore.svelte.js';

class TokensStore {
  allTokens = $state<TokenInfo[]>([]);
  isLoading = $state(false);
  error = $state<string | null>(null);
  private fetched = false;

  /**
   * Get tokens filtered by chainId.
   * Prefers tokenListStore.allTokens (which includes custom lists + local tokens)
   * when it has data. Falls back to own allTokens (used in tests / SSR).
   */
  getForChain(chainId: number): TokenInfo[] {
    const listStoreTokens = tokenListStore.allTokens;
    if (listStoreTokens.length > 0) {
      return listStoreTokens.filter((t) => t.chainId === chainId) as TokenInfo[];
    }
    return this.allTokens.filter((t) => t.chainId === chainId);
  }

  /** Fetch token list if not already fetched */
  async fetchIfNeeded(): Promise<void> {
    if (this.fetched || this.isLoading) return;
    this.isLoading = true;
    this.error = null;
    try {
      const { data, error } = await apiClient.GET('/tokenlist');
      if (error) {
        this.error = 'Failed to load token list';
        return;
      }
      if (data?.tokens) {
        this.allTokens = data.tokens.map((t) => ({
          address: t.address ?? '',
          symbol: t.symbol ?? '',
          decimals: t.decimals ?? 18,
          name: t.name,
          logoURI: t.logoURI,
          chainId: t.chainId,
        }));
        this.fetched = true;
      }
    } catch (e) {
      this.error = 'Network error loading token list';
    } finally {
      this.isLoading = false;
    }
  }
}

export const tokensStore = new TokensStore();
