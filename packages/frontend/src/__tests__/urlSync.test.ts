import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseUrlParams,
  hasAllRequiredParams,
  updateUrl,
  applyUrlParamsToForm,
} from '../lib/stores/urlSync.svelte.js';
import { formStore } from '../lib/stores/formStore.svelte.js';
import { comparisonStore } from '../lib/stores/comparisonStore.svelte.js';

function resetFormStore() {
  formStore.chainId = 1;
  formStore.fromToken = null;
  formStore.toToken = null;
  formStore.sellAmount = '';
  formStore.receiveAmount = '';
  formStore.mode = 'exactIn';
  formStore.slippageBps = 50;
}

function setUrl(search: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
  });
}

describe('parseUrlParams', () => {
  beforeEach(() => {
    resetFormStore();
    setUrl('');
  });

  it('returns empty object when no params', () => {
    setUrl('');
    expect(parseUrlParams()).toEqual({});
  });

  it('parses chainId', () => {
    setUrl('?chainId=8453');
    expect(parseUrlParams().chainId).toBe(8453);
  });

  it('parses from and to addresses (full, no truncation)', () => {
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    setUrl(`?from=${from}&to=${to}`);
    const params = parseUrlParams();
    expect(params.from).toBe(from);
    expect(params.to).toBe(to);
    // Full addresses, not truncated
    expect(params.from?.length).toBe(42);
    expect(params.to?.length).toBe(42);
  });

  it('parses amount', () => {
    setUrl('?amount=1000');
    expect(parseUrlParams().amount).toBe('1000');
  });

  it('parses slippageBps as number', () => {
    setUrl('?slippageBps=100');
    expect(parseUrlParams().slippageBps).toBe(100);
  });

  it('parses mode=exactIn', () => {
    setUrl('?mode=exactIn');
    expect(parseUrlParams().mode).toBe('exactIn');
  });

  it('parses mode=targetOut', () => {
    setUrl('?mode=targetOut');
    expect(parseUrlParams().mode).toBe('targetOut');
  });

  it('ignores unknown mode values', () => {
    setUrl('?mode=unknown');
    expect(parseUrlParams().mode).toBeUndefined();
  });

  it('ignores non-numeric chainId', () => {
    setUrl('?chainId=abc');
    expect(parseUrlParams().chainId).toBeUndefined();
  });

  it('parses all params together', () => {
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    setUrl(`?chainId=1&from=${from}&to=${to}&amount=100&slippageBps=50&mode=exactIn`);
    const params = parseUrlParams();
    expect(params).toEqual({
      chainId: 1,
      from,
      to,
      amount: '100',
      slippageBps: 50,
      mode: 'exactIn',
    });
  });
});

describe('hasAllRequiredParams', () => {
  beforeEach(() => {
    setUrl('');
  });

  it('returns false when URL is empty', () => {
    setUrl('');
    expect(hasAllRequiredParams()).toBe(false);
  });

  it('returns false when only some params are present', () => {
    setUrl('?chainId=1&from=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(hasAllRequiredParams()).toBe(false);
  });

  it('returns true when all required params are present', () => {
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    setUrl(`?chainId=1&from=${from}&to=${to}&amount=100`);
    expect(hasAllRequiredParams()).toBe(true);
  });

  it('returns true with optional params also present', () => {
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    setUrl(`?chainId=1&from=${from}&to=${to}&amount=100&slippageBps=50&mode=exactIn`);
    expect(hasAllRequiredParams()).toBe(true);
  });
});

describe('updateUrl', () => {
  beforeEach(() => {
    setUrl('');
  });

  it('calls pushState with updated URL', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

    updateUrl({ chainId: 1, from, to, amount: '100', slippageBps: 50 });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).toContain('chainId=1');
    expect(calledUrl).toContain(`from=${from}`);
    expect(calledUrl).toContain(`to=${to}`);
    expect(calledUrl).toContain('amount=100');
    expect(calledUrl).toContain('slippageBps=50');
    pushStateSpy.mockRestore();
  });

  it('omits mode param when mode is exactIn (default)', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    updateUrl({
      chainId: 1,
      from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
      mode: 'exactIn',
    });

    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).not.toContain('mode=exactIn');
    pushStateSpy.mockRestore();
  });

  it('includes mode param when mode is targetOut', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    updateUrl({
      chainId: 1,
      from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
      mode: 'targetOut',
    });

    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).toContain('mode=targetOut');
    pushStateSpy.mockRestore();
  });

  it('never includes sender in URL', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    updateUrl({
      chainId: 1,
      from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
    });

    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).not.toContain('sender');
    pushStateSpy.mockRestore();
  });

  it('removes mevProtection from URL', () => {
    setUrl('?mevProtection=true');
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    updateUrl({
      chainId: 1,
      from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
    });

    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).not.toContain('mevProtection');
    pushStateSpy.mockRestore();
  });
});

