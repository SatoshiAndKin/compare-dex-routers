import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { balanceStore, formatBalance, fetchTokenBalance } from '../lib/stores/balanceStore.svelte.js';
import type { EIP1193Provider } from '../lib/stores/walletStore.svelte.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(requestImpl?: (args: { method: string; params?: unknown[] }) => Promise<unknown>): EIP1193Provider {
  return {
    request: vi.fn().mockImplementation(
      requestImpl ??
        (({ method }: { method: string }) => {
          if (method === 'eth_call') {
            // Return 100 USDC (100 * 10^6 = 100_000_000 = 0x5F5E100)
            return Promise.resolve('0x0000000000000000000000000000000000000000000000000000000005f5e100');
          }
          if (method === 'eth_getBalance') {
            // Return 1 ETH in wei
            return Promise.resolve('0x0de0b6b3a7640000');
          }
          return Promise.resolve('0x0');
        }),
    ),
  };
}

function resetBalanceStore(): void {
  balanceStore.fromBalance = null;
  balanceStore.toBalance = null;
  balanceStore.clearCache();
}

// ---------------------------------------------------------------------------
// formatBalance tests
// ---------------------------------------------------------------------------

describe('formatBalance', () => {
  it('formats 1 ETH (18 decimals)', () => {
    const oneEth = BigInt('1000000000000000000');
    expect(formatBalance(oneEth, 18)).toBe('1');
  });

  it('formats 1.5 ETH', () => {
    const oneAndHalf = BigInt('1500000000000000000');
    expect(formatBalance(oneAndHalf, 18)).toBe('1.5');
  });

  it('formats 100 USDC (6 decimals)', () => {
    const hundredUsdc = BigInt('100000000');
    expect(formatBalance(hundredUsdc, 6)).toBe('100');
  });

  it('formats 1234.56 USDC', () => {
    const amount = BigInt('1234560000');
    expect(formatBalance(amount, 6)).toBe('1,234.56');
  });

  it('removes trailing zeros from fractional part', () => {
    const amount = BigInt('1500000'); // 1.5 USDC
    expect(formatBalance(amount, 6)).toBe('1.5');
  });

  it('limits to 6 decimal places', () => {
    const amount = BigInt('1123456789'); // 1.123456789 with 9 decimals
    const result = formatBalance(amount, 9);
    const decimalPart = result.split('.')[1] ?? '';
    expect(decimalPart.length).toBeLessThanOrEqual(6);
  });

  it('adds thousand separators to whole part', () => {
    const amount = BigInt('1234567000000'); // 1,234,567 USDC (6 decimals)
    expect(formatBalance(amount, 6)).toBe('1,234,567');
  });

  it('formats 0 balance', () => {
    expect(formatBalance(BigInt(0), 18)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// fetchTokenBalance tests
// ---------------------------------------------------------------------------

describe('fetchTokenBalance', () => {
  beforeEach(() => {
    balanceStore.clearCache();
  });

  it('fetches ERC-20 balance via eth_call', async () => {
    const provider = makeProvider();
    const result = await fetchTokenBalance(
      provider,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0x1234567890123456789012345678901234567890',
      6,
      1,
    );
    expect(result).not.toBeNull();
    expect(result).toBe('100');
  });

  it('fetches native token balance via eth_getBalance', async () => {
    const provider = makeProvider();
    const result = await fetchTokenBalance(
      provider,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x1234567890123456789012345678901234567890',
      18,
      1,
    );
    expect(result).not.toBeNull();
    // 0x0de0b6b3a7640000 = 1 ETH
    expect(result).toBe('1');
  });

  it('treats zero address as native token', async () => {
    const provider = makeProvider();
    const requestMock = provider.request as ReturnType<typeof vi.fn>;

    await fetchTokenBalance(
      provider,
      '0x0000000000000000000000000000000000000000',
      '0x1234567890123456789012345678901234567890',
      18,
      1,
    );

    const methods = requestMock.mock.calls.map(
      (call: unknown[]) => (call[0] as { method: string }).method,
    );
    expect(methods).toContain('eth_getBalance');
  });

  it('returns null on provider error (no throw)', async () => {
    const errorProvider: EIP1193Provider = {
      request: vi.fn().mockRejectedValue(new Error('RPC error')),
    };
    const result = await fetchTokenBalance(
      errorProvider,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0x1234567890123456789012345678901234567890',
      6,
      1,
    );
    expect(result).toBeNull();
  });

  it('returns null for missing arguments', async () => {
    const provider = makeProvider();
    expect(await fetchTokenBalance(provider, '', '0xabc', 18, 1)).toBeNull();
    expect(await fetchTokenBalance(provider, '0xabc', '', 18, 1)).toBeNull();
  });

  it('uses cached result within TTL', async () => {
    const provider = makeProvider();
    const args = [
      provider,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0x1234567890123456789012345678901234567890',
      6,
      1,
    ] as const;

    await fetchTokenBalance(...args);
    await fetchTokenBalance(...args);

    // Second call should use cache, so request should only be called once
    const requestMock = provider.request as ReturnType<typeof vi.fn>;
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// BalanceStore class tests
// ---------------------------------------------------------------------------

describe('balanceStore', () => {
  beforeEach(() => {
    resetBalanceStore();
  });

  afterEach(() => {
    resetBalanceStore();
  });

  it('starts with null balances', () => {
    expect(balanceStore.fromBalance).toBeNull();
    expect(balanceStore.toBalance).toBeNull();
  });

  it('clear() sets both balances to null', () => {
    balanceStore.fromBalance = '100';
    balanceStore.toBalance = '200';

    balanceStore.clear();

    expect(balanceStore.fromBalance).toBeNull();
    expect(balanceStore.toBalance).toBeNull();
  });

  it('fetchBalances populates fromBalance', async () => {
    const provider = makeProvider();

    await balanceStore.fetchBalances(
      provider,
      '0x1234567890123456789012345678901234567890',
      1,
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      null,
    );

    expect(balanceStore.fromBalance).not.toBeNull();
    expect(balanceStore.fromBalance).toBe('100');
  });

  it('fetchBalances populates toBalance', async () => {
    const provider = makeProvider();

    await balanceStore.fetchBalances(
      provider,
      '0x1234567890123456789012345678901234567890',
      1,
      null,
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    );

    expect(balanceStore.toBalance).not.toBeNull();
    expect(balanceStore.toBalance).toBe('100');
  });

  it('fetchBalances with null tokens clears balances', async () => {
    const provider = makeProvider();

    balanceStore.fromBalance = 'old value';
    balanceStore.toBalance = 'old value';

    await balanceStore.fetchBalances(provider, '0x1234', 1, null, null);

    expect(balanceStore.fromBalance).toBeNull();
    expect(balanceStore.toBalance).toBeNull();
  });

  it('clears on disconnect (clear method)', () => {
    balanceStore.fromBalance = '1,234.56';
    balanceStore.toBalance = '0.5';

    balanceStore.clear();

    expect(balanceStore.fromBalance).toBeNull();
    expect(balanceStore.toBalance).toBeNull();
  });

  it('fetchBalances handles provider errors gracefully', async () => {
    const errorProvider: EIP1193Provider = {
      request: vi.fn().mockRejectedValue(new Error('RPC error')),
    };

    // Should not throw
    await expect(
      balanceStore.fetchBalances(
        errorProvider,
        '0x1234',
        1,
        { address: '0xtoken', decimals: 18 },
        null,
      ),
    ).resolves.not.toThrow();

    expect(balanceStore.fromBalance).toBeNull();
  });
});
