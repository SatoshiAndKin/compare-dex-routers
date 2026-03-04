/**
 * Modal logic module.
 * Manages body scroll locking, open/close for all modals,
 * Escape key handling, and modal-specific rendering.
 */

import {
  ETHEREUM_CHAIN_ID,
  BSC_CHAIN_ID,
  BASE_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  OPTIMISM_CHAIN_ID,
  POLYGON_CHAIN_ID,
  AVALANCHE_CHAIN_ID,
} from "./config.js";

// ---------------------------------------------------------------------------
// Body scroll lock with reference counting
// ---------------------------------------------------------------------------

let modalScrollLockCount = 0;

export function lockBodyScroll(): void {
  modalScrollLockCount++;
  if (modalScrollLockCount === 1) {
    document.body.style.overflow = "hidden";
  }
}

export function unlockBodyScroll(): void {
  modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
  if (modalScrollLockCount === 0) {
    document.body.style.overflow = "";
  }
}

// ---------------------------------------------------------------------------
// DOM element references (set during initModals)
// ---------------------------------------------------------------------------

let elMevModal: HTMLElement;
let elMevModalClose: HTMLElement;
let elMevInfoBtn: HTMLElement;
let elMevChainContent: HTMLElement;

let elSettingsModal: HTMLElement;
let elSettingsBtn: HTMLElement;
let elSettingsModalClose: HTMLElement;

let elSwapConfirmModal: HTMLElement;
let elSwapConfirmModalClose: HTMLElement;
let elSwapConfirmModalText: HTMLElement;
let elSwapConfirmWaitBtn: HTMLElement;
let elSwapConfirmProceedBtn: HTMLElement;

let elWalletProviderModal: HTMLElement;
let elWalletProviderModalClose: HTMLElement;
let elWalletProviderList: HTMLElement;
let elWalletProviderNoWallet: HTMLElement;

let elUnrecognizedTokenModal: HTMLElement;
let elUnrecognizedTokenModalClose: HTMLElement;
let elUnrecognizedTokenAddress: HTMLElement;
let elUnrecognizedTokenLoading: HTMLElement;
let elUnrecognizedTokenMetadata: HTMLElement;
let elUnrecognizedTokenError: HTMLElement;
let elUnrecognizedTokenCancelBtn: HTMLElement;
let elUnrecognizedTokenSaveBtn: HTMLButtonElement;

// ---------------------------------------------------------------------------
// Callbacks injected during initModals
// ---------------------------------------------------------------------------

let cbGetCurrentChainId: () => number = () => 1;
let cbHasConnectedWallet: () => boolean = () => false;
let cbRenderLocalTokens: () => void = () => {};
let cbAddMevRpcToWallet: (type: string) => void = () => {};
let cbGetProgressiveQuoteState: () => {
  complete: boolean;
  spandex: unknown;
  spandexError: unknown;
  curve: unknown;
  curveError: unknown;
  singleRouterMode: boolean;
} = () => ({
  complete: true,
  spandex: null,
  spandexError: null,
  curve: null,
  curveError: null,
  singleRouterMode: false,
});
let cbExecuteSwapFromCard: (card: HTMLElement) => Promise<void> = async () => {};
let cbGetPendingSwapCard: () => HTMLElement | null = () => null;
let cbSetPendingSwapCard: (card: HTMLElement | null) => void = () => {};
let cbFetchTokenMetadata: (address: string, chainId: number) => void = () => {};
let cbHandleUnrecognizedTokenSave: () => void = () => {};
let cbGetFromInput: () => HTMLElement | null = () => null;
let cbGetToInput: () => HTMLElement | null = () => null;
let cbGetUnrecognizedTokenState: () => { targetInput: string | null } = () => ({
  targetInput: null,
});
let cbSetUnrecognizedTokenState: (state: {
  address: string;
  chainId: number;
  metadata: null;
  targetInput: string | null;
}) => void = () => {};
let cbGetConnectWalletBtn: () => HTMLElement | null = () => null;
let cbGetIsConnectingProvider: () => boolean = () => false;
let cbGetPendingPostConnectAction: () => unknown = () => null;
let cbSetPendingPostConnectAction: (action: unknown) => void = () => {};

// ---------------------------------------------------------------------------
// MEV Modal
// ---------------------------------------------------------------------------

