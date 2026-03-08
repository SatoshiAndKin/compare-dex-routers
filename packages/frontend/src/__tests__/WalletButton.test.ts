import { render } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import WalletButton from '../lib/components/WalletButton.svelte';
import { walletStore } from '../lib/stores/walletStore.svelte.js';

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetWalletStore(): void {
  walletStore.address = null;
  walletStore.chainId = null;
  walletStore.provider = null;
  walletStore.walletInfo = null;
  walletStore.isConnecting = false;
  walletStore.message = '';
  walletStore.messageIsError = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletButton', () => {
  beforeEach(() => {
    resetWalletStore();
  });

  // ---------------------------------------------------------------------------
  // Disconnected state
  // ---------------------------------------------------------------------------

  it('shows "Connect Wallet" button when not connected', () => {
    const { getByRole } = render(WalletButton);
    const btn = getByRole('button', { name: /connect wallet/i });
    expect(btn).toBeTruthy();
  });

  it('connect button is enabled when not connecting', () => {
    const { getByRole } = render(WalletButton);
    const btn = getByRole('button', { name: /connect wallet/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('connect button shows "Connecting..." and is disabled when isConnecting=true', () => {
    walletStore.isConnecting = true;
    const { getByText, getByRole } = render(WalletButton);
    expect(getByText('Connecting...')).toBeTruthy();
    const btn = getByRole('button', { name: /connecting/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onConnectClick when connect button clicked', async () => {
    const { getByRole, fireEvent } = await import('@testing-library/svelte');
    const onConnectClick = vi.fn();
    const { getByRole: getBtn } = render(WalletButton, { props: { onConnectClick } });
    const btn = getBtn('button', { name: /connect wallet/i });
    await fireEvent.click(btn);
    expect(onConnectClick).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Connected state
  // ---------------------------------------------------------------------------

  it('shows wallet name and full address when connected', () => {
    walletStore.address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    walletStore.walletInfo = { uuid: 'metamask', name: 'MetaMask', icon: '' };

    const { getByText } = render(WalletButton);

    // Full address — never truncated
    expect(getByText('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBeTruthy();
    expect(getByText('MetaMask')).toBeTruthy();
  });

  it('shows full 0x address (never truncated)', () => {
    const fullAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    walletStore.address = fullAddress;

    const { getByText } = render(WalletButton);

    const addressEl = getByText(fullAddress);
    expect(addressEl.textContent).toBe(fullAddress);
    expect(addressEl.textContent).not.toContain('...');
    expect(addressEl.textContent).toHaveLength(42);
  });

  it('shows Disconnect button when connected', () => {
    walletStore.address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    const { getByRole } = render(WalletButton);
    expect(getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('does not show Connect Wallet button when connected', () => {
    walletStore.address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    const { queryByRole } = render(WalletButton);
    // Use exact name match to avoid matching "Disconnect" which has no "Connect Wallet"
    expect(queryByRole('button', { name: 'Connect wallet' })).toBeNull();
    expect(queryByRole('button', { name: 'Connect Wallet' })).toBeNull();
  });

  it('clicking Disconnect calls walletStore.disconnect', async () => {
    walletStore.address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const disconnectSpy = vi.spyOn(walletStore, 'disconnect');

    const { getByRole, fireEvent } = await import('@testing-library/svelte');
    const { getByRole: getBtn } = render(WalletButton);
    const btn = getBtn('button', { name: 'Disconnect' });
    await fireEvent.click(btn);

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    disconnectSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Status message
  // ---------------------------------------------------------------------------

  it('shows message when message is set', () => {
    walletStore.message = 'Wallet disconnected';
    const { getByRole } = render(WalletButton);
    const status = getByRole('status');
    expect(status.textContent).toContain('Wallet disconnected');
  });

  it('shows error message with error styling', () => {
    walletStore.message = 'Connection failed';
    walletStore.messageIsError = true;
    const { getByRole } = render(WalletButton);
    const status = getByRole('status');
    expect(status.classList.contains('error')).toBe(true);
  });

  it('does not show status element when message is empty', () => {
    walletStore.message = '';
    const { queryByRole } = render(WalletButton);
    expect(queryByRole('status')).toBeNull();
  });
});
