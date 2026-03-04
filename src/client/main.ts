declare global {
  interface Window {
    __config: {
      defaultTokens: Record<string, { from: string; to: string }>;
      walletConnectProjectId: string;
    };
  }
}

import "./types.js";
import { DEFAULT_TOKENS, WALLETCONNECT_PROJECT_ID } from "./config.js";
import { initTheme } from "./theme.js";
import { initModals } from "./modals.js";
import type { ModalElements, ModalCallbacks } from "./modals.js";

console.log(
  "[client] bundle loaded, chains configured",
  Object.keys(DEFAULT_TOKENS).length,
  "chains,",
  WALLETCONNECT_PROJECT_ID ? "WC enabled" : "WC disabled"
);

// ---------------------------------------------------------------------------
// Theme toggle initialization
// ---------------------------------------------------------------------------

const themeBtn = document.getElementById("themeBtn") as HTMLButtonElement | null;
const themeIcon = document.getElementById("themeIcon");
if (themeBtn && themeIcon) {
  initTheme(themeBtn, themeIcon);
}

// ---------------------------------------------------------------------------
// Modals initialization
// ---------------------------------------------------------------------------

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing modal element: #${id}`);
  return el;
}

const modalElements: ModalElements = {
  mevModal: getEl("mevModal"),
  mevModalClose: getEl("mevModalClose"),
  mevInfoBtn: getEl("mevInfoBtn"),
  mevChainContent: getEl("mevChainContent"),
  settingsModal: getEl("settingsModal"),
  settingsBtn: getEl("settingsBtn"),
  settingsModalClose: getEl("settingsModalClose"),
  swapConfirmModal: getEl("swapConfirmModal"),
  swapConfirmModalClose: getEl("swapConfirmModalClose"),
  swapConfirmModalText: getEl("swapConfirmModalText"),
  swapConfirmWaitBtn: getEl("swapConfirmWaitBtn"),
  swapConfirmProceedBtn: getEl("swapConfirmProceedBtn"),
  walletProviderModal: getEl("walletProviderModal"),
  walletProviderModalClose: getEl("walletProviderModalClose"),
  walletProviderList: getEl("walletProviderList"),
  walletProviderNoWallet: getEl("walletProviderNoWallet"),
  unrecognizedTokenModal: getEl("unrecognizedTokenModal"),
  unrecognizedTokenModalClose: getEl("unrecognizedTokenModalClose"),
  unrecognizedTokenAddress: getEl("unrecognizedTokenAddress"),
  unrecognizedTokenLoading: getEl("unrecognizedTokenLoading"),
  unrecognizedTokenMetadata: getEl("unrecognizedTokenMetadata"),
  unrecognizedTokenError: getEl("unrecognizedTokenError"),
  unrecognizedTokenCancelBtn: getEl("unrecognizedTokenCancelBtn"),
  unrecognizedTokenSaveBtn: getEl("unrecognizedTokenSaveBtn") as HTMLButtonElement,
};

// Bridge callbacks: the inline JS exposes these on window for us to wire up.
// During init the inline script hasn't run yet, so we read at call time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;

const modalCallbacks: ModalCallbacks = {
  getCurrentChainId: () =>
    typeof win.__cb_getCurrentChainId === "function"
      ? (win.__cb_getCurrentChainId as () => number)()
      : 1,
  hasConnectedWallet: () =>
    typeof win.__cb_hasConnectedWallet === "function"
      ? (win.__cb_hasConnectedWallet as () => boolean)()
      : false,
  renderLocalTokens: () => {
    if (typeof win.__cb_renderLocalTokens === "function")
      (win.__cb_renderLocalTokens as () => void)();
  },
  addMevRpcToWallet: (type: string) => {
    if (typeof win.__cb_addMevRpcToWallet === "function")
      (win.__cb_addMevRpcToWallet as (t: string) => void)(type);
  },
  getProgressiveQuoteState: () => {
    if (typeof win.__cb_getProgressiveQuoteState === "function") {
      return (
        win.__cb_getProgressiveQuoteState as () => {
          complete: boolean;
          spandex: unknown;
          spandexError: unknown;
          curve: unknown;
          curveError: unknown;
          singleRouterMode: boolean;
        }
      )();
    }
    return {
      complete: true,
      spandex: null,
      spandexError: null,
      curve: null,
      curveError: null,
      singleRouterMode: false,
    };
  },
  executeSwapFromCard: async (card: HTMLElement) => {
    if (typeof win.__cb_executeSwapFromCard === "function")
      await (win.__cb_executeSwapFromCard as (c: HTMLElement) => Promise<void>)(card);
  },
  getPendingSwapCard: () =>
    typeof win.__cb_getPendingSwapCard === "function"
      ? (win.__cb_getPendingSwapCard as () => HTMLElement | null)()
      : null,
  setPendingSwapCard: (card: HTMLElement | null) => {
    if (typeof win.__cb_setPendingSwapCard === "function")
      (win.__cb_setPendingSwapCard as (c: HTMLElement | null) => void)(card);
  },
  fetchTokenMetadata: (address: string, chainId: number) => {
    if (typeof win.__cb_fetchTokenMetadata === "function")
      (win.__cb_fetchTokenMetadata as (a: string, c: number) => void)(address, chainId);
  },
  handleUnrecognizedTokenSave: () => {
    if (typeof win.__cb_handleUnrecognizedTokenSave === "function")
      (win.__cb_handleUnrecognizedTokenSave as () => void)();
  },
  getFromInput: () =>
    typeof win.__cb_getFromInput === "function"
      ? (win.__cb_getFromInput as () => HTMLElement | null)()
      : document.getElementById("fromToken"),
  getToInput: () =>
    typeof win.__cb_getToInput === "function"
      ? (win.__cb_getToInput as () => HTMLElement | null)()
      : document.getElementById("toToken"),
  getUnrecognizedTokenState: () => {
    if (typeof win.__cb_getUnrecognizedTokenState === "function")
      return (win.__cb_getUnrecognizedTokenState as () => { targetInput: string | null })();
    return { targetInput: null };
  },
  setUnrecognizedTokenState: (state) => {
    if (typeof win.__cb_setUnrecognizedTokenState === "function")
      (win.__cb_setUnrecognizedTokenState as (s: typeof state) => void)(state);
  },
  getConnectWalletBtn: () => document.getElementById("connectWalletBtn"),
  getIsConnectingProvider: () =>
    typeof win.__cb_getIsConnectingProvider === "function"
      ? (win.__cb_getIsConnectingProvider as () => boolean)()
      : false,
  getPendingPostConnectAction: () =>
    typeof win.__cb_getPendingPostConnectAction === "function"
      ? (win.__cb_getPendingPostConnectAction as () => unknown)()
      : null,
  setPendingPostConnectAction: (action: unknown) => {
    if (typeof win.__cb_setPendingPostConnectAction === "function")
      (win.__cb_setPendingPostConnectAction as (a: unknown) => void)(action);
  },
};

initModals(modalElements, modalCallbacks);

export {};
