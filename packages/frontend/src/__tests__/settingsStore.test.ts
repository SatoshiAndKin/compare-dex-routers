import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { settingsStore } from '../lib/stores/settingsStore.svelte.js';
import { formStore } from '../lib/stores/formStore.svelte.js';

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  settingsStore.mevEnabled = false;
  settingsStore.customRpcUrl = '';
  settingsStore.isSettingsOpen = false;
  settingsStore.isMevModalOpen = false;
}

function resetFormStore(): void {
  formStore.chainId = 1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settingsStore', () => {
  beforeEach(() => {
    resetStore();
    resetFormStore();
    localStorage.clear();
  });

  afterEach(() => {
    resetStore();
    resetFormStore();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('initial mevEnabled is false', () => {
    expect(settingsStore.mevEnabled).toBe(false);
  });

  it('initial customRpcUrl is empty string', () => {
    expect(settingsStore.customRpcUrl).toBe('');
  });

  it('initial isSettingsOpen is false', () => {
    expect(settingsStore.isSettingsOpen).toBe(false);
  });

  it('initial isMevModalOpen is false', () => {
    expect(settingsStore.isMevModalOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // openSettings / closeSettings
  // -------------------------------------------------------------------------

  it('openSettings() sets isSettingsOpen to true', () => {
    settingsStore.openSettings();
    expect(settingsStore.isSettingsOpen).toBe(true);
  });

  it('closeSettings() sets isSettingsOpen to false', () => {
    settingsStore.openSettings();
    settingsStore.closeSettings();
    expect(settingsStore.isSettingsOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // openMevModal / closeMevModal
  // -------------------------------------------------------------------------

  it('openMevModal() sets isMevModalOpen to true', () => {
    settingsStore.openMevModal();
    expect(settingsStore.isMevModalOpen).toBe(true);
  });

  it('closeMevModal() sets isMevModalOpen to false', () => {
    settingsStore.openMevModal();
    settingsStore.closeMevModal();
    expect(settingsStore.isMevModalOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // mevAvailable — derived from formStore.chainId
  // -------------------------------------------------------------------------

  it('mevAvailable is true when chainId is 1 (Ethereum)', () => {
    formStore.chainId = 1;
    expect(settingsStore.mevAvailable).toBe(true);
  });

  it('mevAvailable is false when chainId is not 1', () => {
    formStore.chainId = 8453; // Base
    expect(settingsStore.mevAvailable).toBe(false);
  });

  it('mevAvailable is false for BSC (56)', () => {
    formStore.chainId = 56;
    expect(settingsStore.mevAvailable).toBe(false);
  });

  it('mevAvailable is false for Arbitrum (42161)', () => {
    formStore.chainId = 42161;
    expect(settingsStore.mevAvailable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // save() — persists to localStorage
  // -------------------------------------------------------------------------

  it('save() persists mevEnabled to localStorage', () => {
    settingsStore.mevEnabled = true;
    settingsStore.save();

    const raw = localStorage.getItem('compare-dex-settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { mevEnabled?: boolean };
    expect(parsed.mevEnabled).toBe(true);
  });

  it('save() persists customRpcUrl to localStorage', () => {
    settingsStore.customRpcUrl = 'https://mainnet.infura.io/v3/abc123';
    settingsStore.save();

    const raw = localStorage.getItem('compare-dex-settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { customRpcUrl?: string };
    expect(parsed.customRpcUrl).toBe('https://mainnet.infura.io/v3/abc123');
  });

  it('save() handles localStorage write failure gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => settingsStore.save()).not.toThrow();

    setItemSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // load() — restores from localStorage
  // -------------------------------------------------------------------------

  it('load() restores mevEnabled from localStorage', () => {
    localStorage.setItem('compare-dex-settings', JSON.stringify({ mevEnabled: true }));
    settingsStore.load();
    expect(settingsStore.mevEnabled).toBe(true);
  });

  it('load() restores customRpcUrl from localStorage', () => {
    localStorage.setItem(
      'compare-dex-settings',
      JSON.stringify({ customRpcUrl: 'https://rpc.example.com' }),
    );
    settingsStore.load();
    expect(settingsStore.customRpcUrl).toBe('https://rpc.example.com');
  });

  it('load() handles missing localStorage key gracefully', () => {
    // Nothing stored — no-op
    expect(() => settingsStore.load()).not.toThrow();
    expect(settingsStore.mevEnabled).toBe(false);
    expect(settingsStore.customRpcUrl).toBe('');
  });

  it('load() handles corrupt JSON gracefully', () => {
    localStorage.setItem('compare-dex-settings', 'NOT JSON');
    expect(() => settingsStore.load()).not.toThrow();
    expect(settingsStore.mevEnabled).toBe(false);
  });

  it('load() ignores non-boolean mevEnabled values', () => {
    localStorage.setItem('compare-dex-settings', JSON.stringify({ mevEnabled: 'yes' }));
    settingsStore.load();
    expect(settingsStore.mevEnabled).toBe(false); // unchanged — 'yes' is not boolean
  });

  it('save() then load() round-trips both settings', () => {
    settingsStore.mevEnabled = true;
    settingsStore.customRpcUrl = 'https://rpc.example.com';
    settingsStore.save();

    // Reset in-memory values
    settingsStore.mevEnabled = false;
    settingsStore.customRpcUrl = '';

    settingsStore.load();

    expect(settingsStore.mevEnabled).toBe(true);
    expect(settingsStore.customRpcUrl).toBe('https://rpc.example.com');
  });
});
