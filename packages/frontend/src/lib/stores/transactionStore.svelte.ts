/**
 * Transaction store managing approve/swap transaction state per router.
 * Ported from src/client/transactions.ts for Svelte 5.
 *
 * Each router (Spandex, Curve) has independent approve/swap status.
 * The store handles:
 *   - ERC-20 allowance check before approve
 *   - approve(spender, MAX_UINT256) via eth_sendTransaction
 *   - Swap confirmation modal flow
 *   - Router swap via eth_sendTransaction
 *   - Auto-refresh pause/resume around transactions
 *   - Pending action when wallet is not connected
 */

import type { SpandexQuote, CurveQuote } from './comparisonStore.svelte.js';
import { walletStore } from './walletStore.svelte.js';
import { autoRefreshStore } from './autoRefreshStore.svelte.js';
import { settingsStore } from './settingsStore.svelte.js';
import { formStore } from './formStore.svelte.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxStatus = 'idle' | 'pending' | 'confirmed' | 'failed';

export interface SwapConfirmationData {
  routerName: string;
  quote: SpandexQuote | CurveQuote;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ERC-20 function selectors
const ALLOWANCE_SELECTOR = '0xdd62ed3e'; // allowance(address,address)
const APPROVE_SELECTOR = '0x095ea7b3'; // approve(address,uint256)

/** Max uint256 as a 64-char hex string (no 0x prefix) */
const MAX_UINT256_HEX = 'f'.repeat(64);

/** Flashbots Protect RPC URL */
const FLASHBOTS_RPC_URL = 'https://rpc.flashbots.net';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isAddressLike(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address ?? '').trim());
}

function isUserRejectedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (Number(e.code) === 4001) return true;
  const data = e.data as Record<string, unknown> | undefined;
  if (data && Number(data.code) === 4001) return true;
  if (
    data?.originalError &&
    Number((data.originalError as Record<string, unknown>).code) === 4001
  )
    return true;
  const error = e.error as Record<string, unknown> | undefined;
  if (error && Number(error.code) === 4001) return true;
  return false;
}

/** Convert a decimal or 0x-prefixed value string to an 0x-prefixed hex quantity */
function toHexQuantity(value: string): string {
  const trimmed = String(value ?? '').trim().toLowerCase();
  if (!trimmed) return '0x0';
  if (trimmed.startsWith('0x')) return trimmed;
  try {
    return '0x' + BigInt(trimmed).toString(16);
  } catch {
    return '0x0';
  }
}

interface ReceiptLike {
  status?: string;
}

type ProviderLike = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

/** Poll for transaction receipt with 2-minute timeout */
async function waitForReceipt(provider: ProviderLike, txHash: string): Promise<ReceiptLike> {
  const timeoutMs = 120_000;
  const pollMs = 1_500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const receipt = (await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    })) as ReceiptLike | null;

    if (receipt) return receipt;

    await new Promise<void>((r) => setTimeout(r, pollMs));
  }

  throw new Error('Timed out waiting for transaction confirmation');
}

// ---------------------------------------------------------------------------
// MEV helper: attempt to route swap through Flashbots Protect RPC
// ---------------------------------------------------------------------------

/**
 * Attempt to send a transaction via Flashbots Protect RPC.
 *
 * Strategy:
 *   1. Ask the wallet to sign the tx via `eth_signTransaction`.
 *   2. Submit the signed raw tx to Flashbots via `eth_sendRawTransaction`.
 *   3. If signing is unsupported or fails, fall back to normal `eth_sendTransaction`.
 */
async function sendTransactionViaMev(
  walletProvider: ProviderLike,
  txParams: Record<string, unknown>,
): Promise<string> {
  let signedTx: string | undefined;

  try {
    signedTx = (await walletProvider.request({
      method: 'eth_signTransaction',
      params: [txParams],
    })) as string;
  } catch {
    // Wallet doesn't support eth_signTransaction — fall back to normal wallet send
    return (await walletProvider.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    })) as string;
  }

  // Submit raw signed tx to Flashbots Protect
  const response = await fetch(FLASHBOTS_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [signedTx],
    }),
  });

  if (!response.ok) {
    throw new Error(`Flashbots RPC HTTP error: ${response.status}`);
  }

  const json = (await response.json()) as {
    result?: string;
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(`Flashbots RPC error: ${json.error.message ?? 'unknown'}`);
  }

  if (!json.result) {
    throw new Error('No transaction hash returned from Flashbots RPC');
  }

  return json.result;
}

