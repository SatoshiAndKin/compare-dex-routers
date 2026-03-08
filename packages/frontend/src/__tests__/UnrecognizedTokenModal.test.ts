import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import UnrecognizedTokenModal from '../lib/components/UnrecognizedTokenModal.svelte';
import { tokenListStore } from '../lib/stores/tokenListStore.svelte.js';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const mockChainId = 1;

type MockGetFn = (
  path: string,
  options?: unknown,
) => Promise<{ data?: unknown; error?: unknown }>;

let mockGetImpl: MockGetFn;

vi.mock('../lib/api.js', () => ({
  apiClient: {
    GET: vi.fn((...args: unknown[]) => mockGetImpl(args[0] as string, args[1])),
  },
}));

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
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

describe('UnrecognizedTokenModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    localStorage.clear();

    // Default mock: successful metadata fetch
    mockGetImpl = async (path: string) => {
      if (path === '/token-metadata') {
        return {
          data: { name: 'Test Token', symbol: 'TEST', decimals: 18 },
        };
      }
      return { error: { error: 'Not found' } };
    };
  });

  afterEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Rendering when modal is null
  // -------------------------------------------------------------------------

  it('renders nothing when unrecognizedModal is null', () => {
    const { container } = render(UnrecognizedTokenModal);
    expect(container.querySelector('.modal-backdrop')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Rendering when modal is open
  // -------------------------------------------------------------------------

  it('shows modal when unrecognizedModal is set', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { container } = render(UnrecognizedTokenModal);

    // Wait for any microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('.modal-backdrop')).not.toBeNull();
  });

  it('displays "Unrecognized Token" title', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 0));

    expect(getByText('Unrecognized Token')).toBeTruthy();
  });

  it('displays the full address — never truncated', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 0));

    // Full 42-char address must appear
    expect(getByText(mockAddress)).toBeTruthy();
  });

  it('has dialog role for accessibility', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByRole } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 0));

    expect(getByRole('dialog')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('shows loading state while fetching metadata', async () => {
    // Make the fetch never resolve during this test
    mockGetImpl = async () => new Promise(() => {});

    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    // Don't wait — loading should be visible immediately
    await new Promise((r) => setTimeout(r, 0));

    expect(getByText(/loading token metadata/i)).toBeTruthy();
  });

  it('Save button is disabled during loading', async () => {
    mockGetImpl = async () => new Promise(() => {});

    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 0));

    const saveBtn = getByText('Save to My Tokens') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Loaded state
  // -------------------------------------------------------------------------

  it('shows metadata after successful fetch', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    expect(getByText('Test Token')).toBeTruthy();
    expect(getByText('TEST')).toBeTruthy();
    expect(getByText('18')).toBeTruthy();
  });

  it('enables Save button after metadata loads', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    const saveBtn = getByText('Save to My Tokens') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error state (non-ERC-20 / network error)
  // -------------------------------------------------------------------------

  it('shows error message when metadata fetch fails', async () => {
    mockGetImpl = async () => ({
      error: { error: 'Not a valid ERC-20 token' },
    });

    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByRole } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    const alertEl = getByRole('alert');
    expect(alertEl.textContent).toContain('Not a valid ERC-20 token');
  });

  it('Save button is disabled when fetch returns error', async () => {
    mockGetImpl = async () => ({
      error: { error: 'Not a valid ERC-20 token' },
    });

    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    const saveBtn = getByText('Save to My Tokens') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('shows error when fetch throws a network exception', async () => {
    mockGetImpl = async () => {
      throw new Error('Network error');
    };

    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByRole } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    const alertEl = getByRole('alert');
    expect(alertEl.textContent).toContain('Network error');
  });

  // -------------------------------------------------------------------------
  // Save button adds to local tokens
  // -------------------------------------------------------------------------

  it('clicking Save adds token to tokenListStore.localTokens', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(getByText('Save to My Tokens'));

    expect(tokenListStore.localTokens).toHaveLength(1);
    expect(tokenListStore.localTokens[0]!.address).toBe(mockAddress);
    expect(tokenListStore.localTokens[0]!.symbol).toBe('TEST');
    expect(tokenListStore.localTokens[0]!.decimals).toBe(18);
    // Never truncate address
    expect(tokenListStore.localTokens[0]!.address).toBe(mockAddress);
  });

  it('clicking Save closes the modal (sets unrecognizedModal to null)', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(getByText('Save to My Tokens'));

    expect(tokenListStore.unrecognizedModal).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cancel button
  // -------------------------------------------------------------------------

  it('Cancel button closes the modal', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(getByText('Cancel'));

    expect(tokenListStore.unrecognizedModal).toBeNull();
  });

  it('Cancel button does NOT add token to local tokens', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(getByText('Cancel'));

    expect(tokenListStore.localTokens).toHaveLength(0);
  });

  it('× close button cancels the modal', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByLabelText } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(getByLabelText('Cancel'));

    expect(tokenListStore.unrecognizedModal).toBeNull();
  });

  it('Escape key closes the modal', async () => {
    tokenListStore.unrecognizedModal = {
      address: mockAddress,
      chainId: mockChainId,
      targetType: 'from',
    };

    const { getByRole } = render(UnrecognizedTokenModal);
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });

    expect(tokenListStore.unrecognizedModal).toBeNull();
  });
});
