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
import { initChainSelector, getCurrentChainId } from "./chain-selector.js";
import type { ChainSelectorElements, ChainSelectorCallbacks } from "./chain-selector.js";
import { initModals, lockBodyScroll, unlockBodyScroll, closeWalletProviderMenu } from "./modals.js";
import type { ModalElements, ModalCallbacks } from "./modals.js";
import { initWallet } from "./wallet.js";
import type { WalletElements, WalletModalFunctions, WalletCallbacks } from "./wallet.js";
import {
  initTokenManagement,
  renderLocalTokens,
  fetchTokenMetadata,
  handleUnrecognizedTokenSave,
  getUnrecognizedTokenState,
  setUnrecognizedTokenState,
  findTokenByAddress,
  getTokensForChain,
} from "./token-management.js";
import type { TokenManagementElements, TokenManagementCallbacks } from "./token-management.js";
import { initAutocomplete, escapeHtml, refreshAutocomplete } from "./autocomplete.js";
import type { AutocompleteElements, AutocompleteCallbacks } from "./autocomplete.js";
import {
  initAmountFields,
  updateAmountFieldLabels,
  formatQuoteAmount,
  setDirectionMode,
  getActiveMode,
  scheduleAutoQuote,
  populateNonActiveField,
  setComputedAmount,
  getActiveAmount,
  isProgrammatic,
  setProgrammatic,
  getBestQuoteFromState,
} from "./amount-fields.js";
import type { AmountFieldElements, AmountFieldCallbacks } from "./amount-fields.js";
import {
  initSlippage,
  getSlippageBps,
  setSlippageBps,
  updateSlippagePresetActive,
} from "./slippage.js";
import type { SlippageElements } from "./slippage.js";
import {
  initUrlSync,
  readCompareParamsFromForm,
  saveUserPreferences,
  loadPreferences,
  getSavedTokensForChain,
  applyDefaults,
  cloneCompareParams,
  compareParamsToSearchParams,
  updateUrlFromCompareParams,
  restoreFromUrlAndPreferences,
  applyTokenFormattingAfterLoad,
} from "./url-sync.js";
import type { UrlSyncElements, UrlSyncCallbacks } from "./url-sync.js";
import { formatChainDisplay } from "./chain-selector.js";
import { CHAIN_NAMES } from "./config.js";

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
// Chain selector initialization
// ---------------------------------------------------------------------------

const chainSelectorElements: ChainSelectorElements = {
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
  chainDropdown: document.getElementById("chainDropdown") as HTMLElement,
};

const chainSelectorCallbacks: ChainSelectorCallbacks = {
  onChainChange: () => {
    // Chain change side-effects are handled by the inline JS 'change' listener
  },
  getCurrentChainId: () => getCurrentChainId(),
};

initChainSelector(chainSelectorElements, chainSelectorCallbacks);

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
  getCurrentChainId: () => getCurrentChainId(),
  hasConnectedWallet: () =>
    typeof win.__cb_hasConnectedWallet === "function"
      ? (win.__cb_hasConnectedWallet as () => boolean)()
      : false,
  renderLocalTokens: () => renderLocalTokens(),
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
  fetchTokenMetadata: (address: string, chainId: number) =>
    void fetchTokenMetadata(address, chainId),
  handleUnrecognizedTokenSave: () => handleUnrecognizedTokenSave(),
  getFromInput: () => document.getElementById("from"),
  getToInput: () => document.getElementById("to"),
  getUnrecognizedTokenState: () => {
    const state = getUnrecognizedTokenState();
    return { targetInput: state.targetInput };
  },
  setUnrecognizedTokenState: (state) => {
    setUnrecognizedTokenState(state as { targetInput: "from" | "to" | null });
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

// ---------------------------------------------------------------------------
// Wallet initialization
// ---------------------------------------------------------------------------

const walletElements: WalletElements = {
  connectWalletBtn: getEl("connectWalletBtn"),
  walletConnected: getEl("walletConnected"),
  walletConnectedIcon: getEl("walletConnectedIcon") as HTMLImageElement,
  walletConnectedName: getEl("walletConnectedName"),
  walletConnectedAddress: getEl("walletConnectedAddress"),
  disconnectWalletBtn: getEl("disconnectWalletBtn"),
  walletMessage: getEl("walletMessage"),
  walletProviderModal: modalElements.walletProviderModal,
  walletProviderModalClose: modalElements.walletProviderModalClose,
  walletProviderList: modalElements.walletProviderList,
  walletProviderNoWallet: modalElements.walletProviderNoWallet,
};

const walletModalFns: WalletModalFunctions = {
  lockBodyScroll,
  unlockBodyScroll,
  closeWalletProviderMenu,
};

const walletCallbacks: WalletCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  onConnected: (pendingAction) => {
    if (typeof win.__cb_onWalletConnected === "function")
      (win.__cb_onWalletConnected as (a: typeof pendingAction) => void)(pendingAction);
  },
  onDisconnected: () => {
    if (typeof win.__cb_onWalletDisconnected === "function")
      (win.__cb_onWalletDisconnected as () => void)();
  },
  updateTransactionActionStates: () => {
    if (typeof win.__cb_updateTransactionActionStates === "function")
      (win.__cb_updateTransactionActionStates as () => void)();
  },
  updateTokenBalances: () => {
    if (typeof win.__cb_updateTokenBalances === "function")
      (win.__cb_updateTokenBalances as () => void)();
  },
};

