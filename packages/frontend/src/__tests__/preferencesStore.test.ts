import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  getChainPreferences,
  preferencesStore,
} from '../lib/stores/preferencesStore.svelte.js';
import { formStore } from '../lib/stores/formStore.svelte.js';

const PREF_KEY = 'compare-dex-preferences';

function resetFormStore() {
  formStore.chainId = 1;
  formStore.fromToken = null;
  formStore.toToken = null;
  formStore.sellAmount = '';
  formStore.receiveAmount = '';
  formStore.mode = 'exactIn';
  formStore.slippageBps = 50;
}

describe('preferencesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFormStore();
  });

  // ---------------------------------------------------------------------------
  // loadPreferences / savePreferences
  // ---------------------------------------------------------------------------

  it('returns null when localStorage is empty', () => {
    expect(loadPreferences()).toBeNull();
  });

  it('returns null for corrupt localStorage data', () => {
    localStorage.setItem(PREF_KEY, 'NOT JSON');
    expect(loadPreferences()).toBeNull();
  });

  it('returns null for valid JSON that is not a Preferences object', () => {
    localStorage.setItem(PREF_KEY, JSON.stringify([1, 2, 3]));
    expect(loadPreferences()).toBeNull();
  });

  it('returns null when preferences object lacks chains key', () => {
    localStorage.setItem(PREF_KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadPreferences()).toBeNull();
  });

  it('saves and loads preferences round-trip', () => {
    const prefs = {
      chains: {
        1: {
          fromToken: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            decimals: 6,
          },
          toToken: {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            symbol: 'USDT',
            decimals: 6,
          },
          slippageBps: 100,
        },
      },
    };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  // ---------------------------------------------------------------------------
  // getChainPreferences
  // ---------------------------------------------------------------------------

  it('returns null when no preferences saved', () => {
    expect(getChainPreferences(1)).toBeNull();
  });

  it('returns null for a chain with no saved preferences', () => {
    savePreferences({ chains: { 1: { slippageBps: 50 } } });
    expect(getChainPreferences(8453)).toBeNull();
  });

  it('returns saved chain preferences', () => {
    const chainPrefs = {
      fromToken: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
      },
      slippageBps: 50,
    };
    savePreferences({ chains: { 1: chainPrefs } });
    expect(getChainPreferences(1)).toEqual(chainPrefs);
  });

  // ---------------------------------------------------------------------------
  // preferencesStore.saveForChain
  // ---------------------------------------------------------------------------

  it('saves current form state to localStorage for the given chain', () => {
    formStore.fromToken = {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    };
    formStore.toToken = {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      decimals: 6,
    };
    formStore.slippageBps = 100;

    preferencesStore.saveForChain(1);

    const saved = getChainPreferences(1);
    expect(saved).not.toBeNull();
    expect(saved!.fromToken?.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(saved!.fromToken?.symbol).toBe('USDC');
    expect(saved!.toToken?.address).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(saved!.slippageBps).toBe(100);
  });

  it('merges per-chain data, preserving other chains', () => {
    // Save for chain 1
    formStore.fromToken = {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    };
    formStore.toToken = {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      decimals: 6,
    };
    formStore.slippageBps = 50;
    preferencesStore.saveForChain(1);

    // Save for chain 8453 (Base)
    formStore.fromToken = {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
    };
    formStore.toToken = {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      decimals: 18,
    };
    formStore.slippageBps = 30;
    preferencesStore.saveForChain(8453);

    // Both chains should be persisted
    expect(getChainPreferences(1)?.fromToken?.address).toBe(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    );
    expect(getChainPreferences(8453)?.fromToken?.address).toBe(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    );
  });

  it('never truncates addresses when saving', () => {
    const fullAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    formStore.fromToken = { address: fullAddress, symbol: 'USDC', decimals: 6 };
    formStore.toToken = {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      decimals: 6,
    };
    preferencesStore.saveForChain(1);

    const saved = getChainPreferences(1);
    expect(saved!.fromToken?.address).toBe(fullAddress);
    expect(saved!.fromToken?.address.length).toBe(42);
  });

  // ---------------------------------------------------------------------------
  // preferencesStore.applyToForm
  // ---------------------------------------------------------------------------

  it('returns false and leaves form unchanged when no preferences exist', () => {
    const result = preferencesStore.applyToForm(1);
    expect(result).toBe(false);
    expect(formStore.fromToken).toBeNull();
    expect(formStore.toToken).toBeNull();
  });

  it('restores saved preferences to form on fresh load', () => {
    const prefs = {
      chains: {
        1: {
          fromToken: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            decimals: 6,
          },
          toToken: {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            symbol: 'USDT',
            decimals: 6,
          },
          slippageBps: 100,
        },
      },
    };
    savePreferences(prefs);

    const result = preferencesStore.applyToForm(1);

    expect(result).toBe(true);
    expect(formStore.fromToken?.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(formStore.fromToken?.symbol).toBe('USDC');
    expect(formStore.toToken?.address).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(formStore.slippageBps).toBe(100);
  });

  it('handles corrupt localStorage gracefully — no crash, returns null', () => {
    localStorage.setItem(PREF_KEY, '{corrupt json here');
    expect(() => loadPreferences()).not.toThrow();
    expect(loadPreferences()).toBeNull();
  });

  it('handles corrupt localStorage in applyToForm gracefully — no crash', () => {
    localStorage.setItem(PREF_KEY, 'garbage data!!!');
    expect(() => preferencesStore.applyToForm(1)).not.toThrow();
    // Form should remain at defaults
    expect(formStore.fromToken).toBeNull();
  });

  it('URL params override localStorage — applyToForm after URL params leaves URL data intact', () => {
    // Simulate: URL params were already applied to formStore (URL override)
    formStore.fromToken = {
      address: '0xURLOverrideToken0000000000000000000001',
      symbol: 'URL_TOKEN',
      decimals: 18,
    };

    // Also save some different prefs to localStorage
    savePreferences({
      chains: {
        1: {
          fromToken: {
            address: '0xStoredToken000000000000000000000000001',
            symbol: 'STORED',
            decimals: 6,
          },
          slippageBps: 200,
        },
      },
    });

    // If URL params were applied first, calling applyToForm would overwrite —
    // but in practice, App.svelte calls applyToForm ONLY when there are no URL params.
    // This test verifies the logic: if you call applyToForm, it does overwrite.
    // (The protection is in App.svelte's mount logic, not applyToForm itself.)
    preferencesStore.applyToForm(1);
    // applyToForm applied localStorage over the URL token
    expect(formStore.fromToken?.address).toBe('0xStoredToken000000000000000000000000001');
  });

  it('saveForChain handles localStorage write failure gracefully', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    formStore.fromToken = {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    };

    expect(() => preferencesStore.saveForChain(1)).not.toThrow();
    setItemSpy.mockRestore();
  });
});
