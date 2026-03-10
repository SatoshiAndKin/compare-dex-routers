/**
 * Config store — fetches server configuration from /api/config and /api/chains.
 * Provides WALLETCONNECT_PROJECT_ID, supported chain list, and default token pairs.
 */

export interface ChainInfo {
  id: number;
  name: string;
}

export interface DefaultTokenPair {
  from: string;
  to: string;
}

class ConfigStore {
  walletConnectProjectId = $state("");
  supportedChains = $state<ChainInfo[]>([]);
  defaultTokens = $state<Record<string, DefaultTokenPair>>({});
  private _configReady = false;
  private _configPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    this._configPromise = Promise.all([this._fetchConfig(), this._fetchChains()]).then(() => {
      this._configReady = true;
    });
    await this._configPromise;
  }

  get isReady(): boolean {
    return this._configReady;
  }

  /** Wait for config to be loaded (useful for dependent initialization) */
  async waitForReady(): Promise<void> {
    if (this._configPromise) await this._configPromise;
  }

  /** Get default token pair for a chain (returns undefined if not configured) */
  getDefaultTokens(chainId: number): DefaultTokenPair | undefined {
    return this.defaultTokens[String(chainId)];
  }

  private async _fetchConfig(): Promise<void> {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) return;
      const data = (await response.json()) as {
        walletConnectProjectId?: string;
        defaultTokens?: Record<string, { from?: string; to?: string }>;
      };
      this.walletConnectProjectId = data.walletConnectProjectId ?? "";
      if (data.defaultTokens) {
        const tokens: Record<string, DefaultTokenPair> = {};
        for (const [chainId, pair] of Object.entries(data.defaultTokens)) {
          if (pair.from && pair.to) {
            tokens[chainId] = { from: pair.from, to: pair.to };
          }
        }
        this.defaultTokens = tokens;
      }
    } catch {
      // Silently fail
    }
  }

  private async _fetchChains(): Promise<void> {
    try {
      const response = await fetch("/api/chains");
      if (!response.ok) return;
      const data = (await response.json()) as Record<string, { name: string }>;
      this.supportedChains = Object.entries(data).map(([id, info]) => ({
        id: Number(id),
        name: info.name,
      }));
    } catch {
      // Silently fail — will use hardcoded fallback in ChainSelector
    }
  }
}

export const configStore = new ConfigStore();
