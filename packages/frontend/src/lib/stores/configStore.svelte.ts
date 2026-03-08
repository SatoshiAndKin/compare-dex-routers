/**
 * Config store — fetches server configuration from /api/config.
 * Provides WALLETCONNECT_PROJECT_ID and other server-injected settings.
 */

class ConfigStore {
  /** WalletConnect project ID (empty string if not configured) */
  walletConnectProjectId = $state('');

  /**
   * Fetch server configuration.
   * Should be called once from App.svelte's onMount.
   */
  async init(): Promise<void> {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) return;
      const data = (await response.json()) as {
        walletConnectProjectId?: string;
        defaultTokens?: Record<string, { from?: string; to?: string }>;
      };
      this.walletConnectProjectId = data.walletConnectProjectId ?? '';
    } catch {
      // Silently fail — WalletConnect will just be unavailable
    }
  }
}

export const configStore = new ConfigStore();
