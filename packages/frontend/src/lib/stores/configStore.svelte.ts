/**
 * Config store — fetches WalletConnect project ID from /api/config.
 * Static chain/token config lives in lib/chains.ts (no network request needed).
 */

class ConfigStore {
  walletConnectProjectId = $state("");

  async init(): Promise<void> {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) return;
      const data = (await response.json()) as {
        walletConnectProjectId?: string;
      };
      this.walletConnectProjectId = data.walletConnectProjectId ?? "";
    } catch {
      // Silently fail — WalletConnect will just be unavailable
    }
  }
}

export const configStore = new ConfigStore();