// ---------------------------------------------------------------------------
// TransactionStore
// ---------------------------------------------------------------------------

class TransactionStore {
  /** Approve status keyed by router name */
  approveStatus = $state<Record<string, TxStatus>>({});
  /** Swap status keyed by router name */
  swapStatus = $state<Record<string, TxStatus>>({});
  /** Non-null when the swap confirmation modal should be shown */
  swapConfirmation = $state<SwapConfirmationData | null>(null);

  /** Internal promise resolver for confirmation modal */
  private _confirmResolve: ((confirmed: boolean) => void) | null = null;

  // ---------------------------------------------------------------------------
  // Status helpers
  // ---------------------------------------------------------------------------

  private _setApprove(routerName: string, status: TxStatus): void {
    this.approveStatus = { ...this.approveStatus, [routerName]: status };
  }

  private _setSwap(routerName: string, status: TxStatus): void {
    this.swapStatus = { ...this.swapStatus, [routerName]: status };
  }

  /** Get approve status for a router (defaults to 'idle') */
  getApproveStatus(routerName: string): TxStatus {
    return this.approveStatus[routerName] ?? 'idle';
  }

  /** Get swap status for a router (defaults to 'idle') */
  getSwapStatus(routerName: string): TxStatus {
    return this.swapStatus[routerName] ?? 'idle';
  }

  // ---------------------------------------------------------------------------
  // Swap confirmation modal
  // ---------------------------------------------------------------------------

  /** Called by SwapConfirmationModal when user clicks "Confirm Swap" */
  confirmSwap(): void {
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    this.swapConfirmation = null;
    resolve?.(true);
  }

  /** Called by SwapConfirmationModal when user clicks "Cancel" or presses Escape */
  cancelSwap(): void {
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    this.swapConfirmation = null;
    resolve?.(false);
  }

  private _waitForConfirmation(
    routerName: string,
    quote: SpandexQuote | CurveQuote,
  ): Promise<boolean> {
    this.swapConfirmation = { routerName, quote };
    return new Promise<boolean>((resolve) => {
      this._confirmResolve = resolve;
    });
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  /**
   * Execute an ERC-20 approve transaction for the given quote.
   *
   * 1. If no wallet connected, stores a pending action and requests the wallet menu.
   * 2. Checks existing allowance via eth_call; skips if already sufficient.
   * 3. Sends approve(spender, MAX_UINT256) via eth_sendTransaction.
   * 4. Updates approveStatus: idle → pending → confirmed/failed.
   * 5. Pauses auto-refresh for the duration.
   */
  async approve(routerName: string, quote: SpandexQuote | CurveQuote): Promise<void> {
    // No wallet connected: store pending action and open wallet menu
    if (!walletStore.isConnected) {
      walletStore.pendingAction = { type: 'approve', params: { routerName, quote } };
      walletStore.requestMenu();
      return;
    }

    const provider = walletStore.provider;
    const address = walletStore.address;

    if (!provider || !address) {
      this._setApprove(routerName, 'failed');
      return;
    }

    // Determine token address and spender address from quote type
    let tokenAddress: string;
    let spenderAddress: string;

    const spandex = quote as SpandexQuote;
    const curve = quote as CurveQuote;

    if (spandex.approval_token && spandex.approval_spender) {
      // SpandexQuote
      tokenAddress = spandex.approval_token;
      spenderAddress = spandex.approval_spender;
    } else if (curve.approval_target && quote.from) {
      // CurveQuote: token is the input token (from), spender is approval_target
      tokenAddress = quote.from;
      spenderAddress = curve.approval_target;
    } else {
      // No approval needed (native token swap or approval info missing)
      this._setApprove(routerName, 'confirmed');
      return;
    }

    if (!isAddressLike(tokenAddress) || !isAddressLike(spenderAddress)) {
      this._setApprove(routerName, 'failed');
      return;
    }

    // Check existing allowance — skip approve tx if already sufficient
    const inputAmountRaw = quote.input_amount_raw ?? '';
    const requiredAmount = inputAmountRaw ? BigInt(inputAmountRaw) : 0n;

    if (requiredAmount > 0n) {
      try {
        const ownerPadded = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
        const spenderPadded = spenderAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
        const callData = ALLOWANCE_SELECTOR + ownerPadded + spenderPadded;

        const result = (await provider.request({
          method: 'eth_call',
          params: [{ to: tokenAddress, data: callData }, 'latest'],
        })) as string;

        const allowance = BigInt(result);
        if (allowance >= requiredAmount) {
          // Already approved — mark as confirmed without sending a tx
          this._setApprove(routerName, 'confirmed');
          return;
        }
      } catch {
        // Allowance check failed (network error, etc.) — fall through to send approve tx
      }
    }

    // Encode approve(spender, MAX_UINT256) calldata
    const spenderWord = spenderAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const approveData = APPROVE_SELECTOR + spenderWord + MAX_UINT256_HEX;

    this._setApprove(routerName, 'pending');
    autoRefreshStore.pause();

    try {
      const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [{ to: tokenAddress, data: approveData, value: '0x0', from: address }],
      })) as string;