initWallet(walletElements, walletModalFns, walletCallbacks);

// ---------------------------------------------------------------------------
// Token management initialization
// ---------------------------------------------------------------------------

const fromInput = document.getElementById("from") as HTMLInputElement;
const toInput = document.getElementById("to") as HTMLInputElement;
const fromWrapper = document.getElementById("fromWrapper") as HTMLElement;
const toWrapper = document.getElementById("toWrapper") as HTMLElement;
const fromIcon = document.getElementById("fromIcon") as HTMLImageElement;
const toIcon = document.getElementById("toIcon") as HTMLImageElement;

const tokenManagementElements: TokenManagementElements = {
  tokenlistUrlInput: getEl("tokenlistUrlInput") as HTMLInputElement,
  addTokenlistBtn: getEl("addTokenlistBtn") as HTMLButtonElement,
  tokenlistMessage: getEl("tokenlistMessage"),
  tokenlistSourcesList: getEl("tokenlistSourcesList"),
  exportLocalTokensBtn: getEl("exportLocalTokensBtn") as HTMLButtonElement,
  importLocalTokensInput: getEl("importLocalTokensInput") as HTMLInputElement,
  localTokensToggle: getEl("localTokensToggle"),
  localTokensMessage: getEl("localTokensMessage"),
  localTokensContent: getEl("localTokensContent"),
  unrecognizedTokenModal: modalElements.unrecognizedTokenModal,
  unrecognizedTokenLoading: getEl("unrecognizedTokenLoading"),
  unrecognizedTokenMetadata: getEl("unrecognizedTokenMetadata"),
  unrecognizedTokenName: getEl("unrecognizedTokenName"),
  unrecognizedTokenSymbol: getEl("unrecognizedTokenSymbol"),
  unrecognizedTokenDecimals: getEl("unrecognizedTokenDecimals"),
  unrecognizedTokenError: getEl("unrecognizedTokenError"),
  unrecognizedTokenSaveBtn: getEl("unrecognizedTokenSaveBtn") as HTMLButtonElement,
  fromInput,
  toInput,
};

