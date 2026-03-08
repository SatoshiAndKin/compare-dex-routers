import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import QuoteDetails from '../lib/components/QuoteDetails.svelte';
import type { SpandexQuote, CurveQuote } from '../lib/stores/comparisonStore.svelte.js';

const mockSpandexQuote: SpandexQuote = {
  chainId: 1,
  from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  from_symbol: 'USDC',
  to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  to_symbol: 'USDT',
  amount: '100',
  input_amount: '100',
  output_amount: '99.95',
  input_amount_raw: '100000000',
  output_amount_raw: '99950000',
  mode: 'exactIn',
  provider: '0x',
  slippage_bps: 50,
  router_address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
  router_calldata: '0xabcdef1234567890',
  router_value: '0x0',
  approval_token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  approval_spender: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
  gas_used: '120000',
  gas_cost_eth: '0.0024',
  net_value_eth: '0.0976',
};

const mockCurveQuote: CurveQuote = {
  source: 'curve',
  from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  from_symbol: 'USDC',
  to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  to_symbol: 'USDT',
  amount: '100',
  input_amount: '100',
  output_amount: '99.98',
  input_amount_raw: '100000000',
  output_amount_raw: '99980000',
  mode: 'exactIn',
  router_address: '0x99a58482bd75cbab83b27ec03ca68ff489b5788f',
  router_calldata: '0x987654321',
  gas_used: '150000',
  gas_cost_eth: '0.003',
  route: [
    {
      poolId: 'pool1',
      poolName: 'USDC/USDT Pool',
      inputCoinAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      outputCoinAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
  ],
};

describe('QuoteDetails', () => {
  it('is hidden by default — details content not shown', () => {
    const { container } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });
    const detailsContent = container.querySelector('.details-content');
    expect(detailsContent).toBeNull();
  });

  it('shows details content after toggle button is clicked', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    const toggle = getByText(/Details/);
    await fireEvent.click(toggle);

    const detailsContent = container.querySelector('.details-content');
    expect(detailsContent).not.toBeNull();
  });

  it('collapses details when toggle is clicked again', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    const toggle = getByText(/Details/);
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);

    const detailsContent = container.querySelector('.details-content');
    expect(detailsContent).toBeNull();
  });

  it('displays FULL router address — never truncated', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));

    const fullAddress = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';
    const addressElements = container.querySelectorAll('.detail-value.mono');
    const found = Array.from(addressElements).some(
      (el) => el.textContent?.includes(fullAddress),
    );
    expect(found).toBe(true);
  });

  it('router address is never truncated (no ellipsis pattern)', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));

    const addressElements = container.querySelectorAll('.detail-value.mono');
    addressElements.forEach((el) => {
      expect(el.textContent).not.toMatch(/0x[0-9a-fA-F]{4}\.{3}[0-9a-fA-F]{4}/);
    });
  });

  it('displays FULL from token address', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));

    const fullFromAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const found = container.textContent?.includes(fullFromAddress);
    expect(found).toBe(true);
  });

  it('displays FULL to token address', async () => {
    const { container, getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));

    const fullToAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    const found = container.textContent?.includes(fullToAddress);
    expect(found).toBe(true);
  });

  it('displays gas cost when available', async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/0\.0024 ETH/)).toBeTruthy();
  });

  it('displays gas price in gwei when provided', async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex', gasPriceGwei: '30' },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/30 gwei/)).toBeTruthy();
  });

  it('displays slippage for Spandex quotes', async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/50 bps/)).toBeTruthy();
  });

  it('displays amounts in wei', async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText('100000000')).toBeTruthy();
    expect(getByText('99950000')).toBeTruthy();
  });

  it('displays Curve route steps when available', async () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockCurveQuote, type: 'curve' },
    });

    await fireEvent.click(getByText(/Details/));
    expect(getByText(/USDC\/USDT Pool/)).toBeTruthy();
  });

  it('shows details toggle button', () => {
    const { getByText } = render(QuoteDetails, {
      props: { quote: mockSpandexQuote, type: 'spandex' },
    });
    expect(getByText(/Details/)).toBeTruthy();
  });
});
