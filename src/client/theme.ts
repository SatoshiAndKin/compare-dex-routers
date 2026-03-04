/**
 * Theme toggle module.
 * Cycles through light → dark → system → light.
 * Reads/writes localStorage under the 'compare-dex-theme' key.
 */

import { STORAGE_KEYS } from "./config.js";

const THEME_KEY = STORAGE_KEYS.theme;

function getStored(): string | null {
  return localStorage.getItem(THEME_KEY);
}

function apply(icon: HTMLElement, btn: HTMLElement, theme: string | null): void {
  if (theme === "light" || theme === "dark") {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    localStorage.removeItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
  updateIcon(icon, btn, theme || "system");
}

function updateIcon(icon: HTMLElement, btn: HTMLElement, t: string): void {
  if (t === "dark") icon.textContent = "\u263E";
  else if (t === "light") icon.textContent = "\u2600";
  else icon.textContent = "\u25D0";
  btn.setAttribute("aria-label", "Theme: " + (t || "system"));
}

/**
 * Initialize theme toggle behaviour on the given button and icon elements.
 * Registers click handler and system-preference media query listener.
 */
export function initTheme(btn: HTMLButtonElement, icon: HTMLElement): void {
  btn.addEventListener("click", () => {
    const stored = getStored();
    if (stored === "light") apply(icon, btn, "dark");
    else if (stored === "dark") apply(icon, btn, null);
    else apply(icon, btn, "light");
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!getStored()) apply(icon, btn, null);
  });

  // Set initial icon state
  updateIcon(icon, btn, getStored() || "system");
}
