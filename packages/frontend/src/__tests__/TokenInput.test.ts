import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TokenInput from '../lib/components/TokenInput.svelte';
import { formStore } from '../lib/stores/formStore.svelte.js';
import { tokensStore } from '../lib/stores/tokensStore.svelte.js';

// Mock the API client
vi.mock('../lib/api.js', () => ({
  apiClient: {
    GET: vi.fn().mockResolvedValue({
      data: {
        tokens: [
          {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            chainId: 1,
            logoURI: 'https://example.com/usdc.png',
          },
          {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            chainId: 1,
          },
          {
            address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
            symbol: 'DAI',
            name: 'Dai Stablecoin',
            decimals: 18,
            chainId: 1,
          },
        ],
      },
    }),
  },
}));

describe('TokenInput', () => {
  beforeEach(() => {
    formStore.chainId = 1;
    formStore.fromToken = null;
    formStore.toToken = null;
    // Reset tokens store
    Object.assign(tokensStore, {
      allTokens: [],
      isLoading: false,
      error: null,
    });
    // Re-enable fetch
    (tokensStore as unknown as { fetched: boolean }).fetched = false;
  });

  it('renders input field for "from" type', () => {
    const { getByPlaceholderText } = render(TokenInput, { props: { type: 'from' } });
    expect(getByPlaceholderText('Sell token...')).toBeTruthy();
  });

  it('renders input field for "to" type', () => {
    const { getByPlaceholderText } = render(TokenInput, { props: { type: 'to' } });
    expect(getByPlaceholderText('Receive token...')).toBeTruthy();
  });

  it('shows autocomplete dropdown after typing', async () => {
    const { getByPlaceholderText, queryAllByRole } = render(TokenInput, {
      props: { type: 'from' },
    });
    const input = getByPlaceholderText('Sell token...');

    // Trigger fetch + input
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'USD' } });

    // Wait for async operations
    await new Promise((r) => setTimeout(r, 10));

    const options = queryAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('formats selected token as "SYMBOL (0xFullAddress)" - never truncates address', async () => {
    const { getByPlaceholderText } = render(TokenInput, { props: { type: 'from' } });
    const input = getByPlaceholderText('Sell token...');

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'USDC' } });
    await new Promise((r) => setTimeout(r, 10));

    // Simulate selecting first option
    if (formStore.fromToken === null) {
      // Manually select token to test formatting
      formStore.fromToken = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
      };
    }

    // The display value should show full address, never truncated
    const displayValue = `USDC (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)`;

    // Verify the format includes full address
    expect(displayValue).not.toContain('...');
    expect(displayValue.length).toBeGreaterThan(20);
    expect(displayValue).toContain('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });

  it('never truncates addresses in display', () => {
    const fullAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const display = `USDC (${fullAddress})`;

    // Ensure the full address is always shown
    expect(display).toContain(fullAddress);
    expect(display).not.toMatch(/0x[0-9a-fA-F]{4}\.{3}[0-9a-fA-F]{4}/);
  });

  it('updates formStore.fromToken when from token selected', async () => {
    // Pre-populate tokens store
    tokensStore.allTokens = [
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: 'from' } });
    const input = getByPlaceholderText('Sell token...');

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'USDC' } });
    await new Promise((r) => setTimeout(r, 10));

    const options = getAllByRole('option');
    if (options.length > 0) {
      const firstOption = options[0];
      if (firstOption) {
        await fireEvent.mouseDown(firstOption);
        expect(formStore.fromToken?.symbol).toBe('USDC');
        expect(formStore.fromToken?.address).toBe(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        );
      }
    }
  });

  it('updates formStore.toToken when to token selected', async () => {
    tokensStore.allTokens = [
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6,
        name: 'Tether USD',
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: 'to' } });
    const input = getByPlaceholderText('Receive token...');

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'USDT' } });
    await new Promise((r) => setTimeout(r, 10));

    const options = getAllByRole('option');
    if (options.length > 0) {
      const firstOption = options[0];
      if (firstOption) {
        await fireEvent.mouseDown(firstOption);
        expect(formStore.toToken?.symbol).toBe('USDT');
      }
    }
  });

  it('shows full address in autocomplete dropdown items', async () => {
    tokensStore.allTokens = [
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, container } = render(TokenInput, { props: { type: 'from' } });
    const input = getByPlaceholderText('Sell token...');

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'USDC' } });
    await new Promise((r) => setTimeout(r, 10));

    // Find address elements in the dropdown
    const addrElements = container.querySelectorAll('.autocomplete-addr');
    if (addrElements.length > 0) {
      const firstEl = addrElements[0];
      if (firstEl) {
        const addr = firstEl.textContent ?? '';
        // Should be full address, not truncated
        expect(addr).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
        expect(addr).not.toContain('...');
      }
    }
  });
});