const tokenManagementCallbacks: TokenManagementCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  escapeHtml: (str: string) => escapeHtml(str),
  refreshAutocomplete: () => refreshAutocomplete(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  formatTokenDisplay: (symbol: string, address: string) => {
    if (typeof win.formatTokenDisplay === "function")
      return (win.formatTokenDisplay as (s: string, a: string) => string)(symbol, address);
    const sym = String(symbol || "").trim();
    const addr = String(address || "").trim();
    if (!addr) return sym || "";
    return sym ? sym + " (" + addr + ")" : addr;
  },
  handleTokenSwapIfNeeded: (
    currentInput: HTMLInputElement,
    newAddress: string,
    newDisplay: string
  ) => {
    if (typeof win.handleTokenSwapIfNeeded === "function")
      (win.handleTokenSwapIfNeeded as (i: HTMLInputElement, a: string, d: string) => void)(
        currentInput,
        newAddress,
        newDisplay
      );
  },
  updateTokenInputIcon: (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: unknown
  ) => {
    if (typeof win.updateTokenInputIcon === "function")
      (
        win.updateTokenInputIcon as (
          i: HTMLInputElement,
          ic: HTMLImageElement,
          w: HTMLElement,
          t: unknown
        ) => void
      )(input, icon, wrapper, token);
  },
  clearTokenInputIcon: (wrapper: HTMLElement, icon: HTMLImageElement) => {
    if (typeof win.clearTokenInputIcon === "function")
      (win.clearTokenInputIcon as (w: HTMLElement, i: HTMLImageElement) => void)(wrapper, icon);
  },
  updateFromTokenBalance: () => {
    if (typeof win.updateFromTokenBalance === "function")
      (win.updateFromTokenBalance as () => void)();
  },
  updateToTokenBalance: () => {
    if (typeof win.updateToTokenBalance === "function") (win.updateToTokenBalance as () => void)();
  },
  updateAmountFieldLabels: () => {
    if (typeof win.updateAmountFieldLabels === "function")
      (win.updateAmountFieldLabels as () => void)();
  },
  isAddressLike: (address: string) => /^0x[a-fA-F0-9]{40}$/.test(String(address || "").trim()),
  openUnrecognizedTokenModal: (address: string, chainId: number, targetInput: string) => {
    if (typeof win.openUnrecognizedTokenModal === "function")
      (win.openUnrecognizedTokenModal as (a: string, c: number, t: string) => void)(
        address,
        chainId,
        targetInput
      );
  },
  closeUnrecognizedTokenModal: () => {
    if (typeof win.closeUnrecognizedTokenModal === "function")
      (win.closeUnrecognizedTokenModal as () => void)();
  },
  getFromIcon: () => fromIcon,
  getToIcon: () => toIcon,
  getFromWrapper: () => fromWrapper,
  getToWrapper: () => toWrapper,
};

initTokenManagement(tokenManagementElements, tokenManagementCallbacks);

// ---------------------------------------------------------------------------
// Autocomplete initialization
// ---------------------------------------------------------------------------

const autocompleteElements: AutocompleteElements = {
  fromInput,
  toInput,
  fromAutocompleteList: getEl("fromAutocomplete"),
  toAutocompleteList: getEl("toAutocomplete"),
  fromWrapper,
  toWrapper,
  fromIcon,
  toIcon,
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
};

const autocompleteCallbacks: AutocompleteCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  getTokensForChain: (chainId: number) => getTokensForChain(chainId),
  formatTokenDisplay: tokenManagementCallbacks.formatTokenDisplay,
  handleTokenSwapIfNeeded: tokenManagementCallbacks.handleTokenSwapIfNeeded,
  updateTokenInputIcon: tokenManagementCallbacks.updateTokenInputIcon,
  clearTokenInputIcon: tokenManagementCallbacks.clearTokenInputIcon,
  updateFromTokenBalance: tokenManagementCallbacks.updateFromTokenBalance,
  updateToTokenBalance: tokenManagementCallbacks.updateToTokenBalance,
  updateAmountFieldLabels: tokenManagementCallbacks.updateAmountFieldLabels,
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
};

initAutocomplete(autocompleteElements, autocompleteCallbacks);

// ---------------------------------------------------------------------------
// Amount fields initialization
// ---------------------------------------------------------------------------

const sellAmountInput = document.getElementById("sellAmount") as HTMLInputElement;
const receiveAmountInput = document.getElementById("receiveAmount") as HTMLInputElement;
const sellAmountLabel = document.getElementById("sellAmountLabel") as HTMLElement;
const receiveAmountLabel = document.getElementById("receiveAmountLabel") as HTMLElement;
const sellAmountGroup = document.getElementById("sellAmountGroup") as HTMLElement;
const receiveAmountGroup = document.getElementById("receiveAmountGroup") as HTMLElement;
const targetOutNote = document.getElementById("targetOutNote") as HTMLElement;

const amountFieldElements: AmountFieldElements = {
  sellAmountInput,
  receiveAmountInput,
  sellAmountLabel,
  receiveAmountLabel,
  sellAmountGroup,
  receiveAmountGroup,
  targetOutNote,
  fromInput,
  toInput,
};