      const receipt = await waitForReceipt(provider, txHash);
      const statusVal = String(receipt?.status ?? '').toLowerCase();

      if (statusVal === '0x1' || statusVal === '1') {
        this._setApprove(routerName, 'confirmed');
        walletStore.setMessage('');
      } else {
        throw new Error('Transaction failed on-chain');
      }
    } catch (err) {
      if (isUserRejectedError(err)) {
        this._setApprove(routerName, 'idle');
        walletStore.setMessage('Transaction canceled', true);
      } else {
        this._setApprove(routerName, 'failed');
        walletStore.setMessage('Approve transaction failed. Please try again.', true);
      }
    } finally {
      autoRefreshStore.resume();
    }
  }

  // ---------------------------------------------------------------------------
  // Swap
  // ---------------------------------------------------------------------------

  /**
   * Execute a swap transaction for the given quote.
   *
   * 1. If no wallet connected, stores a pending action and requests the wallet menu.
   * 2. Shows a swap confirmation modal and waits for user confirmation.
   * 3. Sends the router calldata via eth_sendTransaction.
   * 4. Updates swapStatus: idle → pending → confirmed/failed.
   * 5. Pauses auto-refresh for the duration, resumes after.
   */
  async swap(routerName: string, quote: SpandexQuote | CurveQuote): Promise<void> {
    // No wallet connected: store pending action and open wallet menu
    if (!walletStore.isConnected) {
      walletStore.pendingAction = { type: 'swap', params: { routerName, quote } };
      walletStore.requestMenu();
      return;
    }

    // Show confirmation modal and wait for user to confirm or cancel
    const confirmed = await this._waitForConfirmation(routerName, quote);
    if (!confirmed) return;

    const routerAddress = quote.router_address ?? '';
    const routerCalldata = quote.router_calldata ?? '';

    // Spandex quotes may include a non-zero ETH value (e.g. for wrapping)
    const routerValue = (quote as SpandexQuote).router_value ?? '0x0';

    if (!isAddressLike(routerAddress) || !routerCalldata) {
      this._setSwap(routerName, 'failed');
      walletStore.setMessage('Invalid swap parameters', true);
      return;
    }

    const provider = walletStore.provider;
    const address = walletStore.address;

    if (!provider || !address) {
      this._setSwap(routerName, 'failed');
      return;
    }

    this._setSwap(routerName, 'pending');
    autoRefreshStore.pause();

    // Build transaction parameters
    const txParams = {
      to: routerAddress,
      data: routerCalldata,
      value: toHexQuantity(String(routerValue)),
      from: address,
    };

    try {
      // Use MEV protection (Flashbots) for Ethereum swaps when enabled
      const useMev = settingsStore.mevEnabled && formStore.chainId === 1;
      const txHash = useMev
        ? await sendTransactionViaMev(provider, txParams)
        : ((await provider.request({
            method: 'eth_sendTransaction',
            params: [txParams],
          })) as string);

      const receipt = await waitForReceipt(provider, txHash);
      const statusVal = String(receipt?.status ?? '').toLowerCase();

      if (statusVal === '0x1' || statusVal === '1') {
        this._setSwap(routerName, 'confirmed');
        walletStore.setMessage('');
      } else {
        throw new Error('Transaction failed on-chain');
      }
    } catch (err) {
      if (isUserRejectedError(err)) {
        this._setSwap(routerName, 'idle');
        walletStore.setMessage('Swap canceled', true);
      } else {
        this._setSwap(routerName, 'failed');
        walletStore.setMessage('Swap transaction failed. Please try again.', true);
      }
    } finally {
      autoRefreshStore.resume();
    }
  }
}

export const transactionStore = new TransactionStore();
