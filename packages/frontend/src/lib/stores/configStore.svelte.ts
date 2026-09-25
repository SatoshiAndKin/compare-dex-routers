/**
 * Config store — fetches server configuration from /api/config and /api/chains.
 * Provides WALLETCONNECT_PROJECT_ID and supported chain list.
 */

export interface NativeAsset {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  wrapped: string;
}

export interface ChainInfo {
  id: number;
  name: string;
}

class ConfigStore {
  walletConnectProjectId = $state("");
  flags = $state<Record<string, boolean>>({ curve_enabled: true });
  supportedChains = $state<ChainInfo[]>([]);
  nativeAssets = $state<Record<string, NativeAsset>>({});
  defaultTokens = $state<Record<string, { from: string; to: string }>>({});

  async init(): Promise<void> {
    await Promise.all([this._fetchConfig(), this._fetchChains()]);
  }

  private async _fetchConfig(): Promise<void> {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) return;
      const data = (await response.json()) as {
        walletConnectProjectId?: string;
        flags?: Record<string, boolean>;
        nativeAssets?: Record<string, NativeAsset>;
        defaultTokens?: Record<string, { from: string; to: string }>;
      };
      this.flags = data.flags ?? { curve_enabled: true };
      this.walletConnectProjectId = data.walletConnectProjectId ?? "";
      this.nativeAssets = data.nativeAssets ?? {};
      this.defaultTokens = data.defaultTokens ?? {};
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