const amountFieldCallbacks: AmountFieldCallbacks = {
  scheduleAutoQuote: () => scheduleAutoQuote(),
  cancelInProgressFetches: () => {
    if (typeof win.__cb_cancelInProgressFetches === "function")
      (win.__cb_cancelInProgressFetches as () => void)();
  },
  readCompareParamsFromForm: () => readCompareParamsFromForm(),
  runCompareAndMaybeStartAutoRefresh: async (params, options) => {
    if (typeof win.__cb_runCompareAndMaybeStartAutoRefresh === "function")
      await (
        win.__cb_runCompareAndMaybeStartAutoRefresh as (
          p: typeof params,
          o: typeof options
        ) => Promise<void>
      )(params, options);
  },
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  getCurrentChainId: () => getCurrentChainId(),
  getBestQuoteFromState: () => {
    if (typeof win.__cb_getBestQuoteFromState === "function")
      return (
        win.__cb_getBestQuoteFromState as () => {
          output_amount?: string;
          input_amount?: string;
        } | null
      )();
    return null;
  },
  clearNonActiveField: () => {
    if (typeof win.__cb_clearNonActiveField === "function")
      (win.__cb_clearNonActiveField as () => void)();
  },
};

initAmountFields(amountFieldElements, amountFieldCallbacks);

// ---------------------------------------------------------------------------
// Slippage initialization
// ---------------------------------------------------------------------------

const slippageElements: SlippageElements = {
  slippageInput: document.getElementById("slippageBps") as HTMLInputElement,
  slippagePresetBtns: document.querySelectorAll(
    ".slippage-preset-compact"
  ) as NodeListOf<HTMLElement>,
};

initSlippage(slippageElements);

// ---------------------------------------------------------------------------
// URL sync initialization
// ---------------------------------------------------------------------------

const urlSyncElements: UrlSyncElements = {
  fromInput,
  toInput,
  sellAmountInput,
  receiveAmountInput,
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
  fromIcon,
  toIcon,
  fromWrapper,
  toWrapper,
};

const urlSyncCallbacks: UrlSyncCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  hasConnectedWallet: () =>
    typeof win.__cb_hasConnectedWallet === "function"
      ? (win.__cb_hasConnectedWallet as () => boolean)()
      : false,
  getConnectedAddress: () =>
    typeof win.getConnectedAddress === "function"
      ? (win.getConnectedAddress as () => string)()
      : "",
  getActiveMode: () => getActiveMode(),
  getSlippageBps: () => getSlippageBps(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  formatTokenDisplay: tokenManagementCallbacks.formatTokenDisplay,
  updateTokenInputIcon: tokenManagementCallbacks.updateTokenInputIcon as (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: import("./types.js").Token | undefined
  ) => void,
  clearTokenInputIcon: tokenManagementCallbacks.clearTokenInputIcon,
  updateAmountFieldLabels: () => updateAmountFieldLabels(),
  setDirectionMode: (mode: "exactIn" | "targetOut") => setDirectionMode(mode),
  updateSlippagePresetActive: (value: string) => updateSlippagePresetActive(value),
  setSlippageBps: (value: string) => setSlippageBps(value),
  formatChainDisplay: (chainId: string, chainName: string) =>
    formatChainDisplay(chainId, chainName),
  getChainName: (chainId: string) => CHAIN_NAMES[chainId] ?? "",
  extractAddressFromInput: (input: HTMLInputElement) => {
    if (typeof win.extractAddressFromInput === "function")
      return (win.extractAddressFromInput as (i: HTMLInputElement) => string)(input);
    // Fallback: check data-address then value
    const dataAddr = input.dataset.address;
    if (dataAddr && /^0x[a-fA-F0-9]{40}$/.test(dataAddr)) return dataAddr;
    const value = String(input.value || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
    if (dataAddr) return dataAddr;
    return value;
  },
};

initUrlSync(urlSyncElements, urlSyncCallbacks);

// Re-export for inline JS compatibility (avoid dead-code detection issues)
void formatQuoteAmount;
void populateNonActiveField;
void setComputedAmount;
void getActiveAmount;
void isProgrammatic;
void setProgrammatic;
void getBestQuoteFromState;
void loadPreferences;
void getSavedTokensForChain;
void applyDefaults;
void cloneCompareParams;
void compareParamsToSearchParams;
void updateUrlFromCompareParams;
void restoreFromUrlAndPreferences;
void applyTokenFormattingAfterLoad;
void saveUserPreferences;

export {};