describe('applyUrlParamsToForm', () => {
  beforeEach(() => {
    resetFormStore();
  });

  it('sets chainId on formStore', () => {
    applyUrlParamsToForm({ chainId: 8453 });
    expect(formStore.chainId).toBe(8453);
  });

  it('sets fromToken with full address', () => {
    const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    applyUrlParamsToForm({ from: address });
    expect(formStore.fromToken?.address).toBe(address);
    expect(formStore.fromToken?.address.length).toBe(42);
  });

  it('sets toToken with full address', () => {
    const address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    applyUrlParamsToForm({ to: address });
    expect(formStore.toToken?.address).toBe(address);
  });

  it('sets sellAmount for exactIn mode', () => {
    applyUrlParamsToForm({ amount: '100', mode: 'exactIn' });
    expect(formStore.sellAmount).toBe('100');
    expect(formStore.receiveAmount).toBe('');
    expect(formStore.mode).toBe('exactIn');
  });

  it('sets receiveAmount for targetOut mode', () => {
    applyUrlParamsToForm({ amount: '100', mode: 'targetOut' });
    expect(formStore.receiveAmount).toBe('100');
    expect(formStore.sellAmount).toBe('');
    expect(formStore.mode).toBe('targetOut');
  });

  it('sets slippageBps', () => {
    applyUrlParamsToForm({ slippageBps: 100 });
    expect(formStore.slippageBps).toBe(100);
  });

  it('auto-compare triggers when all required params present', async () => {
    // Mock comparisonStore.compare
    const compareSpy = vi.spyOn(comparisonStore, 'compare').mockResolvedValue(undefined);

    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    setUrl(`?chainId=1&from=${from}&to=${to}&amount=100`);

    // Simulate what App.svelte does on mount
    const urlParams = parseUrlParams();
    const allRequired = hasAllRequiredParams();

    if (allRequired) {
      applyUrlParamsToForm(urlParams);
      await comparisonStore.compare({
        chainId: formStore.chainId,
        from: urlParams.from!,
        to: urlParams.to!,
        amount: urlParams.amount!,
        slippageBps: formStore.slippageBps,
        mode: formStore.mode,
      });
    }

    expect(compareSpy).toHaveBeenCalledOnce();
    expect(compareSpy.mock.calls[0]?.[0]).toMatchObject({
      chainId: 1,
      from,
      to,
      amount: '100',
    });

    compareSpy.mockRestore();
  });

  it('URL updates after compare (updateUrl called)', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const from = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const to = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

    updateUrl({ chainId: 1, from, to, amount: '100', slippageBps: 50 });

    expect(pushStateSpy).toHaveBeenCalled();
    const calledUrl = pushStateSpy.mock.calls[0]?.[2] as string;
    expect(calledUrl).toContain('chainId=1');
    expect(calledUrl).toContain('from=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

    pushStateSpy.mockRestore();
  });
});
