/**
 * Settings store — manages app-level settings: MEV protection and custom RPC URL.
 * Persisted to localStorage under 'compare-dex-settings'.
 *
 * MEV protection: only applicable on Ethereum mainnet (chainId 1).
 */

import { formStore } from './formStore.svelte.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'compare-dex-settings';
const ETHEREUM_CHAIN_ID = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersistedSettings {
  mevEnabled?: boolean;
  customRpcUrl?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class SettingsStore {
  /** MEV protection enabled (Ethereum only) */
  mevEnabled = $state(false);

  /** Custom RPC URL override (empty string = use default) */
  customRpcUrl = $state('');

  /** Whether the settings modal is open */
  isSettingsOpen = $state(false);

  /** Whether the MEV info modal is open */
  isMevModalOpen = $state(false);

  /** MEV protection is only available on Ethereum mainnet */
  mevAvailable = $derived(formStore.chainId === ETHEREUM_CHAIN_ID);

  // -------------------------------------------------------------------------
  // Modal open/close
  // -------------------------------------------------------------------------

  openSettings(): void {
    this.isSettingsOpen = true;
  }

  closeSettings(): void {
    this.isSettingsOpen = false;
  }

  openMevModal(): void {
    this.isMevModalOpen = true;
  }

  closeMevModal(): void {
    this.isMevModalOpen = false;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Persist current settings to localStorage */
  save(): void {
    const data: PersistedSettings = {
      mevEnabled: this.mevEnabled,
      customRpcUrl: this.customRpcUrl,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors (quota exceeded, private browsing, etc.)
    }
  }

  /** Load settings from localStorage */
  load(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedSettings;
      if (typeof parsed.mevEnabled === 'boolean') {
        this.mevEnabled = parsed.mevEnabled;
      }
      if (typeof parsed.customRpcUrl === 'string') {
        this.customRpcUrl = parsed.customRpcUrl;
      }
    } catch {
      // Corrupt data — keep defaults
    }
  }
}

export const settingsStore = new SettingsStore();
