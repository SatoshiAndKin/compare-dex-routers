/**
 * Transaction execution module.
 *
 * Manages:
 * - ERC-20 approve calldata encoding
 * - Approve and swap button click handlers
 * - Transaction execution with receipt polling
 * - Transaction status display on quote cards
 * - Token reference click handling (copy address to clipboard)
 * - Address validation helpers
 */

import { MAX_UINT256_HEX } from "./config.js";
import type { EIP1193Provider } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionCallbacks {
  hasConnectedWallet: () => boolean;
  getConnectedProvider: () => EIP1193Provider | null;
  getConnectedAddress: () => string;
  getCurrentChainId: () => number;
  setWalletMessage: (message: string, isError?: boolean) => void;
  triggerWalletConnectionFlow: () => void;
  setPendingPostConnectAction: (action: {
    type: "approve" | "swap";
    card: HTMLElement;
    button?: HTMLButtonElement;
  }) => void;
  ensureWalletOnChain: (provider: EIP1193Provider, chainId: string) => Promise<void>;
  pauseAutoRefreshForTransaction: () => void;
  resumeAutoRefreshAfterTransaction: () => void;
  areQuotesStillLoading: () => boolean;
  openSwapConfirmModal: (card: HTMLElement) => void;
  /** Get the current quote chain ID (set during quote fetch) */
  getCurrentQuoteChainId: () => number | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let cbs: TransactionCallbacks | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check if an error is a user-rejected transaction (code 4001) */
function isRejectionCode(code: unknown): boolean {
  return Number(code) === 4001;
}

interface RpcError {
  code?: unknown;
  data?: {
    code?: unknown;
    originalError?: { code?: unknown };
  };
  error?: { code?: unknown };
}

function isUserRejectedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const rpcErr = err as RpcError;

  if (isRejectionCode(rpcErr.code)) {
    return true;
  }

  if (rpcErr.data && typeof rpcErr.data === "object") {
    if (isRejectionCode(rpcErr.data.code)) {
      return true;
    }

    if (
      rpcErr.data.originalError &&
      typeof rpcErr.data.originalError === "object" &&
      isRejectionCode(rpcErr.data.originalError.code)
    ) {
      return true;
    }
  }

  if (rpcErr.error && typeof rpcErr.error === "object" && isRejectionCode(rpcErr.error.code)) {
    return true;
  }

  return false;
}

/** Convert a decimal string to hex quantity (0x-prefixed) */
function toHexQuantity(value: string): string {
  if (typeof value !== "string") return "0x0";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "0x0";
  if (trimmed.startsWith("0x")) return trimmed;
  try {
    return "0x" + BigInt(trimmed).toString(16);
  } catch {
    return "0x0";
  }
}

/** Poll for transaction receipt with timeout */
async function waitForTransactionReceipt(
  provider: EIP1193Provider,
  txHash: string
): Promise<{ status?: string }> {
  const timeoutMs = 120000;
  const pollIntervalMs = 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as { status?: string } | null;

    if (receipt) {
      return receipt;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for transaction confirmation");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if a string looks like an Ethereum address (0x + 40 hex chars) */
export function isAddressLike(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address || "").trim());
}

/** Encode ERC-20 approve calldata for unlimited approval */
export function encodeApproveCalldata(spender: string): string {
  const normalizedSpender = String(spender || "").trim();
  if (!isAddressLike(normalizedSpender)) {
    throw new Error("Invalid approval spender address");
  }
  const spenderWord = normalizedSpender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return "0x095ea7b3" + spenderWord + MAX_UINT256_HEX;
}

