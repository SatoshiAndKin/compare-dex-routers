import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, vi } from "vitest";
import SettingsModal from "../lib/components/SettingsModal.svelte";
import { settingsStore } from "../lib/stores/settingsStore.svelte.js";
import { tokenListStore } from "../lib/stores/tokenListStore.svelte.js";
import { formStore } from "../lib/stores/formStore.svelte.js";

// ---------------------------------------------------------------------------
// Mock API client (tokenListStore uses it)
// ---------------------------------------------------------------------------

vi.mock("../lib/api.js", () => ({
  apiClient: {
    GET: vi.fn().mockResolvedValue({ data: { tokenlists: [], tokens: [] } }),
  },
}));

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetSettingsStore(): void {
  settingsStore.mevEnabled = false;
  settingsStore.customRpcUrl = "";
  settingsStore.isSettingsOpen = false;
  settingsStore.isMevModalOpen = false;
}

function resetTokenListStore(): void {
  tokenListStore.lists = [];
  tokenListStore.localTokens = [];
  tokenListStore.localTokensEnabled = true;
  tokenListStore.unrecognizedModal = null;
  (tokenListStore as unknown as { initialized: boolean; isInitializing: boolean }).initialized =
    false;
  (tokenListStore as unknown as { initialized: boolean; isInitializing: boolean }).isInitializing =
    false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsModal", () => {
  beforeEach(() => {
    resetSettingsStore();
    resetTokenListStore();
    vi.clearAllMocks();
    localStorage.clear();
    formStore.chainId = 1;
  });

  // -------------------------------------------------------------------------
  // Render state
  // -------------------------------------------------------------------------

  it("renders nothing when isSettingsOpen is false", () => {
    const { container } = render(SettingsModal);
    expect(container.querySelector(".modal-overlay")).toBeNull();
  });

  it("renders modal when isSettingsOpen is true", () => {
    settingsStore.isSettingsOpen = true;
    const { container } = render(SettingsModal);
    expect(container.querySelector(".modal-overlay")).not.toBeNull();
  });

  it('shows "Settings" heading when open', () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    expect(getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("has dialog role", () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    expect(getByRole("dialog")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Close button
  // -------------------------------------------------------------------------

  it("close button (×) closes the modal", () => {
    settingsStore.isSettingsOpen = true;
    const { getByLabelText } = render(SettingsModal);
    fireEvent.click(getByLabelText("Close settings"));
    expect(settingsStore.isSettingsOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Escape key
  // -------------------------------------------------------------------------

  it("Escape key closes the modal", () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    expect(settingsStore.isSettingsOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Backdrop click
  // -------------------------------------------------------------------------

  it("clicking backdrop closes the modal", () => {
    settingsStore.isSettingsOpen = true;
    const { container } = render(SettingsModal);
    const backdrop = container.querySelector(".modal-overlay")!;
    fireEvent.click(backdrop);
    expect(settingsStore.isSettingsOpen).toBe(false);
  });

  it("clicking modal content does NOT close the modal", () => {
    settingsStore.isSettingsOpen = true;
    const { container } = render(SettingsModal);
    const modal = container.querySelector(".modal")!;
    fireEvent.click(modal);
    expect(settingsStore.isSettingsOpen).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Token lists section
  // -------------------------------------------------------------------------

  it('renders "Token Lists" section heading', () => {
    settingsStore.isSettingsOpen = true;
    const { getAllByText } = render(SettingsModal);
    const headings = getAllByText(/Token Lists/i);
    expect(headings.length).toBeGreaterThan(0);
  });

  it('renders "Add" button for adding new token list', () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    expect(getByRole("button", { name: /add/i })).toBeTruthy();
  });

  it("renders existing token lists", () => {
    settingsStore.isSettingsOpen = true;
    tokenListStore.lists = [
      { url: null, name: "Default Tokenlist", enabled: true, tokens: [] },
      {
        url: "https://example.com/list.json",
        name: "Custom List",
        enabled: true,
        tokens: [],
      },
    ];
    const { getByText } = render(SettingsModal);
    expect(getByText("Default Tokenlist")).toBeTruthy();
    expect(getByText("Custom List")).toBeTruthy();
  });

  it("shows remove button only for custom lists (not default)", () => {
    settingsStore.isSettingsOpen = true;
    tokenListStore.lists = [
      { url: null, name: "Default Tokenlist", enabled: true, tokens: [] },
      {
        url: "https://example.com/list.json",
        name: "Custom List",
        enabled: true,
        tokens: [],
      },
    ];
    const { getAllByLabelText } = render(SettingsModal);
    const removeButtons = getAllByLabelText(/Remove/i);
    // Only custom list has remove button
    expect(removeButtons.length).toBe(1);
    expect(removeButtons[0]!.getAttribute("aria-label")).toMatch(/Remove Custom List/i);
  });

  // -------------------------------------------------------------------------
  // Local tokens section
  // -------------------------------------------------------------------------

  it('renders "Local Tokens" section', () => {
    settingsStore.isSettingsOpen = true;
    const { getAllByText } = render(SettingsModal);
    const localHeadings = getAllByText(/Local Tokens/i);
    expect(localHeadings.length).toBeGreaterThan(0);
  });

  it('renders "Export My Tokens" button', () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    expect(getByRole("button", { name: /Export My Tokens/i })).toBeTruthy();
  });

  it('renders "Import My Tokens" button', () => {
    settingsStore.isSettingsOpen = true;
    const { getByRole } = render(SettingsModal);
    expect(getByRole("button", { name: /Import My Tokens/i })).toBeTruthy();
  });

  it("shows local token symbol without truncation", () => {
    settingsStore.isSettingsOpen = true;
    tokenListStore.localTokens = [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chainId: 1,
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
      },
    ];
    const { getByText } = render(SettingsModal);
    // Full address must be visible (never truncated)
    expect(getByText("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBeTruthy();
    expect(getByText("USDC")).toBeTruthy();
  });

  it("Export button is disabled when no local tokens", () => {
    settingsStore.isSettingsOpen = true;
    tokenListStore.localTokens = [];
    const { getByRole } = render(SettingsModal);
    const exportBtn = getByRole("button", { name: /Export My Tokens/i });
    expect(exportBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // MEV section — Flashbots docs link
  // -------------------------------------------------------------------------

  it("MEV section shows Flashbots docs link", () => {
    settingsStore.isSettingsOpen = true;
    const { getByText } = render(SettingsModal);
    const link = getByText(/read flashbots protect docs/i);
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toContain("flashbots.net");
  });

  it("MEV section is always visible (not chain-dependent)", () => {
    formStore.chainId = 8453; // Base
    settingsStore.isSettingsOpen = true;
    const { getByText } = render(SettingsModal);
    expect(getByText(/MEV Protection/)).toBeTruthy();
  });
});
