/**
 * Token list store.
 * Fetches and caches tokens from the API, filters by chainId.
 * When tokenListStore has loaded custom lists / local tokens, getForChain
 * returns from tokenListStore.allTokens (which includes custom lists and local tokens).
 */

import { apiClient } from "../api.js";
import type { TokenInfo } from "./formStore.svelte.js";
import { tokenListStore } from "./tokenListStore.svelte.js";

class TokensStore {
  allTokens = $state<TokenInfo[]>([]);
  isLoading = $state(false);
  error = $state<string | null>(null);
  private fetched = false;
  private pendingMetadata = new Map<string, Promise<TokenInfo>>();

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

  async resolve(chainId: number, address: string): Promise<TokenInfo> {
    const known = this.getForChain(chainId).find(
      (token) => token.address.toLowerCase() === address.toLowerCase()
    );
    if (
      known &&
      known.decimals !== null &&
      Number.isInteger(known.decimals) &&
      known.decimals >= 0 &&
      known.decimals <= 255
    )
      return { ...known, chainId };
    const key = `${chainId}:${address.toLowerCase()}`;
    const existing = this.pendingMetadata.get(key);
    if (existing) return existing;
    const pending = this.loadMetadata(chainId, address).finally(() => {
      this.pendingMetadata.delete(key);
    });
    this.pendingMetadata.set(key, pending);
    return pending;
  }

  private async loadMetadata(chainId: number, address: string): Promise<TokenInfo> {
    const { data, error } = await apiClient.GET("/token-metadata", {
      params: { query: { chainId, address } },
    });
    if (
      error ||
      !data ||
      !Number.isInteger(data.decimals) ||
      data.decimals < 0 ||
      data.decimals > 255
    ) {
      throw new Error(`Cannot load token metadata for ${address}`);
    }
    return { ...data, address, chainId };
  }

  /** Fetch token list if not already fetched */
  async fetchIfNeeded(): Promise<void> {
    if (this.fetched || this.isLoading) return;
    this.isLoading = true;
    this.error = null;
    try {
      const { data, error } = await apiClient.GET("/tokenlist");
      if (error) {
        this.error = "Failed to load token list";
        return;
      }
      if (data?.tokens) {
        this.allTokens = data.tokens.map((t) => ({
          address: t.address ?? "",
          symbol: t.symbol ?? "",
          decimals: t.decimals,
          name: t.name,
          logoURI: t.logoURI,
          chainId: t.chainId,
        }));
        this.fetched = true;
      }
    } catch {
      this.error = "Network error loading token list";
    } finally {
      this.isLoading = false;
    }
  }
}

export const tokensStore = new TokensStore();
