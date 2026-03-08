import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import MevModal from '../lib/components/MevModal.svelte';
import { settingsStore } from '../lib/stores/settingsStore.svelte.js';
import { formStore } from '../lib/stores/formStore.svelte.js';
import { walletStore } from '../lib/stores/walletStore.svelte.js';

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetSettingsStore(): void {
  settingsStore.mevEnabled = false;
  settingsStore.customRpcUrl = '';
  settingsStore.isSettingsOpen = false;
  settingsStore.isMevModalOpen = false;
}

function resetFormStore(): void {
  formStore.chainId = 1;
}

function resetWalletStore(): void {
  walletStore.address = null;
  walletStore.chainId = null;
  walletStore.provider = null;
  walletStore.walletInfo = null;
  walletStore.isConnecting = false;
  walletStore.message = '';
  walletStore.messageIsError = false;
  walletStore.pendingAction = null;
  walletStore.walletMenuRequested = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MevModal', () => {
  beforeEach(() => {
    resetSettingsStore();
    resetFormStore();
    resetWalletStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Render state
  // -------------------------------------------------------------------------

  it('renders nothing when isMevModalOpen is false', () => {
    const { container } = render(MevModal);
    expect(container.querySelector('.modal-overlay')).toBeNull();
  });

  it('renders modal when isMevModalOpen is true', () => {
    settingsStore.isMevModalOpen = true;
    const { container } = render(MevModal);
    expect(container.querySelector('.modal-overlay')).not.toBeNull();
  });

  it('shows "MEV Protection" heading when open', () => {
    settingsStore.isMevModalOpen = true;
    const { getByRole } = render(MevModal);
    expect(getByRole('heading', { name: 'MEV Protection' })).toBeTruthy();
  });

  it('has dialog role', () => {
    settingsStore.isMevModalOpen = true;
    const { getByRole } = render(MevModal);
    expect(getByRole('dialog')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Close button
  // -------------------------------------------------------------------------

  it('close button closes the modal', () => {
    settingsStore.isMevModalOpen = true;
    const { getByLabelText } = render(MevModal);
    fireEvent.click(getByLabelText('Close MEV modal'));
    expect(settingsStore.isMevModalOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Escape key
  // -------------------------------------------------------------------------

  it('Escape key closes the modal', () => {
    settingsStore.isMevModalOpen = true;
    const { getByRole } = render(MevModal);
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    expect(settingsStore.isMevModalOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Backdrop click
  // -------------------------------------------------------------------------

  it('clicking backdrop closes the modal', () => {
    settingsStore.isMevModalOpen = true;
    const { container } = render(MevModal);
    const backdrop = container.querySelector('.modal-overlay')!;
    fireEvent.click(backdrop);
    expect(settingsStore.isMevModalOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Ethereum content (chainId === 1)
  // -------------------------------------------------------------------------

  it('shows Flashbots content for Ethereum (chainId 1)', () => {
    formStore.chainId = 1;
    settingsStore.isMevModalOpen = true;
    const { getByText, getAllByText } = render(MevModal);
    expect(getByText(/Ethereum Mainnet/i)).toBeTruthy();
    expect(getAllByText(/Flashbots Protect/i).length).toBeGreaterThan(0);
    expect(getByText(/sandwich attacks/i)).toBeTruthy();
  });

  it('shows "Add Flashbots Protect to Wallet" button for Ethereum', () => {
    formStore.chainId = 1;
    settingsStore.isMevModalOpen = true;
    const { getByRole } = render(MevModal);
    expect(getByRole('button', { name: /Add Flashbots Protect to Wallet/i })).toBeTruthy();
  });

  it('Flashbots button is disabled when wallet not connected', () => {
    formStore.chainId = 1;
    settingsStore.isMevModalOpen = true;
    walletStore.address = null; // not connected
    const { getByRole } = render(MevModal);
    const btn = getByRole('button', { name: /Add Flashbots Protect to Wallet/i });
    expect(btn).toBeDisabled();
  });

  it('shows wallet-required note when not connected on Ethereum', () => {
    formStore.chainId = 1;
    settingsStore.isMevModalOpen = true;
    walletStore.address = null;
    const { getByText } = render(MevModal);
    expect(getByText(/Connect wallet first/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // BSC content (chainId === 56)
  // -------------------------------------------------------------------------

  it('shows BSC content for chainId 56', () => {
    formStore.chainId = 56;
    settingsStore.isMevModalOpen = true;
    const { getByText, getAllByText } = render(MevModal);
    expect(getByText(/BSC \(BNB Chain\)/i)).toBeTruthy();
    expect(getAllByText(/bloXroute/i).length).toBeGreaterThan(0);
  });

  it('shows "Add bloXroute Protect to Wallet" button for BSC', () => {
    formStore.chainId = 56;
    settingsStore.isMevModalOpen = true;
    const { getByRole } = render(MevModal);
    expect(getByRole('button', { name: /Add bloXroute Protect to Wallet/i })).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // L2 content (Base, Arbitrum, Optimism)
  // -------------------------------------------------------------------------

  it('shows sequencer message for Base (chainId 8453)', () => {
    formStore.chainId = 8453;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Base \(L2\)/i)).toBeTruthy();
    expect(getByText(/centralized sequencer/i)).toBeTruthy();
  });

  it('shows sequencer message for Arbitrum (chainId 42161)', () => {
    formStore.chainId = 42161;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Arbitrum \(L2\)/i)).toBeTruthy();
  });

  it('shows sequencer message for Optimism (chainId 10)', () => {
    formStore.chainId = 10;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Optimism \(L2\)/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Non-Ethereum "only available on Ethereum" note
  // -------------------------------------------------------------------------

  it('shows "MEV protection is only available on Ethereum" note for non-Ethereum chains', () => {
    formStore.chainId = 8453; // Base
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/MEV protection is only available on Ethereum/i)).toBeTruthy();
  });

  it('does NOT show the ethereum-only note for Ethereum itself', () => {
    formStore.chainId = 1;
    settingsStore.isMevModalOpen = true;
    const { queryByText } = render(MevModal);
    expect(
      queryByText(/MEV protection is only available on Ethereum/i),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Polygon / Avalanche
  // -------------------------------------------------------------------------

  it('shows Polygon message for chainId 137', () => {
    formStore.chainId = 137;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Polygon/)).toBeTruthy();
    expect(getByText(/no free public protection/i)).toBeTruthy();
  });

  it('shows Avalanche message for chainId 43114', () => {
    formStore.chainId = 43114;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Avalanche/)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Unknown chain
  // -------------------------------------------------------------------------

  it('shows generic message for unknown chainId', () => {
    formStore.chainId = 999;
    settingsStore.isMevModalOpen = true;
    const { getByText } = render(MevModal);
    expect(getByText(/Unknown Chain/i)).toBeTruthy();
  });
});