export function renderMevChainContent(): void {
  const chainId = cbGetCurrentChainId();
  const walletConnectedValue = cbHasConnectedWallet();
  const walletDisabled = !walletConnectedValue;
  const walletNote = walletDisabled
    ? '<p class="wallet-required-note">Connect wallet first</p>'
    : "";

  let html: string;

  if (chainId === ETHEREUM_CHAIN_ID) {
    html =
      '<div class="mev-chain-message ethereum">' +
      '<div class="mev-chain-title">Ethereum Mainnet</div>' +
      "<p>Your swap is vulnerable to sandwich attacks. Add Flashbots Protect to send transactions privately.</p>" +
      '<button type="button" class="add-to-wallet-btn" id="addFlashbotsBtn" ' +
      (walletDisabled ? "disabled" : "") +
      ">" +
      "Add Flashbots Protect to Wallet" +
      "</button>" +
      walletNote +
      "</div>";
  } else if (chainId === BSC_CHAIN_ID) {
    html =
      '<div class="mev-chain-message bsc">' +
      '<div class="mev-chain-title">BSC (BNB Chain)</div>' +
      "<p>BSC has active MEV bots. Add bloXroute BSC Protect for private transaction submission.</p>" +
      '<button type="button" class="add-to-wallet-btn" id="addBloXrouteBtn" ' +
      (walletDisabled ? "disabled" : "") +
      ">" +
      "Add bloXroute Protect to Wallet" +
      "</button>" +
      walletNote +
      "</div>";
  } else if (
    chainId === BASE_CHAIN_ID ||
    chainId === ARBITRUM_CHAIN_ID ||
    chainId === OPTIMISM_CHAIN_ID
  ) {
    const chainName =
      chainId === BASE_CHAIN_ID ? "Base" : chainId === ARBITRUM_CHAIN_ID ? "Arbitrum" : "Optimism";
    html =
      '<div class="mev-chain-message l2">' +
      '<div class="mev-chain-title">' +
      chainName +
      " (L2)</div>" +
      "<p>This chain uses a centralized sequencer that processes transactions in order received. Sandwich attacks are significantly harder. No additional protection needed.</p>" +
      "</div>";
  } else if (chainId === POLYGON_CHAIN_ID || chainId === AVALANCHE_CHAIN_ID) {
    const chainName = chainId === POLYGON_CHAIN_ID ? "Polygon" : "Avalanche";
    html =
      '<div class="mev-chain-message other">' +
      '<div class="mev-chain-title">' +
      chainName +
      "</div>" +
      "<p>MEV protection is useful on this chain but no free public protection RPC is currently available.</p>" +
      "</div>";
  } else {
    html =
      '<div class="mev-chain-message other">' +
      '<div class="mev-chain-title">Unknown Chain</div>' +
      "<p>MEV protection availability varies by chain. Check if your wallet supports private transaction submission.</p>" +
      "</div>";
  }

  elMevChainContent.innerHTML = html;

  // Add click handlers for Add to Wallet buttons
  const addFlashbotsBtn = document.getElementById("addFlashbotsBtn");
  if (addFlashbotsBtn) {
    addFlashbotsBtn.addEventListener("click", () => cbAddMevRpcToWallet("ethereum"));
  }

  const addBloXrouteBtn = document.getElementById("addBloXrouteBtn");
  if (addBloXrouteBtn) {
    addBloXrouteBtn.addEventListener("click", () => cbAddMevRpcToWallet("bsc"));
  }
}

export function openMevModal(): void {
  renderMevChainContent();
  elMevModal.classList.add("show");
  lockBodyScroll();
  elMevModalClose.focus();
}

export function closeMevModal(): void {
  elMevModal.classList.remove("show");
  unlockBodyScroll();
  elMevInfoBtn.focus();
}

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------

export function openSettingsModal(): void {
  cbRenderLocalTokens();
  elSettingsModal.classList.add("show");
  elSettingsBtn.setAttribute("aria-expanded", "true");
  lockBodyScroll();
  elSettingsModalClose.focus();
}

export function closeSettingsModal(): void {
  elSettingsModal.classList.remove("show");
  elSettingsBtn.setAttribute("aria-expanded", "false");
  unlockBodyScroll();
  elSettingsBtn.focus();
}

