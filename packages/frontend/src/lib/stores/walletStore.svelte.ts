/**
 * Wallet store managing wallet connection state.
 * Handles EIP-6963 provider discovery, WalletConnect (CDN), and Farcaster SDK (CDN).
 * Ported from src/client/wallet.ts for Svelte 5.
 */

// ---------------------------------------------------------------------------
// EIP-6963 / EIP-1193 types (defined locally — no cross-package import)
// ---------------------------------------------------------------------------

/** Minimal EIP-1193 provider interface */
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

/** EIP-6963 wallet provider info */
export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon?: string;
  rdns?: string;
}

/** EIP-6963 wallet provider detail (info + provider) */
export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

/** Pending wallet action (auto-approve / auto-swap after connect) */
export interface PendingAction {
  type: 'approve' | 'swap';
  params: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Chain ID → hex string for wallet_switchEthereumChain */
const CHAIN_ID_HEX_MAP: Readonly<Record<string, string>> = {
  '1': '0x1',
  '10': '0xa',
  '56': '0x38',
  '137': '0x89',
  '8453': '0x2105',
  '42161': '0xa4b1',
  '43114': '0xa86a',
};

const WALLETCONNECT_ICON =
  `data:image/svg+xml,` +
  encodeURIComponent(
    '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="32" height="32" rx="6" fill="#3B99FC"/>' +
      '<path d="M10.05 12.36c3.28-3.21 8.62-3.21 11.9 0l.4.39a.41.41 0 0 1 0 .58l-1.35 ' +
      '1.32a.21.21 0 0 1-.3 0l-.54-.53c-2.29-2.24-6.01-2.24-8.3 0l-.58.57a.21.21 0 0 1-.3 0l-1.35-1.32a.41.41 0 0 1 0-.58l.42-.43Z' +
      'M24.75 15.1l1.2 1.18a.41.41 0 0 1 0 .58l-5.43 5.31a.42.42 0 0 1-.6 0l-3.85-3.77a.1.1 0 0 0-.15 0' +
      'l-3.85 3.77a.42.42 0 0 1-.6 0l-5.42-5.31a.41.41 0 0 1 0-.58l1.2-1.18a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 0 0 0 .15 0' +
      'l3.85-3.77a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 0 0 0 .15 0l3.85-3.77a.42.42 0 0 1 .6 0Z" fill="#fff"/></svg>',
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChainIdHex(chainId: number): string {
  const mapped = CHAIN_ID_HEX_MAP[String(chainId)];
  if (mapped) return mapped;
  if (!Number.isFinite(chainId) || chainId < 0) return '0x0';
  return '0x' + chainId.toString(16);
}

// ---------------------------------------------------------------------------
// WalletStore class
// ---------------------------------------------------------------------------

class WalletStore {
  /** Full 0x wallet address — NEVER truncated */
  address = $state<string | null>(null);
  /** Current chain ID from connected wallet */
  chainId = $state<number | null>(null);
  /** Connected EIP-1193 provider */
  provider = $state<EIP1193Provider | null>(null);
  /** Wallet provider info (name, icon) */
  walletInfo = $state<EIP6963ProviderInfo | null>(null);
  /** Whether a connection attempt is in progress */
  isConnecting = $state(false);
  /** Status / error message */
  message = $state('');
  /** Whether message is an error */
  messageIsError = $state(false);
  /** Pending action stored for auto-approve/swap after connect */
  pendingAction = $state<PendingAction | null>(null);
  /** EIP-6963 discovered providers */
  discoveredProviders = $state<EIP6963ProviderDetail[]>([]);
  /** Set to true when a transaction action needs the wallet menu to open */
  walletMenuRequested = $state(false);

  // Private event handler references (for cleanup)
  private _accountsChangedHandler: ((...args: unknown[]) => void) | null = null;
  private _chainChangedHandler: ((...args: unknown[]) => void) | null = null;
  private _announceHandler: ((event: Event) => void) | null = null;

  /** Whether a wallet is currently connected */
  get isConnected(): boolean {
    return this.address !== null;
  }

  // ---------------------------------------------------------------------------
  // Status message
  // ---------------------------------------------------------------------------

  setMessage(msg: string, isError = false): void {
    this.message = msg;
    this.messageIsError = isError;
  }

  // ---------------------------------------------------------------------------
  // Wallet menu request (used by transactionStore to trigger menu opening)
  // ---------------------------------------------------------------------------

  /** Request the wallet provider menu to open (e.g. when user clicks Approve/Swap without wallet). */
  requestMenu(): void {
    this.walletMenuRequested = true;
  }

  /** Acknowledge and clear the wallet menu request (called by App.svelte after opening menu). */
  ackMenuRequest(): void {
    this.walletMenuRequested = false;
  }

  // ---------------------------------------------------------------------------
  // EIP-6963 provider discovery
  // ---------------------------------------------------------------------------

  /**
   * Start EIP-6963 provider discovery.
   * Should be called once from App.svelte's onMount.
   */
  startDiscovery(): void {
    if (this._announceHandler) return; // already running

    this._announceHandler = (event: Event) => {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      if (!detail?.provider || !detail?.info?.uuid) return;

      const alreadyKnown = this.discoveredProviders.some(
        (p) => p.info.uuid === detail.info.uuid,
      );
      if (!alreadyKnown) {
        this.discoveredProviders = [...this.discoveredProviders, detail];
      }
    };

    window.addEventListener('eip6963:announceProvider', this._announceHandler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  /** Stop EIP-6963 provider discovery and remove listener. */
  stopDiscovery(): void {
    if (this._announceHandler) {
      window.removeEventListener('eip6963:announceProvider', this._announceHandler);
      this._announceHandler = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  /** Connect to an EIP-6963 provider. */
  async connect(detail: EIP6963ProviderDetail): Promise<void> {
    const { provider, info } = detail;

    if (typeof provider?.request !== 'function') {
      this.setMessage('Wallet provider not available', true);
      return;
    }

    this.isConnecting = true;
    this.setMessage('');

    try {
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[];

      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof account !== 'string' || !account) {
        throw new Error('No account returned by wallet');
      }

      // Get current chain ID from provider
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
      const chainId = parseInt(chainIdHex, 16);

      // Update state — full address, never truncated
      this.address = account;
      this.chainId = chainId;
      this.provider = provider;
      this.walletInfo = info;

      // Set up accountsChanged listener
      this._accountsChangedHandler = (...args: unknown[]) => {
        const updatedAccounts = args[0] as string[];
        if (!Array.isArray(updatedAccounts) || updatedAccounts.length === 0) {
          this.disconnect();
        } else {
          // Update address — full address, never truncated
          this.address = updatedAccounts[0] ?? null;
        }
      };

      // Set up chainChanged listener
      this._chainChangedHandler = (...args: unknown[]) => {
        const newChainId = args[0] as string;
        this.chainId = parseInt(String(newChainId), 16);
      };

      if (provider.on) {
        provider.on('accountsChanged', this._accountsChangedHandler);
        provider.on('chainChanged', this._chainChangedHandler);
      }

      this.setMessage('');
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' ? (err as Record<string, unknown>).code : undefined;
      if (code === 4001) {
        this.setMessage('Connection canceled', true);
        this.pendingAction = null;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.setMessage('Connection failed: ' + msg, true);
      }
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Connect via WalletConnect using CDN ESM dynamic import.
   * WalletConnect is never bundled — always loaded from esm.sh at runtime.
   */
  async connectWalletConnect(projectId: string): Promise<void> {
    if (!projectId) {
      this.setMessage('WalletConnect not configured (missing project ID)', true);
      return;
    }

    this.isConnecting = true;
    this.setMessage('');

    try {
      // CDN ESM dynamic import — never bundled with npm.
      // Use a string variable so TypeScript doesn't attempt static module resolution.
      const wcUrl = 'https://esm.sh/@walletconnect/ethereum-provider@2';
      const { EthereumProvider } = (await import(/* @vite-ignore */ wcUrl)) as {
        EthereumProvider: {
          init(opts: Record<string, unknown>): Promise<
            EIP1193Provider & {
              on(e: string, h: (...a: unknown[]) => void): void;
              connect(): Promise<void>;
            }
          >;
        };
      };

      const wcProvider = await EthereumProvider.init({
        projectId,
        optionalChains: [1, 8453, 42161, 10, 137, 56, 43114],
        metadata: {
          name: 'Compare DEX Routers',
          description: 'Compare DEX Router Quotes',
          url: location.origin,
          icons: [],
        },
        showQrModal: true,
      });

      wcProvider.on('disconnect', () => {
        this.disconnect();
      });

      await wcProvider.connect();

      await this.connect({
        info: {
          uuid: 'walletconnect',
          name: 'WalletConnect',
          icon: WALLETCONNECT_ICON,
          rdns: 'walletconnect',
        },
        provider: wcProvider,
      });
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' ? (err as Record<string, unknown>).code : undefined;
      if (code === 4001) {
        this.setMessage('WalletConnect connection canceled', true);
        this.pendingAction = null;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.setMessage('WalletConnect failed: ' + msg, true);
      }
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Connect via Farcaster frame SDK using CDN ESM dynamic import.
   * Farcaster SDK is never bundled — always loaded from esm.sh at runtime.
   */
  async connectFarcaster(): Promise<void> {
    this.isConnecting = true;
    this.setMessage('');

    try {
      // CDN ESM dynamic import — never bundled with npm.
      // Use a string variable so TypeScript doesn't attempt static module resolution.
      const farcasterUrl = 'https://esm.sh/@farcaster/frame-sdk';
      const { sdk } = (await import(/* @vite-ignore */ farcasterUrl)) as {
        sdk: {
          wallet: { ethProvider: EIP1193Provider };
          actions: { ready(): Promise<void> };
        };
      };

      const ethProvider = sdk.wallet.ethProvider;

      await this.connect({
        info: { uuid: 'farcaster', name: 'Farcaster', rdns: 'farcaster' },
        provider: ethProvider,
      });

      // Signal to Farcaster frame that the app is ready
      await sdk.actions.ready();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setMessage('Farcaster connection failed: ' + msg, true);
    } finally {
      this.isConnecting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnect
  // ---------------------------------------------------------------------------

  /** Disconnect the current wallet and clear all state. */
  disconnect(): void {
    // Remove event listeners from previous provider
    if (this.provider?.removeListener) {
      if (this._accountsChangedHandler) {
        this.provider.removeListener('accountsChanged', this._accountsChangedHandler);
      }
      if (this._chainChangedHandler) {
        this.provider.removeListener('chainChanged', this._chainChangedHandler);
      }
    }

    this.address = null;
    this.chainId = null;
    this.provider = null;
    this.walletInfo = null;
    this._accountsChangedHandler = null;
    this._chainChangedHandler = null;
    this.setMessage('Wallet disconnected');
  }

  // ---------------------------------------------------------------------------
  // Chain switching
  // ---------------------------------------------------------------------------

  /** Switch the wallet to the specified chain. */
  async switchChain(targetChainId: number): Promise<void> {
    if (!this.provider) {
      this.setMessage('Connect wallet first', true);
      return;
    }

    const chainIdHex = getChainIdHex(targetChainId);

    try {
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
      this.chainId = targetChainId;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' ? (err as Record<string, unknown>).code : undefined;
      if (code !== 4001) {
        const msg = err instanceof Error ? err.message : String(err);
        this.setMessage('Failed to switch chain: ' + msg, true);
      }
    }
  }
}

export const walletStore = new WalletStore();
