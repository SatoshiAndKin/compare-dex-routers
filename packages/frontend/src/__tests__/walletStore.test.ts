import { describe, it, expect, beforeEach, vi } from 'vitest';
import { walletStore, type EIP6963ProviderDetail, type EIP1193Provider } from '../lib/stores/walletStore.svelte.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockProvider = EIP1193Provider & {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

function makeProvider(overrides: Partial<MockProvider> = {}): MockProvider {
  const base: MockProvider = {
    request: vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts')
        return Promise.resolve(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48']);
      if (method === 'eth_chainId') return Promise.resolve('0x1');
      return Promise.resolve(null);
    }),
    // Cast vi.fn() to avoid TypeScript intersection type incompatibility
    on: vi.fn() as unknown as MockProvider['on'],
    removeListener: vi.fn() as unknown as MockProvider['removeListener'],
  };
  return { ...base, ...overrides };
}

function makeProviderDetail(
  uuid = 'test-wallet',
  name = 'Test Wallet',
  providerOverrides: Partial<MockProvider> = {},
): EIP6963ProviderDetail {
  return {
    info: { uuid, name, icon: '', rdns: uuid },
    provider: makeProvider(providerOverrides),
  };
}

function resetWalletStore(): void {
  // Disconnect first (cleans up listeners)
  if (walletStore.isConnected) {
    walletStore.disconnect();
  }
  walletStore.address = null;
  walletStore.chainId = null;
  walletStore.provider = null;
  walletStore.walletInfo = null;
  walletStore.isConnecting = false;
  walletStore.message = '';
  walletStore.messageIsError = false;
  walletStore.pendingAction = null;
  walletStore.discoveredProviders = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('walletStore', () => {
  beforeEach(() => {
    resetWalletStore();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it('starts not connected', () => {
    expect(walletStore.isConnected).toBe(false);
    expect(walletStore.address).toBeNull();
    expect(walletStore.chainId).toBeNull();
    expect(walletStore.provider).toBeNull();
  });

  it('isConnected is false with null address', () => {
    walletStore.address = null;
    expect(walletStore.isConnected).toBe(false);
  });

  it('isConnected is true when address is set', () => {
    walletStore.address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    expect(walletStore.isConnected).toBe(true);
  });

  it('starts with empty discovered providers', () => {
    expect(walletStore.discoveredProviders).toHaveLength(0);
  });

  it('starts with no pending action', () => {
    expect(walletStore.pendingAction).toBeNull();
  });

  it('starts with no message', () => {
    expect(walletStore.message).toBe('');
    expect(walletStore.messageIsError).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // setMessage
  // ---------------------------------------------------------------------------

  it('setMessage stores message and clears error flag by default', () => {
    walletStore.setMessage('Hello');
    expect(walletStore.message).toBe('Hello');
    expect(walletStore.messageIsError).toBe(false);
  });

  it('setMessage stores error message when isError=true', () => {
    walletStore.setMessage('Something went wrong', true);
    expect(walletStore.message).toBe('Something went wrong');
    expect(walletStore.messageIsError).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // connect()
  // ---------------------------------------------------------------------------

  it('connect sets address with full 0x address (never truncated)', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    expect(walletStore.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(walletStore.address).toHaveLength(42);
    expect(walletStore.address).not.toContain('...');
  });

  it('connect sets chainId from eth_chainId response', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    expect(walletStore.chainId).toBe(1); // 0x1 → 1
  });

  it('connect sets provider and walletInfo', async () => {
    const detail = makeProviderDetail('metamask', 'MetaMask');
    await walletStore.connect(detail);

    // Svelte 5 $state wraps objects in a proxy, so use toStrictEqual for deep equality
    expect(walletStore.provider).not.toBeNull();
    expect(walletStore.walletInfo?.name).toBe('MetaMask');
    expect(walletStore.walletInfo?.uuid).toBe('metamask');
  });

  it('connect sets isConnected to true', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    expect(walletStore.isConnected).toBe(true);
  });

  it('connect calls provider.on for accountsChanged and chainChanged', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    const on = detail.provider.on as ReturnType<typeof vi.fn>;
    const events = on.mock.calls.map((call: unknown[]) => call[0]);
    expect(events).toContain('accountsChanged');
    expect(events).toContain('chainChanged');
  });

  it('connect handles user rejection (code 4001) gracefully', async () => {
    const rejectedProvider = makeProvider({
      request: vi.fn().mockRejectedValue({ code: 4001, message: 'User denied' }),
    });
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'test', name: 'Test' },
      provider: rejectedProvider,
    };

    await walletStore.connect(detail);

    expect(walletStore.isConnected).toBe(false);
    expect(walletStore.message).toBe('Connection canceled');
    expect(walletStore.messageIsError).toBe(true);
    expect(walletStore.pendingAction).toBeNull();
  });

  it('connect handles other errors gracefully', async () => {
    const errorProvider = makeProvider({
      request: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'test', name: 'Test' },
      provider: errorProvider,
    };

    await walletStore.connect(detail);

    expect(walletStore.isConnected).toBe(false);
    expect(walletStore.message).toContain('Connection failed');
  });

  it('connect sets isConnecting to false after completion', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    expect(walletStore.isConnecting).toBe(false);
  });

  it('connect rejects provider without request function', async () => {
    const badProvider = {} as EIP1193Provider;
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'bad', name: 'Bad Wallet' },
      provider: badProvider,
    };

    await walletStore.connect(detail);

    expect(walletStore.isConnected).toBe(false);
    expect(walletStore.message).toContain('not available');
  });

  it('connect handles no accounts returned', async () => {
    const emptyProvider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([]);
        return Promise.resolve(null);
      }),
    });
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'test', name: 'Test' },
      provider: emptyProvider,
    };

    await walletStore.connect(detail);

    expect(walletStore.isConnected).toBe(false);
    expect(walletStore.message).toContain('Connection failed');
  });

  // ---------------------------------------------------------------------------
  // disconnect()
  // ---------------------------------------------------------------------------

  it('disconnect clears address, chainId, provider, walletInfo', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    walletStore.disconnect();

    expect(walletStore.address).toBeNull();
    expect(walletStore.chainId).toBeNull();
    expect(walletStore.provider).toBeNull();
    expect(walletStore.walletInfo).toBeNull();
    expect(walletStore.isConnected).toBe(false);
  });

  it('disconnect calls removeListener on provider', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    walletStore.disconnect();

    const removeListener = detail.provider.removeListener as ReturnType<typeof vi.fn>;
    expect(removeListener).toHaveBeenCalled();
    const events = removeListener.mock.calls.map((call: unknown[]) => call[0]);
    expect(events).toContain('accountsChanged');
    expect(events).toContain('chainChanged');
  });

  it('disconnect sets a message', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);
    walletStore.disconnect();

    expect(walletStore.message).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Pending action
  // ---------------------------------------------------------------------------

  it('pendingAction can be set before connect', () => {
    walletStore.pendingAction = { type: 'approve', params: { token: '0xabc' } };
    expect(walletStore.pendingAction).toEqual({ type: 'approve', params: { token: '0xabc' } });
  });

  it('pendingAction can be set to swap type', () => {
    walletStore.pendingAction = { type: 'swap', params: { from: '0x1', to: '0x2' } };
    expect(walletStore.pendingAction?.type).toBe('swap');
  });

  it('pendingAction is cleared on user rejection (4001)', async () => {
    walletStore.pendingAction = { type: 'swap', params: {} };

    const rejectedProvider = makeProvider({
      request: vi.fn().mockRejectedValue({ code: 4001 }),
    });
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'test', name: 'Test' },
      provider: rejectedProvider,
    };

    await walletStore.connect(detail);

    expect(walletStore.pendingAction).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // EIP-6963 discovery
  // ---------------------------------------------------------------------------

  it('startDiscovery adds providers from announceProvider events', () => {
    walletStore.startDiscovery();

    const provider = makeProvider();
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'metamask', name: 'MetaMask' },
      provider,
    };

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));

    expect(walletStore.discoveredProviders).toHaveLength(1);
    expect(walletStore.discoveredProviders[0]?.info.name).toBe('MetaMask');

    walletStore.stopDiscovery();
    walletStore.discoveredProviders = [];
  });

  it('startDiscovery ignores duplicate providers (same uuid)', () => {
    walletStore.startDiscovery();

    const provider = makeProvider();
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'metamask', name: 'MetaMask' },
      provider,
    };

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));

    expect(walletStore.discoveredProviders).toHaveLength(1);

    walletStore.stopDiscovery();
    walletStore.discoveredProviders = [];
  });

  it('stopDiscovery prevents further provider announcements from being processed', () => {
    walletStore.startDiscovery();
    walletStore.stopDiscovery();

    const provider = makeProvider();
    const detail: EIP6963ProviderDetail = {
      info: { uuid: 'metamask2', name: 'MetaMask' },
      provider,
    };

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));

    expect(walletStore.discoveredProviders).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // switchChain()
  // ---------------------------------------------------------------------------

  it('switchChain sends wallet_switchEthereumChain request', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    await walletStore.switchChain(8453);

    const provider = detail.provider;
    const requestMock = provider.request as ReturnType<typeof vi.fn>;
    const switchCall = requestMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { method: string }).method === 'wallet_switchEthereumChain',
    );
    expect(switchCall).toBeDefined();
    const switchParams = (switchCall![0] as { params: Array<{ chainId: string }> }).params;
    expect(switchParams[0]?.chainId).toBe('0x2105'); // Base
  });

  it('switchChain updates chainId on success', async () => {
    const detail = makeProviderDetail();
    await walletStore.connect(detail);

    const requestMock = detail.provider.request as ReturnType<typeof vi.fn>;
    requestMock.mockImplementation(({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') return Promise.resolve(null);
      if (method === 'eth_chainId') return Promise.resolve('0x1');
      if (method === 'eth_requestAccounts')
        return Promise.resolve(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48']);
      return Promise.resolve(null);
    });

    await walletStore.switchChain(8453);

    expect(walletStore.chainId).toBe(8453);
  });

  it('switchChain with no provider sets an error message', async () => {
    await walletStore.switchChain(8453);

    expect(walletStore.message).toContain('Connect wallet first');
    expect(walletStore.messageIsError).toBe(true);
  });
});
