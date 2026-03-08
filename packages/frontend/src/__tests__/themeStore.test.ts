import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { themeStore } from '../lib/stores/themeStore.svelte.js';

const THEME_KEY = 'compare-dex-theme';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset data-theme attribute
    document.documentElement.removeAttribute('data-theme');
    // Reset theme state to 'system'
    themeStore.theme = 'system';
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  // ---------------------------------------------------------------------------
  // init()
  // ---------------------------------------------------------------------------

  it('initializes to system when localStorage is empty', () => {
    themeStore.init();
    expect(themeStore.theme).toBe('system');
  });

  it('reads light theme from localStorage on init', () => {
    localStorage.setItem(THEME_KEY, 'light');
    themeStore.init();
    expect(themeStore.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('reads dark theme from localStorage on init', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    themeStore.init();
    expect(themeStore.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to system for invalid stored value', () => {
    localStorage.setItem(THEME_KEY, 'invalid-value');
    themeStore.init();
    expect(themeStore.theme).toBe('system');
  });

  it('applies data-theme to document.documentElement on init', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    themeStore.init();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies light or dark for system mode based on OS preference', () => {
    // jsdom defaults to light (no prefers-color-scheme media query match)
    themeStore.init();
    const attr = document.documentElement.getAttribute('data-theme');
    expect(attr === 'light' || attr === 'dark').toBe(true);
  });

  // ---------------------------------------------------------------------------
  // cycle()
  // ---------------------------------------------------------------------------

  it('cycles light → dark → system → light', () => {
    themeStore.theme = 'light';
    themeStore.cycle();
    expect(themeStore.theme).toBe('dark');

    themeStore.cycle();
    expect(themeStore.theme).toBe('system');

    themeStore.cycle();
    expect(themeStore.theme).toBe('light');
  });

  it('persists light to localStorage after cycle', () => {
    themeStore.theme = 'system';
    themeStore.cycle(); // → light
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('persists dark to localStorage after cycle', () => {
    themeStore.theme = 'light';
    themeStore.cycle(); // → dark
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('removes localStorage entry when cycling to system', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    themeStore.theme = 'dark';
    themeStore.cycle(); // → system
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('applies data-theme=light after cycling to light', () => {
    themeStore.theme = 'system';
    themeStore.cycle(); // → light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies data-theme=dark after cycling to dark', () => {
    themeStore.theme = 'light';
    themeStore.cycle(); // → dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies data-theme=light or dark when cycling to system', () => {
    themeStore.theme = 'dark';
    themeStore.cycle(); // → system
    const attr = document.documentElement.getAttribute('data-theme');
    expect(attr === 'light' || attr === 'dark').toBe(true);
  });

  // ---------------------------------------------------------------------------
  // icon getter
  // ---------------------------------------------------------------------------

  it('returns sun icon (☀) for light theme', () => {
    themeStore.theme = 'light';
    expect(themeStore.icon).toBe('\u2600');
  });

  it('returns moon icon (☾) for dark theme', () => {
    themeStore.theme = 'dark';
    expect(themeStore.icon).toBe('\u263E');
  });

  it('returns half-circle icon (◐) for system theme', () => {
    themeStore.theme = 'system';
    expect(themeStore.icon).toBe('\u25D0');
  });

  // ---------------------------------------------------------------------------
  // ariaLabel getter
  // ---------------------------------------------------------------------------

  it('returns correct aria label for each theme', () => {
    themeStore.theme = 'light';
    expect(themeStore.ariaLabel).toBe('Theme: light');

    themeStore.theme = 'dark';
    expect(themeStore.ariaLabel).toBe('Theme: dark');

    themeStore.theme = 'system';
    expect(themeStore.ariaLabel).toBe('Theme: system');
  });

  // ---------------------------------------------------------------------------
  // localStorage error handling
  // ---------------------------------------------------------------------------

  it('handles localStorage read failure gracefully', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => themeStore.init()).not.toThrow();
    expect(themeStore.theme).toBe('system');
    getItemSpy.mockRestore();
  });

  it('handles localStorage write failure gracefully', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    themeStore.theme = 'system';
    expect(() => themeStore.cycle()).not.toThrow();
    setItemSpy.mockRestore();
  });
});
