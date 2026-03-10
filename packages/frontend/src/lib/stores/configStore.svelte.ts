/**
 * Config store — fetches server configuration from /api/config and /api/chains.
 * Provides WALLETCONNECT_PROJECT_ID and supported chain list.
 */

export interface ChainInfo {
  id: number;
  name: string;
}

class ConfigStore {
  walletConnectProjectId = $state("");
  supportedChains = $state<ChainInfo[]>([]);

  async init(): Promise<void> {
    await Promise.all([this._fetchConfig(), this._fetchChains()]);
  }

  private async _fetchConfig(): Promise<void> {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) return;
      const data = (await response.json()) as {
        walletConnectProjectId?: string;
      };
      this.walletConnectProjectId = data.walletConnectProjectId ?? "";
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
