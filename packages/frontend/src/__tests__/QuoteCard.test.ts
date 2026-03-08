import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QuoteCard from '../lib/components/QuoteCard.svelte';
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
  router_address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
  router_calldata: '0xabcdef',
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
  router_calldata: '0x123456',
  gas_used: '150000',
  gas_cost_eth: '0.003',
};

describe('QuoteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders provider name "Spandex" for spandex provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Spandex/)).toBeTruthy();
  });

  it('renders provider name "Curve" for curve provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'curve',
        quote: mockCurveQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Curve/)).toBeTruthy();
  });

  it('shows loading state with aria-busy when loading=true', () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: null,
        loading: true,
        isRecommended: false,
      },
    });
    const loadingEl = container.querySelector('[aria-busy="true"]');
    expect(loadingEl).not.toBeNull();
  });

  it('shows "Loading..." text during loading', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: null,
        loading: true,
        isRecommended: false,
      },
    });
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('shows RECOMMENDED badge when isRecommended=true', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: true,
      },
    });
    expect(getByText('RECOMMENDED')).toBeTruthy();
  });

  it('shows ALTERNATIVE badge when isRecommended=false', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'curve',
        quote: mockCurveQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText('ALTERNATIVE')).toBeTruthy();
  });

  it('applies winner CSS class when isRecommended=true', () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: true,
      },
    });
    const card = container.querySelector('.quote-card');
    expect(card?.classList.contains('winner')).toBe(true);
  });

  it('shows error message when error prop is provided', () => {
    const errorMessage = 'Insufficient liquidity for this trade';
    const { getByText, getByRole } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: null,
        error: errorMessage,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(errorMessage)).toBeTruthy();
    expect(getByRole('alert')).toBeTruthy();
  });

  it('displays output amount and symbol', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    // Output amount should be shown
    expect(getByText(/99\.95/)).toBeTruthy();
  });

  it('shows gas cost when available', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/0\.0024 ETH/)).toBeTruthy();
  });

  it('does not show loading state when loading=false and quote provided', () => {
    const { container } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    const loadingEl = container.querySelector('[aria-busy="true"]');
    expect(loadingEl).toBeNull();
  });

  it('shows "Spandex / 0x" provider info with sub-provider', () => {
    const { getByText } = render(QuoteCard, {
      props: {
        provider: 'spandex',
        quote: mockSpandexQuote,
        loading: false,
        isRecommended: false,
      },
    });
    expect(getByText(/Via Spandex \/ 0x/)).toBeTruthy();
  });
});