// ---------------------------------------------------------------------------
// Swap Confirmation Modal
// ---------------------------------------------------------------------------

export function openSwapConfirmModal(card: HTMLElement): void {
  cbSetPendingSwapCard(card);
  updateSwapConfirmModalText();
  elSwapConfirmModal.classList.add("show");
  lockBodyScroll();
  elSwapConfirmWaitBtn.focus();
}

export function closeSwapConfirmModal(): void {
  elSwapConfirmModal.classList.remove("show");
  unlockBodyScroll();
  const cardToFocus = cbGetPendingSwapCard();
  cbSetPendingSwapCard(null);
  if (cardToFocus) {
    const swapBtn = cardToFocus.querySelector(".swap-btn") as HTMLElement | null;
    if (swapBtn) swapBtn.focus();
  }
}

function handleSwapConfirmModalKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;

  const focusableElements = elSwapConfirmModal.querySelectorAll(
    'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements[0] as HTMLElement | undefined;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

  if (!firstElement || !lastElement) return;

  if (event.shiftKey) {
    if (document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    }
  } else {
    if (document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}

export function updateSwapConfirmModalText(): void {
  const state = cbGetProgressiveQuoteState();
  const isLoading =
    !state.complete &&
    ((!state.spandex && !state.spandexError) ||
      (!state.curve && !state.curveError && !state.singleRouterMode));

  if (!isLoading) {
    closeSwapConfirmModal();
    return;
  }

  const routerName = !state.spandex && !state.spandexError ? "Spandex" : "Curve";
  elSwapConfirmModalText.innerHTML =
    "<strong>The " +
    routerName +
    " quote is still loading.</strong> A better price may arrive soon.";
}

function handleSwapConfirmWait(): void {
  closeSwapConfirmModal();
}

async function handleSwapConfirmProceed(): Promise<void> {
  const card = cbGetPendingSwapCard();
  closeSwapConfirmModal();
  if (!card) return;
  await cbExecuteSwapFromCard(card);
}

// ---------------------------------------------------------------------------
// Wallet Provider Modal
// ---------------------------------------------------------------------------

export function closeWalletProviderMenu(): void {
  elWalletProviderModal.classList.remove("show");
  unlockBodyScroll();
  elWalletProviderList.innerHTML = "";
  elWalletProviderNoWallet.hidden = true;
  if (!cbGetIsConnectingProvider() && cbGetPendingPostConnectAction()) {
    cbSetPendingPostConnectAction(null);
  }
  const btn = cbGetConnectWalletBtn();
  if (btn) btn.focus();
}

// ---------------------------------------------------------------------------
// Unrecognized Token Modal
// ---------------------------------------------------------------------------

export function openUnrecognizedTokenModal(
  address: string,
  chainId: number,
  targetInput: string
): void {
  cbSetUnrecognizedTokenState({
    address,
    chainId,
    metadata: null,
    targetInput,
  });

  elUnrecognizedTokenAddress.textContent = address;
  elUnrecognizedTokenLoading.hidden = false;
  elUnrecognizedTokenMetadata.hidden = true;
  elUnrecognizedTokenError.hidden = true;
  elUnrecognizedTokenSaveBtn.disabled = true;
  elUnrecognizedTokenSaveBtn.textContent = "Save to Local List";

  elUnrecognizedTokenModal.classList.add("show");
  lockBodyScroll();
  elUnrecognizedTokenModalClose.focus();

  cbFetchTokenMetadata(address, chainId);
}

export function closeUnrecognizedTokenModal(): void {
  elUnrecognizedTokenModal.classList.remove("show");
  unlockBodyScroll();

  const state = cbGetUnrecognizedTokenState();
  if (state.targetInput === "from") {
    const el = cbGetFromInput();
    if (el) el.focus();
  } else if (state.targetInput === "to") {
    const el = cbGetToInput();
    if (el) el.focus();
  }

  cbSetUnrecognizedTokenState({
    address: "",
    chainId: 0,
    metadata: null,
    targetInput: null,
  });
}

// ---------------------------------------------------------------------------
// Escape key handler for all modals
// ---------------------------------------------------------------------------

function handleEscapeKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (elWalletProviderModal.classList.contains("show")) {
    closeWalletProviderMenu();
  }
  if (elMevModal.classList.contains("show")) {
    closeMevModal();
  }
  if (elSettingsModal.classList.contains("show")) {
    closeSettingsModal();
  }
  if (elSwapConfirmModal.classList.contains("show")) {
    closeSwapConfirmModal();
  }
  if (elUnrecognizedTokenModal.classList.contains("show")) {
    closeUnrecognizedTokenModal();
  }
}

// ---------------------------------------------------------------------------
// Modal DOM element references interface
// ---------------------------------------------------------------------------

export interface ModalElements {
  mevModal: HTMLElement;
  mevModalClose: HTMLElement;
  mevInfoBtn: HTMLElement;
  mevChainContent: HTMLElement;
  settingsModal: HTMLElement;
  settingsBtn: HTMLElement;
  settingsModalClose: HTMLElement;
  swapConfirmModal: HTMLElement;
  swapConfirmModalClose: HTMLElement;
  swapConfirmModalText: HTMLElement;
  swapConfirmWaitBtn: HTMLElement;
  swapConfirmProceedBtn: HTMLElement;
  walletProviderModal: HTMLElement;
  walletProviderModalClose: HTMLElement;
  walletProviderList: HTMLElement;
  walletProviderNoWallet: HTMLElement;
  unrecognizedTokenModal: HTMLElement;
  unrecognizedTokenModalClose: HTMLElement;
  unrecognizedTokenAddress: HTMLElement;
  unrecognizedTokenLoading: HTMLElement;
  unrecognizedTokenMetadata: HTMLElement;
  unrecognizedTokenError: HTMLElement;
  unrecognizedTokenCancelBtn: HTMLElement;
  unrecognizedTokenSaveBtn: HTMLButtonElement;
}

export interface ModalCallbacks {
  getCurrentChainId: () => number;
  hasConnectedWallet: () => boolean;
  renderLocalTokens: () => void;
  addMevRpcToWallet: (type: string) => void;
  getProgressiveQuoteState: () => {
    complete: boolean;
    spandex: unknown;
    spandexError: unknown;
    curve: unknown;
    curveError: unknown;
    singleRouterMode: boolean;
  };
  executeSwapFromCard: (card: HTMLElement) => Promise<void>;
  getPendingSwapCard: () => HTMLElement | null;
  setPendingSwapCard: (card: HTMLElement | null) => void;
  fetchTokenMetadata: (address: string, chainId: number) => void;
  handleUnrecognizedTokenSave: () => void;
  getFromInput: () => HTMLElement | null;
  getToInput: () => HTMLElement | null;
  getUnrecognizedTokenState: () => { targetInput: string | null };
  setUnrecognizedTokenState: (state: {
    address: string;
    chainId: number;
    metadata: null;
    targetInput: string | null;
  }) => void;
  getConnectWalletBtn: () => HTMLElement | null;
  getIsConnectingProvider: () => boolean;
  getPendingPostConnectAction: () => unknown;
  setPendingPostConnectAction: (action: unknown) => void;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize all modal event listeners and wire up DOM elements.
 * Must be called once after the DOM is ready.
 */
export function initModals(elements: ModalElements, callbacks: ModalCallbacks): void {
  // Store DOM element references
  elMevModal = elements.mevModal;
  elMevModalClose = elements.mevModalClose;
  elMevInfoBtn = elements.mevInfoBtn;
  elMevChainContent = elements.mevChainContent;
  elSettingsModal = elements.settingsModal;
  elSettingsBtn = elements.settingsBtn;
  elSettingsModalClose = elements.settingsModalClose;
  elSwapConfirmModal = elements.swapConfirmModal;
  elSwapConfirmModalClose = elements.swapConfirmModalClose;
  elSwapConfirmModalText = elements.swapConfirmModalText;
  elSwapConfirmWaitBtn = elements.swapConfirmWaitBtn;
  elSwapConfirmProceedBtn = elements.swapConfirmProceedBtn;
  elWalletProviderModal = elements.walletProviderModal;
  elWalletProviderModalClose = elements.walletProviderModalClose;
  elWalletProviderList = elements.walletProviderList;
  elWalletProviderNoWallet = elements.walletProviderNoWallet;
  elUnrecognizedTokenModal = elements.unrecognizedTokenModal;
  elUnrecognizedTokenModalClose = elements.unrecognizedTokenModalClose;
  elUnrecognizedTokenAddress = elements.unrecognizedTokenAddress;
  elUnrecognizedTokenLoading = elements.unrecognizedTokenLoading;
  elUnrecognizedTokenMetadata = elements.unrecognizedTokenMetadata;
  elUnrecognizedTokenError = elements.unrecognizedTokenError;
  elUnrecognizedTokenCancelBtn = elements.unrecognizedTokenCancelBtn;
  elUnrecognizedTokenSaveBtn = elements.unrecognizedTokenSaveBtn;

  // Store callbacks
  cbGetCurrentChainId = callbacks.getCurrentChainId;
  cbHasConnectedWallet = callbacks.hasConnectedWallet;
  cbRenderLocalTokens = callbacks.renderLocalTokens;
  cbAddMevRpcToWallet = callbacks.addMevRpcToWallet;
  cbGetProgressiveQuoteState = callbacks.getProgressiveQuoteState;
  cbExecuteSwapFromCard = callbacks.executeSwapFromCard;
  cbGetPendingSwapCard = callbacks.getPendingSwapCard;
  cbSetPendingSwapCard = callbacks.setPendingSwapCard;
  cbFetchTokenMetadata = callbacks.fetchTokenMetadata;
  cbHandleUnrecognizedTokenSave = callbacks.handleUnrecognizedTokenSave;
  cbGetFromInput = callbacks.getFromInput;
  cbGetToInput = callbacks.getToInput;
  cbGetUnrecognizedTokenState = callbacks.getUnrecognizedTokenState;
  cbSetUnrecognizedTokenState = callbacks.setUnrecognizedTokenState;
  cbGetConnectWalletBtn = callbacks.getConnectWalletBtn;
  cbGetIsConnectingProvider = callbacks.getIsConnectingProvider;
  cbGetPendingPostConnectAction = callbacks.getPendingPostConnectAction;
  cbSetPendingPostConnectAction = callbacks.setPendingPostConnectAction;

  // --- MEV Modal event listeners ---
  elMevInfoBtn.addEventListener("click", openMevModal);
  elMevModalClose.addEventListener("click", closeMevModal);
  elMevModal.addEventListener("click", (event) => {
    if (event.target === elMevModal) closeMevModal();
  });

  // --- Settings Modal event listeners ---
  elSettingsBtn.addEventListener("click", openSettingsModal);
  elSettingsModalClose.addEventListener("click", closeSettingsModal);
  elSettingsModal.addEventListener("click", (event) => {
    if (event.target === elSettingsModal) closeSettingsModal();
  });

  // --- Swap Confirmation Modal event listeners ---
  elSwapConfirmModalClose.addEventListener("click", closeSwapConfirmModal);
  elSwapConfirmModal.addEventListener("click", (event) => {
    if (event.target === elSwapConfirmModal) closeSwapConfirmModal();
  });
  elSwapConfirmWaitBtn.addEventListener("click", handleSwapConfirmWait);
  elSwapConfirmProceedBtn.addEventListener("click", () => {
    void handleSwapConfirmProceed();
  });
  elSwapConfirmModal.addEventListener("keydown", handleSwapConfirmModalKeydown);

  // --- Wallet Provider Modal event listeners ---
  elWalletProviderModalClose.addEventListener("click", closeWalletProviderMenu);
  elWalletProviderModal.addEventListener("click", (event) => {
    if (event.target === elWalletProviderModal) closeWalletProviderMenu();
  });

  // --- Unrecognized Token Modal event listeners ---
  elUnrecognizedTokenModalClose.addEventListener("click", closeUnrecognizedTokenModal);
  elUnrecognizedTokenCancelBtn.addEventListener("click", closeUnrecognizedTokenModal);
  elUnrecognizedTokenSaveBtn.addEventListener("click", () => cbHandleUnrecognizedTokenSave());
  elUnrecognizedTokenModal.addEventListener("click", (event) => {
    if (event.target === elUnrecognizedTokenModal) closeUnrecognizedTokenModal();
  });

  // --- Global Escape key handler ---
  document.addEventListener("keydown", handleEscapeKey);
}
