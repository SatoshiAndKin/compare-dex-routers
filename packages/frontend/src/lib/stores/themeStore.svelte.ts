/**
 * Theme store — manages theme cycling (light → dark → system → light).
 * Persists to localStorage under 'compare-dex-theme'.
 * Applies via data-theme attribute on <html> element.
 * Ported from src/client/theme.ts for Svelte 5.
 */

const THEME_KEY = 'compare-dex-theme';

export type Theme = 'light' | 'dark' | 'system';

class ThemeStore {
  theme = $state<Theme>('system');

  /**
   * Initialize theme from localStorage.
   * Must be called on mount (requires DOM access).
   * Applies theme immediately to avoid flash.
   */
  init(): void {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') {
        this.theme = stored;
      } else {
        this.theme = 'system';
      }
    } catch {
      this.theme = 'system';
    }
    this._apply(this.theme);

    // Watch for OS preference changes when in system mode
    if (typeof window !== 'undefined') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') {
          this._apply('system');
        }
      });
    }
  }

  /**
   * Cycle to the next theme: light → dark → system → light
   */
  cycle(): void {
    if (this.theme === 'light') {
      this.theme = 'dark';
    } else if (this.theme === 'dark') {
      this.theme = 'system';
    } else {
      this.theme = 'light';
    }
    this._save(this.theme);
    this._apply(this.theme);
  }

  /**
   * The icon character for the current theme.
   * ☀ for light, ☾ for dark, ◐ for system.
   */
  get icon(): string {
    if (this.theme === 'dark') return '\u263E'; // ☾
    if (this.theme === 'light') return '\u2600'; // ☀
    return '\u25D0'; // ◐
  }

  /**
   * Aria label for the current theme button.
   */
  get ariaLabel(): string {
    return `Theme: ${this.theme}`;
  }

  private _save(theme: Theme): void {
    try {
      if (theme === 'system') {
        localStorage.removeItem(THEME_KEY);
      } else {
        localStorage.setItem(THEME_KEY, theme);
      }
    } catch {
      // Ignore storage errors
    }
  }

  private _apply(theme: Theme): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      // System: follow OS preference
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }
}

export const themeStore = new ThemeStore();