/** Update status display on a quote card */
export function setTxStatus(
  card: HTMLElement,
  text: string,
  kind?: "pending" | "success" | "error"
): void {
  const status = card.querySelector(".tx-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.remove("pending", "success", "error");
  if (kind) {
    status.classList.add(kind);
  }
}

/** Set pending state on all transaction buttons in a card */
export function setTxCardPending(card: HTMLElement, pending: boolean): void {
  card.querySelectorAll<HTMLButtonElement>(".tx-btn").forEach((button) => {
    button.dataset.pending = pending ? "true" : "false";
    if (pending) {
      button.classList.remove("wallet-required");
      button.disabled = true;
    } else if (button.dataset.locked === "true") {
      button.disabled = true;
    } else {
      button.disabled = false;
    }
  });

  if (!pending) {
    updateTransactionActionStates();
  }
}

/** Update wallet-required visual state on all transaction buttons */
export function updateTransactionActionStates(): void {
  if (!cbs) return;
  const walletConnectedValue = cbs.hasConnectedWallet();
  document.querySelectorAll<HTMLButtonElement>(".tx-btn").forEach((button) => {
    // Skip buttons that are intentionally disabled by step indicator or transaction logic
    if (
      button.dataset.locked === "true" ||
      button.dataset.pending === "true" ||
      button.classList.contains("disabled")
    ) {
      return;
    }

    if (!walletConnectedValue) {
      button.classList.add("wallet-required");
      button.disabled = false;
    } else {
      button.classList.remove("wallet-required");
      button.removeAttribute("aria-disabled");
      button.disabled = false;
    }
  });
}

/** Execute a transaction from a card element (approve or swap) */
export async function executeCardTransaction(
  card: HTMLElement,
  txParams: { to: string; data: string; value: string; from: string },
  onSuccess?: () => void
): Promise<void> {
  if (!cbs) return;

  if (!cbs.hasConnectedWallet()) {
    cbs.setWalletMessage("Connect wallet first", true);
    setTxStatus(card, "Connect wallet first", "error");
    updateTransactionActionStates();
    return;
  }

  const provider = cbs.getConnectedProvider();
  if (!provider || typeof provider.request !== "function") {
    cbs.setWalletMessage("Wallet provider is not available.", true);
    setTxStatus(card, "Failed", "error");
    updateTransactionActionStates();
    return;
  }

  const chainId =
    card.dataset.quoteChainId ||
    String(cbs.getCurrentQuoteChainId() ?? "") ||
    String(cbs.getCurrentChainId());

  setTxCardPending(card, true);
  setTxStatus(card, "Confirming...", "pending");
  cbs.pauseAutoRefreshForTransaction();

  try {
    await cbs.ensureWalletOnChain(provider, chainId);
    setTxStatus(card, "Confirming...", "pending");

    const txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as string;
    const receipt = await waitForTransactionReceipt(provider, txHash);
    const statusValue = String(receipt?.status ?? "").toLowerCase();

    if (statusValue === "0x1" || statusValue === "1") {
      if (typeof onSuccess === "function") {
        onSuccess();
      }
      cbs.setWalletMessage("");
      setTxStatus(card, "Success", "success");
      return;
    }

    throw new Error("Transaction failed");
  } catch (err) {
    if (isUserRejectedError(err)) {
      cbs.setWalletMessage("Transaction canceled in wallet.", true);
      setTxStatus(card, "Failed", "error");
      return;
    }

    cbs.setWalletMessage("Transaction failed. Please try again.", true);
    setTxStatus(card, "Failed", "error");
  } finally {
    setTxCardPending(card, false);
    cbs.resumeAutoRefreshAfterTransaction();
  }
}

/** Handle approve button click */
export async function onApproveClick(card: HTMLElement, button: HTMLButtonElement): Promise<void> {
  if (!cbs) return;

  if (!cbs.hasConnectedWallet()) {
    cbs.setPendingPostConnectAction({ type: "approve", card, button });
    cbs.triggerWalletConnectionFlow();
    return;
  }

  const approvalToken = String(card.dataset.approvalToken || "").trim();
  const approvalSpender = String(card.dataset.approvalSpender || "").trim();
  if (!isAddressLike(approvalToken) || !isAddressLike(approvalSpender)) {
    setTxStatus(card, "Failed", "error");
    return;
  }

  let calldata: string;
  try {
    calldata = encodeApproveCalldata(approvalSpender);
  } catch {
    setTxStatus(card, "Failed", "error");
    return;
  }

  await executeCardTransaction(
    card,
    {
      to: approvalToken,
      data: calldata,
      value: "0x0",
      from: cbs.getConnectedAddress(),
    },
    () => {
      // Show checkmark and mark as approved
      button.innerHTML = 'Approved<span class="tx-checkmark"> ✓</span>';
      button.dataset.locked = "true";
      button.classList.add("approved");
      button.disabled = true;

      // Enable the Swap button (remove disabled state)
      const swapButton = card.querySelector<HTMLButtonElement>(".swap-btn");
      if (swapButton) {
        swapButton.classList.remove("disabled");
        swapButton.disabled = false;
      }
    }
  );
}

/** Execute swap from a card element */
export async function executeSwapFromCard(card: HTMLElement): Promise<void> {
  if (!cbs) return;

  const routerAddress = String(card.dataset.routerAddress || "").trim();
  const routerCalldata = String(card.dataset.routerCalldata || "").trim();
  const routerValue = String(card.dataset.routerValue || "0x0");
  if (!isAddressLike(routerAddress) || !routerCalldata) {
    setTxStatus(card, "Failed", "error");
    return;
  }

  await executeCardTransaction(card, {
    to: routerAddress,
    data: routerCalldata,
    value: toHexQuantity(routerValue || "0x0"),
    from: cbs.getConnectedAddress(),
  });
}

/** Handle swap button click */
export async function onSwapClick(card: HTMLElement): Promise<void> {
  if (!cbs) return;

  if (!cbs.hasConnectedWallet()) {
    cbs.setPendingPostConnectAction({ type: "swap", card });
    cbs.triggerWalletConnectionFlow();
    return;
  }

  // Check if quotes are still loading - show confirmation modal if so
  if (cbs.areQuotesStillLoading()) {
    cbs.openSwapConfirmModal(card);
    return;
  }

  // All quotes arrived - proceed directly
  await executeSwapFromCard(card);
}

/** Handle click on token reference - copy address to clipboard */
export function handleTokenRefClick(element: HTMLElement, address: string): void {
  navigator.clipboard
    .writeText(address)
    .then(() => {
      element.classList.add("copied");

      // Remove any existing feedback
      const existingFeedback = element.querySelector(".copied-feedback");
      if (existingFeedback) existingFeedback.remove();

      // Add new feedback
      const feedback = document.createElement("span");
      feedback.className = "copied-feedback";
      feedback.textContent = "Copied!";
      feedback.style.position = "relative";
      element.appendChild(feedback);

      // Remove the copied class and feedback after animation
      setTimeout(() => {
        element.classList.remove("copied");
        if (feedback.parentNode) feedback.remove();
      }, 1500);
    })
    .catch(() => {
      // Fallback: select the text
      const range = document.createRange();
      range.selectNode(element);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
}

/** Set up click/keydown delegation for tx buttons on the result container */
export function setupResultClickHandler(resultEl: HTMLElement): void {
  resultEl.addEventListener("click", (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest(".tx-btn");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const card = button.closest(".tx-actions");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    if (button.dataset.pending === "true" || button.dataset.locked === "true") {
      return;
    }

    if (button.dataset.action === "approve") {
      void onApproveClick(card, button);
      return;
    }

    if (button.dataset.action === "swap") {
      void onSwapClick(card);
    }
  });
}

/** Initialize the transactions module with callbacks */
export function initTransactions(callbacks: TransactionCallbacks): void {
  cbs = callbacks;
}
