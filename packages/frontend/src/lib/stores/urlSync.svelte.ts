/**
 * URL sync module.
 * Handles reading URL params on page load and pushing state after compare.
 * Ported from src/client/url-sync.ts for Svelte 5.
 */

import { formStore } from './formStore.svelte.js';
import type { TokenInfo } from './formStore.svelte.js';

export interface UrlParams {
  chainId?: number;
  from?: string;
  to?: string;
  amount?: string;
  slippageBps?: number;
  mode?: 'exactIn' | 'targetOut';
}

/**
 * Parse URL search params into a structured UrlParams object.
 */
export function parseUrlParams(): UrlParams {
  const params = new URLSearchParams(window.location.search);
  const result: UrlParams = {};

  const chainId = params.get('chainId');
  if (chainId) {
    const parsed = parseInt(chainId, 10);
    if (!isNaN(parsed)) result.chainId = parsed;
  }

  const from = params.get('from');
  if (from) result.from = from;

  const to = params.get('to');
  if (to) result.to = to;

  const amount = params.get('amount');
  if (amount) result.amount = amount;

  const slippageBps = params.get('slippageBps');
  if (slippageBps) {
    const parsed = parseInt(slippageBps, 10);
    if (!isNaN(parsed)) result.slippageBps = parsed;
  }

  const mode = params.get('mode');
  if (mode === 'targetOut') {
    result.mode = 'targetOut';
  } else if (mode === 'exactIn') {
    result.mode = 'exactIn';
  }

  return result;
}

/**
 * Returns true if the URL has all required params to trigger an auto-compare.
 */
export function hasAllRequiredParams(): boolean {
  const params = new URLSearchParams(window.location.search);
  return Boolean(
    params.get('chainId') &&
      params.get('from') &&
      params.get('to') &&
      params.get('amount'),
  );
}

/**
 * Update the browser URL via pushState with the given comparison params.
 * Called after compare to make the comparison shareable/bookmarkable.
 */
export function updateUrl(params: UrlParams): void {
  const url = new URL(window.location.href);

  if (params.chainId !== undefined) {
    url.searchParams.set('chainId', String(params.chainId));
  }
  if (params.from) {
    url.searchParams.set('from', params.from);
  }
  if (params.to) {
    url.searchParams.set('to', params.to);
  }
  if (params.amount) {
    url.searchParams.set('amount', params.amount);
  }
  if (params.slippageBps !== undefined) {
    url.searchParams.set('slippageBps', String(params.slippageBps));
  }
  // Only add mode to URL if non-default
  if (params.mode && params.mode !== 'exactIn') {
    url.searchParams.set('mode', params.mode);
  } else {
    url.searchParams.delete('mode');
  }
  // Sender never written to URL
  url.searchParams.delete('sender');
  // Remove stale params
  url.searchParams.delete('mevProtection');

  window.history.pushState({}, '', url.toString());
}

/**
 * Apply URL params to the form store.
 * Creates minimal TokenInfo objects for from/to tokens using just the address.
 * Returns the UrlParams that were applied.
 */
export function applyUrlParamsToForm(urlParams: UrlParams): void {
  if (urlParams.chainId !== undefined) {
    formStore.chainId = urlParams.chainId;
  }

  if (urlParams.from) {
    const token: TokenInfo = {
      address: urlParams.from,
      symbol: '',
      decimals: 18,
    };
    formStore.fromToken = token;
  }

  if (urlParams.to) {
    const token: TokenInfo = {
      address: urlParams.to,
      symbol: '',
      decimals: 18,
    };
    formStore.toToken = token;
  }

  if (urlParams.amount) {
    if (urlParams.mode === 'targetOut') {
      formStore.receiveAmount = urlParams.amount;
      formStore.sellAmount = '';
    } else {
      formStore.sellAmount = urlParams.amount;
      formStore.receiveAmount = '';
    }
  }

  if (urlParams.slippageBps !== undefined) {
    formStore.slippageBps = urlParams.slippageBps;
  }

  if (urlParams.mode) {
    formStore.mode = urlParams.mode;
  }
}
